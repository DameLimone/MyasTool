import {authenticateClerkRequest} from './auth.js';
import {getDatabase,inUserTransaction} from './database.js';
import {ApiError} from './errors.js';
import {createHostedSquareHandler} from '../hosted-square.js';

export function createProtectedSquareHandler(env=process.env,dependencies={}){
  const database=()=>dependencies.database||getDatabase(env);
  const approval=async userId=>inUserTransaction(database(),userId,async({repositories})=>{
    const workspace=(await repositories.listMemberships(userId)).find(w=>w.slug==='mk-manikure-lounge');
    if(!workspace)throw new ApiError(403,'APPROVAL_REQUIRED','The owner must approve your access to this workspace.');
    return workspace;
  });
  const core=createHostedSquareHandler(env,{...dependencies,requireIdentity:true,validateCallbackIdentity:async userId=>{
    try{const w=await approval(userId);return ['owner','admin'].includes(w.role);}catch{return false;}
  }});
  return async(req,res)=>{
    const url=new URL(req.url,'https://myas-tool.vercel.app');
    const action=req.query?.action||url.searchParams.get('action')||url.pathname.split('/').at(-1);
    // Callback authorization is bound to an approved initiating identity in the
    // encrypted, expiring OAuth state cookie; external redirects have no bearer.
    if(action==='callback')return core(req,res);
    try{
      const identity=await (dependencies.authenticate||authenticateClerkRequest)(req,env);
      const workspace=await approval(identity.userId);
      if(action==='connect'&&!['owner','admin'].includes(workspace.role))throw new ApiError(403,'INTEGRATION_MANAGE_FORBIDDEN','Only the owner or an admin can connect Square.');
      req.myaApprovedUserId=identity.userId;
      return core(req,res);
    }catch(error){
      res.statusCode=error instanceof ApiError?error.status:503;
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      res.end(JSON.stringify({code:error instanceof ApiError?error.code:'ACCESS_VERIFICATION_UNAVAILABLE',error:error instanceof ApiError?error.message:'Access could not be verified right now.'}));
    }
  };
}
