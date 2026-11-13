import {
  CheckCheck,
  Inbox,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  UserCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  FormAlert,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { adminErrorKey } from "../../lib/admin";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { OrderStatus, PaymentStatus } from "../../lib/checkout";
import { paymentStatusKey } from "../../lib/checkout";
import { formatDateTime, formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import {
  assignSupportChat,
  closeSupportChat,
  createCannedReply,
  loadAdminSupport,
  loadAdminSupportDetail,
  replyToSupportChat,
  type AdminSupportDetail,
  type AdminSupportInbox,
  type AdminSupportItem,
  type SupportLocale,
  type SupportMessage,
  type SupportSla,
  type SupportStatus,
} from "../../lib/support";
import { cn } from "@/lib/utils";
import { AdminShell, Panel, PaymentPill, StatusPill } from "./AdminShell";

const FILTERS: Array<{ id: SupportStatus | "all"; label: DictKey }> = [
  { id: "all", label: "admin.support.filter.all" },
  { id: "waiting", label: "admin.support.filter.waiting" },
  { id: "open", label: "admin.support.filter.open" },
  { id: "bot", label: "admin.support.filter.bot" },
  { id: "resolved", label: "admin.support.filter.resolved" },
];

const STATUS_TONES: Record<SupportStatus, string> = {
  bot: "border-[var(--site-border)] text-muted-foreground",
  waiting: "border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] text-[var(--brand-gold)]",
  open: "border-[color-mix(in_srgb,var(--site-accent)_55%,transparent)] text-[var(--accent-ink)]",
  resolved: "border-[var(--site-border)] text-muted-foreground",
};

const SLA_TONES: Record<SupportSla["state"], string> = {
  ok: "border-[var(--site-border)] text-muted-foreground",
  "at-risk": "border-[color-mix(in_srgb,var(--brand-gold)_50%,transparent)] text-[var(--brand-gold)]",
  overdue: "border-[color-mix(in_srgb,var(--danger-ink)_50%,transparent)] text-[var(--danger-ink)]",
  answered: "border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] text-[var(--accent-ink)]",
  closed: "border-[var(--site-border)] text-muted-foreground",
  none: "border-[var(--site-border)] text-muted-foreground",
};

const SLA_KEYS: Record<SupportSla["state"], DictKey> = {
  ok: "admin.support.sla.ok",
  "at-risk": "admin.support.sla.atRisk",
  overdue: "admin.support.sla.overdue",
  answered: "admin.support.sla.answered",
  closed: "admin.support.sla.closed",
  none: "admin.support.sla.none",
};

const AUTHOR_KEYS: Record<SupportMessage["authorType"], DictKey> = {
  customer: "chat.you",
  assistant: "chat.assistant",
  staff: "chat.agent",
  system: "chat.system",
};

function SupportStatusPill({ status }: { status: SupportStatus }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold",
        STATUS_TONES[status],
      )}
    >
      {t(`chat.status.${status}` as DictKey)}
    </span>
  );
}

function SlaPill({ sla }: { sla: SupportSla }) {
  const { t, lang } = useI18n();
  if (sla.state === "none") return null;
  const detail =
    sla.state === "ok" || sla.state === "at-risk"
      ? sla.minutesLeft !== null
        ? ` · ${t("admin.support.minutesLeft", { count: formatNumber(sla.minutesLeft, lang) })}`
        : ""
      : sla.state === "overdue" && sla.minutesLeft !== null
        ? ` · ${t("admin.support.minutesLate", { count: formatNumber(Math.abs(sla.minutesLeft), lang) })}`
        : "";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold",
        SLA_TONES[sla.state],
      )}
    >
      {t(SLA_KEYS[sla.state])}
      {detail}
    </span>
  );
}

