import { createApiHandler, workspaceIdFromRequest, readJsonBody } from '../../../../server/backend/http.js';
import { ApiError } from '../../../../server/backend/errors.js';
import { setSchedulingContext, getSchedulingSettings, updateSchedulingSettings } from '../../../../server/backend/scheduling-settings.js';

export default createApiHandler({
  method: ['GET','PATCH'],
  executeRequest: async ({ req, identity, repositories, transaction }) => {
    const workspace = await repositories.getWorkspaceMembership(identity.userId,workspaceIdFromRequest(req));
    if (!workspace) throw new ApiError(404,'WORKSPACE_NOT_FOUND','Workspace was not found.');
    if (req.method === 'PATCH' && !['owner','admin'].includes(workspace.role)) throw new ApiError(403,'SETTINGS_EDIT_FORBIDDEN','Only workspace owners and admins can change scheduling settings.');
    await setSchedulingContext(transaction,workspace.id);
    if (req.method === 'GET') return getSchedulingSettings(transaction,workspace);
    return updateSchedulingSettings(transaction,workspace,identity.userId,await readJsonBody(req));
  },
});
