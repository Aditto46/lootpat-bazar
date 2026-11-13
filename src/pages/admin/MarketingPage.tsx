import {
  BadgePercent,
  Image as ImageIcon,
  Megaphone,
  Percent,
  Plus,
  RefreshCw,
  Rocket,
  Timer,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FormAlert,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { adminErrorKey } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { formatDateTime, formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import {
  createAdminBanner,
  createAdminCampaign,
  createAdminCoupon,
  createAdminFlashSale,
  loadAdminBanners,
  loadAdminCampaigns,
  loadAdminCoupons,
  loadAdminFlashSales,
  loadAdminSpin,
  updateAdminBanner,
  updateAdminCoupon,
  updateAdminFlashSale,
  updateAdminSpin,
  type AdminBanner,
  type AdminCampaignsResponse,
  type AdminCoupon,
  type AdminFlashSale,
  type AdminSpinConfig,
  type CouponKind,
} from "../../lib/marketing";
import { cn } from "@/lib/utils";
import { AdminShell, Panel } from "./AdminShell";

type Tab = "coupons" | "flash" | "spin" | "campaigns" | "banners";

const TABS: Array<{ id: Tab; label: DictKey; icon: typeof Percent }> = [
  { id: "coupons", label: "admin.marketing.tabCoupons", icon: Percent },
  { id: "flash", label: "admin.marketing.tabFlash", icon: Timer },
  { id: "spin", label: "admin.marketing.tabSpin", icon: Wand2 },
  { id: "campaigns", label: "admin.marketing.tabCampaigns", icon: Megaphone },
  { id: "banners", label: "admin.marketing.tabBanners", icon: ImageIcon },
];

const KIND_KEYS: Record<CouponKind, DictKey> = {
  percent: "admin.marketing.kindPercent",
  fixed: "admin.marketing.kindFixed",
  free_shipping: "admin.marketing.kindFree",
};

const SALE_STATUS_KEYS: Record<AdminFlashSale["status"], DictKey> = {
  draft: "admin.marketing.saleDraft",
  active: "admin.marketing.saleActive",
  ended: "admin.marketing.saleEnded",
};

const TONE_CLASSES: Record<AdminBanner["tone"], string> = {
  teal: "border-[color-mix(in_srgb,var(--brand-teal)_45%,transparent)] text-[var(--brand-teal)]",
  violet: "border-[color-mix(in_srgb,var(--brand-violet)_45%,transparent)] text-[var(--brand-violet)]",
  gold: "border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] text-[var(--brand-gold)]",
  rose: "border-[color-mix(in_srgb,var(--brand-rose)_45%,transparent)] text-[var(--brand-rose)]",
};

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function defaultWindow(): { start: string; end: string } {
  const start = new Date();
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
  const local = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  return { start: local(start), end: local(end) };
}

function Taka({ paisa }: { paisa: number }) {
  const { lang } = useI18n();
  return <>{formatTaka(paisa / 100, lang)}</>;
}

export function MarketingPage() {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("marketing.write");

  const [tab, setTab] = useState<Tab>("coupons");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [sales, setSales] = useState<AdminFlashSale[]>([]);
  const [spin, setSpin] = useState<AdminSpinConfig | null>(null);
  const [campaigns, setCampaigns] = useState<AdminCampaignsResponse | null>(null);
  const [banners, setBanners] = useState<AdminBanner[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [couponData, saleData, spinData, campaignData, bannerData] = await Promise.all([
        loadAdminCoupons(),
        loadAdminFlashSales(),
        loadAdminSpin(),
        loadAdminCampaigns(),
        loadAdminBanners(),
      ]);
      setCoupons(couponData.coupons);
      setSales(saleData.sales);
      setSpin(spinData);
      setCampaigns(campaignData);
      setBanners(bannerData.banners);
      setError(null);
    } catch (cause) {
      setError(t(adminErrorKey(cause)));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, done: DictKey) {
    setBusy(true);
    try {
      await action();
      toast.success(t(done));
      await load();
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  // Coupon form.
  const [couponCode, setCouponCode] = useState("");
  const [couponKind, setCouponKind] = useState<CouponKind>("percent");
  const [couponValue, setCouponValue] = useState("");
  const [couponMin, setCouponMin] = useState("");
  const [couponUsage, setCouponUsage] = useState("");

  function submitCoupon() {
    const value =
      couponKind === "free_shipping"
        ? 0
        : couponKind === "percent"
          ? Number(couponValue)
          : Math.round(Number(couponValue) * 100);
    void run(
      () =>
        createAdminCoupon({
          code: couponCode.trim().toUpperCase(),
          kind: couponKind,
          value,
          minSubtotalPaisa: couponMin ? Math.round(Number(couponMin) * 100) : 0,
          usageLimit: couponUsage ? Number(couponUsage) : null,
          active: true,
        }),
      "admin.marketing.created",
    ).then(() => {
      setCouponCode("");
      setCouponValue("");
      setCouponMin("");
      setCouponUsage("");
    });
  }

  // Flash sale form.
  const initialWindow = defaultWindow();
  const [flashTitleBn, setFlashTitleBn] = useState("");
  const [flashTitleEn, setFlashTitleEn] = useState("");
  const [flashDiscount, setFlashDiscount] = useState("20");
  const [flashStart, setFlashStart] = useState(initialWindow.start);
  const [flashEnd, setFlashEnd] = useState(initialWindow.end);
  const [flashProducts, setFlashProducts] = useState("");

  function submitFlash() {
    void run(
      () =>
        createAdminFlashSale({
          titleBn: flashTitleBn.trim(),
          titleEn: flashTitleEn.trim(),
          discountPercent: Number(flashDiscount),
          startsAt: toIso(flashStart),
          endsAt: toIso(flashEnd),
          status: "draft",
          productIds: flashProducts
            .split(/[,\s]+/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .slice(0, 12),
        }),
      "admin.marketing.created",
    ).then(() => {
      setFlashTitleBn("");
      setFlashTitleEn("");
      setFlashProducts("");
    });
  }

  // Spin form.
  const [prizeWeights, setPrizeWeights] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!spin) return;
    setPrizeWeights(
      Object.fromEntries(spin.prizes.map((prize) => [prize.id, String(prize.weight)])),
    );
  }, [spin]);

  // Campaign form.
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [subject, setSubject] = useState("");
  const [campaignBody, setCampaignBody] = useState("");
  const [audience, setAudience] = useState<"all" | "vip" | "inactive">("all");
  const [sendNow, setSendNow] = useState(false);

  function submitCampaign() {
    void run(
      () =>
        createAdminCampaign({
          channel,
          subject: channel === "email" ? subject.trim() : "",
          body: campaignBody.trim(),
          audience,
          send: sendNow,
        }),
      sendNow ? "admin.marketing.campaignSent" : "admin.marketing.campaignSaved",
    ).then(() => {
      setSubject("");
      setCampaignBody("");
    });
  }

  // Banner form.
  const [bannerTitleBn, setBannerTitleBn] = useState("");
  const [bannerTitleEn, setBannerTitleEn] = useState("");
  const [bannerBodyBn, setBannerBodyBn] = useState("");
  const [bannerBodyEn, setBannerBodyEn] = useState("");
  const [bannerHref, setBannerHref] = useState("/shop");

  function submitBanner() {
    void run(
      () =>
        createAdminBanner({
          titleBn: bannerTitleBn.trim(),
          titleEn: bannerTitleEn.trim(),
          bodyBn: bannerBodyBn.trim(),
          bodyEn: bannerBodyEn.trim(),
          href: bannerHref.trim() || "/shop",
          active: true,
        }),
      "admin.marketing.created",
    ).then(() => {
      setBannerTitleBn("");
      setBannerTitleEn("");
      setBannerBodyBn("");
      setBannerBodyEn("");
    });
  }

  return (
    <AdminShell
      eyebrow={t("admin.marketing.eyebrow")}
      title={t("admin.marketing.title")}
      body={t("admin.marketing.body")}
      actions={
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
          {t("admin.refresh")}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("admin.marketing.title")}>
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                tab === entry.id
                  ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                  : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {t(entry.label)}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-4">
          <FormAlert message={error} />
        </div>
      ) : null}

      {tab === "coupons" ? (
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel>
            <h2 className="font-heading text-base font-semibold text-foreground">
              {t("admin.marketing.tabCoupons")}
            </h2>
            {coupons.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t("admin.marketing.empty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--site-border)]">
                {coupons.map((coupon) => (
                  <li key={coupon.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <span className="font-mono text-sm font-semibold text-foreground">{coupon.code}</span>
                    <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] text-muted-foreground">
                      {t(KIND_KEYS[coupon.kind])}
                    </span>
                    <span className="text-xs text-foreground">
                      {coupon.kind === "percent"
                        ? `${coupon.value}%`
                        : coupon.kind === "fixed"
                          ? <Taka paisa={coupon.value} />
                          : "—"}
                    </span>
                    <span className="text-[0.68rem] text-muted-foreground">
                      {coupon.status} · {t("admin.marketing.redemptions")}:{" "}
                      {formatNumber(coupon.redemptions, lang)}
                      {coupon.usageLimit ? ` / ${formatNumber(coupon.usageLimit, lang)}` : ""}
                    </span>
                    {canWrite ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => updateAdminCoupon(coupon.id, { active: !coupon.active }),
                            "admin.marketing.updated",
                          )
                        }
                        className={cn(secondaryButtonClass, "ml-auto h-8 px-3 text-xs")}
                      >
                        {coupon.active ? "⏸" : "▶"} {t("admin.marketing.active")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canWrite ? (
            <Panel>
              <h2 className="inline-flex items-center gap-2 font-heading text-base font-semibold text-foreground">
                <Plus aria-hidden="true" className="size-4" />
                {t("admin.marketing.create")}
              </h2>
              <div className="mt-3 space-y-2.5">
                <div>
                  <label className={labelClass} htmlFor="coupon-code">
                    {t("admin.marketing.code")}
                  </label>
                  <input
                    id="coupon-code"
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                    maxLength={24}
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="coupon-kind">
                    {t("admin.marketing.kind")}
                  </label>
                  <select
                    id="coupon-kind"
                    value={couponKind}
                    onChange={(event) => setCouponKind(event.target.value as CouponKind)}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  >
                    {(Object.keys(KIND_KEYS) as CouponKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {t(KIND_KEYS[kind])}
                      </option>
                    ))}
                  </select>
                </div>
                {couponKind !== "free_shipping" ? (
                  <div>
                    <label className={labelClass} htmlFor="coupon-value">
                      {t("admin.marketing.value")} ({couponKind === "percent" ? "%" : "৳"})
                    </label>
                    <input
                      id="coupon-value"
                      value={couponValue}
                      onChange={(event) => setCouponValue(event.target.value)}
                      inputMode="decimal"
                      dir="ltr"
                      className={cn(fieldClass, "mt-1 h-9 text-sm")}
                    />
                  </div>
                ) : null}
                <div>
                  <label className={labelClass} htmlFor="coupon-min">
                    {t("admin.marketing.minSubtotal")} (৳)
                  </label>
                  <input
                    id="coupon-min"
                    value={couponMin}
                    onChange={(event) => setCouponMin(event.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="coupon-usage">
                    {t("admin.marketing.usageLimit")}
                  </label>
                  <input
                    id="coupon-usage"
                    value={couponUsage}
                    onChange={(event) => setCouponUsage(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <button
                  type="button"
                  disabled={
                    busy ||
                    couponCode.trim().length < 3 ||
                    (couponKind !== "free_shipping" && !Number(couponValue))
                  }
                  onClick={submitCoupon}
                  className={cn(primaryButtonClass, "w-full h-9 text-xs")}
                >
                  <BadgePercent aria-hidden="true" className="size-3.5" />
                  {t("admin.marketing.create")}
                </button>
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "flash" ? (
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel>
            {sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.marketing.empty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--site-border)]">
                {sales.map((sale) => (
                  <li key={sale.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-sm font-semibold text-foreground">{sale.title[lang]}</span>
                      <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] font-semibold text-muted-foreground">
                        {t(SALE_STATUS_KEYS[sale.status])}
                      </span>
                      <span className="text-xs text-[var(--accent-ink)]">−{sale.discountPercent}%</span>
                      <span className="text-xs text-muted-foreground">
                        {sale.items.length} · {formatDateTime(sale.startsAt, lang)}
                      </span>
                    </div>
                    <div className="mt-1 text-[0.68rem] text-muted-foreground">
                      {formatDateTime(sale.startsAt, lang)} → {formatDateTime(sale.endsAt, lang)}
                    </div>
                    {canWrite ? (
                      <div className="mt-2 flex gap-2">
                        {sale.status !== "active" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => updateAdminFlashSale(sale.id, { status: "active" }),
                                "admin.marketing.updated",
                              )
                            }
                            className={cn(secondaryButtonClass, "h-8 px-3 text-xs")}
                          >
                            <Rocket aria-hidden="true" className="size-3.5" />
                            {t("admin.marketing.bannerEnable")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => updateAdminFlashSale(sale.id, { status: "ended" }),
                                "admin.marketing.updated",
                              )
                            }
                            className={cn(secondaryButtonClass, "h-8 px-3 text-xs")}
                          >
                            {t("admin.marketing.saleEnded")}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canWrite ? (
            <Panel>
              <h2 className="font-heading text-base font-semibold text-foreground">
                {t("admin.marketing.create")}
              </h2>
              <div className="mt-3 space-y-2.5">
                <div>
                  <label className={labelClass} htmlFor="flash-title-bn">
                    {t("admin.marketing.flashTitleBn")}
                  </label>
                  <input
                    id="flash-title-bn"
                    value={flashTitleBn}
                    onChange={(event) => setFlashTitleBn(event.target.value)}
                    maxLength={80}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="flash-title-en">
                    {t("admin.marketing.flashTitleEn")}
                  </label>
                  <input
                    id="flash-title-en"
                    value={flashTitleEn}
                    onChange={(event) => setFlashTitleEn(event.target.value)}
                    maxLength={80}
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="flash-discount">
                    {t("admin.marketing.discountPercent")}
                  </label>
                  <input
                    id="flash-discount"
                    value={flashDiscount}
                    onChange={(event) => setFlashDiscount(event.target.value)}
                    inputMode="numeric"
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="flash-start">
                    {t("admin.marketing.startsAt")}
                  </label>
                  <input
                    id="flash-start"
                    type="datetime-local"
                    value={flashStart}
                    onChange={(event) => setFlashStart(event.target.value)}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="flash-end">
                    {t("admin.marketing.endsAt")}
                  </label>
                  <input
                    id="flash-end"
                    type="datetime-local"
                    value={flashEnd}
                    onChange={(event) => setFlashEnd(event.target.value)}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="flash-products">
                    {t("admin.marketing.productIds")}
                  </label>
                  <input
                    id="flash-products"
                    value={flashProducts}
                    onChange={(event) => setFlashProducts(event.target.value)}
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || flashTitleBn.trim().length < 2 || flashTitleEn.trim().length < 2}
                  onClick={submitFlash}
                  className={cn(primaryButtonClass, "w-full h-9 text-xs")}
                >
                  {t("admin.marketing.create")}
                </button>
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "spin" && spin ? (
        <Panel className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold text-foreground">
                {t("admin.marketing.tabSpin")}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("admin.marketing.totalSpins", { count: formatNumber(spin.totalSpins, lang) })}
              </p>
            </div>
            {canWrite ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => updateAdminSpin({ enabled: !spin.enabled }), "admin.marketing.updated")
                }
                className={secondaryButtonClass}
              >
                {spin.enabled ? t("admin.marketing.bannerDisable") : t("admin.marketing.bannerEnable")}
              </button>
            ) : null}
          </div>

          <ul className="mt-4 space-y-2">
            {spin.prizes.map((prize) => (
              <li
                key={prize.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--site-border)] p-3"
              >
                <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {prize.label[lang]}
                </span>
                <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] text-muted-foreground">
                  {t(KIND_KEYS[prize.kind])}
                </span>
                <span className="text-xs text-foreground">
                  {prize.kind === "percent"
                    ? `${prize.value}%`
                    : prize.kind === "fixed"
                      ? <Taka paisa={prize.value} />
                      : "—"}
                </span>
                <label className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                  {t("admin.marketing.prizeWeight")}
                  <input
                    value={prizeWeights[prize.id] ?? String(prize.weight)}
                    onChange={(event) =>
                      setPrizeWeights((current) => ({ ...current, [prize.id]: event.target.value }))
                    }
                    inputMode="numeric"
                    disabled={!canWrite}
                    aria-label={`${t("admin.marketing.prizeWeight")} — ${prize.label[lang]}`}
                    className={cn(fieldClass, "h-8 w-16 text-xs")}
                  />
                </label>
              </li>
            ))}
          </ul>

          {canWrite ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    updateAdminSpin({
                      prizes: spin.prizes.map((prize) => ({
                        id: prize.id,
                        labelBn: prize.label.bn,
                        labelEn: prize.label.en,
                        kind: prize.kind,
                        value: prize.value,
                        weight: Math.max(1, Math.min(100, Number(prizeWeights[prize.id]) || prize.weight)),
                        active: prize.active,
                      })),
                    }),
                  "admin.marketing.updated",
                )
              }
              className={cn(primaryButtonClass, "mt-4 h-9 px-4 text-xs")}
            >
              {t("admin.marketing.save")}
            </button>
          ) : null}
        </Panel>
      ) : null}

      {tab === "campaigns" && campaigns ? (
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel>
            <h2 className="font-heading text-base font-semibold text-foreground">
              {t("admin.marketing.tabCampaigns")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("admin.marketing.campaignEmailNote")}</p>
            {campaigns.campaigns.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("admin.marketing.campaignEmpty")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--site-border)]">
                {campaigns.campaigns.map((campaign) => (
                  <li key={campaign.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] font-semibold uppercase text-muted-foreground">
                        {campaign.channel}
                      </span>
                      <span className="text-sm text-foreground">{campaign.subject || campaign.body}</span>
                      <span className="text-[0.68rem] text-muted-foreground">
                        {campaign.status} · {t("admin.marketing.campaignAudience")}:{" "}
                        {t(`admin.marketing.audience${campaign.audience === "all" ? "All" : campaign.audience === "vip" ? "Vip" : "Inactive"}` as DictKey)} ·{" "}
                        {formatNumber(campaign.recipients, lang)} · {formatDateTime(campaign.createdAt, lang)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-5 text-sm font-semibold text-foreground">
              {t("admin.marketing.reminders")}
            </h3>
            {campaigns.reminders.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">{t("admin.marketing.reminderEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {campaigns.reminders.map((reminder) => (
                  <li key={reminder.id} className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span dir="ltr">{reminder.phone}</span>
                    <span>{formatNumber(reminder.itemCount, lang)}</span>
                    <span>{formatDateTime(reminder.createdAt, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canWrite ? (
            <Panel>
              <h2 className="font-heading text-base font-semibold text-foreground">
                {t("admin.marketing.create")}
              </h2>
              <div className="mt-3 space-y-2.5">
                <div>
                  <label className={labelClass} htmlFor="campaign-channel">
                    {t("admin.marketing.campaignChannel")}
                  </label>
                  <select
                    id="campaign-channel"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value as "sms" | "email")}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  >
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </div>
                {channel === "email" ? (
                  <div>
                    <label className={labelClass} htmlFor="campaign-subject">
                      {t("admin.marketing.campaignSubject")}
                    </label>
                    <input
                      id="campaign-subject"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      maxLength={120}
                      className={cn(fieldClass, "mt-1 h-9 text-sm")}
                    />
                  </div>
                ) : null}
                <div>
                  <label className={labelClass} htmlFor="campaign-body">
                    {t("admin.marketing.campaignBody")}
                  </label>
                  <textarea
                    id="campaign-body"
                    value={campaignBody}
                    onChange={(event) => setCampaignBody(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    className={cn(fieldClass, "mt-1 resize-none text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="campaign-audience">
                    {t("admin.marketing.campaignAudience")}
                  </label>
                  <select
                    id="campaign-audience"
                    value={audience}
                    onChange={(event) => setAudience(event.target.value as typeof audience)}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  >
                    <option value="all">
                      {t("admin.marketing.audienceAll")} ({formatNumber(campaigns.audienceCounts.all, lang)})
                    </option>
                    <option value="vip">
                      {t("admin.marketing.audienceVip")} ({formatNumber(campaigns.audienceCounts.vip, lang)})
                    </option>
                    <option value="inactive">
                      {t("admin.marketing.audienceInactive")} (
                      {formatNumber(campaigns.audienceCounts.inactive, lang)})
                    </option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={sendNow}
                    onChange={(event) => setSendNow(event.target.checked)}
                    className="size-4 rounded border-[var(--site-border)]"
                  />
                  {t("admin.marketing.campaignSend")}
                </label>
                <button
                  type="button"
                  disabled={busy || campaignBody.trim().length < 5}
                  onClick={submitCampaign}
                  className={cn(primaryButtonClass, "w-full h-9 text-xs")}
                >
                  {sendNow ? t("admin.marketing.campaignSend") : t("admin.marketing.save")}
                </button>
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "banners" ? (
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Panel>
            {banners.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("admin.marketing.bannerEmpty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--site-border)]">
                {banners.map((banner) => (
                  <li key={banner.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold", TONE_CLASSES[banner.tone])}>
                      {banner.tone}
                    </span>
                    <span className="min-w-0 text-sm font-semibold text-foreground">{banner.title[lang]}</span>
                    <span className="truncate text-xs text-muted-foreground" dir="ltr">
                      {banner.href}
                    </span>
                    {canWrite ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => updateAdminBanner(banner.id, !banner.active),
                            "admin.marketing.updated",
                          )
                        }
                        className={cn(secondaryButtonClass, "ml-auto h-8 px-3 text-xs")}
                      >
                        {banner.active
                          ? t("admin.marketing.bannerDisable")
                          : t("admin.marketing.bannerEnable")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canWrite ? (
            <Panel>
              <h2 className="font-heading text-base font-semibold text-foreground">
                {t("admin.marketing.create")}
              </h2>
              <div className="mt-3 space-y-2.5">
                <div>
                  <label className={labelClass} htmlFor="banner-title-bn">
                    {t("admin.marketing.flashTitleBn")}
                  </label>
                  <input
                    id="banner-title-bn"
                    value={bannerTitleBn}
                    onChange={(event) => setBannerTitleBn(event.target.value)}
                    maxLength={80}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="banner-title-en">
                    {t("admin.marketing.flashTitleEn")}
                  </label>
                  <input
                    id="banner-title-en"
                    value={bannerTitleEn}
                    onChange={(event) => setBannerTitleEn(event.target.value)}
                    maxLength={80}
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="banner-body-bn">
                    {t("admin.marketing.subtitleBn")}
                  </label>
                  <input
                    id="banner-body-bn"
                    value={bannerBodyBn}
                    onChange={(event) => setBannerBodyBn(event.target.value)}
                    maxLength={200}
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="banner-body-en">
                    {t("admin.marketing.subtitleEn")}
                  </label>
                  <input
                    id="banner-body-en"
                    value={bannerBodyEn}
                    onChange={(event) => setBannerBodyEn(event.target.value)}
                    maxLength={200}
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="banner-href">
                    {t("admin.marketing.bannerHref")}
                  </label>
                  <input
                    id="banner-href"
                    value={bannerHref}
                    onChange={(event) => setBannerHref(event.target.value)}
                    maxLength={200}
                    dir="ltr"
                    className={cn(fieldClass, "mt-1 h-9 text-sm")}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || bannerTitleBn.trim().length < 2 || bannerTitleEn.trim().length < 2}
                  onClick={submitBanner}
                  className={cn(primaryButtonClass, "w-full h-9 text-xs")}
                >
                  {t("admin.marketing.create")}
                </button>
              </div>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </AdminShell>
  );
}
