import {
  ArrowRight,
  Check,
  ChevronRight,
  Heart,
  PackageCheck,
  Plus,
  RotateCcw,
  ShoppingBag,
  Star,
  Truck,
  ZoomIn,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  availableStock,
  productAlt,
  useCatalog,
  useCatalogProduct,
  type CatalogProduct,
} from "../lib/catalog";
import { useCart } from "../lib/cart";
import { useCompare } from "../lib/compare";
import {
  deliveryWindow,
  formatDeliveryDate,
  isDhaka,
  readStoredDistrict,
  rememberDistrict,
  useDistricts,
} from "../lib/locations";
import { formatNumber, formatTaka, useI18n } from "../lib/i18n";
import { Link } from "../lib/router";
import { readRecentSlugs, rememberProduct, useWishlist } from "../lib/wishlist";
import { Eyebrow } from "../components/common/SectionHeading";
import { ProductCard } from "../components/home/ProductCard";
import { ReviewsSection } from "../components/marketing/ReviewsSection";
import { StockAlertForm } from "../components/marketing/StockAlertForm";

const iconButtonClass =
  "inline-flex size-11 items-center justify-center rounded-full border border-[var(--site-border)] text-muted-foreground transition hover:border-[var(--site-accent)] hover:text-foreground";

function ratingLabel(rating: number, lang: "bn" | "en"): string {
  return formatNumber(rating, lang);
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <section className="container-page pt-10 pb-24" aria-busy="true">
      <p className="sr-only" role="status">
        {t("common.loading")}
      </p>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="aspect-square animate-pulse rounded-[calc(var(--radius-card)+0.6rem)] bg-[var(--surface-sunken)]" />
        <div className="space-y-4">
          <div className="h-3 w-1/4 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
          <div className="h-8 w-4/5 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
          <div className="h-4 w-3/5 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-[var(--surface-sunken)]" />
          <div className="h-12 w-full animate-pulse rounded-full bg-[var(--surface-sunken)]" />
        </div>
      </div>
    </section>
  );
}

