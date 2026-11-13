import { ArrowRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  discountPercent,
  productAlt,
  productPrice,
  useCatalog,
  useCatalogSearch,
} from "../../lib/catalog";
import { formatNumber, formatTaka, useI18n } from "../../lib/i18n";
import { useRouter } from "../../lib/router";

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const { products, categories } = useCatalog();
  const { navigate } = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const enabled = open && trimmed.length >= 2;
  const { data, status } = useCatalogSearch(
    { q: trimmed || undefined, limit: 8 },
    { debounceMs: 240, enabled },
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const popular = products.slice(0, 5);
  const results = enabled ? (data?.products ?? []) : popular;
  const loading = enabled && status === "loading" && !data;
  const empty = enabled && status === "ready" && results.length === 0;
  const total = enabled ? (data?.total ?? results.length) : popular.length;

  const goToProduct = (slug: string) => {
    onOpenChange(false);
    navigate(`/product/${slug}`);
  };

  const viewAll = () => {
    onOpenChange(false);
    navigate(`/shop?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0"
        style={{
          top: "14%",
          transform: "translate(-50%, 0)",
          borderRadius: "var(--radius-card)",
          backgroundColor: "var(--surface-raised)",
          maxWidth: "36rem",
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{t("search.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("search.hint")}</DialogDescription>

        <div className="flex items-center gap-3 border-b border-[var(--site-border)] px-5 py-4">
          <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && enabled) viewAll();
            }}
            placeholder={t("search.placeholder")}
            className="h-8 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            aria-label={t("search.placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-sunken)] hover:text-foreground"
              aria-label={t("actions.close")}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : (
            <kbd className="hidden rounded border border-[var(--site-border)] px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground sm:block">
              Esc
            </kbd>
          )}
        </div>

        <div className="max-h-[min(58vh,26rem)] overflow-y-auto p-2 scrollbar-thin" data-lenis-prevent>
          {enabled ? null : (
            <p className="px-3 pt-2.5 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("search.popular")}
            </p>
          )}

          {loading ? (
            <div className="px-5 py-10 text-center" role="status">
              <p className="animate-pulse text-sm font-medium text-muted-foreground">
                {t("search.loading")}
              </p>
            </div>
          ) : empty ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">{t("search.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("search.typoHint")}</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {results.map((product) => {
                const category = categories.find((entry) => entry.id === product.categoryId);
                const discount = discountPercent(product);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => goToProduct(product.slug)}
                      className="group flex w-full items-center gap-3 rounded-[calc(var(--radius-card)-0.35rem)] px-3 py-2.5 text-left transition hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)]"
                    >
                      <img
                        src={product.imageSmall}
                        alt={productAlt(product, lang)}
                        width={450}
                        height={450}
                        loading="lazy"
                        decoding="async"
                        className="size-12 shrink-0 rounded-xl object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {product.name[lang]}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {category?.name[lang]}
                          {product.brand ? ` · ${product.brand}` : ""} · {product.tagline[lang]}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold text-foreground">
                          {formatTaka(productPrice(product), lang)}
                        </span>
                        {discount > 0 ? (
                          <span className="block text-[0.65rem] font-medium text-[var(--accent-ink)]">
                            {formatNumber(discount, lang)}% {t("product.off")}
                          </span>
                        ) : null}
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--site-border)] px-5 py-3 text-[0.7rem] text-muted-foreground">
          <span>
            {enabled
              ? t("search.results", { count: formatNumber(total, lang) })
              : t("search.minChars")}
          </span>
          {enabled && results.length > 0 ? (
            <button
              type="button"
              onClick={viewAll}
              className="inline-flex items-center gap-1 font-semibold text-[var(--accent-ink)] hover:underline"
            >
              {t("search.viewAll")}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          ) : (
            <span className="hidden sm:inline">{t("search.typoHint")}</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
