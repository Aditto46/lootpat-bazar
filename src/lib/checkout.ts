import { useEffect, useState } from "react";
import { apiRequest } from "./api";
import type { Localized } from "./catalog";
import type { DictKey } from "./i18n";
import { isDhaka, type District } from "./locations";

export type PaymentMethodId = "cod" | "bkash" | "nagad" | "sslcommerz";
export type OnlineMethodId = Exclude<PaymentMethodId, "cod">;

export type GatewayProvider = {
  label: string;
  enabled: boolean;
  configured: boolean;
  available: boolean;
};

export type CheckoutConfig = {
  store: {
    name: Localized;
    phone: string;
    email: string;
    address: Localized;
    tradeLicense: string;
    tin: string;
  };
  delivery: {
    dhakaPaisa: number;
    outsidePaisa: number;
    freeThresholdPaisa: number;
    codLimitPaisa: number;
    codEnabled: boolean;
  };
  payments: Record<PaymentMethodId, boolean>;
  gateway: { mode: "sandbox" | "live"; providers: Record<OnlineMethodId, GatewayProvider> };
};

export type CheckoutCustomer = {
  name: string;
  phone: string;
  email?: string;
  districtId: string;
  area?: string;
  address: string;
  note?: string;
  marketingConsent?: boolean;
};

export type CheckoutLine = { productId: string; variantId?: string; qty: number };

export type CreateOrderInput = {
  items: CheckoutLine[];
  customer: CheckoutCustomer;
  couponCode?: string;
  paymentMethod: PaymentMethodId;
  idempotencyKey: string;
};

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "packed"
  | "shipped"
  | "delivered"
  | "returned"
  | "cancelled";

export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";

export type OrderItem = {
  productId: string;
  productSlug: string;
  variantId: string | null;
  sku: string;
  name: Localized;
  variantLabel: Localized | null;
  unitPricePaisa: number;
  qty: number;
  lineTotalPaisa: number;
  image: string;
};

export type PaymentSessionStatus = "pending" | "paid" | "failed" | "cancelled" | "expired";

export type OrderPaymentSession = {
  id: string;
  provider: OnlineMethodId;
  status: PaymentSessionStatus;
  amountPaisa: number;
  providerRef: string | null;
  expiresAt: string;
  createdAt: string;
};

export type OrderFulfilment = {
  courier: string | null;
  trackingNumber: string | null;
  courierStatus: string | null;
  shippedAt: string | null;
};

export type Order = {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethodId;
  paymentStatus: PaymentStatus;
  customer: {
    name: string;
    phone: string;
    email: string | null;
    district: { id: string; name: Localized; division: Localized };
    address: string;
    area: string | null;
    note: string | null;
    marketingConsent: boolean;
  };
  items: OrderItem[];
  totals: {
    subtotalPaisa: number;
    discountPaisa: number;
    shippingPaisa: number;
    totalPaisa: number;
  };
  couponCode: string | null;
  createdAt: string;
  statusHistory: { status: OrderStatus; at: string }[];
  fulfilment: OrderFulfilment;
  paymentSession: OrderPaymentSession | null;
};

export type CouponQuote = {
  code: string;
  discountPaisa: number;
  freeShipping: boolean;
};

export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
];

export function orderStatusKey(status: OrderStatus): DictKey {
  return `order.status.${status}` as DictKey;
}

export function paymentStatusKey(status: PaymentStatus): DictKey {
  return `order.payment.${status}` as DictKey;
}

let configCache: CheckoutConfig | null = null;
let configInflight: Promise<CheckoutConfig> | null = null;

function loadConfig(): Promise<CheckoutConfig> {
  if (configCache) return Promise.resolve(configCache);
  if (!configInflight) {
    configInflight = apiRequest<CheckoutConfig>("/api/checkout/config")
      .then((config) => {
        configCache = config;
        configInflight = null;
        return config;
      })
      .catch((cause: unknown) => {
        configInflight = null;
        throw cause;
      });
  }
  return configInflight;
}

type ConfigState = {
  status: "loading" | "ready" | "error";
  config: CheckoutConfig | null;
};

