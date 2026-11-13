import { Clock, Headset, MessageCircle, Phone, Send, UserRound, X, RefreshCw } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { fieldClass, labelClass, primaryButtonClass } from "../auth/AuthShell";
import { useCheckoutConfig } from "../../lib/checkout";
import { formatDateTime, useI18n, type DictKey } from "../../lib/i18n";
import {
  SUPPORT_PHONE,
  SUPPORT_WHATSAPP,
  isConversationClosed,
  isRateLimited,
  loadSupportFaq,
  loadSupportSession,
  requestSupportHandoff,
  sendSupportMessage,
  startSupportChat,
  type SupportConversation,
  type SupportFaq,
  type SupportLocale,
  type SupportMessage,
} from "../../lib/support";
import { cn } from "@/lib/utils";

const TOKEN_KEY = "lp-support-token";
const POLL_MS = 12000;

function readStoredToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_KEY);
    return value && /^[A-Za-z0-9_-]{20,120}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function persistToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage can be unavailable in private mode */
  }
}

function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

function officeOpenNow(now: Date): boolean {
  if (now.getDay() === 5) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 10 * 60 && minutes < 20 * 60;
}

function authorLabelKey(authorType: SupportMessage["authorType"]): DictKey {
  if (authorType === "assistant") return "chat.assistant";
  if (authorType === "staff") return "chat.agent";
  if (authorType === "system") return "chat.system";
  return "chat.you";
}

