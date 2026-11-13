// Owner-editable store settings. Values are stored as text in app.settings so a
// later screen can change them without a migration. Secret gateway credentials
// are never stored here: only environment-backed configuration status is shown.
import { AppError, json, readJson, rows } from "./http.mjs";
import { readSettings } from "./checkout.mjs";
import { adminSettingsSchema, parse } from "./validate.mjs";
import { requireOwner, requirePermission } from "./rbac.mjs";
import { recordAudit } from "./audit.mjs";
import {
  courierEnvStatus,
  gatewayAvailability,
  webhookSecret,
} from "./payment-providers.mjs";

const STORE_FIELDS = {
  nameBn: "store.name_bn",
  nameEn: "store.name_en",
  phone: "store.phone",
  email: "store.email",
  addressBn: "store.address_bn",
  addressEn: "store.address_en",
  tradeLicense: "store.trade_license",
  tin: "store.tin",
  paymentNumber: "store.payment_number",
};

const DELIVERY_FIELDS = {
  dhakaChargePaisa: "delivery.dhaka_charge_paisa",
  outsideChargePaisa: "delivery.outside_charge_paisa",
  freeThresholdPaisa: "delivery.free_threshold_paisa",
  codLimitPaisa: "delivery.cod_limit_paisa",
  codEnabled: "delivery.cod_enabled",
};

const PAYMENT_FIELDS = {
  bkashEnabled: "payments.bkash_enabled",
  nagadEnabled: "payments.nagad_enabled",
  sslcommerzEnabled: "payments.sslcommerz_enabled",
};

const SECURITY_FIELDS = {
  ipAllowlist: "security.admin_ip_allowlist",
};

async function putSetting(db, key, value) {
  const updated = rows(
    await db.from("settings").update({ value }).eq("key", key).select("key"),
  );
  if (updated.length === 1) return;
  rows(await db.from("settings").insertIfAbsent({ key, value }, { onConflict: "key" }).select("key"));
}

function settingsPayload(raw, env) {
  const environment = gatewayAvailability(raw, env);
  return {
    store: {
      nameBn: raw.store.name.bn,
      nameEn: raw.store.name.en,
      phone: raw.store.phone,
      email: raw.store.email,
      addressBn: raw.store.address.bn,
      addressEn: raw.store.address.en,
      tradeLicense: raw.store.tradeLicense,
      tin: raw.store.tin,
      paymentNumber: raw.store.paymentNumber,
    },
    delivery: {
      dhakaChargePaisa: raw.delivery.dhakaPaisa,
      outsideChargePaisa: raw.delivery.outsidePaisa,
      freeThresholdPaisa: raw.delivery.freeThresholdPaisa,
      codLimitPaisa: raw.delivery.codLimitPaisa,
      codEnabled: raw.delivery.codEnabled,
    },
    payments: {
      bkashEnabled: raw.payments.bkash,
      nagadEnabled: raw.payments.nagad,
      sslcommerzEnabled: raw.payments.sslcommerz,
    },
    security: {
      ipAllowlist: raw.security.ipAllowlist,
      requireTwoFactor: raw.security.requireTwoFactor,
    },
    environment: {
      mode: environment.mode,
      providers: environment.providers,
      webhookReady: environment.mode === "sandbox" || Boolean(webhookSecret("bkash", env)),
      courier: courierEnvStatus(env),
    },
  };
}

export async function handleAdminSettings(db, env) {
  return json(settingsPayload(await readSettings(db), env));
}

export async function handleAdminSettingsUpdate(db, request, principal, env) {
  const body = parse(adminSettingsSchema, await readJson(request));
  const entries = [];

  if (body.store) {
    for (const [field, key] of Object.entries(STORE_FIELDS)) {
      const value = body.store[field];
      if (value !== undefined) entries.push([key, value]);
    }
  }
  if (body.delivery) {
    for (const [field, key] of Object.entries(DELIVERY_FIELDS)) {
      const value = body.delivery[field];
      if (value !== undefined) entries.push([key, String(value)]);
    }
  }
  if (body.payments) {
    for (const [field, key] of Object.entries(PAYMENT_FIELDS)) {
      const value = body.payments[field];
      if (value !== undefined) entries.push([key, String(value)]);
    }
  }
  if (body.security) {
    for (const [field, key] of Object.entries(SECURITY_FIELDS)) {
      const value = body.security[field];
      if (value !== undefined) entries.push([key, String(value)]);
    }
  }
  if (entries.length === 0) throw new AppError("invalid_input", 400);

  if (entries.some(([key]) => key.startsWith("payments."))) {
    requirePermission(principal, "payments.manage");
    requireOwner(principal);
  }
  if (entries.some(([key]) => key.startsWith("security."))) {
    requireOwner(principal);
  }

  for (const [key, value] of entries) await putSetting(db, key, String(value));

  await recordAudit(db, request, principal, {
    action: "settings.update",
    entityType: "settings",
    entityId: null,
    summary: `Settings updated: ${entries.length} field${entries.length === 1 ? "" : "s"}`,
    details: { keys: entries.map(([key]) => key) },
  });

  return handleAdminSettings(db, env);
}
