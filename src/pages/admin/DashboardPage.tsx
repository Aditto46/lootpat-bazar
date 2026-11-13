import {
  ArrowUpRight,
  ClipboardList,
  Package,
  Plus,
  RefreshCw,
  ScrollText,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FormAlert, secondaryButtonClass } from "../../components/auth/AuthShell";
import { useAuth } from "../../lib/auth";
import {
  adminErrorKey,
  loadDashboard,
  type AdminDashboard,
} from "../../lib/admin";
import { formatDateTime, formatNumber, formatTaka, useI18n } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { AdminShell, Panel, StatusPill } from "./AdminShell";

const quickLinkClass =
  "flex items-center justify-between gap-3 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-3 text-sm font-medium text-foreground transition hover:border-[var(--accent-ink)]";

export function DashboardPage() {
  const { t, lang } = useI18n();
  const { hasPermission, user } = useAuth();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await loadDashboard(signal);
      setData(result);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(t(adminErrorKey(cause)));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const metrics = data?.metrics;
  const trendMax = data ? Math.max(1, ...data.trend.map((point) => point.revenuePaisa)) : 1;

  return (
    <AdminShell
      eyebrow={t("admin.dashboard.eyebrow")}
      title={t("admin.dashboard.title")}
      body={t("admin.dashboard.body")}
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
      {error ? (
        <div className="space-y-3">
          <FormAlert message={error} />
          <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("admin.tryAgain")}
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((tile) => (
            <div key={tile} className="glass h-24 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : null}

      {!data && !loading && !error ? (
        <p className="glass rounded-2xl p-5 text-sm text-muted-foreground">
          {t("admin.dashboard.recentEmpty")}
        </p>
      ) : null}

      {data && metrics ? (
        <div className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { key: "todayOrders", label: t("admin.dashboard.todayOrders"), value: formatNumber(metrics.todayOrders, lang) },
              { key: "todayRevenue", label: t("admin.dashboard.todayRevenue"), value: formatTaka(metrics.todayRevenuePaisa / 100, lang) },
              { key: "openOrders", label: t("admin.dashboard.openOrders"), value: formatNumber(metrics.openOrders, lang) },
              { key: "lowStock", label: t("admin.dashboard.lowStock"), value: formatNumber(metrics.lowStockCount, lang) },
              { key: "activeProducts", label: t("admin.dashboard.activeProducts"), value: formatNumber(metrics.activeProducts, lang) },
              { key: "customers", label: t("admin.dashboard.customers"), value: formatNumber(metrics.customers, lang) },
            ].map((metric) => (
              <div key={metric.key} className="glass rounded-2xl p-5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {metric.label}
                </dt>
                <dd className="mt-2 font-heading text-2xl font-bold text-foreground">{metric.value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel aria-labelledby="trend-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="trend-heading" className="text-base font-semibold text-foreground">
                  {t("admin.dashboard.trendTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">{t("admin.dashboard.trendBody")}</p>
              </div>
              <ul className="mt-5 flex h-40 items-end gap-2 sm:gap-3">
                {data.trend.map((point) => {
                  const height = Math.round((point.revenuePaisa / trendMax) * 100);
                  const [, month, day] = point.date.split("-");
                  const label = `${formatNumber(Number(day), lang)}/${formatNumber(Number(month), lang)}`;
                  return (
                    <li key={point.date} className="flex flex-1 flex-col items-center gap-2">
                      <span
                        className="w-full rounded-t-lg bg-[linear-gradient(180deg,var(--brand-teal),color-mix(in_srgb,var(--site-accent)_65%,transparent))]"
                        style={{ height: `${Math.max(4, height)}%` }}
                        aria-hidden="true"
                      />
                      <span
                        className="text-[0.62rem] tabular-nums text-muted-foreground"
                        aria-label={t("admin.dashboard.trendLabel", {
                          date: label,
                          orders: formatNumber(point.orders, lang),
                          revenue: formatTaka(point.revenuePaisa / 100, lang),
                        })}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel aria-labelledby="low-heading">
              <div className="flex items-center gap-2">
                <TriangleAlert aria-hidden="true" className="size-4 text-[var(--brand-gold)]" />
                <h2 id="low-heading" className="text-base font-semibold text-foreground">
                  {t("admin.dashboard.lowTitle")}
                </h2>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("admin.dashboard.lowBody")}
              </p>
              {data.lowStock.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("admin.dashboard.lowEmpty")}</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {data.lowStock.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={`/admin/products/${item.id}/edit`}
                        className="flex items-center gap-3 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-2.5 transition hover:border-[var(--accent-ink)]"
                      >
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          className="size-10 shrink-0 rounded-lg border border-[var(--site-border)] object-cover"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {item.name[lang]}
                        </span>
                        <span className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--brand-gold)]">
                          {t("admin.dashboard.lowCount", { count: formatNumber(item.stock, lang) })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Panel aria-labelledby="recent-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="recent-heading" className="text-base font-semibold text-foreground">
                  {t("admin.dashboard.recentTitle")}
                </h2>
                <Link
                  to="/admin/orders"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)] hover:underline"
                >
                  {t("admin.view")}
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.dashboard.recentBody")}</p>
              {data.recentOrders.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("admin.dashboard.recentEmpty")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-[var(--site-border)]">
                  {data.recentOrders.map((order) => (
                    <li key={order.orderNumber}>
                      <Link
                        to={`/admin/orders?order=${encodeURIComponent(order.orderNumber)}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 transition hover:text-[var(--accent-ink)]"
                      >
                        <ShoppingBag aria-hidden="true" className="size-4 text-muted-foreground" />
                        <span className="font-mono text-xs text-foreground">{order.orderNumber}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                          {order.customerName}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatTaka(order.totalPaisa / 100, lang)}
                        </span>
                        <StatusPill status={order.status} />
                        <span className="w-full text-[0.65rem] text-muted-foreground sm:w-auto">
                          {formatDateTime(order.createdAt, lang)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel aria-labelledby="quick-heading">
              <h2 id="quick-heading" className="text-base font-semibold text-foreground">
                {t("admin.dashboard.quickTitle")}
              </h2>
              <div className="mt-4 grid gap-2">
                <Link to="/admin/orders" className={quickLinkClass}>
                  <span className="inline-flex items-center gap-2">
                    <ClipboardList aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                    {t("admin.dashboard.quickOrders")}
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Link>
                <Link to="/admin/products" className={quickLinkClass}>
                  <span className="inline-flex items-center gap-2">
                    <Package aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                    {t("admin.dashboard.quickProducts")}
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Link>
                {hasPermission("products.write") ? (
                  <Link to="/admin/products/new" className={quickLinkClass}>
                    <span className="inline-flex items-center gap-2">
                      <Plus aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                      {t("admin.dashboard.quickAdd")}
                    </span>
                    <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Link>
                ) : null}
                {user?.role.id === "owner" && hasPermission("audit.read") ? (
                  <Link to="/admin/audit" className={quickLinkClass}>
                    <span className="inline-flex items-center gap-2">
                      <ScrollText aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                      {t("admin.dashboard.quickAudit")}
                    </span>
                    <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Link>
                ) : null}
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
