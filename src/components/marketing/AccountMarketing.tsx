import { Cake, Gift, Loader2, Sparkles, Ticket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, formatNumber, formatTaka, useI18n } from "../../lib/i18n";
import {
  getLoyalty,
  getProfile,
  marketingErrorKey,
  redeemLoyalty,
  updateProfile,
  type CustomerProfile,
  type Loyalty,
} from "../../lib/marketing";

function reasonLabel(reason: string): { key: "loyalty.reason.order_delivered" | "loyalty.reason.review_reward" | "loyalty.reason.loyalty_redeem"; } {
  if (reason === "review_reward") return { key: "loyalty.reason.review_reward" };
  if (reason === "loyalty_redeem") return { key: "loyalty.reason.loyalty_redeem" };
  return { key: "loyalty.reason.order_delivered" };
}

export function LoyaltyCard() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Loyalty | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState(100);
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState<{ code: string; value: number; expiresAt: string } | null>(null);

  useEffect(() => {
    getLoyalty()
      .then((response) => {
        setData(response);
        setPoints(Math.max(response.earn.redeemMinPoints, 100));
      })
      .catch(() => setError(true));
  }, []);

  const redeemable = useMemo(() => {
    if (!data) return false;
    return data.enabled && data.balance >= data.earn.redeemMinPoints;
  }, [data]);

  if (error) return null;
  if (!data) {
    return (
      <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6" aria-busy="true">
        <div className="h-5 w-32 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
        <div className="mt-4 h-20 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
      </section>
    );
  }

  const redeem = async () => {
    setBusy(true);
    try {
      const response = await redeemLoyalty(points);
      setCoupon({ code: response.coupon.code, value: response.coupon.value, expiresAt: response.coupon.expiresAt });
      setData((current) => (current ? { ...current, balance: response.balance } : current));
      toast.success(t("loyalty.redeemed"));
      setOpen(false);
    } catch (cause) {
      toast.error(t(marketingErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Sparkles aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
          {t("loyalty.title")}
        </h2>
        <span className="rounded-full border border-[var(--site-border)] px-2.5 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
          {formatNumber(data.balance, lang)} {t("loyalty.points")}
        </span>
      </div>

      {!data.enabled ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("loyalty.disabled")}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3">
              <p className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                {t("loyalty.balance")}
              </p>
              <p className="mt-1 font-heading text-2xl font-bold text-foreground">
                {formatNumber(data.balance, lang)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3">
              <p className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                {t("loyalty.value")}
              </p>
              <p className="mt-1 font-heading text-2xl font-bold text-foreground">
                {formatTaka(data.valuePaisa / 100, lang)}
              </p>
            </div>
          </div>

          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            <li>{t("loyalty.earn", { points: formatNumber(data.earn.pointsPer100Taka, lang) })}</li>
            <li>{t("loyalty.reviewPoints", { points: formatNumber(data.earn.reviewPoints, lang) })}</li>
            <li>{t("loyalty.redeemMin", { points: formatNumber(data.earn.redeemMinPoints, lang) })}</li>
          </ul>

          {data.birthday ? (
            <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-gold)_8%,transparent)] p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-gold)]">
                <Cake aria-hidden="true" className="size-3.5" />
                {t("loyalty.birthday")}
              </p>
              <p className="mt-1 text-xs text-foreground">
                {t("loyalty.birthdayBody", { code: data.birthday.code })}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[0.68rem] leading-relaxed text-muted-foreground">
              {t("loyalty.birthdayHint")}
            </p>
          )}

          {coupon ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-raised)] p-3">
              <Ticket aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
              <code className="font-mono text-sm font-bold tracking-wider text-foreground">
                {coupon.code}
              </code>
              <span className="text-xs text-muted-foreground">
                {formatTaka(coupon.value / 100, lang)} · {formatDateTime(coupon.expiresAt, lang)}
              </span>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!redeemable}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--accent-ink)] disabled:border-[var(--site-border)] disabled:text-muted-foreground"
          >
            <Gift aria-hidden="true" className="size-4" />
            {t("loyalty.redeem")}
          </button>

          <div className="mt-5 border-t border-[var(--site-border)] pt-4">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("loyalty.ledger")}
            </p>
            {data.ledger.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("loyalty.emptyLedger")}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {data.ledger.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">
                      {t(reasonLabel(entry.reason).key)}
                      {entry.orderNumber ? ` · ${entry.orderNumber}` : ""}
                    </span>
                    <span
                      className={
                        entry.points >= 0 ? "font-semibold text-[var(--accent-ink)]" : "font-semibold text-[var(--brand-rose)]"
                      }
                    >
                      {entry.points >= 0 ? "+" : ""}
                      {formatNumber(entry.points, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="font-heading text-lg font-bold">{t("loyalty.redeemTitle")}</DialogTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("loyalty.redeemBody")}</p>
          <label className="mt-2 block text-xs font-medium text-muted-foreground">
            {t("loyalty.points")}
            <input
              type="number"
              min={data.earn.redeemMinPoints}
              max={data.balance}
              step={100}
              value={points}
              onChange={(event) => setPoints(Number(event.target.value))}
              className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
            />
          </label>
          <button
            type="button"
            onClick={() => void redeem()}
            disabled={busy || points % 100 !== 0 || points > data.balance || points < data.earn.redeemMinPoints}
            className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--site-on-accent)] disabled:opacity-60"
          >
            {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t("loyalty.redeemSubmit")}
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ProfileCard() {
  const { t } = useI18n();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProfile()
      .then((response) => {
        setProfile(response.profile);
        setName(response.profile.name);
        setBirthDate(response.profile.birthDate ?? "");
      })
      .catch(() => setProfile(null));
  }, []);

  if (!profile) return null;

  return (
    <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
      <h2 className="text-base font-semibold text-foreground">{t("profile.title")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("profile.body")}</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const response = await updateProfile({
              name: name.trim(),
              birthDate: birthDate || null,
            });
            setProfile(response.profile);
            toast.success(t("profile.saved"));
          } catch (cause) {
            toast.error(t(marketingErrorKey(cause)));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="block text-xs font-medium text-muted-foreground">
          {t("profile.name")}
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          {t("profile.birthDate")}
          <input
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
          />
        </label>
        <p className="text-[0.65rem] text-muted-foreground">{t("profile.birthHint")}</p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--site-on-accent)] disabled:opacity-60"
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {busy ? t("profile.saving") : t("profile.save")}
        </button>
      </form>
    </section>
  );
}
