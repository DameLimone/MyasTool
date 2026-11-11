# Mya backend — powered by BORG

## Agreed scope

Build the business backend in this repository. John owns the website frontend in
`stonksmasters/mknails`. Use `stonksmasters/Audit` as an architectural template.
Develop the pieces separately and integrate through documented APIs later.
Preserve Mya's Square workflow while the backend is built and verified. Existing
screens in this repository are a temporary integration/test surface; frontend
redesign is outside this phase.

## Reference review

Reviewed on 2026-11-11:

- BORG Audit: commit `3086f8aaa7905bb8eda7f0e72328c36196081d30`.
- MK Nails: commit `189424fd17367d12e93180844157aa5793a1eee3`.

Audit provides a multi-organization CRM, PostgreSQL repositories and migrations,
server-validated access, organization settings, activity records, background
queues, mobile notification preferences and delivery tracking. Its architecture
documentation includes both implemented code and deployment targets; these are
not evidence that every subsystem is running in production.

The MK Nails snapshot contains `README.md` and `mk-lounge-deploy.tar.gz`. The
archive contains a static `dist/index.html`, `dist/app.js`, styles and photos,
not a source/build project. Its JavaScript has service tabs, navigation and
Square service-specific booking links. It makes no backend API requests. It
links to Instagram but does not retrieve engagement metrics.

## Adapt the platform patterns

| BORG reference | Mya adaptation |
| --- | --- |
| `db/migrations/006_multi_tenant.sql` | Organization/workspace identity; require explicit Mya membership for every private resource |
| `auth.ts`, `lib/server/auth.ts` | Provider-verified app sign-in plus database-verified membership; Square OAuth remains an integration authorization |
| `db/migrations/010_jobs_and_org_settings.sql` | Per-organization enabled modules, timezone and workflow settings |
| `lib/server/repositories.ts` | Database access through organization-scoped repositories |
| `lib/server/http.ts` | Validated input, stable error codes and request IDs |
| `lib/server/queue.ts` | Durable jobs, retries and idempotency; choose a deployment-supported executor |
| `db/migrations/020_mobile_push_notifications.sql` | Per-user device registrations and opt-in notification channels |
| `db/migrations/021_mobile_push_reminder_deliveries.sql` | Delivery deduplication and reminder history |
| `app/api/mobile/v1/notification-preferences/route.ts` | Member-owned event preferences and reminder controls |
| `app/api/webhooks/square/route.ts` | Verify raw-body signatures, commit state transactionally and deduplicate events |

Do not copy BORG's existing-tenant seed records, customer data, admin assignments,
global administrator bypass, business-specific workflows or secrets. The BORG
Square adapter currently uses a configured access token and payment webhooks;
Mya needs seller OAuth, appointment events and account-specific credentials.
The BORG scheduler is a reference, not a replacement for Square's calendar.

## Current implementation versus target

| Capability | Current local/deployed implementation | Required backend target |
| --- | --- | --- |
| Square connection | Browser-specific encrypted OAuth session; user reports connection confirmed | Workspace-owned encrypted credentials in durable storage; background refresh and disconnect/revocation |
| Appointments | Read-only list, location/timezone filters, permission checks | Durable sync state, reconciliation and verified event ingestion |
| App sign-in | Not implemented | Individual sign-in, membership, role and revocation checks |
| Operational storage | Posts/media are browser-local; no operational database | PostgreSQL organization-scoped records and migrations |
| Booking changes | Not implemented | Proposed command, explicit approval, provider version checks, idempotency and audit history |
| Notifications | Not implemented | Durable inbox, preferences, quiet hours, delivery outbox, retries and channel registration |
| Social accounts/metrics | Not implemented; public Instagram links only | Authorized provider adapters and timestamped metric snapshots |
| Website integration | Public website uses direct Square links | Optional public catalog API; private data only in authenticated business surfaces |

## Backend modules and ownership of truth

