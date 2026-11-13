// Store identity, delivery economics and launch coupons. Values are text so a
// later admin settings screen can edit them without another migration.

export const SETTINGS = [
  { key: "store.name_bn", value: "লুটপাট বাজার" },
  { key: "store.name_en", value: "LootPat Bazar" },
  { key: "store.phone", value: "+8801700000000" },
  { key: "store.email", value: "hello@lootpat.bd" },
  { key: "store.address_bn", value: "লেভেল ৪, ১২/এ, রোড ২৭, ধানমন্ডি, ঢাকা ১২০৯" },
  { key: "store.address_en", value: "Level 4, 12/A, Road 27, Dhanmondi, Dhaka 1209" },
  { key: "store.trade_license", value: "TRAD/DNCC/000000/2026" },
  { key: "store.tin", value: "000000000000" },

  // Dhaka city ৳60, everywhere else ৳120, free from ৳2,000 merchandise value.
  { key: "delivery.dhaka_charge_paisa", value: "6000" },
  { key: "delivery.outside_charge_paisa", value: "12000" },
  { key: "delivery.free_threshold_paisa", value: "200000" },
  { key: "delivery.cod_limit_paisa", value: "1000000" },
  { key: "delivery.cod_enabled", value: "true" },

  // Online gateways arrive in step 6; the API refuses them until enabled.
  { key: "payments.bkash_enabled", value: "false" },
  { key: "payments.nagad_enabled", value: "false" },
  { key: "payments.sslcommerz_enabled", value: "false" },

  // Step 9: an empty allowlist means every IP may reach /admin; adding entries
  // restricts staff APIs to the listed IPv4/IPv6 addresses or IPv4 CIDR blocks.
  { key: "security.admin_ip_allowlist", value: "" },
  { key: "security.require_two_factor", value: "true" },
];

const now = new Date().toISOString();

export const COUPONS = [
  {
    id: "welcome10",
    code: "WELCOME10",
    kind: "percent",
    value: 10,
    min_subtotal_paisa: 100000,
    max_discount_paisa: 30000,
    usage_limit: 500,
    per_customer_limit: 1,
    starts_at: "2026-01-01T00:00:00.000Z",
    ends_at: "2027-12-31T23:59:59.000Z",
    active: true,
    created_at: now,
  },
  {
    id: "freeship",
    code: "FREESHIP",
    kind: "free_shipping",
    value: 0,
    min_subtotal_paisa: 150000,
    max_discount_paisa: null,
    usage_limit: 1000,
    per_customer_limit: 3,
    starts_at: "2026-01-01T00:00:00.000Z",
    ends_at: "2027-12-31T23:59:59.000Z",
    active: true,
    created_at: now,
  },
];
