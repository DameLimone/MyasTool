import './style.css';
import { platforms, statusNames, seedState, localDate, validatePost, captionFor } from './model.js';
import { openStore, loadState, saveState } from './store.js';
import {privateFetch,getApprovedSession} from './auth-session.js';
import {mountLiveSettings} from './live-settings.js';
import {calendarWindow,renderBusinessCalendar} from './business-calendar.js';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  edit: '<path d="m14 4 6 6M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.01"/>',
  spark: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const app = document.querySelector('#app');
let state, db;
let squareStatus = { error: 'Checking Square connection…' };
let squareBusy = false;
let appointmentState = { loading: false, data: null, error: null, code: null };
let appointmentRange = 'today';
let appointmentLocation = '';
let appointmentRequest = 0;
let view = 'overview';
let filter = 'all';
let search = '';
let calendarDate = new Date();
let calendarSelectedDate = localDate();
let calendarAppointmentState = {loading:false,data:null,error:null,code:null};
let calendarAppointmentRequest = 0;
const urls = new Map();
let activePost;
let previewPlatform = 'Instagram';
let previousFocus;
let saving = false;
let helpOrigin = 'overview';

function mediaUrl(media) {
  if (!media) return '';
  if (media.blob && !urls.has(media.id)) urls.set(media.id, URL.createObjectURL(media.blob));
  return urls.get(media.id) || media.url;
}
function mediaMarkup(media, cls = '', controls = false) {
  if (!media) return `<div class="no-media ${cls}">${icon('image')}<span>A beautiful idea starts here</span></div>`;
  const url = esc(mediaUrl(media));
  return media.type.startsWith('video/') ? `<video class="${cls}" src="${url}" ${controls ? 'controls' : 'muted preload="metadata"'} playsinline aria-label="${esc(media.name)}"></video>` : `<img class="${cls}" src="${url}" alt="${esc(media.name)}" />`;
}
const mediaFor = (post) => state.media.find((media) => media.id === post.mediaId);
const badge = (post) => `<span class="badge ${post.status}"><i></i>${statusNames[post.status]}</span>`;
function dateLabel(value, options = {}) {
  return value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...options }) : 'No date yet';
}
function notify(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => { toast.className = ''; }, 5000);
}
async function persist(next) {
  await saveState(db, next);
  state = next;
}
function upcomingPosts() {
  return state.posts.filter((post) => post.status === 'planned').sort((a, b) => a.date.localeCompare(b.date));
}
function platformTag(platform) {
  return `<span class="platform-tag">${platform === 'Instagram' ? icon('instagram') : `<b>${platform === 'TikTok' ? '♪' : 'f'}</b>`}${esc(platform)}</span>`;
}
function postCard(post) {
  return `<button class="post-card" data-edit="${esc(post.id)}">
    <div class="post-photo">${mediaMarkup(mediaFor(post))}<div class="photo-badges">${badge(post)}${post.sample ? '<span class="sample-badge">Sample</span>' : ''}</div>
    <span class="photo-action">${icon('edit')}</span></div>
    <div class="post-body"><div class="post-meta">${post.platforms.map(platformTag).join('')}<span class="dots">···</span></div>
    <h3>${esc(post.title)}</h3><p>${esc(post.caption)}</p>
    <div class="post-footer"><span>${icon(post.status === 'draft' ? 'edit' : 'calendar')}${post.status === 'published' ? 'Publication confirmed' : dateLabel(post.date, { hour: 'numeric', minute: '2-digit' })}</span>${post.approval === 'pending' ? '<span class="approval-dot" title="Waiting for Mya">Awaiting approval</span>' : ''}</div></div></button>`;
}
function render() {
  if(!getApprovedSession())return;
  const titles = { overview: 'Home', appointments: 'Salon appointments', posts: 'All posts', calendar: 'Content & appointments calendar', media: 'Media library', approvals: 'Mya’s approvals', settings: 'Studio settings', help: 'Help me navigate' };
  app.innerHTML = `<aside class="sidebar">
    <a class="brand" href="#" data-view="overview"><span class="brand-mark">m<span>✧</span></span><span>mya<span class="brand-sub">CONTENT STUDIO</span></span></a>
    <div class="workspace"><span class="workspace-avatar">M</span><div>Mya’s salon<small>Workspace for you two</small></div><span class="workspace-dot"></span></div>
    <p class="nav-label">YOUR STUDIO</p><nav aria-label="Main navigation">
    ${[['overview', 'grid', 'Overview'], ['appointments', 'clock', 'Appointments'], ['posts', 'edit', 'All posts'], ['calendar', 'calendar', 'Calendar'], ['media', 'image', 'Media library'], ['approvals', 'heart', 'Approvals']].map(([key, image, title]) => `<button data-view="${key}" aria-label="${title}" class="nav-item ${view === key ? 'active' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(image)}${key === 'appointments' ? '<span class="appointment-nav-label">Appointments</span>' : title}${key === 'approvals' && state.posts.some((p) => p.approval === 'pending') ? `<span class="nav-count">${state.posts.filter((p) => p.approval === 'pending').length}</span>` : ''}</button>`).join('')}</nav>
    <div class="sidebar-bottom"><button class="nav-item ${view === 'settings' ? 'active' : ''}" data-view="settings">${icon('settings')}Studio settings</button><div class="profile"><span class="profile-avatar">M</span><div>Mya’s workspace<small>Private workspace</small></div><span class="local-dot" title="Saved in this browser"></span></div></div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumb">Your studio<span>/</span><strong>${titles[view]}</strong></div><div class="topbar-right"><button class="button secondary help-button" data-help aria-current="${view === 'help' ? 'page' : 'false'}">Help me navigate</button><span class="local-label"><i></i> Saved in this browser</span><button class="avatar-button" data-view="settings" aria-label="Studio settings">M</button></div></header>
  <main tabindex="-1">${view === 'overview' ? overview() : view === 'appointments' ? appointmentsPage() : view === 'posts' ? postsPage() : view === 'calendar' ? calendarPage() : view === 'media' ? mediaPage() : view === 'approvals' ? approvalsPage() : view === 'help' ? helpPage() : settingsPage()}</main>
  <footer class="page-footer"><span>Made for Mya, with a little extra care.</span><span>YOUR WORK. BEAUTIFULLY SHARED. ${icon('spark')}</span></footer></div>`;
  if(view==='settings')mountLiveSettings(document.querySelector('#live-business-settings'));
}
function pageHeading(eyebrow, title, description, action = `<button class="button primary" data-new>${icon('plus')}Create a post</button>`) {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${description}</p></div>${action}</div>`;
}
function overview() {
  const pending = state.posts.filter((post) => post.approval === 'pending');
  const drafts = state.posts.filter((post) => post.status === 'draft');
  return `<div class="calm-home">${pageHeading('YOUR SPACE TO TAKE A BREATH', 'Welcome back, Mya.', 'One thing at a time. Start wherever you need.')}
    ${squarePanel()}<section class="quick-actions" aria-label="Quick actions">${[
      ['data-view="appointments"', 'clock', 'Salon appointments', 'Today and the next seven days'],
      ['data-status-view="draft"', 'edit', 'Continue a draft', `${drafts.length} saved ideas`],
      ['data-view="calendar"', 'calendar', 'See my plan', 'Open the calendar'],
      ['data-view="media"', 'image', 'Add photos or videos', 'Open your media library'],
    ].map(([action, image, title, detail]) => `<button class="quick-action" ${action}>${icon(image)}<strong>${title}</strong><span>${detail}</span>${icon('arrow')}</button>`).join('')}</section>
    <section class="home-panel"><div class="section-heading"><h2>Ready for a quick look</h2><button class="text-button" data-view="approvals">Review posts ${icon('arrow')}</button></div><p>${pending.length ? `${pending.length} ${pending.length === 1 ? 'post is' : 'posts are'} waiting for Mya’s approval.` : 'No posts waiting for approval.'}</p>${pending.some((post) => post.sample) ? '<small>Includes sample content for trying things out.</small>' : ''}</section>
    <section class="home-panel"><div class="section-heading"><h2>Your next plans</h2><button class="text-button" data-view="calendar">See calendar ${icon('arrow')}</button></div><div class="home-plans">${upcomingPosts().slice(0, 3).map((post) => `<button class="home-plan" data-edit="${esc(post.id)}"><span class="plan-symbol">${icon('calendar')}</span><span class="plan-summary"><strong>${esc(post.title)}</strong><span>${dateLabel(post.date, { hour: 'numeric', minute: '2-digit' })}${post.sample ? ' · Sample' : ''}</span></span>${badge(post)}${icon('chevron')}</button>`).join('') || '<p>Nothing planned yet. Your calendar is here when you need it.</p>'}</div><p class="home-footnote">Planned means a reminder, not automatic publishing.</p></section>
    <section class="stats" aria-label="Content overview">${[['draft', 'edit', 'Drafts', 'Not shared yet'], ['planned', 'calendar', 'Planned posts', 'On your calendar'], ['published', 'check', 'Confirmed published', 'Checked and live']].map(([status, image, title, text]) => `<button class="stat-card" data-status-view="${status}"><span class="stat-icon ${status}">${icon(image)}</span><div><span class="stat-label">${title}</span><strong>${state.posts.filter((p) => p.status === status).length}</strong><small>${text}</small></div></button>`).join('')}</section>
    <p class="home-storage-note">Prototype for you and Mya, not a customer page. Work saves in this browser only.</p></div>`;
}
function helpPage() {
  const steps = [
    ['media', 'image', 'Add photos or videos', 'Open Media library, then Upload media. Set client permission before sharing.'],
    ['posts', 'edit', 'Write or finish a post', 'Open All posts to edit an idea, or Create a post to start one. Save as a draft whenever you like.'],
    ['calendar', 'calendar', 'Plan a social post', 'Open the social content calendar and tap a date to plan a post. Open Appointments for Mya’s Square schedule.'],
    ['approvals', 'heart', 'Give a post one last look', 'Open Approvals, select a post, and update Mya’s review in the editor.'],
  ];
  return `<div class="help-page">${pageHeading('NO NEED TO LEARN EVERYTHING AT ONCE', 'What would you like to do?', 'Choose a task. We’ll take you to the right place.', `<button class="button secondary" data-help-back>Back to where I was</button>`)}
    <div class="help-grid">${steps.map(([destination, image, title, text]) => `<section class="help-card">${icon(image)}<h2>${title}</h2><p>${text}</p><button class="button secondary" data-view="${destination}">Take me there ${icon('arrow')}</button></section>`).join('')}</div>
    <section class="home-panel help-basics"><h2>Three simple stages</h2><dl><div><dt>Draft</dt><dd>A saved idea. Nothing is shared.</dd></div><div><dt>Planned</dt><dd>A date on your calendar. Nothing publishes automatically.</dd></div><div><dt>Published</dt><dd>You checked the live post and added its link.</dd></div></dl><details><summary>How do I share a finished post?</summary><p>Open the post. Use Copy caption and Download media, then publish in your social app. Come back, choose Confirmed published, and add the live link. Client permission and any requested approval must be confirmed first.</p></details><details><summary>Who can see this workspace?</summary><p>Only the owner and approved people can open this workspace. Business settings are saved securely in the backend. Content drafts and media stay in this browser and are separate for each signed-in person.</p></details></section></div>`;
}
function filterBar() {
  return `<div class="filter-bar" role="group" aria-label="Filter posts">${[['all', 'All content'], ['draft', 'Drafts'], ['planned', 'Planned'], ['published', 'Published']].map(([key, label]) => `<button data-filter="${key}" class="${filter === key ? 'selected' : ''}" aria-pressed="${filter === key}">${label}${key === 'all' ? `<span>${state.posts.length}</span>` : ''}</button>`).join('')}</div>`;
}
function filteredPosts() {
  return state.posts.filter((post) => (filter === 'all' || post.status === filter) && (!search || `${post.title} ${post.caption}`.toLowerCase().includes(search.toLowerCase())));
}
function empty(title, text) {
  return `<div class="empty-state">${icon('spark')}<h3>${title}</h3><p>${text}</p></div>`;
}
function postsPage() {
  return `${pageHeading('FROM FIRST IDEA TO FINAL DETAIL', 'Your content collection', 'Draft it. Make it yours. Share it when the time is right.')}<div class="collection-toolbar">${filterBar()}<input type="search" id="post-search" placeholder="Find a post…" aria-label="Search posts" value="${esc(search)}" /></div><div class="post-grid full-grid" id="posts-grid">${filteredPosts().map(postCard).join('') || empty('No posts here just yet', 'New ideas and confirmed live posts will each have their own place.')}</div>`;
}
function calendarPage() {
  return renderBusinessCalendar({date:calendarDate,selectedDate:calendarSelectedDate,posts:state.posts,appointmentState:calendarAppointmentState});
}
async function loadCalendarAppointments() {
  const request=++calendarAppointmentRequest;
  calendarAppointmentState={loading:true,data:null,error:null,code:null};
  if(view==='calendar')render();
  try {
    const params=new URLSearchParams({range:'custom',...calendarWindow(calendarDate),...(appointmentLocation?{location:appointmentLocation}:{})});
    const response=await privateFetch(`/api/square/appointments?${params}`,{credentials:'same-origin'});
    const data=await response.json();
    if(request!==calendarAppointmentRequest)return;
    calendarAppointmentState=response.ok?{loading:false,data,error:null,code:null}:{loading:false,data:null,error:data.error||'Appointments could not be loaded.',code:data.code};
    if(response.ok)appointmentLocation=data.location?.id||'';
  }catch {if(request!==calendarAppointmentRequest)return;calendarAppointmentState={loading:false,data:null,error:'Cannot reach Square appointments. Try refreshing.',code:null};}
  if(view==='calendar')render();
}

