import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedSquareHandler } from './hosted-square.js';

const env = { SQUARE_APP_ORIGIN: 'https://tool.test', SQUARE_ENVIRONMENT: 'production', SQUARE_APPLICATION_ID: 'app', SQUARE_APPLICATION_SECRET: 'secret', SQUARE_TOKEN_KEY: 'ab'.repeat(32) };
const SESSION = '__Host-mya-square';
const STATE = '__Host-mya-square-oauth';
function fixture({ bookingFailure, refreshFailure, security = {} } = {}) {
  let time = Date.parse('2026-11-11T00:00:00Z');
  let revoked = false, outage = false;
  const calls = [], usedCodes = new Set();
  const fetcher = async (url, init) => {
    const body = init.body && JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    if (outage) return { ok: false, status: 503 };
    if (revoked) return { ok: false, status: 401 };
    if (url.endsWith('/oauth2/token/status')) return { ok: true, json: async () => ({ merchant_id: 'seller', client_id: 'app', scopes: bookingFailure ? ['MERCHANT_PROFILE_READ','APPOINTMENTS_READ','APPOINTMENTS_ALL_READ','ITEMS_READ'] : ['MERCHANT_PROFILE_READ'] }) };
    if (url.endsWith('/v2/locations')) return { ok:true, json:async()=>({locations:[{id:'salon',name:'Salon',status:'ACTIVE',timezone:'America/Chicago'}]}) };
    if (url.includes('/v2/bookings?') && bookingFailure) return {ok:false,status:bookingFailure,json:async()=>({errors:[{code:'INVALID_REQUEST_ERROR'}]})};
    if (url.endsWith('/oauth2/token')) {
      if (body.grant_type === 'refresh_token' && refreshFailure) return {ok:false,status:400,json:async()=>({error:refreshFailure})};
      if (body.code && usedCodes.has(body.code)) return { ok: false, status: 400 };
      usedCodes.add(body.code);
      return { ok: true, json: async () => ({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', merchant_id: body.code === 'other' ? 'other' : 'seller', expires_at: new Date(time + 30 * 86400000).toISOString() }) };
    }
    return { ok: true, json: async () => ({ merchant: { id: url.endsWith('/other') ? 'other' : 'seller', business_name: 'Mya’s Salon' } }) };
  };
  const handler = (overrides = {}) => createHostedSquareHandler({ ...env, ...overrides }, { fetcher, now: () => time, ...security });
  async function request(path, { method, jar = {}, origin = env.SQUARE_APP_ORIGIN, use = handler(), userId='owner' } = {}) {
    const headers = {};
    const res = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(body) { this.body = body; } };
    await use({ myaApprovedUserId:userId, url: `/api/square/${path}`, method: method || (path.startsWith('session') || path.startsWith('connect') ? 'POST' : 'GET'), headers: { origin, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } }, res);
    for (const c of headers['Set-Cookie'] || []) {
      const first = c.split(';')[0], index = first.indexOf('=');
      if (c.includes('Max-Age=0')) delete jar[first.slice(0, index)];
      else jar[first.slice(0, index)] = first.slice(index + 1);
    }
    return { ...res, headers, data: headers['Content-Type'] === 'application/json' ? JSON.parse(res.body) : null };
  }
  async function connect(jar = {}, code = 'good') {
    const start = await request('connect', { jar });
    const url = new URL(start.data.url);
    const state = url.searchParams.get('state');
    return { url, state, result: await request(`callback?state=${state}&code=${code}`, { jar }) };
  }
  return { request, connect, handler, calls, advance: ms => time += ms, revoke: () => revoked = true, outage: () => outage = true };
}

test('protected Square OAuth binds tokens to the initiating app user and rechecks callback approval',async()=>{
  let approved=true;
  const f=fixture({security:{requireIdentity:true,validateCallbackIdentity:async userId=>approved&&userId==='owner'}}),jar={};
  await f.connect(jar);
  assert.equal((await f.request('status',{jar})).data.connected,true);
  assert.equal((await f.request('status',{jar,userId:'other'})).data.connected,false);
  const pending=new URL((await f.request('connect',{jar})).data.url);
  approved=false;
  const calls=f.calls.length;
  assert.match((await f.request(`callback?state=${pending.searchParams.get('state')}&code=revoked-user`,{jar})).headers.Location,/access-denied$/);
  assert.equal(f.calls.length,calls);
});

test('hosted OAuth survives new function instances, encrypts credentials, and isolates browsers', async () => {
  const f = fixture(), jar = {};
  assert.equal((await f.request('session')).data.configured, true);
  assert.equal((await f.request('status')).data.connected, false);
  const { url, result } = await f.connect(jar);
  assert.equal(url.origin, 'https://connect.squareup.com');
  assert.equal(url.searchParams.get('redirect_uri'), `${env.SQUARE_APP_ORIGIN}/api/square/callback`);
  assert.deepEqual(url.searchParams.get('scope').split(' '), ['MERCHANT_PROFILE_READ', 'APPOINTMENTS_READ', 'APPOINTMENTS_ALL_READ', 'ITEMS_READ']);
  assert.equal(result.headers.Location, `${env.SQUARE_APP_ORIGIN}/?square=connected`);
  assert.equal(jar[STATE], undefined);
  assert.ok(jar[SESSION]);
  assert.equal(Buffer.from(jar[SESSION], 'base64url').includes(Buffer.from('private-access')), false);
  assert.match(result.headers['Set-Cookie'][1], /Path=\/; HttpOnly; Secure; SameSite=Lax/);
  const status = await f.request('status', { jar, use: f.handler() });
  assert.equal(status.data.connected, true);
  assert.equal(status.data.merchant, 'Mya’s Salon');
  assert.equal(status.body.includes('private-'), false);
  assert.equal((await f.request('status')).data.connected, false);
  assert.equal((await f.request('status', { jar, use: f.handler({ SQUARE_APPLICATION_ID: 'different' }) })).data.connected, false);
  assert.equal(f.calls[0].body.redirect_uri, `${env.SQUARE_APP_ORIGIN}/api/square/callback`);
});

test('rejects cross-origin initiation, invalid state, wrong methods, and missing setup', async () => {
  const f = fixture();
  assert.equal((await f.request('connect', { origin: 'https://evil.test' })).statusCode, 403);
  assert.equal((await f.request('connect', { method: 'GET' })).statusCode, 405);
  assert.equal((await f.request('callback?code=good&state=bad')).headers.Location, `${env.SQUARE_APP_ORIGIN}/?square=invalid-state`);
  const jar = {};
  await f.request('connect', { jar });
  jar[STATE] = jar[STATE].slice(0, 20) + 'tampered';
  assert.match((await f.request(`callback?code=good&state=${'a'.repeat(43)}`, { jar })).headers.Location, /invalid-state$/);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('session', { use: f.handler({ SQUARE_TOKEN_KEY: '' }) })).data.configured, false);
  assert.equal((await f.request('connect', { use: f.handler({ SQUARE_TOKEN_KEY: '' }) })).statusCode, 503);
});

