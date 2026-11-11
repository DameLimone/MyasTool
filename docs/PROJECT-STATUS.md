# MyasTool shared development status

Updated November 11, 2026 (America/Chicago).

## Shared source and deployment

- Canonical backend/Tool repository: https://github.com/DameLimone/MyasTool
- Production branch: main.
- Production Tool: https://myas-tool.vercel.app
- Vercel project: myas-tool, POC’s projects.
- Public website maintained separately by John: stonksmasters/mknails.
- BORG reference template: stonksmasters/Audit.

This reconciliation found main synchronized before the appointment fix, no open
pull requests, and no other GitHub branches. Older local agent checkpoint refs
are historical snapshots; they omit newer authentication/settings work and must
not replace main wholesale. Uncommitted changes in other chats or Copilot sessions
are not automatically available here. Fetch main before editing; pull/rebase
before pushing and resolve overlaps deliberately. Never force-push shared main.

## Current behavior

The Tool gates business screens and Square APIs with Clerk sign-in plus active
workspace approval. The explicitly designated owner is dambienb@gmail.com after
provider-verified sign-in. Only the owner approves/revokes registered people;
admins edit business settings and members view them.

Settings persist in Supabase and active screens refresh every five seconds,
preserving drafts when another editor changes the saved revision. Content drafts
and media remain browser-local and isolated by signed-in user and workspace.

Square authorization is encrypted and browser/user-bound. Returning successfully
from Square opens Appointments (next seven days), or returns to Calendar when
connected there, then fetches a fresh schedule. The calendar loads six weeks
using authenticated requests and shows a selected-day agenda on mobile. Times
come from the selected Square location timezone. Existing bookings are read-only.
The connection status does not itself guarantee appointment permissions.

## Still pending

- Clerk production-instance provisioning (current UI shows Development mode).
- Shared durable Square seller credentials, webhooks and background reconciliation.
- First-party availability/holds/booking, cancellation and rescheduling.
- Notification delivery (the one-hour reminder preference is saved only).
- John's public frontend integration and social engagement integrations.

Public booking remains disabled. This release does not invent available slots or
change any Square appointments. See APP-ACCESS.md, CONFIGURABLE-SCHEDULING.md and
SCHEDULING-BACKEND-STATUS.md for details.

## Verification

Backend tests and production build pass. Playwright browser checks use synthetic
roles and appointment data for desktop/mobile OAuth return, authenticated calendar
requests, month navigation and Central start/end times. Live signed-out access
checks verify the real Clerk form and 401s from private APIs. Real seller schedules
must be checked in the owner's signed-in browser; browser credentials are not
requested or copied into chat.
