# Frontend handoff: Mya backend foundation

Audience: frontend engineer integrating Mya's private business API.

## Status and scope

The backend has these private API handlers in source:

- `GET /api/v1/session`
- `GET /api/v1/workspaces/{workspaceId}/capabilities`
- `GET, PATCH /api/v1/workspaces/{workspaceId}/scheduling-settings`

Scheduling configuration is documented in [Configurable Scheduling](CONFIGURABLE-SCHEDULING.md).
Only owners/admins may save settings; member access is read-only. The reminder
preference is configurable but notification delivery is not implemented.

They verify a Clerk session, look up the caller in PostgreSQL, and require an
active database membership before returning workspace data. Capabilities are
currently empty. There are no appointments, notifications, client records,
booking changes, or social insights in `/api/v1` yet.

**Integration is not live-ready yet.** The MyasTool Supabase project is
provisioned and its database schema/defaults are applied. This does not configure
the Vercel runtime database role, Clerk credentials or frontend sign-in UI. The
source routes fail closed until that backend environment and owner membership
are configured. Do not treat this as a deployed, usable settings/sign-in screen.

The API implementation is in this repository (`DameLimone/MyasTool`). John's
website is in `stonksmasters/mknails`; no changes to that repository are part of
this handoff.

## Required decisions before connecting a deployed frontend

1. Decide which app is the authenticated private business surface. The public
   MK Nails website is not itself a private dashboard.
2. Decide how it reaches the API. Current handlers are same-origin only; they
   do **not** enable cross-origin browser access or credentialed CORS. Prefer a
   same-origin deployment/server-side gateway, or agree on and implement exact
   production origins on the backend before direct cross-origin calls.
3. Configure Clerk for the chosen frontend domain and the API's matching Clerk
   instance. The backend only accepts exact HTTPS origins listed in
   `CLERK_AUTHORIZED_PARTIES` (loopback HTTP is allowed for local development).
   Wildcards are not supported.
4. Provision Supabase, run the reviewed migration, configure the restricted
   runtime database role, and create workspace memberships for the intended
   Clerk user IDs. Workspace and membership administration is currently
   out-of-band; a signed-in user cannot self-join.

Coordinate environment setup with the backend owner. Do not put Clerk secret
keys, database URLs, Square tokens, or other credentials in frontend variables,
static assets, browser storage, or URLs.

## Authentication from the frontend

Use Clerk's frontend SDK for sign-in and obtain a fresh session token when
calling the API. Send it as a bearer token. Do not use Square OAuth as app
sign-in; Square authorization only represents the seller integration.

Framework-neutral example (adapt `getSessionToken` to the chosen Clerk SDK):

```js
async function apiGet(path, getSessionToken) {
  const token = await getSessionToken();
  if (!token) throw new Error('Sign in is required.');

  const response = await fetch(path, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  const body = await response.json();
  if (!response.ok) {
    const error = body?.error;
    throw new Error(error?.message || `Request failed (${response.status}).`);
  }
  return body.data;
}
```

Never persist the session token in `localStorage`, IndexedDB, a URL, or app
records. Prefer the Clerk SDK's session-aware token getter for every request.
Handle expired/revoked sessions by returning to the signed-out state and asking
the user to authenticate again.

## Integration flow

1. Show an explicit loading state while Clerk initializes. Do not call private
   endpoints until Clerk has a signed-in session and can provide its token.
2. Request `GET /api/v1/session`.
3. If `data.workspaces` is empty, show a clear "workspace access has not been
   set up" state. Do not offer a self-service join/create action; membership
   provisioning is not implemented.
4. If there is one workspace, it can be selected by default. If there are
   multiple, present a workspace switcher and retain the selection only as UI
   state. A selected ID is not authorization.
5. Request that workspace's capabilities endpoint. Gate module UI on the
   server-returned `modules` and `capabilities`, not hardcoded role assumptions.
   At present the response has `modules: {}` and `capabilities: []`; show no
   backend business modules as enabled.
6. On workspace switch, refetch capabilities and clear any data/cache associated
   with the previous workspace.
7. Treat `404 WORKSPACE_NOT_FOUND` as unavailable/not authorized. Do not reveal
   whether another user's workspace exists.

