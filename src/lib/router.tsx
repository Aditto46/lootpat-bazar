import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

type RouterLocation = { path: string; search: string; hash: string };

type NavigateOptions = { replace?: boolean; scroll?: boolean };

type RouterContextValue = RouterLocation & {
  navigate: (to: string, options?: NavigateOptions) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function readLocation(): RouterLocation {
  return {
    path: normalize(window.location.pathname),
    search: window.location.search,
    hash: window.location.hash,
  };
}

function scrollToTarget(location: RouterLocation) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (location.hash) {
    const scroll = () => {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
    return;
  }
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<RouterLocation>(readLocation);

  useEffect(() => {
    const onPopState = () => setLocation(readLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    const url = new URL(to, window.location.origin);
    const next = {
      path: normalize(url.pathname),
      search: url.search,
      hash: url.hash,
    };
    const target = `${url.pathname}${url.search}${url.hash}`;
    if (options?.replace) window.history.replaceState({}, "", target);
    else window.history.pushState({}, "", target);
    setLocation(next);
    if (options?.scroll !== false) scrollToTarget(next);
  }, []);

  const value = useMemo(
    () => ({ ...location, navigate }),
    [location, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useRouter must be used inside RouterProvider");
  return context;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, children, ...props }: LinkProps) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

// Only same-origin, site-relative targets are accepted for post-login redirects.
export function safeNextPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
