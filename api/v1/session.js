import { createApiHandler } from '../../server/backend/http.js';
import { bootstrapVerifiedOwner } from '../../server/backend/owner-bootstrap.js';

const handle = createApiHandler({
  executeRequest: async context => {
    const {identity,repositories}=context;
    let workspaces=await repositories.listMemberships(identity.userId);
    if(!workspaces.length){await bootstrapVerifiedOwner(context);workspaces=await repositories.listMemberships(identity.userId);}
    return {user:{id:identity.userId},workspaces};
  },
});

export default handle;
export { handle as handleSessionRequest };
