import { Heart, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Link } from "../lib/router";
import { useCatalog } from "../lib/catalog";
import { formatNumber, useI18n } from "../lib/i18n";
import { useWishlist } from "../lib/wishlist";
import { Eyebrow } from "../components/common/SectionHeading";
import { ProductCard } from "../components/home/ProductCard";

export function WishlistPage() {
  const { t, lang } = useI18n();
  const { entries, count, clear } = useWishlist();
  const { byId, status } = useCatalog();

  const products = entries.flatMap((entry) => {
    const product = byId(entry.id);
    return product ? [product] : [];
  });
  const loading = status === "loading" && entries.length > 0;

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <Eyebrow>{t("wishlist.eyebrow")}</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("wishlist.title")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("wishlist.body")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("wishlist.count", { count: formatNumber(count, lang) })}
          </p>
        </div>
        {products.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              clear();
              toast.message(t("wishlist.cleared"));
            }}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--site-border)] px-4 text-sm font-medium text-foreground transition hover:border-[var(--brand-rose)] hover:text-[var(--brand-rose)]"
          >
            {t("wishlist.clear")}
          </button>
        ) : null}
      </div>

      <div className="mt-8">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: Math.min(entries.length, 8) }).map((_, index) => (
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
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="glass flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-16 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--brand-rose)]">
              <Heart aria-hidden="true" className="size-7" />
            </span>
            <p className="font-heading text-lg font-semibold text-foreground">
              {t("wishlist.empty")}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("wishlist.emptyBody")}</p>
            <Link
              to="/shop"
              className="mt-1 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)]"
            >
              <ShoppingBag aria-hidden="true" className="size-4" />
              {t("wishlist.emptyCta")}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product, index) => (
              <li key={product.id} className="h-full">
                <ProductCard product={product} index={index} animate={index < 12} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
