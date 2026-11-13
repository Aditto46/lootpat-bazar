import { ArrowLeft, CircleCheck, Loader2, ShieldCheck, Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageLoading } from "../components/auth/AuthShell";
import { Eyebrow } from "../components/common/SectionHeading";
import { ApiError } from "../lib/api";
import {
  completeSandboxPayment,
  fetchSandboxSession,
  type SandboxSessionInfo,
} from "../lib/checkout";
import { formatDateTime, formatTaka, useI18n, type DictKey } from "../lib/i18n";
import { Link, useRouter } from "../lib/router";
import { cn } from "@/lib/utils";

type PageState = "loading" | "ready" | "missing" | "error";

const PROVIDER_KEYS: Record<SandboxSessionInfo["provider"], DictKey> = {
  bkash: "checkout.bkash",
  nagad: "checkout.nagad",
  sslcommerz: "checkout.card",
};

export function PayPage({ orderNumber }: { orderNumber: string }) {
  const { t, lang } = useI18n();
  const { search, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const sessionId = params.get("session") ?? "";
  const token = params.get("token") ?? "";

  const [state, setState] = useState<PageState>("loading");
  const [session, setSession] = useState<SandboxSessionInfo | null>(null);
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || !token) {
      setState("missing");
      return;
    }
    let active = true;
    setState("loading");
    fetchSandboxSession(sessionId, token)
      .then((result) => {
        if (!active) return;
        setSession(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof ApiError && error.status === 404 ? "missing" : "error",
        );
      });
    return () => {
      active = false;
    };
  }, [sessionId, token]);

  async function finish(outcome: "success" | "failure") {
    if (!session || busy) return;
    setBusy(outcome === "success" ? "pay" : "cancel");
    setMessage(null);
    try {
      const result = await completeSandboxPayment(sessionId, token, outcome);
      navigate(result.redirectUrl, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "payment_session_expired") {
        setSession((current) => (current ? { ...current, status: "expired" } : current));
        setMessage(t("pay.expiredBody"));
      } else if (error instanceof ApiError && error.code === "rate_limited") {
        setMessage(t("checkout.errorRate"));
      } else {
        setMessage(t("pay.errorGeneric"));
      }
      setBusy(null);
    }
  }

  if (state === "loading") return <PageLoading label={t("pay.loading")} />;

  if (state === "missing" || state === "error" || !session) {
    return (
      <section className="container-page pt-8 pb-20 sm:pt-12">
        <div className="mx-auto max-w-xl">
          <Eyebrow>{t("pay.eyebrow")}</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("pay.notFound")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {state === "error" ? t("checkout.errorNetwork") : t("pay.notFoundBody")}
          </p>
          <Link
            to={`/order/${encodeURIComponent(orderNumber)}`}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full border border-[var(--site-border)] px-5 text-sm font-semibold text-foreground transition hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("pay.backToOrder")}
          </Link>
        </div>
      </section>
    );
  }

  const closed = session.status !== "pending";
  const expired = session.status === "expired";
  const alreadyPaid = session.status === "paid" || session.paymentStatus === "paid";

  return (
    <section className="container-page pt-8 pb-20 sm:pt-12">
      <div className="mx-auto max-w-xl">
        <Eyebrow>{t("pay.eyebrow")}</Eyebrow>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("pay.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("pay.body", { provider: t(PROVIDER_KEYS[session.provider]) })}
        </p>

        <div className="glass mt-6 rounded-[var(--radius-card)] p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] px-3 py-1.5 text-xs font-semibold text-foreground">
              <Smartphone aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />
              {t(PROVIDER_KEYS[session.provider])}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--brand-gold)_16%,transparent)] px-3 py-1.5 text-[0.65rem] font-semibold text-[var(--brand-gold)]">
              {t("pay.sandboxBadge")}
            </span>
          </div>

          <dl className="mt-5 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("pay.order")}</dt>
              <dd className="font-mono text-xs font-semibold tracking-wide text-foreground">
                {session.orderNumber}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--site-border)] pt-2.5">
              <dt className="text-muted-foreground">{t("pay.amount")}</dt>
              <dd className="font-heading text-2xl font-bold text-foreground">
                {formatTaka(session.amountPaisa / 100, lang)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("pay.expires")}</dt>
              <dd className="text-xs text-foreground">
                {formatDateTime(session.expiresAt, lang)}
              </dd>
            </div>
          </dl>

          {alreadyPaid ? (
            <p className="mt-5 flex items-start gap-2 rounded-xl bg-[color-mix(in_srgb,var(--brand-teal)_12%,transparent)] px-3.5 py-3 text-sm font-semibold text-foreground">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--brand-teal)]" />
              {t("order.paymentPaid")}
            </p>
          ) : closed ? (
            <p role="alert" className="mt-5 rounded-xl bg-[var(--surface-sunken)] px-3.5 py-3 text-sm text-muted-foreground">
              {expired ? t("pay.expiredBody") : t("pay.closedBody")}
            </p>
          ) : (
            <div className="mt-5 space-y-2.5">
              <button
                type="button"
                onClick={() => void finish("success")}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === "pay" ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck aria-hidden="true" className="size-4" />
                )}
                {busy === "pay"
                  ? t("pay.processing")
                  : t("pay.payCta", { amount: formatTaka(session.amountPaisa / 100, lang) })}
              </button>
              <button
                type="button"
                onClick={() => void finish("failure")}
                disabled={busy !== null}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-full border border-[var(--site-border)] px-5 py-3 text-sm font-semibold text-foreground transition hover:border-[var(--danger-ink)] hover:text-[var(--danger-ink)]",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {busy === "cancel" ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <X aria-hidden="true" className="size-4" />
                )}
                {t("pay.declineCta")}
              </button>
            </div>
          )}

          {message ? (
            <p role="alert" className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger-ink)_10%,transparent)] px-3.5 py-2.5 text-xs text-[var(--danger-ink)]">
              {message}
            </p>
          ) : null}

          <p className="mt-4 text-center text-[0.7rem] leading-relaxed text-muted-foreground">
            {t("pay.secure")}
          </p>
        </div>

        <Link
          to={`/order/${encodeURIComponent(orderNumber)}`}
          className="mt-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("pay.backToOrder")}
        </Link>
      </div>
    </section>
  );
}
