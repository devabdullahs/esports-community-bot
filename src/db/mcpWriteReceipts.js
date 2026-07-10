function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function validateMcpIdempotencyKey(value) {
  if (typeof value !== 'string') throw new Error('idempotencyKey must be a string.');
  const key = value.trim();
  if (key !== value || key.length < 8 || key.length > 100 || /[\x00-\x1F\x7F]/.test(key)) {
    throw new Error('idempotencyKey must be an opaque 8-100 character string.');
  }
  return key;
}

function cleanClaim({ keyId, toolName, idempotencyKey }) {
  const id = Number(keyId);
  const tool = typeof toolName === 'string' ? toolName.trim() : '';
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('keyId must be a positive integer.');
  if (!tool || tool.length > 100) throw new Error('toolName is required.');
  return {
    keyId: id,
    toolName: tool,
    idempotencyKey: validateMcpIdempotencyKey(idempotencyKey),
  };
}

function parseResult(row) {
  if (!row) return null;
  if (row.result_json == null) {
    return {
      completed: false,
      result: null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
  try {
    return {
      completed: true,
      result: JSON.parse(row.result_json),
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  } catch {
    throw new Error('Stored MCP write receipt result is malformed.');
  }
}

export async function claimMcpWriteReceipt(tx, claim) {
  const value = cleanClaim(claim);
  const row = await tx.get(
    `INSERT INTO ewc_mcp_write_receipts
       (key_id, tool_name, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key_id, tool_name, idempotency_key) DO NOTHING
     RETURNING key_id, tool_name, idempotency_key, result_json, created_at, completed_at`,
    [value.keyId, value.toolName, value.idempotencyKey, nowText()],
  );
  return { claimed: Boolean(row), receipt: parseResult(row) };
}

export async function completeMcpWriteReceipt(tx, claim, result) {
  const value = cleanClaim(claim);
  const resultJson = JSON.stringify(result);
  if (resultJson.length > 1000) throw new Error('MCP write receipt result is too large.');
  const row = await tx.get(
    `UPDATE ewc_mcp_write_receipts
     SET result_json = $4, completed_at = $5
     WHERE key_id = $1 AND tool_name = $2 AND idempotency_key = $3
     RETURNING key_id, tool_name, idempotency_key, result_json, created_at, completed_at`,
    [value.keyId, value.toolName, value.idempotencyKey, resultJson, nowText()],
  );
  if (!row) throw new Error('MCP write receipt was not claimed.');
  return parseResult(row);
}

export async function getMcpWriteReceipt(tx, claim) {
  const value = cleanClaim(claim);
  const row = await tx.get(
    `SELECT key_id, tool_name, idempotency_key, result_json, created_at, completed_at
     FROM ewc_mcp_write_receipts
     WHERE key_id = $1 AND tool_name = $2 AND idempotency_key = $3`,
    [value.keyId, value.toolName, value.idempotencyKey],
  );
  return parseResult(row);
}
