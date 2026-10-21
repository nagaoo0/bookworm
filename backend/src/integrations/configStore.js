import { pool } from '../db.js';
import { encryptJson, decryptJson, isEncrypted, encryptionEnabled } from '../lib/secretBox.js';

// All reads/writes of integrations.config go through here so the rest of the
// code never cares whether the stored form is plaintext or an encrypted
// envelope (INTEGRATIONS_KEY set or not).

// Plain config object from a stored JSONB value (plaintext or encrypted).
// Throws if an encrypted value cannot be decrypted (wrong/missing key, tampering).
export function openConfig(stored) {
  if (isEncrypted(stored)) return decryptJson(stored);
  return stored ?? {};
}

// Stored form of a config: encrypted when a key is configured.
export function sealConfig(config) {
  return encryptionEnabled() ? encryptJson(config) : config;
}

export function originOf(serverUrl) {
  try { return new URL(serverUrl).origin; } catch { return null; }
}

// { config, last_synced_at } for one user+service, or null. config is decrypted.
export async function getIntegration(userId, service) {
  const { rows: [row] } = await pool.query(
    'SELECT config, last_synced_at FROM integrations WHERE user_id=$1 AND service=$2',
    [userId, service]
  );
  if (!row) return null;
  return { config: openConfig(row.config), last_synced_at: row.last_synced_at };
}

// The sync interval is also kept in a plain column (interval_ms) so the sync
// engine can resume with it after a restart without decrypting every config.
export async function saveIntegration(userId, service, config) {
  await pool.query(
    `INSERT INTO integrations (user_id, service, config, server_origin, interval_ms)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, service) DO UPDATE
       SET config = EXCLUDED.config, server_origin = EXCLUDED.server_origin,
           interval_ms = EXCLUDED.interval_ms`,
    [userId, service, JSON.stringify(sealConfig(config)), originOf(config.serverUrl), config.intervalMs ?? null]
  );
}

// Boot-time housekeeping: fill server_origin for rows saved before it existed
// and, when INTEGRATIONS_KEY is set, encrypt any config still in plaintext.
export async function prepareIntegrationConfigs() {
  const { rows } = await pool.query('SELECT id, config, server_origin FROM integrations');
  let encrypted = 0;
  for (const row of rows) {
    try {
      const wasEncrypted = isEncrypted(row.config);
      if (wasEncrypted && row.server_origin) continue;
      if (wasEncrypted && !encryptionEnabled()) continue; // can't read it; leave as is
      const plain = openConfig(row.config);
      const origin = originOf(plain.serverUrl);
      const shouldEncrypt = !wasEncrypted && encryptionEnabled();
      if (!shouldEncrypt && row.server_origin) continue;
      await pool.query(
        'UPDATE integrations SET config = $1, server_origin = $2 WHERE id = $3',
        [JSON.stringify(shouldEncrypt ? encryptJson(plain) : row.config), origin, row.id]
      );
      if (shouldEncrypt) encrypted++;
    } catch (err) {
      console.warn(`[integrations] could not prepare config row ${row.id}: ${err.message}`);
    }
  }
  if (encrypted) console.log(`[integrations] encrypted ${encrypted} stored config(s)`);
}
