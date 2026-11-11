import './style.css';
import {initializeIdentity,privateFetch,setApprovedSession} from './auth-session.js';
const app=document.querySelector('#app');
const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let identity,started=false,checking=false,signInMounted=false;
function cover(title,message,signIn=false){
  if(signIn&&signInMounted)return;
  signInMounted=signIn;
  document.querySelector('#modal-root').innerHTML='';document.querySelector('#toast').textContent='';
  app.innerHTML=`<main class="access-screen"><section class="access-card"><span class="access-brand">mya</span><p class="eyebrow">PRIVATE BUSINESS WORKSPACE</p><h1>${escape(title)}</h1><p role="status">${escape(message)}</p>${signIn?'<div id="owner-sign-in"></div>':identity?.session?'<button class="button secondary" id="access-check">Check access</button><button class="button secondary" id="access-sign-out">Sign out</button>':'<button class="button secondary" id="access-retry">Try again</button>'}</section></main>`;
  document.querySelector('#access-check')?.addEventListener('click',checkAccess);
  document.querySelector('#access-retry')?.addEventListener('click',()=>location.reload());
  document.querySelector('#access-sign-out')?.addEventListener('click',()=>identity.signOut());
  if(signIn)identity.mountSignIn(document.querySelector('#owner-sign-in'));
}
async function checkAccess(){
  if(checking)return;checking=true;
  try{
    if(!identity?.session){if(started){location.reload();return;}cover('Sign in to your studio','Only the owner and approved people can access this Tool.',true);return;}
    const response=await privateFetch('/api/v1/session');const body=await response.json();
    if(!response.ok)throw new Error(body.error?.message||'Your access could not be verified.');
    const workspace=body.data.workspaces.find(w=>w.slug==='mk-manikure-lounge');
    if(!workspace){
      if(started){setApprovedSession(null);location.reload();return;}
      cover('Waiting for owner approval',`You are signed in, but have not been approved for this workspace. Your user ID is ${body.data.user.id}. Share it with the owner to request access.`);return;
    }
    setApprovedSession({identity,workspace,user:body.data.user});
    if(!started){started=true;await import('./studio.js');}
  }catch(error){
    if(started){setApprovedSession(null);location.reload();return;}
    cover('Access could not be verified',error.message);
  }finally{checking=false;}
}
async function start(){
  cover('Opening your private studio','Checking secure sign-in…');
  try{
    const response=await fetch('/api/v1/client-config',{cache:'no-store'});const {data}=await response.json();
    if(!response.ok||!data?.ready){cover('Private sign-in is being set up','The workspace stays locked until secure sign-in is configured.');return;}
    identity=await initializeIdentity(data.clerkPublishableKey);
    identity.addListener(()=>checkAccess(),{skipInitialEmit:true});
    await checkAccess();
    setInterval(()=>{if(!document.hidden)checkAccess();},15000);
    window.addEventListener('focus',checkAccess);
    document.addEventListener('mya:access-denied',checkAccess);
  }catch(error){cover('Sign-in could not open',error.message);}
}
start();
