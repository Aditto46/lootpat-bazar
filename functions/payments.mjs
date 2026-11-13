// Online payment sessions and settlement. Three rules hold everywhere in this
// module: the amount always comes from the persisted order, a provider event is
// accepted only when its signature matches the raw body, and marking an order
// paid is idempotent through the (provider, event_id) uniqueness constraint.
import { AppError, clientIp, json, readJson, readRawBody, rows, secureCompare } from "./http.mjs";
import { consume } from "./limiter.mjs";
import { ORDER_COLUMNS, loadOrderDetail, readSettings } from "./checkout.mjs";
import {
  ONLINE_METHODS,
  createProviderSession,
  gatewayAvailability,
  paymentMode,
  signWebhook,
  verifyProviderPayment,
  webhookSecret,
} from "./payment-providers.mjs";
import {
  paymentSessionSchema,
  paymentVerifySchema,
  paymentWebhookSchema,
  sandboxCompleteSchema,
  parse,
} from "./validate.mjs";
import { recordSystemAudit } from "./audit.mjs";
import { sendOrderSms } from "./sms.mjs";

const SESSION_COLUMNS =
  "id,order_id,provider,amount_paisa,status,provider_ref,redirect_url,sandbox_token,expires_at,created_at,updated_at";
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 300;

const nowIso = () => new Date().toISOString();

function rateLimited(result) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return json({ error: "rate_limited" }, 429, { "retry-after": String(seconds) });
}

async function limit(db, scope, subject) {
  const result = await consume(db, scope, subject);
  return result.allowed ? null : rateLimited(result);
}

async function findOrder(db, orderNumber) {
  const found = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("order_number", orderNumber).limit(1),
  );
  if (found.length !== 1) throw new AppError("order_not_found", 404);
  return found[0];
}

function sessionView(row) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    amountPaisa: row.amount_paisa,
    redirectUrl: row.redirect_url,
    expiresAt: row.expires_at,
  };
}

async function latestSessions(db, orderId, provider) {
  return rows(
    await db
      .from("payment_sessions")
      .select(SESSION_COLUMNS)
      .eq("order_id", orderId)
      .eq("provider", provider)
      .limit(10),
  );
}

async function markSession(db, sessionId, status, providerRef) {
  const patch = { status, updated_at: nowIso() };
  if (providerRef) patch.provider_ref = providerRef;
  try {
    await db.from("payment_sessions").update(patch).eq("id", sessionId).select("id");
  } catch {
    /* the order-level status stays authoritative for the customer */
  }
}

async function closePendingSessions(db, orderId, provider, status) {
  try {
    await db
      .from("payment_sessions")
      .update({ status, updated_at: nowIso() })
      .eq("order_id", orderId)
      .eq("provider", provider)
      .eq("status", "pending")
      .select("id");
  } catch {
    /* sessions are an audit aid, not the source of payment truth */
  }
}

async function markPaymentsFailed(db, orderId) {
  try {
    await db
      .from("payments")
      .update({ status: "failed", updated_at: nowIso() })
      .eq("order_id", orderId)
      .eq("status", "pending")
      .select("id");
  } catch {
    /* the order row already carries the status the customer sees */
  }
}

async function setOrderPaymentStatus(db, order, status) {
  if (order.payment_status === "paid" && status !== "paid") return order;
  const updated = rows(
    await db
      .from("orders")
      .update({ payment_status: status, updated_at: nowIso() })
      .eq("id", order.id)
      .eq("payment_status", order.payment_status)
      .select(ORDER_COLUMNS),
  );
  return updated.length === 1 ? updated[0] : { ...order, payment_status: status };
}

/**
 * Creates or reuses a payment session. Possession of the order lookup token is
 * required, so knowing an order number alone does not allow starting a payment.
 */
