import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readAppointments, SQUARE_SCOPES } from './appointments.js';

const SESSION = '__Host-mya-square';
const STATE = '__Host-mya-square-oauth';
const DAY = 86400;

// The encrypted, HttpOnly cookie is this browser's seller session. No shared
// global seller/token file exists, and OAuth credentials never enter client JS.
export function createHostedSquareHandler(env, { fetcher = fetch, now = Date.now } = {}) {
  // Environment variable target (Vercel Production) and Square credential
  // environment are separate: Sandbox credentials cannot authorize real sellers.
  const credentialMismatch = env.SQUARE_ENVIRONMENT === 'production'
    && [env.SQUARE_APPLICATION_ID, env.SQUARE_APPLICATION_SECRET].some(value => value?.trim().startsWith('sandbox-'));
  const origin = env.SQUARE_APP_ORIGIN || 'https://myas-tool.vercel.app';
  const base = env.SQUARE_ENVIRONMENT === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  const configured = ['sandbox', 'production'].includes(env.SQUARE_ENVIRONMENT)
    && !credentialMismatch
    && Boolean(env.SQUARE_APPLICATION_ID && env.SQUARE_APPLICATION_SECRET)
    && /^[a-f0-9]{64}$/i.test(env.SQUARE_TOKEN_KEY || '')
    && /^https:\/\/[^/]+$/.test(origin);
  const context = `${origin}:${env.SQUARE_APPLICATION_ID}:${env.SQUARE_ENVIRONMENT}`;
  const redirect = `${origin}/api/square/callback`;
  const setupError = credentialMismatch
    ? 'Live Square connection setup is incomplete. Please contact the workspace owner.'
    : 'Square connection setup is still being completed. Please try again once setup is finished.';
  function encrypt(name, value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.SQUARE_TOKEN_KEY, 'hex'), iv);
    cipher.setAAD(Buffer.from(`${name}:${context}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function read(req, name) {
    try {
      const value = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
      if (!value || value.length > 3800) return null;
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', Buffer.from(env.SQUARE_TOKEN_KEY, 'hex'), bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(`${name}:${context}`));
      cipher.setAuthTag(bytes.subarray(12, 28));
      const data = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
      return data.exp > now() ? data : null;
    } catch { return null; }
  }
  async function square(path, body, accessToken) {
    const response = await fetcher(`${base}${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2026-09-16', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const error = new Error('Square request failed');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  function validTokens(tokens) {
    return typeof tokens.access_token === 'string' && typeof tokens.refresh_token === 'string'
      && typeof tokens.merchant_id === 'string' && Date.parse(tokens.expires_at) > now();
  }
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    const cookies = [];
    const cookie = (name, value, age) => {
      if (value.length > 3800) throw new Error('Session too large');
      cookies.push(`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
      res.setHeader('Set-Cookie', cookies);
    };
    const back = (result) => { res.statusCode = 303; res.setHeader('Location', `${origin}/?square=${result}`); res.end(); };
    const requestUrl = new URL(req.url, origin);
    const action = req.query?.action || requestUrl.searchParams.get('action');
    const path = requestUrl.pathname === '/api/square' && typeof action === 'string' ? `/api/square/${action}` : requestUrl.pathname;
    const methods = { '/api/square/session': 'POST', '/api/square/connect': 'POST', '/api/square/status': 'GET', '/api/square/callback': 'GET', '/api/square/appointments': 'GET' };
    if (!methods[path]) return json(404, { error: 'Unknown Square endpoint.' });
    if (req.method !== methods[path]) { res.setHeader('Allow', methods[path]); return json(405, { error: 'Method not allowed.' }); }
    if (req.method === 'POST' && req.headers.origin !== origin) return json(403, { error: 'Open the Tool to connect Square.' });
    if (path === '/api/square/session') return json(200, {
      configured: Boolean(configured), environment: env.SQUARE_ENVIRONMENT,
      ...(!configured ? { error: setupError } : {}),
    });
    if (!configured) return json(503, { error: setupError });
    const session = read(req, SESSION);
    try {
      if (path === '/api/square/connect') {
        const state = randomBytes(32).toString('base64url');
        cookie(STATE, encrypt(STATE, { state, merchant: session?.merchant_id || null, exp: now() + 600000 }), 600);
        const authorize = new URL(`${base}/oauth2/authorize`);
        authorize.search = new URLSearchParams({ client_id: env.SQUARE_APPLICATION_ID, scope: SQUARE_SCOPES.join(' '), state, redirect_uri: redirect, session: env.SQUARE_ENVIRONMENT === 'sandbox' ? 'true' : 'false' }).toString();
        return json(200, { url: authorize.toString() });
      }
      if (path === '/api/square/callback') {
        const pending = read(req, STATE);
        cookie(STATE, '', 0);
        const url = new URL(req.url, origin);
        const state = url.searchParams.get('state') || '';
        if (!pending || !/^[A-Za-z0-9_-]{43}$/.test(state) || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) return back('invalid-state');
        if (url.searchParams.has('error')) return back('declined');
        const code = url.searchParams.get('code');
        if (!code) return back('missing-code');
        const tokens = await square('/oauth2/token', { client_id: env.SQUARE_APPLICATION_ID, client_secret: env.SQUARE_APPLICATION_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirect });
        if (!validTokens(tokens)) throw new Error('Invalid token response');
        if (pending.merchant && tokens.merchant_id !== pending.merchant) return back('wrong-seller');
        const data = await square(`/v2/merchants/${encodeURIComponent(tokens.merchant_id)}`, null, tokens.access_token);
        if (data.merchant?.id !== tokens.merchant_id) throw new Error('Merchant mismatch');
        cookie(SESSION, encrypt(SESSION, { access_token: tokens.access_token, refresh_token: tokens.refresh_token, merchant_id: tokens.merchant_id, expires_at: tokens.expires_at, exp: now() + 30 * DAY * 1000 }), 30 * DAY);
        return back('connected');
      }
      if (!session) return path.endsWith('/appointments')
        ? json(401, { code: 'SQUARE_CONNECTION_REQUIRED', error: 'Connect Square in this browser to see appointments.' })
        : json(200, { connected: false, environment: env.SQUARE_ENVIRONMENT });
      let tokens = session;
      if (Date.parse(tokens.expires_at) < now() + DAY * 1000) {
        tokens = await square('/oauth2/token', { client_id: env.SQUARE_APPLICATION_ID, client_secret: env.SQUARE_APPLICATION_SECRET, grant_type: 'refresh_token', refresh_token: session.refresh_token });
        if (!validTokens(tokens) || tokens.merchant_id !== session.merchant_id) throw new Error('Invalid refresh response');
        cookie(SESSION, encrypt(SESSION, { access_token: tokens.access_token, refresh_token: tokens.refresh_token, merchant_id: tokens.merchant_id, expires_at: tokens.expires_at, exp: now() + 30 * DAY * 1000 }), 30 * DAY);
      }
      if (path === '/api/square/appointments') {
        const result = await readAppointments({ square, accessToken: tokens.access_token, merchantId: tokens.merchant_id, applicationId: env.SQUARE_APPLICATION_ID, query: requestUrl.searchParams, now: now() });
        return json(result.status, result.data);
      }
      const data = await square(`/v2/merchants/${encodeURIComponent(tokens.merchant_id)}`, null, tokens.access_token);
      if (data.merchant?.id !== tokens.merchant_id) throw new Error('Merchant mismatch');
      return json(200, { connected: true, merchant: data.merchant.business_name || 'Square seller', merchantId: tokens.merchant_id, environment: env.SQUARE_ENVIRONMENT, expiresAt: tokens.expires_at });
    } catch (error) {
      // Never return Square's response bodies, codes, or credentials to the browser.
      if (path === '/api/square/callback') return back('failed');
      if (path === '/api/square/appointments' && error.status === 403) return json(403, { code: 'SQUARE_APPOINTMENTS_UNAVAILABLE', error: 'Square did not allow appointment access. Check the account’s Appointments access and subscription, or reconnect to update permissions.' });
      if ([400, 401, 403].includes(error.status)) {
        cookie(SESSION, '', 0);
        if (path === '/api/square/appointments') return json(401, { code: 'SQUARE_CONNECTION_REQUIRED', error: 'Your Square authorization needs to be renewed. Reconnect Square to continue.' });
        return json(200, { connected: false, reconnect: true, environment: env.SQUARE_ENVIRONMENT });
      }
      return json(502, { error: path.endsWith('/appointments') ? 'Appointments could not be loaded from Square. Please try again.' : 'Unable to verify Square right now. Please try again.' });
    }
  };
}
