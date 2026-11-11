export const APPOINTMENT_SCOPES = ['APPOINTMENTS_READ', 'APPOINTMENTS_ALL_READ', 'ITEMS_READ'];
export const SQUARE_SCOPES = ['MERCHANT_PROFILE_READ', ...APPOINTMENT_SCOPES];

function dateParts(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const [year, month, day] = date.split('-').map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.toISOString().slice(0, 10) !== date) return null;
  return { year, month, day };
}

function localParts(instant, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

function localMidnight(year, month, day, timeZone) {
  const target = Date.UTC(year, month, day);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const actual = localParts(guess, timeZone);
    const delta = target - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += delta;
    if (!delta) break;
  }
  return new Date(guess).toISOString();
}

// Compute each local midnight separately so the range respects DST changes.
export function appointmentWindow(now, timeZone, range) {
  const p = localParts(now, timeZone);
  return {
    start: localMidnight(p.year, p.month - 1, p.day, timeZone),
    end: localMidnight(p.year, p.month - 1, p.day + (range === 'today' ? 1 : 7), timeZone),
  };
}

export function appointmentWindowForDates(startDate, endDate, timeZone) {
  const start = dateParts(startDate), end = dateParts(endDate);
  if (!start || !end) return null;
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  const endDay = Date.UTC(end.year, end.month - 1, end.day);
  const dayCount = (endDay - startDay) / 86400000;
  if (dayCount < 1 || dayCount > 42) return null;
  return {
    start: localMidnight(start.year, start.month - 1, start.day, timeZone),
    end: localMidnight(end.year, end.month - 1, end.day, timeZone),
  };
}

export async function readAppointments({ square, accessToken, merchantId, applicationId, query, now }) {
  const range = query.get('range') || 'today';
  const hasStartDate = query.has('startDate'), hasEndDate = query.has('endDate');
  if (hasStartDate !== hasEndDate || (!hasStartDate && !['today', 'week'].includes(range))) {
    return { status: 400, data: { error: 'Choose Today, Next seven days, or a valid custom date range.' } };
  }
  if (hasStartDate && range !== 'custom') {
    return { status: 400, data: { error: 'Custom appointment dates require range=custom.' } };
  }
  if (range === 'custom' && !hasStartDate) {
    return { status: 400, data: { error: 'Choose a valid custom date range.' } };
  }
  if (hasStartDate && !appointmentWindowForDates(query.get('startDate'), query.get('endDate'), 'UTC')) {
    return { status: 400, data: { error: 'Choose a valid custom date range no longer than 42 days.' } };
  }
  const permission = await square('/oauth2/token/status', {}, accessToken);
  if (permission.merchant_id !== merchantId || permission.client_id !== applicationId) throw new Error('Authorization mismatch');
  if (!APPOINTMENT_SCOPES.every(scope => permission.scopes?.includes(scope))) {
    return { status: 403, data: { code: 'APPOINTMENT_PERMISSION_REQUIRED', error: 'Reconnect Square to allow read-only access to appointments and service names.' } };
  }
  const locationData = await square('/v2/locations', null, accessToken);
  const locations = (locationData.locations || []).filter(l => l.status === 'ACTIVE').map(l => ({ id: l.id, name: l.name || l.business_name || 'Salon', timezone: l.timezone || 'UTC' }));
  if (!locations.length) return { status: 200, data: { locations: [], appointments: [], range, warning: 'No active Square locations were found.', syncState: 'current', syncedAt: new Date(now).toISOString() } };
  const location = query.has('location') ? locations.find(l => l.id === query.get('location')) : locations[0];
  if (!location) return { status: 400, data: { error: 'Choose a location from your connected Square account.' } };
  const window = hasStartDate
    ? appointmentWindowForDates(query.get('startDate'), query.get('endDate'), location.timezone)
    : appointmentWindow(now, location.timezone, range);
  if (!window) return { status: 400, data: { error: 'Choose a valid custom date range no longer than 42 days.' } };
  const bookings = new Map();
  let pages = 0, truncated = false;
  let chunkStart = Date.parse(window.start);
  const rangeEnd = Date.parse(window.end);
  // Square accepts at most 31 days per request. Thirty elapsed days also stay
  // safely within that limit across local daylight-saving transitions.
  while (chunkStart < rangeEnd && pages < 10) {
    const chunkEnd = Math.min(rangeEnd, chunkStart + 30 * 86400000);
    let cursor;
    do {
      const params = new URLSearchParams({ location_id: location.id, start_at_min: new Date(chunkStart).toISOString(), start_at_max: new Date(chunkEnd).toISOString(), limit: '100', ...(cursor ? { cursor } : {}) });
      const page = await square(`/v2/bookings?${params}`, null, accessToken);
      for (const b of page.bookings || []) {
        if (b.location_id === location.id && Date.parse(b.start_at) >= Date.parse(window.start) && Date.parse(b.start_at) < rangeEnd
          && !b.status?.startsWith('CANCELLED') && b.status !== 'DECLINED') bookings.set(b.id, b);
      }
      cursor = page.cursor;
      pages++;
    } while (cursor && pages < 10);
    if (cursor) { truncated = true; break; }
    chunkStart = chunkEnd;
  }
  truncated ||= chunkStart < rangeEnd;
  const ids = [...new Set([...bookings.values()].flatMap(b => (b.appointment_segments || []).map(s => s.service_variation_id).filter(Boolean)))];
  const names = new Map();
  let detailsUnavailable = ids.length > 1000;
  if (ids.length) {
    try {
      const catalog = await square('/v2/catalog/batch-retrieve', { object_ids: ids.slice(0, 1000), include_related_objects: true }, accessToken);
      const objects = [...(catalog.objects || []), ...(catalog.related_objects || [])];
      const items = new Map(objects.filter(o => o.item_data).map(o => [o.id, o.item_data.name]));
      for (const o of objects) if (o.item_variation_data) {
        const v = o.item_variation_data, item = items.get(v.item_id);
        names.set(o.id, [item, v.name !== 'Regular' ? v.name : null].filter(Boolean).join(' · ') || 'Service');
      }
    } catch (error) {
      if (error.status === 401) throw error;
      detailsUnavailable = true;
    }
    detailsUnavailable ||= ids.some(id => !names.has(id));
  }
  const appointments = [...bookings.values()].sort((a,b) => Date.parse(a.start_at) - Date.parse(b.start_at)).map(b => ({
    id: b.id, startAt: b.start_at, status: b.status || 'UNKNOWN',
    durationMinutes: (b.appointment_segments || []).reduce((sum,s) => sum + (Number.isFinite(s.duration_minutes) ? s.duration_minutes : 0) + (Number.isFinite(s.intermission_minutes) ? s.intermission_minutes : 0), 0),
    services: (b.appointment_segments || []).map(s => names.get(s.service_variation_id) || 'Service details unavailable'),
  }));
  return { status: 200, data: { locations, location, appointments, range, ...window, syncState: truncated ? 'partial' : 'current', syncedAt: new Date(now).toISOString(),
    warning: [truncated ? 'The appointment list is incomplete. Use a shorter date range to load the remaining results.' : '', detailsUnavailable ? 'Some service names could not be loaded.' : ''].filter(Boolean).join(' ') || null,
  } };
}
