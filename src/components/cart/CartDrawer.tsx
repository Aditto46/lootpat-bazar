import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCart } from "../../lib/cart";
import { availableStock, productAlt } from "../../lib/catalog";
import { formatNumber, formatTaka, useI18n } from "../../lib/i18n";
import { Link, useRouter } from "../../lib/router";

export function CartDrawer() {
  const { t, lang } = useI18n();
  const { navigate } = useRouter();
  const { items, count, subtotal, isOpen, openCart, closeCart, setQuantity, removeItem } = useCart();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => (open ? openCart() : closeCart())}>
      <SheetContent
        side="right"
        className="gap-0 p-0"
        style={{
          backgroundColor: "var(--surface-raised)",
          width: "100%",
          maxWidth: "26rem",
          borderLeft: "1px solid var(--site-border)",
        }}
      >
        <SheetHeader className="border-b border-[var(--site-border)] px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-left font-heading text-base">
            <ShoppingBag aria-hidden="true" className="size-4.5 text-[var(--accent-ink)]" />
            {t("cart.title")}
            <span className="text-xs font-medium text-muted-foreground">
              {t("cart.itemCount", { count: formatNumber(count, lang) })}
            </span>
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <span className="grid size-16 place-items-center rounded-full border border-[var(--site-border)] bg-[var(--surface-sunken)]">
              <ShoppingBag aria-hidden="true" className="size-7 text-muted-foreground" />
            </span>
            <div>
              <p className="font-heading text-base font-semibold text-foreground">{t("cart.empty")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("cart.emptyBody")}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                closeCart();
                document.getElementById("featured")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
            >
              {t("cart.emptyCta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <ul
              className="flex-1 divide-y divide-[var(--site-border)] overflow-y-auto px-5 scrollbar-thin"
              data-lenis-prevent
            >
              {items.map(({ key, product, variant, qty, unitPrice }) => (
                <li key={key} className="flex gap-3 py-4">
                  <img
                    src={product.imageSmall}
                    alt={productAlt(product, lang)}
                    width={450}
                    height={450}
                    loading="lazy"
                    decoding="async"
                    className="size-20 shrink-0 rounded-xl object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug text-foreground">
                        {product.name[lang]}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(key)}
                        aria-label={`${t("cart.remove")} — ${product.name[lang]}`}
                        className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-sunken)] hover:text-[var(--brand-rose)]"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {variant ? variant.label[lang] : product.tagline[lang]}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
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
                          className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                        >
                          <Minus aria-hidden="true" className="size-3.5" />
                        </button>
                        <span className="min-w-6 text-center text-xs font-semibold text-foreground">
                          {formatNumber(qty, lang)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuantity(key, qty + 1)}
                          disabled={qty >= availableStock(product, variant)}
                          aria-label={t("cart.increase")}
                          className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                        >
                          <Plus aria-hidden="true" className="size-3.5" />
                        </button>
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        {formatTaka(unitPrice * qty, lang)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="border-t border-[var(--site-border)] p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("cart.subtotal")}</span>
                <span className="font-heading text-lg font-semibold text-foreground">
                  {formatTaka(subtotal, lang)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("cart.deliveryNote")}</p>
              <button
                type="button"
                onClick={() => {
                  closeCart();
                  navigate("/checkout");
                }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
              >
                {t("cart.checkout")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </button>
              <Link
                to="/cart"
                onClick={closeCart}
                className="mt-2 block text-center text-xs font-medium text-[var(--accent-ink)] hover:underline"
              >
                {t("cart.viewCart")}
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
