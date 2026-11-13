import { ArrowRight, Star, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { discountPercent, productPrice, useCatalog } from "../../lib/catalog";
import { useCompare } from "../../lib/compare";
import { formatNumber, formatTaka, useI18n } from "../../lib/i18n";
import { Link, useRouter } from "../../lib/router";

export function CompareTray() {
  const { t, lang } = useI18n();
  const { path } = useRouter();
  const { products, isOpen, open, close, clear, remove, ids } = useCompare();
  const { categories } = useCatalog();

  if (ids.length === 0 || path.startsWith("/product/")) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div className="glass pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-[var(--radius-card)] p-2.5 shadow-[var(--shadow-card)]">
          <ul className="flex flex-1 items-center gap-2 overflow-x-auto scrollbar-thin">
            {products.map((product) => (
              <li key={product.id} className="relative shrink-0">
                <img
                  src={product.imageSmall}
                  alt={product.name[lang]}
                  width={450}
                  height={450}
                  loading="lazy"
                  decoding="async"
                  className="size-11 rounded-xl object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(product.id)}
                  aria-label={`${t("cart.remove")} — ${product.name[lang]}`}
                  className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-[var(--site-border)] bg-[var(--surface-raised)] text-muted-foreground transition hover:text-[var(--brand-rose)]"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </li>
            ))}
            {Array.from({ length: Math.max(0, 3 - products.length) }).map((_, index) => (
              <li
                key={`slot-${index}`}
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-xl border border-dashed border-[var(--site-border)] text-[0.65rem] text-muted-foreground"
              >
                +
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={clear}
            className="hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            {t("compare.clear")}
          </button>
          <button
            type="button"
            onClick={open}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-4 text-xs font-semibold text-[var(--site-on-accent)] transition hover:brightness-105"
          >
            {t("compare.open")}
            <span className="rounded-full bg-[rgba(0,0,0,0.18)] px-1.5 text-[0.65rem]">
              {formatNumber(products.length, lang)}
            </span>
          </button>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
        <DialogContent
          className="gap-0 overflow-hidden p-0"
          style={{
            top: "8%",
            transform: "translate(-50%, 0)",
            borderRadius: "var(--radius-card)",
            backgroundColor: "var(--surface-raised)",
            maxWidth: "56rem",
          }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--site-border)] px-5 py-4">
            <div>
              <DialogTitle className="font-heading text-base font-semibold text-foreground">
                {t("compare.title")}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                {t("compare.body")}
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t("actions.close")}
              className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-sunken)] hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <div className="max-h-[min(74vh,40rem)] overflow-x-auto overflow-y-auto p-4 scrollbar-thin" data-lenis-prevent>
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="w-28 p-2 text-left text-xs font-medium text-muted-foreground">
                    {t("compare.title")}
                  </th>
                  {products.map((product) => (
                    <th key={product.id} scope="col" className="min-w-40 p-2 align-top">
                      <div className="space-y-2 text-left">
                        <img
                          src={product.imageSmall}
                          alt={product.name[lang]}
                          width={450}
                          height={450}
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full rounded-xl object-cover"
                        />
                        <Link
                          to={`/product/${product.slug}`}
                          onClick={close}
                          className="block text-sm font-semibold leading-snug text-foreground hover:text-[var(--accent-ink)]"
                        >
                          {product.name[lang]}
                        </Link>
                        <button
                          type="button"
                          onClick={() => remove(product.id)}
                          aria-label={`${t("compare.remove")} — ${product.name[lang]}`}
                          className="inline-flex items-center gap-1 text-[0.68rem] text-muted-foreground transition hover:text-[var(--brand-rose)]"
                        >
                          <Trash2 aria-hidden="true" className="size-3" />
                          {t("compare.clear")}
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: t("compare.price"),
                    render: (index: number) => {
                      const product = products[index];
                      if (!product) return null;
                      return (
                        <span className="font-heading font-semibold text-foreground">
                          {formatTaka(productPrice(product), lang)}
                        </span>
                      );
                    },
                  },
                  {
                    label: t("compare.discount"),
                    render: (index: number) => {
                      const product = products[index];
                      if (!product) return null;
                      const discount = discountPercent(product);
                      return discount > 0 ? (
                        <span className="text-[var(--accent-ink)]">
                          −{formatNumber(discount, lang)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      );
                    },
                  },
                  {
                    label: t("compare.brand"),
                    render: (index: number) => products[index]?.brand ?? "—",
                  },
                  {
                    label: t("compare.category"),
                    render: (index: number) => {
                      const product = products[index];
                      if (!product) return "—";
                      const category = categories.find((entry) => entry.id === product.categoryId);
                      return category?.name[lang] ?? "—";
                    },
                  },
                  {
                    label: t("compare.rating"),
                    render: (index: number) => {
                      const product = products[index];
                      if (!product) return null;
                      return (
                        <span className="inline-flex items-center gap-1">
                          <Star
                            aria-hidden="true"
                            className="size-3.5 fill-[var(--brand-gold)] text-[var(--brand-gold)]"
                          />
                          {formatNumber(product.rating, lang)}
                          <span className="text-muted-foreground">
                            ({formatNumber(product.reviews, lang)})
                          </span>
                        </span>
                      );
                    },
                  },
                  {
                    label: t("compare.stock"),
                    render: (index: number) => {
                      const product = products[index];
                      if (!product) return null;
                      return product.stock > 0 ? (
                        <span className="text-foreground">
                          {t("product.inStockCount", { count: formatNumber(product.stock, lang) })}
                        </span>
                      ) : (
                        <span className="text-[var(--danger-ink)]">{t("product.outOfStock")}</span>
                      );
                    },
                  },
                  {
                    label: t("compare.variants"),
                    render: (index: number) => {
                      const product = products[index];
                      if (!product) return null;
                      if (product.variants.length === 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      const labels = product.variants.map((variant) => variant.label[lang]);
                      return <span className="text-muted-foreground">{labels.join(" · ")}</span>;
                    },
                  },
                ].map((row, rowIndex) => (
                  <tr key={row.label} className={cn(rowIndex % 2 === 0 && "bg-[var(--surface-sunken)]")}>
                    <th
                      scope="row"
                      className="rounded-l-lg p-2.5 text-left text-xs font-medium text-muted-foreground"
                    >
                      {row.label}
                    </th>
                    {products.map((product, index) => (
                      <td key={product.id} className="p-2.5 align-top">
                        {row.render(index)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="p-2.5" />
                  {products.map((product) => (
                    <td key={product.id} className="p-2.5">
                      <Link
                        to={`/product/${product.slug}`}
                        onClick={close}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-ink)] hover:underline"
                      >
                        {t("compare.view")}
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
