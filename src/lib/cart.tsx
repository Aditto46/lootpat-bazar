import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  availableStock,
  defaultVariant,
  unitPricePaisa,
  useCatalog,
  type CatalogProduct,
  type CatalogVariant,
} from "./catalog";

type CartLine = { productId: string; variantId: string | null; qty: number };

export type CartItem = {
  key: string;
  product: CatalogProduct;
  variant: CatalogVariant | null;
  qty: number;
  unitPrice: number;
};

type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotal: number;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  addItem: (productId: string, variantId?: string | null, qty?: number) => boolean;
  setQuantity: (key: string, qty: number) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
};

const STORAGE_KEY = "lp-cart-v2";

const CartContext = createContext<CartContextValue | null>(null);

function lineKey(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ""}`;
}

function readStoredLines(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "productId" in entry &&
        "qty" in entry &&
        typeof entry.productId === "string" &&
        typeof entry.qty === "number"
      ) {
        const variantId =
          "variantId" in entry && typeof entry.variantId === "string" ? entry.variantId : null;
        return [{ productId: entry.productId, variantId, qty: Math.max(1, Math.round(entry.qty)) }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { byId } = useCatalog();
  const [lines, setLines] = useState<CartLine[]>(readStoredLines);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, [lines]);

  const addItem = useCallback(
    (productId: string, variantId: string | null = null, qty = 1) => {
      const product = byId(productId);
      if (!product) return false;
      const variant = variantId
        ? (product.variants.find((entry) => entry.id === variantId) ?? null)
        : product.variants.length > 0
          ? defaultVariant(product)
          : null;
      const stock = availableStock(product, variant);
      if (stock <= 0) return false;

      const key = lineKey(product.id, variant?.id ?? null);
      setLines((current) => {
        const existing = current.find((line) => lineKey(line.productId, line.variantId) === key);
        if (!existing) {
          return [
            ...current,
            { productId: product.id, variantId: variant?.id ?? null, qty: Math.min(qty, stock) },
          ];
        }
        return current.map((line) =>
          lineKey(line.productId, line.variantId) === key
            ? { ...line, qty: Math.min(line.qty + qty, stock) }
            : line,
        );
      });
      return true;
    },
    [byId],
  );

  const setQuantity = useCallback(
    (key: string, qty: number) => {
      if (qty <= 0) {
        setLines((current) =>
          current.filter((line) => lineKey(line.productId, line.variantId) !== key),
        );
        return;
      }
      setLines((current) =>
        current.map((line) => {
          if (lineKey(line.productId, line.variantId) !== key) return line;
          const product = byId(line.productId);
          if (!product) return line;
          const variant = line.variantId
            ? (product.variants.find((entry) => entry.id === line.variantId) ?? null)
            : null;
          const stock = availableStock(product, variant);
          return { ...line, qty: Math.max(1, Math.min(qty, stock)) };
        }),
      );
    },
    [byId],
  );

  const removeItem = useCallback((key: string) => {
    setLines((current) =>
      current.filter((line) => lineKey(line.productId, line.variantId) !== key),
    );
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  const items = useMemo<CartItem[]>(
    () =>
      lines.flatMap((line) => {
        const product = byId(line.productId);
        if (!product) return [];
        const variant = line.variantId
          ? (product.variants.find((entry) => entry.id === line.variantId) ?? null)
          : null;
        const qty = Math.min(line.qty, Math.max(availableStock(product, variant), 1));
        return [
          {
            key: lineKey(product.id, variant?.id ?? null),
            product,
            variant,
            qty,
            unitPrice: unitPricePaisa(product, variant) / 100,
          },
        ];
      }),
    [lines, byId],
  );

  const count = useMemo(() => lines.reduce((total, line) => total + line.qty, 0), [lines]);
  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.unitPrice * item.qty, 0),
    [items],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count,
      subtotal,
      isOpen,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      addItem,
      setQuantity,
      removeItem,
      clearCart,
    }),
    [items, count, subtotal, isOpen, addItem, setQuantity, removeItem, clearCart],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside CartProvider");
  }
  return context;
}
