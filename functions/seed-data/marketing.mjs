// Marketing seed data: loyalty rules, a birthday coupon, spin-wheel prizes, one
// live flash sale, a home banner and a handful of already-approved demo
// reviews. Reviews carry verified_purchase=false unless a real delivered order
// produced them, so the storefront badge never lies.

export const MARKETING_SETTINGS = [
  { key: "loyalty.enabled", value: "true" },
  { key: "loyalty.points_per_100_taka", value: "1" },
  { key: "loyalty.point_value_paisa", value: "50" },
  { key: "loyalty.review_points", value: "20" },
  { key: "loyalty.redeem_min_points", value: "100" },
  { key: "loyalty.birthday_coupon", value: "BIRTHDAY15" },
  { key: "marketing.spin_enabled", value: "true" },
  { key: "marketing.vip_lifetime_paisa", value: "1000000" },
  { key: "marketing.inactive_days", value: "60" },
];

export const BIRTHDAY_COUPON = {
  id: "birthday15",
  code: "BIRTHDAY15",
  kind: "percent",
  value: 15,
  min_subtotal_paisa: 150000,
  max_discount_paisa: 50000,
  usage_limit: 1000,
  per_customer_limit: 1,
  starts_at: "2026-01-01T00:00:00.000Z",
  ends_at: "2027-12-31T23:59:59.000Z",
  active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

export const SPIN_PRIZES = [
  {
    id: "spin-percent-10",
    label_bn: "১০% ছাড়",
    label_en: "10% off",
    kind: "percent",
    value: 10,
    weight: 25,
    active: true,
    sort_order: 0,
  },
  {
    id: "spin-freeship",
    label_bn: "ফ্রি ডেলিভারি",
    label_en: "Free delivery",
    kind: "free_shipping",
    value: 0,
    weight: 30,
    active: true,
    sort_order: 1,
  },
  {
    id: "spin-percent-5",
    label_bn: "৫% ছাড়",
    label_en: "5% off",
    kind: "percent",
    value: 5,
    weight: 30,
    active: true,
    sort_order: 2,
  },
  {
    id: "spin-fixed-100",
    label_bn: "৳১০০ ছাড়",
    label_en: "৳100 off",
    kind: "fixed",
    value: 10000,
    weight: 15,
    active: true,
    sort_order: 3,
  },
];

export const BANNERS = [
  {
    id: "winter-collection",
    title_bn: "শীতের সংগ্রহ এসে গেছে",
    title_en: "The winter collection is here",
    body_bn: "নতুন সোয়েটার, জ্যাকেট আর অ্যাকসেসরিজে ২০% পর্যন্ত ছাড়।",
    body_en: "Up to 20% off new sweaters, jackets and accessories.",
    cta_label_bn: "সংগ্রহ দেখুন",
    cta_label_en: "Shop the collection",
    href: "/shop?sort=newest",
    tone: "teal",
    active: true,
    sort_order: 0,
    starts_at: "2026-10-01T00:00:00.000Z",
    ends_at: "2027-02-28T23:59:59.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
  },
];

const demoReview = (id, productId, rating, title, body, name, created) => ({
  id,
  product_id: productId,
  order_id: null,
  order_number: "DEMO",
  user_id: null,
  customer_name: name,
  phone: "+8801410286822",
  rating,
  title,
  body,
  photo_urls: "[]",
  verified_purchase: false,
  status: "approved",
  helpful_count: 0,
  reply_body: null,
  replied_at: null,
  replied_by: null,
  created_at: created,
  updated_at: created,
});

export const DEMO_REVIEWS = [
  demoReview(
    "4b1d6f0e-0000-4000-8000-000000000001",
    "0f1e2d3c-4b5a-4c6d-8e9f-000000000001",
    5,
    "নয়েজ ক্যানসেলিং সত্যিই কাজ করে",
    "বাসে যাতায়াতের সময় এয়ারবিট প্রো ব্যবহার করছি — বাইরের শব্দ প্রায় শোনা যায় না। ব্যাটারিও সারাদিন টেকে।",
    "সাদিয়া আফরিন",
    "2026-10-22T09:15:00.000Z",
  ),
  demoReview(
    "4b1d6f0e-0000-4000-8000-000000000002",
    "0f1e2d3c-4b5a-4c6d-8e9f-000000000001",
    4,
    "দামের তুলনায় ভালো",
    "সাউন্ড ক্লিয়ার, তবে বেস একটু কম মনে হয়েছে। এই দামে ভদ্রলোক রিভিউ।",
    "তানভীর হাসান",
    "2026-10-28T13:40:00.000Z",
  ),
  demoReview(
    "4b1d6f0e-0000-4000-8000-000000000003",
    "0f1e2d3c-4b5a-4c6d-8e9f-000000000002",
    5,
    "হালকা আর আরামদায়ক",
    "কানে অনেকক্ষণ থাকলেও চাপ লাগে না। কলের সাউন্ডও পরিষ্কার।",
    "মেহেদী ইসলাম",
    "2026-11-02T17:05:00.000Z",
  ),
  demoReview(
    "4b1d6f0e-0000-4000-8000-000000000004",
    "0f1e2d3c-4b5a-4c6d-8e9f-000000000005",
    5,
    "Exactly as pictured",
    "The build feels premium and the strap is comfortable for all-day wear. Delivery to Chattogram took two days.",
    "Ayesha R.",
    "2026-11-05T11:30:00.000Z",
  ),
];

// A live sale that starts one hour before seeding and runs for three days, so
// the storefront has something real to count down to on a fresh database.
export function flashSaleSeed(products, now = new Date()) {
  const picks = products.slice(0, 3);
  const startsAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const endsAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  return {
    sale: {
      id: "weekend-flash",
      title_bn: "সপ্তাহান্তের ফ্ল্যাশ সেল",
      title_en: "Weekend flash sale",
      subtitle_bn: "নির্বাচিত পণ্যে ২০% পর্যন্ত ছাড় — স্টক শেষ হওয়ার আগেই।",
      subtitle_en: "Up to 20% off selected products — while stock lasts.",
      discount_percent: 20,
      banner_image: null,
      status: "active",
      starts_at: startsAt,
      ends_at: endsAt,
      created_at: startsAt,
      updated_at: startsAt,
    },
    items: picks.map((product, index) => ({
      id: `weekend-flash-item-${index + 1}`,
      sale_id: "weekend-flash",
      product_id: product.id,
      sale_price_paisa: Math.max(
        100,
        Math.round((product.price_paisa * 0.8) / 100) * 100,
      ),
      stock_limit: Math.max(1, Math.min(product.stock, 10)),
      sold_count: 0,
      created_at: startsAt,
    })),
  };
}
