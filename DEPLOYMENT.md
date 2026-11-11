# Vercel deployment

- Production: https://myas-tool.vercel.app
- Project: `myas-tool` in `poc-s-projects33`
- Framework: Vite; build: `npm run build`; output: `dist`
- Health endpoint: `/api/health`

The initial release includes the current local working tree, including changes
that were not committed to Git. It was deployed using the authenticated Vercel
CLI. The project is now linked to `DameLimone/MyasTool`, production branch `main`.
The working-tree updates still need to be committed and pushed so subsequent Git
deployments include this hosted OAuth implementation.

This release hosts the prototype interface, health API, and Square OAuth API. Posts and uploaded
media remain in each browser's IndexedDB. Local records are not copied to the
hosted origin, and there is no shared storage or application sign-in.

The hosted `/api/square/*` endpoints use `server/hosted-square.js`. Each browser
authorizes its own seller through Square OAuth. Credentials are encrypted with
AES-256-GCM into a Secure, HttpOnly, SameSite=Lax, host-only session cookie; they
are never returned to frontend JavaScript. The cookie expires after 30 days.
Checking status refreshes tokens within one day of expiry and verifies the seller
against Square. Revoked credentials clear the session. OAuth state is encrypted,
browser-bound, and expires in ten minutes; Square authorization codes are single
use. Reconnecting an active session cannot silently switch sellers.

There is no shared seller connection or background access when the browser is
closed. Each device must connect separately, and clearing cookies disconnects
that browser. This supports the current read-only appointments view;
shared accounts or background booking automation require authenticated workspace
membership and durable server-side credential storage.

## Read-only appointments

Open **Appointments** from the navigation or Home. Today and Next seven days use
the selected Square location's timezone, including daylight-saving transitions.
The seven-day range includes today and the next six calendar days. Refresh reads
Square again; records are not stored in IndexedDB or shared with another browser.

OAuth requests `MERCHANT_PROFILE_READ`, `APPOINTMENTS_READ`,
`APPOINTMENTS_ALL_READ`, and `ITEMS_READ`. Existing connections must reauthorize
using **Allow appointment access**. The API checks the actual token scopes before
listing seller-wide bookings, so missing permissions cannot appear as an empty
schedule. Square account/subscription restrictions remain subject to Square.

Only read endpoints are used: token status, locations, bookings, and catalog batch
retrieval for service names. Customer names, contact details, notes, and payment
data are not returned. The view shows appointment time, service, duration, and
status, excluding canceled/declined bookings. Pagination is capped at 1,000 results
with an explicit warning; catalog failures leave appointments visible with a
service-name warning. There are no booking writes or customer messages.

Production environment variables:

- `SQUARE_ENVIRONMENT=production`
- `SQUARE_APP_ORIGIN=https://myas-tool.vercel.app`
- `SQUARE_APPLICATION_ID` and `SQUARE_APPLICATION_SECRET` from Square's Production OAuth tab
- `SQUARE_TOKEN_KEY`: generated 32-byte hex encryption key, stored as a Secret

Register `https://myas-tool.vercel.app/api/square/callback` in the Square
application's Production OAuth redirect URLs. Redeploy after adding credentials.
Until configuration is complete, the UI reports setup pending and disables the
connect button. No Sandbox credentials are promoted to Production.

The localhost OAuth implementation in `server/square.js` remains available through
`npm run dev`. No local credentials or token files were uploaded.

To release an update from this directory:

```powershell
npm test
npm run build
npx vercel@65.14.0 project inspect --non-interactive --scope team_idX53HqSADt11URLNGX4WhPY
npx vercel@65.14.0 deploy --prod --skip-domain --scope team_idX53HqSADt11URLNGX4WhPY --yes
# Verify the returned deployment URL, then promote that exact deployment:
npx vercel@65.14.0 promote <deployment-url> --scope team_idX53HqSADt11URLNGX4WhPY --yes
```

Secrets and local token files are excluded by `.vercelignore` and Git ignores.
