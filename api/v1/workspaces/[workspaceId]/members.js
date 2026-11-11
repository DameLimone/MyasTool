import { createApiHandler,workspaceIdFromRequest,readJsonBody } from '../../../../server/backend/http.js';
import { manageWorkspaceAccess } from '../../../../server/backend/workspace-access.js';

export default createApiHandler({method:['GET','POST'],executeRequest:async({req,identity,repositories,transaction})=>manageWorkspaceAccess({
  transaction,repositories,identity,workspaceId:workspaceIdFromRequest(req),method:req.method,
  input:req.method==='POST'?await readJsonBody(req):undefined,
})});