test('expires OAuth state, handles denial, prevents callback replay and accidental seller switching', async () => {
  const f = fixture(), jar = {};
  const start = new URL((await f.request('connect', { jar })).data.url);
  f.advance(601000);
  assert.match((await f.request(`callback?code=good&state=${start.searchParams.get('state')}`, { jar })).headers.Location, /invalid-state$/);
  const denied = new URL((await f.request('connect', { jar })).data.url);
  assert.match((await f.request(`callback?error=access_denied&state=${denied.searchParams.get('state')}`, { jar })).headers.Location, /declined$/);
  const { state } = await f.connect(jar);
  assert.match((await f.request(`callback?code=good&state=${state}`, { jar })).headers.Location, /invalid-state$/);
  const old = jar[SESSION];
  assert.match((await f.connect(jar, 'other')).result.headers.Location, /wrong-seller$/);
  assert.equal(jar[SESSION], old);
});

test('refreshes expiring tokens, preserves session on outages, clears revoked authorization', async () => {
  const f = fixture(), jar = {};
  await f.connect(jar);
  f.advance(29.5 * 86400000);
  const old = jar[SESSION];
  assert.equal((await f.request('status', { jar })).data.connected, true);
  assert.notEqual(jar[SESSION], old);
  assert.equal(f.calls.find(c => c.body?.grant_type === 'refresh_token').body.refresh_token, 'private-refresh-token');
  f.revoke();
  assert.equal((await f.request('status', { jar })).data.reconnect, true);
  assert.equal(jar[SESSION], undefined);
  const g = fixture(), other = {};
  await g.connect(other);
  g.outage();
  assert.equal((await g.request('status', { jar: other })).statusCode, 502);
  assert.ok(other[SESSION]);
});

