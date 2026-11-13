import { Heart, Plus, ShoppingBag, Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  discountPercent,
  productAlt,
  productPrice,
  useCatalog,
  type CatalogProduct,
  type ProductBadge,
} from "../../lib/catalog";
import { useCart } from "../../lib/cart";
import { useCompare } from "../../lib/compare";
import { formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { useWishlist } from "../../lib/wishlist";
import { Reveal } from "../common/Reveal";

const badgeStyles: Record<ProductBadge, { key: DictKey; className: string }> = {
  bestseller: {
    key: "product.badge.bestseller",
    className: "bg-[var(--brand-gold)] text-[#1A1408]",
  },
  new: {
    key: "product.badge.new",
    className: "bg-[var(--brand-teal)] text-[#04120F]",
  },
  limited: {
    key: "product.badge.limited",
    className: "bg-[#FF5C7A] text-[#24070D]",
  },
};

const cardButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50";

export function ProductCard({
  product,
  index = 0,
  animate = true,
}: {
  product: CatalogProduct;
  index?: number;
  animate?: boolean;
}) {
  const { t, lang } = useI18n();
  const { categoryName, categories } = useCatalog();
  const { addItem } = useCart();
  const wishlist = useWishlist();
  const compare = useCompare();

  const price = productPrice(product);
  const compareAt = product.compareAtPaisa ? product.compareAtPaisa / 100 : null;
  const discount = discountPercent(product);
  const badge = product.badge ? badgeStyles[product.badge] : null;
  const category = categories.find((entry) => entry.id === product.categoryId);
  const lowStock = product.stock > 0 && product.stock <= product.lowStockThreshold;
  const outOfStock = product.stock <= 0;
  const wished = wishlist.has(product.id);
  const comparing = compare.has(product.id);

  const handleAdd = () => {
    if (!addItem(product.id)) return;
    toast.success(t("product.added"), {
      description: `${product.name[lang]} · ${formatTaka(price, lang)}`,
    });
  };

  const handleWishlist = () => wishlist.toggle(product);
  const handleCompare = () => compare.toggle(product);

  const content = (
    <article className="glass card-hover group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)]">
      <div className="p-3 pb-0">
        <div className="relative aspect-square overflow-hidden rounded-[calc(var(--radius-card)-0.35rem)] border border-[var(--site-border)] bg-[#0b0b10]">
          <Link
            to={`/product/${product.slug}`}
            className="block size-full"
            aria-label={`${product.name[lang]} — ${t("product.view")}`}
          >
            <img
              src={product.image}
              srcSet={`${product.imageSmall} 450w, ${product.image} 900w`}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 92vw"
              alt={productAlt(product, lang)}
              width={900}
              height={900}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.045]"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-3 bottom-3 rounded-2xl border border-[var(--site-border)] bg-[rgba(11,11,16,0.72)] px-3 py-2 text-[0.68rem] leading-snug text-white/85 opacity-0 backdrop-blur transition duration-300 group-hover:opacity-100"
            >
              {product.description[lang]}
            </span>
          </Link>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            {badge ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-wide",
                  badge.className,
                )}
              >
                {t(badge.key)}
              </span>
            ) : (
              <span />
            )}
            {discount > 0 ? (
              <span className="rounded-full border border-[var(--site-border)] bg-[rgba(11,11,16,0.72)] px-2 py-1 text-[0.62rem] font-semibold text-white backdrop-blur">
                −{formatNumber(discount, lang)}%
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleWishlist}
            aria-pressed={wished}
            aria-label={wished ? t("product.removeFromWishlist") : t("product.addToWishlist")}
            className={cn(
              "absolute top-12 right-3 z-10 grid size-9 place-items-center rounded-full border border-[var(--site-border)] backdrop-blur transition",
              wished
                ? "bg-[#FF5C7A] text-[#24070D]"
                : "bg-[rgba(11,11,16,0.72)] text-white hover:bg-[rgba(11,11,16,0.9)]",
            )}
          >
            <Heart aria-hidden="true" className={cn("size-4", wished && "fill-current")} />
          </button>

          <button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock}
            aria-label={`${t("product.quickAdd")} — ${product.name[lang]}`}
            className="absolute right-3 bottom-3 z-10 grid size-10 translate-y-2 place-items-center rounded-full bg-[var(--site-accent)] text-[var(--site-on-accent)] opacity-0 shadow-lg transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 max-sm:translate-y-0 max-sm:opacity-100"
          >
            <Plus aria-hidden="true" className="size-4.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <span>{category?.name[lang] ?? categoryName(product.categoryId)}</span>
          {product.brand ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{product.brand}</span>
            </>
          ) : null}
        </div>

        <h3 className="mt-1.5 font-heading text-base font-semibold leading-snug text-foreground">
          <Link to={`/product/${product.slug}`} className="hover:text-[var(--accent-ink)]">
            {product.name[lang]}
          </Link>
        </h3>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {product.tagline[lang]}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1">
            <Star
              aria-hidden="true"
              className="size-3.5 fill-[var(--brand-gold)] text-[var(--brand-gold)]"
            />
            <span className="font-semibold text-foreground">
              {formatNumber(product.rating, lang)}
            </span>
            <span className="text-muted-foreground">({formatNumber(product.reviews, lang)})</span>
          </span>
          <span className="ml-auto text-[0.62rem] font-medium">
            {outOfStock ? (
              <span className="text-[var(--danger-ink)]">{t("product.outOfStock")}</span>
            ) : lowStock ? (
              <span className="inline-flex items-center gap-1 text-[var(--danger-ink)]">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--brand-rose)]" />
                {t("product.stockLeft", { count: formatNumber(product.stock, lang) })}
              </span>
            ) : (
              <span className="text-[var(--accent-ink)]">{t("product.inStock")}</span>
            )}
          </span>
        </div>

        <div className="mt-auto pt-4">
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-lg font-semibold text-foreground">
              {formatTaka(price, lang)}
            </span>
            {compareAt && compareAt > price ? (
              <span className="text-xs text-muted-foreground line-through">
                {formatTaka(compareAt, lang)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock}
            className={cn(cardButtonClass, "mt-3 h-10 w-full")}
          >
            <ShoppingBag aria-hidden="true" className="size-4" />
            {outOfStock ? t("product.outOfStock") : t("product.add")}
          </button>

          <label className="mt-2.5 flex cursor-pointer items-center justify-center gap-2 text-[0.68rem] font-medium text-muted-foreground transition hover:text-foreground">
            <input
              type="checkbox"
              checked={comparing}
              onChange={handleCompare}
              className="size-3.5 cursor-pointer rounded border border-[var(--site-border)] accent-[var(--site-accent)]"
            />
            {t("compare.add")}
          </label>
        </div>
      </div>
    </article>
  );

  return animate ? (
    <Reveal delay={Math.min(index, 8) * 0.05} className="h-full">
      {content}
    </Reveal>
  ) : (
    content
  );
}
