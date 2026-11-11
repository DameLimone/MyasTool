# Frontend handoff: Mya backend foundation

Audience: frontend engineer integrating Mya's private business API.

## Status and scope

The backend has two phase-one private API handlers in source:

- `GET /api/v1/session`
- `GET /api/v1/workspaces/{workspaceId}/capabilities`

They verify a Clerk session, look up the caller in PostgreSQL, and require an
active database membership before returning workspace data. Capabilities are
currently empty. There are no appointments, notifications, client records,
booking changes, or social insights in `/api/v1` yet.

**Integration is not live-ready yet.** No Clerk application or Supabase database
has been configured or provisioned for this API, and the existing frontend has
no Clerk sign-in UI. The source routes fail closed until the backend environment
is configured. Do not treat this as a deployed or production-ready sign-in
system.

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

## Keep existing workflows intact

- The existing Calendar screen is now the shared month view for content and
  read-only Square appointments. Its **Everything**, **Content**, and
  **Appointments** buttons let Mya hide either side when the calendar is busy.
  Month changes and the refresh button reload that month from Square.
- Calendar appointments use
  `/api/square/appointments?range=custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`.
  The start is inclusive, the end exclusive, and the maximum range is 42 days.
  Appointments display in the selected Square location's timezone; content posts
  remain in the device's timezone.
- Appointment entries are never written to IndexedDB or edited by the calendar.
  Square remains authoritative. If Square is disconnected or needs permission,
  the calendar shows the error and a connect/allow-access action instead of
  pretending there are no appointments.
- Keep the public site's existing Square booking links. There is no public
  catalog endpoint yet.
- Keep the existing Square read-only flow as-is in this phase. Its browser-bound
  Square OAuth session is not an app session and is not shared across devices.
- Do not add booking writes, customer messaging, notifications, client data, or
  social metrics based on the capabilities endpoint: those modules are not
  implemented or enabled.
- Do not call the proposed future routes in
  [FRONTEND-INTEGRATION.md](./FRONTEND-INTEGRATION.md) until they exist in the
  OpenAPI contract and have been enabled by the backend.
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
- [ ] Cross-origin behavior is not assumed; integration tests use the agreed
  same-origin/gateway arrangement or an explicitly configured origin.

## Backend references

- [backend setup and environment configuration](./BACKEND-SETUP.md)
- [OpenAPI contract](./openapi.json)
- [existing API inventory and future route plan](./FRONTEND-INTEGRATION.md)
- [synthetic success and error fixtures](./fixtures/api-v1/)
