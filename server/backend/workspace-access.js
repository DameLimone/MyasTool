import { ApiError } from './errors.js';
import { execute, resultRows } from './query.js';

export async function manageWorkspaceAccess({transaction,repositories,identity,workspaceId,method,input}) {
  const workspace=await repositories.getWorkspaceMembership(identity.userId,workspaceId);
  if(!workspace)throw new ApiError(404,'WORKSPACE_NOT_FOUND','Workspace was not found.');
  if(workspace.role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','Only the workspace owner can approve or revoke access.');
  await execute(transaction,'SELECT id FROM public.organizations WHERE id=$1 FOR UPDATE',[workspaceId]);
  const current=await repositories.getWorkspaceMembership(identity.userId,workspaceId);
  if(current?.role!=='owner')throw new ApiError(403,'OWNER_REQUIRED','Owner access is required.');
  await execute(transaction,"SELECT set_config('mya.organization_id',$1,true),set_config('mya.membership_admin','true',true)",[workspaceId]);
  const list=async()=>({members:resultRows(await execute(transaction,`SELECT user_id AS "userId",role,revoked_at AS "revokedAt" FROM public.organization_memberships WHERE organization_id=$1 ORDER BY created_at,user_id`,[workspaceId]))});
  if(method==='GET')return list();
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['userId','action','role'].includes(k))
    ||typeof input.userId!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(input.userId)||!['approve','revoke'].includes(input.action)
    ||(input.action==='approve'&&!['admin','member'].includes(input.role)))throw new ApiError(400,'INVALID_ACCESS_CHANGE','Provide a registered user ID, approve/revoke action, and member/admin role for approval.');
  const target=resultRows(await execute(transaction,'SELECT role FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',[workspaceId,input.userId]))[0];
  if(target?.role==='owner'||input.userId===identity.userId)throw new ApiError(409,'OWNER_CHANGE_NOT_ALLOWED','Owner access cannot be changed through this operation.');
  if(input.action==='approve') {
    try {
      await execute(transaction,`INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role,revoked_at=NULL`,[workspaceId,input.userId,input.role]);
    }catch(error){if(error.code==='23503')throw new ApiError(400,'USER_NOT_REGISTERED','The person must sign in once before their user ID can be approved.');throw error;}
  }else{
    if(!target)throw new ApiError(404,'MEMBER_NOT_FOUND','Member was not found.');
    await execute(transaction,'UPDATE public.organization_memberships SET revoked_at=now() WHERE organization_id=$1 AND user_id=$2',[workspaceId,input.userId]);
  }
  await execute(transaction,`INSERT INTO scheduling.audit_events(organization_id,actor_user_id,event_type,metadata) VALUES($1,$2,$3,$4::jsonb)`,[workspaceId,identity.userId,`workspace.access_${input.action==='approve'?'approved':'revoked'}`,JSON.stringify({userId:input.userId,...(input.action==='approve'?{role:input.role}:{})})]);
  return list();
}
