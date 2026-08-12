// Shared between the public smoke check (which sends it) and the MCP routes
// (which recognise it), so our own monitoring cannot be mistaken for a real
// client when the 2025-era removal is decided from traffic.
//
// This is a label, not a credential: anything may send it, and nothing is
// granted by doing so. It only tags a line in a log.
export const MCP_PROBE_USER_AGENT = 'esports-community-smoke/1.0 (+https://esportscommunity.net/docs/mcp)';
