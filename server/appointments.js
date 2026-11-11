export const APPOINTMENT_SCOPES = ['APPOINTMENTS_READ', 'APPOINTMENTS_ALL_READ', 'ITEMS_READ'];
export const SQUARE_SCOPES = ['MERCHANT_PROFILE_READ', ...APPOINTMENT_SCOPES];

function localParts(instant, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

// Compute each local midnight separately so the range respects DST changes.
export function appointmentWindow(now, timeZone, range) {
  const p = localParts(now, timeZone);
  function midnight(offset) {
    const target = Date.UTC(p.year, p.month - 1, p.day + offset);
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const actual = localParts(guess, timeZone);
      const delta = target - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
      guess += delta;
      if (!delta) break;
    }
    return new Date(guess).toISOString();
  }
  return { start: midnight(0), end: midnight(range === 'today' ? 1 : 7) };
}

export async function readAppointments({ square, accessToken, merchantId, applicationId, query, now }) {
  const range = query.get('range') || 'today';
  if (!['today', 'week'].includes(range)) return { status: 400, data: { error: 'Choose Today or Next seven days.' } };
  const permission = await square('/oauth2/token/status', {}, accessToken);
  if (permission.merchant_id !== merchantId || permission.client_id !== applicationId) throw new Error('Authorization mismatch');
  if (!APPOINTMENT_SCOPES.every(scope => permission.scopes?.includes(scope))) {
    return { status: 403, data: { code: 'APPOINTMENT_PERMISSION_REQUIRED', error: 'Reconnect Square to allow read-only access to appointments and service names.' } };
  }
  const locationData = await square('/v2/locations', null, accessToken);
  const locations = (locationData.locations || []).filter(l => l.status === 'ACTIVE').map(l => ({ id: l.id, name: l.name || l.business_name || 'Salon', timezone: l.timezone || 'UTC' }));
  if (!locations.length) return { status: 200, data: { locations: [], appointments: [], range, warning: 'No active Square locations were found.', syncedAt: new Date(now).toISOString() } };
  const location = query.has('location') ? locations.find(l => l.id === query.get('location')) : locations[0];
  if (!location) return { status: 400, data: { error: 'Choose a location from your connected Square account.' } };
  const window = appointmentWindow(now, location.timezone, range);
  const bookings = new Map();
  let cursor, pages = 0;
  do {
    const params = new URLSearchParams({ location_id: location.id, start_at_min: window.start, start_at_max: window.end, limit: '100', ...(cursor ? { cursor } : {}) });
    const page = await square(`/v2/bookings?${params}`, null, accessToken);
    for (const b of page.bookings || []) {
      if (b.location_id === location.id && Date.parse(b.start_at) >= Date.parse(window.start) && Date.parse(b.start_at) < Date.parse(window.end)
        && !b.status?.startsWith('CANCELLED') && b.status !== 'DECLINED') bookings.set(b.id, b);
    }
    cursor = page.cursor;
    pages++;
  } while (cursor && pages < 10);
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
  return { status: 200, data: { locations, location, appointments, range, ...window, syncedAt: new Date(now).toISOString(),
    warning: [cursor ? 'Only the first 1,000 results were loaded. Use Today to narrow the range.' : '', detailsUnavailable ? 'Some service names could not be loaded.' : ''].filter(Boolean).join(' ') || null,
  } };
}