## Implemented endpoint contract

All successes and errors include a request ID and use `Cache-Control: no-store`.
The machine-readable contract and synthetic examples are
[openapi.json](./openapi.json) and [fixtures](./fixtures/api-v1/).

### `GET /api/v1/session`

Authorization: `Bearer <Clerk session token>`

Example response:

```json
{
  "data": {
    "user": { "id": "user_fixture_mya" },
    "workspaces": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Example Workspace",
        "slug": "example-workspace",
        "timezone": "UTC",
        "role": "owner"
      }
    ]
  },
  "meta": { "requestId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
}
```

`workspaces` contains only active memberships for this user. An empty array is a
valid response for a user with no provisioned workspace.

### `GET /api/v1/workspaces/{workspaceId}/capabilities`

Authorization: `Bearer <Clerk session token>`

Example response:

```json
{
  "data": {
    "workspace": {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Example Workspace",
      "slug": "example-workspace",
      "timezone": "UTC",
      "role": "owner"
    },
    "modules": {},
    "capabilities": []
  },
  "meta": { "requestId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
}
```

The backend checks current database membership on every request. Do not infer
authorization from a previously fetched session, URL, browser state, role name,
or workspace ID.

## Error and loading states

The API error shape is:

```json
{
  "error": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "Workspace was not found.",
    "requestId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  }
}
```

Handle at least:

| HTTP / code | Frontend behavior |
| --- | --- |
| `401 AUTHENTICATION_REQUIRED` | Signed-out/expired-session state; start or renew Clerk sign-in. |
| `403 USER_DISABLED` | Access blocked; show a support/contact state. Do not retry-loop. |
| `404 WORKSPACE_NOT_FOUND` | Workspace unavailable or user is not an active member; clear its cached data. |
| `400 INVALID_WORKSPACE_ID` | Client bug or invalid route state; show a recoverable error and log the request ID. |
| `503 BACKEND_NOT_CONFIGURED` | Environment is not ready; show a service-unavailable state, not an empty workspace. |
| `503 IDENTITY_PROVIDER_UNAVAILABLE` | Temporary sign-in verification failure; allow retry and keep protected data hidden. |
| `503 DATABASE_UNAVAILABLE` | Temporary backend storage outage; allow retry and keep protected data hidden. |
| `405 METHOD_NOT_ALLOWED` | Client integration error; report it during development. |

Unknown errors should show a neutral failure state and include the request ID in
support diagnostics. Never turn a network, authentication, or provider error into
an empty appointment list, zero metrics, or a successful-looking state.

## Separate calendar experiences

Keep the social content calendar and Mya's salon appointment calendar as
separate, clearly labeled destinations. Do not mix posts and appointments in
one month grid. The current tool's **Calendar** is for content planning;
**Appointments** is a distinct, read-only view of Square bookings. The current
temporary Appointments screen is a basic Today/Next seven days list, not the
final mobile calendar design.

### Appointment calendar UX for the private business surface

- Default to **Today** and show a readable agenda of appointment cards.
- Provide a horizontally swipeable week strip with a clear **Today** action;
  selecting a day filters the agenda to that date.
- Keep an optional month picker for date navigation. Use dots/counts only as
  booking indicators, with the selected day's appointment details in the agenda
  below; do not cram full appointment details into month cells.
- Open appointment details in a bottom sheet so the user remains in the
  calendar. Use only fields the authorized API returns; there is no separate
  detail endpoint today.
- Keep date navigation/view controls reachable while scrolling on mobile.
- Label the view as salon appointments and show the selected Square location
  and its timezone.
- Appointment cards can show start time, service names, duration and status.
  The current API intentionally omits customer names/contact details.
- This interface is read-only. Square remains the source of truth; do not imply
  that a calendar action edits, cancels, or creates a Square booking.

### Appointment API available now (same-origin tool only)

The current Square endpoint is available to this repository's same-origin Tool,
not directly to John's separately hosted site:

```http
GET /api/square/appointments?range=today
GET /api/square/appointments?range=week&location={squareLocationId}
GET /api/square/appointments?range=custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&location={squareLocationId}
```

