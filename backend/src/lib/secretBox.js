import crypto from 'node:crypto';

// AES-256-GCM envelope for secrets stored in the DB (integration credentials).
// Key material comes from INTEGRATIONS_KEY: 32 bytes as hex (64 chars) or
// base64, or any other string, from which a key is derived with scrypt.
// Stored form: { v: 1, iv, tag, data } (all base64).

let cached = { raw: null, key: null };

export function encryptionEnabled() {
  return !!process.env.INTEGRATIONS_KEY;
}

function getKey() {
  const raw = process.env.INTEGRATIONS_KEY;
  if (!raw) throw new Error('INTEGRATIONS_KEY is not set');
  if (cached.raw === raw) return cached.key;

  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(raw) || /^[A-Za-z0-9_-]{43}=?$/.test(raw)) {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) key = b;
  }
  if (!key) key = crypto.scryptSync(raw, 'bookworm-integrations', 32);
  cached = { raw, key };
  return key;
}

export function isEncrypted(stored) {
  return !!stored && typeof stored === 'object' && stored.v === 1
    && typeof stored.iv === 'string' && typeof stored.tag === 'string' && typeof stored.data === 'string';
}

export function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

// Accepts the envelope object or its JSON string. Throws if the key is wrong,
// missing, or the data/tag was tampered with.
export function decryptJson(input) {
  const env = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isEncrypted(env)) throw new Error('Not an encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}
