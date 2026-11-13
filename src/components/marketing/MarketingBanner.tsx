import { ArrowRight, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { getBanners, type MarketingBanner as Banner } from "../../lib/marketing";
import { Reveal } from "../common/Reveal";

export function MarketingBanner() {
  const { t, lang } = useI18n();
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getBanners(controller.signal)
      .then((response) => setBanner(response.banners[0] ?? null))
      .catch(() => setBanner(null));
    return () => controller.abort();
  }, []);

  if (!banner) return null;

  return (
    <section className="container-page pt-8" aria-label={banner.title[lang]}>
      <Reveal>
        <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--site-border)] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--brand-teal)_16%,transparent),color-mix(in_srgb,var(--brand-violet)_14%,transparent))] p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-[var(--site-border)] bg-[var(--surface-raised)] text-[var(--accent-ink)]">
              <Megaphone aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-heading text-lg font-bold text-foreground sm:text-xl">
                {banner.title[lang]}
              </p>
              {banner.body[lang] ? (
                <p className="mt-1 text-sm text-muted-foreground">{banner.body[lang]}</p>
              ) : null}
            </div>
            <Link
              to={banner.href}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-105"
            >
              {banner.cta[lang] || t("actions.viewAll")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
