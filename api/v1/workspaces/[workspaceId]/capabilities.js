import { ApiError } from '../../../../server/backend/errors.js';
import { createApiHandler, workspaceIdFromRequest } from '../../../../server/backend/http.js';

const handle = createApiHandler({
  executeRequest: async ({ identity, repositories, req }) => {
    const workspaceId = workspaceIdFromRequest(req);
    const workspace = await repositories.getWorkspaceMembership(identity.userId, workspaceId);
    if (!workspace) {
      throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'Workspace was not found.');
    }
    return {
      workspace,
      modules: {},
      capabilities: [],
    };
  },
});

export default handle;
export { handle as handleWorkspaceCapabilitiesRequest };
