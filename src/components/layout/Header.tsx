import { Heart, Menu, Moon, Search, ShoppingBag, Sun, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { formatNumber, useI18n } from "../../lib/i18n";
import { Link, useRouter } from "../../lib/router";
import { useTheme } from "../../lib/theme";
import { useWishlist } from "../../lib/wishlist";
import { Logo } from "../common/Logo";
import { SearchDialog } from "../search/SearchDialog";

const navItems = [
  { key: "nav.home", href: "/" },
  { key: "nav.shop", href: "/shop" },
  { key: "nav.categories", href: "/#categories" },
  { key: "nav.deals", href: "/#deals" },
  { key: "nav.support", href: "/#support" },
] as const;

const iconButtonClass =
  "relative inline-flex size-10 items-center justify-center rounded-full border border-transparent text-muted-foreground transition hover:border-[var(--site-border)] hover:bg-[var(--surface-raised)] hover:text-foreground";

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { count, openCart } = useCart();
  const { count: wishCount } = useWishlist();
  const { user } = useAuth();
  const { path } = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const canSeeAdmin = Boolean(user?.role.is_staff && user.permissions.includes("team.read"));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 border-b transition-[background-color,box-shadow,border-color] duration-300",
          scrolled
            ? "border-[var(--site-border)] bg-[color-mix(in_srgb,var(--site-bg)_76%,transparent)] shadow-[0_18px_50px_-38px_rgba(0,0,0,0.9)] backdrop-blur-xl"
            : "border-transparent bg-transparent",
        )}
      >
        <div className="container-page flex h-16 items-center gap-2 sm:h-[4.5rem] sm:gap-3">
          <button
            type="button"
            className={cn(iconButtonClass, "lg:hidden")}
            aria-label={t("actions.menu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>

          <Link to="/#top" className="shrink-0 rounded-lg" aria-label="লুটপাট বাজার — হোম">
            <Logo />
          </Link>

          <nav aria-label="প্রধান নেভিগেশন" className="ml-5 hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                aria-current={path === item.href ? "page" : undefined}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground aria-[current=page]:text-foreground"
              >
                {t(item.key)}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="glass-soft hidden h-10 w-56 items-center gap-2 rounded-full px-4 text-sm text-muted-foreground transition hover:text-foreground md:flex"
              aria-label={t("search.open")}
            >
              <Search aria-hidden="true" className="size-4" />
              <span className="truncate">{t("search.placeholder")}</span>
              <kbd className="ml-auto rounded border border-[var(--site-border)] px-1.5 py-0.5 text-[0.62rem] font-medium">
                ⌘K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={cn(iconButtonClass, "md:hidden")}
              aria-label={t("search.open")}
            >
              <Search aria-hidden="true" className="size-5" />
            </button>

            {canSeeAdmin ? (
              <Link
                to="/admin"
                className="hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground lg:inline-flex"
              >
                {t("nav.admin")}
              </Link>
            ) : null}

            <div
              className="hidden items-center rounded-full border border-[var(--site-border)] p-0.5 sm:flex"
              role="group"
              aria-label={t("actions.language")}
            >
              {(["bn", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-wide transition",
                    lang === code
                      ? "bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {code === "bn" ? "বাং" : "EN"}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className={iconButtonClass}
              aria-label={theme === "dark" ? t("actions.themeLight") : t("actions.themeDark")}
            >
              {theme === "dark" ? (
                <Sun aria-hidden="true" className="size-5" />
              ) : (
                <Moon aria-hidden="true" className="size-5" />
              )}
            </button>

            <Link
              to={user ? "/account" : "/login"}
              className={iconButtonClass}
              aria-label={t("nav.account")}
            >
              {user ? (
                <span
                  aria-hidden="true"
                  className="grid size-7 place-items-center rounded-full bg-[var(--site-accent)] text-[0.7rem] font-bold text-[var(--site-on-accent)]"
                >
                  {user.name.trim().slice(0, 1)}
                </span>
              ) : (
                <UserRound aria-hidden="true" className="size-5" />
              )}
            </Link>

            <Link
              to="/wishlist"
              className={iconButtonClass}
              aria-label={`${t("wishlist.title")} — ${t("wishlist.count", { count: formatNumber(wishCount, lang) })}`}
            >
              <Heart aria-hidden="true" className="size-5" />
              {wishCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full bg-[#FF5C7A] px-1 text-[0.62rem] font-bold leading-4.5 text-[#24070D]">
                  {formatNumber(wishCount, lang)}
                </span>
              ) : null}
            </Link>

            <button
              type="button"
              onClick={openCart}
              className={iconButtonClass}
              aria-label={`${t("actions.cart")} — ${t("cart.itemCount", { count: formatNumber(count, lang) })}`}
            >
              <ShoppingBag aria-hidden="true" className="size-5" />
              {count > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full bg-[var(--site-accent)] px-1 text-[0.62rem] font-bold leading-4.5 text-[var(--site-on-accent)]">
                  {formatNumber(count, lang)}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="gap-0 border-r border-[var(--site-border)] p-0"
          style={{ backgroundColor: "var(--surface-raised)", width: "86%", maxWidth: "20rem" }}
        >
          <SheetHeader className="border-b border-[var(--site-border)] px-5 py-4 pr-12">
            <SheetTitle className="text-left">
              <Logo />
            </SheetTitle>
          </SheetHeader>

          <nav aria-label="মোবাইল নেভিগেশন" className="flex flex-col gap-1 p-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-[var(--surface-sunken)]"
              >
                {t(item.key)}
              </Link>
            ))}
            <div className="my-2 border-t border-[var(--site-border)]" />
            <Link
              to={user ? "/account" : "/login"}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-[var(--surface-sunken)]"
            >
              <UserRound aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
              {t("nav.account")}
            </Link>
            <Link
              to="/wishlist"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-[var(--surface-sunken)]"
            >
              <Heart aria-hidden="true" className="size-4 text-[var(--brand-rose)]" />
              {t("wishlist.title")}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatNumber(wishCount, lang)}
              </span>
            </Link>
            {canSeeAdmin ? (
              <Link
                to="/admin"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-3 py-3 text-base font-medium text-foreground transition hover:bg-[var(--surface-sunken)]"
              >
                {t("nav.admin")}
              </Link>
            ) : null}
          </nav>

          <div className="mt-auto space-y-4 border-t border-[var(--site-border)] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{t("actions.language")}</span>
              <div
                className="flex items-center rounded-full border border-[var(--site-border)] p-0.5"
                role="group"
                aria-label={t("actions.language")}
              >
                {(["bn", "en"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    aria-pressed={lang === code}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold uppercase transition",
                      lang === code
                        ? "bg-[var(--site-accent)] text-[var(--site-on-accent)]"
                        : "text-muted-foreground",
                    )}
                  >
                    {code === "bn" ? "বাংলা" : "English"}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                openCart();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--site-accent)] px-4 py-3 text-sm font-semibold text-[var(--site-on-accent)]"
            >
              <ShoppingBag aria-hidden="true" className="size-4" />
              {t("actions.cart")} · {formatNumber(count, lang)}
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
