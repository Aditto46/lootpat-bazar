// Product variants (colour or size). Variant stock always sums to the product
// stock so the "only N left" label can never contradict the catalog row.
import { PRODUCTS } from "./products.mjs";

const bySlug = new Map(PRODUCTS.map((product) => [product.slug, product]));

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `a1b2c3d4-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
};

// [label_en, label_bn, price_taka, stock, swatch]
const COLOR_SETS = {
  "airbeat-pro-earbuds": [
    ["Midnight", "মিডনাইট", 4990, 5, "#14151B"],
    ["Cloud White", "ক্লাউড হোয়াইট", 4990, 4, "#E8E6E1"],
  ],
  "airbeat-lite-earbuds": [
    ["Midnight", "মিডনাইট", 2790, 20, "#14151B"],
    ["Cloud White", "ক্লাউড হোয়াইট", 2790, 14, "#E8E6E1"],
  ],
  "boom-mini-speaker": [
    ["Graphite", "গ্রাফাইট", 2890, 12, "#2B2D35"],
    ["Teal", "টিল", 2890, 9, "#00C9AE"],
  ],
  "boom-max-speaker": [
    ["Graphite", "গ্রাফাইট", 5490, 8, "#2B2D35"],
    ["Sand", "স্যান্ড", 5490, 6, "#D8C3A5"],
  ],
  "pulse-x2-smartwatch": [
    ["Midnight", "মিডনাইট", 7450, 2, "#14151B"],
    ["Teal", "টিল", 7450, 1, "#00C9AE"],
  ],
  "pulse-fit-band": [
    ["Midnight", "মিডনাইট", 3490, 15, "#14151B"],
    ["Teal", "টিল", 3490, 12, "#00C9AE"],
  ],
  "pulse-active-watch": [
    ["Midnight", "মিডনাইট", 4990, 10, "#14151B"],
    ["Teal", "টিল", 4990, 8, "#00C9AE"],
  ],
  "nomad-leather-backpack": [
    ["Black", "কালো", 3290, 7, "#14151B"],
    ["Tan", "ট্যান", 3290, 5, "#A9744F"],
  ],
  "nomad-city-backpack": [
    ["Black", "কালো", 2690, 12, "#14151B"],
    ["Grey", "ধূসর", 2690, 10, "#8A8D96"],
  ],
  "commuter-sling": [
    ["Black", "কালো", 1890, 18, "#14151B"],
    ["Sand", "স্যান্ড", 1890, 13, "#D8C3A5"],
  ],
  "everyday-tote": [
    ["Sand", "স্যান্ড", 2290, 9, "#D8C3A5"],
    ["Black", "কালো", 2290, 7, "#14151B"],
  ],
  "ambient-desk-lamp": [
    ["Sand", "স্যান্ড", 3490, 6, "#D8C3A5"],
    ["Midnight", "মিডনাইট", 3490, 4, "#14151B"],
  ],
  "stone-ceramic-mug": [
    ["Stone", "স্টোন", 790, 35, "#CFC7B8"],
    ["Charcoal", "চারকোল", 790, 25, "#3A3A3E"],
  ],
  "warm-glow-mug-set": [
    ["Stone", "স্টোন", 1490, 14, "#CFC7B8"],
    ["Charcoal", "চারকোল", 1490, 10, "#3A3A3E"],
  ],
  "gan-65w-charger": [
    ["Black", "কালো", 2190, 20, "#14151B"],
    ["White", "সাদা", 2190, 13, "#E8E6E1"],
  ],
  "slim-power-bank": [
    ["Black", "কালো", 2590, 15, "#14151B"],
    ["White", "সাদা", 2590, 10, "#E8E6E1"],
  ],
  "travel-charger-kit": [
    ["Black", "কালো", 1690, 22, "#14151B"],
    ["White", "সাদা", 1690, 16, "#E8E6E1"],
  ],
};

// [label_en, label_bn, price_taka, stock, swatch]
const SIZE_SETS = {
  "glow-vitamin-c-serum": [
    ["30 ml", "৩০ মিলি", 1290, 24, null],
    ["50 ml", "৫০ মিলি", 1890, 18, null],
  ],
  "daily-gentle-cleanser": [
    ["150 ml", "১৫০ মিলি", 890, 32, null],
    ["200 ml", "২০০ মিলি", 1090, 23, null],
  ],
  "night-repair-serum": [
    ["30 ml", "৩০ মিলি", 1590, 11, null],
    ["50 ml", "৫০ মিলি", 2290, 8, null],
  ],
};

function buildVariants(slug, optionType, sets) {
  const product = bySlug.get(slug);
  if (!product) throw new Error(`seed: variants reference unknown product ${slug}`);
  return sets.map(([labelEn, labelBn, priceTaka, stock, swatch], index) => ({
    id: nextId(),
    product_id: product.id,
    sku: `${slug.toUpperCase().replace(/-/g, "")}-${index + 1}`,
    option_type: optionType,
    option_label_bn: labelBn,
    option_label_en: labelEn,
    price_paisa: priceTaka * 100,
    stock,
    position: index,
    swatch: swatch ?? null,
  }));
}

export const VARIANTS = [
  ...Object.entries(COLOR_SETS).flatMap(([slug, sets]) => buildVariants(slug, "color", sets)),
  ...Object.entries(SIZE_SETS).flatMap(([slug, sets]) => buildVariants(slug, "size", sets)),
];

export function assertVariantStockMatchesProducts(items = VARIANTS, products = PRODUCTS) {
  const totals = new Map();
  for (const variant of items) {
    totals.set(variant.product_id, (totals.get(variant.product_id) ?? 0) + variant.stock);
  }
  for (const product of products) {
    const total = totals.get(product.id);
    if (total === undefined) throw new Error(`seed: product ${product.slug} has no variants`);
    if (total !== product.stock) {
      throw new Error(
        `seed: variant stock ${total} for ${product.slug} does not match product stock ${product.stock}`,
      );
    }
  }
}
