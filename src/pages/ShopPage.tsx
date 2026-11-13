import { ChevronDown, Filter, RotateCcw, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useCatalog,
  useCatalogSearch,
  type CatalogProduct,
  type CatalogQuery,
  type CatalogSort,
  type Localized,
} from "../lib/catalog";
import { formatNumber, formatTaka, useI18n, type DictKey } from "../lib/i18n";
import { useRouter } from "../lib/router";
import { Eyebrow } from "../components/common/SectionHeading";
import { ProductCard } from "../components/home/ProductCard";

const SORTS: { value: CatalogSort; key: DictKey }[] = [
  { value: "relevance", key: "shop.sortRelevance" },
  { value: "price-asc", key: "shop.sortPriceAsc" },
  { value: "price-desc", key: "shop.sortPriceDesc" },
  { value: "rating-desc", key: "shop.sortRating" },
  { value: "discount-desc", key: "shop.sortDiscount" },
  { value: "newest", key: "shop.sortNewest" },
];

const RATINGS = [
  { value: 4, key: "shop.rating4" as const },
  { value: 4.5, key: "shop.rating45" as const },
];

const MAX_PRICE_TAKA = 100_000;

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, MAX_PRICE_TAKA) : undefined;
}

function parseQuery(search: string): CatalogQuery {
  const params = new URLSearchParams(search);
  const sort = params.get("sort");
  const minTaka = numberParam(params, "min");
  const maxTaka = numberParam(params, "max");
  return {
    q: params.get("q")?.trim() || undefined,
    category: params.get("category") || undefined,
    brand: params.get("brand") || undefined,
    minPrice: minTaka === undefined ? undefined : Math.round(minTaka * 100),
    maxPrice: maxTaka === undefined ? undefined : Math.round(maxTaka * 100),
    rating: numberParam(params, "rating"),
    inStock: params.get("stock") === "1" ? true : undefined,
    option: params.get("option") || undefined,
    sort: SORTS.some((entry) => entry.value === sort) ? (sort as CatalogSort) : undefined,
  };
}

const selectClass =
  "h-10 w-full appearance-none rounded-full border border-[var(--site-border)] bg-[var(--surface-raised)] px-4 pr-9 text-sm font-medium text-foreground outline-none transition focus-visible:border-[var(--site-accent)]";

function SelectShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-[var(--site-border)] py-4 first:border-t-0 first:pt-0">
      <legend className="mb-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition";

