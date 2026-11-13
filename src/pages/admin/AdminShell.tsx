import {
  ArrowLeft,
  ClipboardList,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageSquareQuote,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  ShieldOff,
  UserRoundSearch,
  Users,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { PageLoading, secondaryButtonClass } from "../../components/auth/AuthShell";
import type { OrderStatus, PaymentStatus } from "../../lib/checkout";
import { orderStatusKey, paymentStatusKey } from "../../lib/checkout";
import { useAuth } from "../../lib/auth";
import { useI18n, type DictKey } from "../../lib/i18n";
import { Link, useRouter } from "../../lib/router";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: DictKey;
  icon: typeof LayoutDashboard;
  permission?: string;
  ownerOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: "/admin", label: "admin.navDashboard", icon: LayoutDashboard, permission: "orders.read" },
  { to: "/admin/orders", label: "admin.navOrders", icon: ClipboardList, permission: "orders.read" },
  { to: "/admin/support", label: "admin.navSupport", icon: LifeBuoy, permission: "support.read" },
  { to: "/admin/products", label: "admin.navProducts", icon: Package, permission: "products.read" },
  { to: "/admin/reviews", label: "admin.navReviews", icon: MessageSquareQuote, permission: "reviews.read" },
  { to: "/admin/customers", label: "admin.navCustomers", icon: UserRoundSearch, permission: "customers.read" },
  { to: "/admin/marketing", label: "admin.navMarketing", icon: Megaphone, permission: "marketing.read" },
  {
    to: "/admin/settings",
    label: "admin.navSettings",
    icon: Settings,
    permission: "settings.read",
  },
  { to: "/admin/security", label: "admin.security.nav", icon: ShieldCheck },
  { to: "/admin/team", label: "admin.navTeam", icon: Users, permission: "team.read" },
  {
    to: "/admin/audit",
    label: "admin.navAudit",
    icon: ScrollText,
    permission: "audit.read",
    ownerOnly: true,
  },
];

const STATUS_TONES: Record<OrderStatus, string> = {
  pending: "border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] text-[var(--brand-gold)]",
  confirmed: "border-[color-mix(in_srgb,var(--brand-teal)_45%,transparent)] text-[var(--brand-teal)]",
  packed: "border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] text-[var(--accent-ink)]",
  shipped: "border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] text-[var(--accent-ink)]",
  delivered: "border-[color-mix(in_srgb,var(--site-accent)_60%,transparent)] text-[var(--accent-ink)]",
  returned: "border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] text-[var(--danger-ink)]",
  cancelled: "border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] text-[var(--danger-ink)]",
};

const PAYMENT_TONES: Record<PaymentStatus, string> = {
  unpaid: "border-[var(--site-border)] text-muted-foreground",
  pending: "border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] text-[var(--brand-gold)]",
  paid: "border-[color-mix(in_srgb,var(--site-accent)_55%,transparent)] text-[var(--accent-ink)]",
  failed: "border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] text-[var(--danger-ink)]",
  refunded: "border-[color-mix(in_srgb,var(--brand-rose)_45%,transparent)] text-[var(--brand-rose)]",
};

export function StatusPill({ status, className }: { status: OrderStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold",
        STATUS_TONES[status],
        className,
      )}
    >
      {t(orderStatusKey(status))}
    </span>
  );
}

export function PaymentPill({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold",
        PAYMENT_TONES[status],
        className,
      )}
    >
      {t(paymentStatusKey(status))}
    </span>
  );
}

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("glass rounded-[var(--radius-card)] p-5 sm:p-6", className)} {...props}>
      {children}
    </section>
  );
}

function DeniedCard() {
  const { t } = useI18n();
  return (
    <div className="container-page flex min-h-[58vh] items-center justify-center py-16">
      <div className="glass max-w-md rounded-[var(--radius-card)] p-7 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-[var(--site-border)] bg-[var(--surface-sunken)] text-[var(--danger-ink)]">
          <ShieldOff aria-hidden="true" className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-bold">{t("auth.noAccessTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("auth.noAccessBody")}
        </p>
        <Link to="/account" className={cn(secondaryButtonClass, "mt-5")}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("nav.account")}
        </Link>
      </div>
    </div>
  );
}

export function AdminShell({
  eyebrow,
  title,
  body,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { status, user, hasPermission } = useAuth();
  const { path, navigate } = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
    } else if (
      status === "authenticated" &&
      user?.twoFactor.setupRequired &&
      path !== "/admin/security"
    ) {
      navigate("/admin/security", { replace: true });
    }
  }, [status, user, navigate, path]);

  if (status !== "authenticated" || !user) {
    return <PageLoading label={t("auth.loading")} />;
  }

  const navItems = NAV.filter(
    (item) =>
      (!item.permission || hasPermission(item.permission)) &&
      (!item.ownerOnly || (user.role.id === "owner" && user.role.is_staff)),
  );
  if (!user.role.is_staff || navItems.length === 0) return <DeniedCard />;

  return (
    <div className="relative overflow-hidden pb-20 pt-8 sm:pt-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-28 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--site-accent)_12%,transparent),transparent_70%)]"
      />
      <div className="container-page relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/account"
            className="inline-flex items-center gap-2 rounded-full text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("nav.account")}
          </Link>
          <span className="rounded-full border border-[var(--site-border)] px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("admin.eyebrow")} · {user.name}
          </span>
        </div>

        <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-[var(--accent-ink)]">
              <span
                aria-hidden="true"
                className="h-px w-6 bg-gradient-to-r from-[var(--brand-teal)] to-transparent"
              />
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{body}</p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>

        <nav aria-label={t("admin.title")} className="mt-7">
          <ul className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.to === "/admin" ? path === "/admin" : path === item.to || path.startsWith(`${item.to}/`);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition",
                      active
                        ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                        : "border-[var(--site-border)] text-muted-foreground hover:border-[var(--accent-ink)] hover:text-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {t(item.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
