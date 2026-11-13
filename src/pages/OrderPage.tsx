import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  HelpCircle,
  Loader2,
  MapPin,
  Package,
  ShoppingBag,
  Truck,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageLoading } from "../components/auth/AuthShell";
import { Eyebrow } from "../components/common/SectionHeading";
import { ApiError } from "../lib/api";
import {
  ORDER_STATUSES,
  displayPhone,
  districtFromOrder,
  fetchOrder,
  orderStatusKey,
  paymentStatusKey,
  readOrderToken,
  rememberOrderToken,
  startPaymentSession,
  useCheckoutConfig,
  type Order,
  type PaymentMethodId,
} from "../lib/checkout";
import { formatDateTime, formatNumber, formatTaka, useI18n, type DictKey } from "../lib/i18n";
import { deliveryWindow, formatDeliveryDate, isDhaka } from "../lib/locations";
import { Link, useRouter } from "../lib/router";
import { cn } from "@/lib/utils";

type PageState = "loading" | "ready" | "not_found" | "error";

const METHOD_LABELS: Record<PaymentMethodId, DictKey> = {
  cod: "checkout.cod",
  bkash: "checkout.bkash",
  nagad: "checkout.nagad",
  sslcommerz: "checkout.card",
};

const COURIER_LABELS: Record<string, DictKey> = {
  manual: "order.courier.manual",
  pathao: "order.courier.pathao",
  redx: "order.courier.redx",
  steadfast: "order.courier.steadfast",
};