function CustomerPhone({ phone }: { phone: string | null }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`} dir="ltr" className="text-xs text-muted-foreground hover:text-foreground">
      {phone}
    </a>
  );
}

function InboxRow({
  item,
  active,
  onSelect,
}: {
  item: AdminSupportItem;
  active: boolean;
  onSelect: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-xl border px-3 py-2.5 text-left transition",
        active
          ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_10%,transparent)]"
          : "border-[var(--site-border)] bg-[var(--surface-raised)] hover:border-[var(--accent-ink)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground">{item.customerName}</span>
        <span className="shrink-0 text-[0.62rem] text-muted-foreground">
          {formatDateTime(item.lastMessageAt, lang)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <SupportStatusPill status={item.status} />
        <SlaPill sla={item.sla} />
        {item.orderNumber ? (
          <span className="font-mono text-[0.62rem] text-muted-foreground">{item.orderNumber}</span>
        ) : null}
      </div>
      {item.lastMessage ? (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {item.lastMessage.body}
        </p>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-2 text-[0.62rem] text-muted-foreground">
        <span>{t("admin.support.messages", { count: formatNumber(item.messageCount, lang) })}</span>
        <span className="truncate">
          {item.assignedTo ?? t("admin.support.unassigned")}
        </span>
      </div>
    </button>
  );
}

export function SupportPage() {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("support.write");

  const [inbox, setInbox] = useState<AdminSupportInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SupportStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSupportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [cannedTitle, setCannedTitle] = useState("");
  const [cannedBody, setCannedBody] = useState("");
  const [cannedLocale, setCannedLocale] = useState<SupportLocale>(lang === "bn" ? "bn" : "en");

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await loadAdminSupport({
          status: statusFilter === "all" ? undefined : statusFilter,
          q: query || undefined,
        });
        if (signal?.aborted) return;
        setInbox(result);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(t(adminErrorKey(cause)));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [statusFilter, query, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void load();
    }, 20000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    loadAdminSupportDetail(selectedId)
      .then((result) => {
        if (!controller.signal.aborted) setDetail(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setDetailError(t(adminErrorKey(cause)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, t]);

  useEffect(() => {
    if (!selectedId) return;
    const id = window.setInterval(() => {
      if (document.hidden || busy) return;
      loadAdminSupportDetail(selectedId)
        .then((result) => setDetail(result))
        .catch(() => {
          /* keep the current thread on transient failures */
        });
    }, 15000);
    return () => window.clearInterval(id);
  }, [selectedId, busy]);

  const counts = inbox?.counts;
  const list = inbox?.conversations ?? [];
  const staff = inbox?.staff ?? [];
  const canned = inbox?.canned ?? [];

  const totalCount = useMemo(
    () =>
      counts
        ? counts.bot + counts.waiting + counts.open + counts.resolved
        : 0,
    [counts],
  );

  function filterCount(id: SupportStatus | "all") {
    if (!counts) return 0;
    return id === "all" ? totalCount : counts[id];
  }

  function applyDetail(next: AdminSupportDetail) {
    setDetail(next);
    void load();
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || busy) return;
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      const result = await replyToSupportChat(detail.conversation.id, { body });
      applyDetail(result);
      setReply("");
      toast.success(t("admin.support.replied"));
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function assign(assigneeId: string) {
    if (!detail || !assigneeId || busy) return;
    setBusy(true);
    try {
      const result = await assignSupportChat(detail.conversation.id, assigneeId);
      applyDetail(result);
      toast.success(t("admin.support.assigned"));
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function closeConversation() {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const result = await closeSupportChat(detail.conversation.id);
      applyDetail(result);
      toast.success(t("admin.support.closed"));
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  async function submitCanned(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const title = cannedTitle.trim();
    const body = cannedBody.trim();
    if (title.length < 2 || !body) {
      toast.error(t("admin.support.error"));
      return;
    }
    setBusy(true);
    try {
      const result = await createCannedReply({ title, body, locale: cannedLocale });
      setInbox((current) => (current ? { ...current, canned: result.canned } : current));
      setCannedTitle("");
      setCannedBody("");
      setCannedOpen(false);
      toast.success(t("admin.support.cannedCreated"));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "forbidden") {
        toast.error(t("admin.notAllowed"));
      } else {
        toast.error(t(adminErrorKey(cause)));
      }
    } finally {
      setBusy(false);
    }
  }

  const resolvedClosed = detail?.conversation.status === "resolved";

  return (
    <AdminShell
      eyebrow={t("admin.support.eyebrow")}
      title={t("admin.support.title")}
      body={t("admin.support.body")}
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
      {!canWrite ? (
        <p className="mb-4 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {t("admin.support.readOnly")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="scrollbar-thin flex gap-1.5 overflow-x-auto">
          {FILTERS.map((filter) => {
            const active = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(filter.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  active
                    ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_12%,transparent)] text-foreground"
                    : "border-[var(--site-border)] text-muted-foreground hover:border-[var(--accent-ink)] hover:text-foreground",
                )}
              >
                {t(filter.label)}
                <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[0.62rem] tabular-nums">
                  {formatNumber(filterCount(filter.id), lang)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative ml-auto w-full sm:w-64">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("admin.support.searchPlaceholder")}
            aria-label={t("admin.search")}
            className={cn(fieldClass, "h-10 pl-9 pr-9")}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label={t("admin.clear")}
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Panel className="p-3 sm:p-3">
          {loading && list.length === 0 ? (
            <div className="space-y-2" aria-busy="true">
              <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
              <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
              <div className="h-24 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
            </div>
          ) : list.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Inbox aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">{t("admin.support.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.support.emptyBody")}</p>
            </div>
          ) : (
            <ul className="scrollbar-thin max-h-[34rem] space-y-2 overflow-y-auto pr-1" data-lenis-prevent>
              {list.map((item) => (
                <li key={item.id}>
                  <InboxRow
                    item={item}
                    active={item.id === selectedId}
                    onSelect={() => setSelectedId(item.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {selectedId ? (
          <Panel className="min-h-[24rem]">
            {detailLoading && !detail ? (
              <div className="space-y-3" aria-busy="true">
                <div className="h-16 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
                <div className="h-40 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
              </div>
            ) : null}

            {detailError ? <FormAlert message={detailError} /> : null}

            {detail ? (
              <div className="space-y-4">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-foreground">
                      {detail.conversation.customerName}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <CustomerPhone phone={detail.conversation.customerPhone} />
                      {detail.conversation.orderNumber ? (
                        <span className="font-mono text-[0.68rem] text-muted-foreground">
                          {detail.conversation.orderNumber}
                        </span>
                      ) : null}
                      <span className="text-[0.68rem] text-muted-foreground">
                        {formatDateTime(detail.conversation.createdAt, lang)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <SupportStatusPill status={detail.conversation.status} />
                      <SlaPill sla={detail.conversation.sla} />
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] text-muted-foreground">
                        <UserCheck aria-hidden="true" className="size-3" />
                        {detail.conversation.assignedTo ?? t("admin.support.unassigned")}
                      </span>
                    </div>
                  </div>

                  {canWrite && !resolvedClosed ? (
                    <button
                      type="button"
                      onClick={() => void closeConversation()}
                      disabled={busy}
                      className={cn(secondaryButtonClass, "h-9 text-xs")}
                    >
                      <CheckCheck aria-hidden="true" className="size-4" />
                      {t("admin.support.closeChat")}
                    </button>
                  ) : null}
                </header>

                {detail.order ? (
                  <section
                    aria-label={t("admin.support.order")}
                    className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {t("admin.support.order")}
                      </span>
                      <span className="font-mono text-[0.68rem] text-muted-foreground">
                        {detail.order.orderNumber}
                      </span>
                      <StatusPill status={detail.order.status as OrderStatus} />
                      <PaymentPill status={detail.order.paymentStatus as PaymentStatus} />
                      <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">
                        {formatTaka(detail.order.totalPaisa / 100, lang)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[0.68rem] text-muted-foreground">
                      {detail.order.courier ?? "—"}
                      {detail.order.trackingNumber ? ` · ${detail.order.trackingNumber}` : ""}
                      {` · ${t(paymentStatusKey(detail.order.paymentStatus as PaymentStatus))}`}
                    </p>
                  </section>
                ) : (
                  <p className="rounded-xl border border-dashed border-[var(--site-border)] px-3 py-2 text-xs text-muted-foreground">
                    {t("admin.support.noOrder")}
                  </p>
                )}

                <section
                  aria-label={t("admin.support.messages", {
                    count: formatNumber(detail.messages.length, lang),
                  })}
                >
                  <ul
                    data-lenis-prevent
                    className="scrollbar-thin max-h-[22rem] space-y-3 overflow-y-auto rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3"
                  >
                    {detail.messages.map((entry) => {
                      const staff = entry.authorType === "staff";
                      const system = entry.authorType === "system";
                      if (system) {
                        return (
                          <li key={entry.id} className="text-center">
                            <span className="rounded-full border border-[var(--site-border)] px-2.5 py-0.5 text-[0.62rem] text-muted-foreground">
                              {entry.body}
                            </span>
                          </li>
                        );
                      }
                      return (
                        <li key={entry.id} className={cn("flex flex-col gap-1", staff ? "items-end" : "items-start")}>
                          <p className="px-1 text-[0.6rem] text-muted-foreground">
                            {entry.authorType === "staff"
                              ? entry.authorName ?? t(AUTHOR_KEYS.staff)
                              : t(AUTHOR_KEYS[entry.authorType])}
                            <span aria-hidden="true"> · </span>
                            {formatDateTime(entry.createdAt, lang)}
                          </p>
                          <p
                            className={cn(
                              "max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm leading-relaxed",
                              staff
                                ? "rounded-br-md bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                                : "rounded-bl-md border border-[var(--site-border)] bg-[var(--surface-raised)] text-foreground",
                            )}
                          >
                            {entry.body}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {canWrite ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <div>
                        <label htmlFor="support-assign" className={cn(labelClass, "text-xs")}>
                          {t("admin.support.assignTo")}
                        </label>
                        <select
                          id="support-assign"
                          value={detail.conversation.assignedToId ?? ""}
                          disabled={busy || resolvedClosed}
                          onChange={(event) => void assign(event.target.value)}
                          className={cn(fieldClass, "mt-1 h-10")}
                        >
                          <option value="" disabled>
                            {t("admin.support.unassigned")}
                          </option>
                          {staff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => setCannedOpen((current) => !current)}
                          className={cn(secondaryButtonClass, "h-10 w-full text-xs sm:w-auto")}
                        >
                          <MessageSquare aria-hidden="true" className="size-4" />
                          {t("admin.support.newCanned")}
                        </button>
                      </div>
                    </div>

                    <form onSubmit={submitReply} className="space-y-2">
                      {canned.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <label htmlFor="support-canned" className="text-[0.68rem] font-semibold text-muted-foreground">
                            {t("admin.support.canned")}
                          </label>
                          <select
                            id="support-canned"
                            value=""
                            disabled={busy || resolvedClosed}
                            onChange={(event) => {
                              const chosen = canned.find((entry) => entry.id === event.target.value);
                              if (chosen) {
                                setReply((current) =>
                                  current ? `${current}\n${chosen.body}` : chosen.body,
                                );
                              }
                            }}
                            className={cn(fieldClass, "h-8 max-w-full flex-1 text-xs")}
                          >
                            <option value="">{t("admin.support.insert")}…</option>
                            {canned.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.title} · {entry.locale === "bn" ? "বাংলা" : "EN"}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <p className="text-[0.68rem] text-muted-foreground">{t("admin.support.cannedNone")}</p>
                      )}

                      <label htmlFor="support-reply" className="sr-only">
                        {t("admin.support.reply")}
                      </label>
                      <textarea
                        id="support-reply"
                        value={reply}
                        rows={3}
                        maxLength={1000}
                        disabled={busy || resolvedClosed}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder={
                          resolvedClosed ? t("admin.support.closed") : t("admin.support.replyPlaceholder")
                        }
                        className={cn(fieldClass, "h-auto resize-none py-2.5")}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          disabled={busy || resolvedClosed || !reply.trim()}
                          className={cn(primaryButtonClass, "h-9 w-auto px-3 text-xs")}
                        >
                          {busy ? (
                            <RefreshCw aria-hidden="true" className="size-3.5 animate-spin" />
                          ) : (
                            <Send aria-hidden="true" className="size-3.5" />
                          )}
                          {busy ? t("admin.support.sending") : t("admin.support.send")}
                        </button>
                        <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                          <UserCheck aria-hidden="true" className="size-3.5" />
                          {detail.conversation.assignedTo ?? t("admin.support.unassigned")}
                        </span>
                      </div>
                    </form>

                    {cannedOpen ? (
                      <form
                        onSubmit={submitCanned}
                        className="space-y-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3"
                      >
                        <p className="text-xs font-semibold text-foreground">{t("admin.support.newCanned")}</p>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <input
                            type="text"
                            value={cannedTitle}
                            maxLength={80}
                            onChange={(event) => setCannedTitle(event.target.value)}
                            placeholder={t("admin.support.cannedTitle")}
                            aria-label={t("admin.support.cannedTitle")}
                            className={cn(fieldClass, "h-9 text-xs")}
                          />
                          <select
                            value={cannedLocale}
                            onChange={(event) => setCannedLocale(event.target.value as SupportLocale)}
                            aria-label={t("admin.support.cannedLocale")}
                            className={cn(fieldClass, "h-9 text-xs")}
                          >
                            <option value="bn">বাংলা</option>
                            <option value="en">English</option>
                          </select>
                        </div>
                        <textarea
                          value={cannedBody}
                          rows={2}
                          maxLength={1000}
                          onChange={(event) => setCannedBody(event.target.value)}
                          placeholder={t("admin.support.cannedBody")}
                          aria-label={t("admin.support.cannedBody")}
                          className={cn(fieldClass, "h-auto resize-none py-2 text-xs")}
                        />
                        <button
                          type="submit"
                          disabled={busy || cannedTitle.trim().length < 2 || !cannedBody.trim()}
                          className={cn(secondaryButtonClass, "h-8 text-xs")}
                        >
                          {t("admin.support.cannedCreate")}
                        </button>
                      </form>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("admin.support.readOnly")}</p>
                )}
              </div>
            ) : null}
          </Panel>
        ) : (
          <Panel className="flex min-h-[24rem] items-center justify-center text-center">
            <div>
              <MessageSquare aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">
                {t("admin.support.selectTitle")}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {t("admin.support.selectBody")}
              </p>
            </div>
          </Panel>
        )}
      </div>
    </AdminShell>
  );
}
