// HTTP primitives shared by every route: fixed-origin CSRF checks, bounded JSON
// reading, stable error codes and response hardening. Identity never comes from
// platform headers or the request body — only from a validated session row.

export const BODY_LIMIT_BYTES = 16 * 1024;

export class AppError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

const NO_STORE = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { ...NO_STORE, ...extra } });
}

export function errorJson(code, status, extra = {}) {
  return json({ error: code }, status, extra);
}

// The gateway rewrites the app segment to the physical function name and may
// strip /functions/v1 first.
export function applicationPath(request) {
  const match = new URL(request.url).pathname.match(
    /^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/,
  );
  if (!match) throw new AppError("not_found", 404);
  return match[1] || "/";
}

// Second CSRF defence behind the SameSite=Lax cookie: unsafe methods must come
// from the site's fixed public origin. Loopback HTTP is allowed for local dev.
export function requireTrustedOrigin(request, origin) {
  let configured;
  try {
    configured = new URL(origin);
  } catch {
    throw new AppError("application_auth_not_configured", 503);
  }
  const loopback = configured.hostname === "127.0.0.1" || configured.hostname === "localhost";
  const allowed = configured.protocol === "https:" || (loopback && configured.protocol === "http:");
  if (!allowed || configured.origin !== origin) {
    throw new AppError("application_auth_not_configured", 503);
  }
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("origin") !== origin) throw new AppError("origin_forbidden", 403);
}

// The byte cap is enforced while reading, so Content-Length is never trusted.
export async function readJson(request, maxBytes = BODY_LIMIT_BYTES) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AppError("invalid_input", 400);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalid_input", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError("payload_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError("invalid_input", 400);
  }
}

// Webhook signatures cover the exact bytes the provider sent, so the body is
// read raw and only decoded after the signature has been checked.
export async function readRawBody(request, maxBytes = BODY_LIMIT_BYTES) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalid_input", 400);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError("payload_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

// Provider results become business results: no provider detail reaches the client.
export function rows(result) {
  if (result?.error || !Array.isArray(result?.data)) {
    throw new AppError("database_unavailable", 503);
  }
  return result.data;
}

// Behind the platform edge the first forwarded address is the client. Values are
// only used as rate-limit buckets, never for authorization.
export function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate = (forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip") || "").trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : "unknown";
}

// Compares arbitrary strings in constant time by hashing both to a fixed width.
export async function secureCompare(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || right.length === 0) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(a);
  const rightBytes = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}
