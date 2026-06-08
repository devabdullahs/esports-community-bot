import { EWC_ROLE_CONNECTION_METADATA } from './ewcProfileStats.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

export { EWC_ROLE_CONNECTION_METADATA };

function roleConnectionUrl(clientId) {
  return `${DISCORD_API_BASE}/users/@me/applications/${clientId}/role-connection`;
}

async function discordJson(response) {
  if (response.ok) return response.status === 204 ? null : response.json();
  const text = await response.text().catch(() => '');
  throw new Error(`Discord role connection request failed (${response.status}): ${text || response.statusText}`);
}

export async function updateDiscordRoleConnection({ accessToken, clientId, payload }) {
  const response = await fetch(roleConnectionUrl(clientId), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return discordJson(response);
}

export async function deleteDiscordRoleConnection({ accessToken, clientId }) {
  const response = await fetch(roleConnectionUrl(clientId), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return discordJson(response);
}
