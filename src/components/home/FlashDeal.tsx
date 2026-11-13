import { ArrowRight, Flame, ShoppingBag } from "lucide-react";
import { useMemo } from "react";
import { useCountdown } from "../../hooks/use-countdown";
import { useCart } from "../../lib/cart";
import {
  discountPercent,
  productAlt,
  productPrice,
  useCatalog,
} from "../../lib/catalog";
import { formatNumber, formatTaka, formatTwoDigits, useI18n } from "../../lib/i18n";
import { useFlashSale } from "../../lib/marketing";
import { Reveal } from "../common/Reveal";
import { Eyebrow } from "../common/SectionHeading";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

function endOfDhakaDay(): string {
  const dhakaNow = new Date(Date.now() + DHAKA_OFFSET_MS);
  const nextMidnightUtc = Date.UTC(
    dhakaNow.getUTCFullYear(),
    dhakaNow.getUTCMonth(),
    dhakaNow.getUTCDate() + 1,
  );
  return new Date(nextMidnightUtc - DHAKA_OFFSET_MS).toISOString();
}

function FlashDealSkeleton() {
  return (
    <section id="deals" className="container-page py-10 sm:py-14" aria-hidden="true">
      <div className="rounded-[calc(var(--radius-card)+0.4rem)] border border-[var(--site-border)] bg-[var(--glass-fill)] p-6 backdrop-blur-xl sm:p-9 lg:p-12">
        <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="space-y-4">
            <div className="skeleton h-4 w-32 rounded-full" />
            <div className="skeleton h-10 w-64 rounded-xl" />
            <div className="skeleton h-4 w-full max-w-md rounded-full" />
            <div className="skeleton h-16 w-56 rounded-2xl" />
          </div>
          <div className="skeleton mx-auto aspect-square w-full max-w-sm rounded-[calc(var(--radius-card)+0.5rem)]" />
        </div>
      </div>
    </section>
  );
}

