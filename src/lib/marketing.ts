import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "./api";
import type { Localized } from "./catalog";
import type { DictKey } from "./i18n";

export type ReviewPhoto = string;

export type ProductReview = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  photos: ReviewPhoto[];
  customerName: string;
  verifiedPurchase: boolean;
  helpfulCount: number;
  reply: { body: string; at: string | null } | null;
  createdAt: string;
};

export type ProductReviews = {
  productId: string;
  summary: {
    count: number;
    averageTenths: number;
    breakdown: Record<"1" | "2" | "3" | "4" | "5", number>;
  };
  reviews: ProductReview[];
};

export type FlashSaleItem = {
  productId: string;
  slug: string;
  name: Localized;
  image: string;
  imageSmall: string;
  pricePaisa: number;
  compareAtPaisa: number | null;
  salePricePaisa: number;
  stock: number;
  stockLimit: number | null;
  soldCount: number;
};

export type FlashSale = {
  id: string;
  title: Localized;
  subtitle: Localized;
  discountPercent: number;
  bannerImage: string | null;
  startsAt: string;
  endsAt: string;
  items: FlashSaleItem[];
};

export type MarketingBanner = {
  id: string;
  title: Localized;
  body: Localized;
  cta: Localized;
  href: string;
  tone: string;
};

export type SpinPrize = {
  id: string;
  label: Localized;
  kind: "percent" | "fixed" | "free_shipping";
  value: number;
};

export type SpinResult = {
  alreadyPlayed: boolean;
  prize: SpinPrize;
  couponCode: string;
  coupon?: { kind: SpinPrize["kind"]; value: number; expiresAt: string };
};

export type LoyaltyLedgerEntry = {
  id: string;
  points: number;
  reason: string;
  orderNumber: string | null;
  createdAt: string;
};

export type Loyalty = {
  enabled: boolean;
  balance: number;
  valuePaisa: number;
  earn: {
    pointsPer100Taka: number;
    reviewPoints: number;
    redeemMinPoints: number;
    pointValuePaisa: number;
  };
  birthday: {
    code: string;
    kind: "percent" | "fixed" | "free_shipping";
    value: number;
    minSubtotalPaisa: number;
    maxDiscountPaisa: number | null;
    endsAt: string | null;
  } | null;
  ledger: LoyaltyLedgerEntry[];
};

export type CustomerProfile = { name: string; birthDate: string | null };

export function getProductReviews(slug: string, signal?: AbortSignal) {
  return apiRequest<ProductReviews>(
    `/api/catalog/products/${encodeURIComponent(slug)}/reviews`,
    { signal },
  );
}

export function submitReview(input: {
  productId: string;
  orderNumber: string;
  phone: string;
  rating: number;
  title?: string;
  body: string;
  photos: string[];
}) {
  return apiRequest<{ review: { id: string; status: string } }>("/api/reviews", {
    method: "POST",
    body: input,
  });
}

export function markReviewHelpful(reviewId: string, voterKey: string) {
  return apiRequest<{ ok: boolean; helpfulCount: number }>(
    `/api/reviews/${reviewId}/helpful`,
    { method: "POST", body: { voterKey } },
  );
}

export function getFlashSale(signal?: AbortSignal) {
  return apiRequest<{ sale: FlashSale | null }>("/api/marketing/flash-sale", { signal });
}

export function getBanners(signal?: AbortSignal) {
  return apiRequest<{ banners: MarketingBanner[] }>("/api/marketing/banners", { signal });
}

export function getSpinConfig(signal?: AbortSignal) {
  return apiRequest<{ enabled: boolean; prizes: SpinPrize[] }>("/api/marketing/spin", { signal });
}

export function playSpin(visitorKey: string) {
  return apiRequest<SpinResult>("/api/marketing/spin", {
    method: "POST",
    body: { visitorKey },
  });
}

export function requestStockAlert(productId: string, phone: string) {
  return apiRequest<{ ok: boolean; available: boolean }>("/api/marketing/back-in-stock", {
    method: "POST",
    body: { productId, phone },
  });
}

export function unsubscribeAll(contact: string) {
  return apiRequest<{ ok: boolean }>("/api/marketing/unsubscribe", {
    method: "POST",
    body: { contact },
  });
}

export function remindCart(phone: string, itemCount: number) {
  return apiRequest<{ ok: boolean }>("/api/marketing/cart-reminder", {
    method: "POST",
    body: { phone, itemCount, consent: true },
  });
}

export function getLoyalty() {
  return apiRequest<Loyalty>("/api/marketing/loyalty");
}

export function redeemLoyalty(points: number) {
  return apiRequest<{
    coupon: { code: string; kind: "fixed"; value: number; expiresAt: string };
    balance: number;
  }>("/api/marketing/loyalty/redeem", { method: "POST", body: { points } });
}

export function getProfile() {
  return apiRequest<{ profile: CustomerProfile }>("/api/account/profile");
}