export async function handleCreatePaymentSession(db, request, context) {
  const limited = await limit(db, "payment_session", clientIp(request));
  if (limited) return limited;

  const body = parse(paymentSessionSchema, await readJson(request));
  const order = await findOrder(db, body.orderNumber);
  if (!(await secureCompare(body.lookupToken, order.lookup_token))) {
    throw new AppError("order_not_found", 404);
  }
  if (order.payment_method !== body.provider) throw new AppError("payment_method_mismatch", 409);
  if (order.payment_status === "paid") throw new AppError("payment_already_paid", 409);
  if (["cancelled", "returned"].includes(order.status)) throw new AppError("order_closed", 409);

  const settings = await readSettings(db);
  const availability = gatewayAvailability(settings, context.env);
  if (!availability.providers[body.provider]?.available) {
    throw new AppError("payment_method_unavailable", 409);
  }

  const now = Date.now();
  const reusable = (await latestSessions(db, order.id, body.provider))
    .filter((row) => row.status === "pending" && Date.parse(row.expires_at) > now + 30_000)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
  if (reusable) return json({ session: sessionView(reusable) });

  const sessionId = crypto.randomUUID();
  const sandboxToken = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const created = await createProviderSession({
    provider: body.provider,
    order,
    sessionId,
    sandboxToken,
    origin: context.origin,
    env: context.env,
  });

  const row = {
    id: sessionId,
    order_id: order.id,
    provider: body.provider,
    amount_paisa: order.total_paisa,
    status: "pending",
    provider_ref: created.providerRef ?? null,
    redirect_url: created.redirectUrl,
    sandbox_token: sandboxToken,
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const inserted = rows(
    await db.from("payment_sessions").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (inserted.length !== 1) throw new AppError("payment_session_unconfirmed", 503);

  return json(
    {
      session: {
        ...sessionView(row),
        mode: created.mode ?? availability.mode,
      },
    },
    201,
  );
}

/** Sandbox pay page data. Only the per-session token can read it. */
export async function handlePaymentSessionInfo(db, request, sessionId, env) {
  const limited = await limit(db, "payment_session", clientIp(request));
  if (limited) return limited;
  if (paymentMode(env) !== "sandbox") throw new AppError("not_found", 404);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const found = rows(
    await db.from("payment_sessions").select(SESSION_COLUMNS).eq("id", sessionId).limit(1),
  );
  if (found.length !== 1) throw new AppError("payment_session_not_found", 404);
  const session = found[0];
  if (!(await secureCompare(token, session.sandbox_token))) {
    throw new AppError("payment_session_not_found", 404);
  }

  const order = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("id", session.order_id).limit(1),
  )[0];
  if (!order) throw new AppError("payment_session_not_found", 404);

  let status = session.status;
  if (status === "pending" && Date.parse(session.expires_at) <= Date.now()) {
    status = "expired";
    await markSession(db, session.id, "expired");
  }

  return json({
    session: {
      id: session.id,
      provider: session.provider,
      status,
      amountPaisa: session.amount_paisa,
      expiresAt: session.expires_at,
      orderNumber: order.order_number,
      paymentStatus: order.payment_status,
    },
  });
}

/**
 * Local checkout simulator. It builds a real signed provider event and sends it
 * through the same verification and settlement path as a live webhook.
 */
export async function handleSandboxComplete(db, request, sessionId, context) {
  const limited = await limit(db, "payment_sandbox", clientIp(request));
  if (limited) return limited;
  if (paymentMode(context.env) !== "sandbox") throw new AppError("not_found", 404);

  const body = parse(sandboxCompleteSchema, await readJson(request));
  const found = rows(
    await db.from("payment_sessions").select(SESSION_COLUMNS).eq("id", sessionId).limit(1),
  );
  if (found.length !== 1) throw new AppError("payment_session_not_found", 404);
  const session = found[0];
  if (!(await secureCompare(body.token, session.sandbox_token))) {
    throw new AppError("payment_session_not_found", 404);
  }

  const order = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("id", session.order_id).limit(1),
  )[0];
  if (!order) throw new AppError("payment_session_not_found", 404);

  const redirectUrl = `/order/${encodeURIComponent(order.order_number)}?token=${encodeURIComponent(order.lookup_token)}`;
  if (order.payment_status === "paid" || session.status === "paid") {
    return json({ ok: true, paid: true, redirectUrl });
  }
  if (session.status === "expired" || Date.parse(session.expires_at) <= Date.now()) {
    await markSession(db, session.id, "expired");
    throw new AppError("payment_session_expired", 409);
  }
  if (session.status !== "pending") throw new AppError("payment_session_closed", 409);

  if (body.outcome === "failure") {
    await markSession(db, session.id, "failed", session.provider_ref);
    await setOrderPaymentStatus(db, order, "failed");
    await markPaymentsFailed(db, order.id);
    await recordSystemAudit(db, {
      action: "payment.failed",
      entityType: "order",
      entityId: order.order_number,
      summary: `Sandbox payment declined for ${order.order_number}`,
      details: { provider: session.provider, sessionId: session.id },
      ip: clientIp(request),
    });
    return json({ ok: true, paid: false, redirectUrl });
  }

  const payload = {
    eventId: `sandbox:${session.id}`,
    event: "payment.paid",
    orderNumber: order.order_number,
    amountPaisa: order.total_paisa,
    providerRef: `SBX-${session.id.slice(0, 8).toUpperCase()}`,
  };
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = webhookSecret(session.provider, context.env);
  if (!secret) throw new AppError("payment_provider_unavailable", 503);
  const signature = await signWebhook(secret, timestamp, raw);
  if (!(await verifySignature(secret, timestamp, raw, signature))) {
    throw new AppError("invalid_signature", 401);
  }
  const result = await settleEvent(db, {
    provider: session.provider,
    payload,
    env: context.env,
    ip: clientIp(request),
  });
  if (result.status !== 200) return json(result.body, result.status);
  return json({ ok: true, paid: true, redirectUrl });
}

