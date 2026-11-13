// Opaque 32-byte session tokens in an HttpOnly cookie. Only the SHA-256 digest,
// user id and timestamps are stored; the plaintext token never reaches the
// database or the logs.
import { AppError, rows } from "./http.mjs";

export const SESSION_COOKIE = "__Host-lp.session";
export const SESSION_COOKIE_DEV = "lp.session";
export const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;
const MAX_COOKIE_HEADER = 8192;

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newSessionToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cookieName(secure) {
  return secure ? SESSION_COOKIE : SESSION_COOKIE_DEV;
}

export function sessionCookie(token, maxAgeSeconds, secure = true) {
  const attributes = secure
    ? "Path=/; HttpOnly; Secure; SameSite=Lax"
    : "Path=/; HttpOnly; SameSite=Lax";
  return `${cookieName(secure)}=${token}; ${attributes}; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(secure = true) {
  const attributes = secure
    ? "Path=/; HttpOnly; Secure; SameSite=Lax"
    : "Path=/; HttpOnly; SameSite=Lax";
  return `${cookieName(secure)}=; ${attributes}; Max-Age=0`;
}

function sessionTokenFrom(request) {
  const header = request.headers.get("cookie") ?? "";
  if (!header) return null;
  if (header.length > MAX_COOKIE_HEADER) throw new AppError("invalid_credentials", 400);
  const names = new Set([SESSION_COOKIE, SESSION_COOKIE_DEV]);
  const values = [];
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const at = trimmed.indexOf("=");
    if (at < 1) continue;
    if (names.has(trimmed.slice(0, at).trim())) values.push(trimmed.slice(at + 1));
  }
  if (values.length === 0) return null;
  if (values.length > 1) throw new AppError("invalid_credentials", 400);
  const token = values[0];
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError("invalid_credentials", 400);
  return token;
}

export async function createSession(db, userId, options = {}) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? CUSTOMER_SESSION_TTL_MS;
  const token = newSessionToken();
  const digest = await sha256Hex(token);
  const expiresAt = new Date(now + ttlMs).toISOString();
  const created = rows(
    await db
      .from("sessions")
      .insertIfAbsent(
        {
          token_digest: digest,
          user_id: userId,
          ip: options.ip ?? null,
          user_agent: options.userAgent ?? null,
          created_at: new Date(now).toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: "token_digest" },
      )
      .select("token_digest"),
  );
  if (created.length !== 1) throw new AppError("session_unavailable", 503);
  return { token, digest, expiresAt };
}

// Every request revalidates the cookie against the database: a valid session is
// one whose row exists, is not revoked and has not expired.
export async function validateSession(db, request, now = Date.now()) {
  const token = sessionTokenFrom(request);
  if (!token) return { state: "missing", session: null };
  const digest = await sha256Hex(token);
  const found = rows(
    await db
      .from("sessions")
      .select("token_digest,user_id,expires_at,revoked_at")
      .eq("token_digest", digest)
      .limit(1),
  );
  if (found.length !== 1) return { state: "invalid", session: null };
  const row = found[0];
  if (row.token_digest !== digest || typeof row.user_id !== "string") {
    return { state: "invalid", session: null };
  }
  if (row.revoked_at != null) return { state: "invalid", session: null };
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { state: "invalid", session: null };
  return { state: "valid", session: { digest, userId: row.user_id, expiresAt } };
}

export async function revokeSession(db, digest, now = Date.now()) {
  const revoked = rows(
    await db
      .from("sessions")
      .update({ revoked_at: new Date(now).toISOString() })
      .eq("token_digest", digest)
      .select("token_digest"),
  );
  return revoked.length === 1;
}

// Used for "sign out everywhere" and whenever an account is suspended.
export async function revokeAllSessions(db, userId, now = Date.now()) {
  const sessions = rows(
    await db.from("sessions").select("token_digest,revoked_at").eq("user_id", userId).limit(1000),
  );
  let revoked = 0;
  for (const session of sessions) {
    if (session.revoked_at != null) continue;
    await db
      .from("sessions")
      .update({ revoked_at: new Date(now).toISOString() })
      .eq("token_digest", session.token_digest)
      .select("token_digest");
    revoked += 1;
  }
  return revoked;
}
