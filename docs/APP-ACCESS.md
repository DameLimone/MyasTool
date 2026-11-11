# Private app access and settings

Clerk is provisioned through Vercel Marketplace. The Production deployment has
server-side Clerk verification and a restricted Supabase runtime login with
verified TLS. Its public CA is bundled at server/backend/supabase-ca.crt, from
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
(the certificate URL used by the official Supabase dashboard).

The SPA opens browser storage and business screens only after authenticated
session verification and active workspace membership. Registering does not grant
access. Signed-in unapproved people see their user ID for owner approval.
The explicitly requested initial owner, dambienb@gmail.com, receives owner
membership only after Clerk confirms that email is verified. The bootstrap never
transfers or restores an existing owner. No passwords or verification codes are
requested by the Tool's backend.

The Marketplace provisioned a Clerk development instance (pk_test). The sign-in
screen labels Development mode. Configure a Clerk production instance and its
domain before treating authentication provisioning as production-ready. Keep
secret keys server-side and redeploy after changing environment variables.

Owner-only GET/POST /api/v1/workspaces/{workspaceId}/members manages approved
registered user IDs. Approvals may assign member or admin. Only owners approve
or revoke people; admins edit settings; members read settings. Owner membership
cannot be changed through this endpoint. Access changes are audited. No invites
or emails are sent. Revocation takes effect on the next private API request;
open screens recheck membership every 15 seconds and on focus.

Square APIs require approved app access. Connecting Square additionally requires
owner/admin. Its encrypted OAuth state binds the initiating user and the callback
rechecks current approval. Square session cookies are user-bound, so a connection
from before this release must be reconnected once. Square is still per-browser;
it is not yet a shared server-side seller integration for every approved person.

Business settings are persisted in Supabase. Open settings screens refresh every
five seconds and on focus. A remote update preserves an unsaved draft and blocks
saving until the user explicitly loads the latest revision. All PATCH writes use
revision checks and atomic audit records. This is polling, not instant push.

Content drafts/media/reviews remain browser-local, isolated by user and workspace.
Existing anonymous prototype storage is retained but not automatically imported.
The separate public website is not changed or protected by this app gate. John's
site still needs its scheduling integration and a deliberate public projection;
private configuration and membership endpoints must never become anonymous.

Notification timing is saved configuration; reminder delivery is not implemented.
Public booking remains disabled. Square appointment reads split six-week calendar
ranges into bounded requests, and invalid requests no longer erase valid tokens.

Validation: automated backend/RLS tests and browser checks using synthetic roles
cover gating, saves, cross-screen refresh, draft preservation and mobile width.
Actual Clerk sign-in UI was loaded without browser errors. The owner must complete
their own sign-in to verify initial membership and the live authenticated flow.