export function FlashDeal() {
  const { t, lang } = useI18n();
  const { products, status } = useCatalog();
  const { addItem, openCart } = useCart();
  const { sale } = useFlashSale();
  const endsAt = useMemo(() => sale?.endsAt ?? endOfDhakaDay(), [sale]);
  const countdown = useCountdown(endsAt);

  const saleItem = useMemo(() => {
    if (!sale) return null;
    return sale.items.find((item) => products.some((entry) => entry.id === item.productId)) ?? null;
  }, [sale, products]);

  const product = useMemo(() => {
    if (saleItem) return products.find((entry) => entry.id === saleItem.productId) ?? null;
    if (products.length === 0) return null;
    const best = [...products].sort((a, b) => discountPercent(b) - discountPercent(a))[0];
    return discountPercent(best) > 0 ? best : null;
  }, [products, saleItem]);

  if (!product) {
    return status === "loading" ? <FlashDealSkeleton /> : null;
  }

  const discount = saleItem ? sale?.discountPercent ?? 0 : discountPercent(product);
  const unitPrice = saleItem ? saleItem.salePricePaisa / 100 : productPrice(product);
  const outOfStock = (saleItem ? saleItem.stock : product.stock) <= 0;
  const displayStock = saleItem ? saleItem.stock : product.stock;
  const lowStock = !outOfStock && displayStock <= product.lowStockThreshold;
  const stockTone = outOfStock
    ? "border-[color-mix(in_srgb,var(--brand-rose)_45%,transparent)] text-[var(--brand-rose)]"
    : lowStock
      ? "border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] text-[var(--brand-gold)]"
      : "border-[color-mix(in_srgb,var(--brand-teal)_40%,transparent)] text-[var(--accent-ink)]";

  const timeParts = [
    { value: countdown.hours, label: t("deals.hours") },
    { value: countdown.minutes, label: t("deals.minutes") },
    { value: countdown.seconds, label: t("deals.seconds") },
  ];

  const addToCart = () => {
    if (addItem(product.id)) openCart();
  };

  return (
    <section id="deals" className="container-page py-10 sm:py-14" aria-labelledby="flash-deal-title">
      <Reveal>
        <div className="relative overflow-hidden rounded-[calc(var(--radius-card)+0.4rem)] border border-[var(--site-border)] bg-[var(--glass-fill)] shadow-[var(--shadow-card)] backdrop-blur-xl">
          <div
            aria-hidden="true"
            className="absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,rgba(245,196,81,0.28),transparent_65%)] blur-2xl"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-28 -left-16 size-80 rounded-full bg-[radial-gradient(circle,rgba(123,97,255,0.3),transparent_65%)] blur-2xl"
          />

          <div className="relative grid items-center gap-10 p-6 sm:p-9 lg:grid-cols-[1.08fr_0.92fr] lg:p-12">
            <div>
              <Eyebrow tone="var(--brand-gold)">
                <Flame aria-hidden="true" className="size-3.5" />
                {t("deals.eyebrow")}
              </Eyebrow>

              <h2
                id="flash-deal-title"
                className="mt-3 text-3xl font-bold sm:text-4xl lg:text-[2.75rem]"
              >
                {sale ? sale.title[lang] : t("deals.title")}
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
                {sale ? sale.subtitle[lang] : t("deals.body")}
              </p>

              {countdown.ended ? (
                <p className="mt-6 inline-flex items-center rounded-full border border-[var(--site-border)] px-4 py-2 text-sm font-medium text-muted-foreground">
                  {t("deals.ended")}
                </p>
              ) : (
                <div className="mt-6">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {t("deals.endsIn")}
                  </p>
                  <div
                    className="mt-2.5 flex flex-wrap items-center gap-2"
                    role="timer"
                    aria-live="off"
                  >
                    {timeParts.map((part) => (
                      <div
                        key={part.label}
                        className="glass-soft min-w-[3.5rem] rounded-xl px-3 py-2 text-center"
                      >
                        <span className="block font-heading text-xl font-bold tabular-nums text-foreground sm:text-2xl">
                          {formatTwoDigits(part.value, lang)}
                        </span>
                        <span className="mt-0.5 block text-[0.6rem] text-muted-foreground">
                          {part.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex max-w-md flex-wrap items-center gap-2.5 text-xs font-medium">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${stockTone}`}
                >
                  {outOfStock
                    ? t("deals.outOfStock")
                    : `${lowStock ? t("deals.lowStock") : t("deals.stock")} · ${formatNumber(displayStock, lang)}`}
                </span>
                <span className="text-[0.7rem] text-muted-foreground">{t("deals.stockNote")}</span>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={addToCart}
                  disabled={outOfStock}
                  className="btn-sheen inline-flex h-12 items-center gap-2 rounded-full bg-[var(--site-accent)] px-6 text-sm font-semibold text-[var(--site-on-accent)] shadow-[0_20px_55px_-22px_rgba(0,245,212,0.65)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ShoppingBag aria-hidden="true" className="size-4" />
                  {outOfStock ? t("product.outOfStock") : t("product.add")}
                </button>
                <a
                  href="#featured"
                  className="inline-flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold text-foreground transition hover:text-[var(--accent-ink)]"
                >
                  {t("actions.viewAll")}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </a>
              </div>
              {sale ? (
                <p className="mt-2.5 text-[0.68rem] text-muted-foreground">{t("deals.checkoutNote")}</p>
              ) : null}
            </div>

            <div className="relative mx-auto w-full max-w-sm">
              <div
                aria-hidden="true"
                className="absolute inset-8 rounded-full bg-[radial-gradient(circle,rgba(245,196,81,0.22),transparent_66%)] blur-2xl"
              />
              <a
                href={`/product/${saleItem?.slug ?? product.slug}`}
                className="glass-soft relative block overflow-hidden rounded-[calc(var(--radius-card)+0.5rem)]"
              >
                <img
                  src={saleItem?.image ?? product.image}
                  srcSet={`${saleItem?.imageSmall ?? product.imageSmall} 450w, ${saleItem?.image ?? product.image} 900w`}
                  sizes="(min-width: 1024px) 30vw, 80vw"
                  alt={productAlt(product, lang)}
                  width={900}
                  height={900}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
                {discount > 0 ? (
                  <span className="absolute top-3 left-3 rounded-full bg-[var(--brand-gold)] px-2.5 py-1 text-[0.62rem] font-bold text-[#1A1408]">
                    −{formatNumber(discount, lang)}% {t("product.off")}
                  </span>
                ) : null}
                <div className="absolute right-3 bottom-3 rounded-2xl border border-[var(--site-border)] bg-[rgba(11,11,16,0.66)] px-3.5 py-2 text-right backdrop-blur">
                  <span className="block text-[0.6rem] uppercase tracking-[0.16em] text-white/60">
                    {product.name[lang]}
                  </span>
                  <span className="block font-heading text-lg font-bold text-white">
                    {formatTaka(unitPrice, lang)}
                  </span>
                </div>
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
