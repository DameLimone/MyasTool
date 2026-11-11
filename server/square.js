import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readAppointments, SQUARE_SCOPES } from './appointments.js';

const random = () => randomBytes(32).toString('base64url');
const origin = 'http://127.0.0.1:5173';
export function squareMiddleware(env, { fetcher = fetch, directory = resolve('.square-private') } = {}) {
  const sessions = new Map();
  const base = env.SQUARE_ENVIRONMENT === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  const configured = Boolean(env.SQUARE_APPLICATION_ID && env.SQUARE_APPLICATION_SECRET && /^[a-f0-9]{64}$/i.test(env.SQUARE_TOKEN_KEY || '') && ['sandbox', 'production'].includes(env.SQUARE_ENVIRONMENT));
  const redirect = `${origin}/api/square/callback`;
  const file = resolve(directory, `${env.SQUARE_ENVIRONMENT || 'sandbox'}.enc`);
  async function save(tokens) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(env.SQUARE_TOKEN_KEY, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
    await writeFile(`${file}.tmp`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  async function load() {
    let data;
    try { data = await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(env.SQUARE_TOKEN_KEY, 'hex'), data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    const token = JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
    if (token.application !== env.SQUARE_APPLICATION_ID) throw new Error('Application changed');
    return token;
  }
  async function square(path, body, token) {
    const response = await fetcher(`${base}${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'Square-Version': '2026-09-16', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Square request failed');
    return response.json();
  }
  return async (req, res, next) => {
    if (!req.url.startsWith('/api/square/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    const back = (result) => { res.statusCode = 303; res.setHeader('Location', `/?square=${result}`); res.end(); };
    // Local OS account is the trust boundary until the app gains real user authentication.
    if (req.headers.host !== '127.0.0.1:5173' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return json(403, { error: 'Square is available only on this computer.' });
    const url = new URL(req.url, origin);
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)mya_square=([A-Za-z0-9_-]+)/)?.[1];
    for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
    let session = sessions.get(cookie);
    if (req.method === 'POST' && req.headers.origin !== origin) return json(403, { error: 'Open the local workspace to connect Square.' });
    if (url.pathname === '/api/square/session' && req.method === 'POST') {
      if (!session) {
        const id = random(); session = { expires: Date.now() + 8 * 60 * 60 * 1000 }; sessions.set(id, session);
        res.setHeader('Set-Cookie', `mya_square=${id}; HttpOnly; SameSite=Lax; Path=/api/square; Max-Age=28800`);
      }
      return json(200, { configured });
    }
    if (!session) return json(401, { error: 'Reopen the workspace and try again.' });
    if (!configured) return json(503, { error: 'Square setup is required. See SQUARE-SETUP.md.' });
    try {
      if (url.pathname === '/api/square/connect' && req.method === 'POST') {
        session.state = random(); session.stateExpires = Date.now() + 10 * 60 * 1000;
        const authorize = new URL(`${base}/oauth2/authorize`);
        authorize.search = new URLSearchParams({ client_id: env.SQUARE_APPLICATION_ID, scope: SQUARE_SCOPES.join(' '), state: session.state, redirect_uri: redirect, session: env.SQUARE_ENVIRONMENT === 'sandbox' ? 'true' : 'false' }).toString();
        return json(200, { url: authorize.toString() });
      }
      if (url.pathname === '/api/square/callback' && req.method === 'GET') {
        const valid = session.state && session.state === url.searchParams.get('state') && session.stateExpires > Date.now();
        delete session.state;
        if (!valid) return back('invalid-state');
        if (url.searchParams.has('error')) return back('declined');
        const code = url.searchParams.get('code');
        if (!code) return back('missing-code');
        const tokens = await square('/oauth2/token', { client_id: env.SQUARE_APPLICATION_ID, client_secret: env.SQUARE_APPLICATION_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirect });
        if (!tokens.access_token || !tokens.refresh_token || !tokens.merchant_id || !Number.isFinite(Date.parse(tokens.expires_at))) throw new Error('Invalid tokens');
        const previous = await load();
        if (previous && previous.merchant_id !== tokens.merchant_id) return back('wrong-seller');
        await save({ ...tokens, application: env.SQUARE_APPLICATION_ID });
        return back('connected');
      }
      if (['/api/square/status', '/api/square/appointments'].includes(url.pathname) && req.method === 'GET') {
        const tokens = await load();
        if (url.pathname.endsWith('/appointments')) {
          if (!tokens || Date.parse(tokens.expires_at) <= Date.now()) return json(401, { code: 'SQUARE_CONNECTION_REQUIRED', error: 'Reconnect Square to see appointments.' });
          const result = await readAppointments({ square, accessToken: tokens.access_token, merchantId: tokens.merchant_id, applicationId: env.SQUARE_APPLICATION_ID, query: url.searchParams, now: Date.now() });
          return json(result.status, result.data);
        }
        if (!tokens) return json(200, { connected: false, environment: env.SQUARE_ENVIRONMENT });
        if (Date.parse(tokens.expires_at) <= Date.now()) return json(200, { connected: false, reconnect: true, environment: env.SQUARE_ENVIRONMENT });
        const data = await square(`/v2/merchants/${encodeURIComponent(tokens.merchant_id)}`, null, tokens.access_token);
        if (data.merchant?.id !== tokens.merchant_id) throw new Error('Merchant mismatch');
        return json(200, { connected: true, merchant: data.merchant.business_name || 'Square seller', merchantId: tokens.merchant_id, environment: env.SQUARE_ENVIRONMENT, expiresAt: tokens.expires_at });
      }
      return json(404, { error: 'Unknown Square endpoint.' });
    } catch {
      if (url.pathname.endsWith('/callback')) return back('failed');
      return json(502, { error: 'Unable to verify Square. Check your connection and server configuration, or reconnect.' });
    }
  };
}
