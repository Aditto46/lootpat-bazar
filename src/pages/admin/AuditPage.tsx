import { Download, RefreshCw, ScrollText, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FormAlert,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { adminErrorKey, loadAudit, type AuditEntry } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { authErrorKey } from "../../lib/authError";
import { formatDateTime, formatNumber, useI18n, type DictKey } from "../../lib/i18n";
import { downloadAuditExport } from "../../lib/security";
import { AdminShell, Panel } from "./AdminShell";

const ACTION_KEYS: Record<string, DictKey> = {
  "product.create": "admin.audit.actionProductCreate",
  "product.update": "admin.audit.actionProductUpdate",
  "product.archive": "admin.audit.actionProductArchive",
  "product.import": "admin.audit.actionProductImport",
  "order.status": "admin.audit.actionOrderStatus",
  "order.payment": "admin.audit.actionOrderPayment",
  "auth.login": "admin.audit.actionLogin",
  "auth.2fa_failed": "admin.audit.actionTwoFactorFailed",
  "auth.2fa_enabled": "admin.audit.actionTwoFactorEnabled",
  "auth.2fa_disabled": "admin.audit.actionTwoFactorDisabled",
  "auth.password_changed": "admin.audit.actionPasswordChanged",
  "team.create": "admin.audit.actionTeamCreate",
  "team.update": "admin.audit.actionTeamUpdate",
  "team.password_reset": "admin.audit.actionTeamPasswordReset",
  "team.2fa_reset": "admin.audit.actionTeamTwoFactorReset",
  "backup.create": "admin.audit.actionBackupCreate",
  "settings.update": "admin.audit.actionSettings",
  "account.delete": "admin.audit.actionAccountDelete",
  "customer.export": "admin.audit.actionCustomerExport",
};

const ACTION_FILTERS = [
  "product",
  "order",
  "auth.2fa",
  "auth.password_changed",
  "auth.login",
  "team",
  "backup.create",
  "settings",
  "account.delete",
  "customer.export",
] as const;

export function AuditPage() {
  const { t, lang } = useI18n();
  const { user, hasPermission } = useAuth();
  const canRead = Boolean(
    user?.role.is_staff && user.role.id === "owner" && hasPermission("audit.read"),
  );

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState({ action: "", q: "" });
  const [exporting, setExporting] = useState(false);

  const { action: appliedAction, q: appliedQuery } = applied;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await loadAudit({
          limit: 100,
          action: appliedAction || undefined,
          q: appliedQuery || undefined,
        });
        setEntries(result.entries);
        setTotal(result.total);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(t(adminErrorKey(cause)));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [t, appliedAction, appliedQuery],
  );

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canRead, load]);

  async function onExport() {
    setExporting(true);
    try {
      await downloadAuditExport({
        action: appliedAction || undefined,
        q: appliedQuery || undefined,
      });
    } catch (cause) {
      toast.error(t(authErrorKey(cause)));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminShell
      eyebrow={t("admin.audit.eyebrow")}
      title={t("admin.audit.title")}
      body={t("admin.audit.body")}
      actions={
        canRead ? (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={secondaryButtonClass}
          >
            <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
            {t("admin.refresh")}
          </button>
        ) : undefined
      }
    >
      {!canRead ? (
        <Panel className="text-sm text-muted-foreground">{t("admin.ownerOnly")}</Panel>
      ) : (
        <>
          <form
            className="glass mb-5 grid gap-3 rounded-2xl p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied({ action, q: query.trim() });
            }}
          >
            <label className="block text-xs font-medium text-muted-foreground">
              {t("admin.audit.filterAction")}
              <select
                value={action}
                onChange={(event) => setAction(event.target.value)}
                className={`${fieldClass} mt-1 h-10`}
              >
                <option value="">{t("admin.audit.filterAll")}</option>
                {ACTION_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {t(ACTION_KEYS[value] ?? "admin.audit.actionOther")} · {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-muted-foreground">
              {t("admin.audit.search")}
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("admin.audit.searchPlaceholder")}
                className={`${fieldClass} mt-1 h-10`}
              />
            </label>
            <button type="submit" className={`${primaryButtonClass} h-10`}>
              <Search aria-hidden="true" className="size-4" />
              {t("admin.audit.apply")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAction("");
                setQuery("");
                setApplied({ action: "", q: "" });
              }}
              className={`${secondaryButtonClass} h-10`}
            >
              {t("admin.audit.reset")}
            </button>
          </form>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {t("admin.audit.filtered", {
                shown: formatNumber(entries.length, lang),
                total: formatNumber(total, lang),
              })}
            </p>
            <button
              type="button"
              onClick={() => void onExport()}
              disabled={exporting}
              className={`${secondaryButtonClass} h-9 px-3 text-xs`}
            >
              <Download
                aria-hidden="true"
                className={exporting ? "size-3.5 animate-pulse" : "size-3.5"}
              />
              {t("admin.audit.export")}
            </button>
          </div>

          {error ? (
            <div className="space-y-3">
              <FormAlert message={error} />
              <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
                <RefreshCw aria-hidden="true" className="size-4" />
                {t("admin.tryAgain")}
              </button>
            </div>
          ) : null}

          {loading && entries.length === 0 ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="h-20 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
              ))}
            </div>
          ) : null}

          {!loading && entries.length === 0 && !error ? (
            <Panel className="flex items-center gap-3 text-sm text-muted-foreground">
              <ScrollText aria-hidden="true" className="size-4" />
              {t("admin.audit.empty")}
            </Panel>
          ) : null}

          {entries.length > 0 ? (
            <ul className="space-y-2.5">
              {entries.map((entry) => (
                <li key={entry.id} className="glass rounded-2xl p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="rounded-full border border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] px-2 py-0.5 text-[0.62rem] font-semibold text-[var(--accent-ink)]">
                      {t(ACTION_KEYS[entry.action] ?? "admin.audit.actionOther")}
                    </span>
                    <span className="font-mono text-[0.65rem] text-muted-foreground">
                      {entry.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("admin.audit.when")}: {formatDateTime(entry.createdAt, lang)}
                    </span>
                    {entry.ip ? (
                      <span className="text-[0.65rem] text-muted-foreground" dir="ltr">
                        {t("admin.audit.ip")}: {entry.ip}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-sm text-foreground">{entry.summary}</p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-muted-foreground">
                    <span>
                      {t("admin.audit.actor")}: {entry.actor.name || "—"} ({entry.actor.role || "—"})
                    </span>
                    <span>
                      {t("admin.audit.entity")}: {entry.entityType}
                      {entry.entityId ? ` · ${entry.entityId}` : ""}
                    </span>
                  </div>

                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.68rem] font-semibold text-[var(--accent-ink)]">
                      {t("admin.audit.details")}
                    </summary>
                    <pre className="scrollbar-thin mt-2 overflow-x-auto rounded-lg border border-[var(--site-border)] bg-[var(--surface-sunken)] p-2.5 text-[0.65rem] leading-relaxed text-muted-foreground">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : null}

          {entries.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("admin.audit.count", { count: formatNumber(entries.length, lang) })}
            </p>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
