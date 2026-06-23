#!/usr/bin/env node
// Generate ~1000-row demo dataset for the docker-demo MySQL init script.
//
// Deterministic: seeded PRNG so re-runs produce identical SQL.
// Output: writes examples/docker-demo/mysql/01-init.sql (overwrites).
// Also writes examples/docker-demo/mysql/_baseline.json with computed
// reference values the test cases can assert against.
//
// Usage:
//   node examples/docker-demo/scripts/gen-demo-data.mjs
//   node examples/docker-demo/scripts/gen-demo-data.mjs --rows 1000 --seed 42
//
// Design choices:
// - 1000 orders spread across 4 years (2024..2027) and 4 regions.
// - 3 customer segments, 3 categories, 4 sub-categories per category.
// - ~12% high_discount rows (discount > 0.2), ~9% loss rows (profit < 0).
// - ~6% returns, all linked to real order_ids.
// - 4 region managers (one per region).
// - Source columns populated so KTX source profiling has something to chew on.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "mysql");

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    })
);
const ROWS = Number(args.rows ?? 1000);
const SEED = Number(args.seed ?? 42);
const SCHEMA = args.schema ?? ""; // empty = no prefix (MySQL default); pass "dataforai" for Postgres.
// Optional: --out-dir <abs-path> writes to a different directory
// (used to also render the postgres-demo SQL with schema=).
const FINAL_OUT_DIR = args["out-dir"] ? path.resolve(args["out-dir"]) : OUT_DIR;
const FINAL_SQL_PATH = path.join(FINAL_OUT_DIR, "01-init.sql");
const FINAL_BASELINE_PATH = path.join(FINAL_OUT_DIR, "_baseline.json");

// ---- seeded PRNG (mulberry32) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));

// ---- domains ----
const REGIONS = [
  { region: "East", manager: "Alice", weight: 0.35 },
  { region: "Central South", manager: "Bob", weight: 0.25 },
  { region: "Northeast", manager: "Cathy", weight: 0.20 },
  { region: "Southwest", manager: "David", weight: 0.20 }
];
const SEGMENTS = ["Consumer", "Corporate", "Small Business"];
const SHIP_MODES = ["Standard", "Second Class", "First Class", "Same Day"];
const CATEGORIES = [
  { cat: "Office Supplies", subs: ["Paper", "Storage", "Binders", "Supplies"] },
  { cat: "Furniture", subs: ["Chairs", "Tables", "Bookcases", "Furnishings"] },
  { cat: "Technology", subs: ["Accessories", "Phones", "Machines", "Copiers"] }
];
const FIRST = ["Wei", "Yan", "Lei", "Min", "Jing", "Bo", "Hao", "Ling", "Qiang", "Hui", "Tao", "Mei"];
const LAST = ["Zhang", "Li", "Wang", "Zhao", "Qian", "Sun", "Zhou", "Wu", "Zheng", "Feng", "Chen", "Lin"];
const CITY_BY_REGION = {
  "East": ["Shanghai", "Hangzhou", "Nanjing", "Suzhou"],
  "Central South": ["Guangzhou", "Shenzhen", "Changsha", "Wuhan"],
  "Northeast": ["Shenyang", "Dalian", "Changchun", "Harbin"],
  "Southwest": ["Chengdu", "Chongqing", "Kunming", "Guiyang"]
};
const PROVINCE_BY_REGION = {
  "East": "Shanghai/Zhejiang/Jiangsu",
  "Central South": "Guangdong/Hunan/Hubei",
  "Northeast": "Liaoning/Jilin/Heilongjiang",
  "Southwest": "Sichuan/Chongqing/Yunnan"
};
const COUNTRY = "China";

// ---- generators ----
function dateBetween(y1, y2) {
  const start = new Date(Date.UTC(y1, 0, 1)).getTime();
  const end = new Date(Date.UTC(y2, 11, 31)).getTime();
  const t = start + rand() * (end - start);
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}
function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weightedRegion() {
  const r = rand();
  let acc = 0;
  for (const x of REGIONS) {
    acc += x.weight;
    if (r <= acc) return x;
  }
  return REGIONS[REGIONS.length - 1];
}

function makeCustomer(idx) {
  return {
    customer_id: `C-${String(idx).padStart(4, "0")}`,
    customer_name: `${pick(FIRST)} ${pick(LAST)}`
  };
}