test('Vercel rewrite action query routes the callback and status correctly', async () => {
  const handler = createHostedSquareHandler(env);
  const headers = {};
  const res = { setHeader(k,v) { headers[k] = v; }, end(body) { this.data = JSON.parse(body); } };
  await handler({ url: '/api/square?action=status', method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.connected, false);
});

test('does not send Sandbox credentials to the Production authorization endpoint', async () => {
  const f = fixture();
  for (const overrides of [{ SQUARE_APPLICATION_ID: 'sandbox-sq0idp-example' }, { SQUARE_APPLICATION_SECRET: 'sandbox-sq0csp-example' }]) {
    const use = f.handler(overrides);
    const session = await f.request('session', { use });
    assert.equal(session.data.configured, false);
    assert.match(session.data.error, /Live Square connection setup is incomplete/);
    const connect = await f.request('connect', { use });
    assert.equal(connect.statusCode, 503);
    assert.equal(connect.data.url, undefined);
    assert.equal(connect.headers['Set-Cookie'], undefined);
  }
  assert.equal(f.calls.length, 0);
});

test('appointments require authorization and scope upgrades preserve the existing seller session', async () => {
  const f = fixture(), jar = {};
  assert.equal((await f.request('appointments')).statusCode, 401);
  await f.connect(jar);
  const session = jar[SESSION];
  const result = await f.request('appointments', { jar });
  assert.equal(result.statusCode, 403);
  assert.equal(result.data.code, 'APPOINTMENT_PERMISSION_REQUIRED');
  assert.equal(jar[SESSION], session);
  assert.equal((await f.request('status', { jar })).data.connected, true);
});

test('rejected calendar queries and permissions do not erase a valid Square connection', async () => {
  for (const status of [400,403]) {
    const f=fixture({bookingFailure:status}),jar={};
    await f.connect(jar);
    const before=jar[SESSION];
    const response=await f.request('appointments?range=today',{jar});
    assert.equal(response.statusCode,status===400?502:403);
    assert.equal(response.data.code,status===400?'SQUARE_REQUEST_REJECTED':'SQUARE_APPOINTMENTS_UNAVAILABLE');
    assert.equal(jar[SESSION],before);
    assert.equal((await f.request('status',{jar})).data.connected,true);
    assert.equal(response.headers['Set-Cookie'],undefined);
  }
});

test('only a rejected refresh grant clears authorization; configuration failures preserve it', async () => {
  for(const code of ['invalid_grant','invalid_client']) {
    const f=fixture({refreshFailure:code}),jar={};await f.connect(jar);
    f.advance(29.5*86400000);
    const response=await f.request('status',{jar});
    if(code==='invalid_grant') {
      assert.equal(response.data.reconnect,true);assert.equal(jar[SESSION],undefined);
    } else {
      assert.equal(response.statusCode,502);assert.ok(jar[SESSION]);
    }
  }
});
