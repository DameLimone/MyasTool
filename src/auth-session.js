let clerk;
let approved;
export function getApprovedSession(){return approved;}
export function setApprovedSession(value){approved=value;}
export async function getAppToken(){return clerk?.session?.getToken();}
export async function privateFetch(url,options={}){
  const token=await getAppToken();
  if(!token)throw new Error('Sign in to continue.');
  const headers=new Headers(options.headers||{});headers.set('Authorization',`Bearer ${token}`);headers.set('Accept','application/json');
  return fetch(url,{...options,headers,cache:'no-store'});
}
export async function initializeIdentity(key){
  if(clerk)return clerk;
  if(window.Clerk?.load){clerk=window.Clerk;await clerk.load();return clerk;}
  const {Clerk}=await import('@clerk/clerk-js');
  const domain=atob(key.split('_')[2].replace(/-/g,'+').replace(/_/g,'/')).replace(/\$$/,'');
  if(!/^[a-zA-Z0-9.-]+$/.test(domain))throw new Error('Sign-in configuration is invalid.');
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=`https://${domain}/npm/@clerk/ui@1.42.4/dist/ui.browser.js`;script.crossOrigin='anonymous';script.async=true;
    script.onload=resolve;script.onerror=()=>reject(new Error('Sign-in could not load. Check your connection.'));document.head.appendChild(script);
  });
  clerk=new Clerk(key);await clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});return clerk;
}
