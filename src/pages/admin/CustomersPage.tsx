import { Ban, RefreshCw, Search, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  FormAlert,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { adminErrorKey } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import type { OrderStatus, PaymentStatus } from "../../lib/checkout";
import { orderStatusKey, paymentStatusKey } from "../../lib/checkout";
import { formatDateTime, formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import {
  loadAdminCustomerDetail,
  loadAdminCustomers,
  updateAdminCustomer,
  type AdminCustomer,
  type AdminCustomerDetail,
  type AdminCustomersResponse,
  type CustomerSegment,
} from "../../lib/marketing";
import { cn } from "@/lib/utils";
import { AdminShell, Panel } from "./AdminShell";

type Filter = "all" | "vip" | "inactive" | "new";

const FILTERS: Array<{ id: Filter; label: DictKey }> = [
  { id: "all", label: "admin.customers.all" },
  { id: "vip", label: "admin.customers.vip" },
  { id: "inactive", label: "admin.customers.inactive" },
  { id: "new", label: "admin.customers.new" },
];

const SEGMENT_KEYS: Record<CustomerSegment, DictKey> = {
  vip: "admin.customers.vip",
  inactive: "admin.customers.inactive",
  new: "admin.customers.new",
  regular: "admin.customers.segmentRegular",
};

const SEGMENT_TONES: Record<CustomerSegment, string> = {
  vip: "border-[color-mix(in_srgb,var(--brand-gold)_50%,transparent)] text-[var(--brand-gold)]",
  inactive: "border-[var(--site-border)] text-muted-foreground",
  new: "border-[color-mix(in_srgb,var(--brand-teal)_45%,transparent)] text-[var(--brand-teal)]",
  regular: "border-[var(--site-border)] text-muted-foreground",
};

export function CustomersPage() {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("customers.write");

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<AdminCustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null);
  const [detailPhone, setDetailPhone] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadAdminCustomers({ q: search || undefined, segment: filter });
      setData(result);
      setError(null);
    } catch (cause) {
      setError(t(adminErrorKey(cause)));
    } finally {
      setLoading(false);
    }
  }, [filter, search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(async (phone: string) => {
    setDetailPhone(phone);
    setDetail(null);
    setDetailLoading(true);
    setNote("");
    setBlockReason("");
    try {
      const result = await loadAdminCustomerDetail(phone);
      setDetail(result.customer);
      setBlockReason(result.customer.blockReason ?? "");
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
      setDetailPhone(null);
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  async function refreshDetail(phone: string) {
    const result = await loadAdminCustomerDetail(phone);
    setDetail(result.customer);
    setBlockReason(result.customer.blockReason ?? "");
    await load();
  }

  async function addNote() {
    if (!detail) return;
    setBusy(true);
    try {
      await updateAdminCustomer(detail.phone, { action: "note", note: note.trim() });
      toast.success(t("admin.customers.noteSaved"));
      setNote("");
      await refreshDetail(detail.phone);
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    if (!detail) return;
    const blocking = !detail.blocked;
    setBusy(true);
    try {
      await updateAdminCustomer(detail.phone, {
        action: blocking ? "block" : "unblock",
        reason: blocking ? blockReason.trim() : undefined,
      });
      toast.success(t(blocking ? "admin.customers.blockedDone" : "admin.customers.unblockedDone"));
      await refreshDetail(detail.phone);
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.counts ?? { all: 0, vip: 0, inactive: 0, new: 0 };

  return (
    <AdminShell
      eyebrow={t("admin.customers.eyebrow")}
      title={t("admin.customers.title")}
      body={t("admin.customers.body")}
      actions={
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
          {t("admin.refresh")}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              filter === entry.id
                ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
            )}
          >
            {t(entry.label)}
            <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[0.65rem] font-semibold">
              {formatNumber(counts[entry.id], lang)}
            </span>
          </button>
        ))}
      </div>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
        }}
      >
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            placeholder={t("admin.customers.search")}
            aria-label={t("admin.customers.search")}
            className={cn(fieldClass, "pl-9")}
          />
        </div>
        <button type="submit" className={secondaryButtonClass}>
          <Search aria-hidden="true" className="size-4" />
          {t("admin.customers.search")}
        </button>
      </form>

      {error ? (
        <div className="mt-4">
          <FormAlert message={error} />
        </div>
      ) : null}

      {loading && !data ? (
        <div className="mt-5 space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
          ))}
        </div>
      ) : null}

      {data && data.customers.length === 0 ? (
        <Panel className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
          <UserRound aria-hidden="true" className="size-4" />
          {t("admin.customers.empty")}
        </Panel>
      ) : null}

      {data && data.customers.length > 0 ? (
        <ul className="mt-5 space-y-2.5">
          {data.customers.map((customer) => (
            <li key={customer.phone}>
              <button
                type="button"
                onClick={() => void openDetail(customer.phone)}
                className="glass flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl p-4 text-left transition hover:border-[var(--accent-ink)]"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-sm font-semibold text-foreground">
                  {customer.name.trim().slice(0, 1) || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {customer.name || customer.phone}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold",
                        SEGMENT_TONES[customer.segment],
                      )}
                    >
                      {t(SEGMENT_KEYS[customer.segment])}
                    </span>
                    {customer.blocked ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] px-2 py-0.5 text-[0.62rem] font-semibold text-[var(--danger-ink)]">
                        <Ban aria-hidden="true" className="size-3" />
                        {t("admin.customers.blocked")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground" dir="ltr">
                    {customer.phone}
                    {customer.email ? ` · ${customer.email}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Wallet aria-hidden="true" className="size-3.5" />
                    {formatTaka(customer.lifetimePaisa / 100, lang)}
                  </span>
                  <span>
                    {t("admin.customers.orders")}: {formatNumber(customer.orders, lang)}
                  </span>
                  <span>{t("admin.customers.view")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={detailPhone !== null} onOpenChange={(open) => !open && setDetailPhone(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>{t("admin.customers.detailTitle")}</DialogTitle>
          {detailLoading ? (
            <div className="mt-4 h-40 animate-pulse rounded-xl bg-[var(--surface-sunken)]" aria-busy="true" />
          ) : null}

          {detail ? (
            <div className="scrollbar-thin mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              <div className="rounded-xl border border-[var(--site-border)] p-3">
                <p className="text-base font-semibold text-foreground">{detail.name || detail.phone}</p>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {detail.phone}
                  {detail.email ? ` · ${detail.email}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {t("admin.customers.lifetime")}: {formatTaka(detail.lifetimePaisa / 100, lang)}
                  </span>
                  <span>
                    {t("admin.customers.orders")}: {formatNumber(detail.orders, lang)}
                  </span>
                  <span>
                    {t("admin.customers.points")}: {formatNumber(detail.points, lang)}
                  </span>
                  <span>
                    {t("admin.customers.lastOrder")}:{" "}
                    {detail.lastOrderAt ? formatDateTime(detail.lastOrderAt, lang) : "—"}
                  </span>
                </div>
              </div>

              {canWrite ? (
                <div className="rounded-xl border border-[var(--site-border)] p-3">
                  <label className={labelClass} htmlFor="customer-note">
                    {t("admin.customers.addNote")}
                  </label>
                  <textarea
                    id="customer-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder={t("admin.customers.notePlaceholder")}
                    className={cn(fieldClass, "mt-1.5 resize-none text-sm")}
                  />
                  <button
                    type="button"
                    disabled={busy || note.trim().length === 0}
                    onClick={() => void addNote()}
                    className={cn(primaryButtonClass, "mt-2 h-9 px-4 text-xs")}
                  >
                    {t("admin.customers.addNote")}
                  </button>

                  <div className="mt-3 border-t border-[var(--site-border)] pt-3">
                    <label className={labelClass} htmlFor="customer-block-reason">
                      {t("admin.customers.blockReason")}
                    </label>
                    <input
                      id="customer-block-reason"
                      value={blockReason}
                      onChange={(event) => setBlockReason(event.target.value)}
                      maxLength={200}
                      disabled={detail.blocked}
                      className={cn(fieldClass, "mt-1.5 h-9 text-sm")}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleBlock()}
                      className={cn(secondaryButtonClass, "mt-2 h-9 px-4 text-xs")}
                    >
                      {detail.blocked ? (
                        <ShieldCheck aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Ban aria-hidden="true" className="size-3.5" />
                      )}
                      {t(detail.blocked ? "admin.customers.unblock" : "admin.customers.block")}
                    </button>
                  </div>
                </div>
              ) : null}

              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("admin.customers.orderHistory")}
                </h3>
                {detail.orders.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t("admin.customers.noOrders")}</p>
                ) : (
                  <ul className="mt-2 divide-y divide-[var(--site-border)] rounded-xl border border-[var(--site-border)]">
                    {detail.orders.map((order) => (
                      <li key={order.orderNumber} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs">
                        <span className="font-mono text-foreground" dir="ltr">
                          {order.orderNumber}
                        </span>
                        <span className="text-muted-foreground">
                          {t(orderStatusKey(order.status as OrderStatus))} ·{" "}
                          {t(paymentStatusKey(order.paymentStatus as PaymentStatus))}
                        </span>
                        <span className="text-foreground">{formatTaka(order.totalPaisa / 100, lang)}</span>
                        <span className="text-muted-foreground">
                          {formatDateTime(order.createdAt, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("admin.customers.notes")}</h3>
                {detail.notes.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{t("admin.customers.noNotes")}</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {detail.notes.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-[var(--site-border)] bg-[var(--surface-sunken)] p-2.5 text-xs"
                      >
                        <p className="text-foreground">{entry.body}</p>
                        <p className="mt-1 text-[0.65rem] text-muted-foreground">
                          {formatDateTime(entry.createdAt, lang)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
