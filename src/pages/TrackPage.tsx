import { Loader2, Search, Truck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Field, FormAlert, fieldClass } from "../components/auth/AuthShell";
import { Eyebrow } from "../components/common/SectionHeading";
import { ApiError } from "../lib/api";
import {
  isValidPhone,
  rememberOrderToken,
  trackOrder,
  useCheckoutConfig,
} from "../lib/checkout";
import { useI18n } from "../lib/i18n";
import { Link, useRouter } from "../lib/router";

export function TrackPage() {
  const { t } = useI18n();
  const { search, navigate } = useRouter();
  const { config } = useCheckoutConfig();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ orderNumber?: string; phone?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial = new URLSearchParams(search).get("order");
    if (initial) setOrderNumber(initial.toUpperCase());
  }, [search]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const next: { orderNumber?: string; phone?: string } = {};
    if (!/^LP-\d{6}-[0-9A-Z]{6}$/.test(orderNumber.trim().toUpperCase())) {
      next.orderNumber = t("track.notFound");
    }
    if (!isValidPhone(phone)) next.phone = t("checkout.errorPhone");
    setFieldErrors(next);
    if (next.orderNumber || next.phone) return;

    setBusy(true);
    try {
      const result = await trackOrder(
        orderNumber.trim().toUpperCase(),
        phone.replace(/[\s()-]/g, ""),
      );
      rememberOrderToken(result.order.orderNumber, result.lookupToken);
      navigate(`/order/${result.order.orderNumber}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 404) setError(t("track.notFound"));
        else if (caught.code === "rate_limited") setError(t("checkout.errorRate"));
        else if (caught.code === "network") setError(t("checkout.errorNetwork"));
        else setError(t("checkout.errorGeneric"));
      } else {
        setError(t("checkout.errorGeneric"));
      }
      setBusy(false);
    }
  }

  const storePhone = config?.store.phone ?? "";

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <div className="mx-auto max-w-xl">
        <Eyebrow>{t("track.eyebrow")}</Eyebrow>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("track.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("track.body")}
        </p>

        <form
          onSubmit={onSubmit}
          noValidate
          className="glass mt-7 space-y-5 rounded-[var(--radius-card)] p-5 sm:p-7"
        >
          <Field
            id="track-orderNumber"
            label={t("track.orderNumber")}
            error={fieldErrors.orderNumber}
          >
            <input
              id="track-orderNumber"
              name="orderNumber"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("track.orderPlaceholder")}
              value={orderNumber}
              onChange={(event) => {
                setOrderNumber(event.target.value.toUpperCase());
                setFieldErrors((current) => ({ ...current, orderNumber: undefined }));
              }}
              disabled={busy}
              aria-invalid={fieldErrors.orderNumber ? true : undefined}
              aria-describedby={fieldErrors.orderNumber ? "track-orderNumber-error" : undefined}
              className={`${fieldClass} uppercase tracking-wider`}
            />
          </Field>

          <Field id="track-phone" label={t("track.phone")} error={fieldErrors.phone}>
            <input
              id="track-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setFieldErrors((current) => ({ ...current, phone: undefined }));
              }}
              disabled={busy}
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={fieldErrors.phone ? "track-phone-error" : undefined}
              className={fieldClass}
            />
          </Field>

          {error ? <FormAlert message={error} /> : null}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Search aria-hidden="true" className="size-4" />
            )}
            {busy ? t("track.checking") : t("track.submit")}
          </button>
        </form>

        <div className="glass mt-4 flex items-start gap-3 rounded-[var(--radius-card)] p-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--accent-ink)]">
            <Truck aria-hidden="true" className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("track.help")}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("track.helpBody")}
            </p>
            {storePhone ? (
              <a
                href={`tel:${storePhone.replace(/\s/g, "")}`}
                className="mt-2 inline-block text-sm font-semibold text-[var(--accent-ink)] hover:underline"
              >
                {storePhone}
              </a>
            ) : null}
          </div>
        </div>

        <Link
          to="/shop"
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          {t("cart.continue")}
        </Link>
      </div>
    </section>
  );
}