export function updateProfile(input: { name?: string; birthDate?: string | null }) {
  return apiRequest<{ profile: CustomerProfile }>("/api/account/profile", {
    method: "PATCH",
    body: input,
  });
}

const VISITOR_KEY = "lp-visitor";
const VOTER_KEY = "lp-voter";

function randomKey(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(36)).join("")}`.slice(0, 48);
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the key simply does not persist */
  }
}

export function visitorKey(): string {
  const stored = readStored(VISITOR_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
  const created = randomKey("v");
  writeStored(VISITOR_KEY, created);
  return created;
}

export function voterKey(): string {
  const stored = readStored(VOTER_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
  const created = randomKey("r");
  writeStored(VOTER_KEY, created);
  return created;
}

export function useFlashSale() {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; sale: FlashSale | null }>({
    status: "loading",
    sale: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    getFlashSale(controller.signal)
      .then((response) => setState({ status: "ready", sale: response.sale }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setState({ status: "error", sale: null });
      });
    return () => controller.abort();
  }, []);

  return state;
}

export function marketingErrorKey(error: unknown): DictKey {
  if (!(error instanceof ApiError)) return "marketing.error.generic";
  const known: string[] = [
    "order_not_found",
    "order_not_delivered",
    "product_not_in_order",
    "review_exists",
    "photo_exif_rejected",
    "payload_too_large",
    "invalid_input",
    "rate_limited",
    "review_unconfirmed",
    "insufficient_points",
    "invalid_points",
    "loyalty_disabled",
    "phone_required",
    "customer_blocked",
  ];
  return known.includes(error.code)
    ? (`marketing.error.${error.code}` as DictKey)
    : "marketing.error.generic";
}

// ---------------------------------------------------------------------------
// Admin marketing, review moderation and customer segments.

export type CouponKind = "percent" | "fixed" | "free_shipping";
export type CouponStatus = "active" | "inactive" | "expired" | "scheduled";

export type AdminCoupon = {
  id: string;
  code: string;
  kind: CouponKind;
  value: number;
  minSubtotalPaisa: number;
  maxDiscountPaisa: number | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  status: CouponStatus;
  redemptions: number;
  createdAt: string;
};

export type AdminCouponInput = {
  code?: string;
  kind?: CouponKind;
  value?: number;
  minSubtotalPaisa?: number;
  maxDiscountPaisa?: number | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  active?: boolean;
};

export type AdminFlashSaleItem = {
  id: string;
  productId: string;
  name: Localized;
  image: string;
  pricePaisa: number;
  salePricePaisa: number;
  stock: number;
  stockLimit: number | null;
  soldCount: number;
};

export type AdminFlashSale = {
  id: string;
  title: Localized;
  subtitle: Localized;
  discountPercent: number;
  bannerImage: string | null;
  status: "draft" | "active" | "ended";
  startsAt: string;
  endsAt: string;
  items: AdminFlashSaleItem[];
  createdAt: string;
};

export type AdminSpinPrize = {
  id: string;
  label: Localized;
  kind: CouponKind;
  value: number;
  weight: number;
  active: boolean;
  position: number;
};

export type AdminSpinConfig = {
  enabled: boolean;
  totalSpins: number;
  prizes: AdminSpinPrize[];
};

export type AdminCampaign = {
  id: string;
  channel: "sms" | "email";
  subject: string;
  body: string;
  audience: "all" | "vip" | "inactive";
  status: "draft" | "sent";
  recipients: number;
  createdAt: string;
  sentAt: string | null;
};

export type AdminCampaignsResponse = {
  campaigns: AdminCampaign[];
  audienceCounts: { all: number; vip: number; inactive: number };
  reminders: Array<{ id: string; phone: string; itemCount: number; createdAt: string }>;
  emailConfigured: boolean;
};

export type AdminReviewStatus = "pending" | "approved" | "rejected";

export type AdminReview = {
  id: string;
  productId: string;
  productName: Localized;
  orderNumber: string;
  customerName: string;
  phone: string;
  rating: number;
  title: string | null;
  body: string;
  photos: string[];
  verifiedPurchase: boolean;
  status: AdminReviewStatus;
  helpfulCount: number;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
};

export type AdminReviewsResponse = {
  reviews: AdminReview[];
  counts: Record<AdminReviewStatus, number>;
};

export type CustomerSegment = "vip" | "inactive" | "new" | "regular";

export type AdminCustomer = {
  phone: string;
  name: string;
  email: string | null;
  orders: number;
  deliveredOrders: number;
  lifetimePaisa: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  createdAt: string | null;
  segment: CustomerSegment;
  noteCount: number;
  points: number;
  blocked: boolean;
  blockReason: string | null;
};

export type AdminCustomerDetail = AdminCustomer & {
  orders: Array<{
    orderNumber: string;
    status: string;
    paymentStatus: string;
    totalPaisa: number;
    createdAt: string;
  }>;
  notes: Array<{ id: string; body: string; createdAt: string }>;
};

export type AdminCustomersResponse = {
  customers: AdminCustomer[];
  counts: { all: number; vip: number; inactive: number; new: number };
};

export type AdminBanner = {
  id: string;
  title: Localized;
  body: Localized;
  cta: Localized;
  href: string;
  tone: "teal" | "violet" | "gold" | "rose";
  active: boolean;
  position: number;
  startsAt: string | null;
  endsAt: string | null;
};

export function loadAdminCoupons() {
  return apiRequest<{ coupons: AdminCoupon[] }>("/api/admin/coupons");
}

export function createAdminCoupon(input: AdminCouponInput & { code: string }) {
  return apiRequest<{ coupon: AdminCoupon }>("/api/admin/coupons", {
    method: "POST",
    body: input,
  });
}

export function updateAdminCoupon(id: string, input: AdminCouponInput) {
  return apiRequest<{ coupon: AdminCoupon }>(`/api/admin/coupons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function loadAdminFlashSales() {
  return apiRequest<{ sales: AdminFlashSale[] }>("/api/admin/flash-sales");
}

