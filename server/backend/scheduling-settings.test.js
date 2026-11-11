import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { runMigrations } from './migrations.js';
import { ApiError } from './errors.js';
import settingsHandler from '../../api/v1/workspaces/[workspaceId]/scheduling-settings.js';
import membersHandler from '../../api/v1/workspaces/[workspaceId]/members.js';
import {createProtectedSquareHandler} from './protected-square.js';

function databaseFor(pg) {
  const wrap = client => ({ unsafe: (sql, params = []) => sql.includes(';') && !params.length ? client.exec(sql) : client.query(sql, params) });
  return { ...wrap(pg), begin: callback => pg.transaction(tx => callback(wrap(tx))) };
}

test('private scheduling settings enforce roles, validation, revisions, and transactional audit history', async t => {
  const pg = new PGlite({ extensions: { btree_gist } });
  t.after(() => pg.close());
  const database = databaseFor(pg);
  await runMigrations(database);
  const workspaceId = (await pg.query(`SELECT id FROM public.organizations WHERE slug='mk-manikure-lounge'`)).rows[0].id;
  await pg.exec(`INSERT INTO public.app_users(id) VALUES ('owner'),('admin'),('member'),('outsider'),('revoked');`);
  await pg.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES ($1,'owner','owner'),($1,'admin','admin'),($1,'member','member'),($1,'revoked','admin')`, [workspaceId]);
  await pg.query(`UPDATE public.organization_memberships SET revoked_at=now() WHERE user_id='revoked'`);

  async function request({ user='owner', method='GET', body, workspace=workspaceId, contentType='application/json',handler=settingsHandler } = {}) {
    const headers = {};
    const res = { setHeader(k,v) { headers[k]=v; }, end(s) { this.data=JSON.parse(s); } };
    await handler({ method, url:`/api/v1/workspaces/${workspace}/scheduling-settings`, query:{workspaceId:workspace}, headers:{'content-type':contentType}, ...(body!==undefined?{body}:{}) },res,{
      database, authenticate:async()=>{if(!user)throw new ApiError(401,'AUTHENTICATION_REQUIRED','Sign in.');return {userId:user};},
    });
    return {status:res.statusCode,body:res.data,headers};
  }
  let revision;
  await t.test('Square endpoints require active app approval and integration management requires owner or admin',async()=>{
    for(const [user,action,expected] of [[null,'status',401],['outsider','status',403],['revoked','status',403],['member','connect',403],['member','status',200],['owner','status',200]]){
      const handler=createProtectedSquareHandler({SQUARE_APP_ORIGIN:'https://tool.test',SQUARE_ENVIRONMENT:'production',SQUARE_APPLICATION_ID:'app',SQUARE_APPLICATION_SECRET:'secret',SQUARE_TOKEN_KEY:'ab'.repeat(32)}, {database,authenticate:async()=>{if(!user)throw new ApiError(401,'AUTHENTICATION_REQUIRED','Sign in.');return {userId:user};}});
      const res={statusCode:200,setHeader(){},end(){}};
      await handler({url:`/api/square/${action}`,method:action==='connect'?'POST':'GET',headers:{}},res);
      assert.equal(res.statusCode,expected,`${user} ${action}`);
    }
  });
  await t.test('returns owner configuration and truthful reminder delivery status', async()=>{
    const result=await request();
    assert.equal(result.status,200);
    const s=result.body.data;revision=s.revision;
    assert.equal(s.minimumNoticeMinutes,1440);
    assert.equal(s.minimumNoticeConfirmed,true);
    assert.deepEqual(s.reminders,{enabled:true,minutesBefore:[60],recipient:'workspace_owner',deliveryStatus:'not_implemented'});
    assert.equal(s.publicBookingEnabled,false);
    assert.equal(s.cancellation.noticeMinutes,null);
    assert.equal(s.canEdit,true);
    assert.equal(result.headers['Cache-Control'],'no-store');
  });

  await t.test('members can read but cannot edit, and nonmembers/revoked users are denied',async()=>{
    assert.equal((await request({user:'member'})).body.data.canEdit,false);
    assert.equal((await request({user:'member',method:'PATCH',body:{revision,minimumNoticeMinutes:720}})).status,403);
    assert.equal((await request({user:'outsider'})).status,404);
    assert.equal((await request({user:'revoked'})).status,404);
    assert.equal((await request({user:null})).status,401);
    assert.equal((await request({workspace:'22222222-2222-4222-8222-222222222222'})).status,404);
  });

  await t.test('owners update hours and reminders atomically and stale revisions cannot overwrite them',async()=>{
    const result=await request({method:'PATCH',body:{revision,weeklyHours:[{weekday:6,start:'09:00',end:'16:00'}],buffers:{beforeMinutes:5,afterMinutes:10},reminders:{minutesBefore:[60,1440]},bookingHorizon:{unit:'months',value:4}}});
    assert.equal(result.status,200);
    assert.equal(result.body.data.revision,revision+1);
    assert.deepEqual(result.body.data.weeklyHours,[{weekday:6,start:'09:00',end:'16:00'}]);
    assert.deepEqual(result.body.data.reminders.minutesBefore,[1440,60]);
    assert.equal((await request({method:'PATCH',body:{revision,holdMinutes:5}})).status,409);
    revision=result.body.data.revision;
    const events=(await pg.query(`SELECT actor_user_id,metadata FROM scheduling.audit_events WHERE event_type='scheduling.settings_updated'`)).rows;
    assert.equal(events.length,1);
    assert.equal(events[0].actor_user_id,'owner');
    assert.ok(events[0].metadata.changedFields.includes('weeklyHours'));
    assert.equal((await pg.query(`SELECT current_setting('mya.organization_id',true) AS context`)).rows[0].context,'');
  });

  await t.test('rejects invalid hours, arbitrary fields, malformed JSON and unsafe activation',async()=>{
    for(const body of [
      {revision,weeklyHours:[{weekday:6,start:'10:00',end:'12:00'},{weekday:6,start:'11:00',end:'13:00'}]},
      {revision,timezone:'Not/AZone'},
      {revision,reminders:{minutesBefore:[60,60]}},
      {revision,requiredContactFields:[]},
      {revision,minimumNoticeMinutes:-1},
      {revision,publicBookingEnabled:true},
      {revision,cancellation:{termsConfirmed:true}},
    ]) assert.equal((await request({method:'PATCH',body})).status,400);
    assert.equal((await request({method:'PATCH',body:'{'})).status,400);
    assert.equal((await request({method:'PATCH',body:{revision,holdMinutes:5},contentType:'text/plain'})).status,415);
    assert.equal((await request({method:'PATCH',body:'a'.repeat(17000)})).status,413);
    assert.equal((await request()).body.data.revision,revision);
    assert.equal((await request()).body.data.publicBookingEnabled,false);
  });

  await t.test('only owners can approve people; revocation takes effect on their next request',async()=>{
    const manage=options=>request({handler:membersHandler,...options});
    assert.equal((await manage({user:'admin'})).status,403);
    assert.equal((await manage({user:'member',method:'POST',body:{action:'approve',userId:'outsider',role:'admin'}})).status,403);
    assert.equal((await manage({method:'POST',body:{action:'approve',userId:'outsider',role:'member'}})).status,200);
    assert.equal((await request({user:'outsider'})).status,200);
    assert.equal((await manage({method:'POST',body:{action:'revoke',userId:'outsider'}})).status,200);
    assert.equal((await request({user:'outsider'})).status,404);
    assert.equal((await manage({method:'POST',body:{action:'revoke',userId:'owner'}})).status,409);
    assert.equal((await manage({method:'POST',body:{action:'approve',userId:'missing_user',role:'member'}})).status,400);
    assert.equal((await manage({method:'POST',body:{action:'approve',userId:'outsider',role:'owner'}})).status,400);
    assert.equal((await manage({workspace:'22222222-2222-4222-8222-222222222222'})).status,404);
  });

  await t.test('the restricted runtime role can save settings through RLS without migration-owner privileges',async()=>{
    await pg.exec(`CREATE ROLE settings_test_runtime;
      GRANT USAGE ON SCHEMA public,scheduling TO settings_test_runtime;
      GRANT SELECT,INSERT ON public.app_users TO settings_test_runtime;
      GRANT SELECT ON public.organizations,public.organization_memberships,scheduling.settings,scheduling.working_hours TO settings_test_runtime;
      GRANT UPDATE(timezone,updated_at) ON public.organizations TO settings_test_runtime;
      GRANT UPDATE ON scheduling.settings TO settings_test_runtime;
      GRANT INSERT,DELETE ON scheduling.working_hours TO settings_test_runtime;
      GRANT INSERT ON scheduling.audit_events TO settings_test_runtime;
      GRANT INSERT,UPDATE ON public.organization_memberships TO settings_test_runtime;
      SET ROLE settings_test_runtime;`);
    try {
      const result=await request({user:'admin',method:'PATCH',body:{revision,timezone:'America/Chicago',minimumNoticeMinutes:1440,reminders:{enabled:false}}});
      assert.equal(result.status,200);
      assert.equal(result.body.data.reminders.enabled,false);
      assert.equal((await request({user:'member',method:'PATCH',body:{revision:result.body.data.revision,holdMinutes:5}})).status,403);
      assert.equal((await request({handler:membersHandler,user:'owner',method:'POST',body:{action:'approve',userId:'outsider',role:'member'}})).status,200);
      assert.equal((await request({handler:membersHandler,user:'owner',method:'POST',body:{action:'revoke',userId:'outsider'}})).status,200);
    } finally { await pg.exec('RESET ROLE'); }
  });
});
