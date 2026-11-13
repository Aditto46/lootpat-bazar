import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiRequest } from "./api";

export type Localized = { bn: string; en: string };

export type ProductBadge = "bestseller" | "new" | "limited";

export type CatalogVariant = {
  id: string;
  sku: string;
  optionType: "color" | "size";
  label: Localized;
  pricePaisa: number;
  stock: number;
  swatch: string | null;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  categoryId: string;
  brand: string | null;
  name: Localized;
  tagline: Localized;
  description: Localized;
  pricePaisa: number;
  compareAtPaisa: number | null;
  stock: number;
  lowStockThreshold: number;
  rating: number;
  reviews: number;
  badge: ProductBadge | null;
  image: string;
  imageSmall: string;
  featured: boolean;
  variants: CatalogVariant[];
};

export type CatalogCategory = {
  id: string;
  slug: string;
  name: Localized;
  blurb: Localized;
  accent: string;
  icon: string;
};

export type Facet = { value: string; count: number };

export type CatalogFacets = {
  brands: Facet[];
  categories: Facet[];
  colors: Facet[];
  sizes: Facet[];
  price: { minPaisa: number; maxPaisa: number };
};

export type CatalogSort =
  | "relevance"
  | "price-asc"
  | "price-desc"
  | "rating-desc"
  | "discount-desc"
  | "newest";

export type CatalogQuery = {
  q?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  option?: string;
  sort?: CatalogSort;
  featured?: boolean;
  limit?: number;
};

export type CatalogListResult = {
  products: CatalogProduct[];
  total: number;
  facets: CatalogFacets;
};

