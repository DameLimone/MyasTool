import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentWindow, readAppointments, SQUARE_SCOPES } from './appointments.js';

test('salon calendar boundaries handle DST and a seven-day range', () => {
  assert.deepEqual(appointmentWindow(Date.parse('2026-03-08T18:00:00Z'), 'America/Chicago', 'today'), { start: '2026-03-08T06:00:00.000Z', end: '2026-03-09T05:00:00.000Z' });
  assert.deepEqual(appointmentWindow(Date.parse('2026-11-01T18:00:00Z'), 'America/Chicago', 'today'), { start: '2026-11-01T05:00:00.000Z', end: '2026-11-02T06:00:00.000Z' });
  assert.deepEqual(appointmentWindow(Date.parse('2026-11-11T02:00:00Z'), 'America/Chicago', 'week'), { start: '2026-11-10T06:00:00.000Z', end: '2026-11-17T06:00:00.000Z' });
});

function fixture({ scopes = SQUARE_SCOPES, catalogError = false, pages = false } = {}) {
  const calls = [];
  const booking = (id, overrides = {}) => ({ id, location_id: 'salon', start_at: '2026-11-11T16:00:00Z', status: 'ACCEPTED', customer_id: 'private-customer', seller_note: 'private-note', appointment_segments: [{ service_variation_id: 'variation', duration_minutes: 45 }], ...overrides });
  const square = async (path, body, token) => {
    calls.push({ path, body, token });
    if (path === '/oauth2/token/status') return { scopes, merchant_id: 'seller', client_id: 'app' };
    if (path === '/v2/locations') return { locations: [{ id: 'salon', name: 'Mya’s Salon', status: 'ACTIVE', timezone: 'America/Chicago' }, { id: 'closed', status: 'INACTIVE' }] };
    if (path.startsWith('/v2/bookings')) {
      const params = new URL(path, 'https://test').searchParams;
      assert.equal(params.get('location_id'), 'salon');
      assert.equal(params.get('start_at_min'), '2026-11-11T06:00:00.000Z');
      assert.equal(params.get('start_at_max'), '2026-11-12T06:00:00.000Z');
      if (params.get('cursor')) return { bookings: [booking('later', { start_at: '2026-11-11T20:00:00Z' })] };
      return { bookings: [booking('one'), booking('cancelled', { status: 'CANCELLED_BY_SELLER' }), booking('declined', { status: 'DECLINED' }), booking('foreign', { location_id: 'another' }), booking('tomorrow', { start_at: '2026-11-12T06:00:00Z' })], ...(pages ? { cursor: 'page-two' } : {}) };
    }
    if (path === '/v2/catalog/batch-retrieve') {
      assert.deepEqual(body, { object_ids: ['variation'], include_related_objects: true });
      if (catalogError) throw Object.assign(new Error('Unavailable'), { status: 503 });
      return { objects: [{ id: 'variation', item_variation_data: { name: 'Regular', item_id: 'item' } }], related_objects: [{ id: 'item', item_data: { name: 'Gel manicure' } }] };
    }
    assert.fail(`Unexpected endpoint ${path}`);
  };
  const read = (query = '') => readAppointments({ square, accessToken: 'private-token', merchantId: 'seller', applicationId: 'app', query: new URLSearchParams(query), now: Date.parse('2026-11-11T18:00:00Z') });
  return { read, calls };
}

test('loads all pages, filters canceled and out-of-range bookings, returns only display fields', async () => {
  const f = fixture({ pages: true });
  const result = await f.read();
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.appointments.map(a => a.id), ['one', 'later']);
  assert.deepEqual(result.data.appointments[0].services, ['Gel manicure']);
  assert.equal(result.data.appointments[0].durationMinutes, 45);
  assert.equal(result.data.locations.length, 1);
  assert.equal(result.data.warning, null);
  assert.equal(JSON.stringify(result.data).includes('private'), false);
  assert.ok(f.calls.every(c => ['/oauth2/token/status', '/v2/locations', '/v2/catalog/batch-retrieve'].includes(c.path) || c.path.startsWith('/v2/bookings?')));
});

test('missing seller-level permission never reads partial buyer-level bookings', async () => {
  const f = fixture({ scopes: ['APPOINTMENTS_READ'] });
  const result = await f.read();
  assert.equal(result.status, 403);
  assert.equal(result.data.code, 'APPOINTMENT_PERMISSION_REQUIRED');
  assert.equal(f.calls.length, 1);
});

test('rejects unrecognized locations and date ranges', async () => {
  const f = fixture();
  assert.equal((await f.read('range=month')).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.read('location=foreign')).status, 400);
  assert.equal(f.calls.some(c => c.path.startsWith('/v2/bookings')), false);
});

test('catalog outages preserve appointments with an explicit service-name warning', async () => {
  const result = await fixture({ catalogError: true }).read();
  assert.equal(result.status, 200);
  assert.equal(result.data.appointments.length, 1);
  assert.equal(result.data.appointments[0].services[0], 'Service details unavailable');
  assert.match(result.data.warning, /service names/);
});
