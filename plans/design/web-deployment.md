# Design: Deploy the web dashboard to the UGREEN NAS

> **Type**: Design spike — no code changes.  
> **Plan**: 024  
> **Date**: 2026-06-11  
> **Status**: Draft — awaiting operator answers to open questions.

---

## Goal

Make the EWC Predictions dashboard reachable by community members on the
public internet. The site is production-hardened (auth fail-closed, RBAC,
audit log, security headers, 107 web tests, bilingual) but currently only
runs on the developer's localhost. This document specifies the full deployment
topology so that a follow-up build plan can execute without surprises.

---

## 1. Image strategy

### 1a. Next.js `output: "standalone"` — CONFIRMED VIABLE

**Experiment performed on 2026-06-11 in worktree `agent-a91ca6f8e44c47ce4`.**

`output: "standalone"` was set temporarily in `apps/web/next.config.ts` and
`npm run web:build` was executed from the monorepo root.

**Result: build succeeded in ~6 seconds (Turbopack). All 40 routes compiled.**

Key evidence from the build output:

```
Route (app)
├ ƒ /
├ ƒ /admin
├ ƒ /api/auth/[...all]
├ ƒ /api/internal/ewc-profile/sync
├ ƒ /api/internal/ewc-profile/unlink
├ ƒ /leaderboard/[guildId]/[season]
└ ƒ /predictions
... (40 dynamic routes total)
```

**Standalone output structure** (`apps/web/.next/standalone/`):

```
standalone/
  node_modules/           ← slim dependency tree
    better-sqlite3/       ← present (package.json + full lib/ + .node binary)
    @aws-sdk/client-s3/   ← present
    bindings/             ← present (required by better-sqlite3)
    detect-libc/          ← present
    next/
    react/
    react-dom/
    sharp/
    ...
  <absolute-WORKDIR>/
    apps/web/
      server.js           ← standalone entry point
      .next/
        server/           ← RSC chunks + API route bundles
        ...
    node_modules/
      better-sqlite3/     ← full lib/ tree + build/Release/better_sqlite3.node
```

**Cross-workspace `@bot/*` imports**: Turbopack bundled `../../src/lib/` and
`../../src/db/` files directly into server-side RSC/route chunks. Inspecting
`_claude_worktrees_..._src_lib_ewcProfileStats_0g_ujov.js` confirms the bot's
DB schema initialisation code, `CREATE TABLE IF NOT EXISTS tournaments ...`,
is embedded. No `@bot/*` modules appear in standalone's `node_modules/` as
separate files — they are inlined by the bundler as expected.

**`better-sqlite3` as `serverExternalPackages`**: the native addon
(`better_sqlite3.node`) is correctly copied alongside the JS wrapper into
`standalone/node_modules/better-sqlite3/`. The `bindings` and `detect-libc`
helpers are also present.

**`@aws-sdk/client-s3` as `serverExternalPackages`**: the full AWS SDK tree
is present under `standalone/node_modules/@aws-sdk/`, `@aws-crypto/`,
`@smithy/` as expected for a serverExternalPackages entry.

**Path-baking caveat**: the standalone server bakes the build-machine's
absolute path into `server.js` via `outputFileTracingRoot`. On a Linux Docker
build with `WORKDIR /app`, all paths resolve as `/app/apps/web/server.js` —
correct. The Windows worktree paths seen here only appear because the
experiment ran on a Windows dev machine. **This is not a problem for the
Docker build**, which runs on Linux.

**`next.config.ts` change required**: add `output: "standalone"` (one line).
The build plan makes this change; the design only specifies it.

### 1b. Chosen strategy: standalone image

Use `output: "standalone"` + a two-stage Dockerfile:

- **Stage 1 (build)**: full monorepo checkout, `npm ci`, `npm run web:build`
  — produces `.next/standalone/`.
- **Stage 2 (runtime)**: `node:24-bookworm-slim`, copy standalone output +
  static assets, run `node apps/web/server.js`.

