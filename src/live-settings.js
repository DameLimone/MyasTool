import {privateFetch,getApprovedSession} from './auth-session.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
let root,current,pending,draft,dirty=false,saving=false,error='',message='',members=[],inFlight=false,timer;
const scope=()=>`/api/v1/workspaces/${getApprovedSession().workspace.id}`;
async function api(path,options){const r=await privateFetch(path,options);const b=await r.json();if(!r.ok){const e=new Error(b.error?.message||'That change could not be saved.');e.code=b.error?.code;e.status=r.status;throw e;}return b.data;}
const field=(label,name,value,type='number',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}/></label>`;
function capture(){const f=root?.querySelector('#business-settings-form');if(!f)return;draft=Object.fromEntries([...f.elements].filter(e=>e.name).map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));}
function render(){
  if(!root?.isConnected||!getApprovedSession())return;
  const access=getApprovedSession();
  if(!current){root.innerHTML=`<h2>Business settings</h2><p role="status">${esc(error||'Loading your saved business settings…')}</p><button class="button secondary" data-live-reload>Try again</button>`;return;}
  root.innerHTML=`<div class="section-heading"><div><h2>Business settings</h2><p>Saved securely for ${esc(access.workspace.name)}.</p></div><button class="button secondary" data-app-signout>Sign out</button></div>
  <p class="live-sync-status" role="status">${esc(error||message||'Connected · Checks for changes every 5 seconds.')}</p>
  ${pending?'<div class="notice" role="alert"><p>Settings changed elsewhere. Your draft is preserved. Load the latest settings before saving.</p><button class="button secondary" data-live-discard>Load latest settings</button></div>':''}
  <div class="live-settings-summary"><span>Booking ${current.publicBookingEnabled?'enabled':'not enabled'}</span><span>Reminder delivery: not running yet</span><span>Revision ${current.revision}</span></div>
  ${!current.canEdit?'<p class="notice">You can view settings. Only the owner and admins can save changes.</p>':''}
  <form id="business-settings-form"><fieldset ${!current.canEdit||saving?'disabled':''}><legend>Booking rules</legend><div class="settings-fields">
  ${field('Salon timezone','timezone',current.timezone,'text','required')}
  ${field('Minimum booking notice (hours)','noticeHours',current.minimumNoticeMinutes/60,'number','min="0" max="720" step="0.25" required')}
  ${field('Booking horizon','horizon',current.bookingHorizon.value,'number','min="1" max="365" required')}
  <label>Horizon unit<select name="horizonUnit"><option value="months" ${current.bookingHorizon.unit==='months'?'selected':''}>Calendar months</option><option value="days" ${current.bookingHorizon.unit==='days'?'selected':''}>Days</option></select></label>
  ${field('Buffer before (minutes)','bufferBefore',current.buffers.beforeMinutes,'number','min="0" max="180" required')}
  ${field('Buffer after (minutes)','bufferAfter',current.buffers.afterMinutes,'number','min="0" max="180" required')}
  ${field('Slot interval (minutes)','slotMinutes',current.slotIntervalMinutes,'number','min="5" max="60" required')}
  ${field('Slot hold (minutes)','holdMinutes',current.holdMinutes,'number','min="1" max="15" required')}
  </div><h3>Weekly hours</h3><p>Use 10:00-17:00. Leave a day blank for closed. Separate split shifts with a comma.</p><div class="settings-fields">${days.map((day,i)=>field(`${day} hours`,`hours-${i}`,current.weeklyHours.filter(p=>p.weekday===i).map(p=>`${p.start}-${p.end}`).join(', '),'text','placeholder="Closed"')).join('')}</div>
  <h3>Required customer details</h3><div class="settings-checks">${[['firstName','First name'],['lastName','Last name'],['phone','Phone number'],['email','Email']].map(([name,label])=>`<label><input type="checkbox" name="contact-${name}" ${current.requiredContactFields.includes(name)?'checked':''}/>${label}</label>`).join('')}</div>
  <h3>Cancellation and late-arrival policy</h3><p>Blank notice or fee means not decided. Zero means no restriction or no fee. These settings do not charge fees or cancel appointments automatically.</p><label>Policy wording<textarea name="policyText" rows="4" maxlength="4000">${esc(current.cancellation.policyText)}</textarea></label><div class="settings-fields">
  ${field('Cancellation notice (hours)','cancelHours',current.cancellation.noticeMinutes===null?'':current.cancellation.noticeMinutes/60,'number','min="0" max="720" step="0.25"')}
  ${field('Cancellation fee (currency units)','cancelFee',current.cancellation.feeMinor===null?'':current.cancellation.feeMinor/100,'number','min="0" step="0.01"')}
  ${field('Fee currency','feeCurrency',current.cancellation.feeCurrency||'','text','placeholder="USD" maxlength="3"')}
  ${field('Late-arrival grace (minutes)','lateGrace',current.cancellation.lateArrivalGraceMinutes,'number','min="0" max="180" required')}
  </div><label class="settings-check"><input type="checkbox" name="cancellationConfirmed" ${current.cancellation.termsConfirmed?'checked':''}/>Cancellation notice and fee have been confirmed</label>
  <h3>Appointment reminders</h3><label class="settings-check"><input type="checkbox" name="remindersEnabled" ${current.reminders.enabled?'checked':''}/>Enable reminder preference</label>
  ${field('Minutes before the appointment (60 = one hour)','reminderOffsets',current.reminders.minutesBefore.join(', '),'text','required')}
  <p>Delivery is not active yet. Saving this preference does not send an email, text or push notification.</p>
  <div class="settings-save-bar"><button class="button primary" type="submit" ${saving||pending?'disabled':''}>${saving?'Saving…':'Save business settings'}</button><button class="button secondary" type="button" data-live-discard>Discard changes</button><span data-draft-status>${dirty?'Unsaved changes':''}</span></div>
  </fieldset></form>
  ${access.workspace.role==='owner'?`<section class="people-settings"><h3>Approved people</h3><p>People must sign in once and share their user ID before you can approve them. Signing up alone grants no access.</p><div>${members.map(m=>`<div class="member-row"><span><strong>${esc(m.role)}</strong> · ${m.revokedAt?'Revoked':'Active'}<small>${esc(m.userId)}</small></span>${m.role!=='owner'&&!m.revokedAt?`<button class="button secondary" data-member-revoke="${esc(m.userId)}">Revoke access</button>`:''}</div>`).join('')}</div><form id="approve-person-form"><div class="settings-fields">${field('Registered user ID','userId','','text','required maxlength="255"')}<label>Access level<select name="role"><option value="member">Member — view settings</option><option value="admin">Admin — edit settings</option></select></label></div><button class="button secondary" type="submit">Approve person</button></form></section>`:''}`;
  if(draft)for(const e of root.querySelectorAll('#business-settings-form [name]'))if(Object.hasOwn(draft,e.name)){if(e.type==='checkbox')e.checked=draft[e.name];else e.value=draft[e.name];}
}
function payload(){
  const f=new FormData(root.querySelector('#business-settings-form'));const val=n=>String(f.get(n)||'').trim();
  const weeklyHours=days.flatMap((_,weekday)=>val(`hours-${weekday}`).split(',').map(s=>s.trim()).filter(Boolean).map(p=>{const match=p.match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);if(!match)throw new Error('Enter hours as HH:MM-HH:MM, or leave closed days blank.');return{weekday,start:match[1],end:match[2]};}));
  return {revision:current.revision,timezone:val('timezone'),minimumNoticeMinutes:Number(val('noticeHours'))*60,bookingHorizon:{unit:val('horizonUnit'),value:Number(val('horizon'))},buffers:{beforeMinutes:Number(val('bufferBefore')),afterMinutes:Number(val('bufferAfter'))},slotIntervalMinutes:Number(val('slotMinutes')),holdMinutes:Number(val('holdMinutes')),weeklyHours,requiredContactFields:['phone','firstName','lastName','email'].filter(n=>f.has(`contact-${n}`)),cancellation:{policyText:val('policyText'),noticeMinutes:val('cancelHours')===''?null:Number(val('cancelHours'))*60,feeMinor:val('cancelFee')===''?null:Math.round(Number(val('cancelFee'))*100),feeCurrency:val('feeCurrency').toUpperCase()||null,termsConfirmed:f.has('cancellationConfirmed'),lateArrivalGraceMinutes:Number(val('lateGrace'))},reminders:{enabled:f.has('remindersEnabled'),minutesBefore:val('reminderOffsets').split(',').map(v=>Number(v.trim()))}};
}
async function refresh(){
  if(inFlight||saving||document.hidden||!getApprovedSession())return;inFlight=true;
  try{
    const latest=await api(`${scope()}/scheduling-settings`);error='';
    if(JSON.stringify(latest)!==JSON.stringify(current)){
      if(dirty){pending=latest;message='Saved settings changed elsewhere.';render();}
      else{current=latest;pending=null;message='Connected · Checks for changes every 5 seconds.';render();window.dispatchEvent(new CustomEvent('mya:settings-updated',{detail:latest}));}
    }else{const status=root?.querySelector('.live-sync-status');if(status)status.textContent='Connected · Checks for changes every 5 seconds.';}
  }catch(e){error=e.message;if(e.status===401||e.status===404)document.dispatchEvent(new Event('mya:access-denied'));if(!current)render();else{const status=root?.querySelector('.live-sync-status');if(status)status.textContent=`Updates paused: ${error}`;}}
  finally{inFlight=false;}
}
async function loadMembers(){if(getApprovedSession()?.workspace.role==='owner'){try{members=(await api(`${scope()}/members`)).members;if(!dirty)render();}catch(e){error=e.message;render();}}}
export function mountLiveSettings(node){
  if(!node)return;
  if(root!==node){root=node;render();
    root.addEventListener('input',e=>{if(e.target.closest('#business-settings-form')){dirty=true;capture();const s=root.querySelector('[data-draft-status]');if(s)s.textContent='Unsaved changes';}});
    root.addEventListener('click',async e=>{
      if(e.target.closest('[data-app-signout]')){getApprovedSession().identity.signOut();return;}
      if(e.target.closest('[data-live-discard]')){dirty=false;draft=null;if(pending){current=pending;pending=null;}error='';message='Latest saved settings loaded.';render();await refresh();}
      if(e.target.closest('[data-live-reload]'))await refresh();
      const revoke=e.target.closest('[data-member-revoke]');if(revoke){try{await api(`${scope()}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke',userId:revoke.dataset.memberRevoke})});await loadMembers();message='Access revoked.';render();}catch(err){error=err.message;render();}}
    });
    root.addEventListener('submit',async e=>{
      if(e.target.id==='approve-person-form'){e.preventDefault();const f=new FormData(e.target);try{await api(`${scope()}/members`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',userId:f.get('userId').trim(),role:f.get('role')})});await loadMembers();message='Person approved.';render();}catch(err){error=err.message;render();}return;}
      if(e.target.id!=='business-settings-form')return;e.preventDefault();if(saving||pending||!current.canEdit)return;
      let body;try{body=payload();}catch(err){error=err.message;capture();render();return;}
      capture();saving=true;error='';render();
      try{current=await api(`${scope()}/scheduling-settings`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});dirty=false;draft=null;message='Saved to the backend. Open screens pick up changes automatically.';window.dispatchEvent(new CustomEvent('mya:settings-updated',{detail:current}));}
      catch(err){error=err.message;if(err.code==='SETTINGS_CHANGED'){pending=await api(`${scope()}/scheduling-settings`).catch(()=>null);}}
      finally{saving=false;render();}
    });
  }
  refresh();loadMembers();
  if(!timer){timer=setInterval(refresh,5000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});}
}