export function useCheckoutConfig(): ConfigState & { reload: () => void } {
  const [state, setState] = useState<ConfigState>(() =>
    configCache ? { status: "ready", config: configCache } : { status: "loading", config: null },
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (configCache) {
      setState({ status: "ready", config: configCache });
      return;
    }
    let active = true;
    loadConfig()
      .then((config) => {
        if (active) setState({ status: "ready", config });
      })
      .catch(() => {
        if (active) setState({ status: "error", config: null });
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return {
    ...state,
    reload: () => {
      configCache = null;
      setNonce((current) => current + 1);
    },
  };
}

export function quoteCoupon(code: string, subtotalPaisa: number): Promise<CouponQuote> {
  return apiRequest<{
    coupon: { code: string };
    discountPaisa: number;
    freeShipping: boolean;
  }>("/api/coupons/validate", {
    method: "POST",
    body: { code, subtotalPaisa },
  }).then((response) => ({
    code: response.coupon.code,
    discountPaisa: response.discountPaisa,
    freeShipping: response.freeShipping,
  }));
}

export function createOrder(input: CreateOrderInput): Promise<{ order: Order; lookupToken: string }> {
  return apiRequest<{ order: Order; lookupToken: string }>("/api/orders", {
    method: "POST",
    body: input,
  });
}

export function fetchOrder(orderNumber: string, token?: string | null): Promise<Order> {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  return apiRequest<{ order: Order }>(
    `/api/orders/${encodeURIComponent(orderNumber)}${query}`,
  ).then((response) => response.order);
}

export type PaymentSession = {
  id: string;
  provider: OnlineMethodId;
  status: PaymentSessionStatus;
  amountPaisa: number;
  redirectUrl: string;
  expiresAt: string;
  mode?: "sandbox" | "live";
};

export type SandboxSessionInfo = {
  id: string;
  provider: OnlineMethodId;
  status: PaymentSessionStatus;
  amountPaisa: number;
  expiresAt: string;
  orderNumber: string;
  paymentStatus: PaymentStatus;
};

export function startPaymentSession(
  orderNumber: string,
  lookupToken: string,
  provider: OnlineMethodId,
): Promise<PaymentSession> {
  return apiRequest<{ session: PaymentSession }>("/api/payments/session", {
    method: "POST",
    body: { orderNumber, lookupToken, provider },
  }).then((response) => response.session);
}

export function fetchSandboxSession(
  sessionId: string,
  token: string,
): Promise<SandboxSessionInfo> {
  return apiRequest<{ session: SandboxSessionInfo }>(
    `/api/payments/session/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`,
  ).then((response) => response.session);
}

export function completeSandboxPayment(
  sessionId: string,
  token: string,
  outcome: "success" | "failure",
): Promise<{ paid: boolean; redirectUrl: string }> {
  return apiRequest<{ paid: boolean; redirectUrl: string }>(
    `/api/payments/session/${encodeURIComponent(sessionId)}/complete`,
    { method: "POST", body: { token, outcome } },
  );
}

export function verifyPayment(
  orderNumber: string,
  lookupToken: string,
  sessionId: string,
  providerReference?: string,
): Promise<{ paid: boolean; order: Order }> {
  return apiRequest<{ paid: boolean; order: Order }>("/api/payments/verify", {
    method: "POST",
    body: { orderNumber, lookupToken, sessionId, providerReference },
  });
}

export function trackOrder(
  orderNumber: string,
  phone: string,
): Promise<{ order: Order; lookupToken: string }> {
  return apiRequest<{ order: Order; lookupToken: string }>("/api/orders/track", {
    method: "POST",
    body: { orderNumber, phone },
  });
}

const ORDER_TOKEN_PREFIX = "lp-order-token:";

export function rememberOrderToken(orderNumber: string, token: string) {
  try {
    window.localStorage.setItem(`${ORDER_TOKEN_PREFIX}${orderNumber}`, token);
  } catch {
    /* storage can be unavailable in private mode */
  }
}

export function readOrderToken(orderNumber: string): string | null {
  try {
    return window.localStorage.getItem(`${ORDER_TOKEN_PREFIX}${orderNumber}`);
  } catch {
    return null;
  }
}

const PROFILE_KEY = "lp-checkout-v1";

export type CheckoutProfile = {
  name: string;
  phone: string;
  email: string;
  districtId: string;
  area: string;
  address: string;
};

export function readCheckoutProfile(): CheckoutProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const field = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
    const profile = {
      name: field("name"),
      phone: field("phone"),
      email: field("email"),
      districtId: field("districtId"),
      area: field("area"),
      address: field("address"),
    };
    return profile.phone || profile.districtId ? profile : null;
  } catch {
    return null;
  }
}

export function rememberCheckoutProfile(profile: CheckoutProfile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* storage can be unavailable in private mode */
  }
}

// Accepts 017XXXXXXXX, +88017XXXXXXXX and 88017XXXXXXXX while typing.
export function isValidPhone(value: string): boolean {
  const compact = value.replace(/[\s()-]/g, "");
  return /^(?:\+?88)?01[3-9]\d{8}$/.test(compact);
}

export function displayPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("880")) return `0${digits.slice(3)}`;
  if (digits.startsWith("0")) return digits;
  return `0${digits}`;
}

export function districtFromOrder(order: Order): District {
  return {
    id: order.customer.district.id,
    name: order.customer.district.name,
    division: order.customer.district.division,
  };
}

export function shippingPaisa(
  config: CheckoutConfig,
  district: District | undefined,
  subtotalPaisa: number,
  freeShipping = false,
): number {
  if (freeShipping || subtotalPaisa >= config.delivery.freeThresholdPaisa) return 0;
  return isDhaka(district) ? config.delivery.dhakaPaisa : config.delivery.outsidePaisa;
}
