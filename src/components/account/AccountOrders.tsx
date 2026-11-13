import { ArrowRight, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import {
  orderStatusKey,
  type Order,
  type OrderStatus,
} from "../../lib/checkout";
import { formatDateTime, formatNumber, formatTaka, useI18n } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { cn } from "@/lib/utils";

const TERMINAL: OrderStatus[] = ["cancelled", "returned"];

export function AccountOrders() {
  const { t, lang } = useI18n();
  const [orders, setOrders] = useState<Order[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setState("loading");
    apiRequest<{ orders: Order[] }>("/api/account/orders")
      .then((response) => {
        if (!active) return;
        setOrders(response.orders);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return (
    <section className="mt-6 glass rounded-[var(--radius-card)] p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">
            {t("account.ordersTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("account.ordersBody")}</p>
        </div>
      </div>

      {state === "loading" ? (
        <div className="mt-5 space-y-3" aria-hidden="true">
          {[0, 1].map((index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
          ))}
        </div>
      ) : state === "error" ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">{t("checkout.errorNetwork")}</p>
          <button
            type="button"
            onClick={() => setNonce((current) => current + 1)}
            className="inline-flex h-9 items-center rounded-full border border-[var(--site-border)] px-4 text-xs font-semibold text-foreground transition hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--site-border)] px-5 py-10 text-center">
          <Package aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t("account.ordersEmpty")}</p>
          <p className="text-xs text-muted-foreground">{t("account.ordersEmptyBody")}</p>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-[var(--site-border)]">
          {orders.map((order) => {
            const terminal = TERMINAL.includes(order.status);
            return (
              <li key={order.orderNumber}>
                <Link
                  to={`/order/${order.orderNumber}`}
                  className="group flex flex-wrap items-center gap-3 py-3.5 first:pt-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-heading text-sm font-bold tracking-wider text-foreground">
                      {order.orderNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDateTime(order.createdAt, lang)} ·{" "}
                      {t("checkout.items", { count: formatNumber(order.items.length, lang) })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[0.68rem] font-semibold",
                      terminal
                        ? "bg-[color-mix(in_srgb,var(--brand-rose)_14%,transparent)] text-[var(--brand-rose)]"
                        : "bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-[var(--accent-ink)]",
                    )}
                  >
                    {t(orderStatusKey(order.status))}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatTaka(order.totals.totalPaisa / 100, lang)}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                  <span className="sr-only">{t("account.ordersOpen")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
