import { KeyRound, Loader2, Save, Store, Truck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Field, FormAlert, PageLoading, fieldClass, primaryButtonClass } from "../../components/auth/AuthShell";
import {
  adminErrorKey,
  loadAdminSettings,
  saveAdminSettings,
  type AdminSettings,
  type AdminSettingsInput,
} from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { useI18n, type DictKey } from "../../lib/i18n";
import { cn } from "@/lib/utils";
import { AdminShell } from "./AdminShell";

type MoneyKey = "dhakaCharge" | "outsideCharge" | "freeThreshold" | "codLimit";

type Draft = {
  nameBn: string;
  nameEn: string;
  phone: string;
  email: string;
  addressBn: string;
  addressEn: string;
  tradeLicense: string;
  tin: string;
  paymentNumber: string;
  dhakaCharge: string;
  outsideCharge: string;
  freeThreshold: string;
  codLimit: string;
  codEnabled: boolean;
  bkashEnabled: boolean;
  nagadEnabled: boolean;
  sslcommerzEnabled: boolean;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PAISA = 10_000_000;

function taka(value: number): string {
  return String(Math.round(value) / 100);
}

function toDraft(settings: AdminSettings): Draft {
  return {
    nameBn: settings.store.nameBn,
    nameEn: settings.store.nameEn,
    phone: settings.store.phone,
    email: settings.store.email,
    addressBn: settings.store.addressBn,
    addressEn: settings.store.addressEn,
    tradeLicense: settings.store.tradeLicense,
    tin: settings.store.tin,
    paymentNumber: settings.store.paymentNumber,
    dhakaCharge: taka(settings.delivery.dhakaChargePaisa),
    outsideCharge: taka(settings.delivery.outsideChargePaisa),
    freeThreshold: taka(settings.delivery.freeThresholdPaisa),
    codLimit: taka(settings.delivery.codLimitPaisa),
    codEnabled: settings.delivery.codEnabled,
    bkashEnabled: settings.payments.bkashEnabled,
    nagadEnabled: settings.payments.nagadEnabled,
    sslcommerzEnabled: settings.payments.sslcommerzEnabled,
  };
}

function toPaisa(value: string): number | null {
  const cleaned = value.replace(/[,\s৳]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_PAISA ? amount : null;
}

const PROVIDER_ORDER = ["bkash", "nagad", "sslcommerz"] as const;

type PaymentDraftKey = "bkashEnabled" | "nagadEnabled" | "sslcommerzEnabled";

const PROVIDER_LABEL: Record<(typeof PROVIDER_ORDER)[number], DictKey> = {
  bkash: "checkout.bkash",
  nagad: "checkout.nagad",
  sslcommerz: "checkout.card",
};

const PROVIDER_FIELD: Record<(typeof PROVIDER_ORDER)[number], PaymentDraftKey> = {
  bkash: "bkashEnabled",
  nagad: "nagadEnabled",
  sslcommerz: "sslcommerzEnabled",
};

export function SettingsPage() {
  const { t } = useI18n();
  const { user, hasPermission } = useAuth();
  const canWrite = hasPermission("settings.write");
  const isOwner = user?.role.id === "owner" && user.role.is_staff;

  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    loadAdminSettings()
      .then((result) => {
        if (!active) return;
        const next = toDraft(result);
        setSettings(result);
        setBaseline(next);
        setDraft(next);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const dirty = useMemo(() => {
    if (!draft || !baseline) return false;
    return (Object.keys(draft) as (keyof Draft)[]).some((key) => draft[key] !== baseline[key]);
  }, [draft, baseline]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validate(current: Draft): Partial<Record<keyof Draft, string>> {
    const next: Partial<Record<keyof Draft, string>> = {};
    if (current.nameBn.trim().length < 2) next.nameBn = t("admin.settings.errorName");
    if (current.nameEn.trim().length < 2) next.nameEn = t("admin.settings.errorName");
    const phone = current.phone.trim();
    if (phone.length < 6 || !/^\+?[0-9][0-9\s()-]*$/.test(phone)) {
      next.phone = t("admin.settings.errorPhone");
    }
    if (current.email.trim() && !EMAIL_PATTERN.test(current.email.trim())) {
      next.email = t("admin.settings.errorEmail");
    }
    const paymentNumber = current.paymentNumber.trim();
    if (paymentNumber && (paymentNumber.length < 6 || !/^\+?[0-9][0-9\s()-]*$/.test(paymentNumber))) {
      next.paymentNumber = t("admin.settings.errorPhone");
    }
    const moneyKeys: MoneyKey[] = ["dhakaCharge", "outsideCharge", "freeThreshold", "codLimit"];
    for (const key of moneyKeys) {
      if (toPaisa(current[key]) === null) next[key] = t("admin.settings.errorAmount");
    }
    return next;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    setFormError(null);
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const money = (value: string) => toPaisa(value) ?? 0;
    const input: AdminSettingsInput = {
      store: {
        nameBn: draft.nameBn.trim(),
        nameEn: draft.nameEn.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        addressBn: draft.addressBn.trim(),
        addressEn: draft.addressEn.trim(),
        tradeLicense: draft.tradeLicense.trim(),
        tin: draft.tin.trim(),
        paymentNumber: draft.paymentNumber.trim(),
      },
      delivery: {
        dhakaChargePaisa: money(draft.dhakaCharge),
        outsideChargePaisa: money(draft.outsideCharge),
        freeThresholdPaisa: money(draft.freeThreshold),
        codLimitPaisa: money(draft.codLimit),
        codEnabled: draft.codEnabled,
      },
    };
    if (isOwner) {
      input.payments = {
        bkashEnabled: draft.bkashEnabled,
        nagadEnabled: draft.nagadEnabled,
        sslcommerzEnabled: draft.sslcommerzEnabled,
      };
    }

    setSaving(true);
    try {
      const saved = await saveAdminSettings(input);
      const next = toDraft(saved);
      setSettings(saved);
      setBaseline(next);
      setDraft(next);
      toast.success(t("admin.settings.saved"));
    } catch (cause) {
      setFormError(t(adminErrorKey(cause)));
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <PageLoading label={t("admin.settings.loading")} />;

  if (state === "error" || !settings || !draft) {
    return (
      <AdminShell
        eyebrow={t("admin.settings.eyebrow")}
        title={t("admin.settings.title")}
        body={t("admin.settings.body")}
      >
        <FormAlert message={t("admin.settings.loadError")} />
      </AdminShell>
    );
  }

  const courierStatus = settings.environment.courier;

  return (
    <AdminShell
      eyebrow={t("admin.settings.eyebrow")}
      title={t("admin.settings.title")}
      body={t("admin.settings.body")}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Store aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("admin.settings.store")}
            </h2>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="settings-nameBn" label={t("admin.settings.nameBn")} error={errors.nameBn}>
                  <input
                    id="settings-nameBn"
                    value={draft.nameBn}
                    maxLength={80}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("nameBn", event.target.value)}
                    aria-invalid={errors.nameBn ? true : undefined}
                    className={fieldClass}
                  />
                </Field>
                <Field id="settings-nameEn" label={t("admin.settings.nameEn")} error={errors.nameEn}>
                  <input
                    id="settings-nameEn"
                    value={draft.nameEn}
                    maxLength={80}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("nameEn", event.target.value)}
                    aria-invalid={errors.nameEn ? true : undefined}
                    className={fieldClass}
                  />
                </Field>
                <Field id="settings-phone" label={t("admin.settings.phone")} error={errors.phone}>
                  <input
                    id="settings-phone"
                    type="tel"
                    value={draft.phone}
                    maxLength={24}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("phone", event.target.value)}
                    aria-invalid={errors.phone ? true : undefined}
                    className={fieldClass}
                  />
                </Field>
                <Field id="settings-email" label={t("admin.settings.email")} error={errors.email}>
                  <input
                    id="settings-email"
                    type="email"
                    value={draft.email}
                    maxLength={254}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("email", event.target.value)}
                    aria-invalid={errors.email ? true : undefined}
                    className={fieldClass}
                  />
                </Field>
                <Field
                  id="settings-paymentNumber"
                  label={t("admin.settings.paymentNumber")}
                  error={errors.paymentNumber}
                >
                  <input
                    id="settings-paymentNumber"
                    type="tel"
                    value={draft.paymentNumber}
                    maxLength={24}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("paymentNumber", event.target.value)}
                    aria-invalid={errors.paymentNumber ? true : undefined}
                    className={fieldClass}
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="settings-addressBn" label={t("admin.settings.addressBn")}>
                  <input
                    id="settings-addressBn"
                    value={draft.addressBn}
                    maxLength={200}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("addressBn", event.target.value)}
                    className={fieldClass}
                  />
                </Field>
                <Field id="settings-addressEn" label={t("admin.settings.addressEn")}>
                  <input
                    id="settings-addressEn"
                    value={draft.addressEn}
                    maxLength={200}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("addressEn", event.target.value)}
                    className={fieldClass}
                  />
                </Field>
                <Field id="settings-tradeLicense" label={t("admin.settings.tradeLicense")}>
                  <input
                    id="settings-tradeLicense"
                    value={draft.tradeLicense}
                    maxLength={60}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("tradeLicense", event.target.value)}
                    className={fieldClass}
                  />
                </Field>
                <Field id="settings-tin" label={t("admin.settings.tin")}>
                  <input
                    id="settings-tin"
                    value={draft.tin}
                    maxLength={30}
                    disabled={!canWrite || saving}
                    onChange={(event) => set("tin", event.target.value)}
                    className={fieldClass}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Truck aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("admin.settings.delivery")}
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field id="settings-dhakaCharge" label={t("admin.settings.dhakaCharge")} error={errors.dhakaCharge}>
                <input
                  id="settings-dhakaCharge"
                  inputMode="decimal"
                  value={draft.dhakaCharge}
                  disabled={!canWrite || saving}
                  onChange={(event) => set("dhakaCharge", event.target.value)}
                  aria-invalid={errors.dhakaCharge ? true : undefined}
                  className={fieldClass}
                />
              </Field>
              <Field id="settings-outsideCharge" label={t("admin.settings.outsideCharge")} error={errors.outsideCharge}>
                <input
                  id="settings-outsideCharge"
                  inputMode="decimal"
                  value={draft.outsideCharge}
                  disabled={!canWrite || saving}
                  onChange={(event) => set("outsideCharge", event.target.value)}
                  aria-invalid={errors.outsideCharge ? true : undefined}
                  className={fieldClass}
                />
              </Field>
              <Field id="settings-freeThreshold" label={t("admin.settings.freeThreshold")} error={errors.freeThreshold}>
                <input
                  id="settings-freeThreshold"
                  inputMode="decimal"
                  value={draft.freeThreshold}
                  disabled={!canWrite || saving}
                  onChange={(event) => set("freeThreshold", event.target.value)}
                  aria-invalid={errors.freeThreshold ? true : undefined}
                  className={fieldClass}
                />
              </Field>
              <Field id="settings-codLimit" label={t("admin.settings.codLimit")} error={errors.codLimit}>
                <input
                  id="settings-codLimit"
                  inputMode="decimal"
                  value={draft.codLimit}
                  disabled={!canWrite || saving}
                  onChange={(event) => set("codLimit", event.target.value)}
                  aria-invalid={errors.codLimit ? true : undefined}
                  className={fieldClass}
                />
              </Field>
            </div>
            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.codEnabled}
                disabled={!canWrite || saving}
                onChange={(event) => set("codEnabled", event.target.checked)}
                className="size-4 accent-[var(--site-accent)]"
              />
              {t("admin.settings.codEnabled")}
            </label>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {t("admin.settings.deliveryHint")}
            </p>
          </section>
        </div>

        <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Wallet aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("admin.settings.payments")}
            </h2>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-[0.65rem] font-semibold",
                settings.environment.mode === "live"
                  ? "bg-[color-mix(in_srgb,var(--brand-teal)_16%,transparent)] text-[var(--brand-teal)]"
                  : "bg-[color-mix(in_srgb,var(--brand-gold)_16%,transparent)] text-[var(--brand-gold)]",
              )}
            >
              {t("admin.settings.mode")}:{" "}
              {settings.environment.mode === "live" ? t("admin.settings.live") : t("admin.settings.sandbox")}
            </span>
          </div>

          <div className="mt-4 space-y-2.5">
            {PROVIDER_ORDER.map((id) => {
              const provider = settings.environment.providers[id];
              const field = PROVIDER_FIELD[id];
              return (
                <label
                  key={id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition",
                    draft[field]
                      ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_8%,transparent)]"
                      : "border-[var(--site-border)]",
                    isOwner && canWrite ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {t(PROVIDER_LABEL[id])}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {provider.configured
                        ? t("admin.settings.gatewayConfigured")
                        : t("admin.settings.gatewayMissing")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[0.62rem] font-semibold",
                        provider.available
                          ? "bg-[color-mix(in_srgb,var(--brand-teal)_14%,transparent)] text-[var(--brand-teal)]"
                          : "bg-[var(--surface-sunken)] text-muted-foreground",
                      )}
                    >
                      {provider.available ? t("admin.settings.available") : t("admin.settings.unavailable")}
                    </span>
                    <input
                      type="checkbox"
                      checked={draft[field]}
                      disabled={!isOwner || !canWrite || saving}
                      onChange={(event) => set(field, event.target.checked)}
                      className="size-4 accent-[var(--site-accent)]"
                    />
                  </span>
                </label>
              );
            })}
          </div>

          <p className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--surface-sunken)] px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <KeyRound aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-ink)]" />
            {isOwner ? t("admin.settings.gatewayNote") : t("admin.settings.ownerOnly")}
          </p>

          <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              {t("admin.settings.webhookReady")}:{" "}
              <span className="font-semibold text-foreground">
                {settings.environment.webhookReady ? t("admin.settings.yes") : t("admin.settings.no")}
              </span>
            </p>
            <p>
              {t("admin.settings.smsProvider")}:{" "}
              <span className="font-semibold text-foreground">
                {courierStatus.sms ? t("admin.settings.configured") : t("admin.settings.logOnly")}
              </span>
            </p>
            <p className="sm:col-span-2">
              {t("admin.settings.couriers")}:{" "}
              {(["pathao", "redx", "steadfast"] as const)
                .map((id) => `${id} ${courierStatus[id] ? "✓" : "—"}`)
                .join(" · ")}
            </p>
          </div>
        </section>

        {formError ? <FormAlert message={formError} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {canWrite ? t("admin.settings.saveHint") : t("admin.settings.readOnly")}
          </p>
          <button
            type="submit"
            disabled={!canWrite || saving || !dirty}
            className={cn(primaryButtonClass, "w-auto px-5")}
          >
            {saving ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            {saving ? t("admin.settings.saving") : t("admin.settings.save")}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
