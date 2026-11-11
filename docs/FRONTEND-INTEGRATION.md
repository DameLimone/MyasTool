# Backend integration contract for John's MK Nails frontend

Status: reviewed integration plan. The initial authenticated session and
workspace-capabilities handlers are implemented in source but are not configured
against Clerk or Supabase yet. Other `/api/v1` and all `/public/v1` routes remain
proposed. No changes were made to John's repository.

The initial API schemas and synthetic fixtures are in
[openapi.json](./openapi.json) and [docs/fixtures/api-v1/](./fixtures/api-v1/).

## Repository responsibilities

- `stonksmasters/mknails`: John's customer-facing website frontend.
- This repository (`DameLimone/MyasTool`): Mya's backend and current test console.
- `stonksmasters/Audit`: BORG architectural reference; no direct production
  dependency or shared database connection has been established.

The reviewed `mknails` snapshot (`189424fd17367d12e93180844157aa5793a1eee3`)
ships a static deployment archive. Its booking buttons already point to Square.
Those links can continue to work while the backend is developed. The website's
hardcoded services/prices are presentation content, not proof of live Square
catalog state. Instagram links do not grant analytics access.

## Public website versus private business access

The public salon website may request only explicitly published catalog data.
Private appointments, client records, notifications, internal notes, credentials
and social insights require authenticated workspace access. Do not embed an API
key or Square token in static JavaScript, the build, a URL or localStorage.

Develop the private API independently of John's presentation components. A future
private dashboard may share a deployment or use a server-side gateway; it must
not rely on arbitrary cross-site cookie access. Production domains and the auth
deployment must be settled before configuring exact allowed origins. Wildcard
credentialed CORS is not an integration solution.

## Existing backend routes

These are available to the current same-origin Tool. They are not yet a general
cross-origin API for the public website.

| Method | Path | Current behavior |
| --- | --- | --- |
| GET | `/api/health` | Service health and current implementation type |
| POST | `/api/square/session` | Configuration readiness; requires the configured Tool Origin |
| POST | `/api/square/connect` | Starts seller OAuth; requires the configured Tool Origin |
| GET | `/api/square/callback` | Square OAuth redirect; browser-bound state validation |
| GET | `/api/square/status` | Connection status for the current browser |
| GET | `/api/square/appointments?range=today\|week&location=...` | Read-only appointments for the authorized seller |
| GET | `/api/square/appointments?range=custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&location=...` | Read-only date range; start inclusive, end exclusive, maximum 42 days, dates use selected location timezone |
| GET | `/api/v1/session` | Clerk-verified identity and only that user's active database memberships; requires configured Clerk and PostgreSQL |
| GET | `/api/v1/workspaces/{workspaceId}/capabilities` | Requires an active database membership; currently returns no enabled modules or capabilities |

Appointment permissions: `MERCHANT_PROFILE_READ`, `APPOINTMENTS_READ`,
`APPOINTMENTS_ALL_READ`, `ITEMS_READ`. Missing scopes return
`APPOINTMENT_PERMISSION_REQUIRED`; an absent/expired connection returns
`SQUARE_CONNECTION_REQUIRED`. Private responses use `Cache-Control: no-store`.

Current appointment success response includes `locations`, selected `location`,
`appointments`, `range`, `start`, `end`, `syncState: "current"`, `syncedAt` and
optional `warning`. `syncedAt` is the successful live Square fetch time; this
endpoint does not return cached/stale bookings.
Each appointment has `id`, `startAt`, `status`, `durationMinutes`, and `services`.
No client names or contact details are currently returned. Today's boundaries, the seven-day window, and custom calendar ranges use the
selected location's timezone. Custom ranges have an exclusive end date and are
capped at 42 days. Appointment records are not persisted locally.

The current Tool UI keeps the social content calendar separate from the
read-only salon Appointments view. The intended mobile appointment experience
is agenda-first: Today by default, swipeable week strip, optional month date
picker with booking dots/counts, and appointment details in a bottom sheet.
The month picker selects dates; it is not a crowded month-grid appointment
display. Square remains authoritative, and the appointment calendar is read-only.

This existing Square route depends on the current browser's Square OAuth
session. It is same-origin for the Tool and is not directly callable from John's
separate static `mknails` site. The proposed Clerk/workspace route
`GET /api/v1/workspaces/{id}/appointments` is **not implemented**. Integration
requires an agreed same-origin server-side gateway or that future authenticated
workspace endpoint and durable workspace-owned Square credentials. Do not use
the browser Square cookie as cross-site auth or expose provider credentials.

Current errors are `{ "code": "...", "error": "Readable message" }` where a code
is supplied. Preserve this compatibility until a versioned API is introduced.

## Versioned private API

All routes require a provider-verified app session and active membership in the
specified workspace. IDs identify resources; they do not grant access.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/session` | Implemented in source: current identity and authorized workspace memberships |
| GET | `/api/v1/workspaces/{id}/capabilities` | Implemented in source: membership check; modules/integrations are not enabled |
| GET | `/api/v1/workspaces/{id}/appointments` | Time-bounded, paginated appointments with sync freshness |
| POST | `/api/v1/workspaces/{id}/appointment-proposals` | Draft an explicit proposed provider change; no execution |
| POST | `/api/v1/workspaces/{id}/appointment-proposals/{proposalId}/approve` | Approve the exact unexpired proposal; queue controlled execution |
| GET | `/api/v1/workspaces/{id}/commands/{commandId}` | Execution status and conflict/failure details |
| GET | `/api/v1/workspaces/{id}/notifications` | User-scoped inbox and unread state |
| PATCH | `/api/v1/workspaces/{id}/notifications/{notificationId}` | Mark this user's inbox item read |
| GET, PATCH | `/api/v1/workspaces/{id}/notification-preferences` | Event/channel preferences and quiet hours |
| GET | `/api/v1/workspaces/{id}/integrations` | Provider health and scopes; never raw credentials |
| GET | `/api/v1/workspaces/{id}/social/insights` | Authorized, timestamped metrics with availability status |

Initial v1 successes and future routes use `{ "data": ..., "meta": { "requestId": "..." } }`.
Paginated collections add `meta.nextCursor`; freshness includes `lastSyncedAt`,
provider timestamps and a sync state. Errors use
`{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
These conventions follow BORG's structured-error pattern without changing the
existing Square routes during this planning phase.

Frontend states must distinguish loading, disconnected, permission required,
empty, stale (only when the frontend intentionally retains an earlier
successful result), partial, provider unavailable and current. For the existing
live Square route, an empty successful list means no returned bookings in the
range; a request failure is not empty. A provider error must never become an
empty schedule or zero engagement. Write-capable controls must depend on
server-returned capabilities and still be authorized by the backend.

## Optional future public API

`GET /public/v1/services` may provide published names, descriptions, display
prices/durations and approved Square booking URLs. This route must never expose
internal booking records, occupancy, customer data or integration secrets. A
public backend feed is optional; the existing direct Square links do not need
to be replaced to connect the private business backend.

## Integration acceptance

1. Publish an OpenAPI contract and non-production fixtures when routes exist.
2. Agree on production/staging domains, authentication and exact allowed origins.
3. Verify user/workspace isolation and public/private response separation.
4. Test John's frontend against each error and freshness state, not just success.
5. Verify OAuth callback/refresh, pagination, provider failures and command conflicts.
6. Enable one tested module at a time; retain Square booking links and Mya's
   existing operational workflow during rollout.
