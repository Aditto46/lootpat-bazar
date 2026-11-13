// Payment gateway adapters. Sandbox mode is fully local and exercises the same
// session and signed-settlement pipeline as production. Live mode talks to the
// provider's own endpoint; credentials never leave the server and no card data
// is ever read, stored or forwarded.
import { AppError } from "./http.mjs";

export const ONLINE_METHODS = ["bkash", "nagad", "sslcommerz"];

export const SANDBOX_WEBHOOK_SECRET = "lootpat-sandbox-webhook";

const PROVIDER_LABELS = {
  bkash: "bKash",
  nagad: "Nagad",
  sslcommerz: "SSLCommerz",
};

const read = (env, key) => {
  const value = typeof env === "function" ? env(key) : env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export function paymentMode(env) {
  return read(env, "PAYMENTS_MODE") === "live" ? "live" : "sandbox";
}

export function webhookSecret(provider, env) {
  const specific = read(env, `${provider.toUpperCase()}_WEBHOOK_SECRET`);
  if (specific) return specific;
  const shared = read(env, "WEBHOOK_SECRET");
  if (shared) return shared;
  return paymentMode(env) === "sandbox" ? SANDBOX_WEBHOOK_SECRET : null;
}

function liveConfig(provider, env) {
  if (provider === "bkash") {
    const config = {
      base: read(env, "BKASH_BASE_URL") ?? "https://tokenized.pay.bka.sh/v1.2.0-beta",
      appKey: read(env, "BKASH_APP_KEY"),
      appSecret: read(env, "BKASH_APP_SECRET"),
      username: read(env, "BKASH_USERNAME"),
      password: read(env, "BKASH_PASSWORD"),
    };
    return config.appKey && config.appSecret && config.username && config.password ? config : null;
  }
  if (provider === "nagad") {
    const config = {
      base: read(env, "NAGAD_BASE_URL"),
      merchantId: read(env, "NAGAD_MERCHANT_ID"),
      merchantKey: read(env, "NAGAD_MERCHANT_KEY"),
    };
    return config.base && config.merchantId && config.merchantKey ? config : null;
  }
  if (provider === "sslcommerz") {
    const config = {
      base: read(env, "SSLCOMMERZ_BASE_URL") ?? "https://sandbox.sslcommerz.com",
      storeId: read(env, "SSLCOMMERZ_STORE_ID"),
      storePassword: read(env, "SSLCOMMERZ_STORE_PASSWORD"),
    };
    return config.storeId && config.storePassword ? config : null;
  }
  return null;
}

export function gatewayAvailability(settings, env) {
  const mode = paymentMode(env);
  const providers = {};
  for (const id of ONLINE_METHODS) {
    const configured = mode === "sandbox" ? true : Boolean(liveConfig(id, env));
    const enabled = settings?.payments?.[id] === true;
    providers[id] = { label: PROVIDER_LABELS[id], enabled, configured, available: enabled && configured };
  }
  return { mode, providers };
}

export function providerConfigured(provider, env) {
  return paymentMode(env) === "sandbox" || Boolean(liveConfig(provider, env));
}

// Signature input is `<unix seconds>.<raw body>`, so a captured body cannot be
// replayed outside the five-minute acceptance window.
export async function signWebhook(secret, timestamp, rawBody) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${rawBody}`),
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function courierEnvStatus(env) {
  return {
    pathao: Boolean(read(env, "PATHAO_API_URL") && read(env, "PATHAO_API_KEY")),
    redx: Boolean(read(env, "REDX_API_URL") && read(env, "REDX_API_KEY")),
    steadfast: Boolean(read(env, "STEADFAST_API_URL") && read(env, "STEADFAST_API_KEY")),
    sms: Boolean(read(env, "SMS_PROVIDER_URL") && read(env, "SMS_API_KEY")),
  };
}

const decimalAmount = (paisa) => (paisa / 100).toFixed(2);

async function providerJson(url, init, unavailableCode = "payment_provider_unavailable") {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new AppError(unavailableCode, 502);
  }
  const text = await response.text();
  if (!response.ok) throw new AppError(unavailableCode, 502);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(unavailableCode, 502);
  }
}

/**
 * Returns `{ redirectUrl, providerRef }`. `sessionId` is the internal payment
 * session id and is reused as the merchant transaction id at the gateway.
 */
export async function createProviderSession({ provider, order, sessionId, sandboxToken, origin, env }) {
  const mode = paymentMode(env);
  if (mode === "sandbox") {
    const query = new URLSearchParams({ session: sessionId, token: sandboxToken });
    return {
      redirectUrl: `${origin}/pay/${encodeURIComponent(order.order_number)}?${query.toString()}`,
      providerRef: `SBX-${sessionId.slice(0, 8).toUpperCase()}`,
      mode,
    };
  }

  const callback = new URL(`/order/${encodeURIComponent(order.order_number)}`, origin);
  callback.searchParams.set("token", order.lookup_token);
  callback.searchParams.set("payment", "return");
  callback.searchParams.set("session", sessionId);

  if (provider === "bkash") {
    const config = liveConfig(provider, env);
    if (!config) throw new AppError("payment_provider_unavailable", 503);
    const granted = await providerJson(`${config.base}/tokenized/checkout/token/grant`, {
      method: "POST",
      headers: { "content-type": "application/json", username: config.username, password: config.password },
      body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }),
    });
    const token = granted.id_token;
    if (typeof token !== "string" || !token) throw new AppError("payment_provider_unavailable", 502);

    const created = await providerJson(`${config.base}/tokenized/checkout/create`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token,
        "x-app-key": config.appKey,
      },
      body: JSON.stringify({
        mode: "0011",
        payerReference: order.phone,
        callbackURL: callback.toString(),
        amount: decimalAmount(order.total_paisa),
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: order.order_number,
      }),
    });
    if (created.statusCode !== "0000" || typeof created.bkashURL !== "string") {
      throw new AppError("payment_provider_unavailable", 502);
    }
    return { redirectUrl: created.bkashURL, providerRef: String(created.paymentID ?? sessionId), mode };
  }

  if (provider === "nagad") {
    const config = liveConfig(provider, env);
    if (!config) throw new AppError("payment_provider_unavailable", 503);
    const created = await providerJson(`${config.base}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.merchantKey}`,
        "x-merchant-id": config.merchantId,
      },
      body: JSON.stringify({
        merchantId: config.merchantId,
        merchantOrderId: order.order_number,
        amountPaisa: order.total_paisa,
        currency: "BDT",
        callbackUrl: callback.toString(),
        customer: { name: order.customer_name, phone: order.phone },
      }),
    });
    if (typeof created.redirectUrl !== "string" || !created.redirectUrl) {
      throw new AppError("payment_provider_unavailable", 502);
    }
    return { redirectUrl: created.redirectUrl, providerRef: String(created.providerRef ?? sessionId), mode };
  }

  const config = liveConfig(provider, env);
  if (!config) throw new AppError("payment_provider_unavailable", 503);
  const form = new URLSearchParams({
    store_id: config.storeId,
    store_passwd: config.storePassword,
    total_amount: decimalAmount(order.total_paisa),
    currency: "BDT",
    tran_id: sessionId,
    success_url: callback.toString(),
    fail_url: callback.toString(),
    cancel_url: callback.toString(),
    ipn_url: `${origin}/functions/v1/app/api/payments/webhook/sslcommerz`,
    cus_name: order.customer_name,
    cus_phone: order.phone,
    cus_email: order.email ?? "customer@lootpat.bd",
    cus_add1: order.address,
    cus_city: order.district_name_en,
    cus_country: "Bangladesh",
    shipping_method: "Courier",
    product_name: order.order_number,
    product_category: "General",
    product_profile: "general",
    value_a: order.order_number,
  });
  const created = await providerJson(`${config.base}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (created.status !== "SUCCESS" || typeof created.GatewayPageURL !== "string") {
    throw new AppError("payment_provider_unavailable", 502);
  }
  return { redirectUrl: created.GatewayPageURL, providerRef: sessionId, mode };
}

