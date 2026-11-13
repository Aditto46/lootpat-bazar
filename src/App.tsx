import Lenis from "lenis";
import { lazy, Suspense, useEffect, useRef, type ComponentType } from "react";
import { Toaster } from "@/components/ui/sonner";
import { CartDrawer } from "./components/cart/CartDrawer";
import { SiteBackdrop } from "./components/common/SiteBackdrop";
import { CompareTray } from "./components/compare/CompareTray";
import { InstallPrompt } from "./components/common/InstallPrompt";
import { Hero } from "./components/hero/Hero";
import { CategoryTiles } from "./components/home/CategoryTiles";
import { FeaturedProducts } from "./components/home/FeaturedProducts";
import { FlashDeal } from "./components/home/FlashDeal";
import { TrustBar } from "./components/home/TrustBar";
import { AnnouncementBar } from "./components/layout/AnnouncementBar";
import { Footer } from "./components/layout/Footer";
import { Header } from "./components/layout/Header";
import { MarketingBanner } from "./components/marketing/MarketingBanner";
import { SpinWheel } from "./components/marketing/SpinWheel";
import { ChatWidget } from "./components/support/ChatWidget";
import { useI18n, type Lang } from "./lib/i18n";
import { useRouter } from "./lib/router";
import { useTheme } from "./lib/theme";

type AnyPage = ComponentType<Record<string, unknown>>;

function lazyPage(loader: () => Promise<unknown>, name: string) {
  return lazy(async () => {
    const module = (await loader()) as Record<string, unknown>;
    return { default: module[name] as AnyPage };
  });
}

const AccountPage = lazyPage(() => import("./pages/AccountPage"), "AccountPage");
const AuditPage = lazyPage(() => import("./pages/admin/AuditPage"), "AuditPage");
const CustomersPage = lazyPage(() => import("./pages/admin/CustomersPage"), "CustomersPage");
const DashboardPage = lazyPage(() => import("./pages/admin/DashboardPage"), "DashboardPage");
const MarketingPage = lazyPage(() => import("./pages/admin/MarketingPage"), "MarketingPage");
const OrdersPage = lazyPage(() => import("./pages/admin/OrdersPage"), "OrdersPage");
const ProductWizard = lazyPage(() => import("./pages/admin/ProductWizard"), "ProductWizard");
const ProductsPage = lazyPage(() => import("./pages/admin/ProductsPage"), "ProductsPage");
const ReviewsPage = lazyPage(() => import("./pages/admin/ReviewsPage"), "ReviewsPage");
const SecurityPage = lazyPage(() => import("./pages/admin/SecurityPage"), "SecurityPage");
const SettingsPage = lazyPage(() => import("./pages/admin/SettingsPage"), "SettingsPage");
const SupportPage = lazyPage(() => import("./pages/admin/SupportPage"), "SupportPage");
const TeamPage = lazyPage(() => import("./pages/admin/TeamPage"), "TeamPage");
const CartPage = lazyPage(() => import("./pages/CartPage"), "CartPage");
const CheckoutPage = lazyPage(() => import("./pages/CheckoutPage"), "CheckoutPage");
const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage");
const NotFoundPage = lazyPage(() => import("./pages/NotFoundPage"), "NotFoundPage");
const OrderPage = lazyPage(() => import("./pages/OrderPage"), "OrderPage");
const PayPage = lazyPage(() => import("./pages/PayPage"), "PayPage");
const PrivacyPage = lazyPage(() => import("./pages/PrivacyPage"), "PrivacyPage");
const ProductPage = lazyPage(() => import("./pages/ProductPage"), "ProductPage");
const RegisterPage = lazyPage(() => import("./pages/RegisterPage"), "RegisterPage");
const ShopPage = lazyPage(() => import("./pages/ShopPage"), "ShopPage");
const TrackPage = lazyPage(() => import("./pages/TrackPage"), "TrackPage");
const WishlistPage = lazyPage(() => import("./pages/WishlistPage"), "WishlistPage");

const BRAND_TITLE: Record<Lang, string> = {
  bn: "লুটপাট বাজার — প্রিমিয়াম পণ্য, লুটপাট দামে",
  en: "LootPat Bazar — Premium products, bargain prices",
};

const pageTitles: Record<string, Record<Lang, string>> = {
  "/shop": { bn: "সব পণ্য", en: "Shop" },
  "/wishlist": { bn: "উইশলিস্ট", en: "Wishlist" },
  "/cart": { bn: "আপনার কার্ট", en: "Your cart" },
  "/checkout": { bn: "চেকআউট", en: "Checkout" },
  "/track": { bn: "অর্ডার ট্র্যাকিং", en: "Order tracking" },
  "/login": { bn: "সাইন ইন", en: "Sign in" },
  "/register": { bn: "নতুন অ্যাকাউন্ট", en: "Create account" },
  "/account": { bn: "আমার অ্যাকাউন্ট", en: "My account" },
  "/admin": { bn: "ড্যাশবোর্ড", en: "Dashboard" },
  "/admin/orders": { bn: "অর্ডার", en: "Orders" },
  "/admin/support": { bn: "সাপোর্ট", en: "Support" },
  "/admin/products": { bn: "পণ্য", en: "Products" },
  "/admin/reviews": { bn: "রিভিউ", en: "Reviews" },
  "/admin/customers": { bn: "কাস্টমার", en: "Customers" },
  "/admin/marketing": { bn: "মার্কেটিং", en: "Marketing" },
  "/admin/products/new": { bn: "নতুন পণ্য", en: "New product" },
  "/admin/team": { bn: "টিম ও অ্যাক্সেস", en: "Team & access" },
  "/admin/security": { bn: "নিরাপত্তা", en: "Security" },
  "/admin/settings": { bn: "দোকান সেটিংস", en: "Store settings" },
  "/admin/audit": { bn: "অডিট লগ", en: "Audit log" },
  "/privacy": { bn: "প্রাইভেসি পলিসি", en: "Privacy policy" },
};

