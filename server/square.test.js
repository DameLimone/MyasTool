import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { squareMiddleware } from './square.js';

test('local OAuth binds state to session, encrypts tokens, verifies seller, and rejects replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mya-square-'));
  let calls = 0;
  const middleware = squareMiddleware({ SQUARE_APPLICATION_ID: 'app', SQUARE_APPLICATION_SECRET: 'secret', SQUARE_TOKEN_KEY: 'ab'.repeat(32), SQUARE_ENVIRONMENT: 'sandbox' }, {
    directory, fetcher: async (url) => {
      calls++;
      return { ok: true, json: async () => url.endsWith('/token') ? { access_token: 'private-access', refresh_token: 'private-refresh', merchant_id: 'seller', expires_at: '2099-01-01T00:00:00Z' } : { merchant: { id: 'seller', business_name: 'Salon' } } };
    },
  });
  async function request(path, method = 'GET', cookie = '', overrides = {}) {
    const headers = {};
    const res = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(body) { this.body = body; } };
    await middleware({ url: `/api/square/${path}`, method, headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', cookie, ...overrides }, socket: { remoteAddress: '127.0.0.1' } }, res, () => assert.fail('unexpected fallthrough'));
    return { ...res, headers };
  }
  try {
    assert.equal((await request('status')).statusCode, 401);
    assert.equal((await request('session', 'POST', '', { origin: 'https://evil.test' })).statusCode, 403);
    assert.equal((await request('session', 'POST', '', { host: 'evil.test' })).statusCode, 403);
    const session = await request('session', 'POST');
    const cookie = session.headers['Set-Cookie'].split(';')[0];
    assert.match(session.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
    assert.equal(JSON.parse((await request('status', 'GET', cookie)).body).connected, false);
    const connect = await request('connect', 'POST', cookie);
    const url = new URL(JSON.parse(connect.body).url);
    assert.equal(url.searchParams.get('scope'), 'MERCHANT_PROFILE_READ APPOINTMENTS_READ APPOINTMENTS_ALL_READ ITEMS_READ');
    const state = url.searchParams.get('state');
    assert.equal((await request(`callback?code=abc&state=${state}`, 'GET')).statusCode, 401);
    const callback = await request(`callback?code=abc&state=${state}`, 'GET', cookie);
    assert.equal(callback.headers.Location, '/?square=connected');
    const encrypted = await readFile(join(directory, 'sandbox.enc'));
    assert.equal(encrypted.includes(Buffer.from('private-access')), false);
    const status = await request('status', 'GET', cookie);
    assert.equal(JSON.parse(status.body).connected, true);
    assert.equal(status.body.includes('private-'), false);
    assert.equal((await request(`callback?code=abc&state=${state}`, 'GET', cookie)).headers.Location, '/?square=invalid-state');
    assert.equal(calls, 2);
    const retry = new URL(JSON.parse((await request('connect', 'POST', cookie)).body).url).searchParams.get('state');
    assert.equal((await request(`callback?error=access_denied&state=${retry}`, 'GET', cookie)).headers.Location, '/?square=declined');
    assert.equal(calls, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
