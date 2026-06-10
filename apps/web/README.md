# EWC Prediction Dashboard

Next.js App Router dashboard for EWC prediction leaderboards and Discord profile showcase sync.

```bash
npm run web:auth:migrate
npm run web:dev
```

The app shares `DB_PATH` with the Discord bot and exposes internal sync endpoints protected by
`EWC_DASHBOARD_INTERNAL_SECRET`.

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

### Non-goals

- **No disk-level database encryption.** The NAS volume is the physical trust boundary; whole-disk or file-level encryption at rest is out of scope for this project.
- **No Content Security Policy yet.** CSP is deferred; a future iteration should add it to the security headers in `next.config.ts`.
