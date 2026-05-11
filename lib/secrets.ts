import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENC_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer | null {
  const raw = process.env.API_KEY_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // no-op
  }

  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const key = getEncryptionKey();
  if (!key) return trimmed;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(ENC_PREFIX)) return value;

  const key = getEncryptionKey();
  if (!key) return undefined;

  const payload = value.slice(ENC_PREFIX.length);
  const [ivB64, dataB64, tagB64] = payload.split(":");
  if (!ivB64 || !dataB64 || !tagB64) return undefined;

  try {
    const iv = Buffer.from(ivB64, "base64");
    const encrypted = Buffer.from(dataB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    return decrypted;
  } catch {
    return undefined;
  }
}

export function maskSecret(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const last4 = trimmed.slice(-4);
  if (trimmed.startsWith("sk-")) return `sk-****${last4}`;
  return `****${last4}`;
}

export function isMaskedSecret(value?: string): boolean {
  if (!value) return false;
  return value.includes("****") || value.includes("••••");
}