Approximate final image size: **~350–450 MB** (vs. ~1 GB for a full workspace
image). The `better-sqlite3` native addon must be compiled for the runtime
architecture during stage 1 (same base image resolves this automatically).

**Fallback if standalone breaks in follow-up work**: full-workspace image
(`npm ci --omit=dev` at monorepo root, `npm run web:build`, `npm run
web:start`). Acceptable on a NAS with ≥4 GB RAM; just larger.

---

## 2. Compose topology

### 2a. New `web` service (compose block draft)

```yaml
# In compose.ugreen.yml — operator adds this block alongside the existing bot service.
web:
  image: ghcr.io/devabdullahs/esports-community-bot-web:latest
  container_name: ecb-web
  restart: unless-stopped
  user: "node"          # matches node:24 image; uid 1000 — same as plan 022's USER node
  networks:
    - internal_net
  volumes:
    - ./data:/app/data  # same bind mount as bot; SQLite WAL shared-memory works on
                        # a single host volume (both containers → same inode)
  environment:
    NODE_ENV: production
    DB_PATH: /app/data/bot.sqlite
    # --- Auth (required) ---
    BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
    BETTER_AUTH_URL: "${EWC_DASHBOARD_PUBLIC_URL}"
    EWC_DASHBOARD_PUBLIC_URL: "${EWC_DASHBOARD_PUBLIC_URL}"
    # --- Discord OAuth (required) ---
    DISCORD_CLIENT_ID: "${DISCORD_CLIENT_ID}"
    DISCORD_CLIENT_SECRET: "${DISCORD_CLIENT_SECRET}"
    # --- Internal bot↔web API (required) ---
    EWC_DASHBOARD_INTERNAL_SECRET: "${EWC_DASHBOARD_INTERNAL_SECRET}"
    # --- Admin bootstrap (required for first login) ---
    EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS: "${EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS}"
    EWC_DASHBOARD_DEFAULT_GUILD_ID: "${EWC_DASHBOARD_DEFAULT_GUILD_ID}"
    # --- R2 image uploads (optional) ---
    R2_ACCOUNT_ID: "${R2_ACCOUNT_ID:-}"
    R2_ACCESS_KEY_ID: "${R2_ACCESS_KEY_ID:-}"
    R2_SECRET_ACCESS_KEY: "${R2_SECRET_ACCESS_KEY:-}"
    R2_BUCKET: "${R2_BUCKET:-}"
    R2_PUBLIC_BASE_URL: "${R2_PUBLIC_BASE_URL:-}"
    # --- Fonts (optional, leave blank to use system fallback) ---
    THMANYAH_FONT_BASE_URL: "${THMANYAH_FONT_BASE_URL:-}"
  expose:
    - "3000"  # internal only; ingress terminates TLS and proxies here
  # Do NOT publish port 3000 directly; ingress handles public exposure.
  # healthcheck is optional but recommended (plan follow-up):
  # healthcheck:
  #   test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/auth/ok').catch(()=>process.exit(1))"]
  #   interval: 30s
  #   timeout: 5s
  #   retries: 3
```

### 2b. Bot service update (one line)

Add to the existing `bot` service in `compose.ugreen.yml`:

```yaml
environment:
  EWC_DASHBOARD_INTERNAL_URL: "http://web:3000"
  # (already present with localhost value — change to the compose service name)
```

The bot calls `/api/internal/ewc-profile/sync` and `/api/internal/ewc-profile/unlink`
on the web container over the `internal_net` bridge. These routes check the
`x-ewc-internal-secret` header (constant-time comparison, fail-closed when
unset) — no public port exposure needed.

### 2c. Volume / UID alignment

The existing bot Dockerfile uses `chown -R node:node /app` but does **not**
emit a `USER node` instruction (plan 022 will add it). The web image should
match: `USER node` in the runtime stage, `user: "node"` in compose. Both
containers write to `./data/` as UID 1000. SQLite WAL mode with two readers
on the same host volume is safe; the shared-memory file (`.sqlite-shm`) and
WAL file (`.sqlite-wal`) are on the same filesystem as the DB file, satisfying
WAL's requirement for shared-memory-capable storage.