The custom range has an inclusive start date, exclusive end date, and a
42-calendar-day maximum. Date boundaries and appointment display use the
selected Square location's IANA timezone. `today` and `week` are supported by
the current screen; the custom range is available for future date navigation.

Example success (IDs and values are illustrative):

```json
{
  "locations": [{ "id": "location_id", "name": "Salon", "timezone": "America/Chicago" }],
  "location": { "id": "location_id", "name": "Salon", "timezone": "America/Chicago" },
  "appointments": [{
    "id": "booking_id",
    "startAt": "2026-11-11T16:00:00Z",
    "status": "ACCEPTED",
    "durationMinutes": 60,
    "services": ["Example service"]
  }],
  "range": "today",
  "start": "2026-11-11T06:00:00Z",
  "end": "2026-11-12T06:00:00Z",
  "syncState": "current",
  "syncedAt": "2026-11-11T16:01:00Z"
}
```

The endpoint fetches live data from Square; it does not serve a stale cache.
`syncState: "current"` and `syncedAt` mean the live read succeeded. With a
selected location, a successful empty `appointments` array means no returned
bookings in that range; a `warning` with no selected location means Square has
no active locations. On a network or provider failure, show an error/retry
state, not an empty schedule.
If the frontend deliberately retains an earlier successful response after a
failed refresh, label it stale and show that response's original `syncedAt`;
the backend itself does not return stale appointments.

Current Square errors retain `{ "code": "...", "error": "Readable message" }`.
`SQUARE_CONNECTION_REQUIRED` means connect/reconnect Square;
`APPOINTMENT_PERMISSION_REQUIRED` means the connected seller must grant the
required appointment read permissions. Keep permission, connection, network,
provider-error, loading, successful-empty, and current-data states distinct.
The endpoint's browser-bound Square OAuth session is not Clerk sign-in and is
not shared across devices.

The endpoint uses same-origin browser/Square authorization. It is **not**
available for direct cross-origin calls from `stonksmasters/mknails`, and its
Square session is not a workspace-owned credential. Before John integrates
appointments, agree on a same-origin server-side gateway or implement and
deploy a workspace-authenticated appointment API backed by durable,
workspace-owned Square OAuth. Do not work around this with exposed API keys,
Square tokens, or wildcard credentialed CORS.

- Appointment data is not persisted to IndexedDB or edited by the calendar.
- Keep the public site's existing Square booking links. There is no public
  catalog endpoint yet.
- Keep the existing Square read-only flow as-is in this phase. Its browser-bound
  Square OAuth session is not an app session and is not shared across devices.
- Do not add booking writes, customer messaging, notifications, client data, or
  social metrics based on the capabilities endpoint: those modules are not
  implemented or enabled.
- Do not call the proposed future workspace appointment route in
  [FRONTEND-INTEGRATION.md](./FRONTEND-INTEGRATION.md) until it exists in the
  OpenAPI contract and has been enabled by the backend.
- Do not add wildcard CORS or expose private workspace responses on the public
  MK Nails website.

## Frontend acceptance checklist

- [ ] Clerk initializes before any private API request; signed-out users cannot
  see cached private data.
- [ ] Both endpoints send a fresh Clerk session bearer token and use no-store
  behavior.
- [ ] Signed-in users with zero workspaces see a useful no-access state.
- [ ] Workspace switching refetches capabilities and clears prior workspace
  data.
- [ ] A user cannot access another workspace by changing its ID in the URL.
- [ ] Every listed error state is tested, including backend unconfigured and
  unavailable responses.
- [ ] No credentials or private records are written to browser storage or
  included in URLs.
- [ ] Existing Square booking links and the current Square workflow continue to
  work unchanged.
- [ ] Social content and salon appointments remain separate calendar
  destinations; appointment mobile UX defaults to a day agenda with week/date
  navigation and clear loading, empty, stale-client, connection, and error states.
- [ ] Cross-origin behavior is not assumed; integration tests use the agreed
  same-origin/gateway arrangement or an explicitly configured origin.

## Backend references

- [backend setup and environment configuration](./BACKEND-SETUP.md)
- [OpenAPI contract](./openapi.json)
- [existing API inventory and future route plan](./FRONTEND-INTEGRATION.md)
- [synthetic success and error fixtures](./fixtures/api-v1/)