/**
 * Server-to-server confirmation. The client return page is never trusted for
 * the outcome or the amount; only the provider's own status answer is.
 */
export async function verifyProviderPayment({ provider, order, session, providerReference, env }) {
  const config = liveConfig(provider, env);
  if (!config) throw new AppError("payment_provider_unavailable", 503);
  const ref = session.provider_ref || session.id;

  if (provider === "bkash") {
    const granted = await providerJson(`${config.base}/tokenized/checkout/token/grant`, {
      method: "POST",
      headers: { "content-type": "application/json", username: config.username, password: config.password },
      body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }),
    });
    const token = granted.id_token;
    if (typeof token !== "string" || !token) throw new AppError("payment_provider_unavailable", 502);
    const status = await providerJson(`${config.base}/tokenized/checkout/payment/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: token,
        "x-app-key": config.appKey,
      },
      body: JSON.stringify({ paymentID: ref }),
    });
    const paid = status.transactionStatus === "Completed" &&
      status.merchantInvoiceNumber === order.order_number;
    return {
      paid,
      amountPaisa: Math.round(Number(status.amount) * 100),
      providerRef: String(status.trxID ?? ref),
      detail: status.transactionStatus ?? null,
    };
  }

  if (provider === "nagad") {
    const status = await providerJson(`${config.base}/sessions/${encodeURIComponent(ref)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.merchantKey}`, "x-merchant-id": config.merchantId },
    });
    return {
      paid: status.status === "paid" || status.status === "success",
      amountPaisa: Number(status.amountPaisa),
      providerRef: String(status.providerRef ?? ref),
      detail: String(status.status ?? ""),
    };
  }

  const query = new URLSearchParams({
    val_id: providerReference ?? "",
    store_id: config.storeId,
    store_passwd: config.storePassword,
    format: "json",
  });
  const status = await providerJson(`${config.base}/validator/api/validationserverAPI.php?${query}`, {
    method: "GET",
  });
  const valid = typeof status.status === "string" && /^valid/i.test(status.status);
  const tranMatches = status.tran_id === session.id || status.value_a === order.order_number;
  return {
    paid: valid && tranMatches,
    amountPaisa: Math.round(Number(status.amount) * 100),
    providerRef: String(status.bank_tran_id ?? status.tran_id ?? ref),
    detail: status.status ?? null,
  };
}
