import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapVerifiedOwner} from './owner-bootstrap.js';
import clientConfig from '../../api/v1/client-config.js';

test('owner bootstrap requires a provider-verified matching email',async()=>{
  for(const scenario of [{email:'dambienb@gmail.com',status:'unverified',allowed:false},{email:'mytykremin@gmail.com',status:'verified',allowed:false},{email:'someone@example.test',status:'verified',allowed:false},{email:'dambienb@gmail.com',status:'verified',allowed:true}]){
    const calls=[];
    await bootstrapVerifiedOwner({identity:{userId:'user_candidate'},env:{INITIAL_OWNER_EMAIL:'dambienb@gmail.com',CLERK_SECRET_KEY:'server-secret',CLERK_PUBLISHABLE_KEY:'public-key'},transaction:{unsafe:async(sql,params)=>{calls.push({sql,params});return [];}}},()=>({users:{getUser:async id=>{assert.equal(id,'user_candidate');return {emailAddresses:[{emailAddress:scenario.email,verification:{status:scenario.status}}]};}}}));
    assert.equal(calls.length,scenario.allowed?1:0);
    if(scenario.allowed)assert.deepEqual(calls[0].params,['user_candidate','dambienb@gmail.com']);
  }
});

test('browser config exposes only the publishable key and readiness, never secrets',()=>{
  let body;const res={setHeader(){},end(s){body=JSON.parse(s);}};
  clientConfig({method:'GET'},res,{env:{NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_test_public',CLERK_SECRET_KEY:'do-not-expose',CLERK_AUTHORIZED_PARTIES:'https://tool.test',POSTGRES_URL:'do-not-expose-database'}});
  assert.deepEqual(body.data,{ready:true,clerkPublishableKey:'pk_test_public',storageReady:true});
  assert.equal(JSON.stringify(body).includes('do-not-expose'),false);
});
