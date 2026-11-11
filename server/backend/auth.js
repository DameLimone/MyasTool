import { createClerkClient } from '@clerk/backend';
import { ApiError } from './errors.js';

function authorizedParties(env) {
  const values = (env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!values.length) {
    throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'App sign-in is not configured.');
  }

  for (const value of values) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'App sign-in configuration is invalid.');
    }
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.origin !== value || url.username || url.password) {
      throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'App sign-in configuration is invalid.');
    }
  }
  return values;
}

function requestUrl(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' && forwardedHost.split(',')[0].trim())
    || req.headers.host
    || '127.0.0.1:5173';
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim())
    || (host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https');
  return new URL(req.url || '/', `${protocol}://${host}`).toString();
}

export async function authenticateClerkRequest(req, env = process.env, clientFactory = createClerkClient) {
  const publishableKey = env.CLERK_PUBLISHABLE_KEY || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!env.CLERK_SECRET_KEY || !publishableKey) {
    throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'App sign-in is not configured.');
  }
  const parties = authorizedParties(env);
  const authorization = req.headers.authorization;
  const token = typeof authorization === 'string' && authorization.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (typeof req.headers.origin === 'string') headers.set('Origin', req.headers.origin);
  const request = new Request(requestUrl(req), { method: req.method || 'GET', headers });
  let state;
  try {
    const clerk = clientFactory({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey,
    });
    state = await clerk.authenticateRequest(request, {
      acceptsToken: 'session_token',
      authorizedParties: parties,
    });
  } catch (error) {
    console.error('Clerk request verification failed.', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new ApiError(503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'Sign-in could not be verified right now.');
  }

  if (!state.isAuthenticated) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  }
  const { userId } = state.toAuth();
  if (!userId) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue.');
  return { userId };
}
