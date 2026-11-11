import { createApiHandler } from '../../server/backend/http.js';

const handle = createApiHandler({
  executeRequest: async ({ identity, repositories }) => ({
    user: { id: identity.userId },
    workspaces: await repositories.listMemberships(identity.userId),
  }),
});

export default handle;
export { handle as handleSessionRequest };
