import { ApiError, apiRequest } from "./api";
import type { Localized, ProductBadge } from "./catalog";
import type {
  GatewayProvider,
  OnlineMethodId,
  Order,
  OrderStatus,
  PaymentStatus,
} from "./checkout";
import type { DictKey } from "./i18n";

export type AdminMetrics = {
  todayOrders: number;
  todayRevenuePaisa: number;
  openOrders: number;
  lowStockCount: number;
  activeProducts: number;
  customers: number;
};

export type AdminTrendPoint = { date: string; orders: number; revenuePaisa: number };

export type AdminOrderSummary = {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: "cod" | "bkash" | "nagad" | "sslcommerz";
  paymentStatus: PaymentStatus;
  customerName: string;
  phone: string;
  district: Localized;
  totalPaisa: number;
  itemCount: number;
  couponCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLowStock = {
  id: string;
  slug: string;
  name: Localized;
  image: string;
  stock: number;
  threshold: number;
};

export type AdminDashboard = {
  metrics: AdminMetrics;
  statusCounts: Record<OrderStatus, number>;
  trend: AdminTrendPoint[];
  recentOrders: AdminOrderSummary[];
  lowStock: AdminLowStock[];
};

export type AdminOrdersResponse = {
  orders: AdminOrderSummary[];
  counts: Record<OrderStatus, number>;
  total: number;
};

export type CourierId = "manual" | "pathao" | "redx" | "steadfast";

export type CourierOption = {
  id: CourierId;
  label: string;
  automatic: boolean;
  available: boolean;
};

export type AdminOrderDetail = {
  order: Order;
  transitions: OrderStatus[];
  couriers: CourierOption[];
};

export type AdminSettings = {
  store: {
    nameBn: string;
    nameEn: string;
    phone: string;
    email: string;
    addressBn: string;
    addressEn: string;
    tradeLicense: string;
    tin: string;
    paymentNumber: string;
  };
  delivery: {
    dhakaChargePaisa: number;
    outsideChargePaisa: number;
    freeThresholdPaisa: number;
    codLimitPaisa: number;
    codEnabled: boolean;
  };
  payments: {
    bkashEnabled: boolean;
    nagadEnabled: boolean;
    sslcommerzEnabled: boolean;
  };
  security: {
    ipAllowlist: string;
    requireTwoFactor: boolean;
  };
  environment: {
    mode: "sandbox" | "live";
    providers: Record<OnlineMethodId, GatewayProvider>;
    webhookReady: boolean;
    courier: { pathao: boolean; redx: boolean; steadfast: boolean; sms: boolean };
  };
};

export type AdminSettingsInput = {
  store?: Partial<AdminSettings["store"]>;
  delivery?: Partial<AdminSettings["delivery"]>;
  payments?: Partial<AdminSettings["payments"]>;
  security?: Partial<AdminSettings["security"]>;
};

export type AdminVariant = {
  id: string;
  sku: string;
  optionType: "color" | "size";
  label: Localized;
  pricePaisa: number;
  stock: number;
  position: number;
  swatch: string | null;
};

export type AdminProduct = {
  id: string;
  slug: string;
  categoryId: string;
  brand: string | null;
  name: Localized;
  tagline: Localized;
  description: Localized;
  pricePaisa: number;
  compareAtPaisa: number | null;
  stock: number;
  lowStockThreshold: number;
  rating: number;
  reviews: number;
  badge: ProductBadge | null;
  image: string;
  imageSmall: string;
  featured: boolean;
  status: "draft" | "active" | "archived";
  createdAt: string;
  updatedAt: string;
  variants: AdminVariant[];
};

export type AdminVariantInput = {
  id?: string;
  sku?: string;
  optionType: "color" | "size";
  labelEn: string;
  labelBn: string;
  pricePaisa: number;
  stock: number;
  swatch?: string;
  position?: number;
};

export type AdminProductInput = {
  nameBn: string;
  nameEn: string;
  slug?: string;
  categoryId: string;
  brand: string;
  taglineBn: string;
  taglineEn: string;
  descriptionBn: string;
  descriptionEn: string;
  pricePaisa: number;
  compareAtPaisa: number | null;
  stock?: number;
  lowStockThreshold: number;
  badge: ProductBadge | null;
  image: string;
  imageSmall?: string;
  featured: boolean;
  status: "draft" | "active";
  variants: AdminVariantInput[];
};

export type AuditEntry = {
  id: string;
  actor: { id: string | null; name: string; role: string };
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
};

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

export const KANBAN_COLUMNS: OrderStatus[] = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
];

