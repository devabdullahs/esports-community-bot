# EWC Prediction Dashboard

Next.js App Router dashboard for EWC prediction leaderboards and Discord profile showcase sync.

```bash
npm run web:auth:migrate
npm run web:dev
```

The app shares `DB_PATH` with the Discord bot and exposes internal sync endpoints protected by
`EWC_DASHBOARD_INTERNAL_SECRET`.

## Admin roster

Set `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` to a comma-separated list of Discord user IDs
that should have full admin access. Sign in with Discord at `/login`, then visit `/admin` to
manage news and media content. Super admins can add and configure scoped staff (per-game and
per-media-channel access) at `/admin/team`.

The legacy variable `EWC_DASHBOARD_ADMIN_DISCORD_IDS` is still honored and grants the same
super-admin level — prefer `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` for new deployments.

## Image uploads (Cloudflare R2)

Cover images for news posts are uploaded to Cloudflare R2 (S3-compatible object storage).
R2 is optional — skip this section if you want admins to paste image URLs instead.

1. Create an R2 bucket in the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Enable public access on the bucket (or connect a custom domain).
3. Create an R2 API token scoped to that bucket with **Object Read & Write** permissions.
4. Set the following env vars:

   ```
   R2_ACCOUNT_ID=<your-cloudflare-account-id>
   R2_ACCESS_KEY_ID=<r2-token-access-key-id>
   R2_SECRET_ACCESS_KEY=<r2-token-secret-access-key>
   R2_BUCKET=<bucket-name>
   R2_PUBLIC_BASE_URL=https://<your-bucket-public-domain>
   ```

5. `R2_PUBLIC_BASE_URL` should be the bucket's public or custom domain (no trailing slash).

Allowed upload formats: PNG, JPEG, WebP, GIF, AVIF (SVG is excluded — it can carry scripts).
Maximum file size: 8 MB. Uploads are stored under `news/YYYY-MM-DD/<uuid>.<ext>`. Until all
five vars are set, the upload endpoint returns 503 and admins can paste image URLs instead.

## Security & data handling

### Storage

All persistent state lives in a single SQLite file at `DB_PATH` (production default `/app/data/bot.sqlite`, bind-mounted from the NAS volume via `compose.ugreen.yml`). The database contains:

- **better-auth tables** — `user` (includes email address), `session` (includes IP address and user-agent), `account` (Discord OAuth access/refresh tokens encrypted at rest; `encryptOAuthTokens: true` is set in `src/lib/auth.ts`).
- **`ewc_profile_links`** — maps better-auth user IDs to Discord user IDs for the prediction profile sync.
- **Admin scope tables** — managed via `@bot/db/ewcAdmins.js`; store per-Discord-ID game and media-channel assignments.

News upload media is stored in Cloudflare R2-compatible object storage. The upload route writes objects under a `news/` key prefix. Required credentials: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. Until these are set the upload endpoint returns a 503 and admins can paste image URLs instead.

### Trust boundaries

| Surface | Auth mechanism | Failure |
|---|---|---|
| Public routes (`/`, `/leaderboard/*`, etc.) | None required | — |
| `/api/me/*` | better-auth session cookie | 401 |
| `/api/internal/*` (bot sync) | `x-ewc-internal-secret` header matched against `EWC_DASHBOARD_INTERNAL_SECRET`; fail-closed (missing secret rejects all callers) | 401 |
| `/api/admin/*` | Per-route `getAdminAccess()` check | 401 no session / 403 not allowed |
| `/admin` pages | Layout guard in `src/app/admin/layout.tsx` | anonymous → redirect `/login`; authenticated non-staff → 404 (does not advertise the admin area) |

**Super admins** are declared in `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` (comma-separated Discord user IDs). The legacy variable `EWC_DASHBOARD_ADMIN_DISCORD_IDS` is also accepted and grants the same super-admin level for back-compat. **Scoped admins** are managed in-app and stored in the database via `@bot/db/ewcAdmins.js`.

> **Warning:** The local development auth bypass (`EWC_DASHBOARD_DEV_AUTH_BYPASS`) acts as a super admin. It is disabled in production builds via a `NODE_ENV` gate in `src/lib/dev-auth.ts`. Never set `EWC_DASHBOARD_DEV_AUTH_BYPASS` on any host reachable over a network.

### Operational

- **HTTPS required in production.** Session cookies are set with `useSecureCookies: true` when `NODE_ENV === "production"` (see `src/lib/auth.ts`). Run behind a TLS-terminating reverse proxy.
- **Keep `.env` and `.env.docker` out of off-NAS backups** — they contain `BETTER_AUTH_SECRET` and Discord OAuth credentials.
- **Secret generation:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Rotating `BETTER_AUTH_SECRET`** invalidates all active sessions and all stored encrypted OAuth tokens simultaneously. Plan for users needing to re-authenticate.

### Content Security Policy

A `Content-Security-Policy` header is enforced in **production only** (`NODE_ENV=production`). It is intentionally absent in dev mode so that Next.js HMR (WebSockets, eval) continues to work.

Key directives and rationale:

- **`img-src 'self' data: blob: https:`** — news cover images are admin-pasted `https://` URLs (validated by `safe-url.ts`); a blanket `https:` is deliberate and required here.
- **`font-src 'self' https://assets.moonbot.info [r2Host]`** — the Thmanyah font families are loaded via `@font-face` from `assets.moonbot.info`. If `R2_PUBLIC_BASE_URL` is set, its origin is derived at build/start time and appended automatically. **Changing `R2_PUBLIC_BASE_URL` requires a container restart** for the new origin to take effect in the header.
- **`script-src 'self' 'unsafe-inline'`** — Next.js App Router emits inline hydration scripts. Tightening this to a nonce-based policy requires middleware plumbing and is tracked as the next hardening step (deferred follow-up).
- **`frame-ancestors 'none'`** — supersedes `X-Frame-Options: DENY` for supporting browsers.

### Non-goals

- **No disk-level database encryption.** The NAS volume is the physical trust boundary; whole-disk or file-level encryption at rest is out of scope for this project.