function FilterPanel({
  query,
  onChange,
  onClear,
}: {
  query: CatalogQuery;
  onChange: (key: string, value: string | null) => void;
  onClear: () => void;
}) {
  const { t, lang } = useI18n();
  const { categories, products } = useCatalog();
  const [minDraft, setMinDraft] = useState(
    query.minPrice === undefined ? "" : String(Math.round(query.minPrice / 100)),
  );
  const [maxDraft, setMaxDraft] = useState(
    query.maxPrice === undefined ? "" : String(Math.round(query.maxPrice / 100)),
  );
  const [syncedMin, setSyncedMin] = useState(query.minPrice);
  const [syncedMax, setSyncedMax] = useState(query.maxPrice);

  if (syncedMin !== query.minPrice) {
    setSyncedMin(query.minPrice);
    setMinDraft(query.minPrice === undefined ? "" : String(Math.round(query.minPrice / 100)));
  }
  if (syncedMax !== query.maxPrice) {
    setSyncedMax(query.maxPrice);
    setMaxDraft(query.maxPrice === undefined ? "" : String(Math.round(query.maxPrice / 100)));
  }

  const options = useMemo(() => {
    const map = new Map<
      string,
      { value: string; type: "color" | "size"; label: Localized; swatch: string | null }
    >();
    for (const product of products) {
      for (const variant of product.variants) {
        const value = variant.label.en.toLowerCase();
        if (!map.has(value)) {
          map.set(value, {
            value,
            type: variant.optionType,
            label: variant.label,
            swatch: variant.swatch,
          });
        }
      }
    }
    return [...map.values()].sort((left, right) => {
      if (left.type !== right.type) return left.type === "color" ? -1 : 1;
      return left.label.en.localeCompare(right.label.en);
    });
  }, [products]);

  const applyPrice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clamp = (value: number) => Math.min(Math.max(Math.round(value), 0), MAX_PRICE_TAKA);
    const rawMin = Number(minDraft);
    const rawMax = Number(maxDraft);
    let min = minDraft.trim() && Number.isFinite(rawMin) && rawMin >= 0 ? clamp(rawMin) : undefined;
    let max = maxDraft.trim() && Number.isFinite(rawMax) && rawMax >= 0 ? clamp(rawMax) : undefined;
    if (min !== undefined && max !== undefined && min > max) {
      [min, max] = [max, min];
    }
    const params = new URLSearchParams();
    if (min !== undefined) params.set("min", String(min));
    if (max !== undefined) params.set("max", String(max));
    onChange("price", params.toString());
  };

  const brands = useMemo(() => {
    const set = new Set(
      products
        .map((product) => product.brand)
        .filter((brand): brand is string => typeof brand === "string" && brand.length > 0),
    );
    return [...set].sort((left, right) => left.localeCompare(right));
  }, [products]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <SlidersHorizontal aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
          {t("shop.filters")}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-[0.7rem] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          {t("shop.clear")}
        </button>
      </div>

      <FilterSection title={t("shop.category")}>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={!query.category}
            onClick={() => onChange("category", null)}
            className={cn(
              chipClass,
              !query.category
                ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
            )}
          >
            {t("shop.allCategories")}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={query.category === category.id}
              onClick={() => onChange("category", category.id)}
              className={cn(
                chipClass,
                query.category === category.id
                  ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                  : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
              )}
            >
              {category.name[lang]}
            </button>
          ))}
        </div>
      </FilterSection>

      {brands.length > 1 ? (
        <FilterSection title={t("shop.brand")}>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={!query.brand}
              onClick={() => onChange("brand", null)}
              className={cn(
                chipClass,
                !query.brand
                  ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                  : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
              )}
            >
              {t("shop.allBrands")}
            </button>
            {brands.map((brand) => (
              <button
                key={brand}
                type="button"
                aria-pressed={query.brand?.toLowerCase() === brand.toLowerCase()}
                onClick={() => onChange("brand", brand)}
                className={cn(
                  chipClass,
                  query.brand?.toLowerCase() === brand.toLowerCase()
                    ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                    : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
                )}
              >
                {brand}
              </button>
            ))}
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title={t("shop.price")}>
        <form onSubmit={applyPrice} className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[0.65rem] text-muted-foreground">
              {t("shop.priceMin")}
            </span>
            <input
              type="number"
              min={0}
              max={MAX_PRICE_TAKA}
              step={1}
              inputMode="numeric"
              value={minDraft}
              onChange={(event) => setMinDraft(event.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--site-border)] bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-[0.65rem] text-muted-foreground">
              {t("shop.priceMax")}
            </span>
            <input
              type="number"
              min={0}
              max={MAX_PRICE_TAKA}
              step={1}
              inputMode="numeric"
              value={maxDraft}
              onChange={(event) => setMaxDraft(event.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--site-border)] bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
            />
          </label>
          <button
            type="submit"
            className="h-9 shrink-0 rounded-lg border border-[var(--site-border)] px-2.5 text-xs font-semibold text-foreground transition hover:border-[var(--site-accent)]"
          >
            {t("shop.priceApply")}
          </button>
        </form>
      </FilterSection>

      <FilterSection title={t("shop.rating")}>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={query.rating === undefined}
            onClick={() => onChange("rating", null)}
            className={cn(
              chipClass,
              query.rating === undefined
                ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
            )}
          >
            {t("shop.ratingAny")}
          </button>
          {RATINGS.map((rating) => (
            <button
              key={rating.value}
              type="button"
              aria-pressed={query.rating === rating.value}
              onClick={() => onChange("rating", String(rating.value))}
              className={cn(
                chipClass,
                query.rating === rating.value
                  ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                  : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
              )}
            >
              {t(rating.key)}
            </button>
          ))}
        </div>
      </FilterSection>

      {options.length > 0 ? (
        <FilterSection title={t("shop.variant")}>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={!query.option}
              onClick={() => onChange("option", null)}
              className={cn(
                chipClass,
                !query.option
                  ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                  : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
              )}
            >
              {t("shop.variantAny")}
            </button>
            {options.map((option) => (
              <button
                key={`${option.type}-${option.value}`}
                type="button"
                aria-pressed={query.option === option.value}
                onClick={() => onChange("option", option.value)}
                className={cn(
                  chipClass,
                  query.option === option.value
                    ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                    : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
                )}
              >
                {option.swatch ? (
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border border-[var(--site-border)]"
                    style={{ backgroundColor: option.swatch }}
                  />
                ) : null}
                {option.label[lang]}
              </button>
            ))}
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title={t("shop.stock")}>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            checked={query.inStock === true}
            onChange={(event) => onChange("stock", event.target.checked ? "1" : null)}
            className="size-4 cursor-pointer rounded border border-[var(--site-border)] accent-[var(--site-accent)]"
          />
          {t("shop.inStockOnly")}
        </label>
      </FilterSection>
    </div>
  );
}

function SkeletonGrid() {
  const { t } = useI18n();
  return (
    <div>
      <p className="sr-only" role="status">
        {t("shop.loading")}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="glass overflow-hidden rounded-[var(--radius-card)]"
            aria-hidden="true"
          >
            <div className="p-3 pb-0">
              <div className="aspect-square animate-pulse rounded-[calc(var(--radius-card)-0.35rem)] bg-[var(--surface-sunken)]" />
            </div>
            <div className="space-y-2 p-4">
              <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
              <div className="h-4 w-4/5 animate-pulse rounded-full bg-[var(--surface-sunken)]" />
              <div className="h-3 w-full animate-pulse rounded-full bg-[var(--surface-sunken)]" />
              <div className="h-9 w-full animate-pulse rounded-full bg-[var(--surface-sunken)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShopPage() {
  const { t, lang } = useI18n();
  const { search, navigate } = useRouter();
  const query = useMemo(() => parseQuery(search), [search]);
  const { data, status, error, reload } = useCatalogSearch(query, { enabled: true });
  const { categories } = useCatalog();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(search);
    mutate(params);
    const next = params.toString();
    navigate(`/shop${next ? `?${next}` : ""}`, { replace: true, scroll: false });
  };

  const setParam = (key: string, value: string | null) => {
    updateParams((params) => {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    });
  };

  const handleFilterChange = (key: string, value: string | null) => {
    updateParams((params) => {
      if (key === "price") {
        params.delete("min");
        params.delete("max");
        const next = new URLSearchParams(value ?? "");
        const min = next.get("min");
        const max = next.get("max");
        if (min) params.set("min", min);
        if (max) params.set("max", max);
        return;
      }
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    });
  };

  const clearFilters = () => {
    updateParams((params) => {
      for (const key of ["q", "category", "brand", "min", "max", "rating", "stock", "option", "sort"]) {
        params.delete(key);
      }
    });
  };

  const products: CatalogProduct[] = data?.products ?? [];
  const total = data?.total ?? 0;
  const loading = status === "loading" && !data;
  const failed = status === "error" && !data;

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (query.q) {
    activeChips.push({ key: "q", label: `“${query.q}”`, clear: () => setParam("q", null) });
  }
  if (query.category) {
    const category = categories.find((entry) => entry.id === query.category);
    activeChips.push({
      key: "category",
      label: category?.name[lang] ?? String(query.category),
      clear: () => setParam("category", null),
    });
  }
  if (query.brand) {
    activeChips.push({ key: "brand", label: query.brand, clear: () => setParam("brand", null) });
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const min = query.minPrice === undefined ? 0 : query.minPrice / 100;
    const max = query.maxPrice === undefined ? null : query.maxPrice / 100;
    activeChips.push({
      key: "price",
      label:
        max === null
          ? `${formatTaka(min, lang)}+`
          : `${formatTaka(min, lang)} – ${formatTaka(max, lang)}`,
      clear: () => updateParams((params) => {
        params.delete("min");
        params.delete("max");
      }),
    });
  }
  if (query.rating !== undefined) {
    activeChips.push({
      key: "rating",
      label: query.rating >= 4.5 ? t("shop.rating45") : t("shop.rating4"),
      clear: () => setParam("rating", null),
    });
  }
  if (query.option) {
    activeChips.push({
      key: "option",
      label: query.option,
      clear: () => setParam("option", null),
    });
  }
  if (query.inStock) {
    activeChips.push({
      key: "stock",
      label: t("shop.inStockOnly"),
      clear: () => setParam("stock", null),
    });
  }

  const panel = (
    <FilterPanel query={query} onChange={handleFilterChange} onClear={clearFilters} />
  );

  return (
    <section className="container-page pt-6 pb-20 sm:pt-10">
      <header className="max-w-2xl">
        <Eyebrow>{t("shop.eyebrow")}</Eyebrow>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">
          {query.q ? t("shop.resultsFor", { q: query.q }) : t("shop.title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t("shop.body")}
        </p>
        {query.q ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("shop.searchNote")}</p>
        ) : null}
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="glass sticky top-24 rounded-[var(--radius-card)] p-5">{panel}</div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-foreground" role="status" aria-live="polite">
              {loading
                ? t("shop.loading")
                : t("shop.results", { count: formatNumber(total, lang) })}
            </p>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--site-border)] px-4 text-sm font-medium text-foreground transition hover:border-[var(--site-accent)] lg:hidden"
              >
                <Filter aria-hidden="true" className="size-4" />
                {t("shop.filters")}
                {activeChips.length > 0 ? (
                  <span className="grid min-w-5 place-items-center rounded-full bg-[var(--site-accent)] px-1 text-[0.65rem] font-bold text-[var(--site-on-accent)]">
                    {formatNumber(activeChips.length, lang)}
                  </span>
                ) : null}
              </button>

              <label className="flex items-center gap-2">
                <span className="sr-only">{t("shop.sort")}</span>
                <SelectShell>
                  <select
                    value={query.sort ?? "relevance"}
                    onChange={(event) =>
                      setParam("sort", event.target.value === "relevance" ? null : event.target.value)
                    }
                    className={selectClass}
                  >
                    {SORTS.map((sort) => (
                      <option key={sort.value} value={sort.value}>
                        {t(sort.key)}
                      </option>
                    ))}
                  </select>
                </SelectShell>
              </label>
            </div>
          </div>

          {activeChips.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.clear}
                  aria-label={t("shop.clearOne", { name: chip.label })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-[color-mix(in_srgb,var(--site-accent)_20%,transparent)]"
                >
                  {chip.label}
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("shop.clear")}
              </button>
            </div>
          ) : null}

          <div className="mt-5">
            {failed ? (
              <div className="glass flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-14 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--danger-ink)]">
                  <SearchX aria-hidden="true" className="size-6" />
                </span>
                <p className="font-heading text-lg font-semibold text-foreground">
                  {t("shop.error")}
                </p>
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
              <SkeletonGrid />
            ) : products.length === 0 ? (
              <div className="glass flex flex-col items-center gap-3 rounded-[var(--radius-card)] px-6 py-14 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-[var(--surface-sunken)] text-muted-foreground">
                  <SearchX aria-hidden="true" className="size-6" />
                </span>
                <p className="font-heading text-lg font-semibold text-foreground">
                  {t("shop.empty")}
                </p>
                <p className="max-w-sm text-sm text-muted-foreground">{t("shop.emptyBody")}</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-1 inline-flex h-10 items-center gap-2 rounded-full border border-[var(--site-border)] px-5 text-sm font-semibold text-foreground transition hover:border-[var(--site-accent)]"
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                  {t("shop.clear")}
                </button>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product, index) => (
                  <li key={product.id} className="h-full">
                    <ProductCard
                      product={product}
                      index={index}
                      animate={index < 12}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="left"
          className="gap-0 border-r border-[var(--site-border)] p-0"
          style={{ backgroundColor: "var(--surface-raised)", width: "90%", maxWidth: "22rem" }}
        >
          <SheetHeader className="border-b border-[var(--site-border)] px-5 py-4 pr-12">
            <SheetTitle className="text-left font-heading text-base">
              {t("shop.filtersTitle")}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin" data-lenis-prevent>
            {panel}
          </div>
          <div className="border-t border-[var(--site-border)] p-4">
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="w-full rounded-full bg-[var(--site-accent)] px-5 py-3 text-sm font-semibold text-[var(--site-on-accent)]"
            >
              {t("shop.results", { count: formatNumber(total, lang) })}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
