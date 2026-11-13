// Local development API runner. Uses the in-memory adapter from dev/test so the
// same pure route code can be exercised with Node (no Deno or platform SDK).
//
//   npm run dev:api      # http://127.0.0.1:8000/functions/v1/app
//
// Vite proxies /functions/v1/app here. Data is in memory and resets on restart.
import http from "node:http";
import { createApplication } from "../functions/app.mjs";
import { hashPassword } from "../functions/passwords.mjs";
import { seedBaseline } from "../functions/seed.mjs";
import { createFakeDb } from "./test/fake-db.mjs";

const PORT = Number(process.env.PORT ?? 8000);
const ORIGIN = process.env.APP_ORIGIN ?? "http://127.0.0.1:5173";
const SETUP_TOKEN = process.env.SETUP_TOKEN ?? "dev-setup-token";
const PASSWORD = process.env.DEV_PASSWORD ?? "LootPat#2026";
const DEV_ACCOUNTS = [
  { id: "2f0c7a54-7d1f-4b8e-9c3a-000000000001", name: "ডেমো মালিক", email: "owner@lootpat.test", role: "owner" },
  { id: "2f0c7a54-7d1f-4b8e-9c3a-000000000002", name: "ডেমো অ্যাডমিন", email: "admin@lootpat.test", role: "admin" },
  { id: "2f0c7a54-7d1f-4b8e-9c3a-000000000003", name: "ডেমো ভিউয়ার", email: "viewer@lootpat.test", role: "viewer" },
];

const db = createFakeDb();
// Sandbox payments need no gateway credentials; the webhook secret is a fixed
// local constant so the sandbox completion path exercises real HMAC verification.
const ENV = {
  PAYMENTS_MODE: process.env.PAYMENTS_MODE ?? "sandbox",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET ?? "lootpat-sandbox-webhook",
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(BKASH|NAGAD|SSLCOMMERZ|PATHAO|REDX|STEADFAST|SMS)_/.test(key),
    ),
  ),
};
const handle = createApplication({ db, origin: ORIGIN, setupToken: SETUP_TOKEN, env: ENV });

const seeded = await seedBaseline(db);
console.log("Seeded:", seeded.map((entry) => `${entry.table}=${entry.total}`).join(" "));

for (const account of DEV_ACCOUNTS) {
  const existing = await db.from("users").select("id").eq("email", account.email).limit(1);
  if (existing.data.length > 0) continue;
  const derived = await hashPassword(PASSWORD);
  const now = new Date().toISOString();
  await db.from("users").insertIfAbsent({
    id: account.id,
    name: account.name,
    email: account.email,
    phone: null,
    role_id: account.role,
    password_salt: derived.salt,
    password_hash: derived.hash,
    password_iterations: derived.iterations,
    status: "active",
    last_login_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }, { onConflict: "email" }).select("id");
  console.log(`  ${account.role.padEnd(8)} ${account.email}  ${PASSWORD}`);
}

async function readBody(request) {
  if (["GET", "HEAD"].includes(request.method)) return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  try {
    const body = await readBody(request);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    const url = `http://127.0.0.1:${PORT}${request.url}`;
    const result = await handle(new Request(url, { method: request.method, headers, body }));
    response.statusCode = result.status;
    for (const [key, value] of result.headers) {
      if (key === "set-cookie") continue;
      response.setHeader(key, value);
    }
    const cookies = result.headers.getSetCookie?.() ?? [];
    if (cookies.length > 0) response.setHeader("set-cookie", cookies);
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.end("internal_error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${PORT}/functions/v1/app (origin ${ORIGIN})`);
  console.log(`Setup token: ${SETUP_TOKEN}`);
});
