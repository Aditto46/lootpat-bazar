import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useCatalog, type CatalogProduct } from "./catalog";
import { useI18n } from "./i18n";

const STORAGE_KEY = "lp-compare-v1";
const MAX_COMPARE = 3;

type CompareContextValue = {
  ids: string[];
  products: CatalogProduct[];
  has: (productId: string) => boolean;
  toggle: (product: CatalogProduct) => void;
  remove: (productId: string) => void;
  clear: () => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const CompareContext = createContext<CompareContextValue | null>(null);

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string").slice(0, MAX_COMPARE);
  } catch {
    return [];
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const { byId } = useCatalog();
  const [ids, setIds] = useState<string[]>(readStored);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, [ids]);

  const has = useCallback((productId: string) => ids.includes(productId), [ids]);

  const toggle = useCallback(
    (product: CatalogProduct) => {
      setIds((current) => {
        if (current.includes(product.id)) {
          toast.message(t("compare.removed"), { description: product.name[lang] });
          return current.filter((id) => id !== product.id);
        }
        if (current.length >= MAX_COMPARE) {
          toast.warning(t("compare.limit"));
          return current;
        }
        toast.success(t("compare.added"), { description: product.name[lang] });
        return [...current, product.id];
      });
    },
    [t, lang],
  );

  const remove = useCallback((productId: string) => {
    setIds((current) => current.filter((id) => id !== productId));
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    setIsOpen(false);
  }, []);

  const products = useMemo(
    () => ids.flatMap((id) => {
      const product = byId(id);
      return product ? [product] : [];
    }),
    [ids, byId],
  );

  const value = useMemo<CompareContextValue>(
    () => ({
      ids,
      products,
      has,
      toggle,
      remove,
      clear,
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }),
    [ids, products, has, toggle, remove, clear, isOpen],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareContextValue {
  const context = useContext(CompareContext);
  if (!context) throw new Error("useCompare must be used inside CompareProvider");
  return context;
}
