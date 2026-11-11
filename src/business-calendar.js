import {localDate,statusNames} from './model.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function calendarWindow(date){
  const start=new Date(date.getFullYear(),date.getMonth(),1);
  start.setDate(start.getDate()-start.getDay());
  const end=new Date(start);end.setDate(end.getDate()+42);
  return {startDate:localDate(start),endDate:localDate(end)};
}
export function dateInZone(value,timeZone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function renderBusinessCalendar({date,selectedDate,posts,appointmentState}){
  const {loading,data,error,code}=appointmentState;
  const timezone=data?.location?.timezone||'America/Chicago';
  const appointments=data?.appointments||[];
  const dayAppointments=day=>appointments.filter(a=>dateInZone(a.startAt,timezone)===day);
  const time=value=>new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(value));
  const period=a=>`${time(a.startAt)}${a.durationMinutes?` – ${time(Date.parse(a.startAt)+a.durationMinutes*60000)}`:''}`;
  const window=calendarWindow(date);
  const start=new Date(`${window.startDate}T12:00:00`);
  const selectedAppointments=dayAppointments(selectedDate),selectedPosts=posts.filter(p=>p.date?.startsWith(selectedDate));
  const reconnect=['SQUARE_CONNECTION_REQUIRED','APPOINTMENT_PERMISSION_REQUIRED','SQUARE_APPOINTMENTS_UNAVAILABLE'].includes(code);
  return `<div class="page-heading"><div><p class="eyebrow">YOUR STUDIO SCHEDULE</p><h1>Content & appointments</h1><p class="subtitle">Square appointments are read-only. Select a day to see its times and content.</p></div></div>
  <section class="business-calendar calendar-panel" aria-label="Content and appointments calendar">
  <div class="calendar-toolbar"><h2>${esc(date.toLocaleDateString('en-US',{month:'long',year:'numeric'}))}</h2><div><button class="button secondary" data-today>Today</button><button class="button secondary" data-month="-1" aria-label="Previous month">‹</button><button class="button secondary" data-month="1" aria-label="Next month">›</button></div></div>
  <div class="calendar-sync-controls">${data?.locations?.length?`<label>Square location<select id="calendar-location">${data.locations.map(l=>`<option value="${esc(l.id)}" ${l.id===data.location?.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select></label>`:''}<button class="button secondary" data-calendar-refresh ${loading?'disabled':''}>${loading?'Loading appointments…':'Refresh appointments'}</button><span>Appointment times: ${esc(timezone)}</span></div>
  ${error?`<div class="appointment-message" role="alert"><p>${esc(error)}</p>${reconnect?'<button class="button primary" data-square-connect>Connect Square for appointments</button>':''}</div>`:''}
  ${data?.warning?`<p class="appointment-message" role="status">${esc(data.warning)}</p>`:''}
  <div class="calendar-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="weekday">${d}</div>`).join('')}${Array.from({length:42},(_,i)=>{
    const day=new Date(start);day.setDate(day.getDate()+i);const key=localDate(day),bookings=dayAppointments(key),content=posts.filter(p=>p.date?.startsWith(key));
    return `<div class="calendar-cell ${day.getMonth()!==date.getMonth()?'outside':''} ${key===selectedDate?'is-selected':''}"><button class="day-number" data-calendar-day="${key}" aria-label="View schedule for ${key}" aria-pressed="${key===selectedDate}">${day.getDate()}<span class="calendar-count">${bookings.length?`<span>${bookings.length} appt</span>`:''}${content.length?`<span>${content.length} post</span>`:''}</span></button><div class="calendar-cell-details">${bookings.map(a=>`<div class="calendar-booking"><strong>${esc(time(a.startAt))}</strong><span>${esc(a.services.join(' + '))}</span></div>`).join('')}${content.map(p=>`<button class="calendar-post ${esc(p.status)}" data-edit="${esc(p.id)}">${esc(p.title)}<small>${esc(statusNames[p.status])}</small></button>`).join('')}</div></div>`;
  }).join('')}</div></section>
  <section class="home-panel calendar-day-agenda" aria-label="Selected day schedule"><div class="section-heading"><h2>${esc(new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}))}</h2><button class="button secondary" data-date="${esc(selectedDate)}">Create a post</button></div>
  <h3>Square appointments</h3>${loading?'<p role="status">Loading appointments from Square…</p>':error?'<p>Appointments have not loaded. Use the message above to retry or reconnect.</p>':!data?'<p>Refresh to load appointments.</p>':selectedAppointments.map(a=>`<article class="appointment-card"><div class="appointment-time"><strong>${esc(period(a))}</strong><span>${esc(timezone)}</span></div><div class="appointment-service"><h3>${esc(a.services.join(' + ')||'Service details unavailable')}</h3><p>${esc(a.durationMinutes)} min · ${esc(a.status.replaceAll('_',' ').toLowerCase())}</p></div></article>`).join('')||'<p>No appointments on this day.</p>'}
  <h3>Content posts</h3>${selectedPosts.map(p=>`<button class="calendar-post ${esc(p.status)}" data-edit="${esc(p.id)}">${esc(p.title)}<small>${esc(statusNames[p.status])}${p.sample?' · Sample':''}</small></button>`).join('')||'<p>No content planned for this day.</p>'}</section>`;
}
