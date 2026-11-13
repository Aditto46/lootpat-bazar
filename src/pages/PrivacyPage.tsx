import { FileText, Mail, ShieldCheck } from "lucide-react";
import { Eyebrow } from "../components/common/SectionHeading";
import { useCheckoutConfig } from "../lib/checkout";
import { Link } from "../lib/router";
import { useI18n, type DictKey } from "../lib/i18n";

type Section = { id: string; heading: DictKey; paragraphs: DictKey[] };

const SECTIONS: Section[] = [
  { id: "collect", heading: "privacy.collectTitle", paragraphs: ["privacy.collectBody"] },
  { id: "use", heading: "privacy.useTitle", paragraphs: ["privacy.useBody"] },
  { id: "payment", heading: "privacy.paymentTitle", paragraphs: ["privacy.paymentBody"] },
  { id: "cookies", heading: "privacy.cookiesTitle", paragraphs: ["privacy.cookiesBody"] },
  { id: "share", heading: "privacy.shareTitle", paragraphs: ["privacy.shareBody"] },
  { id: "retention", heading: "privacy.retentionTitle", paragraphs: ["privacy.retentionBody"] },
  { id: "rights", heading: "privacy.rightsTitle", paragraphs: ["privacy.rightsBody"] },
  { id: "security", heading: "privacy.securityTitle", paragraphs: ["privacy.securityBody"] },
];

export function PrivacyPage() {
  const { t } = useI18n();
  const { config } = useCheckoutConfig();
  const storeEmail = config?.store.email || "adittoo2026@gmail.com";

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <div className="max-w-2xl">
        <Eyebrow>{t("privacy.eyebrow")}</Eyebrow>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("privacy.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("privacy.body")}
        </p>
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText aria-hidden="true" className="size-3.5" />
          {t("privacy.updated")}
        </p>
      </div>

      <div className="mt-9 grid items-start gap-6 lg:grid-cols-[0.7fr_1.3fr]">
        <nav aria-label={t("privacy.title")} className="glass rounded-[var(--radius-card)] p-5">
          <ol className="space-y-2 text-sm">
            {SECTIONS.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex gap-2 text-muted-foreground transition hover:text-foreground"
                >
                  <span className="tabular-nums text-[var(--accent-ink)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {t(section.heading)}
                </a>
              </li>
            ))}
            <li>
              <a
                href="/#support"
                className="inline-flex gap-2 text-muted-foreground transition hover:text-foreground"
              >
                <Mail aria-hidden="true" className="mt-0.5 size-4" />
                {t("privacy.contactTitle")}
              </a>
            </li>
          </ol>
        </nav>

        <div className="glass rounded-[var(--radius-card)] p-5 sm:p-8">
          <div className="space-y-7">
            {SECTIONS.map((section, index) => (
              <article key={section.id} id={section.id} className="scroll-mt-28">
                <h2 className="flex items-baseline gap-2 text-base font-semibold text-foreground">
                  <span className="font-mono text-xs text-[var(--accent-ink)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {t(section.heading)}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-2 text-sm leading-relaxed text-muted-foreground"
                  >
                    {t(paragraph)}
                  </p>
                ))}
              </article>
            ))}
          </div>

          <div className="mt-8 border-t border-[var(--site-border)] pt-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ShieldCheck aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
              {t("privacy.contactTitle")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("privacy.contactBody")}
            </p>
            <a
              href={`mailto:${storeEmail}`}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[var(--accent-ink)] hover:underline"
            >
              <Mail aria-hidden="true" className="size-4" />
              {storeEmail}
            </a>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            {t("privacy.accountHint")}{" "}
            <Link to="/account" className="font-medium text-[var(--accent-ink)] hover:underline">
              {t("privacy.accountLink")}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
