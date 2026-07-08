# Admin MCP

The admin MCP endpoint lets approved AI/admin clients read site state and run
small, audited admin actions without sharing dashboard sessions or database
credentials.

This MCP server is admin-only. Public read-only MCP access should be a separate
endpoint if we add it later.

## Endpoint

Use the dashboard origin plus `/api/mcp`:

```text
https://esportscommunity.net/api/mcp
```

Local development usually uses:

```text
http://localhost:3000/api/mcp
```

The endpoint uses MCP Streamable HTTP and expects:

```http
Authorization: Bearer <ec_mcp_live_...>
Content-Type: application/json
Accept: application/json, text/event-stream
```

JSON-RPC batch arrays are intentionally rejected. Send one MCP request at a
time.

## Enable The Server

Set these environment variables on the web/dashboard service:

```env
EWC_MCP_ENABLED=true
EWC_MCP_ALLOWED_ORIGINS=https://esportscommunity.net
EWC_MCP_RATE_LIMIT_PER_MINUTE=60
```

`EWC_MCP_ALLOWED_ORIGINS` is used only when a browser-originated MCP request
sends an `Origin` header. Server-side clients usually send no origin header.
Requests from the same host as the dashboard are allowed automatically.

## Create A Key

1. Sign in to the dashboard as a super admin.
2. Open `/admin/mcp`.
3. Create a key for an existing dashboard admin or super admin Discord ID.
4. Choose tools and optional game/media scopes.
5. Copy the generated `ec_mcp_live_...` key immediately.

The full key is shown once. The database stores only a SHA-256 hash, a short
prefix, owner metadata, scopes, timestamps, and revocation state.

Scope rules:

- A key inherits the owner's dashboard permissions.
- Selecting specific games or media channels narrows the key.
- Leaving game/media scopes empty means "inherit the owner's full scope".
- For a super-admin-owned key, empty game/media scopes mean all games/media.

To rotate a key, create a replacement key, update the client, then revoke the
old key in `/admin/mcp`.

## Tools

| Tool | Purpose | Write? |
| --- | --- | --- |
| `get_site_overview` | Counts games, tournaments, matches, news, streams, and open reports. Super keys also see recent audit rows. | No |
| `search_news` | Search admin-visible news posts within the key owner's scopes. | No |
| `get_tournament_status` | Read one tournament's matches and standings if the key can view that game. | No |
| `get_ewc_club_summary` | Read EWC club points, qualified games, wins, and region metadata. | No |
| `list_admin_queue` | List reported comments that need moderation review. | No |
| `create_news_draft` | Create a draft news post in an allowed game or media channel. It never publishes directly. | Yes |
| `update_stream_channel` | Update allowed game-scoped co-stream rows. Super keys can update all stream rows. | Yes |

Every successful write records an admin audit entry with an MCP actor id like:

```text
mcp:<key-id>:<owner-discord-id>
```

## Quick Test With curl

List available MCP tools:

```bash
curl -sS https://esportscommunity.net/api/mcp \
  -H "Authorization: Bearer <MCP_KEY>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Call a read-only tool:

```bash
curl -sS https://esportscommunity.net/api/mcp \
  -H "Authorization: Bearer <MCP_KEY>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_site_overview","arguments":{}}}'
```

## Claude Code

If your Claude Code version supports remote Streamable HTTP MCP servers, use
the native HTTP configuration form and set the authorization header.

If it only supports stdio servers, use a local bridge such as `mcp-remote`:

```json
{
  "mcpServers": {
    "esports-community-admin": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://esportscommunity.net/api/mcp",
        "--header",
        "Authorization: Bearer <MCP_KEY>"
      ]
    }
  }
}
```

Save that in the project's `.mcp.json`, restart Claude Code, then run `/mcp` to
confirm the server is connected.

Do not commit a real MCP key. Keep `.mcp.json` private if it contains secrets.

## Codex

Codex setups vary by version. Use the native remote MCP configuration if your
Codex build supports Streamable HTTP. The server URL is:

```text
https://esportscommunity.net/api/mcp
```

Set this header:

```http
Authorization: Bearer <MCP_KEY>
```

For Codex local configurations that use stdio MCP servers, use `mcp-remote` in
`~/.codex/config.toml`:

```toml
[mcp_servers.esports-community-admin]
command = "npx"
args = [
  "-y",
  "mcp-remote",
  "https://esportscommunity.net/api/mcp",
  "--header",
  "Authorization: Bearer <MCP_KEY>",
]
```

Restart Codex after changing MCP configuration.

## Cursor Or VS Code

Use the same pattern as Claude Code if the client needs stdio MCP servers:

```json
{
  "mcpServers": {
    "esports-community-admin": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://esportscommunity.net/api/mcp",
        "--header",
        "Authorization: Bearer <MCP_KEY>"
      ]
    }
  }
}
```

If the client supports remote Streamable HTTP directly, configure the URL and
Authorization header without the bridge.

## Example Prompts

- "Use `get_site_overview` and summarize anything that needs admin attention."
- "Search draft news about Valorant and list what still needs review."
- "Get tournament status for tournament id 123 and explain live/upcoming issues."
- "Create a draft Arabic news post for the Valorant game. Do not publish it."
- "Check the EWC club summary for Team Falcons, Twisted Minds, and Team Liquid."

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `401 Missing MCP bearer key` | The client did not send `Authorization: Bearer ...`. |
| `401 Invalid MCP bearer key` | The key is wrong, expired, or revoked. Create a new key. |
| `403 Forbidden` | A browser `Origin` header is not allowed, or the key owner no longer has dashboard access. |
| `429 Too many requests` | The key hit `EWC_MCP_RATE_LIMIT_PER_MINUTE`. Wait for `Retry-After`. |
| `400 MCP JSON-RPC batching is not supported` | Send one MCP request at a time. |
| Connected but tool fails | Confirm the key has that tool selected and the owner's game/media scope covers the target. |
| No tools appear | Restart the MCP client and check the client logs. For Claude Code, use `/mcp`. |

## Security Notes

- Only super admins can create or revoke MCP keys.
- Keys should be scoped to the smallest useful tool/game/media set.
- Treat MCP keys like admin credentials. Do not paste them into screenshots,
  commits, issue comments, or shared prompts.
- MCP tools must not expose env vars, secrets, raw sessions, auth tables, or
  Discord tokens.
- Write tools should stay conservative: create drafts, update scoped stream
  rows, or queue/review work rather than publishing irreversible changes.

For general MCP client documentation style, the shadcn MCP docs are a useful
reference: https://ui.shadcn.com/docs/mcp
