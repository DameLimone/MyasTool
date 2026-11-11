# Scheduling handoff — database milestone

Updated 2026-11-11. Reference: the supplied `BACKEND-SCHEDULING-HANDOFF.md`.
This is implementation status, not approval to replace Square or enable booking.

## Connected database

- Supabase project: **MyasTool**, `vegyorhmxmmxkcwzkspl`.
- Region: `us-west-2`; PostgreSQL 17.
- Project inspected empty before applying additive migrations.
- Existing identity/workspace/jobs schema applied, followed by scheduling schema,
  access-policy optimization and the activation guard.
- Source migrations are in `db/migrations` and `supabase/migrations`. The existing
  `npm run db:migrate` runner reads both directories and preserves checksums.
  Hosted bootstrap also records those checksums, so later runtime migrations
  will not attempt to create the same tables again.

The user's subsequent confirmation has now configured the MK Manikure Lounge
organization and disabled provider/resource, Saturday/Sunday 10:00–17:00 hours,
Central timezone, zero buffers, three-calendar-month horizon and required contact
fields. See [confirmed rules](SCHEDULING-RULES.md). Booking remains disabled, and
new booking notice is confirmed at 24 hours; advance cancellation terms remain
unconfirmed. A 60-minute appointment-reminder preference is stored but delivery
is not implemented. No application users, memberships,
service menu, customer records or appointments have been seeded.
The schema was applied through the Supabase connector. Vercel now has a restricted
runtime pooler connection and Clerk keys. The authenticated Tool settings screen
refreshes every five seconds. See APP-ACCESS.md for owner approval and the remaining
Clerk production-instance requirement.

## Implemented and verified

| Area | Database implementation |
| --- | --- |
| Identity | Existing organizations, Clerk user IDs and memberships, with RLS |
| Services | Published main services/add-ons, integer minor-unit prices, duration, revisions and compatibility relationships |
| Rules | Provider/resources, recurring hours, date exceptions, buffers, notice/horizon and short hold configuration |
| Capacity | One occupancy ledger for holds, bookings, blocks and Square-imported busy times |
| Overlap | PostgreSQL GiST exclusion constraint rejects overlapping active occupancy for the same organization/resource; adjacent intervals are allowed |
| Holds | Expiry and hashed capability fields; expired rows continue to block conservatively until transactionally released |
| Bookings | Confirmation references, encrypted customer-data storage fields, explicit default-false marketing consent |
| Retry groundwork | Organization/operation-scoped idempotency records with request hashes; no retry handler is implemented yet |
| Square continuity | Deduplicated source-ID storage, service snapshots, source versions/timestamps and reconciliation report storage |
| Audit | Organization-scoped event storage |
| Launch gate | Public booking defaults off; database activation requires confirmed rules, a closed-Square-write boundary and a fresh, owner-approved, zero-conflict/zero-gap reconciliation report covering the cutover range and correct seller/location |

The launch gate validates the report that was supplied. It cannot prove an import
or a manual closure actually occurred: those require the importer, audit trail
and operational acceptance below. Freshness must also be checked on every future
availability/hold/confirmation request; an activation-time check is insufficient.

All 17 application tables have RLS enabled. The private `scheduling` schema has
no `anon` or `authenticated` schema/table access. Application identity remains
Clerk, verified by the backend. Trusted server transactions set the user context;
future scheduling transactions must additionally verify membership and set the
organization context. Never grant callers an RPC that can set this context.

The schema has fields for ciphertext; encryption/decryption and key rotation
have not been implemented for these new records. Do not insert plaintext customer
data into the ciphertext fields. Appointment notes have not been added/imported.

## Not implemented or enabled

1. Public catalog, availability, hold and confirmation HTTP handlers.
2. Server-side canonical quote and service-kind/compatibility validation. Foreign
   keys prevent cross-organization combinations; the service must also enforce
   exactly one main service and permitted add-ons.
3. Schedule calculation, DST handling, atomic hold/confirmation transactions,
   expiry cleanup, bounded payload validation and idempotent replay handling.
4. Public rate limiting/abuse protection and exact-origin/gateway configuration.
5. Catalog, blocks, cancellation and rescheduling APIs. The owner/admin scheduling
   configuration GET/PATCH handlers are now implemented and tested in source;
   see [Configurable Scheduling](CONFIGURABLE-SCHEDULING.md). Runtime deployment
   and John's settings screen still require integration.
6. Workspace-owned durable Square OAuth credentials, token refresh, complete
   upcoming-booking backfill, customer-data permission checks and reconciliation.
7. Verified Square event ingestion, sync cadence, failure/staleness handling and
   conflict resolution. No Square data has been migrated or canceled.
8. Owner-readable migration report and explicit operational sign-off.
9. Notifications/delivery outbox, customer confirmation channels, customer
   self-service management and optional waitlist.
10. The final public scheduling OpenAPI paths/fixtures for John. Existing
    `docs/openapi.json` describes the private foundation and scheduling settings
    endpoints; it is not the final first-party booking contract.

## Next implementation sequence

1. Complete the owner�s verified sign-in and Clerk production-instance setup;
   verify the live authenticated settings flow.
2. Implement private catalog/schedule controls and collect Mya-approved rules.
3. Implement Square import/reconciliation with scoped durable credentials;
   preserve source truth even when a conflict prevents occupancy insertion.
4. Implement authoritative availability, hold and confirmation APIs against this
   schema, with rate limits and synthetic fixtures. Keep booking disabled.
5. Test concurrent attempts, expired holds, mismatched idempotency, permission
   failures, stale Square state, cutover and rollback before production acceptance.
6. Publish the tested OpenAPI contract and integrate John's frontend. Enable
   first-party booking only after the migration report and cutover are approved.

## Verification evidence

- Local PostgreSQL-compatible integration tests cover overlap rejection,
  adjacent appointments, expired hold release, organization FK isolation,
  duplicate Square source IDs, report approval and RLS.
- Hosted Supabase transaction verified overlap rejection and disabled-launch
  constraints. Synthetic verification rows were rolled back. The later confirmed
  configuration seeded the real organization and its disabled scheduling rules.
- Security advisor has only the two informational deny-by-default notices for
  `public.jobs` and `public.schema_migrations`, which intentionally have no client
  policies: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Performance advisor reported per-row context lookups. A follow-up migration
  wrapped these in statement-level SELECTs; the actual hosted `pg_policies`
  definitions were checked. The advisor still returned the previous warning
  immediately afterward; retain this note until its next refreshed scan.
  https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
- Unused-index information is expected on an empty project; retain the
  organization/FK and conflict-protection indexes for runtime queries.

No public booking cutover, customer communications, payment collection, frontend
changes or Vercel release are part of this database milestone.
