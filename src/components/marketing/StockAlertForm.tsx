import { BellRing, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "../../lib/i18n";
import { marketingErrorKey, requestStockAlert } from "../../lib/marketing";

export function StockAlertForm({ productId }: { productId: string }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="mt-2 rounded-xl border border-[color-mix(in_srgb,var(--site-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--site-accent)_8%,transparent)] px-3 py-2.5 text-xs font-medium text-[var(--accent-ink)]">
        {t("stockAlert.saved")}
      </p>
    );
  }

  return (
    <form
      className="mt-3 rounded-2xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          const response = await requestStockAlert(productId, phone.trim());
          toast.success(t(response.available ? "stockAlert.available" : "stockAlert.saved"));
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
        {t("stockAlert.title")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("stockAlert.body")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("stockAlert.phone")}</span>
          <input
            required
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="01XXXXXXXXX"
            className="h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--site-on-accent)] disabled:opacity-60"
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {t("stockAlert.submit")}
        </button>
      </div>
    </form>
  );
}