function makeOrderLine(idx, customers) {
  const reg = weightedRegion();
  const cat = pick(CATEGORIES);
  const sub = pick(cat.subs);
  const segment = pick(SEGMENTS);
  const shipMode = pick(SHIP_MODES);
  const orderDate = dateBetween(2024, 2027);
  const shipOffset = { "Same Day": 0, "First Class": 1, "Second Class": 3, "Standard": 5 }[shipMode] ?? 4;
  const shipDate = addDays(orderDate, shipOffset);

  // Discount distribution: 12% high (>0.2), rest uniform low.
  const r = rand();
  let discount;
  if (r < 0.12) discount = Number(between(0.21, 0.45).toFixed(4));
  else if (r < 0.55) discount = 0;
  else discount = Number(between(0.0, 0.19).toFixed(4));

  const quantity = intBetween(1, 12);
  // Unit price varies by sub-category for realism.
  const unitPrice = between(15, 480);
  const sales = Number((quantity * unitPrice * (1 - discount)).toFixed(4));

  // Margin: high discount + low-margin sub → loss.
  const baseMargin = 0.22;
  const marginNoise = between(-0.18, 0.18);
  const discountPenalty = discount > 0.2 ? -0.18 : 0;
  const margin = baseMargin + marginNoise + discountPenalty;
  const profit = Number((sales * margin).toFixed(4));

  // Reuse a customer or mint a new one (max 200 customers).
  let customer;
  if (rand() < 0.7 && customers.length > 0) {
    customer = pick(customers);
  } else {
    customer = makeCustomer(customers.length + 1);
    customers.push(customer);
  }

  return {
    row_id: idx + 1,
    order_id: `D-${String(10000 + idx + 1)}`,
    order_date: orderDate,
    ship_date: shipDate,
    ship_mode: shipMode,
    customer_id: customer.customer_id,
    customer_name: customer.customer_name,
    segment,
    city: pick(CITY_BY_REGION[reg.region]),
    province: PROVINCE_BY_REGION[reg.region],
    country_region: COUNTRY,
    region: reg.region,
    product_id: `P-${String(1000 + (idx % 200) + 1)}`,
    category: cat.cat,
    sub_category: sub,
    product_name: `${sub} ${pick(["Premium", "Standard", "Lite", "Pro", "Max"])}`,
    sales,
    quantity,
    discount,
    profit,
    postal_code: String(100000 + intBetween(0, 899999)),
    source_system: "demo",
    source_file: "demo.xlsx",
    source_sheet: "orders",
    source_row_number: idx + 2,
    batch_id: `demo-${Math.floor(idx / 200)}`,
    row_hash: `demo-hash-${idx + 1}`,
    is_deleted: 0
  };
}

