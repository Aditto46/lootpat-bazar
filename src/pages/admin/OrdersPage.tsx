import {
  ArrowRight,
  Check,
  Clock,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { toast } from "sonner";
import {
  Field,
  FormAlert,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import {
  KANBAN_COLUMNS,
  ORDER_TRANSITIONS,
  adminErrorKey,
  assignCourier,
  loadAdminOrder,
  loadAdminOrders,
  moveOrderStatus,
  setPaymentStatus,
  type AdminOrderDetail,
  type AdminOrderSummary,
  type CourierId,
} from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { ApiError } from "../../lib/api";
import type { OrderStatus, PaymentMethodId, PaymentStatus } from "../../lib/checkout";
import { orderStatusKey, paymentStatusKey } from "../../lib/checkout";
import { formatDateTime, formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import { useRouter } from "../../lib/router";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AdminShell, PaymentPill, StatusPill } from "./AdminShell";

const METHOD_KEYS: Record<PaymentMethodId, DictKey> = {
  cod: "checkout.cod",
  bkash: "checkout.bkash",
  nagad: "checkout.nagad",
  sslcommerz: "checkout.card",
};

const PAYMENT_OPTIONS: PaymentStatus[] = ["unpaid", "pending", "paid", "failed", "refunded"];

const COLUMN_TONES: Partial<Record<OrderStatus, string>> = {
  pending: "bg-[var(--brand-gold)]",
  confirmed: "bg-[var(--brand-teal)]",
  packed: "bg-[var(--site-accent)]",
  shipped: "bg-[var(--site-accent)]",
  delivered: "bg-[var(--site-accent)]",
};

export function OrdersPage() {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const { search: locationSearch, navigate } = useRouter();
  const canWrite = hasPermission("orders.write");
  const canManagePayments = hasPermission("payments.manage");

  const [orders, setOrders] = useState<AdminOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<OrderStatus | null>(null);
  const [detailNumber, setDetailNumber] = useState<string | null>(
    () => new URLSearchParams(locationSearch).get("order"),
  );
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [courier, setCourier] = useState<CourierId>("manual");
  const [tracking, setTracking] = useState("");
  const [courierBusy, setCourierBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await loadAdminOrders();
        setOrders(result.orders);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(t(adminErrorKey(cause)));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!detailNumber) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setNote("");
    loadAdminOrder(detailNumber)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDetail(result);
        const current = result.order.fulfilment.courier;
        setCourier(
          current === "pathao" || current === "redx" || current === "steadfast" || current === "manual"
            ? current
            : "manual",
        );
        setTracking(result.order.fulfilment.trackingNumber ?? "");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setDetailError(t(adminErrorKey(cause)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailNumber, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((order) =>
      [order.orderNumber, order.customerName, order.phone].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [orders, query]);

  const columns = useMemo(
    () =>
      KANBAN_COLUMNS.map((status) => ({
        status,
        orders: filtered.filter((order) => order.status === status),
      })),
    [filtered],
  );

  const closed = useMemo(
    () => filtered.filter((order) => order.status === "returned" || order.status === "cancelled"),
    [filtered],
  );

  async function attemptMove(
    orderNumber: string,
    from: OrderStatus,
    target: OrderStatus,
    moveNote?: string,
  ) {
    if (!canWrite) {
      toast.error(t("admin.notAllowed"));
      return;
    }
    if (!ORDER_TRANSITIONS[from].includes(target)) {
      toast.error(t("admin.orders.invalidTransition"));
      return;
    }
    setBusy(orderNumber);
    try {
      const result = await moveOrderStatus(orderNumber, target, moveNote || undefined);
      toast.success(t("admin.orders.moved"));
      setDetail((current) =>
        current && current.order.orderNumber === orderNumber
          ? {
              order: result.order,
              transitions: ORDER_TRANSITIONS[result.order.status],
              couriers: current.couriers,
            }
          : current,
      );
      await load();
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(null);
    }
  }

  async function changePayment(next: PaymentStatus) {
    if (!detail) return;
    setDetailBusy(true);
    try {
      const result = await setPaymentStatus(detail.order.orderNumber, next);
      toast.success(t("admin.orders.paymentUpdated"));
      setDetail({ order: result.order, transitions: ORDER_TRANSITIONS[result.order.status], couriers: detail.couriers });
      await load();
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setDetailBusy(false);
    }
  }

  async function submitCourier() {
    if (!detail || courierBusy) return;
    const trimmed = tracking.trim();
    if (courier === "manual" && trimmed && !/^[A-Za-z0-9-]{3,60}$/.test(trimmed)) {
      toast.error(t("admin.orders.trackingInvalid"));
      return;
    }
    setCourierBusy(true);
    try {
      const result = await assignCourier(
        detail.order.orderNumber,
        courier,
        courier === "manual" && trimmed ? trimmed : undefined,
      );
      toast.success(t("admin.orders.courierAssigned"));
      setDetail({
        order: result.order,
        transitions: ORDER_TRANSITIONS[result.order.status],
        couriers: detail.couriers,
      });
      setTracking(result.order.fulfilment.trackingNumber ?? "");
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "order_not_ready") {
        toast.error(t("admin.orders.courierNotReady"));
      } else if (cause instanceof ApiError && cause.code === "courier_booking_failed") {
        toast.error(t("admin.orders.courierFailed"));
      } else {
        toast.error(t(adminErrorKey(cause)));
      }
    } finally {
      setCourierBusy(false);
    }
  }

  function closeDetail() {
    setDetailNumber(null);
    if (locationSearch.includes("order=")) {
      navigate("/admin/orders", { replace: true, scroll: false });
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, status: OrderStatus) {
    event.preventDefault();
    const number = event.dataTransfer.getData("text/plain") || dragging;
    setHoverColumn(null);
    setDragging(null);
    const order = orders.find((entry) => entry.orderNumber === number);
    if (order) void attemptMove(order.orderNumber, order.status, status);
  }

  return (
    <AdminShell
      eyebrow={t("admin.orders.eyebrow")}
      title={t("admin.orders.title")}
      body={t("admin.orders.body")}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={secondaryButtonClass}
        >
          <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
          {t("admin.refresh")}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("admin.orders.searchPlaceholder")}
            aria-label={t("admin.search")}
            className={cn(fieldClass, "pl-9 pr-9")}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("admin.clear")}
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("admin.orders.count", { count: formatNumber(filtered.length, lang) })}
        </p>
        {!canWrite ? (
          <p className="rounded-full border border-[var(--site-border)] px-3 py-1 text-[0.65rem] font-semibold text-muted-foreground">
            {t("admin.notAllowed")}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 space-y-3">
          <FormAlert message={error} />
          <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("admin.tryAgain")}
          </button>
        </div>
      ) : null}

      {loading && orders.length === 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-5" aria-busy="true">
          {KANBAN_COLUMNS.map((status) => (
            <div key={status} className="glass h-64 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : null}

      {!loading && !error && orders.length === 0 ? (
        <p className="glass mt-5 rounded-2xl p-5 text-sm text-muted-foreground">
          {t("admin.dashboard.recentEmpty")}
        </p>
      ) : null}

      {orders.length > 0 ? (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-5">
            {columns.map((column) => {
              const isHover = hoverColumn === column.status;
              return (
                <div
                  key={column.status}
                  onDragOver={(event) => {
                    if (!canWrite || !dragging) return;
                    const order = orders.find((entry) => entry.orderNumber === dragging);
                    if (!order || !ORDER_TRANSITIONS[order.status].includes(column.status)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setHoverColumn(column.status);
                  }}
                  onDragLeave={() =>
                    setHoverColumn((current) => (current === column.status ? null : current))
                  }
                  onDrop={(event) => handleDrop(event, column.status)}
                  className={cn(
                    "rounded-2xl border p-3 transition",
                    isHover
                      ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_8%,transparent)]"
                      : "border-transparent bg-[color-mix(in_srgb,var(--surface-sunken)_55%,transparent)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn("size-2 rounded-full", COLUMN_TONES[column.status])}
                      />
                      <h2 className="text-sm font-semibold text-foreground">
                        {t(orderStatusKey(column.status))}
                      </h2>
                    </div>
                    <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] font-semibold tabular-nums text-muted-foreground">
                      {formatNumber(column.orders.length, lang)}
                    </span>
                  </div>

                  <ul className="mt-3 space-y-2.5">
                    {column.orders.length === 0 ? (
                      <li className="rounded-xl border border-dashed border-[var(--site-border)] px-3 py-6 text-center text-[0.7rem] text-muted-foreground">
                        {isHover ? t("admin.orders.dropHint") : t("admin.orders.empty")}
                      </li>
                    ) : null}

                    {column.orders.map((order) => {
                      const next = ORDER_TRANSITIONS[order.status].find(
                        (status) => status !== "cancelled",
                      );
                      return (
                        <li key={order.orderNumber}>
                          <article
                            draggable={canWrite}
                            onDragStart={(event) => {
                              event.dataTransfer.setData("text/plain", order.orderNumber);
                              event.dataTransfer.effectAllowed = "move";
                              setDragging(order.orderNumber);
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setHoverColumn(null);
                            }}
                            className={cn(
                              "group rounded-xl border border-[var(--site-border)] bg-[var(--surface-raised)] p-3 transition",
                              canWrite && "cursor-grab active:cursor-grabbing",
                              dragging === order.orderNumber && "opacity-60",
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => setDetailNumber(order.orderNumber)}
                              className="w-full text-left"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-mono text-[0.68rem] text-muted-foreground">
                                  {order.orderNumber}
                                </span>
                                <span className="text-sm font-semibold tabular-nums text-foreground">
                                  {formatTaka(order.totalPaisa / 100, lang)}
                                </span>
                              </div>
                              <p className="mt-1.5 truncate text-sm font-medium text-foreground">
                                {order.customerName}
                              </p>
                              <p className="mt-0.5 flex items-center gap-1 truncate text-[0.7rem] text-muted-foreground">
                                <MapPin aria-hidden="true" className="size-3 shrink-0" />
                                {order.district[lang]} · {t("admin.orders.items", {
                                  count: formatNumber(order.itemCount, lang),
                                })}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <PaymentPill status={order.paymentStatus} />
                                <span className="inline-flex items-center gap-1 text-[0.62rem] text-muted-foreground">
                                  <Clock aria-hidden="true" className="size-3" />
                                  {formatDateTime(order.createdAt, lang)}
                                </span>
                              </div>
                            </button>

                            {next && canWrite ? (
                              <button
                                type="button"
                                disabled={busy === order.orderNumber}
                                onClick={() => void attemptMove(order.orderNumber, order.status, next)}
                                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--site-border)] px-2 py-1.5 text-[0.7rem] font-semibold text-[var(--accent-ink)] transition hover:border-[var(--accent-ink)] disabled:opacity-60"
                              >
                                <Truck aria-hidden="true" className="size-3.5" />
                                {t("admin.orders.advance")} · {t(orderStatusKey(next))}
                              </button>
                            ) : null}
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {closed.length > 0 ? (
            <section aria-labelledby="closed-heading" className="mt-8">
              <div className="flex items-center gap-2">
                <h2 id="closed-heading" className="text-sm font-semibold text-foreground">
                  {t("admin.orders.terminal")}
                </h2>
                <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] font-semibold tabular-nums text-muted-foreground">
                  {formatNumber(closed.length, lang)}
                </span>
              </div>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {closed.map((order) => (
                  <li key={order.orderNumber}>
                    <button
                      type="button"
                      onClick={() => setDetailNumber(order.orderNumber)}
                      className="flex w-full items-center gap-3 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3 py-2.5 text-left transition hover:border-[var(--accent-ink)]"
                    >
                      <StatusPill status={order.status} />
                      <span className="font-mono text-[0.68rem] text-muted-foreground">
                        {order.orderNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {order.customerName}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-foreground">
                        {formatTaka(order.totalPaisa / 100, lang)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {filtered.length === 0 ? (
            <p className="glass mt-5 rounded-2xl p-5 text-sm text-muted-foreground">
              {t("admin.orders.searchEmpty")}
            </p>
          ) : null}
        </>
      ) : null}

      <Sheet
        open={detailNumber !== null}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <SheetContent
          side="right"
          data-lenis-prevent
          className="w-full gap-0 overflow-y-auto border-l border-[var(--site-border)] bg-background p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b border-[var(--site-border)] p-5 pr-12">
            <SheetTitle className="text-lg">
              {detailNumber
                ? t("admin.orders.detailTitle", { number: detailNumber })
                : t("admin.orders.title")}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {t("admin.orders.detailBody")}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 p-5">
            {detailLoading ? (
              <div className="space-y-3" aria-busy="true">
                <div className="h-20 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
                <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
              </div>
            ) : null}

            {detailError ? <FormAlert message={detailError} /> : null}

            {detail ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={detail.order.status} />
                  <PaymentPill status={detail.order.paymentStatus} />
                  <span className="text-xs text-muted-foreground">
                    {t(METHOD_KEYS[detail.order.paymentMethod])}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(detail.order.createdAt, lang)}
                  </span>
                </div>

                <section aria-labelledby="detail-customer">
                  <h3 id="detail-customer" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.customer")}
                  </h3>
                  <div className="mt-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5 text-sm">
                    <p className="font-medium text-foreground">{detail.order.customer.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone aria-hidden="true" className="size-3.5" />
                      <a href={`tel:${detail.order.customer.phone}`} className="hover:text-foreground" dir="ltr">
                        {detail.order.customer.phone}
                      </a>
                    </p>
                    {detail.order.customer.email ? (
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {detail.order.customer.email}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t("admin.orders.address")}: {detail.order.customer.address}
                      {detail.order.customer.area ? `, ${detail.order.customer.area}` : ""} ·{" "}
                      {detail.order.customer.district.name[lang]}
                    </p>
                    {detail.order.customer.note ? (
                      <p className="mt-2 rounded-lg border border-[var(--site-border)] px-2.5 py-1.5 text-xs text-muted-foreground">
                        {detail.order.customer.note}
                      </p>
                    ) : null}
                  </div>
                </section>

                <section aria-labelledby="detail-items">
                  <h3 id="detail-items" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.itemsTitle")}
                  </h3>
                  <ul className="mt-2 divide-y divide-[var(--site-border)] rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)]">
                    {detail.order.items.map((item) => (
                      <li key={`${item.productId}-${item.variantId ?? "base"}`} className="flex items-center gap-3 p-3">
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          className="size-11 shrink-0 rounded-lg border border-[var(--site-border)] object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{item.name[lang]}</p>
                          <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                            {item.sku}
                            {item.variantLabel ? ` · ${item.variantLabel[lang]}` : ""} · ×
                            {formatNumber(item.qty, lang)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatTaka(item.lineTotalPaisa / 100, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-labelledby="detail-totals">
                  <h3 id="detail-totals" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.totals")}
                  </h3>
                  <dl className="mt-2 space-y-1.5 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
                      <dd className="tabular-nums">{formatTaka(detail.order.totals.subtotalPaisa / 100, lang)}</dd>
                    </div>
                    {detail.order.totals.discountPaisa > 0 ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          {t("checkout.discount")}
                          {detail.order.couponCode ? ` · ${detail.order.couponCode}` : ""}
                        </dt>
                        <dd className="tabular-nums text-[var(--accent-ink)]">
                          −{formatTaka(detail.order.totals.discountPaisa / 100, lang)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("checkout.shipping")}</dt>
                      <dd className="tabular-nums">
                        {detail.order.totals.shippingPaisa === 0
                          ? t("checkout.free")
                          : formatTaka(detail.order.totals.shippingPaisa / 100, lang)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-[var(--site-border)] pt-1.5 font-semibold">
                      <dt>{t("checkout.total")}</dt>
                      <dd className="tabular-nums">
                        {formatTaka(detail.order.totals.totalPaisa / 100, lang)}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section aria-labelledby="detail-history">
                  <h3 id="detail-history" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.timeline")}
                  </h3>
                  <ol className="mt-2 space-y-1.5">
                    {detail.order.statusHistory.map((entry, index) => (
                      <li
                        key={`${entry.status}-${entry.at}-${index}`}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <StatusPill status={entry.status} />
                        <span>{formatDateTime(entry.at, lang)}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section aria-labelledby="detail-actions">
                  <h3 id="detail-actions" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.actions")}
                  </h3>
                  {detail.transitions.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{t("admin.orders.noTransitions")}</p>
                  ) : canWrite ? (
                    <div className="mt-2 space-y-3">
                      <Field id="order-note" label={t("admin.orders.note")}>
                        <input
                          id="order-note"
                          type="text"
                          value={note}
                          maxLength={200}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder={t("admin.orders.notePlaceholder")}
                          disabled={detailBusy}
                          className={fieldClass}
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        {detail.transitions.map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={detailBusy}
                            onClick={() =>
                              void attemptMove(
                                detail.order.orderNumber,
                                detail.order.status,
                                status,
                                note.trim(),
                              )
                            }
                            className={cn(
                              status === "cancelled" || status === "returned"
                                ? secondaryButtonClass
                                : primaryButtonClass,
                              "h-9 w-auto px-3 text-xs",
                            )}
                          >
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                            {t(orderStatusKey(status))}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{t("admin.notAllowed")}</p>
                  )}
                </section>

                <section aria-labelledby="detail-courier">
                  <h3 id="detail-courier" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.courierTitle")}
                  </h3>
                  <div className="mt-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5">
                    <p className="flex items-center gap-1.5 text-sm text-foreground">
                      <Truck aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                      {detail.order.fulfilment.courier
                        ? t(`order.courier.${detail.order.fulfilment.courier}` as DictKey)
                        : t("admin.orders.courierNone")}
                      {detail.order.fulfilment.courierStatus ? (
                        <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-[0.62rem] font-semibold text-muted-foreground">
                          {detail.order.fulfilment.courierStatus}
                        </span>
                      ) : null}
                    </p>
                    {detail.order.fulfilment.trackingNumber ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("admin.orders.trackingNumber")}:{" "}
                        <span className="font-mono font-semibold text-foreground" dir="ltr">
                          {detail.order.fulfilment.trackingNumber}
                        </span>
                      </p>
                    ) : null}

                    {canWrite && ["confirmed", "packed", "shipped"].includes(detail.order.status) ? (
                      <div className="mt-3 space-y-2">
                        <select
                          value={courier}
                          disabled={courierBusy}
                          onChange={(event) => setCourier(event.target.value as CourierId)}
                          aria-label={t("admin.orders.courierTitle")}
                          className={fieldClass}
                        >
                          {detail.couriers.map((option) => (
                            <option key={option.id} value={option.id} disabled={!option.available}>
                              {t(`order.courier.${option.id}` as DictKey)}
                              {option.automatic ? ` · ${t("admin.orders.courierAuto")}` : ""}
                            </option>
                          ))}
                        </select>
                        {courier === "manual" ? (
                          <input
                            type="text"
                            value={tracking}
                            maxLength={60}
                            dir="ltr"
                            placeholder={t("admin.orders.trackingPlaceholder")}
                            onChange={(event) => setTracking(event.target.value)}
                            disabled={courierBusy}
                            className={fieldClass}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void submitCourier()}
                          disabled={courierBusy}
                          className={cn(primaryButtonClass, "h-9 w-auto px-3 text-xs")}
                        >
                          {courierBusy ? (
                            <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
                          ) : (
                            <Truck aria-hidden="true" className="size-3.5" />
                          )}
                          {courierBusy ? t("admin.orders.assigning") : t("admin.orders.assignCourier")}
                        </button>
                        {!detail.couriers.some((option) => option.automatic && option.available) ? (
                          <p className="text-[0.68rem] leading-relaxed text-muted-foreground">
                            {t("admin.orders.courierOnlyManual")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section aria-labelledby="detail-payment">
                  <h3 id="detail-payment" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("admin.orders.paymentTitle")}
                  </h3>
                  {canManagePayments ? (
                    <div className="mt-2">
                      <label htmlFor="payment-status" className="sr-only">
                        {t("admin.orders.setPayment")}
                      </label>
                      <select
                        id="payment-status"
                        value={detail.order.paymentStatus}
                        disabled={detailBusy}
                        onChange={(event) => void changePayment(event.target.value as PaymentStatus)}
                        className={fieldClass}
                      >
                        {PAYMENT_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {t(paymentStatusKey(status))}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Check aria-hidden="true" className="size-3.5" />
                      {t("admin.orders.ownerOnly")}
                    </p>
                  )}
                </section>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </AdminShell>
  );
}
