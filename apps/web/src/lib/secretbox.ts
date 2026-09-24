import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Symmetric encryption for secrets stored at rest (currently provider-account
 * credentials). AES-256-GCM with a 12-byte IV; values are tagged with a version
 * prefix so plaintext written by older builds still reads back unchanged and can
 * be transparently re-encrypted on the next save.
 *
 * Key source (in order):
 *  1. `HAL_SECRETS_KEY` env var — any string; hashed to a 32-byte key. Set this
 *     to control the key yourself (e.g. shared across machines / rotated).
 *  2. Otherwise an auto-generated 32-byte key persisted to `secrets.key` in the
 *     data dir (chmod 600), so it works out of the box on a single host.
 */

const PREFIX = "enc:v1:";
const DATA_DIR = process.env.HAL_DATA_DIR ?? join(process.cwd(), "data");
const KEY_FILE = join(DATA_DIR, "secrets.key");

let cachedKey: Buffer | undefined;

/** Resolve (and cache) the 32-byte encryption key from env or the key file. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.HAL_SECRETS_KEY?.trim();
  if (envKey) {
    // Accept any string; derive a stable 32-byte key from it.
    cachedKey = createHash("sha256").update(envKey).digest();
    return cachedKey;
  }

  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, "utf8").trim();
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
    // Fall through and regenerate if the file is malformed.
  }

  const key = randomBytes(32);
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, key.toString("base64"), { mode: 0o600 });
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  cachedKey = key;
  return cachedKey;
}

/** True if a stored value is one this module produced. */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypt a UTF-8 string to `enc:v1:<base64(iv|tag|ciphertext)>`. */
export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a value produced by {@link encryptString}. Plaintext passes through. */
export function decryptString(value: string): string {
  if (!isEncrypted(value)) return value;
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Encrypt every value in a credentials map for storage. */
export function encryptCredentials(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    out[k] = typeof v === "string" && v.length > 0 && !isEncrypted(v) ? encryptString(v) : v;
  }
  return out;
}

/**
 * Decrypt every value in a stored credentials map. A value that fails to decrypt
 * (e.g. the key changed) is left as-is with a warning rather than crashing load.
 */
export function decryptCredentials(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === "string" && isEncrypted(v)) {
      try {
        out[k] = decryptString(v);
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`[hal] could not decrypt credential "${k}" — is HAL_SECRETS_KEY correct?`);
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}
