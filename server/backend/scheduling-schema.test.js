import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { runMigrations } from './migrations.js';

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const resource = '33333333-3333-4333-8333-333333333333';

function databaseFor(pg) {
  const wrap = client => ({ unsafe: (sql, params = []) => sql.includes(';') && !params.length ? client.exec(sql) : client.query(sql, params) });
  return { ...wrap(pg), begin: callback => pg.transaction(tx => callback(wrap(tx))) };
}

test('scheduling foundation is isolated, conflict-safe, and disabled until launch requirements exist', async t => {
  const pg = new PGlite({ extensions: { btree_gist } });
  t.after(() => pg.close());
  const db = databaseFor(pg);
  const migrations = await runMigrations(db);
  assert.deepEqual(migrations, ['001_identity_workspaces_and_jobs', '20261111193208_scheduling_foundation', '20261111193633_scheduling_rls_context_initplans', '20261111193828_scheduling_activation_guard', '20261111201611_confirmed_weekend_scheduling_rules', '20261111202323_configurable_scheduling_and_reminders']);
  assert.deepEqual(await runMigrations(db), []);
  await pg.query(`INSERT INTO public.organizations(id,name,slug) VALUES ($1,'Test salon','test-salon'),($2,'Other salon','other-salon')`, [org, other]);
  await pg.query(`INSERT INTO scheduling.resources(id,organization_id,name) VALUES ($1,$2,'Test provider')`, [resource, org]);
  await pg.query('INSERT INTO scheduling.settings(organization_id,resource_id) VALUES ($1,$2)', [org, resource]);

  await t.test('does not invent an operating schedule or enable public booking', async () => {
    const settings = (await pg.query('SELECT booking_mode,public_booking_enabled,rules_confirmed_at FROM scheduling.settings WHERE organization_id=$1', [org])).rows[0];
    assert.deepEqual(settings, { booking_mode: 'square_only', public_booking_enabled: false, rules_confirmed_at: null });
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM scheduling.working_hours WHERE organization_id=$1', [org])).rows[0].n, 0);
    await assert.rejects(pg.query('UPDATE scheduling.settings SET public_booking_enabled=true'), error => error.code === '23514');
  });

  await t.test('records confirmed weekend rules while unresolved notice and cancellation terms keep booking disabled', async () => {
    const settings = (await pg.query(`SELECT s.*,o.timezone FROM scheduling.settings s JOIN public.organizations o ON o.id=s.organization_id WHERE o.slug='mk-manikure-lounge'`)).rows[0];
    assert.equal(settings.timezone, 'America/Chicago');
    assert.equal(settings.horizon_months, 3);
    assert.equal(settings.horizon_days, null);
    assert.equal(settings.buffer_before_minutes, 0);
    assert.equal(settings.buffer_after_minutes, 0);
    assert.deepEqual(settings.required_contact_fields, ['phone','firstName','lastName','email']);
    assert.equal(settings.public_booking_enabled, false);
    assert.equal(settings.policy_details.minimumNoticeConfirmed, true);
    assert.equal(settings.notice_minutes, 1440);
    assert.equal(settings.appointment_reminders_enabled, true);
    assert.deepEqual(settings.reminder_minutes_before, [60]);
    assert.equal(settings.policy_details.cancellationFeeMinor, null);
    const hours = (await pg.query(`SELECT weekday,start_local::text,end_local::text FROM scheduling.working_hours WHERE organization_id=$1 ORDER BY weekday`, [settings.organization_id])).rows;
    assert.deepEqual(hours, [{weekday:0,start_local:'10:00:00',end_local:'17:00:00'},{weekday:6,start_local:'10:00:00',end_local:'17:00:00'}]);
  });

  const occupy = (start, end, kind = 'block') => pg.query(`INSERT INTO scheduling.occupancy(organization_id,resource_id,kind,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [org, resource, kind, start, end]);
  await t.test('rejects overlap at the database while permitting adjacent appointments', async () => {
    await occupy('2026-12-01T15:00:00Z', '2026-12-01T16:00:00Z');
    await assert.rejects(occupy('2026-12-01T15:30:00Z', '2026-12-01T16:30:00Z'), error => error.code === '23P01');
    await occupy('2026-12-01T16:00:00Z', '2026-12-01T17:00:00Z');
  });

  await t.test('expired holds remain conservatively blocked until transactionally released', async () => {
    await pg.query(`INSERT INTO scheduling.occupancy(organization_id,resource_id,kind,starts_at,ends_at,expires_at,capability_hash) VALUES ($1,$2,'hold','2026-12-02T15:00Z','2026-12-02T16:00Z',now()-interval '1 minute','synthetic-hash')`, [org, resource]);
    await assert.rejects(occupy('2026-12-02T15:00Z', '2026-12-02T16:00Z'), error => error.code === '23P01');
    await pg.transaction(async tx => {
      await tx.query(`UPDATE scheduling.occupancy SET active=false WHERE organization_id=$1 AND kind='hold' AND expires_at<=now() AND active`, [org]);
      await tx.query(`INSERT INTO scheduling.occupancy(organization_id,resource_id,kind,starts_at,ends_at) VALUES ($1,$2,'first_party','2026-12-02T15:00Z','2026-12-02T16:00Z')`, [org, resource]);
    });
  });

  await t.test('prevents foreign-workspace resource references and duplicate Square imports', async () => {
    await assert.rejects(pg.query(`INSERT INTO scheduling.occupancy(organization_id,resource_id,kind,starts_at,ends_at) VALUES ($1,$2,'block','2026-12-03T15:00Z','2026-12-03T16:00Z')`, [other, resource]), error => error.code === '23503');
    const sql = `INSERT INTO scheduling.square_bookings(organization_id,seller_id,location_id,square_booking_id,starts_at,ends_at,timezone,status,synced_at) VALUES ($1,'test-seller','test-location','test-booking','2026-12-04T15:00Z','2026-12-04T16:00Z','America/Chicago','ACCEPTED',now())`;
    await pg.query(sql, [org]);
    await assert.rejects(pg.query(sql, [org]), error => error.code === '23505');
  });

  await t.test('refuses approval of incomplete or conflicted migration reports', async () => {
    await pg.query(`INSERT INTO public.app_users(id) VALUES ('test-owner')`);
    await assert.rejects(pg.query(`INSERT INTO scheduling.reconciliation_reports(organization_id,seller_id,location_id,range_start,range_end,sync_state,conflict_count,finished_at,approved_at,approved_by) VALUES ($1,'seller','location',now(),now()+interval '30 days','complete',1,now(),now(),'test-owner')`, [org]), error => error.code === '23514');
  });

  await t.test('activation requires the actual report approval, not merely its identifier', async () => {
    await pg.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES ($1,'test-owner','owner')`, [org]);
    await pg.query('UPDATE scheduling.resources SET enabled=true WHERE id=$1', [resource]);
    const report = (await pg.query(`INSERT INTO scheduling.reconciliation_reports(organization_id,seller_id,location_id,range_start,range_end,sync_state,finished_at) VALUES ($1,'seller','location','2026-12-01T00:00Z','2026-12-02T00:00Z','complete',now()) RETURNING id`, [org])).rows[0];
    const enable = () => pg.query(`UPDATE scheduling.settings SET public_booking_enabled=true,booking_mode='first_party',rules_confirmed_at=now(),rules_confirmed_by='test-owner',cutover_from='2026-12-01',cutover_to='2026-12-02',square_writes_closed_at=now()-interval '1 minute',migration_approved_report_id=$1,cancellation_policy='Synthetic policy',square_seller_id='seller',square_location_id='location',required_contact_fields=ARRAY['email'],policy_details='{"minimumNoticeConfirmed":true,"cancellationTermsConfirmed":true}' WHERE organization_id=$2`, [report.id, org]);
    await assert.rejects(enable(), error => error.code === '23514');
    await pg.query(`UPDATE scheduling.reconciliation_reports SET approved_at=now(),approved_by='test-owner' WHERE id=$1`, [report.id]);
    await enable();
    assert.equal((await pg.query('SELECT public_booking_enabled FROM scheduling.settings WHERE organization_id=$1', [org])).rows[0].public_booking_enabled, true);
    await pg.query('UPDATE scheduling.settings SET public_booking_enabled=false');
  });

  await t.test('RLS is on for every application table and a non-owner has no default access', async () => {
    const tables = (await pg.query(`SELECT schemaname,tablename,rowsecurity FROM pg_tables WHERE schemaname IN ('public','scheduling')`)).rows;
    assert.ok(tables.length >= 15);
    assert.ok(tables.every(table => table.rowsecurity));
    await pg.exec(`CREATE ROLE scheduling_test_runtime; GRANT USAGE ON SCHEMA public,scheduling TO scheduling_test_runtime; GRANT SELECT ON public.organizations,public.organization_memberships,public.app_users,scheduling.settings TO scheduling_test_runtime;`);
    await pg.exec('SET ROLE scheduling_test_runtime');
    try {
      assert.equal((await pg.query('SELECT * FROM public.organizations')).rows.length, 0);
      assert.equal((await pg.query('SELECT * FROM scheduling.settings')).rows.length, 0);
      await pg.query(`SELECT set_config('mya.user_id','test-owner',false)`);
      assert.deepEqual((await pg.query('SELECT id FROM public.organizations')).rows.map(row => row.id), [org]);
      await pg.query(`SELECT set_config('mya.organization_id',$1,false)`, [other]);
      assert.equal((await pg.query('SELECT * FROM scheduling.settings')).rows.length, 0);
      await pg.query(`SELECT set_config('mya.organization_id',$1,false)`, [org]);
      assert.equal((await pg.query('SELECT * FROM scheduling.settings')).rows.length, 1);
    } finally { await pg.exec('RESET ROLE'); }
  });
});
