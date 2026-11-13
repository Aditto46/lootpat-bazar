// Durable fixed-window rate limiting. Counters live in the database so they
// survive restarts and apply across instances. Updates use compare-and-swap
// predicates; an unconfirmed write is never replayed.
import { AppError, rows } from "./http.mjs";

export const LIMITS = {
  login: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  login_ip: { maxAttempts: 30, windowMs: 15 * 60 * 1000 },
  register: { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  register_ip: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  setup: { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  search: { maxAttempts: 60, windowMs: 60 * 1000 },
  checkout: { maxAttempts: 12, windowMs: 60 * 60 * 1000 },
  checkout_phone: { maxAttempts: 6, windowMs: 60 * 60 * 1000 },
  coupon: { maxAttempts: 30, windowMs: 60 * 1000 },
  order_lookup: { maxAttempts: 60, windowMs: 60 * 1000 },
  track: { maxAttempts: 10, windowMs: 10 * 60 * 1000 },
  track_order: { maxAttempts: 10, windowMs: 10 * 60 * 1000 },
  payment_session: { maxAttempts: 20, windowMs: 10 * 60 * 1000 },
  payment_sandbox: { maxAttempts: 20, windowMs: 10 * 60 * 1000 },
  payment_verify: { maxAttempts: 30, windowMs: 10 * 60 * 1000 },
  support_start: { maxAttempts: 6, windowMs: 60 * 60 * 1000 },
  support_message: { maxAttempts: 40, windowMs: 10 * 60 * 1000 },
  support_handoff: { maxAttempts: 6, windowMs: 60 * 60 * 1000 },
  support_reply: { maxAttempts: 120, windowMs: 60 * 1000 },
  review_create: { maxAttempts: 6, windowMs: 60 * 60 * 1000 },
  review_helpful: { maxAttempts: 40, windowMs: 60 * 1000 },
  spin: { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  spin_visitor: { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
  back_in_stock: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  unsubscribe: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  cart_reminder: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  loyalty_redeem: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  login_2fa: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  login_2fa_ip: { maxAttempts: 30, windowMs: 15 * 60 * 1000 },
  two_factor_setup: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  password_change: { maxAttempts: 6, windowMs: 15 * 60 * 1000 },
  account_delete: { maxAttempts: 3, windowMs: 60 * 60 * 1000 },
  backup_create: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
};

const MAX_CAS_ATTEMPTS = 24;

const iso = (ms) => new Date(ms).toISOString();
const bucketKey = (scope, subject) => `${scope}:${subject}`;

async function readBucket(db, key) {
  return rows(
    await db.from("auth_limiter").select("key,window_started_at,attempt_count").eq("key", key).limit(1),
  );
}

export async function consume(db, scope, subject, now = Date.now()) {
  const limit = LIMITS[scope];
  if (!limit) throw new AppError("limiter_unavailable", 503);
  const key = bucketKey(scope, subject);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const found = await readBucket(db, key);

    if (found.length === 0) {
      const inserted = rows(
        await db
          .from("auth_limiter")
          .insertIfAbsent(
            { key, window_started_at: iso(now), attempt_count: 1 },
            { onConflict: "key" },
          )
          .select("key"),
      );
      if (inserted.length === 1) return { allowed: true, remaining: limit.maxAttempts - 1 };
      continue;
    }

    const row = found[0];
    const startedAt = Date.parse(row.window_started_at);
    const count = row.attempt_count;
    if (typeof row.window_started_at !== "string" || !Number.isSafeInteger(count) || count < 0) {
      throw new AppError("limiter_unavailable", 503);
    }

    if (!Number.isFinite(startedAt) || now - startedAt >= limit.windowMs) {
      const reset = rows(
        await db
          .from("auth_limiter")
          .update({ window_started_at: iso(now), attempt_count: 1 })
          .eq("key", key)
          .eq("window_started_at", row.window_started_at)
          .select("key"),
      );
      if (reset.length === 1) return { allowed: true, remaining: limit.maxAttempts - 1 };
      continue;
    }

    if (count >= limit.maxAttempts) {
      return { allowed: false, retryAfterMs: Math.max(0, startedAt + limit.windowMs - now) };
    }

    const incremented = rows(
      await db
        .from("auth_limiter")
        .update({ attempt_count: count + 1 })
        .eq("key", key)
        .eq("window_started_at", row.window_started_at)
        .eq("attempt_count", count)
        .select("key"),
    );
    if (incremented.length === 1) return { allowed: true, remaining: limit.maxAttempts - (count + 1) };
  }

  throw new AppError("limiter_busy", 503);
}

// A successful login deliberately does not reset the counter: a fixed window is
// stricter and cannot be used to buy unlimited attempts.