function sqlEscape(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ---- main ----
async function main() {
  const customers = [];
  const rows = [];
  for (let i = 0; i < ROWS; i++) rows.push(makeOrderLine(i, customers));

  // Returns: ~6% of orders, only loss_rows more likely returned.
  const lossOrders = rows.filter((r) => r.profit < 0);
  const returnCount = Math.max(1, Math.floor(ROWS * 0.06));
  const returns = [];
  // Sample 50/50 from loss + others
  const lossSample = lossOrders.slice(0, Math.ceil(returnCount / 2));
  const otherSample = rows
    .filter((r) => r.profit >= 0)
    .slice(0, returnCount - lossSample.length);
  const returnSet = [...lossSample, ...otherSample].slice(0, returnCount);
  returnSet.forEach((o, i) => {
    returns.push({
      id: i + 1,
      order_id: o.order_id,
      returned: "是",
      source_system: "demo",
      source_file: "demo.xlsx",
      source_sheet: "returns",
      source_row_number: i + 2,
      batch_id: o.batch_id,
      row_hash: `demo-return-${i + 1}`,
      is_deleted: 0
    });
  });

  // ---- baseline ----
  const activeRows = rows.filter((r) => r.is_deleted === 0);
  const totalSales = activeRows.reduce((s, r) => s + r.sales, 0);
  const totalProfit = activeRows.reduce((s, r) => s + r.profit, 0);
  const profitMargin = totalSales === 0 ? 0 : totalProfit / totalSales;
  const highDiscountRows = activeRows.filter((r) => r.discount > 0.2);
  const lossRows = activeRows.filter((r) => r.profit < 0);
  const byRegion = {};
  for (const r of activeRows) byRegion[r.region] = (byRegion[r.region] ?? 0) + r.sales;
  const byYear = {};
  for (const r of activeRows) {
    const y = r.order_date.slice(0, 4);
    byYear[y] = (byYear[y] ?? 0) + r.sales;
  }
  const orderIds = new Set(activeRows.map((r) => r.order_id));
  const baseline = {
    seed: SEED,
    rows: ROWS,
    generated_at: new Date().toISOString(),
    counts: {
      orders: rows.length,
      people: REGIONS.length,
      returns: returns.length,
      customers: customers.length,
      active_orders: activeRows.length,
      high_discount_rows: highDiscountRows.length,
      loss_rows: lossRows.length,
      unique_orders: orderIds.size
    },
    measures: {
      total_sales: Number(totalSales.toFixed(4)),
      total_profit: Number(totalProfit.toFixed(4)),
      profit_margin: Number(profitMargin.toFixed(6)),
      order_count: orderIds.size
    },
    sales_by_region: Object.fromEntries(
      Object.entries(byRegion).map(([k, v]) => [k, Number(v.toFixed(4))])
    ),
    sales_by_year: Object.fromEntries(
      Object.entries(byYear).map(([k, v]) => [k, Number(v.toFixed(4))])
    ),
    returns_for_loss_orders: lossSample.length,
    schema_columns: 31
  };

  // ---- SQL emit ----
  const lines = [];
  lines.push("-- Auto-generated by examples/docker-demo/scripts/gen-demo-data.mjs");
  lines.push(`-- DO NOT EDIT BY HAND. Re-run the generator to refresh.`);
  lines.push(`-- Seed=${SEED} Rows=${ROWS} Generated=${baseline.generated_at}`);
  lines.push("");

  // schema (unchanged)
  const t = (name) => (SCHEMA ? `${SCHEMA}.${name}` : name);
  const deletedFlagType = SCHEMA ? "SMALLINT" : "TINYINT";
  if (SCHEMA) {
    lines.push(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA};`);
    lines.push("");
  }
  lines.push(`CREATE TABLE IF NOT EXISTS ${t("superstore_orders")} (`);
  lines.push(`  row_id INT PRIMARY KEY,`);
  lines.push(`  order_id VARCHAR(64) NOT NULL,`);
  lines.push(`  order_date DATE NOT NULL,`);
  lines.push(`  ship_date DATE NOT NULL,`);
  lines.push(`  ship_mode VARCHAR(64),`);
  lines.push(`  customer_id VARCHAR(64),`);
  lines.push(`  customer_name VARCHAR(255),`);
  lines.push(`  segment VARCHAR(64),`);
  lines.push(`  city VARCHAR(128),`);
  lines.push(`  province VARCHAR(128),`);
  lines.push(`  country_region VARCHAR(128),`);
  lines.push(`  region VARCHAR(64),`);
  lines.push(`  product_id VARCHAR(64),`);
  lines.push(`  category VARCHAR(128),`);
  lines.push(`  sub_category VARCHAR(128),`);
  lines.push(`  product_name VARCHAR(255),`);
  lines.push(`  sales DECIMAL(12, 4),`);
  lines.push(`  quantity INT,`);
  lines.push(`  discount DECIMAL(8, 4),`);
  lines.push(`  profit DECIMAL(12, 4),`);
  lines.push(`  postal_code VARCHAR(32),`);
  lines.push(`  source_system VARCHAR(64) NOT NULL,`);
  lines.push(`  source_file VARCHAR(255) NOT NULL,`);
  lines.push(`  source_sheet VARCHAR(128) NOT NULL,`);
  lines.push(`  source_row_number INT NOT NULL,`);
  lines.push(`  batch_id VARCHAR(64) NOT NULL,`);
  lines.push(`  row_hash VARCHAR(128) NOT NULL,`);
  lines.push(`  is_deleted ${deletedFlagType} NOT NULL DEFAULT 0,`);
  lines.push(`  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,`);
  lines.push(`  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  lines.push(`);`);
  lines.push("");

  lines.push(`CREATE TABLE IF NOT EXISTS ${t("superstore_people")} (`);
  lines.push(`  region VARCHAR(64) PRIMARY KEY,`);
  lines.push(`  regional_manager VARCHAR(128) NOT NULL,`);
  lines.push(`  source_system VARCHAR(64) NOT NULL,`);
  lines.push(`  source_file VARCHAR(255) NOT NULL,`);
  lines.push(`  source_sheet VARCHAR(128) NOT NULL,`);
  lines.push(`  source_row_number INT NOT NULL,`);
  lines.push(`  batch_id VARCHAR(64) NOT NULL,`);
  lines.push(`  row_hash VARCHAR(128) NOT NULL,`);
  lines.push(`  is_deleted ${deletedFlagType} NOT NULL DEFAULT 0,`);
  lines.push(`  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,`);
  lines.push(`  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  lines.push(`);`);
  lines.push("");

  lines.push(`CREATE TABLE IF NOT EXISTS ${t("superstore_returns")} (`);
  lines.push(`  id INT PRIMARY KEY,`);
  lines.push(`  order_id VARCHAR(64) NOT NULL,`);
  lines.push(`  returned VARCHAR(8) NOT NULL,`);
  lines.push(`  source_system VARCHAR(64) NOT NULL,`);
  lines.push(`  source_file VARCHAR(255) NOT NULL,`);
  lines.push(`  source_sheet VARCHAR(128) NOT NULL,`);
  lines.push(`  source_row_number INT NOT NULL,`);
  lines.push(`  batch_id VARCHAR(64) NOT NULL,`);
  lines.push(`  row_hash VARCHAR(128) NOT NULL,`);
  lines.push(`  is_deleted ${deletedFlagType} NOT NULL DEFAULT 0,`);
  lines.push(`  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,`);
  lines.push(`  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  lines.push(`);`);
  lines.push("");

  // orders insert
  const cols = [
    "row_id","order_id","order_date","ship_date","ship_mode","customer_id","customer_name",
    "segment","city","province","country_region","region","product_id","category",
    "sub_category","product_name","sales","quantity","discount","profit","postal_code",
    "source_system","source_file","source_sheet","source_row_number","batch_id","row_hash","is_deleted"
  ];
  lines.push(`INSERT INTO ${t("superstore_orders")} (${cols.join(", ")}) VALUES`);
  rows.forEach((r, i) => {
    const suffix = i === rows.length - 1 ? ";" : ",";
    const vals = cols.map((c) => sqlEscape(r[c])).join(", ");
    lines.push(`  (${vals})${suffix}`);
  });
  lines.push("");

  // people insert
  lines.push(`INSERT INTO ${t("superstore_people")} (region, regional_manager, source_system, source_file, source_sheet, source_row_number, batch_id, row_hash, is_deleted) VALUES`);
  REGIONS.forEach((r, i) => {
    const suffix = i === REGIONS.length - 1 ? ";" : ",";
    lines.push(`  ('${r.region}', '${r.manager}', 'demo', 'demo.xlsx', 'people', ${i + 2}, 'demo-20260621', 'demo-people-${i + 1}', 0)${suffix}`);
  });
  lines.push("");

  // returns insert
  lines.push(`INSERT INTO ${t("superstore_returns")} (id, order_id, returned, source_system, source_file, source_sheet, source_row_number, batch_id, row_hash, is_deleted) VALUES`);
  returns.forEach((r, i) => {
    const suffix = i === returns.length - 1 ? ";" : ",";
    lines.push(`  (${r.id}, '${r.order_id}', '是', 'demo', 'demo.xlsx', 'returns', ${r.source_row_number}, '${r.batch_id}', '${r.row_hash}', 0)${suffix}`);
  });

  await mkdir(FINAL_OUT_DIR, { recursive: true });
  await writeFile(FINAL_SQL_PATH, lines.join("\n") + "\n", "utf8");
  await writeFile(FINAL_BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");

  console.log(`Wrote ${FINAL_SQL_PATH} (${rows.length} orders, ${returns.length} returns)`);
  console.log(`Wrote ${FINAL_BASELINE_PATH}`);
  console.log("Baseline:");
  console.log(`  total_sales     = ${baseline.measures.total_sales}`);
  console.log(`  total_profit    = ${baseline.measures.total_profit}`);
  console.log(`  profit_margin   = ${baseline.measures.profit_margin}`);
  console.log(`  order_count     = ${baseline.measures.order_count}`);
  console.log(`  high_discount   = ${baseline.counts.high_discount_rows}`);
  console.log(`  loss_rows       = ${baseline.counts.loss_rows}`);
  console.log(`  sales_by_region = ${JSON.stringify(baseline.sales_by_region)}`);
  console.log(`  sales_by_year   = ${JSON.stringify(baseline.sales_by_year)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