export function loadDashboard(signal?: AbortSignal): Promise<AdminDashboard> {
  return apiRequest<AdminDashboard>("/api/admin/dashboard", { signal });
}

export function loadAdminOrders(query: { status?: string; q?: string } = {}): Promise<AdminOrdersResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  const suffix = params.toString();
  return apiRequest<AdminOrdersResponse>(`/api/admin/orders${suffix ? `?${suffix}` : ""}`);
}

export function loadAdminOrder(orderNumber: string): Promise<AdminOrderDetail> {
  return apiRequest<AdminOrderDetail>(`/api/admin/orders/${encodeURIComponent(orderNumber)}`);
}

export function moveOrderStatus(
  orderNumber: string,
  status: OrderStatus,
  note?: string,
): Promise<{ ok: boolean; order: Order; restock: { restored: number; failed: number } | null }> {
  return apiRequest(`/api/admin/orders/${encodeURIComponent(orderNumber)}/status`, {
    method: "PATCH",
    body: note ? { status, note } : { status },
  });
}

export function setPaymentStatus(
  orderNumber: string,
  paymentStatus: PaymentStatus,
  note?: string,
): Promise<{ ok: boolean; order: Order }> {
  return apiRequest(`/api/admin/orders/${encodeURIComponent(orderNumber)}/payment`, {
    method: "PATCH",
    body: note ? { paymentStatus, note } : { paymentStatus },
  });
}

export function assignCourier(
  orderNumber: string,
  courier: CourierId,
  trackingNumber?: string,
): Promise<{ ok: boolean; order: Order; courier: { provider: CourierId; trackingNumber: string | null; automatic: boolean } }> {
  return apiRequest(`/api/admin/orders/${encodeURIComponent(orderNumber)}/courier`, {
    method: "PATCH",
    body: trackingNumber ? { courier, trackingNumber } : { courier },
  });
}

export function loadAdminSettings(): Promise<AdminSettings> {
  return apiRequest<AdminSettings>("/api/admin/settings");
}

export function saveAdminSettings(input: AdminSettingsInput): Promise<AdminSettings> {
  return apiRequest<AdminSettings>("/api/admin/settings", { method: "PATCH", body: input });
}

export function loadAdminProducts(query: { status?: string; q?: string } = {}): Promise<{
  products: AdminProduct[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  const suffix = params.toString();
  return apiRequest(`/api/admin/products${suffix ? `?${suffix}` : ""}`);
}

export function loadAdminProduct(id: string): Promise<{ product: AdminProduct }> {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}`);
}

export function createAdminProduct(input: AdminProductInput): Promise<{ product: AdminProduct }> {
  return apiRequest("/api/admin/products", { method: "POST", body: input });
}

export function updateAdminProduct(
  id: string,
  input: Partial<AdminProductInput>,
): Promise<{ product: AdminProduct }> {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function archiveAdminProduct(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/admin/products/${encodeURIComponent(id)}/archive`, { method: "POST" });
}

export function importAdminProducts(
  rows: unknown[],
  publish: boolean,
): Promise<{
  created: number;
  skipped: { line: number; reason: string }[];
  products: { id: string; slug: string; name: Localized; status: string }[];
}> {
  return apiRequest("/api/admin/products/import", {
    method: "POST",
    body: { rows, publish },
  });
}

export type AuditQuery = {
  limit?: number;
  action?: string;
  q?: string;
  from?: string;
  to?: string;
};

export function loadAudit(query: AuditQuery = {}): Promise<{ entries: AuditEntry[]; total: number }> {
  const params = new URLSearchParams();
  params.set("limit", String(query.limit ?? 50));
  if (query.action) params.set("action", query.action);
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return apiRequest(`/api/admin/audit?${params.toString()}`);
}

export function adminErrorKey(error: unknown): DictKey {
  if (!(error instanceof ApiError)) return "auth.errorGeneric";
  switch (error.code) {
    case "forbidden":
      return "auth.errorForbidden";
    case "rate_limited":
      return "auth.errorRateLimited";
    case "network":
      return "auth.errorNetwork";
    case "invalid_input":
      return "auth.errorInput";
    case "slug_taken":
      return "admin.wizard.errorSlugTaken";
    case "sku_taken":
      return "admin.wizard.errorSkuTaken";
    case "category_unknown":
      return "admin.wizard.errorCategory";
    case "compare_at_below_price":
      return "admin.wizard.errorCompare";
    case "invalid_transition":
      return "admin.orders.invalidTransition";
    case "not_found":
      return "admin.errorNotFound";
    default:
      return "auth.errorGeneric";
  }
}