type CatalogContextValue = {
  status: "loading" | "ready" | "error";
  products: CatalogProduct[];
  categories: CatalogCategory[];
  error: string | null;
  reload: () => void;
  bySlug: (slug: string) => CatalogProduct | undefined;
  byId: (id: string) => CatalogProduct | undefined;
  categoryName: (id: string) => string | undefined;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

export function buildCatalogQuery(query: CatalogQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.brand) params.set("brand", query.brand);
  if (query.minPrice !== undefined) params.set("minPrice", String(query.minPrice));
  if (query.maxPrice !== undefined) params.set("maxPrice", String(query.maxPrice));
  if (query.rating !== undefined) params.set("rating", String(query.rating));
  if (query.inStock !== undefined) params.set("inStock", String(query.inStock));
  if (query.option) params.set("option", query.option);
  if (query.sort && query.sort !== "relevance") params.set("sort", query.sort);
  if (query.featured !== undefined) params.set("featured", String(query.featured));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const search = params.toString();
  return search ? `?${search}` : "";
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setStatus("loading");
    setError(null);

    Promise.all([
      apiRequest<{ products: CatalogProduct[] }>("/api/catalog/products?limit=60", {
        signal: controller.signal,
      }),
      apiRequest<{ categories: CatalogCategory[] }>("/api/catalog/categories", {
        signal: controller.signal,
      }),
    ])
      .then(([productResponse, categoryResponse]) => {
        if (!active) return;
        setProducts(productResponse.products);
        setCategories(categoryResponse.categories);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setStatus("error");
        setError(cause instanceof ApiError ? cause.code : "network");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [nonce]);

  const productIndex = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const slugIndex = useMemo(
    () => new Map(products.map((product) => [product.slug, product])),
    [products],
  );
  const categoryIndex = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const bySlug = useCallback((slug: string) => slugIndex.get(slug), [slugIndex]);
  const byId = useCallback((id: string) => productIndex.get(id), [productIndex]);
  const categoryName = useCallback(
    (id: string) => categoryIndex.get(id)?.name.en,
    [categoryIndex],
  );

  const value = useMemo<CatalogContextValue>(
    () => ({
      status,
      products,
      categories,
      error,
      reload: () => setNonce((current) => current + 1),
      bySlug,
      byId,
      categoryName,
    }),
    [status, products, categories, error, bySlug, byId, categoryName],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogContextValue {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog must be used inside CatalogProvider");
  return context;
}

type SearchState = {
  status: "loading" | "ready" | "error";
  data: CatalogListResult | null;
  error: string | null;
};

export function useCatalogSearch(
  query: CatalogQuery,
  { debounceMs = 0, enabled = true }: { debounceMs?: number; enabled?: boolean } = {},
) {
  const [state, setState] = useState<SearchState>({ status: "loading", data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const requestKey = buildCatalogQuery(query);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const ticket = latest.current + 1;
    latest.current = ticket;
    setState((current) => (current.data ? { ...current, status: "loading" } : current));

    const timer = window.setTimeout(() => {
      apiRequest<CatalogListResult>(`/api/catalog/products${requestKey}`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (latest.current !== ticket) return;
          setState({ status: "ready", data, error: null });
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          if (latest.current !== ticket) return;
          setState({
            status: "error",
            data: null,
            error: cause instanceof ApiError ? cause.code : "network",
          });
        });
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, debounceMs, enabled, nonce]);

  return useMemo(
    () => ({ ...state, reload: () => setNonce((current) => current + 1) }),
    [state],
  );
}

type DetailState = {
  status: "loading" | "ready" | "not-found" | "error";
  product: CatalogProduct | null;
  error: string | null;
};

export function useCatalogProduct(slug: string | null) {
  const { bySlug, status: catalogStatus, error: catalogError } = useCatalog();
  const cached = slug ? bySlug(slug) : undefined;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<DetailState>({
    status: cached ? "ready" : "loading",
    product: cached ?? null,
    error: null,
  });

  useEffect(() => {
    if (!slug) {
      setState({ status: "not-found", product: null, error: null });
      return;
    }
    if (cached) {
      setState({ status: "ready", product: cached, error: null });
      return;
    }
    if (catalogStatus === "loading") {
      setState({ status: "loading", product: null, error: null });
      return;
    }
    if (catalogStatus === "error") {
      setState({ status: "error", product: null, error: catalogError });
      return;
    }

    const controller = new AbortController();
    apiRequest<{ product: CatalogProduct }>(`/api/catalog/products/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then((response) => setState({ status: "ready", product: response.product, error: null }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (cause instanceof ApiError && cause.status === 404) {
          setState({ status: "not-found", product: null, error: null });
          return;
        }
        setState({
          status: "error",
          product: null,
          error: cause instanceof ApiError ? cause.code : "network",
        });
      });

    return () => controller.abort();
  }, [slug, cached, catalogStatus, catalogError, nonce]);

  return useMemo(
    () => ({ ...state, reload: () => setNonce((current) => current + 1) }),
    [state],
  );
}

export function productPrice(product: CatalogProduct): number {
  return product.pricePaisa / 100;
}

export function variantPrice(variant: CatalogVariant | null | undefined): number | null {
  return variant ? variant.pricePaisa / 100 : null;
}

export function discountPercent(product: CatalogProduct): number {
  if (!product.compareAtPaisa || product.compareAtPaisa <= product.pricePaisa) return 0;
  return Math.round(((product.compareAtPaisa - product.pricePaisa) / product.compareAtPaisa) * 100);
}

export function productAlt(product: CatalogProduct, lang: "bn" | "en"): string {
  return lang === "bn"
    ? `${product.name.bn} — ${product.tagline.bn}`
    : `${product.name.en} — ${product.tagline.en}`;
}

export function formatPriceParts(paisa: number): { taka: number; paisa: number } {
  return { taka: Math.floor(paisa / 100), paisa: paisa % 100 };
}

export function defaultVariant(product: CatalogProduct): CatalogVariant | null {
  return product.variants.find((variant) => variant.stock > 0) ?? product.variants[0] ?? null;
}

export function availableStock(product: CatalogProduct, variant: CatalogVariant | null): number {
  return variant ? variant.stock : product.stock;
}

export function unitPricePaisa(product: CatalogProduct, variant: CatalogVariant | null): number {
  return variant ? variant.pricePaisa : product.pricePaisa;
}

export function showcaseProduct(products: CatalogProduct[]): CatalogProduct | null {
  return products.find((product) => product.slug === "airbeat-pro-earbuds") ?? products[0] ?? null;
}