export function createAdminFlashSale(input: {
  titleBn: string;
  titleEn: string;
  subtitleBn?: string;
  subtitleEn?: string;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
  status?: "draft" | "active" | "ended";
  productIds?: string[];
}) {
  return apiRequest<{ sale: AdminFlashSale }>("/api/admin/flash-sales", {
    method: "POST",
    body: input,
  });
}

export function updateAdminFlashSale(
  id: string,
  input: {
    titleBn?: string;
    titleEn?: string;
    subtitleBn?: string;
    subtitleEn?: string;
    discountPercent?: number;
    startsAt?: string;
    endsAt?: string;
    status?: "draft" | "active" | "ended";
    productIds?: string[];
  },
) {
  return apiRequest<{ sale: AdminFlashSale }>(
    `/api/admin/flash-sales/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
}

export function loadAdminSpin() {
  return apiRequest<AdminSpinConfig>("/api/admin/spin");
}

export function updateAdminSpin(input: {
  enabled?: boolean;
  prizes?: Array<{
    id?: string;
    labelBn: string;
    labelEn: string;
    kind: CouponKind;
    value: number;
    weight: number;
    active: boolean;
  }>;
}) {
  return apiRequest<AdminSpinConfig>("/api/admin/spin", { method: "PATCH", body: input });
}

export function loadAdminCampaigns() {
  return apiRequest<AdminCampaignsResponse>("/api/admin/campaigns");
}

export function createAdminCampaign(input: {
  channel: "sms" | "email";
  subject?: string;
  body: string;
  audience: "all" | "vip" | "inactive";
  send: boolean;
}) {
  return apiRequest<{
    campaign: AdminCampaign;
    delivery: { smsSent: number; emailSkipped: number; suppressed: number };
  }>("/api/admin/campaigns", { method: "POST", body: input });
}

export function loadAdminReviews(status?: AdminReviewStatus) {
  const query = status ? `?status=${status}` : "";
  return apiRequest<AdminReviewsResponse>(`/api/admin/reviews${query}`);
}

export function updateAdminReview(id: string, input: { status?: "approved" | "rejected"; reply?: string }) {
  return apiRequest<{ review: Pick<AdminReview, "id" | "status" | "reply" | "repliedAt"> }>(
    `/api/admin/reviews/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
}

export function loadAdminCustomers(input: { q?: string; segment?: "all" | CustomerSegment } = {}) {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.segment && input.segment !== "all") params.set("segment", input.segment);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return apiRequest<AdminCustomersResponse>(`/api/admin/customers${query}`);
}

export function loadAdminCustomerDetail(phone: string) {
  return apiRequest<{ customer: AdminCustomerDetail }>(
    `/api/admin/customers/${encodeURIComponent(phone)}`,
  );
}

export function updateAdminCustomer(
  phone: string,
  input: { action: "block" | "unblock" | "note"; reason?: string; note?: string },
) {
  return apiRequest<{ ok?: true; blocked?: boolean; note?: { id: string; body: string; createdAt: string } }>(
    `/api/admin/customers/${encodeURIComponent(phone)}`,
    { method: "PATCH", body: input },
  );
}

export function loadAdminBanners() {
  return apiRequest<{ banners: AdminBanner[] }>("/api/admin/banners");
}

export function createAdminBanner(input: {
  titleBn: string;
  titleEn: string;
  bodyBn?: string;
  bodyEn?: string;
  ctaLabelBn?: string;
  ctaLabelEn?: string;
  href?: string;
  tone?: AdminBanner["tone"];
  active?: boolean;
  position?: number;
  startsAt?: string;
  endsAt?: string;
}) {
  return apiRequest<{ ok: true; id: string }>("/api/admin/banners", {
    method: "POST",
    body: input,
  });
}

export function updateAdminBanner(id: string, active: boolean) {
  return apiRequest<{ ok: true; active: boolean }>(
    `/api/admin/banners/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { active } },
  );
}
