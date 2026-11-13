import {
  ArrowLeft,
  Check,
  Landmark,
  Loader2,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Tag,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Field,
  FormAlert,
  PageLoading,
  fieldClass,
} from "../components/auth/AuthShell";
import { Eyebrow } from "../components/common/SectionHeading";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { productAlt } from "../lib/catalog";
import {
  createOrder,
  displayPhone,
  isValidPhone,
  quoteCoupon,
  readCheckoutProfile,
  rememberCheckoutProfile,
  rememberOrderToken,
  shippingPaisa,
  useCheckoutConfig,
  type CouponQuote,
  type PaymentMethodId,
} from "../lib/checkout";
import {
  formatDeliveryDate,
  deliveryWindow,
  isDhaka,
  readStoredDistrict,
  rememberDistrict,
  useDistricts,
} from "../lib/locations";
import { formatTaka, useI18n } from "../lib/i18n";
import { Link, useRouter } from "../lib/router";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  phone: string;
  email: string;
  districtId: string;
  area: string;
  address: string;
  note: string;
  marketing: boolean;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* randomUUID needs a secure context */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function CheckoutPage() {
  const { t, lang } = useI18n();
  const { items, count, subtotal, clearCart } = useCart();
  const { navigate } = useRouter();
  const { status: configStatus, config } = useCheckoutConfig();
  const { districts, status: districtStatus } = useDistricts();
  const { status: authStatus, user } = useAuth();

  const [form, setForm] = useState<FormState>(() => {
    const profile = readCheckoutProfile();
    const stored = readStoredDistrict();
    return {
      name: profile?.name ?? "",
      phone: profile?.phone ?? "",
      email: profile?.email ?? "",
      districtId: profile?.districtId || stored || "",
      area: profile?.area ?? "",
      address: profile?.address ?? "",
      note: "",
      marketing: true,
    };
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethodId>("cod");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponQuote | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return;
    setForm((current) => ({
      ...current,
      name: current.name || user.name,
      phone: current.phone || (user.phone ? displayPhone(user.phone) : ""),
      email: current.email || (user.email ?? ""),
    }));
  }, [authStatus, user]);

  const subtotalPaisa = Math.round(subtotal * 100);
  const district = districts.find((entry) => entry.id === form.districtId);
  const discountPaisa = coupon?.discountPaisa ?? 0;
  const shipping =
    config && district
      ? shippingPaisa(config, district, subtotalPaisa, coupon?.freeShipping ?? false)
      : null;
  const totalPaisa = Math.max(0, subtotalPaisa - discountPaisa) + (shipping ?? 0);
  const codLimitPaisa = config?.delivery.codLimitPaisa ?? null;
  const codBlocked = codLimitPaisa !== null && totalPaisa > codLimitPaisa;
  const codAvailable = config ? config.delivery.codEnabled : true;

  const divisionGroups = useMemo(() => {
    const groups = new Map<string, { label: string; districts: typeof districts }>();
    for (const entry of districts) {
      const key = entry.division.en;
      const group = groups.get(key);
      if (group) group.districts.push(entry);
      else groups.set(key, { label: entry.division[lang], districts: [entry] });
    }
    return [...groups.values()];
  }, [districts, lang]);

  const deliveryEstimate = district
    ? deliveryWindow(isDhaka(district))
    : null;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!isValidPhone(form.phone)) next.phone = t("checkout.errorPhone");
    if (form.name.trim().length < 2) next.name = t("checkout.errorName");
    if (!form.districtId) next.districtId = t("checkout.errorDistrict");
    if (form.address.trim().length < 5) next.address = t("checkout.errorAddress");
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
      next.email = t("checkout.errorEmail");
    }
    return next;
  }

  function checkoutErrorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return t("checkout.errorGeneric");
    switch (error.code) {
      case "stock_unavailable":
        return t("checkout.errorStock");
      case "coupon_invalid": {
        const min = error.details.minSubtotalPaisa;
        return typeof min === "number"
          ? t("checkout.couponMin", { amount: formatTaka(min / 100, lang) })
          : t("checkout.errorCoupon");
      }
      case "cod_limit_exceeded":
        return t("checkout.errorCod");
      case "payment_method_unavailable":
        return t("checkout.errorPayment");
      case "rate_limited":
        return t("checkout.errorRate");
      case "network":
        return t("checkout.errorNetwork");
      default:
        return t("checkout.errorGeneric");
    }
  }

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code || couponBusy) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const quote = await quoteCoupon(code, subtotalPaisa);
      setCoupon(quote);
      setCouponInput(quote.code);
    } catch (error) {
      setCoupon(null);
      if (error instanceof ApiError && error.code === "coupon_invalid") {
        const min = error.details.minSubtotalPaisa;
        setCouponError(
          typeof min === "number"
            ? t("checkout.couponMin", { amount: formatTaka(min / 100, lang) })
            : t("checkout.couponInvalid"),
        );
      } else if (error instanceof ApiError && error.code === "rate_limited") {
        setCouponError(t("checkout.errorRate"));
      } else {
        setCouponError(t("checkout.errorCoupon"));
      }
    } finally {
      setCouponBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const first = Object.keys(nextErrors)[0];
      document.getElementById(`checkout-${first}`)?.focus();
      return;
    }
    if (codBlocked) {
      setFormError(t("checkout.errorCod"));
      return;
    }

    setBusy(true);
    try {
      const result = await createOrder({
        items: items.map((item) => ({
          productId: item.product.id,
          variantId: item.variant?.id,
          qty: item.qty,
        })),
        customer: {
          name: form.name.trim(),
          phone: form.phone.replace(/[\s()-]/g, ""),
          email: form.email.trim() || undefined,
          districtId: form.districtId,
          area: form.area.trim() || undefined,
          address: form.address.trim(),
          note: form.note.trim() || undefined,
          marketingConsent: form.marketing,
        },
        couponCode: coupon?.code,
        paymentMethod: payment,
        idempotencyKey,
      });

      rememberCheckoutProfile({
        name: form.name.trim(),
        phone: displayPhone(form.phone),
        email: form.email.trim(),
        districtId: form.districtId,
        area: form.area.trim(),
        address: form.address.trim(),
      });
      rememberDistrict(form.districtId);
      rememberOrderToken(result.order.orderNumber, result.lookupToken);
      clearCart();
      navigate(
        `/order/${result.order.orderNumber}?token=${encodeURIComponent(result.lookupToken)}`,
        { replace: true },
      );
    } catch (error) {
      setFormError(checkoutErrorMessage(error));
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="container-page pt-6 pb-20 sm:pt-10">
        <div className="max-w-2xl">
          <Eyebrow>{t("checkout.eyebrow")}</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("checkout.title")}</h1>
        </div>
        <div className="glass mt-8 flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-16 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-[var(--surface-sunken)] text-muted-foreground">
            <ShoppingBag aria-hidden="true" className="size-7" />
          </span>
          <p className="font-heading text-lg font-semibold text-foreground">
            {t("checkout.emptyTitle")}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("checkout.emptyBody")}</p>
          <Link
            to="/shop"
            className="mt-1 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
          >
            {t("checkout.emptyCta")}
          </Link>
        </div>
      </section>
    );
  }

  if (configStatus === "loading") return <PageLoading label={t("common.loading")} />;

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <Link
        to="/cart"
        className="inline-flex items-center gap-2 rounded-full text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("cart.title")}
      </Link>

      <div className="mt-5 max-w-2xl">
        <Eyebrow>{t("checkout.eyebrow")}</Eyebrow>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("checkout.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("checkout.body")}
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        data-testid="checkout-form"
        className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-8"
      >
        <div className="space-y-5">
          <fieldset className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <legend className="sr-only">{t("checkout.contact")}</legend>
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Smartphone aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("checkout.contact")}
            </h2>
            <div className="mt-4 space-y-4">
              <Field
                id="checkout-phone"
                label={t("checkout.phone")}
                hint={t("checkout.phoneHint")}
                error={errors.phone}
              >
                <input
                  id="checkout-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => setField("phone", event.target.value)}
                  disabled={busy}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={
                    errors.phone ? "checkout-phone-error" : "checkout-phone-hint"
                  }
                  className={fieldClass}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="checkout-name" label={t("checkout.name")} error={errors.name}>
                  <input
                    id="checkout-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    value={form.name}
                    onChange={(event) => setField("name", event.target.value)}
                    disabled={busy}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "checkout-name-error" : undefined}
                    className={fieldClass}
                  />
                </Field>
                <Field
                  id="checkout-email"
                  label={t("checkout.email")}
                  hint={t("checkout.emailHint")}
                  error={errors.email}
                >
                  <input
                    id="checkout-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={120}
                    value={form.email}
                    onChange={(event) => setField("email", event.target.value)}
                    disabled={busy}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={
                      errors.email ? "checkout-email-error" : "checkout-email-hint"
                    }
                    className={fieldClass}
                  />
                </Field>
              </div>
            </div>
          </fieldset>

          <fieldset className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <legend className="sr-only">{t("checkout.delivery")}</legend>
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Truck aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("checkout.delivery")}
            </h2>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="checkout-districtId"
                  label={t("checkout.district")}
                  error={errors.districtId}
                >
                  <select
                    id="checkout-districtId"
                    name="district"
                    value={form.districtId}
                    onChange={(event) => setField("districtId", event.target.value)}
                    disabled={busy || districtStatus === "loading"}
                    aria-invalid={errors.districtId ? true : undefined}
                    aria-describedby={errors.districtId ? "checkout-districtId-error" : undefined}
                    className={cn(fieldClass, "appearance-none pr-9")}
                  >
                    <option value="">{t("checkout.districtPlaceholder")}</option>
                    {divisionGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.districts.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name[lang]}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </Field>
                <Field
                  id="checkout-area"
                  label={t("checkout.area")}
                  hint={t("checkout.areaOptional")}
                >
                  <input
                    id="checkout-area"
                    name="area"
                    type="text"
                    autoComplete="address-level2"
                    maxLength={80}
                    value={form.area}
                    onChange={(event) => setField("area", event.target.value)}
                    disabled={busy}
                    className={fieldClass}
                  />
                </Field>
              </div>
              <Field
                id="checkout-address"
                label={t("checkout.address")}
                error={errors.address}
              >
                <textarea
                  id="checkout-address"
                  name="address"
                  rows={3}
                  autoComplete="street-address"
                  maxLength={300}
                  placeholder={t("checkout.addressPlaceholder")}
                  value={form.address}
                  onChange={(event) => setField("address", event.target.value)}
                  disabled={busy}
                  aria-invalid={errors.address ? true : undefined}
                  aria-describedby={errors.address ? "checkout-address-error" : undefined}
                  className={cn(fieldClass, "h-auto py-2.5")}
                />
              </Field>
              <Field id="checkout-note" label={t("checkout.note")}>
                <textarea
                  id="checkout-note"
                  name="note"
                  rows={2}
                  maxLength={300}
                  placeholder={t("checkout.notePlaceholder")}
                  value={form.note}
                  onChange={(event) => setField("note", event.target.value)}
                  disabled={busy}
                  className={cn(fieldClass, "h-auto py-2.5")}
                />
              </Field>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.marketing}
                  onChange={(event) => setField("marketing", event.target.checked)}
                  disabled={busy}
                  className="mt-0.5 size-4 accent-[var(--site-accent)]"
                />
                <span>{t("checkout.marketing")}</span>
              </label>

              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-3 text-xs text-muted-foreground">
                <Truck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" />
                <span>
                  <span className="font-semibold text-foreground">
                    {t("checkout.deliveryEstimate")}:
                  </span>{" "}
                  {district
                    ? `${t("checkout.deliveryBy", {
                        from: formatDeliveryDate(deliveryEstimate![0], lang),
                        to: formatDeliveryDate(deliveryEstimate![1], lang),
                      })} · ${isDhaka(district) ? t("checkout.deliveryDhaka") : t("checkout.deliveryOutside")}`
                    : t("checkout.needDistrict")}
                </span>
              </div>
            </div>
          </fieldset>

          <fieldset className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <legend className="sr-only">{t("checkout.payment")}</legend>
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Landmark aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("checkout.payment")}
            </h2>
            <div className="mt-4 space-y-2.5">
              {(
                [
                  {
                    id: "cod" as const,
                    label: t("checkout.cod"),
                    body: codLimitPaisa
                      ? `${t("checkout.codBody")} · ${t("checkout.codLimit", {
                          amount: formatTaka(codLimitPaisa / 100, lang),
                        })}`
                      : t("checkout.codBody"),
                    enabled: codAvailable,
                  },
                  {
                    id: "bkash" as const,
                    label: t("checkout.bkash"),
                    body: t("checkout.payOnline", { provider: t("checkout.bkash") }),
                    enabled: config?.payments.bkash ?? false,
                  },
                  {
                    id: "nagad" as const,
                    label: t("checkout.nagad"),
                    body: t("checkout.payOnline", { provider: t("checkout.nagad") }),
                    enabled: config?.payments.nagad ?? false,
                  },
                  {
                    id: "sslcommerz" as const,
                    label: t("checkout.card"),
                    body: t("checkout.payOnline", { provider: t("checkout.card") }),
                    enabled: config?.payments.sslcommerz ?? false,
                  },
                ] as const
              ).map((option) => {
                const selected = payment === option.id;
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition",
                      selected
                        ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_9%,transparent)]"
                        : "border-[var(--site-border)]",
                      option.enabled ? "hover:border-[var(--accent-ink)]" : "cursor-not-allowed opacity-55",
                    )}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={option.id}
                      checked={selected}
                      onChange={() => setPayment(option.id)}
                      disabled={busy || !option.enabled}
                      className="mt-1 size-4 accent-[var(--site-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                        {option.label}
                        {!option.enabled ? (
                          <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                            {t("checkout.gatewayOff")}
                          </span>
                        ) : null}
                      </span>
                      {option.enabled ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {option.body}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {codBlocked ? (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger-ink)_10%,transparent)] px-3.5 py-2.5 text-xs text-[var(--danger-ink)]"
              >
                {t("checkout.codUnavailable", {
                  amount: formatTaka((codLimitPaisa ?? 0) / 100, lang),
                })}
              </p>
            ) : null}
          </fieldset>
        </div>

        <aside className="glass rounded-[var(--radius-card)] p-5 lg:sticky lg:top-28">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            {t("checkout.summary")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("checkout.items", { count: count })}
          </p>

          <ul className="mt-4 max-h-64 space-y-3 overflow-y-auto pr-1 scrollbar-thin" data-lenis-prevent>
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-3">
                <img
                  src={item.product.imageSmall}
                  alt={productAlt(item.product, lang)}
                  width={450}
                  height={450}
                  loading="lazy"
                  decoding="async"
                  className="size-12 shrink-0 rounded-lg border border-[var(--site-border)] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    {item.product.name[lang]}
                  </p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {item.variant ? `${item.variant.label[lang]} · ` : ""}
                    {t("cart.quantity")} {item.qty}
                  </p>
                </div>
                <span className="text-xs font-semibold text-foreground">
                  {formatTaka(item.unitPrice * item.qty, lang)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-[var(--site-border)] pt-4">
            <label htmlFor="checkout-coupon" className="text-xs font-semibold text-foreground">
              {t("checkout.coupon")}
            </label>
            {coupon ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[color-mix(in_srgb,var(--brand-teal)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-teal)_10%,transparent)] px-3 py-2">
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Check aria-hidden="true" className="size-4 text-[var(--brand-teal)]" />
                  {t("checkout.couponApplied", { code: coupon.code })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCoupon(null);
                    setCouponInput("");
                    setCouponError(null);
                  }}
                  aria-label={t("checkout.couponRemove")}
                  className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  id="checkout-coupon"
                  name="coupon"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={24}
                  placeholder={t("checkout.couponPlaceholder")}
                  value={couponInput}
                  onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                  disabled={busy || couponBusy}
                  className={cn(fieldClass, "h-10 flex-1 uppercase")}
                />
                <button
                  type="button"
                  onClick={() => void applyCoupon()}
                  disabled={busy || couponBusy || !couponInput.trim()}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--site-border)] px-3.5 text-xs font-semibold text-foreground transition hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)] disabled:opacity-50"
                >
                  {couponBusy ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <Tag aria-hidden="true" className="size-3.5" />
                  )}
                  {couponBusy ? t("checkout.couponApplying") : t("checkout.couponApply")}
                </button>
              </div>
            )}
            {couponError ? (
              <p role="alert" className="mt-1.5 text-xs text-[var(--danger-ink)]">
                {couponError}
              </p>
            ) : null}
          </div>

          <dl className="mt-4 space-y-2.5 border-t border-[var(--site-border)] pt-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
              <dd className="font-medium text-foreground">{formatTaka(subtotal, lang)}</dd>
            </div>
            {discountPaisa > 0 ? (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("checkout.discount")}</dt>
                <dd className="font-medium text-[var(--brand-teal)]">
                  −{formatTaka(discountPaisa / 100, lang)}
                </dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("checkout.shipping")}</dt>
              <dd className="font-medium text-foreground">
                {shipping === null ? "—" : shipping === 0 ? t("checkout.free") : formatTaka(shipping / 100, lang)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex items-end justify-between gap-3 border-t border-[var(--site-border)] pt-4">
            <span className="text-sm font-medium text-muted-foreground">{t("checkout.total")}</span>
            <span className="font-heading text-xl font-bold text-foreground">
              {formatTaka(totalPaisa / 100, lang)}
            </span>
          </div>

          {formError ? (
            <div className="mt-4">
              <FormAlert message={formError} />
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || codBlocked}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ShieldCheck aria-hidden="true" className="size-4" />
            )}
            {busy ? t("checkout.placing") : t("checkout.placeOrder")}
          </button>
          <p className="mt-2.5 text-center text-xs text-muted-foreground">{t("checkout.guestNote")}</p>
        </aside>
      </form>
    </section>
  );
}
