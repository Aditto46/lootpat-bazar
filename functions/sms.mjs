// Transactional SMS. The default "log" provider records the exact message in
// sms_log so local development and tests need no gateway; a generic HTTP
// provider is used when SMS_PROVIDER_URL and SMS_API_KEY are configured.
// Sending never fails the order or status change that triggered it.
import { rows } from "./http.mjs";

const AMOUNT = (paisa) => (paisa / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

const TEMPLATES = {
  "order.placed": (order, origin) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} গ্রহণ করা হয়েছে। মোট ৳${AMOUNT(order.total_paisa)}। ট্র্যাক করুন: ${origin}/track?order=${order.order_number}`,
  "order.confirmed": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} নিশ্চিত হয়েছে। শীঘ্রই প্যাকিং শুরু হবে।`,
  "order.packed": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} প্যাক করা হয়েছে এবং কুরিয়ারের জন্য প্রস্তুত।`,
  "order.shipped": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} কুরিয়ারে পাঠানো হয়েছে${
      order.tracking_number ? ` (ট্র্যাকিং: ${order.tracking_number})` : ""
    }।`,
  "order.delivered": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} ডেলিভার হয়েছে। আমাদের সাথে থাকার জন্য ধন্যবাদ।`,
  "order.cancelled": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} বাতিল হয়েছে। সহায়তার জন্য আমাদের হটলাইনে যোগাযোগ করুন।`,
  "order.returned": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} ফেরত নেওয়া হয়েছে। রিফান্ড শীঘ্রই প্রক্রিয়া হবে।`,
  "payment.paid": (order) =>
    `লুটপাট বাজার: অর্ডার ${order.order_number} এর ৳${AMOUNT(order.total_paisa)} পেমেন্ট নিশ্চিত হয়েছে। ধন্যবাদ।`,
};

const read = (env, key) => {
  const value = typeof env === "function" ? env(key) : env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

async function deliver(message, phone, env) {
  const url = read(env, "SMS_PROVIDER_URL");
  const apiKey = read(env, "SMS_API_KEY");
  if (!url || !apiKey) return { provider: "log", status: "logged", providerRef: null };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: phone.replace(/\D/g, ""),
        message,
        senderId: read(env, "SMS_SENDER_ID") ?? undefined,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => ({}));
    const sent = response.ok && (payload.status === undefined || /^(sent|success|ok)$/i.test(String(payload.status)));
    return {
      provider: "http",
      status: sent ? "sent" : "failed",
      providerRef: payload.id ? String(payload.id).slice(0, 80) : null,
      error: sent ? null : `provider_${response.status}`,
    };
  } catch {
    return { provider: "http", status: "failed", providerRef: null, error: "provider_unreachable" };
  }
}

/**
 * Sends one template and records the outcome. `order` is a raw orders row, so
 * callers can pass the row they already loaded without another read.
 */
export async function sendOrderSms(db, { order, template, origin, env }) {
  const build = TEMPLATES[template];
  if (!build || !order?.phone) return null;
  return sendSmsMessage(db, {
    phone: order.phone,
    message: build(order, origin).slice(0, 500),
    template,
    env,
    orderId: order.id ?? null,
  });
}

/**
 * Sends an arbitrary message through the same provider and log. Used by
 * campaigns and back-in-stock alerts, which have no order row.
 */
export async function sendSmsMessage(db, { phone, message, template, env, orderId = null }) {
  if (!phone || !message) return null;

  let result;
  try {
    result = await deliver(message.slice(0, 500), phone, env);
  } catch {
    result = { provider: "log", status: "failed", providerRef: null, error: "send_failed" };
  }

  try {
    rows(
      await db
        .from("sms_log")
        .insertIfAbsent(
          {
            id: crypto.randomUUID(),
            order_id: orderId,
            phone,
            template,
            message: message.slice(0, 500),
            provider: result.provider,
            status: result.status,
            provider_ref: result.providerRef ?? null,
            error: result.error ?? null,
            created_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        )
        .select("id"),
    );
  } catch {
    /* an unlogged SMS never blocks fulfilment */
  }
  return result;
}