function approvalsPage() {
  const pending = state.posts.filter((post) => post.approval === 'pending');
  return `${pageHeading('ONE LAST LOVING LOOK', 'Ready for Mya’s eye', 'Review the caption and preview, then approve when every detail feels right.')}<p class="page-note">Content reviews stay in this browser. Notifications and shared review history are not connected yet.</p><div class="post-grid full-grid">${pending.map(postCard).join('') || empty('All caught up, beautifully', 'Posts that need a review will appear here.')}</div>`;
}
function squarePanel() {
  const s = squareStatus;
  return `<section class="settings-panel square-panel" aria-label="Square connection"><h2>MK Manikure Lounge · Square</h2><p role="status">${esc(s.error || (s.connected ? `Connected to ${s.merchant} · ${s.environment}` : s.configured === false ? 'Square connection setup is still being completed. Please try again once setup is finished.' : s.reconnect ? 'Connection expired. Sign in to Square again.' : 'Square is not connected.'))}</p><div class="square-actions"><button class="button primary" data-square-connect ${squareBusy || s.configured === false ? 'disabled' : ''}>${squareBusy ? 'Opening Square…' : s.connected ? 'Reconnect Square' : 'Connect Square'}</button><button class="button secondary" data-square-refresh>Check connection</button><a class="button secondary" href="https://book.squareup.com/appointments/suimgpl7mwpdmz/location/LY4J7GWRW6KPP/services?buttonTextColor=ffffff&amp;color=212121&amp;locale=en&amp;referrer=so" target="_blank" rel="noopener noreferrer">Open salon booking</a></div><p>Sign in on Square to connect your account in this browser. Other devices need their own connection. Booking changes, waitlist reassignment, and customer messages are not automated.</p>${s.expiresAt ? `<small>Authorization expires ${esc(dateLabel(s.expiresAt))}. The Tool renews authorization when you check the connection.</small>` : ''}</section>`;
}
function appointmentsPage() {
  const { loading, data, error, code } = appointmentState;
  const timezone = data?.location?.timezone || 'UTC';
  const format = (date, options) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...options }).format(new Date(date));
  const reconnect = ['APPOINTMENT_PERMISSION_REQUIRED', 'SQUARE_CONNECTION_REQUIRED', 'SQUARE_APPOINTMENTS_UNAVAILABLE'].includes(code);
  return `${pageHeading('YOUR SALON DAY', 'Appointments', 'Your Square schedule, with room to breathe.', '')}
    <section class="home-panel appointments-panel" aria-label="Square appointments" aria-busy="${loading}">
    <div class="appointment-controls"><div class="appointment-ranges" aria-label="Appointment date range">${[['today', 'Today'], ['week', 'Next seven days']].map(([key, label]) => `<button class="button ${appointmentRange === key ? 'primary' : 'secondary'}" data-appointment-range="${key}" aria-pressed="${appointmentRange === key}" ${loading ? 'disabled' : ''}>${label}</button>`).join('')}</div>
    ${data?.locations?.length ? `<label class="appointment-location">Location<select id="appointment-location" ${loading ? 'disabled' : ''}>${data.locations.map(l => `<option value="${esc(l.id)}" ${l.id === data.location?.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}
    <button class="button secondary" data-appointments-refresh ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Refresh appointments'}</button></div>
    <p class="page-note">Live from Square · Read-only · Canceled and declined appointments are excluded.</p>
    ${loading ? '<p role="status">Loading appointments from Square…</p>' : error ? `<div class="appointment-message" role="alert"><p>${esc(error)}</p>${reconnect ? `<p>Allow the Tool to read appointments and service names. It cannot change bookings or send messages.</p><button class="button primary" data-square-connect ${squareBusy ? 'disabled' : ''}>${squareBusy ? 'Opening Square…' : code === 'SQUARE_CONNECTION_REQUIRED' ? 'Connect Square' : 'Allow appointment access'}</button>` : ''}</div>` : data ? `
    ${data.warning ? `<p class="appointment-message" role="status">${esc(data.warning)}</p>` : ''}
    ${data.location ? `<div class="section-heading"><h2>${esc(data.location.name)}</h2><span>${esc(timezone)}</span></div><p>${data.appointments.length} ${data.appointments.length === 1 ? 'appointment' : 'appointments'} · ${esc(format(data.start, { month: 'short', day: 'numeric' }))}${appointmentRange === 'week' ? `–${esc(format(new Date(Date.parse(data.end) - 1), { month: 'short', day: 'numeric' }))}` : ''}</p>` : ''}
    <div class="appointment-list">${data.appointments.map(a => `<article class="appointment-card"><div class="appointment-time"><strong>${esc(format(a.startAt, { hour: 'numeric', minute: '2-digit' }))}</strong><span>${esc(format(a.startAt, { weekday: 'short', month: 'short', day: 'numeric' }))}</span></div><div class="appointment-service"><h3>${esc(a.services.join(' + ') || 'Service details unavailable')}</h3><p>${a.durationMinutes ? `${a.durationMinutes} min` : 'Duration unavailable'}</p></div><span class="badge neutral">${esc(({ ACCEPTED: 'Confirmed', PENDING: 'Pending', NO_SHOW: 'No-show' })[a.status] || a.status.replaceAll('_', ' ').toLowerCase())}</span></article>`).join('') || (data.location ? '<p class="appointment-empty">No appointments in this date range.</p>' : '')}</div>
    <small>Last checked ${esc(new Date(data.syncedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}. Appointment details are not saved in this browser.</small>` : ''}
    </section>`;
}
async function loadAppointments() {
  const request = ++appointmentRequest;
  const locations = appointmentState.data?.locations;
  appointmentState = { loading: true, data: locations ? { locations, location: appointmentState.data.location } : null, error: null, code: null };
  render();
  try {
    const params = new URLSearchParams({ range: appointmentRange, ...(appointmentLocation ? { location: appointmentLocation } : {}) });
    const response = await privateFetch(`/api/square/appointments?${params}`, { credentials: 'same-origin' });
    const data = await response.json();
    if (request !== appointmentRequest) return;
    if (!response.ok) appointmentState = { loading: false, data: null, error: data.error || 'Appointments could not be loaded.', code: data.code };
    else {
      appointmentLocation = data.location?.id || '';
      appointmentState = { loading: false, data, error: null, code: null };
    }
  } catch {
    if (request !== appointmentRequest) return;
    appointmentState = { loading: false, data: null, error: 'Cannot reach Square appointments. Check your connection and try again.', code: null };
  }
  if (view === 'appointments') render();
}
document.addEventListener('click', async event => {
  const range = event.target.closest('[data-appointment-range]');
  if (range) { appointmentRange = range.dataset.appointmentRange; await loadAppointments(); }
  else if (event.target.closest('[data-appointments-refresh]')) await loadAppointments();
});
document.addEventListener('change', async event => {
  if (event.target.id === 'appointment-location') { appointmentLocation = event.target.value; await loadAppointments(); }
  if(event.target.id==='calendar-location'){appointmentLocation=event.target.value;await loadCalendarAppointments();}
});
async function squareRequest(path, method = 'GET') {
  const response = await privateFetch(`/api/square/${path}`, { method, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Square is unavailable.');
  return data;
}
async function refreshSquare() {
  try {
    const session = await squareRequest('session', 'POST');
    squareStatus = session.configured ? await squareRequest('status') : session;
  } catch (error) { squareStatus = { error: error.message === 'Failed to fetch' ? 'Cannot reach the Square connection service. Please try again.' : error.message }; }
  render();
  if(squareStatus.connected){
    if(view==='appointments')await loadAppointments();
    else if(view==='calendar')await loadCalendarAppointments();
  }
}
document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-square-refresh]')) await refreshSquare();
  if (!event.target.closest('[data-square-connect]') || squareBusy) return;
  squareBusy = true; render();
  try {
    const session = await squareRequest('session', 'POST');
    if (!session.configured) throw new Error(session.error || 'Square connection setup is still being completed.');
    const data = await squareRequest('connect', 'POST');
    sessionStorage.setItem('mya-square-return-view',view==='calendar'?'calendar':'appointments');
    window.location.assign(data.url);
  } catch (error) { squareStatus = { error: error.message }; squareBusy = false; render(); }
});
function settingsPage() {
  return `${pageHeading('YOUR STUDIO CONTROLS', 'Settings', 'Business rules stay in sync with the backend.', '')}<section class="settings-panel" id="live-business-settings" aria-label="Business settings"></section>${squarePanel()}<section class="settings-panel"><h2>Saved hashtags</h2><p>Content preferences stay in this browser.</p><form id="hashtags-form"><label for="saved-hashtags">Your go-to collection</label><textarea id="saved-hashtags" rows="3">${esc(state.hashtags)}</textarea><button class="button primary" type="submit">Save hashtags</button></form></section>`;
}
function openEditor(id, mediaId, date) {
  previousFocus = document.activeElement;
  activePost = id ? structuredClone(state.posts.find((post) => post.id === id)) : { id: crypto.randomUUID(), title: '', caption: '', hashtags: '', mediaId: mediaId || '', platforms: ['Instagram'], variations: {}, status: date ? 'planned' : 'draft', date: date ? `${date}T11:00` : '', approval: 'not-required', sample: false };
  previewPlatform = activePost.platforms[0] || 'Instagram';
  renderEditor();
  document.querySelector('#post-title').focus();
}
function renderEditor() {
  const post = activePost;
  document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-heading"><header class="editor-header"><div><span class="eyebrow">A LITTLE IDEA, BEAUTIFULLY SHAPED</span><h2 id="editor-heading">${state.posts.some((p) => p.id === post.id) ? 'Make it yours' : 'Create something beautiful'}</h2></div><button class="icon-button" data-close aria-label="Close editor">${icon('close')}</button></header><form id="post-form"><div class="editor-columns"><div class="editor-fields">
    ${post.sample ? '<div class="small-notice">Sample content · Edits stay local to this prototype.</div>' : ''}
    <label for="post-title">Post title</label><input id="post-title" name="title" value="${esc(post.title)}" placeholder="A name for your next beautiful idea" required maxlength="150" />
    <label for="post-caption">Caption</label><textarea id="post-caption" name="caption" rows="4" placeholder="Tell the story behind the details…" required>${esc(post.caption)}</textarea>
    <div class="label-row"><label for="post-hashtags">Hashtags</label><button type="button" class="text-button" data-add-hashtags>+ Add saved hashtags</button></div><textarea id="post-hashtags" name="hashtags" rows="2" placeholder="#RussianManicure">${esc(post.hashtags)}</textarea>
    <label for="post-media">Photo or video</label><select id="post-media" name="mediaId"><option value="">No media yet</option>${state.media.map((media) => `<option value="${media.id}" ${post.mediaId === media.id ? 'selected' : ''}>${esc(media.name)}${media.consent !== 'approved' ? ' · Permission not approved' : ''}</option>`).join('')}</select>
    <fieldset><legend>Where would you like to share?</legend><div class="platform-choices">${platforms.map((platform) => `<label><input type="checkbox" name="platforms" value="${platform}" ${post.platforms.includes(platform) ? 'checked' : ''} />${platformTag(platform)}</label>`).join('')}</div></fieldset>
    <details class="variation-details"><summary>Make each platform feel a little different</summary>${platforms.map((platform) => `<label for="variation-${platform}">${platform} caption variation</label><textarea id="variation-${platform}" name="variation-${platform}" rows="2" placeholder="Leave blank to use the main caption">${esc(post.variations[platform] || '')}</textarea>`).join('')}</details>
    <div class="field-pair"><div><label for="post-status">Content status</label><select id="post-status" name="status">${Object.entries(statusNames).map(([key, value]) => `<option value="${key}" ${post.status === key ? 'selected' : ''}>${value === 'Published' ? 'Confirmed published' : value}</option>`).join('')}</select></div><div><label for="post-date">Planned date & time</label><input id="post-date" name="date" type="datetime-local" value="${esc(post.date)}" /></div></div>
    <label for="post-approval">Mya’s review</label><select id="post-approval" name="approval"><option value="not-required" ${post.approval === 'not-required' ? 'selected' : ''}>No review needed</option><option value="pending" ${post.approval === 'pending' ? 'selected' : ''}>Waiting for Mya’s approval</option><option value="approved" ${post.approval === 'approved' ? 'selected' : ''}>Approved by Mya (local confirmation)</option></select>
    <div id="publication-fields" ${post.status !== 'published' ? 'hidden' : ''}><label for="published-url">Live post URL</label><input id="published-url" type="url" name="publishedUrl" value="${esc(post.publishedUrl || '')}" placeholder="https://…" /><label class="confirmation"><input type="checkbox" name="confirmed" ${post.status === 'published' ? 'checked' : ''} />I checked that this post is live on the selected platform(s).</label></div>
    <p class="form-error" id="form-error" role="alert"></p></div><aside class="preview-column"><div class="preview-heading"><h3>A little preview</h3><span>Not a live post</span></div><select id="preview-platform" aria-label="Preview platform">${platforms.map((platform) => `<option ${previewPlatform === platform ? 'selected' : ''}>${platform}</option>`).join('')}</select><div id="live-preview"></div><div class="manual-panel"><h4>Your manual sharing kit</h4><p>No connected accounts yet. Copy your caption and download the media when you’re ready.</p><button class="button secondary" type="button" data-copy>Copy caption</button><button class="button secondary" type="button" data-download-editor>${icon('download')}Download media</button></div><p class="preview-note">${icon('heart')}Confirm client permission before sharing. Plans never publish automatically.</p></aside></div><footer class="editor-footer"><span>${icon('clock')}Saved only in this browser</span><div><button type="button" class="button secondary" data-close>Cancel</button><button class="button primary" type="submit">${icon('check')}Save post</button></div></footer></form></section></div>`;
  document.body.classList.add('modal-open');
  updatePreview();
}
function readEditor() {
  const form = document.querySelector('#post-form');
  const data = new FormData(form);
  return { ...activePost, title: data.get('title').trim(), caption: data.get('caption').trim(), hashtags: data.get('hashtags').trim(), mediaId: data.get('mediaId'), platforms: data.getAll('platforms'), variations: Object.fromEntries(platforms.map((platform) => [platform, data.get(`variation-${platform}`).trim()])), status: data.get('status'), date: data.get('date'), approval: data.get('approval'), publishedUrl: data.get('publishedUrl').trim() };
}
function updatePreview() {
  const post = readEditor();
  const media = mediaFor(post);
  document.querySelector('#live-preview').innerHTML = `<article class="social-preview"><div class="social-profile"><span class="profile-avatar">m</span><div>mya.studio<small>${esc(previewPlatform)} preview</small></div><span>···</span></div>${mediaMarkup(media, 'preview-media', true)}<div class="social-caption"><div class="social-icons">${icon('heart')}${icon('spark')}<span>♡</span></div><p><strong>mya.studio</strong> ${esc(captionFor(post, previewPlatform) || 'Your story starts here…')}</p></div></article>${media && media.consent !== 'approved' ? `<p class="permission-warning">${icon('heart')}${media.consent === 'declined' ? 'Client declined use. Choose different media.' : 'Client permission has not been confirmed.'}</p>` : ''}`;
}
function closeEditor() {
  if (saving) return;
  document.querySelector('#modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
  activePost = undefined;
  if (previousFocus?.isConnected) previousFocus.focus();
  else document.querySelector('[data-new]')?.focus();
}
function downloadMedia(id) {
  const media = state.media.find((item) => item.id === id);
  if (!media) return notify('Choose media for this post first.', true);
  const a = document.createElement('a');
  a.href = mediaUrl(media);
  a.download = media.blob ? media.name : media.url.split('/').pop();
  a.click();
}
async function uploadMedia(files) {
  if (!files.length) return;
  const valid = files.filter((file) => /^(image|video)\//.test(file.type) && file.size <= 50 * 1024 * 1024);
  if (valid.length !== files.length) notify('Only photos and videos up to 50 MB each can be added. Unsupported files were skipped.', true);
  if (!valid.length) return;
  await persist({ ...state, media: [...state.media, ...valid.map((file) => ({ id: crypto.randomUUID(), name: file.name, type: file.type, blob: file, consent: 'unknown', sample: false }))] });
  render();
  if (valid.length === files.length) notify(`${valid.length} ${valid.length === 1 ? 'file' : 'files'} added to your library.`);
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button, a[data-view]');
  if (!button) return;
  try {
    if (button.hasAttribute('data-help') || button.hasAttribute('data-help-back')) {
      if (button.hasAttribute('data-help-back')) view = helpOrigin;
      else { if (view !== 'help') helpOrigin = view; view = 'help'; }
      render();
      window.scrollTo({ top: 0 });
      document.querySelector('main').focus({ preventScroll: true });
    } else if (button.hasAttribute('data-view')) {
      event.preventDefault();
      view = button.dataset.view;
      filter = 'all'; search = ''; render();
      window.scrollTo({ top: 0 });
      document.querySelector('main').focus({ preventScroll: true });
      if (view === 'appointments') await loadAppointments();
      else if(view==='calendar')await loadCalendarAppointments();
    } else if (button.hasAttribute('data-new')) openEditor(null, button.dataset.media);
    else if (button.dataset.edit) openEditor(button.dataset.edit);
    else if (button.hasAttribute('data-close')) closeEditor();
    else if (button.dataset.filter) { filter = button.dataset.filter; render(); }
    else if (button.dataset.statusView) { view = 'posts'; filter = button.dataset.statusView; search = ''; render(); }
    else if (button.dataset.month) { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + Number(button.dataset.month), 1); calendarSelectedDate=localDate(calendarDate); await loadCalendarAppointments(); }
    else if (button.hasAttribute('data-today')) { calendarDate = new Date(); calendarSelectedDate=localDate(); await loadCalendarAppointments(); }
    else if(button.dataset.calendarDay){calendarSelectedDate=button.dataset.calendarDay;render();}
    else if(button.hasAttribute('data-calendar-refresh'))await loadCalendarAppointments();
    else if (button.dataset.date) openEditor(null, null, button.dataset.date);
    else if (button.hasAttribute('data-upload')) document.querySelector('#media-upload').click();
    else if (button.dataset.download) downloadMedia(button.dataset.download);
    else if (button.hasAttribute('data-download-editor')) downloadMedia(readEditor().mediaId);
    else if (button.hasAttribute('data-add-hashtags')) {
      const field = document.querySelector('#post-hashtags');
      field.value = [...new Set(`${field.value} ${state.hashtags}`.trim().split(/\s+/))].join(' ');
      updatePreview();
    } else if (button.hasAttribute('data-copy')) {
      await navigator.clipboard.writeText(captionFor(readEditor(), previewPlatform));
      notify(`${previewPlatform} caption copied.`);
    }
  } catch (error) {
    console.error(error);
    notify(`That didn’t work: ${error.message}. Your previous saved content is unchanged.`, true);
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'post-search') {
    search = event.target.value;
    document.querySelector('#posts-grid').innerHTML = filteredPosts().map(postCard).join('') || empty('No matching posts', 'Try a different word.');
  } else if (event.target.closest('#post-form')) updatePreview();
});
document.addEventListener('change', async (event) => {
  const target = event.target;
  try {
    if (target.id === 'media-upload') await uploadMedia([...target.files]);
    else if (target.dataset.consent) {
      await persist({ ...state, media: state.media.map((media) => media.id === target.dataset.consent ? { ...media, consent: target.value } : media) });
      notify('Client permission updated.');
    } else if (target.id === 'preview-platform') { previewPlatform = target.value; updatePreview(); }
    else if (target.id === 'post-status') document.querySelector('#publication-fields').hidden = target.value !== 'published';
  } catch (error) {
    console.error(error);
    notify(`Could not save: ${error.message}. Check available browser storage.`, true);
    if (target.dataset.consent) render();
  }
});
document.addEventListener('submit', async (event) => {
  if (!['post-form', 'hashtags-form'].includes(event.target.id)) return;
  event.preventDefault();
  if (saving) return;
  const submitButton = event.target.querySelector('[type="submit"]');
  try {
    if (event.target.id === 'hashtags-form') {
      await persist({ ...state, hashtags: document.querySelector('#saved-hashtags').value.trim() });
      notify('Your go-to hashtags are saved.');
      return;
    }
    const post = readEditor();
    const error = validatePost(post, state.media) || (post.status === 'published' && !new FormData(event.target).has('confirmed') ? 'Confirm you checked that the post is live.' : '');
    if (error) { document.querySelector('#form-error').textContent = error; return; }
    saving = true;
    submitButton.disabled = true;
    const exists = state.posts.some((item) => item.id === post.id);
    await persist({ ...state, posts: exists ? state.posts.map((item) => item.id === post.id ? post : item) : [post, ...state.posts] });
    saving = false;
    closeEditor(); render(); notify('A little progress, saved beautifully.');
  } catch (error) {
    console.error(error);
    const field = document.querySelector('#form-error');
    const message = `Unable to save: ${error.message}. Your changes are still in the editor.`;
    if (field) field.textContent = message; else notify(message, true);
  } finally { saving = false; if (submitButton?.isConnected) submitButton.disabled = false; }
});
document.addEventListener('keydown', (event) => {
  if (!activePost) return;
  if (event.key === 'Escape') closeEditor();
  if (event.key === 'Tab') {
    const elements = [...document.querySelector('.editor-modal').querySelectorAll('button, input, textarea, select, summary, a[href]')].filter((element) => !element.disabled && element.getClientRects().length);
    const first = elements[0], last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
try {
  const access=getApprovedSession();
  if(!access)throw new Error('Approved workspace access is required.');
  db = await openStore(`maya-content-studio:${access.user.id}:${access.workspace.id}`);
  state = await loadState(db);
  if (!state) { state = seedState(); await saveState(db, state); }
  render();
  const result = new URLSearchParams(location.search).get('square');
  if (result) {
    if(result==='connected'){view=sessionStorage.getItem('mya-square-return-view')==='calendar'?'calendar':'appointments';appointmentRange='week';sessionStorage.removeItem('mya-square-return-view');render();}
    const messages = { connected: 'Square authorization saved. Checking the connection…', declined: 'Square authorization was canceled.', 'invalid-state': 'Square sign-in expired or was already used. Please try again.', 'wrong-seller': 'This workspace is already linked to another Square seller.', 'missing-code': 'Square did not return an authorization code.', failed: 'Square connection failed. Check server configuration and try again.' };
    notify(messages[result] || 'Square sign-in could not be completed.', result !== 'connected');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  await refreshSquare();
} catch (error) {
  console.error(error);
  app.innerHTML = `<main class="startup-error"><h1>Your studio couldn’t open its storage.</h1><p>This prototype needs browser storage to keep your work safe. Enable site storage and reload.</p><p>${esc(error.message)}</p><button class="button primary" onclick="location.reload()">Try again</button></main>`;
}
