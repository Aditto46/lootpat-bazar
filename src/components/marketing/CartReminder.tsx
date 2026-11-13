import { BellRing, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "../../lib/i18n";
import { marketingErrorKey, remindCart } from "../../lib/marketing";

export function CartReminder({ itemCount }: { itemCount: number }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--site-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--site-accent)_8%,transparent)] p-3 text-xs font-medium text-[var(--accent-ink)]">
        {t("cart.reminderSaved")}
      </p>
    );
  }

  return (
    <form
      className="mt-6 rounded-2xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!consent) {
          toast.error(t("cart.reminderConsentRequired"));
          return;
        }
        setBusy(true);
        try {
          await remindCart(phone.trim(), Math.max(1, Math.min(50, itemCount)));
          toast.success(t("cart.reminderSaved"));
          setDone(true);
        } catch (cause) {
          toast.error(t(marketingErrorKey(cause)));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <BellRing aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
        {t("cart.reminderTitle")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("cart.reminderBody")}</p>
      <label className="mt-2.5 block">
        <span className="sr-only">{t("cart.reminderPhone")}</span>
        <input
          required
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="01XXXXXXXXX"
          className="h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
        />
      </label>
      <label className="mt-2 flex items-start gap-2 text-[0.68rem] leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-3.5 accent-[var(--site-accent)]"
        />
        {t("cart.reminderConsent")}
      </label>
      <button
        type="submit"
        disabled={busy}
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--site-border)] px-4 text-sm font-semibold text-foreground transition hover:border-[var(--site-accent)] disabled:opacity-60"
      >
        {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {t("cart.reminderSubmit")}
      </button>
    </form>
  );
}
