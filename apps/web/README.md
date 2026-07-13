# Esports Community Web Dashboard

Next.js App Router dashboard for the Esports Community server. It is the public
site and staff CMS that sits beside the Discord bot.

The dashboard supports English and Arabic, including RTL layout for Arabic pages.
It shares the same database layer as the bot and can run against SQLite locally
or PostgreSQL in production.

## Features

- Public landing page for the community
- Game pages with tournaments, live matches, upcoming matches, and recent results
- News pages with bilingual content
- Media directory
- EWC prediction leaderboard and profile pages
- Discord login through Better Auth
- Discord Application Role Connection metadata sync
- Admin CMS for games, media, news, and staff scopes
- Audit log for staff actions
- Cloudflare R2 uploads for news cover images

## Local Development

Install dependencies from the repository root:

```bash
npm install
```

Use a disposable SQLite database for local preview:

```bash
DB_PATH="./data/dev-dashboard.sqlite" npm run seed:dev
npm run web:dev
```

The seed command creates sample games, news posts, media entries, prediction
leaderboard rows, and a local dev user.

For local auth-free preview, set:

```env
EWC_DASHBOARD_DEV_AUTH_BYPASS=true
EWC_DASHBOARD_DEV_DISCORD_USER_ID=100000000000000001
```

Do not enable the auth bypass on any network-reachable deployment.

## Database

The web app imports the shared bot database modules through workspace aliases.

Development options:

- SQLite: set `DB_PATH`.
- PostgreSQL: set `DATABASE_URL` and `DB_DRIVER=postgres`.

Production on CranL uses PostgreSQL:

```env
DB_DRIVER=postgres
DATABASE_URL=postgresql://...
PGSSLMODE=disable
```

Use `PGSSLMODE=require` only for endpoints that support SSL.

## Authentication

Better Auth handles Discord OAuth sessions. Required production variables:

```env
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://esportscommunity.net
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
```

Discord Developer Portal settings:

- OAuth redirect URL: `https://esportscommunity.net/api/auth/callback/discord`
- Linked Roles Verification URL: `https://esportscommunity.net/me`

The bot calls internal dashboard routes with:

```env
EWC_DASHBOARD_INTERNAL_URL=
EWC_DASHBOARD_INTERNAL_SECRET=
```

Internal routes fail closed if the secret is missing or wrong.

## Admin Access

Super admins are configured with:

```env
EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS=123,456
```

The legacy `EWC_DASHBOARD_ADMIN_DISCORD_IDS` variable is still accepted and
grants the same super-admin level. Scoped admins are managed in the dashboard and
stored in the database.

Admin areas:

- `/admin` - CMS overview
- `/admin/news` - news posts
- `/admin/games` - game records
- `/admin/media` - media directory
- `/admin/team` - staff scopes
- `/admin/audit` - audit log

Authenticated users without admin access receive a hidden/not-found style
response for admin pages.

## R2 Uploads

Cloudflare R2 is optional. When configured, admins can upload news cover images.

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=https://assets.esportscommunity.net
```

Allowed formats:

- PNG
- JPEG
- WebP
- GIF
- AVIF

SVG uploads are intentionally blocked because SVG can carry scripts. Maximum
upload size is 8 MB.

## Fonts

The site uses only Thmanyah Sans:

- Regular
- Medium
- Bold

The font base URL is controlled by:

```env
THMANYAH_FONT_BASE_URL=https://assets.esportscommunity.net
```

The app expects the font files under:

```text
thmanyahsans/woff2/
```

Do not use the Thmanyah display or serif font families in this dashboard.

## Security Headers

Production responses include a Content Security Policy. The policy allows:

- Same-origin application scripts and styles
- Cloudflare Insights if it is injected by Cloudflare
- HTTPS images for admin-provided media
- The configured R2 asset origin
- The configured Thmanyah font origin

Development mode does not use the production CSP so Next.js hot reload can work.

Private and dynamic routes should not be cached at the edge:

- `/api/*`
- `/admin*`
- `/login*`
- `/me*`

Static Next.js assets and icons can be cached aggressively through Cloudflare.

Cookie-free top-level public HTML responses advertise a 60-second CDN-only TTL
through `Cloudflare-CDN-Cache-Control`. Requests with any cookie, query string,
RSC/prefetch header, non-HTML accept header, asset-like path, or private route do
not receive that header. Browser caching remains controlled by Next.js.

Cloudflare still needs a Cache Rule that marks extensionless `GET`/`HEAD` HTML
as eligible only when the request has no cookies or query string and excludes
`/api`, `/_next`, `/admin`, `/login`, and `/me` (including `/ar` variants).
Keep Origin Cache Control and Cache Deception Armor enabled; never use a broad
Cache Everything rule that ignores cookies. After deployment, probe `/games`
and `/ar/games` twice for `MISS` then `HIT`, verify their `lang` values differ,
and confirm cookie/query/private/RSC requests remain `BYPASS` or `DYNAMIC`.

## Public Data Behavior

The dashboard reads from the bot database. Live pages update when the server data
changes and the page is refreshed or revalidated by Next.js. Client-side local
time formatting is used where user timezone matters.

## Commands

Run from the repository root:

```bash
npm run web:dev
npm run web:build
npm run web:start
npm --workspace @esports-community-bot/web run lint
npm --workspace @esports-community-bot/web run typecheck:native
npm --workspace @esports-community-bot/web run test
```

The native type-check command uses TypeScript 7 for fast production-source
diagnostics. Next.js and ESLint retain the TypeScript 6 compatibility API until
their programmatic integrations support the native compiler directly.

## Notes

- Keep `.env`, `.env.local`, and `.env.docker` out of git.
- Rotating `BETTER_AUTH_SECRET` invalidates active sessions and encrypted OAuth
  token data.
- Use HTTPS in production so secure cookies work correctly.
- Restart the web service after changing CSP-related origins such as
  `R2_PUBLIC_BASE_URL` or `THMANYAH_FONT_BASE_URL`.
