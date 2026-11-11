import { randomUUID } from 'node:crypto';
import { authenticateClerkRequest } from './auth.js';
import { getDatabase, inUserTransaction } from './database.js';
import { ApiError } from './errors.js';

function setHeaders(res, requestId) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

function respond(res, status, body) {
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function respondError(res, error, requestId) {
  if (error instanceof ApiError) {
    return respond(res, error.status, {
      error: { code: error.code, message: error.message, requestId },
    });
  }
  console.error('Backend request failed.', {
    requestId,
    name: error instanceof Error ? error.name : 'UnknownError',
  });
  return respond(res, 500, {
    error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', requestId },
  });
}

const databaseConnectionCodes = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
  '08000', '08001', '08003', '08006', '57P01', '57P02', '57P03', '28P01', '28000',
]);

export function createApiHandler({ method = 'GET', executeRequest }) {
  return async function apiHandler(req, res, dependencies = {}) {
    const requestId = randomUUID();
    setHeaders(res, requestId);
    const methods = Array.isArray(method) ? method : [method];
    if (!methods.includes(req.method)) {
      res.setHeader('Allow', methods.join(', '));
      return respondError(res, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'), requestId);
    }

    try {
      const env = dependencies.env || process.env;
      const authenticate = dependencies.authenticate || authenticateClerkRequest;
      const identity = await authenticate(req, env);
      const database = dependencies.database || getDatabase(env);
      let data;
      try {
        data = await inUserTransaction(database, identity.userId, context => (
          executeRequest({ req, identity, ...context })
        ));
      } catch (error) {
        if (databaseConnectionCodes.has(error?.code)) {
          console.error('Backend database connection failed.', { requestId, code: error.code });
          throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Backend storage is unavailable.');
        }
        throw error;
      }
      return respond(res, 200, { data, meta: { requestId } });
    } catch (error) {
      return respondError(res, error, requestId);
    }
  };
}

export async function readJsonBody(req, limit = 16384) {
  if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json for settings changes.');
  }
  try {
    if (req.body !== undefined) {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > limit) throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Settings request is too large.');
      return JSON.parse(raw);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > limit) throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Settings request is too large.');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', 'Settings request must contain valid JSON.');
  }
}

export function workspaceIdFromRequest(req) {
  const candidate = req.query?.workspaceId ?? req.params?.workspaceId;
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, 'INVALID_WORKSPACE_ID', 'A valid workspace ID is required.');
  }
  return value;
}
