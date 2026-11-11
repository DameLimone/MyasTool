import sessionHandler from '../../api/v1/session.js';
import capabilitiesHandler from '../../api/v1/workspaces/[workspaceId]/capabilities.js';
import schedulingSettingsHandler from '../../api/v1/workspaces/[workspaceId]/scheduling-settings.js';
import membersHandler from '../../api/v1/workspaces/[workspaceId]/members.js';
import clientConfig from '../../api/v1/client-config.js';
import { randomUUID } from 'node:crypto';

function notFound(res) {
  const requestId = randomUUID();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 404;
  return res.end(JSON.stringify({
    error: { code: 'NOT_FOUND', message: 'API route was not found.', requestId },
  }));
}

export function backendMiddleware(env) {
  return (req, res, next) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if(path==='/api/v1/client-config')return clientConfig(req,res,{env});
    if (path === '/api/v1/session') {
      return sessionHandler(req, res, { env });
    }
    const workspaceMatch = path.match(/^\/api\/v1\/workspaces\/([^/]+)\/(capabilities|scheduling-settings|members)$/);
    if (workspaceMatch) {
      req.query = { ...req.query, workspaceId: workspaceMatch[1] };
      return ({'scheduling-settings':schedulingSettingsHandler,members:membersHandler,capabilities:capabilitiesHandler}[workspaceMatch[2]])(req, res, { env });
    }
    if (path.startsWith('/api/v1/')) {
      return notFound(res);
    }
    return next();
  };
}
