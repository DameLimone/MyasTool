# Backend foundation setup

Phase 1 adds server-side app identity and workspace membership APIs. The MyasTool
Supabase database is now provisioned and its identity and disabled scheduling
foundation schemas are applied. See [scheduling status](SCHEDULING-BACKEND-STATUS.md).
This does not add a sign-in screen, import business records, or configure the
Vercel runtime connection. Existing browser-local screens and Square OAuth remain
separate and unchanged by the database milestone.

## Selected runtime

- **Database:** Supabase Postgres, using its transaction pooler for short-lived
  Vercel Function connections.
- **App identity:** Clerk session tokens, verified by the backend with exact
  authorized-party origins.
- **Jobs:** PostgreSQL-backed durable job records, intended for bounded Vercel
  Cron invocations. No Cron schedule or job processor is enabled yet.

## Configuration

Set these server-side environment variables in the local environment or Vercel.
Do not use `VITE_` prefixes or expose them to browser code.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_URL` | Supabase transaction-pooler URL used by application requests. Use a restricted runtime database role, not the project owner. |
| `CLERK_SECRET_KEY` | Clerk backend verification key. |
| `CLERK_PUBLISHABLE_KEY` | The matching Clerk instance's publishable key. |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated exact frontend origins, for example `http://127.0.0.1:5173,https://myas-tool.vercel.app`. Wildcards and non-loopback HTTP origins are rejected. |
| `SUPABASE_MIGRATION_URL` | Privileged Supabase transaction-pooler URL used only by the migration command; keep out of Vercel runtime variables. |

Use the Supabase Dashboard's **Transaction pooler** connection string. Connections
require TLS with certificate verification. Keep migration credentials separate
from the application's runtime role.
Create a restricted login role for `POSTGRES_URL`, not a database owner. After
running the migration as the privileged migration role, grant only the current
API's required access (replace `mya_runtime` with that role):

```sql
GRANT USAGE ON SCHEMA public TO mya_runtime;
GRANT SELECT, INSERT ON public.app_users TO mya_runtime;
GRANT SELECT ON public.organizations, public.organization_memberships TO mya_runtime;
```

Do not grant runtime access to `schema_migrations` or `jobs`; no worker is active.
Do not grant schema-changing privileges to the application role.

## Migrations

After configuring a non-production Supabase project and reviewing the migration,
run:

```powershell
npm run db:migrate
```

The runner records checksums, serializes concurrent migration attempts, rejects
edits to already-applied migrations, and applies each migration transactionally.
No organization, member, or business data is seeded. Create a workspace and
assign confirmed Clerk user IDs through an approved administrative process; the
API does not allow users to grant themselves membership.

The migrations have been tested against an embedded PostgreSQL-compatible engine
and applied to Supabase project `vegyorhmxmmxkcwzkspl`. The migration runner reads
the legacy `db/migrations` and new CLI-generated `supabase/migrations` directories.
The hosted schema records matching application migration checksums.

## Current API surface

- `GET /api/v1/session` verifies a Clerk session and returns only the caller's
  active workspace memberships.
- `GET /api/v1/workspaces/{workspaceId}/capabilities` also requires an active
  database membership. No business modules or capabilities are enabled yet.

Both routes return private, no-store responses with request IDs. Square seller
OAuth is not used as app sign-in. Hosted Square endpoints also require approved app access; OAuth is user-bound.
The same API handlers are mounted in local Vite development and deployed as
Vercel Functions.

## Not enabled

The private app gate, owner bootstrap, settings and approved-people screen are
implemented. Vercel Production has Clerk and a restricted TLS-verified Supabase
runtime connection. Clerk currently uses the Marketplace development instance;
production-instance provisioning and the owner's own verified sign-in remain
launch acceptance steps. See APP-ACCESS.md for exact behavior and limitations.
The jobs table remains groundwork: no notification worker or scheduled side
effects are active. Content drafts/media remain browser-local.