const PRODUCT_PATH = /^\/product\/([^/]+)$/;
const ORDER_PATH = /^\/order\/([A-Za-z0-9-]+)$/;
const PAY_PATH = /^\/pay\/(LP-\d{6}-[0-9A-Z]{6})$/;
const ADMIN_PRODUCT_EDIT_PATH = /^\/admin\/products\/([0-9a-f-]{36})\/edit$/;

function HomeSections() {
  return (
    <>
      <Hero />
      <TrustBar />
      <MarketingBanner />
      <CategoryTiles />
      <FlashDeal />
      <SpinWheel />
      <FeaturedProducts />
    </>
  );
}

function CurrentPage() {
  const { path } = useRouter();
  const productMatch = PRODUCT_PATH.exec(path);
  const orderMatch = ORDER_PATH.exec(path);
  const payMatch = PAY_PATH.exec(path);
  const adminProductMatch = ADMIN_PRODUCT_EDIT_PATH.exec(path);

  if (productMatch) {
    return <ProductPage slug={decodeURIComponent(productMatch[1])} />;
  }

  if (payMatch) {
    return <PayPage orderNumber={payMatch[1]} />;
  }

  if (orderMatch) {
    return <OrderPage orderNumber={orderMatch[1]} />;
  }

  if (adminProductMatch) {
    return <ProductWizard productId={adminProductMatch[1]} />;
  }

  switch (path) {
    case "/":
      return <HomeSections />;
    case "/shop":
      return <ShopPage />;
    case "/wishlist":
      return <WishlistPage />;
    case "/cart":
      return <CartPage />;
    case "/checkout":
      return <CheckoutPage />;
    case "/track":
      return <TrackPage />;
    case "/login":
      return <LoginPage />;
    case "/register":
      return <RegisterPage />;
    case "/account":
      return <AccountPage />;
    case "/admin":
      return <DashboardPage />;
    case "/admin/orders":
      return <OrdersPage />;
    case "/admin/support":
      return <SupportPage />;
    case "/admin/products":
      return <ProductsPage />;
    case "/admin/reviews":
      return <ReviewsPage />;
    case "/admin/customers":
      return <CustomersPage />;
    case "/admin/marketing":
      return <MarketingPage />;
    case "/admin/products/new":
      return <ProductWizard />;
    case "/admin/settings":
      return <SettingsPage />;
    case "/admin/team":
      return <TeamPage />;
    case "/admin/security":
      return <SecurityPage />;
    case "/admin/audit":
      return <AuditPage />;
    case "/privacy":
      return <PrivacyPage />;
    default:
      return <NotFoundPage />;
  }
}

export default function App() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const { path } = useRouter();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [path]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.05, anchors: { offset: -72 } });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = window.requestAnimationFrame(raf);
    };
    frame = window.requestAnimationFrame(raf);
    return () => {
      window.cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    if (PRODUCT_PATH.test(path)) return;
    const page = pageTitles[path];
    if (path === "/") {
      document.title = BRAND_TITLE[lang];
    } else if (ORDER_PATH.test(path)) {
      document.title = `${lang === "bn" ? "অর্ডার" : "Order"} · লুটপাট বাজার`;
    } else if (PAY_PATH.test(path)) {
      document.title = `${lang === "bn" ? "পেমেন্ট" : "Payment"} · লুটপাট বাজার`;
    } else if (ADMIN_PRODUCT_EDIT_PATH.test(path)) {
      document.title = `${lang === "bn" ? "পণ্য এডিট" : "Edit product"} · লুটপাট বাজার`;
    } else if (page) {
      document.title = `${page[lang]} · লুটপাট বাজার`;
    } else {
      document.title = `${lang === "bn" ? "পেজ পাওয়া যায়নি" : "Page not found"} · লুটপাট বাজার`;
    }
  }, [path, lang]);

  return (
    <>
      <SiteBackdrop />
      <a className="skip-link" href="#main">
        {t("actions.skip")}
      </a>
      <AnnouncementBar />
      <Header />
      <main id="main" key={path} ref={mainRef} tabIndex={-1} className="outline-none">
        <Suspense
          fallback={
            <div role="status" aria-live="polite" className="container-page py-24 text-sm text-muted-foreground">
              {t("auth.loading")}
            </div>
          }
        >
          <CurrentPage />
        </Suspense>
      </main>
      <Footer />
      {path.startsWith("/admin") ? null : <ChatWidget />}
      <CompareTray />
      <CartDrawer />
      <InstallPrompt />
      <Toaster theme={theme} position="top-center" closeButton />
    </>
  );
}
