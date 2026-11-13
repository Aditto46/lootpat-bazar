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
import type { CatalogProduct } from "./catalog";
import { useI18n } from "./i18n";

export type WishlistEntry = { id: string; slug: string; addedAt: number };

type WishlistContextValue = {
  entries: WishlistEntry[];
  count: number;
  has: (productId: string) => boolean;
  toggle: (product: CatalogProduct) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

const STORAGE_KEY = "lp-wishlist-v2";

const WishlistContext = createContext<WishlistContextValue | null>(null);

function readStored(): WishlistEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        "slug" in entry &&
        "addedAt" in entry &&
        typeof entry.id === "string" &&
        typeof entry.slug === "string" &&
        typeof entry.addedAt === "number"
      ) {
        return [{ id: entry.id, slug: entry.slug, addedAt: entry.addedAt }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<WishlistEntry[]>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, [entries]);

  const has = useCallback(
    (productId: string) => entries.some((entry) => entry.id === productId),
    [entries],
  );

  const toggle = useCallback(
    (product: CatalogProduct) => {
      setEntries((current) => {
        const exists = current.some((entry) => entry.id === product.id);
        if (exists) {
          toast.message(t("wishlist.removed"), { description: product.name[lang] });
          return current.filter((entry) => entry.id !== product.id);
        }
        toast.success(t("wishlist.added"), { description: product.name[lang] });
        return [{ id: product.id, slug: product.slug, addedAt: Date.now() }, ...current];
      });
    },
    [t, lang],
  );

  const remove = useCallback((productId: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== productId));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo<WishlistContextValue>(
    () => ({ entries, count: entries.length, has, toggle, remove, clear }),
    [entries, has, toggle, remove, clear],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used inside WishlistProvider");
  return context;
}

const RECENT_KEY = "lp-recent-v2";
const RECENT_LIMIT = 8;

export function readRecentSlugs(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((slug): slug is string => typeof slug === "string") : [];
  } catch {
    return [];
  }
}

export function rememberProduct(slug: string) {
  try {
    const next = [slug, ...readRecentSlugs().filter((item) => item !== slug)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage failures */
  }
}