export function OrderPage({ orderNumber }: { orderNumber: string }) {
  const { t, lang } = useI18n();
  const { search, navigate } = useRouter();
  const { config } = useCheckoutConfig();
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [nonce, setNonce] = useState(0);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const token = useMemo(() => new URLSearchParams(search).get("token"), [search]);

  useEffect(() => {
    let active = true;
    setState("loading");
    if (token) rememberOrderToken(orderNumber, token);
    fetchOrder(orderNumber, token ?? readOrderToken(orderNumber))
      .then((result) => {
        if (!active) return;
        setOrder(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof ApiError && (error.status === 404 || error.status === 403)
            ? "not_found"
            : "error",
        );
      });
    return () => {
      active = false;
    };
  }, [orderNumber, token, nonce]);

  async function copyNumber() {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.orderNumber);
      toast.success(t("order.copied"));
    } catch {
      toast.error(t("order.copyError"));
    }
  }

  async function payNow() {
    if (!order || order.paymentMethod === "cod" || payBusy) return;
    const lookup = token ?? readOrderToken(orderNumber);
    if (!lookup) {
      setPayError(t("order.payTokenMissing"));
      return;
    }
    setPayBusy(true);
    setPayError(null);
    try {
      const session = await startPaymentSession(order.orderNumber, lookup, order.paymentMethod);
      const target = new URL(session.redirectUrl, window.location.origin);
      if (target.origin === window.location.origin) {
        navigate(`${target.pathname}${target.search}`, { replace: true });
        return;
      }
      window.location.assign(target.toString());
    } catch (error) {
      if (error instanceof ApiError) {
        switch (error.code) {
          case "payment_already_paid":
            setPayError(t("order.paymentPaid"));
            setNonce((current) => current + 1);
            break;
          case "order_closed":
            setPayError(t("order.payClosed"));
            break;
          case "payment_method_unavailable":
            setPayError(t("checkout.errorPayment"));
            break;
          case "rate_limited":
            setPayError(t("checkout.errorRate"));
            break;
          default:
            setPayError(t("order.payError"));
        }
      } else {
        setPayError(t("order.payError"));
      }
      setPayBusy(false);
    }
  }

  if (state === "loading") return <PageLoading label={t("order.loading")} />;

  if (state === "not_found" || !order) {
    return (
      <section className="container-page pt-6 pb-20 sm:pt-10">
        <div className="mx-auto max-w-xl">
          <Eyebrow>{t("order.eyebrow")}</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("order.notFound")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {state === "error" ? t("checkout.errorNetwork") : t("order.notFoundBody")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {state === "error" ? (
              <button
                type="button"
                onClick={() => setNonce((current) => current + 1)}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
              >
                {t("common.retry")}
              </button>
            ) : (
              <Link
                to={`/track?order=${encodeURIComponent(orderNumber)}`}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
              >
                {t("order.track")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            )}
            <Link
              to="/shop"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--site-border)] px-5 text-sm font-semibold text-foreground transition hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
            >
              {t("order.continue")}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const district = districtFromOrder(order);
  const dhaka = isDhaka(district);
  const placedAt = new Date(order.createdAt);
  const [from, to] = deliveryWindow(dhaka, Number.isNaN(placedAt.getTime()) ? new Date() : placedAt);
  const terminal =
    order.status === "cancelled" || order.status === "returned";
  const currentIndex = ORDER_STATUSES.indexOf(order.status);
  const storePhone = config?.store.phone ?? "";

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <div className="glass relative overflow-hidden rounded-[var(--radius-card)] p-6 sm:p-9">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-24 h-64 bg-[radial-gradient(50%_100%_at_40%_0%,color-mix(in_srgb,var(--brand-teal)_16%,transparent),transparent_70%)]"
        />
        <div className="relative">
          <span className="grid size-14 place-items-center rounded-full bg-[color-mix(in_srgb,var(--brand-teal)_16%,transparent)] text-[var(--brand-teal)]">
            <CheckCircle2 aria-hidden="true" className="size-7" />
          </span>
          <Eyebrow className="mt-4">{t("order.eyebrow")}</Eyebrow>
          <h1 className="mt-2 text-3xl font-bold leading-tight sm:text-4xl">{t("order.title")}</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("order.body", { phone: displayPhone(order.customer.phone) })}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-[var(--site-border)] bg-[var(--surface-sunken)] py-1.5 pl-4 pr-1.5">
              <span className="text-xs text-muted-foreground">{t("order.number")}</span>
              <span className="font-heading text-sm font-bold tracking-wider text-foreground">
                {order.orderNumber}
              </span>
              <button
                type="button"
                onClick={() => void copyNumber()}
                aria-label={t("order.copy")}
                className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground"
              >
                <ClipboardCopy aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                terminal
                  ? "bg-[color-mix(in_srgb,var(--brand-rose)_14%,transparent)] text-[var(--brand-rose)]"
                  : "bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-[var(--accent-ink)]",
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {t(orderStatusKey(order.status))}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-sunken)] px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <Clock aria-hidden="true" className="size-3.5" />
              {formatDateTime(order.createdAt, lang)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <div className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Package aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("order.itemsTitle")}
            </h2>
            <ul className="mt-4 divide-y divide-[var(--site-border)]">
              {order.items.map((item) => (
                <li key={`${item.productId}-${item.variantId ?? "base"}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                  <img
                    src={item.image}
                    alt={item.name[lang]}
                    width={450}
                    height={450}
                    loading="lazy"
                    decoding="async"
                    className="size-16 shrink-0 rounded-lg border border-[var(--site-border)] object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-foreground">
                      {item.name[lang]}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.variantLabel ? `${item.variantLabel[lang]} · ` : ""}
                      {t("cart.quantity")} {formatNumber(item.qty, lang)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.sku}</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {formatTaka(item.lineTotalPaisa / 100, lang)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-5 space-y-2.5 border-t border-[var(--site-border)] pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
                <dd className="font-medium text-foreground">
                  {formatTaka(order.totals.subtotalPaisa / 100, lang)}
                </dd>
              </div>
              {order.totals.discountPaisa > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {t("checkout.discount")}
                    {order.couponCode ? ` · ${order.couponCode}` : ""}
                  </dt>
                  <dd className="font-medium text-[var(--brand-teal)]">
                    −{formatTaka(order.totals.discountPaisa / 100, lang)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("checkout.shipping")}</dt>
                <dd className="font-medium text-foreground">
                  {order.totals.shippingPaisa === 0
                    ? t("checkout.free")
                    : formatTaka(order.totals.shippingPaisa / 100, lang)}
                </dd>
              </div>
              <div className="flex items-end justify-between gap-3 border-t border-[var(--site-border)] pt-3">
                <dt className="font-medium text-muted-foreground">{t("checkout.total")}</dt>
                <dd className="font-heading text-xl font-bold text-foreground">
                  {formatTaka(order.totals.totalPaisa / 100, lang)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-foreground">
              <Truck aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("order.statusTimeline")}
            </h2>
            {terminal ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t(orderStatusKey(order.status))}
                {order.statusHistory.length > 0
                  ? ` · ${formatDateTime(order.statusHistory[order.statusHistory.length - 1].at, lang)}`
                  : ""}
              </p>
            ) : (
              <ol className="mt-4 space-y-0">
                {ORDER_STATUSES.map((status, index) => {
                  const reached = index <= currentIndex;
                  const last = index === ORDER_STATUSES.length - 1;
                  const at = order.statusHistory.find((entry) => entry.status === status)?.at;
                  return (
                    <li key={status} className="relative flex gap-3 pb-5 last:pb-0">
                      {!last ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute left-[0.6875rem] top-6 h-[calc(100%-1.5rem)] w-px",
                            index < currentIndex
                              ? "bg-[var(--site-accent)]"
                              : "bg-[var(--site-border)]",
                          )}
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative grid size-6 shrink-0 place-items-center rounded-full border",
                          reached
                            ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                            : "border-[var(--site-border)] bg-[var(--surface-raised)] text-muted-foreground",
                        )}
                      >
                        {reached ? (
                          <Check aria-hidden="true" className="size-3.5" />
                        ) : (
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                        )}
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            reached ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {t(orderStatusKey(status))}
                        </p>
                        {at ? (
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(at, lang)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-[var(--radius-card)] p-5">
            <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
              <MapPin aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("order.shippingAddress")}
            </h2>
            <p className="mt-3 text-sm font-medium text-foreground">{order.customer.name}</p>
            <p className="text-sm text-muted-foreground">{displayPhone(order.customer.phone)}</p>
            {order.customer.email ? (
              <p className="text-sm text-muted-foreground">{order.customer.email}</p>
            ) : null}
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {order.customer.address}
              {order.customer.area ? `, ${order.customer.area}` : ""}
              <br />
              {order.customer.district.name[lang]}, {order.customer.district.division[lang]}
            </p>
            {order.customer.note ? (
              <p className="mt-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-muted-foreground">
                {order.customer.note}
              </p>
            ) : null}
          </div>

          <div className="glass rounded-[var(--radius-card)] p-5">
            <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
              <Clock aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("order.estimated")}
            </h2>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {t("order.estimateRange", {
                from: formatDeliveryDate(from, lang),
                to: formatDeliveryDate(to, lang),
              })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {dhaka ? t("checkout.deliveryDhaka") : t("checkout.deliveryOutside")}
            </p>
          </div>

          <div className="glass rounded-[var(--radius-card)] p-5">
            <h2 className="font-heading text-base font-semibold text-foreground">
              {t("checkout.payment")}
            </h2>
            <p className="mt-2 text-sm font-medium text-foreground">
              {t(METHOD_LABELS[order.paymentMethod])}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(paymentStatusKey(order.paymentStatus))}
            </p>
            {order.paymentMethod === "cod" ? (
              <p className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--brand-gold)_14%,transparent)] px-3.5 py-2.5 text-sm font-semibold text-foreground">
                {t("order.payOnDelivery", {
                  amount: formatTaka(order.totals.totalPaisa / 100, lang),
                })}
              </p>
            ) : order.paymentStatus === "paid" ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-[color-mix(in_srgb,var(--brand-teal)_12%,transparent)] px-3.5 py-2.5 text-sm font-semibold text-foreground">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--brand-teal)]" />
                {t("order.paymentPaid")}
              </p>
            ) : !terminal ? (
              <>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {t("order.payOnlineNote", {
                    provider: t(METHOD_LABELS[order.paymentMethod]),
                  })}
                </p>
                {order.paymentStatus === "failed" ? (
                  <p role="alert" className="mt-2 text-xs font-medium text-[var(--danger-ink)]">
                    {t("order.paymentFailed")}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void payNow()}
                  disabled={payBusy}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {payBusy ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Wallet aria-hidden="true" className="size-4" />
                  )}
                  {payBusy ? t("order.payStarting") : t("order.payNow")}
                </button>
                {payError ? (
                  <p role="alert" className="mt-2 text-xs text-[var(--danger-ink)]">
                    {payError}
                  </p>
                ) : null}
              </>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {t("order.nextStep")}
            </p>
          </div>

          {order.fulfilment.courier || order.fulfilment.trackingNumber ? (
            <div className="glass rounded-[var(--radius-card)] p-5">
              <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
                <Truck aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
                {t("order.trackingTitle")}
              </h2>
              {order.fulfilment.courier ? (
                <p className="mt-2 text-sm text-foreground">
                  {t("order.courier")}:{" "}
                  <span className="font-semibold">
                    {COURIER_LABELS[order.fulfilment.courier]
                      ? t(COURIER_LABELS[order.fulfilment.courier])
                      : order.fulfilment.courier}
                  </span>
                </p>
              ) : null}
              {order.fulfilment.trackingNumber ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("order.trackingNumber")}:{" "}
                  <span className="font-mono text-xs font-semibold text-foreground" dir="ltr">
                    {order.fulfilment.trackingNumber}
                  </span>
                </p>
              ) : null}
              {order.fulfilment.shippedAt ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("order.shippedAt")}: {formatDateTime(order.fulfilment.shippedAt, lang)}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="glass rounded-[var(--radius-card)] p-5">
            <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
              <HelpCircle aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
              {t("order.help")}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("order.helpBody")}
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

          <Link
            to={`/track?order=${encodeURIComponent(order.orderNumber)}`}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
          >
            {t("order.track")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
          <Link
            to="/shop"
            className="flex w-full items-center justify-center gap-2 rounded-full border border-[var(--site-border)] px-5 py-3 text-sm font-semibold text-foreground transition hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
          >
            <ShoppingBag aria-hidden="true" className="size-4" />
            {t("order.continue")}
          </Link>
        </div>
      </div>
    </section>
  );
}