function VariantPicker({
  product,
  selectedId,
  onSelect,
}: {
  product: CatalogProduct;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const groups = (["color", "size"] as const).flatMap((type) => {
    const variants = product.variants.filter((variant) => variant.optionType === type);
    return variants.length > 0 ? [{ type, variants }] : [];
  });

  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <fieldset key={group.type}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {group.type === "color" ? t("product.optionColor") : t("product.optionSize")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {group.variants.map((variant) => {
              const selected = variant.id === selectedId;
              const soldOut = variant.stock <= 0;
              return (
                <button
                  key={variant.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(variant.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition",
                    selected
                      ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                      : "border-[var(--site-border)] text-muted-foreground hover:border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] hover:text-foreground",
                    soldOut && "opacity-55",
                  )}
                >
                  {variant.swatch ? (
                    <span
                      aria-hidden="true"
                      className="size-3.5 rounded-full border border-[var(--site-border)]"
                      style={{ backgroundColor: variant.swatch }}
                    />
                  ) : null}
                  <span>{variant.label[lang]}</span>
                  {selected ? <Check aria-hidden="true" className="size-3.5" /> : null}
                  {soldOut ? (
                    <span className="text-[0.6rem] uppercase tracking-wide">
                      {t("product.outOfStock")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="text-[0.7rem] text-muted-foreground">{t("product.variantHint")}</p>
    </div>
  );
}

function DeliveryCard() {
  const { t, lang } = useI18n();
  const { status, districts } = useDistricts();
  const [selectedId, setSelectedId] = useState<string | null>(readStoredDistrict);

  useEffect(() => {
    if (status !== "ready" || districts.length === 0) return;
    if (selectedId && districts.some((entry) => entry.id === selectedId)) return;
    const fallback = districts.find((entry) => isDhaka(entry)) ?? districts[0];
    setSelectedId(fallback.id);
  }, [status, districts, selectedId]);

  const district = districts.find((entry) => entry.id === selectedId);
  const dhaka = isDhaka(district);
  const [from, to] = deliveryWindow(dhaka);
  const range =
    from.getTime() === to.getTime()
      ? formatDeliveryDate(from, lang)
      : `${formatDeliveryDate(from, lang)} – ${formatDeliveryDate(to, lang)}`;

  return (
    <div className="rounded-2xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Truck aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
        {t("product.deliveryTitle")}
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
          {t("product.district")}
        </span>
        <select
          value={selectedId ?? ""}
          onChange={(event) => {
            setSelectedId(event.target.value);
            rememberDistrict(event.target.value);
          }}
          disabled={status !== "ready"}
          className="h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
        >
          {status !== "ready" ? (
            <option value={selectedId ?? ""}>
              {status === "error" ? t("common.error") : t("common.loading")}
            </option>
          ) : null}
          {districts.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name[lang]} · {entry.division[lang]}
            </option>
          ))}
        </select>
      </label>

      <p className="mt-3 text-sm font-medium text-foreground">
        {dhaka ? t("product.deliveryDhaka") : t("product.deliveryOutside")}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("product.deliveryBy", { date: range })}
      </p>
      <p className="mt-1 text-[0.68rem] text-muted-foreground">{t("product.deliveryHint")}</p>
    </div>
  );
}

export function ProductPage({ slug }: { slug: string | null }) {
  const { t, lang } = useI18n();
  const { status, product, error, reload } = useCatalogProduct(slug);
  const { products, categories, categoryName } = useCatalog();
  const { addItem } = useCart();
  const wishlist = useWishlist();
  const compare = useCompare();

  const [variantId, setVariantId] = useState<string | null>(null);
  const [variantOwner, setVariantOwner] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [recentSlugs] = useState<string[]>(() => readRecentSlugs());

  if (product && variantOwner !== product.id) {
    setVariantOwner(product.id);
    const preferred =
      product.variants.find((variant) => variant.stock > 0) ?? product.variants[0] ?? null;
    setVariantId(preferred?.id ?? null);
  }

  useEffect(() => {
    if (!product) {
      if (status === "not-found") {
        document.title = `${t("product.notFound")} · লুটপাট বাজার`;
      }
      return;
    }
    rememberProduct(product.slug);
    document.title = `${product.name[lang]} · লুটপাট বাজার`;
  }, [product, status, lang, t]);

  const variant = product?.variants.find((entry) => entry.id === variantId) ?? null;
  const stock = product ? availableStock(product, variant) : 0;
  const unitPaisa = variant?.pricePaisa ?? product?.pricePaisa ?? 0;
  const price = unitPaisa / 100;
  const compareAt = product?.compareAtPaisa ? product.compareAtPaisa / 100 : null;
  const discount =
    compareAt && compareAt > price ? Math.round(((compareAt - price) / compareAt) * 100) : 0;
  const outOfStock = stock <= 0;
  const lowStock = stock > 0 && product ? stock <= product.lowStockThreshold : false;
  const category = product ? categories.find((entry) => entry.id === product.categoryId) : undefined;
  const wished = product ? wishlist.has(product.id) : false;
  const comparing = product ? compare.has(product.id) : false;

  const related = useMemo(() => {
    if (!product) return [];
    return products
      .filter((entry) => entry.categoryId === product.categoryId && entry.id !== product.id)
      .slice(0, 4);
  }, [products, product]);

  const recent = useMemo(() => {
    if (!product) return [];
    return recentSlugs
      .filter((entry) => entry !== product.slug)
      .flatMap((entry) => products.find((candidate) => candidate.slug === entry) ?? [])
      .slice(0, 4);
  }, [recentSlugs, products, product]);

  if (status === "loading") return <LoadingState />;

  if (status === "error") {
    return (
      <section className="container-page flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="font-heading text-2xl font-bold text-foreground">{t("shop.error")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("shop.errorBody")}</p>
        <p className="text-[0.7rem] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)]"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {t("shop.retry")}
        </button>
      </section>
    );
  }

  if (status === "not-found" || !product) {
    return (
      <section className="container-page flex flex-col items-center gap-4 py-24 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-[var(--surface-sunken)] text-muted-foreground">
          <ShoppingBag aria-hidden="true" className="size-7" />
        </span>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {t("product.notFound")}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("product.notFoundBody")}</p>
        <Link
          to="/shop"
          className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)]"
        >
          {t("product.back")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>
    );
  }

  const handleAdd = () => {
    if (!addItem(product.id, variant?.id ?? null)) return;
    toast.success(t("product.added"), {
      description: `${product.name[lang]}${variant ? ` · ${variant.label[lang]}` : ""} · ${formatTaka(price, lang)}`,
    });
  };

  return (
    <section className="container-page pt-6 pb-32 sm:pt-8 lg:pb-20">
      <nav aria-label="breadcrumb" className="mb-5 text-xs text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link to="/" className="hover:text-foreground">
              {t("nav.home")}
            </Link>
          </li>
          <ChevronRight aria-hidden="true" className="size-3.5" />
          <li>
            <Link to="/shop" className="hover:text-foreground">
              {t("nav.shop")}
            </Link>
          </li>
          {category ? (
            <>
              <ChevronRight aria-hidden="true" className="size-3.5" />
              <li>
                <Link to={`/shop?category=${category.id}`} className="hover:text-foreground">
                  {category.name[lang]}
                </Link>
              </li>
            </>
          ) : null}
          <ChevronRight aria-hidden="true" className="size-3.5" />
          <li className="truncate text-foreground">{product.name[lang]}</li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
        <div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setZoomOpen(true)}
              className="group relative block aspect-square w-full overflow-hidden rounded-[calc(var(--radius-card)+0.5rem)] border border-[var(--site-border)] bg-[#0b0b10]"
              aria-label={t("product.zoom")}
            >
              <img
                src={product.image}
                srcSet={`${product.imageSmall} 450w, ${product.image} 900w`}
                sizes="(min-width: 1024px) 46vw, 92vw"
                alt={productAlt(product, lang)}
                width={900}
                height={900}
                fetchPriority="high"
                decoding="async"
                className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
              <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--site-border)] bg-[rgba(11,11,16,0.72)] px-3 py-1.5 text-[0.68rem] font-medium text-white/85 backdrop-blur">
                <ZoomIn aria-hidden="true" className="size-3.5" />
                {t("product.zoomHint")}
              </span>
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 text-[0.68rem] text-muted-foreground">
            <PackageCheck aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
            {t("product.gallery")}
          </div>
        </div>

        <div>
          <Eyebrow>{category?.name[lang] ?? categoryName(product.categoryId)}</Eyebrow>
          <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl lg:text-4xl">
            {product.name[lang]}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">{product.tagline[lang]}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="inline-flex items-center gap-1">
              <Star
                aria-hidden="true"
                className="size-4 fill-[var(--brand-gold)] text-[var(--brand-gold)]"
              />
              <span className="font-semibold text-foreground">
                {ratingLabel(product.rating, lang)}
              </span>
              <span className="text-muted-foreground">
                ({formatNumber(product.reviews, lang)} {t("product.reviews")})
              </span>
            </span>
            {product.brand ? (
              <span className="text-muted-foreground">
                {t("product.brand")}: <span className="text-foreground">{product.brand}</span>
              </span>
            ) : null}
            {variant ? (
              <span className="text-muted-foreground">
                {t("product.sku")}: <span className="text-foreground">{variant.sku}</span>
              </span>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-baseline gap-2">
            <span className="font-heading text-3xl font-bold text-foreground">
              {formatTaka(price, lang)}
            </span>
            {compareAt && compareAt > price ? (
              <>
                <span className="text-base text-muted-foreground line-through">
                  {formatTaka(compareAt, lang)}
                </span>
                <span className="rounded-full bg-[var(--brand-gold)] px-2 py-0.5 text-[0.65rem] font-bold text-[#1A1408]">
                  −{formatNumber(discount, lang)}% {t("product.off")}
                </span>
              </>
            ) : null}
          </div>

          <div className="mt-2 text-xs font-medium" role="status" aria-live="polite">
            {outOfStock ? (
              <span className="text-[var(--danger-ink)]">{t("product.outOfStock")}</span>
            ) : lowStock ? (
              <span className="text-[var(--danger-ink)]">
                {t("product.stockLeft", { count: formatNumber(stock, lang) })}
              </span>
            ) : (
              <span className="text-[var(--accent-ink)]">
                {t("product.inStockCount", { count: formatNumber(stock, lang) })}
              </span>
            )}
          </div>

          <div className="mt-5">
            <VariantPicker product={product} selectedId={variant?.id ?? null} onSelect={setVariantId} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleAdd}
              disabled={outOfStock}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-6 text-sm font-semibold text-[var(--site-on-accent)] shadow-[0_20px_55px_-24px_rgba(0,245,212,0.65)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShoppingBag aria-hidden="true" className="size-4.5" />
              {outOfStock ? t("product.outOfStock") : t("product.add")}
            </button>
            <button
              type="button"
              onClick={() => wishlist.toggle(product)}
              aria-pressed={wished}
              aria-label={wished ? t("product.removeFromWishlist") : t("product.addToWishlist")}
              className={cn(
                iconButtonClass,
                wished && "border-[#FF5C7A] bg-[#FF5C7A] text-[#24070D] hover:text-[#24070D]",
              )}
            >
              <Heart aria-hidden="true" className={cn("size-5", wished && "fill-current")} />
            </button>
            <button
              type="button"
              onClick={() => compare.toggle(product)}
              aria-pressed={comparing}
              aria-label={comparing ? t("product.removeFromCompare") : t("product.addToCompare")}
              className={cn(
                iconButtonClass,
                comparing && "border-[var(--site-accent)] text-[var(--accent-ink)]",
              )}
            >
              <Plus aria-hidden="true" className="size-5" />
            </button>
          </div>

          {outOfStock ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">{t("product.outOfStockBody")}</p>
              <StockAlertForm productId={product.id} />
            </div>
          ) : null}

          <div className="mt-5">
            <DeliveryCard />
          </div>

          <div className="mt-6">
            <h2 className="font-heading text-base font-semibold text-foreground">
              {t("product.description")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {product.description[lang]}
            </p>
          </div>
        </div>
      </div>

      <ReviewsSection product={product} />

      {related.length > 0 ? (
        <div className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-bold text-foreground sm:text-2xl">
                {t("product.related")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("product.relatedBody")}</p>
            </div>
            <Link
              to={`/shop?category=${product.categoryId}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-ink)] hover:underline"
            >
              {t("actions.viewAll")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((entry, index) => (
              <li key={entry.id} className="h-full">
                <ProductCard product={entry} index={index} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="mt-12">
          <h2 className="font-heading text-xl font-bold text-foreground sm:text-2xl">
            {t("product.recent")}
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {recent.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={`/product/${entry.slug}`}
                  className="glass card-hover flex items-center gap-3 rounded-2xl p-2.5"
                >
                  <img
                    src={entry.imageSmall}
                    alt={productAlt(entry, lang)}
                    width={450}
                    height={450}
                    loading="lazy"
                    decoding="async"
                    className="size-12 rounded-xl object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {entry.name[lang]}
                    </span>
                    <span className="block text-[0.68rem] text-muted-foreground">
                      {formatTaka(entry.pricePaisa / 100, lang)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent
          className="gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none"
          style={{ maxWidth: "min(92vw, 56rem)" }}
        >
          <DialogTitle className="sr-only">{product.name[lang]}</DialogTitle>
          <img
            src={product.image}
            alt={productAlt(product, lang)}
            width={900}
            height={900}
            className="max-h-[86vh] w-full rounded-2xl object-contain"
          />
        </DialogContent>
      </Dialog>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--site-border)] bg-[color-mix(in_srgb,var(--site-bg)_88%,transparent)] p-3 backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="font-heading text-lg font-bold leading-tight text-foreground">
              {formatTaka(price, lang)}
            </p>
            <p className="truncate text-[0.65rem] text-muted-foreground">
              {variant ? variant.label[lang] : product.tagline[lang]}
            </p>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock}
            className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] disabled:opacity-50"
          >
            <ShoppingBag aria-hidden="true" className="size-4" />
            {outOfStock ? t("product.outOfStock") : t("product.add")}
          </button>
          <button
            type="button"
            onClick={() => wishlist.toggle(product)}
            aria-pressed={wished}
            aria-label={wished ? t("product.removeFromWishlist") : t("product.addToWishlist")}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full border border-[var(--site-border)]",
              wished ? "bg-[#FF5C7A] text-[#24070D]" : "text-muted-foreground",
            )}
          >
            <Heart aria-hidden="true" className={cn("size-5", wished && "fill-current")} />
          </button>
        </div>
      </div>
    </section>
  );
}
