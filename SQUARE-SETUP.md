# Square connection for MK Manikure Lounge

## Hosted Tool on Vercel

The hosted OAuth implementation is documented in [DEPLOYMENT.md](./DEPLOYMENT.md).
Use Production OAuth credentials for Mya's real seller account and register
`https://myas-tool.vercel.app/api/square/callback` in Square. Add credentials only
to Vercel server environment variables; never put them in chat or frontend code.
The connection belongs to the browser that authorizes it. Other browsers must
connect separately. It currently reads seller identity only.

## Local development implementation

This is a local single-owner implementation, served by Vite on `http://127.0.0.1:5173`. Use that exact address (not localhost). Square seller sign-in authorizes the integration; Square OAuth is not an app login or SSO system. No existing app authentication is present. The local OS account is the authorization boundary. Any process or person with access to this computer can use the local workspace. Do not expose the dev server through a tunnel, proxy, LAN, or public hosting.

## Configure

1. Create an application in the [Square Developer Console](https://developer.squareup.com/apps). Start with Sandbox credentials and a Sandbox test seller. For the salon's real account, select Production and use Production credentials.
2. Copy `.env.example` to `.env.local`. Set `SQUARE_ENVIRONMENT` to `sandbox` or `production`, the corresponding Application ID, and the OAuth Application secret (not a personal access token). Generate the 32-byte hex encryption key using the command in the example. Keep all values server-side; never prefix them with `VITE_` or paste secrets into chat.
3. Set the OAuth redirect URL to exactly `http://127.0.0.1:5173/api/square/callback`. Square permits HTTP loopback URLs for local testing; if the Production console requires HTTPS, use Sandbox locally and defer real-salon connection until a properly authenticated HTTPS backend exists. Do not work around this by publicly exposing this server.
4. Run `npm install`, then `npm run dev`. Open the exact address above. On Home or Studio settings, choose **Connect Square**. Sign in on Square as the appropriate seller, review the permission, and authorize. The callback saves credentials only after session-bound, expiring, single-use state validation. Check connection reads the merchant from Square; errors never count as connected.

Only `MERCHANT_PROFILE_READ` is requested. This reads the seller identity, not bookings, customers, payments, or waitlists. Sandbox status is labeled. One seller is pinned per environment and application; connecting another seller is rejected. Tokens are AES-256-GCM encrypted under `.square-private/`; restrict that directory and `.env.local` to the OS account using Windows ACLs. These files are ignored by Git. Preserve the encryption key; changing it makes stored tokens unreadable. Restarting the server invalidates local sessions and pending authorizations. Connections must be reauthorized at token expiry; automatic refresh is intentionally not implemented yet. Reconnect uses the same seller. Revoke access from Square's application management when no longer needed, then remove the local encrypted file while the server is stopped. No disconnect button claims to revoke access.

The backend exists only in `npm run dev`. Static builds and `npm run preview` do not provide OAuth endpoints. Public/shared use requires authenticated app users, per-workspace membership checks, per-account encrypted token storage, secure HTTPS cookies, refresh-token handling, revocation handling, and an authenticated production backend before enabling this flow.

## Later booking work

Square Plus and an enabled Square waitlist do not establish public waitlist API access. Cancellation detection, reassignment, rescheduling, and messages are not implemented. A later seller-level booking reader should assess `APPOINTMENTS_READ` and `APPOINTMENTS_ALL_READ` against the exact endpoints and seller subscription, plus location, team, catalog, or customer scopes only when needed. Do not request booking writes or customer messaging access until implementing those behaviors. Expanding scopes requires seller reauthorization.

Official references: [OAuth overview](https://developer.squareup.com/docs/oauth-api/overview), [authorization](https://developer.squareup.com/reference/square/o-auth/authorize), [token exchange](https://developer.squareup.com/reference/square/o-auth/obtain-token), [OAuth permissions](https://developer.squareup.com/docs/oauth-api/square-permissions).

## Verification

`npm test` includes mocked HTTP OAuth integration coverage; `npm run build` verifies the frontend bundle. Real Square authorization requires your developer application and seller approval; no credentials or real connection are included. Check denial, successful Sandbox authorization, reconnect with the same seller, and status failure after revocation before relying on the integration.
