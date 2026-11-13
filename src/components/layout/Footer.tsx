import { Clock, Mail, MapPin, Phone, ShieldCheck, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCheckoutConfig } from "../../lib/checkout";
import { useI18n } from "../../lib/i18n";
import { marketingErrorKey, unsubscribeAll } from "../../lib/marketing";
import { Link } from "../../lib/router";
import { Logo } from "../common/Logo";

const shopLinks = [
  { key: "nav.home", href: "/#top" },
  { key: "nav.categories", href: "/#categories" },
  { key: "nav.deals", href: "/#deals" },
  { key: "featured.title", href: "/#featured" },
] as const;

const paymentMethods = [
  { label: "bKash", color: "#E2136E" },
  { label: "Nagad", color: "#F58220" },
  { label: "SSLCommerz", color: "#2F6FED" },
  { label: "COD", color: "#00F5D4" },
];

function UnsubscribeLink() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-xs font-medium text-[var(--accent-ink)] hover:underline"
      >
        {t("footer.unsubscribe")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="font-heading text-lg font-bold">
            {t("footer.unsubscribeTitle")}
          </DialogTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("footer.unsubscribeBody")}
          </p>
          <form
            className="mt-2 space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await unsubscribeAll(contact.trim());
                toast.success(t("footer.unsubscribeDone"));
                setOpen(false);
                setContact("");
              } catch (cause) {
                toast.error(t(marketingErrorKey(cause)));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block text-xs font-medium text-muted-foreground">
              {t("footer.unsubscribeContact")}
              <input
                required
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--site-on-accent)] disabled:opacity-60"
            >
              {t("footer.unsubscribeSubmit")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Footer() {
  const { t, lang } = useI18n();
  const { config } = useCheckoutConfig();
  const year = new Date().getFullYear();
  const storeEmail = config?.store.email || "adittoo2026@gmail.com";
  const storePhone = config?.store.phone ?? "";
  const storePaymentNumber = config?.store.paymentNumber ?? "";
  const storeAddress = config?.store.address[lang] ?? "ঢাকা, বাংলাদেশ";

  return (
    <footer className="relative mt-8 overflow-hidden border-t border-[var(--site-border)]">
      <div className="container-page relative z-10 pt-14 pb-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.4fr_0.7fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("footer.tagline")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {paymentMethods.map((method) => (
                <span
                  key={method.label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-border)] px-2.5 py-1 text-[0.68rem] font-semibold text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: method.color }}
                  />
                  {method.label}
                </span>
              ))}
            </div>
          </div>

          <nav aria-labelledby="footer-shop">
            <h2 id="footer-shop" className="text-sm font-semibold text-foreground">
              {t("footer.shop")}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {shopLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-muted-foreground transition hover:text-foreground"
                  >
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div id="support">
            <h2 className="text-sm font-semibold text-foreground">{t("footer.help")}</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2.5">
                <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" />
                <span>{t("footer.hours")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]"
                />
                <span>{t("trust.return")}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" />
                <span>{storeAddress}</span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("footer.contact")}</h2>
            <a
              href={`mailto:${storeEmail}`}
              className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
            >
              <Mail aria-hidden="true" className="size-4" />
              {storeEmail}
            </a>
            {storePhone ? (
              <a
                href={`tel:${storePhone.replace(/\s/g, "")}`}
                dir="ltr"
                className="mt-2 flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
              >
                <Phone aria-hidden="true" className="size-4" />
                {storePhone}
              </a>
            ) : null}
            {storePaymentNumber ? (
              <p
                dir="ltr"
                className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Wallet aria-hidden="true" className="size-4 shrink-0" />
                {t("footer.paymentNumber", { number: storePaymentNumber })}
              </p>
            ) : null}
            <UnsubscribeLink />
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-[var(--site-border)] pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} লুটপাট বাজার · {t("footer.rights")}
          </p>
          <p>{t("footer.madeIn")}</p>
          <Link to="/privacy" className="transition hover:text-foreground">
            {t("footer.privacy")}
          </Link>
        </div>
      </div>

      <p
        aria-hidden="true"
        className="pointer-events-none relative z-0 -mb-[0.12em] select-none whitespace-nowrap text-center text-[12vw] font-black leading-[0.82] tracking-tighter text-transparent opacity-70 [-webkit-text-stroke:1px_var(--site-border)]"
      >
        লুটপাট বাজার
      </p>
    </footer>
  );
}
