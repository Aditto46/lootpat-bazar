import { ArrowRight, RotateCcw } from "lucide-react";
import { useCatalog } from "../../lib/catalog";
import { useI18n } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { SectionHeading } from "../common/SectionHeading";
import { ProductCard } from "./ProductCard";

export function FeaturedProducts() {
  const { t } = useI18n();
  const { products, status, error, reload } = useCatalog();

  const featured = products.filter((product) => product.featured);
  const list = (featured.length > 0 ? featured : products).slice(0, 8);
  const loading = status === "loading" && products.length === 0;

  return (
    <section id="featured" className="container-page pb-16 sm:pb-24">
      <SectionHeading
        eyebrow={t("featured.eyebrow")}
        title={t("featured.title")}
        body={t("featured.body")}
        action={
          <Link
            to="/shop"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--site-border)] px-5 text-sm font-semibold text-foreground transition hover:border-[var(--site-accent)]"
          >
            {t("actions.viewAll")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        }
      />

      {status === "error" && products.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-12 text-center">
          <p className="font-heading text-base font-semibold text-foreground">{t("shop.error")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("shop.errorBody")}</p>
          <p className="text-[0.7rem] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-1 inline-flex h-10 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)]"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {t("shop.retry")}
          </button>
        </div>
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              aria-hidden="true"
              className="glass overflow-hidden rounded-[var(--radius-card)]"
            >
              <div className="p-3 pb-0">
                <div className="aspect-square animate-pulse rounded-[calc(var(--radius-card)-0.35rem)] bg-[var(--surface-sunken)]" />
              </div>
              <div className="space-y-2 p-4">
                <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
                <div className="h-4 w-4/5 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
                <div className="h-9 w-full animate-pulse rounded-full bg-[var(--surface-sunken)]" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((product, index) => (
            <li key={product.id} className="h-full">
              <ProductCard product={product} index={index} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-center text-[0.7rem] text-muted-foreground">{t("featured.note")}</p>
    </section>
  );
}
