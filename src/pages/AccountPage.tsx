import { ArrowLeft, CalendarClock, KeyRound, LogOut, Mail, Phone, ShieldCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  PageLoading,
  secondaryButtonClass,
  primaryButtonClass,
} from "../components/auth/AuthShell";
import { AccountOrders } from "../components/account/AccountOrders";
import { PrivacyPanel } from "../components/account/PrivacyPanel";
import { LoyaltyCard, ProfileCard } from "../components/marketing/AccountMarketing";
import { useAuth } from "../lib/auth";
import { authErrorKey } from "../lib/authError";
import { formatDateTime, formatNumber, roleName, useI18n } from "../lib/i18n";
import { Link, useRouter } from "../lib/router";
import { cn } from "@/lib/utils";

export function AccountPage() {
  const { t, lang } = useI18n();
  const { status, user, sessionExpiresAt, hasPermission, logout, logoutAll } = useAuth();
  const { navigate } = useRouter();
  const [busy, setBusy] = useState<"out" | "all" | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      navigate(`/login?next=${encodeURIComponent("/account")}`, { replace: true });
    }
  }, [status, navigate]);

  const groupedPermissions = useMemo(() => {
    if (!user) return [];
    const groups = new Map<string, string[]>();
    for (const permission of [...user.permissions].sort()) {
      const [group] = permission.split(".");
      const list = groups.get(group) ?? [];
      list.push(permission);
      groups.set(group, list);
    }
    return [...groups.entries()];
  }, [user]);

  async function signOut(all: boolean) {
    setBusy(all ? "all" : "out");
    try {
      await (all ? logoutAll() : logout());
      toast.success(t(all ? "auth.allSignedOut" : "auth.signedOut"));
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(t(authErrorKey(error)));
      setBusy(null);
    }
  }

  if (status === "loading" || !user) {
    return <PageLoading label={t("auth.loading")} />;
  }

  const initial = user.name.trim().slice(0, 1) || "ল";
  const isCustomer = user.role.id === "customer";

  return (
    <div className="relative overflow-hidden pb-20 pt-8 sm:pt-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-28 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--site-accent)_14%,transparent),transparent_70%)]"
      />
      <div className="container-page relative">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("auth.backHome")}
        </Link>

        <header className="mt-7 max-w-2xl">
          <p className="inline-flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-[var(--accent-ink)]">
            <span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-[var(--brand-teal)] to-transparent" />
            {t("auth.accountEyebrow")}
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
            {t("auth.accountTitle", { name: user.name })}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t("auth.accountBody")}
          </p>
        </header>

        <div className="mt-9 grid items-start gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="glass rounded-[var(--radius-card)] p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-4">
              <span
                aria-hidden="true"
                className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand-teal)] to-[var(--brand-violet)] text-xl font-bold text-[#06110F]"
              >
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-foreground">{user.name}</p>
              </div>
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--site-accent)_10%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--accent-ink)]">
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {roleName(user.role, lang)}
              </span>
            </div>

            <dl className="mt-7 grid gap-4 border-t border-[var(--site-border)] pt-6 text-sm">
              {user.email ? (
                <div className="flex items-center gap-3">
                  <dt className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground">
                    <Mail aria-hidden="true" className="size-4" />
                    {t("auth.email")}
                  </dt>
                  <dd className="truncate text-foreground">{user.email}</dd>
                </div>
              ) : null}
              {user.phone ? (
                <div className="flex items-center gap-3">
                  <dt className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground">
                    <Phone aria-hidden="true" className="size-4" />
                    {t("auth.phone")}
                  </dt>
                  <dd className="truncate text-foreground" dir="ltr">{user.phone}</dd>
                </div>
              ) : null}
              <div className="flex items-center gap-3">
                <dt className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground">
                  <CalendarClock aria-hidden="true" className="size-4" />
                  {t("auth.sessionExpires")}
                </dt>
                <dd className="text-foreground">
                  {sessionExpiresAt ? formatDateTime(sessionExpiresAt, lang) : "—"}
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground">
                  <KeyRound aria-hidden="true" className="size-4" />
                  {t("auth.permissions")}
                </dt>
                <dd className="text-foreground">{formatNumber(user.permissions.length, lang)}</dd>
              </div>
            </dl>

            <div className="mt-7 flex flex-col gap-2.5 border-t border-[var(--site-border)] pt-6 sm:flex-row sm:flex-wrap">
              {user.role.is_staff && hasPermission("team.read") ? (
                <Link to="/admin" className={cn(secondaryButtonClass, "sm:flex-1")}>
                  <Users aria-hidden="true" className="size-4" />
                  {t("auth.adminLink")}
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut(false)}
                disabled={busy !== null}
                className={cn(primaryButtonClass, "h-10 sm:flex-1")}
              >
                <LogOut aria-hidden="true" className="size-4" />
                {t("auth.signOut")}
              </button>
              <button
                type="button"
                onClick={() => void signOut(true)}
                disabled={busy !== null}
                className={cn(secondaryButtonClass, "sm:flex-1")}
              >
                {t("auth.signOutAll")}
              </button>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {t("auth.serverNote")}
            </p>
          </section>

          <section className="glass rounded-[var(--radius-card)] p-5 sm:p-7">
            <h2 className="text-base font-semibold text-foreground">{t("auth.permissions")}</h2>
            {groupedPermissions.length === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {t("auth.noPermissions")}
              </p>
            ) : null}
            <div className="mt-4 space-y-4">
              {groupedPermissions.map(([group, permissions]) => (
                <div key={group}>
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {group}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {permissions.map((permission) => (
                      <li
                        key={permission}
                        className="rounded-md border border-[var(--site-border)] bg-[var(--surface-sunken)] px-2 py-1 font-mono text-[0.68rem] text-muted-foreground"
                      >
                        {permission.split(".")[1]}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>

        {isCustomer ? (
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <LoyaltyCard />
            <ProfileCard />
          </div>
        ) : null}

        <div className="mt-6">
          <PrivacyPanel />
        </div>

        <AccountOrders />
      </div>
    </div>
  );
}