export function ChatWidget() {
  const { t, lang } = useI18n();
  const locale: SupportLocale = lang === "bn" ? "bn" : "en";
  const { config } = useCheckoutConfig();
  const supportPhone = config?.store.phone || SUPPORT_PHONE;
  const supportWhatsapp = supportPhone
    ? `https://wa.me/${supportPhone.replace(/[^0-9]/g, "")}`
    : SUPPORT_WHATSAPP;

  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [faqs, setFaqs] = useState<SupportFaq[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);

  const officeOpen = useMemo(() => officeOpenNow(new Date()), [open, conversation?.status]);
  const status = conversation?.status ?? null;
  const closed = status === "resolved";
  const canWrite = !!conversation && !closed;

  useEffect(() => {
    if (!token) {
      setConversation(null);
      setMessages([]);
      return;
    }
    let active = true;
    setRestoring(true);
    loadSupportSession(token)
      .then((session) => {
        if (!active) return;
        setConversation(session.conversation);
        setMessages(session.messages);
      })
      .catch(() => {
        if (!active) return;
        clearToken();
        setToken(null);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadSupportFaq(locale)
      .then((result) => {
        if (active) setFaqs(result.faqs.slice(0, 4));
      })
      .catch(() => {
        if (active) setFaqs([]);
      });
    return () => {
      active = false;
    };
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    if (conversation) {
      composerRef.current?.focus();
    } else if (!restoring) {
      nameRef.current?.focus();
    }
  }, [open, conversation, restoring]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, open]);

  useEffect(() => {
    if (!open || !token || !conversation) return;
    if (conversation.status !== "waiting" && conversation.status !== "open") return;
    if (typeof window === "undefined") return;

    let active = true;
    const id = window.setInterval(() => {
      if (!active || document.hidden) return;
      loadSupportSession(token)
        .then((session) => {
          if (!active) return;
          setConversation(session.conversation);
          setMessages(session.messages);
        })
        .catch(() => {
          /* transient poll failures keep the current thread */
        });
    }, POLL_MS);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [open, token, conversation?.status]);

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (starting) return;
    const question = draft.trim();
    if (!question) {
      setError(t("chat.startError"));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const result = await startSupportChat({
        message: question,
        locale,
        ...(name.trim().length >= 2 ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(orderNumber.trim() ? { orderNumber: orderNumber.trim().toUpperCase() } : {}),
      });
      persistToken(result.token);
      setToken(result.token);
      setConversation(result.conversation);
      setMessages(result.messages);
      setQuickReplies(result.quickReplies);
      setDraft("");
      setError(null);
    } catch (cause) {
      setError(isRateLimited(cause) ? t("chat.rateLimited") : t("chat.startError"));
    } finally {
      setStarting(false);
    }
  }

  async function sendMessage(text: string) {
    const body = text.trim();
    if (!token || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendSupportMessage(token, body, locale);
      setConversation(result.conversation);
      setMessages(result.messages);
      setQuickReplies(result.reply.quickReplies);
      setMessage("");
    } catch (cause) {
      if (isConversationClosed(cause)) {
        setConversation((current) => (current ? { ...current, status: "resolved" } : current));
        setQuickReplies([]);
      } else if (isRateLimited(cause)) {
        setError(t("chat.rateLimited"));
      } else {
        setError(t("chat.error"));
      }
    } finally {
      setSending(false);
    }
  }

  async function handleHandoff() {
    if (!token || handoffBusy) return;
    setHandoffBusy(true);
    setError(null);
    try {
      const result = await requestSupportHandoff(token);
      setConversation(result.conversation);
      setMessages(result.messages);
      setQuickReplies([]);
    } catch (cause) {
      setError(isRateLimited(cause) ? t("chat.rateLimited") : t("chat.error"));
    } finally {
      setHandoffBusy(false);
    }
  }

  function startNewChat() {
    clearToken();
    setToken(null);
    setConversation(null);
    setMessages([]);
    setQuickReplies([]);
    setDraft("");
    setMessage("");
    setError(null);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <>
      {open ? (
        <section
          role="dialog"
          aria-labelledby="support-chat-title"
          onKeyDown={handlePanelKeyDown}
          className="glass fixed inset-x-3 bottom-20 z-50 flex h-[min(34rem,calc(100dvh-7rem))] flex-col overflow-hidden rounded-3xl border border-[var(--site-border)] shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[34rem] sm:w-[23rem]"
        >
          <header className="flex items-center gap-3 border-b border-[var(--site-border)] bg-[var(--surface-raised)] px-4 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--site-accent)_16%,transparent)] text-[var(--accent-ink)]">
              <Headset aria-hidden="true" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="support-chat-title" className="truncate text-sm font-semibold text-foreground">
                {t("chat.title")}
              </h2>
              <p className="truncate text-[0.68rem] text-muted-foreground">
                {status ? t(`chat.status.${status}` as DictKey) : t("chat.subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("chat.closeLabel")}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--surface-sunken)] hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </header>

          {restoring ? (
            <div className="flex-1 space-y-3 p-4" aria-busy="true">
              <div className="h-16 animate-pulse rounded-2xl bg-[var(--surface-sunken)]" />
              <div className="ml-auto h-12 w-3/4 animate-pulse rounded-2xl bg-[var(--surface-sunken)]" />
              <div className="h-20 animate-pulse rounded-2xl bg-[var(--surface-sunken)]" />
            </div>
          ) : conversation ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                ref={listRef}
                data-lenis-prevent
                aria-live="polite"
                className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-4"
              >
                {messages.map((entry) => {
                  const mine = entry.authorType === "customer";
                  const system = entry.authorType === "system";
                  if (system) {
                    return (
                      <p
                        key={entry.id}
                        className="mx-auto max-w-[85%] rounded-full border border-[var(--site-border)] px-3 py-1 text-center text-[0.65rem] text-muted-foreground"
                      >
                        {entry.body}
                      </p>
                    );
                  }
                  return (
                    <div key={entry.id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                      <p className="px-1 text-[0.62rem] text-muted-foreground">
                        {entry.authorType === "staff" && entry.authorName
                          ? entry.authorName
                          : t(authorLabelKey(entry.authorType))}
                        <span aria-hidden="true"> · </span>
                        {formatDateTime(entry.createdAt, lang)}
                      </p>
                      <p
                        className={cn(
                          "max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                          mine
                            ? "rounded-br-md bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                            : "rounded-bl-md border border-[var(--site-border)] bg-[var(--surface-sunken)] text-foreground",
                          entry.authorType === "staff" &&
                            "border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)]",
                        )}
                      >
                        {entry.body}
                      </p>
                    </div>
                  );
                })}
              </div>

              {closed ? (
                <div className="space-y-3 border-t border-[var(--site-border)] p-4">
                  <p className="text-sm text-muted-foreground">{t("chat.closedBody")}</p>
                  <button type="button" onClick={startNewChat} className={cn(primaryButtonClass, "h-10")}>
                    {t("chat.newChat")}
                  </button>
                </div>
              ) : (
                <div className="border-t border-[var(--site-border)] p-3">
                  {status === "bot" && quickReplies.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {quickReplies.map((reply) => (
                        <button
                          key={reply}
                          type="button"
                          disabled={sending}
                          onClick={() => void sendMessage(reply)}
                          className="rounded-full border border-[var(--site-border)] px-2.5 py-1 text-[0.7rem] text-muted-foreground transition hover:border-[var(--accent-ink)] hover:text-foreground disabled:opacity-60"
                        >
                          {reply}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {status === "waiting" ? (
                    <p className="mb-2 rounded-lg border border-[color-mix(in_srgb,var(--brand-gold)_40%,transparent)] px-2.5 py-1.5 text-[0.68rem] leading-relaxed text-[var(--brand-gold)]">
                      {t("chat.handoffQueued")}
                    </p>
                  ) : null}

                  {error ? (
                    <p role="alert" className="mb-2 text-[0.7rem] text-[var(--danger-ink)]">
                      {error}
                    </p>
                  ) : null}

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendMessage(message);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      ref={composerRef}
                      type="text"
                      value={message}
                      maxLength={1000}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder={t("chat.placeholder")}
                      aria-label={t("chat.message")}
                      disabled={sending || !canWrite}
                      className={cn(fieldClass, "h-10 flex-1")}
                    />
                    <button
                      type="submit"
                      disabled={sending || !message.trim() || !canWrite}
                      aria-label={t("chat.send")}
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--site-accent)] text-[var(--site-on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending ? (
                        <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
                      ) : (
                        <Send aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </form>

                  {status === "bot" ? (
                    <button
                      type="button"
                      onClick={() => void handleHandoff()}
                      disabled={handoffBusy}
                      className="mt-2 inline-flex items-center gap-1.5 text-[0.7rem] font-semibold text-[var(--accent-ink)] transition hover:underline disabled:opacity-60"
                    >
                      <UserRound aria-hidden="true" className="size-3.5" />
                      {handoffBusy ? t("chat.sending") : t("chat.handoff")}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleStart} className="flex min-h-0 flex-1 flex-col">
              <div
                data-lenis-prevent
                className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-4"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{t("chat.introTitle")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("chat.introBody")}
                  </p>
                </div>

                {faqs.length > 0 ? (
                  <div>
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("chat.faqTitle")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {faqs.map((faq) => (
                        <button
                          key={faq.id}
                          type="button"
                          onClick={() => setDraft(faq.question)}
                          className="rounded-full border border-[var(--site-border)] px-2.5 py-1 text-left text-[0.7rem] text-muted-foreground transition hover:border-[var(--accent-ink)] hover:text-foreground"
                        >
                          {faq.question}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="support-name" className={cn(labelClass, "text-xs")}>
                      {t("chat.name")}
                    </label>
                    <input
                      ref={nameRef}
                      id="support-name"
                      type="text"
                      value={name}
                      maxLength={80}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("chat.namePlaceholder")}
                      className={cn(fieldClass, "h-10")}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="support-phone" className={cn(labelClass, "text-xs")}>
                      {t("chat.phone")}
                    </label>
                    <input
                      id="support-phone"
                      type="tel"
                      value={phone}
                      maxLength={20}
                      dir="ltr"
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder={t("chat.phonePlaceholder")}
                      className={cn(fieldClass, "h-10")}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="support-order" className={cn(labelClass, "text-xs")}>
                    {t("chat.order")}
                  </label>
                  <input
                    id="support-order"
                    type="text"
                    value={orderNumber}
                    maxLength={30}
                    dir="ltr"
                    onChange={(event) => setOrderNumber(event.target.value)}
                    placeholder={t("chat.orderPlaceholder")}
                    className={cn(fieldClass, "h-10 font-mono")}
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="support-message" className={cn(labelClass, "text-xs")}>
                    {t("chat.message")}
                  </label>
                  <textarea
                    id="support-message"
                    value={draft}
                    rows={3}
                    maxLength={1000}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t("chat.messagePlaceholder")}
                    className={cn(fieldClass, "h-auto resize-none py-2.5")}
                  />
                </div>

                {error ? (
                  <p role="alert" className="text-[0.7rem] text-[var(--danger-ink)]">
                    {error}
                  </p>
                ) : null}

                <p className="text-[0.65rem] leading-relaxed text-muted-foreground">
                  {t("chat.privacy")} {t("chat.loginNote")}
                </p>
              </div>

              <div className="border-t border-[var(--site-border)] p-3">
                <button
                  type="submit"
                  disabled={starting || !draft.trim()}
                  className={cn(primaryButtonClass, "h-10")}
                >
                  {starting ? (
                    <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Send aria-hidden="true" className="size-4" />
                  )}
                  {starting ? t("chat.starting") : t("chat.start")}
                </button>
              </div>
            </form>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--site-border)] bg-[var(--surface-raised)] px-4 py-2 text-[0.64rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock aria-hidden="true" className="size-3" />
              {officeOpen ? t("chat.officeOpen") : t("chat.officeClosed")}
            </span>
            <span className="flex items-center gap-3">
              <a
                href={supportWhatsapp}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 transition hover:text-foreground"
              >
                <MessageCircle aria-hidden="true" className="size-3" />
                {t("chat.whatsapp")}
              </a>
              <a
                href={`tel:${supportPhone}`}
                className="inline-flex items-center gap-1 transition hover:text-foreground"
              >
                <Phone aria-hidden="true" className="size-3" />
                {t("chat.call")}
              </a>
            </span>
          </footer>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? t("chat.closeLabel") : t("chat.openLabel")}
        aria-expanded={open}
        className="fixed bottom-5 right-4 z-50 inline-flex h-12 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--site-accent)_55%,transparent)] bg-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--site-on-accent)] shadow-[0_14px_40px_-12px_color-mix(in_srgb,var(--site-accent)_70%,transparent)] transition hover:brightness-110 sm:right-6"
      >
        {open ? (
          <X aria-hidden="true" className="size-4.5" />
        ) : (
          <Headset aria-hidden="true" className="size-4.5" />
        )}
        <span className="max-sm:sr-only">{t("chat.bubble")}</span>
      </button>
    </>
  );
}