1. Identity and workspaces: users, memberships, organization settings and roles.
2. Integrations: provider accounts, encrypted credentials, granted scopes,
   connection health and revocation state.
3. Appointments: Square booking/location/service identifiers, provider versions,
   sync checkpoints and timestamps. Square remains authoritative.
4. Appointment commands: proposals and approvals for changes; do not treat a local
   edit as a successful Square update. Uncertain results require reconciliation.
5. Clients: provider-linked identities and consent-based business notes. Do not
   import contacts or request customer scopes until that module is implemented.
6. Events and notifications: verified provider events, internal events, inbox
   records, preferences, channel subscriptions, delivery attempts and dedup keys.
7. Social insights: account connections, supported metrics, time ranges,
   collection timestamps and permission/provider availability.
8. Activity/audit: actor, organization, action, provider resource/version,
   approval and outcome; redact tokens and unnecessary personal data.

Every child record must retain organization ownership. Repository queries and
foreign-key relationships must prevent attaching one organization's resources
to another. Clients cannot supply a trusted organization just by setting a
header, body field or context cookie. BORG support access, if needed, must be an
explicit grant with audit records rather than unrestricted cross-tenant access.

## Delivery sequence

### 1. Durable authenticated foundation

Implement app authentication, memberships, scoped PostgreSQL repositories and
migrations. Match BORG naming/conventions where useful without importing its
entire Next.js application. Keep Mya's existing Vercel HTTP backend; select a
Postgres provider and supported worker runtime before provisioning infrastructure.
Do not run a permanent BullMQ worker inside a request-based Vercel Function.

Acceptance: two-user/two-workspace isolation tests; disabled users denied; scoped
transactions; migration verification; no provider credentials returned to clients.

### 2. Move Square ownership to the workspace

Complete a new server-backed OAuth connection after app sign-in. The existing
browser credential cookie is a transitional implementation, not background
storage. Keep read access working during migration. Do not silently authorize a
different seller or disconnect the current account before the replacement works.

Acceptance: refresh/revocation tests, multi-device access through membership,
encrypted durable credential storage and explicit connection health.

### 3. Appointment sync and event ingestion

Verify Square webhook signatures against the exact registered URL and raw body.
Deduplicate by provider account/event ID, persist before acknowledging, and queue
processing. Reject unrecognized merchant ownership. Handle retries, out-of-order
events, provider rate limits and periodic reconciliation.

Acceptance: repeated events do not duplicate appointments or alerts; old versions
cannot overwrite newer data; downtime recovery and freshness state are visible.

### 4. Notification backend

Begin with a durable in-app inbox. Add delivery channels separately after device
registration and preference controls exist. Events may include booking changes,
cancellations, sync failures and connection expiry. Quiet hours and digests must
use the business/user timezone. Preferences belong to each authorized user.

Acceptance: transactional event/outbox creation, retries, delivery deduplication,
failed-delivery history, quiet hours and opt-out behavior. Do not send customer
messages or enable every alert by default.

### 5. Controlled appointment changes

Add write scopes only when the command flow is implemented. Proposed changes
must record the provider booking version, proposed effect and expiry. Approval
must bind to that exact proposal and authorized actor. Execution must verify
current provider state, use idempotency, and distinguish succeeded, failed,
conflicted and uncertain outcomes. No automatic waitlist reassignment.

Acceptance: stale proposals fail safely, repeated approvals cannot double-execute,
and every result is auditable. Square continues to control actual availability.

### 6. Social insights and frontend integration

Add providers independently, starting with Mya's actual account types and supported
official APIs. Store only granted data and identify missing/unsupported metrics;
never fabricate engagement. John connects the website and any future private
dashboard against the contract in `docs/FRONTEND-INTEGRATION.md`.

## Rollout rule

Build and verify backend modules before changing Mya's routine. Keep incomplete
modules disabled. Background jobs, customer messages, booking writes and channel
deliveries require their own completed configuration and acceptance checks.

This document is the reviewed implementation blueprint. It does not mean the
database, authentication, worker, notifications or social adapters are built.
