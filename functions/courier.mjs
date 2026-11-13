// Courier handoff. Manual is the default adapter: staff book the parcel with
// the courier and paste the consignment number here. Pathao, RedX and Steadfast
// become selectable once PATHAO_*/REDX_*/STEADFAST_API_URL + API_KEY exist, and
// then the booking is placed against the configured parcel API.
import { AppError, json, readJson, rows } from "./http.mjs";
import { ORDER_COLUMNS, loadOrderDetail } from "./checkout.mjs";
import { ORDER_NUMBER_PATTERN, courierAssignSchema, parse } from "./validate.mjs";
import { recordAudit } from "./audit.mjs";
import { sendOrderSms } from "./sms.mjs";

const nowIso = () => new Date().toISOString();

const ADAPTERS = {
  manual: { label: "Manual", automatic: false },
  pathao: { label: "Pathao", automatic: true },
  redx: { label: "RedX", automatic: true },
  steadfast: { label: "Steadfast", automatic: true },
};

const read = (env, key) => {
  const value = typeof env === "function" ? env(key) : env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

function adapterConfig(provider, env) {
  const prefix = provider.toUpperCase();
  const url = read(env, `${prefix}_API_URL`);
  const key = read(env, `${prefix}_API_KEY`);
  return url && key ? { url, key } : null;
}

export function courierOptions(env) {
  return Object.entries(ADAPTERS).map(([id, adapter]) => ({
    id,
    label: adapter.label,
    automatic: adapter.automatic,
    available: id === "manual" || Boolean(adapterConfig(id, env)),
  }));
}

function trackingFrom(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.trackingCode,
    payload.tracking_code,
    payload.tracking_id,
    payload.consignment?.tracking_code,
    payload.data?.tracking_id,
    payload.data?.tracking_code,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return found ? found.trim().slice(0, 60) : null;
}

async function bookParcel(provider, order, env) {
  if (provider === "manual") return { trackingNumber: null, providerRef: null };
  const config = adapterConfig(provider, env);
  if (!config) throw new AppError("courier_unavailable", 409);

  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        merchantOrderId: order.order_number,
        recipientName: order.customer_name,
        recipientPhone: order.phone.replace(/\D/g, ""),
        recipientAddress: order.address,
        district: order.district_name_en,
        codAmountPaisa: order.payment_method === "cod" ? order.total_paisa : 0,
        description: `LootPat Bazar ${order.order_number}`,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AppError("courier_booking_failed", 502);
  }
  if (!response.ok) throw new AppError("courier_booking_failed", 502);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new AppError("courier_booking_failed", 502);
  }
  const trackingNumber = trackingFrom(payload);
  if (!trackingNumber) throw new AppError("courier_booking_failed", 502);
  return {
    trackingNumber,
    providerRef: String(payload.id ?? payload.consignment_id ?? payload.data?.id ?? trackingNumber).slice(0, 80),
  };
}

export async function handleAssignCourier(db, request, principal, orderNumber, env) {
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) throw new AppError("order_not_found", 404);
  const body = parse(courierAssignSchema, await readJson(request));

  const found = rows(
    await db.from("orders").select(ORDER_COLUMNS).eq("order_number", orderNumber).limit(1),
  );
  if (found.length !== 1) throw new AppError("order_not_found", 404);
  const order = found[0];

  if (!["confirmed", "packed", "shipped"].includes(order.status)) {
    throw new AppError("order_not_ready", 409);
  }

  let booked = { trackingNumber: body.trackingNumber ?? null, providerRef: null };
  let automatic = false;
  if (body.courier !== "manual" && !booked.trackingNumber) {
    booked = await bookParcel(body.courier, order, env);
    automatic = true;
  }

  const now = nowIso();
  const patch = {
    courier: body.courier,
    tracking_number: booked.trackingNumber,
    courier_status: "booked",
    status: "shipped",
    updated_at: now,
  };
  if (order.status !== "shipped") patch.shipped_at = now;

  const updated = rows(
    await db
      .from("orders")
      .update(patch)
      .eq("id", order.id)
      .eq("status", order.status)
      .select(ORDER_COLUMNS),
  );
  if (updated.length !== 1) throw new AppError("order_changed", 409);

  if (order.status !== "shipped") {
    const history = rows(
      await db
        .from("order_status_history")
        .insertIfAbsent(
          {
            id: crypto.randomUUID(),
            order_id: order.id,
            status: "shipped",
            note: `courier:${body.courier}`,
            actor_user_id: principal.user.id,
            created_at: now,
          },
          { onConflict: "id" },
        )
        .select("id"),
    );
    if (history.length !== 1) throw new AppError("status_history_unconfirmed", 503);
  }

  const fresh = updated[0];
  await recordAudit(db, request, principal, {
    action: "order.courier",
    entityType: "order",
    entityId: order.order_number,
    summary: `Courier ${body.courier} assigned to ${order.order_number}`,
    details: {
      from: order.status,
      to: fresh.status,
      courier: body.courier,
      trackingNumber: booked.trackingNumber,
      automatic,
      previousTracking: order.tracking_number ?? null,
    },
  });

  if (order.status !== "shipped") {
    await sendOrderSms(db, { order: fresh, template: "order.shipped", origin: "", env });
  }

  return json({
    ok: true,
    order: await loadOrderDetail(db, fresh),
    courier: { provider: body.courier, trackingNumber: booked.trackingNumber, automatic },
  });
}
