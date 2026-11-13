// RFC 6238 TOTP (SHA-1, 6 digits, 30-second steps) plus recovery-code helpers.
// Secrets never leave the server except during enrolment, and recovery codes are
// persisted only as SHA-256 digests.
import { sha256Hex } from "./sessions.mjs";
import { secureCompare } from "./http.mjs";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const cleaned = String(text).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

export function newTotpSecret(byteLength = 20) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function counterBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

export async function totpCode(secret, nowMs = Date.now(), digits = TOTP_DIGITS) {
  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) throw new Error("invalid_totp_secret");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBytes(counter)),
  );
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

// A one-step window each way tolerates a slow phone clock without widening the
// replay window beyond roughly 90 seconds.
export async function verifyTotp(secret, code, nowMs = Date.now(), window = 1) {
  if (!secret || !/^\d{6}$/.test(String(code))) return false;
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = await totpCode(secret, nowMs + offset * TOTP_STEP_SECONDS * 1000);
    if (await secureCompare(String(code), expected)) return true;
  }
  return false;
}

export function otpauthUri({ secret, account, issuer = "LootPat Bazar" }) {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function randomFromAlphabet(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join("");
}

export function normalizeRecoveryCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function generateRecoveryCodes(count = 10) {
  const codes = [];
  const digests = new Set();
  while (codes.length < count) {
    const raw = randomFromAlphabet(10);
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    const digest = await sha256Hex(normalizeRecoveryCode(formatted));
    if (digests.has(digest)) continue;
    digests.add(digest);
    codes.push({ code: formatted, digest });
  }
  return codes;
}

export async function recoveryCodeDigest(value) {
  return sha256Hex(normalizeRecoveryCode(value));
}
