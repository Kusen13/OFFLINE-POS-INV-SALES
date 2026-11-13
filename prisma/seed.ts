/**
 * Prisma Seed Script — LOLLY STORE POS
 * 
 * Upsert-based: safe to run multiple times.
 * Skips existing records (matched by SKU), inserts new ones.
 *
 * Run with:
 *   npx ts-node prisma/seed.ts
 *
 * Categories:
 *   Vegetables (26), Bigas (8), Juice (8), Seasoning (16),
 *   Coffee (5), Chocolate (1), Milk (2), Powder (1)
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function makeSku(cat: string, name: string, variant?: string): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const parts = [clean(cat).slice(0, 3), clean(name).slice(0, 5)];
  if (variant) parts.push(clean(variant).slice(0, 4));
  return parts.join("-");
}

async function upsertCategory(name: string, description: string, sort_order: number): Promise<number> {
  const cat = await prisma.categories.upsert({
    where: { name },
    update: { description, sort_order },
    create: { name, description, sort_order, is_active: true },
  });
  return cat.id;
}

type ProductInput = {
  categoryId: number; name: string; sku: string; description?: string;
  costPrice: number; sellingPrice: number; currentStock: number;
  unit: string; sellByWeight: boolean; lowStockThreshold: number; targetStock: number;
  resellerPrice?: number;
};

async function upsertProduct(p: ProductInput) {
  const today = new Date("2026-10-26");
  await prisma.products.upsert({
    where: { sku: p.sku },
    update: {
      name: p.name, category_id: p.categoryId, description: p.description ?? null,
      cost_price: p.costPrice, selling_price: p.sellingPrice, current_stock: p.currentStock,
      initial_stock: p.currentStock, initial_stock_date: today,
      low_stock_threshold: p.lowStockThreshold, target_stock: p.targetStock,
      unit: p.unit, sell_by_weight: p.sellByWeight, reseller_price: p.resellerPrice ?? null,
      is_active: true, updated_at: new Date(),
    },
    create: {
      category_id: p.categoryId, name: p.name, sku: p.sku,
      description: p.description ?? null, item_type: "product",
      cost_price: p.costPrice, selling_price: p.sellingPrice, current_stock: p.currentStock,
      initial_stock: p.currentStock, initial_stock_date: today,
      low_stock_threshold: p.lowStockThreshold, target_stock: p.targetStock,
      unit: p.unit, sell_by_weight: p.sellByWeight, reseller_price: p.resellerPrice ?? null,
      image_path: null, is_active: true,
    },
  });
}

async function main() {
  console.log("Starting seed...\n");

  // --- Categories ---
  const catIds: Record<string, number> = {};
  catIds.vegetables = await upsertCategory("Vegetables", "Mga gulay - sold by kilo, tali, or piece", 1);
  catIds.bigas      = await upsertCategory("Bigas",      "Rice varieties - per kilo and per sack", 2);
  catIds.juice      = await upsertCategory("Juice",      "Juice drinks and powdered mixes", 3);
  catIds.seasoning  = await upsertCategory("Seasoning",  "Pampalasa, spices, and condiments", 4);
  catIds.coffee     = await upsertCategory("Coffee",     "Coffee drinks", 5);
  catIds.chocolate  = await upsertCategory("Chocolate",  "Chocolate drinks", 6);
  catIds.milk       = await upsertCategory("Milk",       "Milk products", 7);
  catIds.powder     = await upsertCategory("Powder",     "Powdered ingredients", 8);

  await prisma.payment_methods.upsert({ where: { name: "Cash" },  update: {}, create: { name: "Cash",  is_active: true, sort_order: 1 } });
  await prisma.payment_methods.upsert({ where: { name: "GCash" }, update: {}, create: { name: "GCash", is_active: true, sort_order: 2 } });

  console.log("Categories + payment methods done.\n");

  // --- VEGETABLES ---
  const VID = catIds.vegetables;
  const vegetables: [string, string, number, number, string, number, number][] = [
    ["Repolyo",        "Regular",    0,   0,   "kg",    1, 5],
    ["Sibuyas",        "Puti",       0,   0,   "kg",    1, 5],
    ["Sibuyas",        "Pula",       160, 0,   "kg",    1, 5],
    ["Sili",           "Green",      38,  0,   "kg",    1, 3],
    ["Sili",           "Red",        105, 0,   "kg",    1, 3],
    ["Kamatis",        "Regular",    103, 0,   "kg",    1, 5],
    ["Luya",           "Regular",    68,  0,   "kg",    1, 3],
    ["Carrots",        "Regular",    100, 0,   "kg",    1, 5],
    ["Petchay",        "Baguio",     0,   0,   "kg",    1, 5],
    ["Petchay",        "Tagalog",    100, 0,   "kg",    1, 5],
    ["Kangkong",       "10 tali",    110, 0,   "tali",  1, 10],
    ["Talong",         "Regular",    60,  0,   "kg",    1, 5],
    ["Patatas",        "Regular",    0,   0,   "kg",    1, 5],
    ["Bell Pepper",    "Regular",    0,   0,   "kg",    1, 3],
    ["Sitaw",          "Regular",    90,  0,   "tali",  1, 10],
    ["Baguio Beans",   "Regular",    0,   0,   "kg",    1, 3],
    ["Bawang",         "Regular",    168, 0,   "kg",    1, 3],
    ["Upo",            "Regular",    0,   0,   "piece", 1, 5],
    ["Ampalaya",       "Regular",    146, 0,   "kg",    1, 5],
    ["Kalabasa",       "Regular",    0,   0,   "kg",    1, 5],
    ["Mais",           "Regular",    0,   0,   "kg",    1, 5],
    ["Dahon Sibuyas",  "Regular",    0,   0,   "kg",    1, 3],
    ["Calamansi",      "Regular",    140, 0,   "kg",    1, 5],
    ["Sayote",         "Regular",    85,  0,   "kg",    1, 5],
    ["Munggo",         "Regular",    0,   0,   "kg",    1, 5],
    ["Sampaloc",       "Regular",    61,  0,   "kg",    1, 3],
  ];

  for (const [name, variant, buying, selling, unit, low, target] of vegetables) {
    const isWeight = unit === "kg";
    await upsertProduct({
      categoryId: VID, name: `${name} (${variant})`,
      sku: makeSku("VEG", name, variant), description: `${name} - ${variant}`,
      costPrice: buying, sellingPrice: selling, currentStock: 1,
      unit, sellByWeight: isWeight, lowStockThreshold: low, targetStock: target,
    });
  }
  console.log("Vegetables done (26 items).\n");

  // --- BIGAS ---
  const BID = catIds.bigas;
  type RiceEntry = { variety: string; grade: string; costPerKilo: number; sellingPerKilo: number; sellingPerSack5: number };
  const riceEntries: RiceEntry[] = [
    { variety: "Buco Pandan",    grade: "PREMIUM",      costPerKilo: 107, sellingPerKilo: 54.80, sellingPerSack5: 274 },
    { variety: "Jasmin Red",     grade: "SEMI LAON",    costPerKilo: 112, sellingPerKilo: 56.80, sellingPerSack5: 284 },
    { variety: "Jasmin Yellow",  grade: "DENORADO",     costPerKilo: 107, sellingPerKilo: 54.80, sellingPerSack5: 274 },
    { variety: "Jasmin Blue",    grade: "SINANDOMENG",  costPerKilo: 104, sellingPerKilo: 53.60, sellingPerSack5: 268 },
  ];

  for (const r of riceEntries) {
    const s = r.variety.replace(/\s+/g, "").toUpperCase().slice(0, 7);
    await upsertProduct({
      categoryId: BID, name: `${r.variety} (${r.grade}) - per Kilo`,
      sku: `BIGAS-${s}-KG`, description: `${r.variety} ${r.grade} - i-input ang timbang sa POS`,
      costPrice: r.costPerKilo, sellingPrice: r.sellingPerKilo, currentStock: 50,
      unit: "kg", sellByWeight: true, lowStockThreshold: 5, targetStock: 50,
    });
    await upsertProduct({
      categoryId: BID, name: `${r.variety} (${r.grade}) - 5kg Pack`,
      sku: `BIGAS-${s}-5KG`, description: `${r.variety} ${r.grade} - 5kg na pack`,
      costPrice: r.costPerKilo * 5, sellingPrice: r.sellingPerSack5, currentStock: 5,
      unit: "sako", sellByWeight: false, lowStockThreshold: 2, targetStock: 10,
    });
  }
  console.log("Bigas done (8 items).\n");

  // --- JUICE ---
  const JID = catIds.juice;
  const juiceItems: [string, string, number, number, number][] = [
    ["Tang",          "Orange",    12, 235, 12],
    ["Tang",          "Pineapple", 12, 235, 12],
    ["Neste Lemon",   "Regular",   12, 240, 12],
    ["Neste Apple",   "Regular",   12, 240, 12],
    ["Tang Calamansi","Regular",   6,  235, 6 ],
    ["Tang Mango",    "Regular",   6,  235, 6 ],
    ["Tang Dalandan", "Regular",   6,  235, 6 ],
    ["Tang Cocumber", "Regular",   6,  264, 6 ],
  ];
  for (const [name, variant, qty, totalCost, perPack] of juiceItems) {
    await upsertProduct({
      categoryId: JID, name: `${name} (${variant})`,
      sku: makeSku("JUI", name, variant), description: `${name} ${variant}`,
      costPrice: Math.round((totalCost / perPack) * 100) / 100, sellingPrice: 0,
      currentStock: qty, unit: "pcs", sellByWeight: false, lowStockThreshold: 3, targetStock: 12,
    });
  }
  console.log("Juice done (8 items).\n");

  // --- SEASONING ---
  const SID = catIds.seasoning;
  const seasoningItems: [string, string, number, number, string][] = [
    ["Knorr",          "Pork",         12,   76,  "pcs"],
    ["Knorr",          "Beef",         12,   76,  "pcs"],
    ["Knorr",          "Shrimp",       12,   76,  "pcs"],
    ["Knorr",          "Chicken",      12,   60,  "pcs"],
    ["Sinigang Mix",   "Original Big", 12,   190, "pcs"],
    ["Sinigang Mix",   "Gabi Big",     12,   190, "pcs"],
    ["Sinigang Mix",   "Original Small",12,  98,  "pcs"],
    ["Sinigang Mix",   "Gabi Small",   12,   98,  "pcs"],
    ["Crispy Fry",     "Half",         12,   104, "pcs"],
    ["Ginisa Mix",     "Small",        16,   65,  "pcs"],
    ["Vetsin",         "Small",        18,   77,  "pcs"],
    ["Magic Sarap",    "Small",        16,   79,  "pcs"],
    ["Paminta Pino",   "Regular",      0.5,  220, "kg" ],
    ["Paminta Crack",  "Regular",      0.5,  220, "kg" ],
    ["Paminta Buo",    "Regular",      0.25, 220, "kg" ],
    ["Asin",           "Regular",      1,    40,  "takal"],
  ];
  for (const [name, variant, qty, cost, unit] of seasoningItems) {
    const isKilo = unit === "kg";
    await upsertProduct({
      categoryId: SID, name: `${name} (${variant})`,
      sku: makeSku("SEA", name, variant), description: `${name} ${variant}`,
      costPrice: cost, sellingPrice: 0, currentStock: qty, unit,
      sellByWeight: isKilo, lowStockThreshold: isKilo ? 0.1 : 3, targetStock: isKilo ? 1 : 12,
    });
  }
  console.log("Seasoning done (16 items).\n");

  // --- COFFEE ---
  const COFID = catIds.coffee;
  const coffeeItems: [string, string, number, number][] = [
    ["Kopiko Blanca",         "Double", 22, 264],
    ["Nescafe Original",      "Double", 20, 284],
    ["Nescafe Creamy White",  "Double", 20, 284],
    ["Mama Sita Oyster Sauce","Small",  24, 150],
    ["Nescafe",               "Stick",  24, 78 ],
  ];
  for (const [name, variant, qty, cost] of coffeeItems) {
    await upsertProduct({
      categoryId: COFID, name: `${name} (${variant})`,
      sku: makeSku("COF", name, variant), description: `${name} ${variant}`,
      costPrice: cost, sellingPrice: 0, currentStock: qty,
      unit: "pcs", sellByWeight: false, lowStockThreshold: 3, targetStock: 12,
    });
  }
  console.log("Coffee done (5 items).\n");

  // --- CHOCOLATE ---
  await upsertProduct({
    categoryId: catIds.chocolate, name: "Milo (Small)", sku: "CHO-MILO-SML",
    description: "Milo chocolate drink small", costPrice: 240, sellingPrice: 0,
    currentStock: 24, unit: "pcs", sellByWeight: false, lowStockThreshold: 3, targetStock: 24,
  });
  console.log("Chocolate done (1 item).\n");

  // --- MILK ---
  const MLKID = catIds.milk;
  await upsertProduct({ categoryId: MLKID, name: "Bearbrand Swak (Small)", sku: "MLK-BEARB-SML", description: "Bearbrand Swak small", costPrice: 184, sellingPrice: 0, currentStock: 20, unit: "pcs", sellByWeight: false, lowStockThreshold: 3, targetStock: 12 });
  await upsertProduct({ categoryId: MLKID, name: "Birchtree (Small)", sku: "MLK-BIRCH-SML", description: "Birchtree milk small", costPrice: 150, sellingPrice: 0, currentStock: 16, unit: "pcs", sellByWeight: false, lowStockThreshold: 3, targetStock: 12 });
  console.log("Milk done (2 items).\n");

  // --- POWDER ---
  await upsertProduct({
    categoryId: catIds.powder, name: "Harina (Regular)", sku: "POW-HARI-REG",
    description: "All-purpose flour", costPrice: 72, sellingPrice: 0,
    currentStock: 2, unit: "kg", sellByWeight: true, lowStockThreshold: 0.5, targetStock: 5,
  });
  console.log("Powder done (1 item).\n");

  console.log("Seed complete! Total: 26 + 8 + 8 + 16 + 5 + 1 + 2 + 1 = 67 products");
  console.log("REMINDER: Update selling prices in ProductsPage for items with 0.00 price.");
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