### 2d. Environment variable reference

| Variable | Required? | Set in bot service too? | Notes |
|---|---|---|---|
| `NODE_ENV` | Yes | Yes | `production` |
| `DB_PATH` | Yes | Yes | `/app/data/bot.sqlite` |
| `BETTER_AUTH_SECRET` | **Required** | No | 32-byte random secret; throws at startup if missing in prod |
| `BETTER_AUTH_URL` | Yes | No | Must equal public HTTPS URL |
| `EWC_DASHBOARD_PUBLIC_URL` | Yes | Yes (for leaderboard links) | Same HTTPS URL |
| `DISCORD_CLIENT_ID` | Yes | Yes (already in bot) | Reuse same application |
| `DISCORD_CLIENT_SECRET` | Yes | No | From Discord Developer Portal |
| `EWC_DASHBOARD_INTERNAL_SECRET` | Yes | Yes | Shared secret for bot→web calls |
| `EWC_DASHBOARD_INTERNAL_URL` | Yes (bot only) | Bot only | `http://web:3000` |
| `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` | Yes (first login) | No | Comma-separated Discord IDs |
| `EWC_DASHBOARD_DEFAULT_GUILD_ID` | Yes | No | The single guild's Discord ID |
| `EWC_DASHBOARD_ADMIN_DISCORD_IDS` | No | No | Legacy back-compat; prefer SUPER_ADMIN_* |
| `R2_ACCOUNT_ID` | Optional | No | Leave blank to disable image uploads |
| `R2_ACCESS_KEY_ID` | Optional | No | |
| `R2_SECRET_ACCESS_KEY` | Optional | No | |
| `R2_BUCKET` | Optional | No | |
| `R2_PUBLIC_BASE_URL` | Optional | No | e.g. `https://assets.moonbot.info` |
| `THMANYAH_FONT_BASE_URL` | Optional | No | Font proxy base URL |

---

## 3. Ingress and TLS

**Constraint**: community members are on the public internet; secure cookies
require HTTPS end-to-end; Discord OAuth needs a stable public redirect URL;
the NAS is a UGREEN device (likely behind a residential NAT).

| Option | Setup cost | Cert handling | Port-forward required? | Recommendation |
|---|---|---|---|---|
| **(a) Cloudflare Tunnel** sidecar (`cloudflared`) | Low — free Cloudflare account + `cloudflared` token | Cloudflare manages TLS automatically | **No** | **Recommended** |
| **(b) Nginx-Proxy-Manager or Caddy** + Let's Encrypt | Medium — container + DNS/DDNS + port 80/443 open | Auto-renew via ACME | Yes (ports 80 + 443) | Good if operator already has a domain + open ports |
| **(c) LAN-only + local certs** | Low | Self-managed | No | **Rejected** — community members cannot reach it; HTTPS via self-signed cert breaks Discord OAuth callback |

### Recommendation: Cloudflare Tunnel (option a)

Add a `cloudflared` sidecar to `compose.ugreen.yml`:

```yaml
cloudflared:
  image: cloudflare/cloudflared:latest
  restart: unless-stopped
  command: tunnel --no-autoupdate run
  environment:
    TUNNEL_TOKEN: "${CLOUDFLARE_TUNNEL_TOKEN}"
  networks:
    - internal_net
  depends_on:
    - web
```

Configure the tunnel in the Cloudflare dashboard to route
`https://your-domain.com → http://web:3000`. The tunnel container sits on
`internal_net` and reaches the `web` service by its compose hostname —
no port published to the host.

**Why**: no port-forward on the NAS router; Cloudflare handles TLS
termination and cert renewal; free tier is sufficient; UGREEN NAS users
commonly use this pattern. If the operator already runs Nginx-Proxy-Manager
or Caddy on the NAS, option (b) is equally valid.

---

## 4. OAuth and URL checklist

Before going live, the operator must:

1. **Discord Developer Portal** → Application → OAuth2 → Redirects:  
   Add `https://your-domain.com/api/auth/callback/discord`.  
   (Remove or keep `http://localhost:3000/api/auth/callback/discord` for local
   dev — Discord allows multiple entries.)