/**
 * Server-to-server confirmation for live gateways. The provider answer, not the
 * browser query string, decides whether the order is paid.
 */
export async function handlePaymentVerify(db, request, context) {
  const limited = await limit(db, "payment_verify", clientIp(request));
  if (limited) return limited;
  if (paymentMode(context.env) === "sandbox") throw new AppError("sandbox_payment_only", 409);

  const body = parse(paymentVerifySchema, await readJson(request));
  const order = await findOrder(db, body.orderNumber);
  if (!(await secureCompare(body.lookupToken, order.lookup_token))) {
    throw new AppError("order_not_found", 404);
  }
  if (order.payment_method === "cod") throw new AppError("payment_method_mismatch", 409);

  const found = rows(
    await db.from("payment_sessions").select(SESSION_COLUMNS).eq("id", body.sessionId).limit(1),
  );
  if (found.length !== 1 || found[0].order_id !== order.id) {
    throw new AppError("payment_session_not_found", 404);
  }
  const session = found[0];
  if (session.provider !== order.payment_method) throw new AppError("payment_method_mismatch", 409);
  if (session.status === "paid" || order.payment_status === "paid") {
    return json({ ok: true, paid: true, order: await loadOrderDetail(db, order) });
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    await markSession(db, session.id, "expired");
    throw new AppError("payment_session_expired", 409);
  }

  const result = await verifyProviderPayment({
    provider: session.provider,
    order,
    session,
    providerReference: body.providerReference,
    env: context.env,
  });

  if (!result.paid || result.amountPaisa !== order.total_paisa) {
    await markSession(db, session.id, "failed", result.providerRef);
    const failed = await setOrderPaymentStatus(db, order, "failed");
    await markPaymentsFailed(db, order.id);
    await recordSystemAudit(db, {
      action: "payment.rejected",
      entityType: "order",
      entityId: order.order_number,
      summary: `Payment not confirmed for ${order.order_number}`,
      details: {
        provider: session.provider,
        sessionId: session.id,
        reportedAmountPaisa: Number.isFinite(result.amountPaisa) ? result.amountPaisa : null,
        expectedAmountPaisa: order.total_paisa,
      },
      ip: clientIp(request),
    });
    return json({ ok: true, paid: false, order: await loadOrderDetail(db, failed) });
  }

  const settled = await settleEvent(db, {
    provider: session.provider,
    payload: {
      eventId: `verify:${session.id}`,
      event: "payment.paid",
      orderNumber: order.order_number,
      amountPaisa: result.amountPaisa,
      providerRef: result.providerRef,
    },
    env: context.env,
    ip: clientIp(request),
  });
  if (settled.status !== 200) return json(settled.body, settled.status);
  const fresh = await findOrder(db, order.order_number);
  return json({ ok: true, paid: true, order: await loadOrderDetail(db, fresh) });
}

// ---------------------------------------------------------------------------
// Webhook verification and settlement

function normalizedSignature(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed.slice(7) : trimmed;
}

async function verifySignature(secret, timestamp, raw, signature) {
  if (!/^\d{10}$/.test(timestamp)) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (skew > CLOCK_SKEW_SECONDS) return false;
  const expected = await signWebhook(secret, timestamp, raw);
  return secureCompare(normalizedSignature(signature).toLowerCase(), expected);
}

async function recordEvent(db, { provider, payload, order, outcome, reason }) {
  return rows(
    await db
      .from("webhook_events")
      .insertIfAbsent(
        {
          id: crypto.randomUUID(),
          provider,
          event_id: payload.eventId,
          order_id: order?.id ?? null,
          amount_paisa: payload.amountPaisa,
          outcome,
          reason: reason ?? null,
          created_at: nowIso(),
        },
        { onConflict: "provider,event_id" },
      )
      .select("id"),
  );
}

