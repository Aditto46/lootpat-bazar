import { createApplication } from "../../functions/app.mjs";
import { totpCode } from "../../functions/totp.mjs";

export const ORIGIN = "http://127.0.0.1:5173";
export const BASE = "http://127.0.0.1:8000/functions/v1/app";
export const SETUP_TOKEN = "test-setup-token";
export const SANDBOX_ENV = {
  PAYMENTS_MODE: "sandbox",
  WEBHOOK_SECRET: "lootpat-sandbox-webhook",
};

export function makeApp(db, env = SANDBOX_ENV) {
  return createApplication({ db, origin: ORIGIN, setupToken: SETUP_TOKEN, env });
}

export async function call(handle, method, path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes(method) && !headers.has("origin")) headers.set("origin", ORIGIN);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.ip) headers.set("x-forwarded-for", options.ip);

  const response = await handle(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body:
        options.raw !== undefined
          ? options.raw
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
    }),
  );
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return {
    status: response.status,
    json,
    setCookie,
    cookie: setCookie ? setCookie.split(";")[0] : null,
    headers: response.headers,
  };
}

export const PASSWORD = "LootPat#2026";

export async function setupWithOwner(handle, { email = "owner@lootpat.test", name = "Owner" } = {}) {
  const result = await call(handle, "POST", "/api/setup", {
    headers: { "x-setup-token": SETUP_TOKEN },
    body: { owner: { name, email, password: PASSWORD } },
  });
  if (result.status !== 200) throw new Error(`setup failed: ${result.status} ${JSON.stringify(result.json)}`);
  return result.json;
}

// Owner and Admin accounts must hold a second factor before staff APIs open.
// Tests complete the real enrolment flow once, remember the secret, and then
// answer later login challenges with a generated TOTP code.
const TOTP_SECRETS = new Map();

export async function rawLogin(handle, identifier, password = PASSWORD, ip) {
  return call(handle, "POST", "/api/auth/login", { body: { identifier, password }, ip });
}

export async function login(handle, identifier, password = PASSWORD, ip, options = {}) {
  const first = await rawLogin(handle, identifier, password, ip);
  if (first.status !== 200 || !first.json) return first;

  if (first.json.twoFactorRequired) {
    const secret = options.totpSecret ?? TOTP_SECRETS.get(identifier.toLowerCase());
    if (!secret) return first;
    const code = await totpCode(secret);
    return call(handle, "POST", "/api/auth/login/2fa", {
      body: { challengeToken: first.json.challengeToken, code },
      ip,
    });
  }

  if (first.json.twoFactorSetupRequired && !options.skipEnrol) {
    const setup = await call(handle, "POST", "/api/auth/2fa/setup", {
      cookie: first.cookie,
      body: { password },
      ip,
    });
    if (setup.status !== 200) {
      throw new Error(`2fa setup failed: ${setup.status} ${JSON.stringify(setup.json)}`);
    }
    const secret = setup.json.secret;
    const enabled = await call(handle, "POST", "/api/auth/2fa/enable", {
      cookie: first.cookie,
      body: { code: await totpCode(secret) },
      ip,
    });
    if (enabled.status !== 200) {
      throw new Error(`2fa enable failed: ${enabled.status} ${JSON.stringify(enabled.json)}`);
    }
    TOTP_SECRETS.set(identifier.toLowerCase(), secret);
  }

  return first;
}

export function totpSecretFor(identifier) {
  return TOTP_SECRETS.get(identifier.toLowerCase()) ?? null;
}
