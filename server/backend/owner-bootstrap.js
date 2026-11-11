import {createClerkClient} from '@clerk/backend';
import {execute} from './query.js';

export async function bootstrapVerifiedOwner({identity,transaction,env},clientFactory=createClerkClient) {
  if(!env.INITIAL_OWNER_EMAIL||!env.CLERK_SECRET_KEY)return;
  const clerk=clientFactory({secretKey:env.CLERK_SECRET_KEY,publishableKey:env.CLERK_PUBLISHABLE_KEY||env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY});
  const user=await clerk.users.getUser(identity.userId);
  const expected=env.INITIAL_OWNER_EMAIL.trim().toLowerCase();
  const verified=user.emailAddresses?.find(e=>e.emailAddress?.trim().toLowerCase()===expected&&e.verification?.status==='verified');
  if(verified)await execute(transaction,'SELECT scheduling.bootstrap_verified_owner($1,$2)',[identity.userId,verified.emailAddress.trim().toLowerCase()]);
}