2. **Set `BETTER_AUTH_URL` and `EWC_DASHBOARD_PUBLIC_URL`** to the final
   public HTTPS URL (e.g. `https://ewc.yoursite.com`) in `.env.docker` on the
   NAS. These must match exactly — trailing slashes are stripped by `env.ts`.

3. **`EWC_DASHBOARD_INTERNAL_URL`** on the bot service must be `http://web:3000`
   (compose hostname, not the public URL — the bot calls this over the private
   bridge network).

4. **Secure cookies**: `auth.ts` sets `useSecureCookies: true` when
   `NODE_ENV === "production"`. A plain-HTTP LAN deployment will break login
   because the `Set-Cookie: Secure` flag is rejected by the browser over HTTP.
   HTTPS is non-negotiable.

5. **`BETTER_AUTH_SECRET`**: generate with `openssl rand -hex 32`. Must not be
   the development placeholder; `auth.ts` throws on startup if the secret is
   the default and `NODE_ENV === "production"`.

---

## 5. CI publish job sketch

The bot image is currently published manually (no `docker/build-push-action`
job exists in `.github/workflows/ci.yml`; the workflow only runs `npm ci`,
`npm test`, `npm run web:build`). The deployment notes in `AGENTS.md` confirm
the operator runs `docker compose pull && docker compose up -d` on the NAS,
implying manual pushes from the dev machine today.

**This is an open question** — see Open Questions §1.

Proposed addition to `.github/workflows/ci.yml` after plan 020 lands:

```yaml
web-image:
  needs: [web]           # only publish if lint + build pass
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main' && github.event_name == 'push'
  permissions:
    contents: read
    packages: write
  steps:
    - uses: actions/checkout@v4

    - name: Log in to GHCR
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build and push web image
      uses: docker/build-push-action@v6
      with:
        context: .
        file: Dockerfile.web          # new file added in build plan
        push: true
        tags: |
          ghcr.io/devabdullahs/esports-community-bot-web:latest
          ghcr.io/devabdullahs/esports-community-bot-web:${{ github.sha }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
```

The web build requires `DB_PATH` at build time (SQLite is imported during
`next build` for page-data collection). Set it to a temp path in the CI job:

```yaml
    - run: npm run web:build
      env:
        DB_PATH: /tmp/ci-build.sqlite
        BETTER_AUTH_SECRET: build-phase-placeholder   # auth.ts allows placeholder at build phase
        NEXT_PHASE: phase-production-build
```

(The `auth.ts` `resolveAuthSecret()` function already checks `NEXT_PHASE ===
"phase-production-build"` and skips the production secret requirement during
build — this is safe.)

---

## 6. Migration and rollback

### Auth tables migration

`better-auth` creates its own tables (`user`, `session`, `account`,
`verification`) on first run via the `@better-auth/cli migrate` command, which
maps to `npm run web:auth:migrate` (root: `npm run web:auth:migrate`).

**When to run**: once, before the first `docker compose up` with the web
service. Run from the NAS in the project directory:

```bash
DB_PATH=/volume1/docker/ECB/data/bot.sqlite \
BETTER_AUTH_SECRET=<your-secret> \
npm run web:auth:migrate
```

Or from inside the running container:

```bash
docker exec -it ecb-web sh -c "npm run auth:migrate"
```

The bot-side schema (`src/db/index.js`) uses `CREATE TABLE IF NOT EXISTS` and
`ensureColumns` migrations — these run automatically on bot startup. The
better-auth tables are the only ones that need the explicit CLI migration.

### Rollback to bot-only

1. Remove (or comment out) the `web` and `cloudflared` services from
   `compose.ugreen.yml`.
2. Set `EWC_DASHBOARD_INTERNAL_URL` back to its previous value (or leave
   unset — the bot gracefully skips profile sync calls when the URL is missing:
   `if (!config.dashboard.internalUrl || !config.dashboard.internalSecret)
   return;`).
3. `docker compose up -d` — only the bot container runs.