export const IMPORT_HEADERS = [
  "name_en",
  "name_bn",
  "category",
  "price",
  "stock",
  "brand",
  "tagline_en",
  "tagline_bn",
  "description_en",
  "description_bn",
  "badge",
  "featured",
  "image",
  "sku",
  "variant_option_type",
  "variant_label_en",
  "variant_label_bn",
  "variant_price",
  "variant_stock",
  "swatch",
];

const HEADER_ALIASES: Record<string, string> = {
  name_en: "nameEn",
  name_bn: "nameBn",
  category: "categoryId",
  category_id: "categoryId",
  price: "pricePaisa",
  price_paisa: "pricePaisa",
  stock: "stock",
  brand: "brand",
  tagline_en: "taglineEn",
  tagline_bn: "taglineBn",
  description_en: "descriptionEn",
  description_bn: "descriptionBn",
  badge: "badge",
  featured: "featured",
  image: "image",
  sku: "sku",
  variant_option_type: "optionType",
  variant_label_en: "variantLabelEn",
  variant_label_bn: "variantLabelBn",
  variant_price: "variantPricePaisa",
  variant_stock: "variantStock",
  swatch: "swatch",
};

const NUMBER_FIELDS = new Set([
  "pricePaisa",
  "stock",
  "variantPricePaisa",
  "variantStock",
]);

const TEXT_FIELDS = new Set([
  "nameEn",
  "nameBn",
  "categoryId",
  "brand",
  "taglineEn",
  "taglineBn",
  "descriptionEn",
  "descriptionBn",
  "image",
  "sku",
  "variantLabelEn",
  "variantLabelBn",
  "swatch",
]);

export function csvTemplate(): string {
  return [
    IMPORT_HEADERS.join(","),
    'Canvas Tote,ক্যানভাস টোট,bags,1200,10,"LootPat Bazar","Everyday tote","প্রতিদিনের ব্যাগ","Heavy canvas tote","মোটা ক্যানভাসের ব্যাগ",new,false,/products/backpack-900.webp,TOTE-BLK,color,Black,কালো,1200,10,#14151B',
  ].join("\n");
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function toPaisa(value: string): number | null {
  const digits = value.replace(/[^\d.]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export type CsvImport = {
  rows: Record<string, unknown>[];
  lines: number[];
  errors: { line: number; reason: string }[];
  headerError: boolean;
};

// Accepts a comma-separated file with the documented header row. Quoted cells
// may contain commas; newlines inside a description are not supported.
export function parseImportCsv(text: string): CsvImport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) return { rows: [], lines: [], errors: [], headerError: true };

  const headers = parseCsvLine(lines[headerIndex]).map((header) => header.toLowerCase());
  const known = headers.map((header) => HEADER_ALIASES[header] ?? null);
  const required = ["nameEn", "nameBn", "categoryId", "pricePaisa"];
  if (required.some((field) => !known.includes(field))) {
    return { rows: [], lines: [], errors: [], headerError: true };
  }

  const rows: Record<string, unknown>[] = [];
  const rowLines: number[] = [];
  const errors: { line: number; reason: string }[] = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.trim()) continue;
    const cells = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    known.forEach((field, cellIndex) => {
      if (!field) return;
      const raw = cells[cellIndex] ?? "";
      if (!raw) return;
      if (NUMBER_FIELDS.has(field)) {
        const amount = toPaisa(raw);
        if (amount !== null) row[field] = amount;
      } else if (field === "featured") {
        row.featured = ["true", "1", "yes", "হ্যাঁ", "hae"].includes(raw.toLowerCase());
      } else if (field === "badge") {
        if (["bestseller", "new", "limited"].includes(raw.toLowerCase())) {
          row.badge = raw.toLowerCase();
        }
      } else if (field === "optionType") {
        row.optionType = raw.toLowerCase() === "size" ? "size" : "color";
      } else if (TEXT_FIELDS.has(field)) {
        row[field] = raw;
      }
    });

    const valid =
      typeof row.nameEn === "string" &&
      typeof row.nameBn === "string" &&
      typeof row.categoryId === "string" &&
      typeof row.pricePaisa === "number" &&
      row.pricePaisa >= 100;
    if (!valid) {
      errors.push({ line: index + 1, reason: "invalid_row" });
      continue;
    }

    rows.push(row);
    rowLines.push(index + 1);
  }

  return { rows, lines: rowLines, errors, headerError: false };
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