async function updateEventOutcome(db, provider, eventId, outcome, reason = null) {
  try {
    await db
      .from("webhook_events")
      .update({ outcome, reason })
      .eq("provider", provider)
      .eq("event_id", eventId)
      .select("id");
  } catch {
    /* the order status is already persisted */
  }
}

async function settleEvent(db, { provider, payload, env, ip }) {
  let order;
  try {
    order = await findOrder(db, payload.orderNumber);
  } catch {
    return { status: 404, body: { error: "order_not_found" } };
  }

  let rejection = null;
  if (order.payment_method !== provider) rejection = "provider_mismatch";
  else if (order.total_paisa !== payload.amountPaisa) rejection = "amount_mismatch";

  const inserted = await recordEvent(db, {
    provider,
    payload,
    order,
    outcome: rejection ? "rejected" : "accepted",
    reason: rejection,
  });
  if (inserted.length === 0) {
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  if (rejection) {
    return { status: 409, body: { error: rejection } };
  }

  if (payload.event === "payment.failed") {
    const failed = await setOrderPaymentStatus(db, order, "failed");
    await markPaymentsFailed(db, order.id);
    await closePendingSessions(db, order.id, provider, "failed");
    await updateEventOutcome(db, provider, payload.eventId, "accepted");
    await recordSystemAudit(db, {
      action: "payment.failed",
      entityType: "order",
      entityId: order.order_number,
      summary: `Provider reported a failed payment for ${order.order_number}`,
      details: { provider, providerRef: payload.providerRef },
      ip,
    });
    return { status: 200, body: { ok: true, paid: false, paymentStatus: failed.payment_status } };
  }

  if (order.payment_status === "paid") {
    await updateEventOutcome(db, provider, payload.eventId, "duplicate");
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  const now = nowIso();
  const updated = rows(
    await db
      .from("orders")
      .update({ payment_status: "paid", updated_at: now })
      .eq("id", order.id)
      .eq("payment_status", order.payment_status)
      .select(ORDER_COLUMNS),
  );
  if (updated.length !== 1) {
    const fresh = rows(
      await db.from("orders").select(ORDER_COLUMNS).eq("id", order.id).limit(1),
    )[0];
    if (fresh?.payment_status === "paid") {
      await updateEventOutcome(db, provider, payload.eventId, "duplicate");
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    await updateEventOutcome(db, provider, payload.eventId, "failed", "update_unconfirmed");
    return { status: 503, body: { error: "update_unconfirmed" } };
  }
  const fresh = updated[0];

  try {
    await db
      .from("payments")
      .update({ status: "paid", provider_ref: payload.providerRef, updated_at: now })
      .eq("order_id", order.id)
      .select("id");
  } catch {
    /* the order row already carries the paid status */
  }
  await closePendingSessions(db, order.id, provider, "paid");
  await updateEventOutcome(db, provider, payload.eventId, "accepted");

  await recordSystemAudit(db, {
    action: "payment.paid",
    entityType: "order",
    entityId: order.order_number,
    summary: `Payment confirmed for ${order.order_number}`,
    details: { provider, providerRef: payload.providerRef, amountPaisa: payload.amountPaisa },
    ip,
  });
  await sendOrderSms(db, { order: fresh, template: "payment.paid", origin: "", env });

  return { status: 200, body: { ok: true, paid: true, orderNumber: order.order_number } };
}

export async function handlePaymentWebhook(db, provider, request, env) {
  if (!ONLINE_METHODS.includes(provider)) throw new AppError("not_found", 404);
  const secret = webhookSecret(provider, env);
  if (!secret) throw new AppError("payment_provider_unavailable", 503);

  const raw = new TextDecoder().decode(await readRawBody(request, 32 * 1024));
  const timestamp = request.headers.get("x-webhook-timestamp") ?? "";
  const signature = request.headers.get("x-webhook-signature") ?? "";
  if (!(await verifySignature(secret, timestamp, raw, signature))) {
    return json({ error: "invalid_signature" }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new AppError("invalid_input", 400);
  }
  const parsed = paymentWebhookSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("invalid_input", 400);

  const result = await settleEvent(db, {
    provider,
    payload: parsed.data,
    env,
    ip: clientIp(request),
  });
  return json(result.body, result.status);
}