The `better-auth` tables remain in the SQLite DB but cause no harm; the bot
schema ignores them. No data loss.

---

## 7. Open questions for the operator

**Maximum five, each with a recommendation.**

### OQ-1: How is the bot image currently published to GHCR?

The CI workflow has no `docker/build-push-action` step. The `AGENTS.md`
deployment notes describe `docker compose pull` on the NAS, implying an image
must already be on GHCR.

**Recommendation**: If you push manually from a dev machine (`docker build` +
`docker push` or `docker buildx`), we should add the publish job to CI so both
bot and web images ship automatically on main. Please confirm the current
workflow so the CI plan can mirror it exactly.

### OQ-2: What domain/subdomain will the dashboard use?

The Discord OAuth redirect and `BETTER_AUTH_URL` need a stable public URL
before any user can log in.

**Recommendation**: `ewc.moonbot.info` (or similar on your existing domain)
via a Cloudflare Tunnel. If you do not already have a domain, Cloudflare
provides a free `*.trycloudflare.com` URL for testing (not stable — use it
only to verify the stack works before registering a real subdomain).

### OQ-3: Do you already run a reverse proxy (Nginx-Proxy-Manager, Caddy, etc.) on the NAS?

The ingress recommendation defaults to Cloudflare Tunnel (no port-forward),
but if you already have NPM or Caddy running, adding a proxy entry to the
existing proxy is less overhead than a new container.

**Recommendation**: if no proxy exists today, use Cloudflare Tunnel (free,
no port-forward, zero cert management). If you already have NPM/Caddy, use
option (b) from §3 and skip the `cloudflared` sidecar.

### OQ-4: Should the dashboard be publicly reachable, or restricted to Discord members only?

Currently anyone with the URL can reach the login page; only Discord OAuth
users can authenticate. The leaderboard and news pages are publicly readable
without login.

**Recommendation**: keep it public (the current design). The auth-gated admin
section and profile data are protected by session cookies. If you want to
restrict access to Discord members only, Cloudflare Access (Zero Trust, free
tier) can gate the entire domain by Discord identity — document this as a
future hardening step.

### OQ-5: Is there a Cloudflare account, and is the NAS domain already on Cloudflare DNS?

Cloudflare Tunnel requires a Cloudflare account and the target domain to be
on Cloudflare DNS (i.e. Cloudflare is the authoritative nameserver).

**Recommendation**: If not already on Cloudflare, transfer DNS (free). If the
NAS already uses a DDNS service (Synology/QNAP DDNS, etc.), a direct migration
to Cloudflare DNS is a one-time 15-minute task. Alternatively, use option (b)
from §3 (Caddy + Let's Encrypt) which works with any DNS provider.

---

## Appendix: Dockerfile.web sketch (not committed — for build plan reference)

```dockerfile
# ---- Stage 1: build ----
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN DB_PATH=/tmp/ci-build.sqlite \
    BETTER_AUTH_SECRET=build-phase-placeholder \
    NEXT_PHASE=phase-production-build \
    npm run web:build
# output: "standalone" must be set in apps/web/next.config.ts (one-line change in build plan)

# ---- Stage 2: runtime ----
FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data \
  && chown -R node:node /app

USER node

# Copy standalone output (paths are relative to monorepo root /app)
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
# Copy static assets (CSS, JS, fonts — served by Next.js from .next/static)
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# Copy public directory (favicon, og images, etc.)
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
```

**Notes on this sketch**:
- The `server.js` path (`apps/web/server.js`) is where Next.js standalone
  emits it relative to the monorepo WORKDIR (`/app`) when built from the root.
- `HOSTNAME=0.0.0.0` is required for Next.js standalone to listen on all
  interfaces (not just localhost) inside the container.
- The `.next/static` and `public/` directories must be copied separately —
  standalone does not include them by default.
- `better-sqlite3`'s native addon is compiled for the builder's architecture
  (linux/amd64); if the NAS is ARM (some UGREEN models), add
  `--platform linux/arm64` or use `docker buildx` with multi-arch. Check NAS
  CPU architecture (open question for the build plan).
