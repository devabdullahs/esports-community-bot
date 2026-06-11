# Deployment — UGREEN NAS (combined bot + web)

The production image runs **both** the Discord bot and the Next.js dashboard in
one container via `src/start-production.js` (`RUN_BOT` / `RUN_WEB`). Public
HTTPS is provided by a **Cloudflare Tunnel** sidecar — no router port-forward,
free TLS. Image: `ghcr.io/devabdullahs/esports-community-bot`.

`compose.ugreen.yml` lives on the NAS (it is git-ignored); the example here
mirrors it. Secrets live in `.env.docker` next to it.

## 0. Check the NAS architecture (do this once)

The publish workflow builds `linux/amd64` by default. Confirm the NAS matches:

```bash
uname -m          # x86_64 → amd64 (default, no change needed)
                  # aarch64 → arm64 (change `platforms:` in publish.yml)
```

## 1. Build & publish the image (from CI — no more manual pushes)

```bash
git tag v0.2.0 && git push origin v0.2.0    # or: Actions tab → "Publish image" → Run
```

The `Publish image` workflow builds the combined image and pushes
`ghcr.io/devabdullahs/esports-community-bot:v0.2.0` (+ `:latest`). If the first
run fails on permissions, make the GHCR package writable by Actions:
Package → Settings → Actions access → add this repo with **Write**.

## 2. Cloudflare Tunnel (one-time)

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create tunnel**
   (choose *Cloudflared*). Name it, copy the **tunnel token**.
2. Add a **public hostname**: e.g. `dashboard.yourdomain.com` →
   **Service:** `HTTP` → `esports-bot:3000`.
   (Your domain must be on Cloudflare DNS; the hostname's CNAME is created for
   you.)
3. Put the token in `.env.docker`: `CLOUDFLARE_TUNNEL_TOKEN=...`

The site is **public** (anyone can view game pages, news, leaderboards); login
gates `/me` and `/admin`. To restrict the whole site to specific people later,
add a Cloudflare **Access** policy on the hostname (e.g. by email or Discord
identity) — no code change needed.

## 3. `.env.docker` checklist (the web half — bot vars unchanged)

```
# Public URL — MUST be https and match the Cloudflare hostname exactly.
BETTER_AUTH_URL=https://dashboard.yourdomain.com
EWC_DASHBOARD_PUBLIC_URL=https://dashboard.yourdomain.com

# 32+ byte random secrets (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
BETTER_AUTH_SECRET=...
EWC_DASHBOARD_INTERNAL_SECRET=...

# Discord OAuth app (same application as the bot)
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...

# Comma-separated Discord user IDs with full dashboard control
EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS=...

# Cloudflare tunnel token from step 2
CLOUDFLARE_TUNNEL_TOKEN=...

# Optional — news image uploads (leave unset to disable; admins paste URLs instead)
# R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_BUCKET= R2_PUBLIC_BASE_URL=
```

`DISCORD_TOKEN` and the other bot vars stay as they already are.

## 4. Register the Discord OAuth redirect

Discord Developer Portal → your application → **OAuth2 → Redirects**, add:

```
https://dashboard.yourdomain.com/api/auth/callback/discord
```

(Login fails with a redirect-mismatch error until this exactly matches
`BETTER_AUTH_URL`.)

## 5. First deploy

```bash
cd /volume1/docker/ECB                       # your compose dir
sudo chown -R 1000:1000 ./data               # the image runs as uid 1000 (node)
docker compose pull
docker compose run --rm esports-bot npm run web:auth:migrate   # once: creates auth tables
docker compose up -d
docker compose ps                            # esports-bot + ecb-cloudflared up
```

## 6. Smoke checks

- `docker compose logs -f esports-bot` → `web started`, `Ready`, `SQLite ready`,
  bot logs in (no `BETTER_AUTH_SECRET must be set` error).
- Visit `https://dashboard.yourdomain.com/` → home renders over HTTPS.
- Click **Login** → Discord OAuth round-trips back successfully.
- A super-admin Discord ID can reach `/admin`.

## 7. Updating later

```bash
git tag v0.2.1 && git push origin v0.2.1     # CI publishes :v0.2.1 + :latest
# on the NAS:
docker compose pull && docker compose up -d
```

## Notes

- Bot and web share one container, so a crash in either stops both;
  `restart: unless-stopped` brings them back together. Acceptable for a
  single-guild deployment.
- The bot reaches the web internally at `http://127.0.0.1:3000`
  (`EWC_DASHBOARD_INTERNAL_URL`) — same container, no network hop.
- Rotating `BETTER_AUTH_SECRET` invalidates all sessions and encrypted OAuth
  tokens (everyone re-logs-in). Keep `.env.docker` out of any off-NAS backup.
