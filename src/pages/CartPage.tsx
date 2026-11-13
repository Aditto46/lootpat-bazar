import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Eyebrow } from "../components/common/SectionHeading";
import { CartReminder } from "../components/marketing/CartReminder";
import { useCart } from "../lib/cart";
import { availableStock, productAlt } from "../lib/catalog";
import { shippingPaisa, useCheckoutConfig } from "../lib/checkout";
import { formatNumber, formatTaka, useI18n } from "../lib/i18n";
import { readStoredDistrict, useDistricts } from "../lib/locations";
import { Link, useRouter } from "../lib/router";

export function CartPage() {
  const { t, lang } = useI18n();
  const { navigate } = useRouter();
  const { items, count, subtotal, setQuantity, removeItem, clearCart } = useCart();
  const { config } = useCheckoutConfig();
  const { districts } = useDistricts();

  const subtotalPaisa = Math.round(subtotal * 100);
  const storedDistrict = readStoredDistrict();
  const district = districts.find((entry) => entry.id === storedDistrict);
  const shipping =
    config && items.length > 0 ? shippingPaisa(config, district, subtotalPaisa) : null;
  const freeThreshold = config ? config.delivery.freeThresholdPaisa / 100 : 0;
  const remainingForFree = Math.max(0, freeThreshold - subtotal);
  const progress =
    freeThreshold > 0 ? Math.min(100, Math.round((subtotal / freeThreshold) * 100)) : 0;

  if (items.length === 0) {
    return (
      <section className="container-page pt-6 pb-20 sm:pt-10">
        <div className="max-w-2xl">
          <Eyebrow>{t("cart.title")}</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("cart.title")}</h1>
        </div>
        <div className="glass mt-8 flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-16 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-[var(--surface-sunken)] text-muted-foreground">
            <ShoppingBag aria-hidden="true" className="size-7" />
          </span>
          <p className="font-heading text-lg font-semibold text-foreground">{t("cart.empty")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("cart.emptyBody")}</p>
          <Link
            to="/shop"
            className="mt-1 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
          >
            {t("cart.emptyCta")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <Eyebrow>{t("cart.title")}</Eyebrow>
          <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{t("cart.title")}</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("cart.itemCount", { count: formatNumber(count, lang) })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            clearCart();
            toast.message(t("cart.cleared"));
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--site-border)] px-4 text-sm font-medium text-foreground transition hover:border-[var(--brand-rose)] hover:text-[var(--brand-rose)]"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {t("cart.clear")}
        </button>
      </div>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-8">
        <ul className="glass divide-y divide-[var(--site-border)] overflow-hidden rounded-[var(--radius-card)]">
          {items.map(({ key, product, variant, qty, unitPrice }) => {
            const stock = availableStock(product, variant);
            return (
              <li key={key} className="flex gap-4 p-4 sm:p-5">
                <Link
                  to={`/product/${product.slug}`}
                  className="shrink-0 overflow-hidden rounded-xl border border-[var(--site-border)]"
                >
                  <img
                    src={product.imageSmall}
                    alt={productAlt(product, lang)}
                    width={450}
                    height={450}
                    loading="lazy"
                    decoding="async"
                    className="size-20 object-cover sm:size-24"
                  />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/product/${product.slug}`}
                        className="text-sm font-semibold leading-snug text-foreground hover:text-[var(--accent-ink)] sm:text-base"
                      >
                        {product.name[lang]}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {variant ? variant.label[lang] : product.tagline[lang]}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(key)}
                      aria-label={`${t("cart.remove")} — ${product.name[lang]}`}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-sunken)] hover:text-[var(--brand-rose)]"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatTaka(unitPrice, lang)} × {formatNumber(qty, lang)}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div
                      className="flex items-center rounded-full border border-[var(--site-border)]"
                      role="group"
                      aria-label={`${t("cart.quantity")} — ${product.name[lang]}`}
                    >
                      <button
                        type="button"
                        onClick={() => setQuantity(key, qty - 1)}
                        disabled={qty <= 1}
                        aria-label={t("cart.decrease")}
                        className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                      >
                        <Minus aria-hidden="true" className="size-4" />
                      </button>
                      <span className="min-w-7 text-center text-sm font-semibold text-foreground">
                        {formatNumber(qty, lang)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuantity(key, qty + 1)}
                        disabled={qty >= stock}
                        aria-label={t("cart.increase")}
                        className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                    <span className="font-heading text-base font-semibold text-foreground">
                      {formatTaka(unitPrice * qty, lang)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="glass rounded-[var(--radius-card)] p-5 lg:sticky lg:top-28">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            {t("cart.summary")}
          </h2>

          {freeThreshold > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground">
                {remainingForFree > 0
                  ? t("cart.freeShipProgress", { amount: formatTaka(remainingForFree, lang) })
                  : t("cart.freeShipReached")}
              </p>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className="h-full rounded-full bg-[var(--site-accent)] transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          <dl className="mt-5 space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t("cart.subtotal")}</dt>
              <dd className="font-medium text-foreground">{formatTaka(subtotal, lang)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Truck aria-hidden="true" className="size-4" />
                {t("cart.shippingEstimate")}
              </dt>
              <dd className="font-medium text-foreground">
                {shipping === null
                  ? "—"
                  : shipping === 0
                    ? t("checkout.free")
                    : formatTaka(shipping / 100, lang)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {district ? t("cart.shippingHint") : t("checkout.needDistrict")}
          </p>

          <div className="mt-4 flex items-end justify-between gap-3 border-t border-[var(--site-border)] pt-4">
            <span className="text-sm font-medium text-muted-foreground">{t("checkout.total")}</span>
            <span className="font-heading text-xl font-bold text-foreground">
              {formatTaka(subtotal + (shipping ?? 0) / 100, lang)}
            </span>
          </div>

          <button
            type="button"
            data-testid="cart-checkout"
            onClick={() => navigate("/checkout")}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
          >
            {t("cart.checkout")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
          <Link
            to="/shop"
            className="mt-3 block text-center text-xs font-medium text-[var(--accent-ink)] hover:underline"
          >
            {t("cart.continue")}
          </Link>

          <CartReminder itemCount={count} />
        </aside>
      </div>
    </section>
  );
}
