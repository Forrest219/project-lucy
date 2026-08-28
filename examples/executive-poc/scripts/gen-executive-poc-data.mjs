#!/usr/bin/env node
/**
 * Generate Executive POC demo dataset for internal CFO/COO/CIO demonstrations.
 *
 * Usage:
 *   node examples/executive-poc/scripts/gen-executive-poc-data.mjs
 *   node examples/executive-poc/scripts/gen-executive-poc-data.mjs --order-rows=500000
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "mysql");

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"];
    })
);
const SEED = Number(args.seed ?? 42);
const ORDER_ROWS = Number(args["order-rows"] ?? 50000);
const FINAL_OUT_DIR = args["out-dir"] ? path.resolve(args["out-dir"]) : OUT_DIR;

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

function sqlEscape(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function roundN(n, d = 4) {
  return Number(Number(n).toFixed(d));
}

const ENTITIES = [
  { entity_id: 1, entity_code: "EAST_HOLD", entity_name: "华东控股" },
  { entity_id: 2, entity_code: "SOUTH_OPS", entity_name: "华南运营" },
  { entity_id: 3, entity_code: "NORTH_FIN", entity_name: "华北金融" }
];

const WAREHOUSES = [
  { warehouse_id: 1, warehouse_code: "WH-SC", warehouse_name: "华南仓", region: "South_China" },
  { warehouse_id: 2, warehouse_code: "WH-EC", warehouse_name: "华东仓", region: "East_China" },
  { warehouse_id: 3, warehouse_code: "WH-NC", warehouse_name: "华北仓", region: "North_China" }
];

const CHANNELS = [
  { channel_id: "A", channel_name: "渠道A-品牌" },
  { channel_id: "B", channel_name: "渠道B-投放" },
  { channel_id: "C", channel_name: "渠道C-自然" }
];

const CATEGORIES = ["Electronics", "Apparel", "Home"];
const REGIONS = ["East_China", "South_China", "North_China", "West_China"];
const MONTHS = [
  "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"
];
const Q2_2026 = ["2026-04", "2026-05", "2026-06"];
const Q2_2025 = ["2025-04", "2025-05", "2025-06"];
const Q3_2026 = ["2026-07", "2026-08", "2026-09"];

function monthEndDates() {
  const out = [];
  for (const m of MONTHS) {
    const [y, mo] = m.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    out.push(`${m}-${String(last).padStart(2, "0")}`);
  }
  return out;
}

function emitInsert(table, columns, rows, batchSize = 500) {
  const lines = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const values = chunk.map((row) => `(${columns.map((c) => sqlEscape(row[c])).join(", ")})`).join(",\n");
    lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values};`);
  }
  return lines;
}

async function main() {
  const monthEnds = monthEndDates();
  const monthEndSet = new Set(monthEnds);

  // --- CFO-1: cash balance daily (6 months x 3 entities x ~30 days) ---
  const cashRows = [];
  let cashId = 1;
  const monthEndCashByEntity = {};
  for (const entity of ENTITIES) {
    monthEndCashByEntity[entity.entity_id] = {};
    let balance = 1_000_000 + entity.entity_id * 250_000;
    for (const m of MONTHS.slice(-6)) {
      const [y, mo] = m.split("-").map(Number);
      const daysInMonth = new Date(y, mo, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const asOf = `${m}-${String(d).padStart(2, "0")}`;
        balance += intBetween(-5000, 8000);
        const isMonthEnd = monthEndSet.has(asOf) ? 1 : 0;
        if (isMonthEnd) monthEndCashByEntity[entity.entity_id][m] = balance;
        cashRows.push({
          id: cashId++,
          entity_id: entity.entity_id,
          as_of_date: asOf,
          cash_balance: roundN(balance, 2),
          is_month_end: isMonthEnd
        });
      }
    }
  }

  // Force entity 2 highest 90+ AR ratio
  const arRows = [];
  let arId = 1;
  const arOver90ByEntity = {};
  const latestMonthEnd = monthEnds[monthEnds.length - 1];
  for (const entity of ENTITIES) {
    const buckets = ["0-30", "31-60", "61-90", "90+"];
    let total = 0;
    let over90 = 0;
    for (let c = 0; c < 5; c++) {
      for (const bucket of buckets) {
        let amt = between(10_000, 80_000);
        if (entity.entity_id === 2 && bucket === "90+") amt = between(120_000, 180_000);
        if (entity.entity_id === 2 && bucket === "0-30") amt = between(20_000, 40_000);
        total += amt;
        if (bucket === "90+") over90 += amt;
        arRows.push({
          id: arId++,
          entity_id: entity.entity_id,
          as_of_date: latestMonthEnd,
          customer_id: `C-${entity.entity_id}${c + 1}`,
          aging_bucket: bucket,
          ar_balance: roundN(amt, 2),
          is_month_end: 1
        });
      }
    }
    arOver90ByEntity[entity.entity_id] = roundN(over90 / total, 6);
  }
  const highestArEntity = ENTITIES.reduce((best, e) =>
    arOver90ByEntity[e.entity_id] > arOver90ByEntity[best.entity_id] ? e : best
  ).entity_id;

  // --- CFO-2: Q2 bridge (constructed +15% profit, -28% ocf) ---
  const plRows = [];
  const cfRows = [];
  const collRows = [];
  const plQ2 = { "2025": 0, "2026": 0 };
  const ocfQ2 = { "2025": 0, "2026": 0 };
  for (const entity of ENTITIES) {
    for (const m of MONTHS) {
      const isQ2_25 = Q2_2025.includes(m);
      const isQ2_26 = Q2_2026.includes(m);
      const revenue = between(800_000, 1_200_000);
      let netProfit = revenue * between(0.08, 0.14);
      let operatingCf = netProfit * between(0.7, 1.1);
      if (isQ2_25) {
        netProfit = 100_000;
        operatingCf = 80_000;
      }
      if (isQ2_26) {
        netProfit = 115_000; // +15%
        operatingCf = 57_600; // -28%
      }
      plRows.push({
        entity_id: entity.entity_id,
        period_month: m,
        revenue: roundN(revenue, 2),
        net_profit: roundN(netProfit, 2)
      });
      cfRows.push({
        entity_id: entity.entity_id,
        period_month: m,
        operating_cf: roundN(operatingCf, 2)
      });
      collRows.push({
        entity_id: entity.entity_id,
        period_month: m,
        collection_amt: roundN(isQ2_26 ? 62_000 : 80_000, 2),
        inventory_delta: roundN(isQ2_26 ? 18_000 : 5_000, 2),
        tax_refund_lag_days: isQ2_26 ? 42 : 30
      });
      if (isQ2_25) { plQ2["2025"] += netProfit; ocfQ2["2025"] += operatingCf; }
      if (isQ2_26) { plQ2["2026"] += netProfit; ocfQ2["2026"] += operatingCf; }
    }
  }

  // --- CFO-3: cost centers + budget ---
  const costCenters = [
    { cost_center_id: 1, parent_id: null, level: 1, cost_center_name: "集团总部", business_line: "Group" },
    { cost_center_id: 2, parent_id: 1, level: 2, cost_center_name: "消费事业群", business_line: "Consumer" },
    { cost_center_id: 3, parent_id: 1, level: 2, cost_center_name: "企业事业群", business_line: "Enterprise" },
    { cost_center_id: 4, parent_id: 2, level: 3, cost_center_name: "电商敏捷组", business_line: "Consumer" },
    { cost_center_id: 5, parent_id: 2, level: 3, cost_center_name: "零售渠道组", business_line: "Consumer" },
    { cost_center_id: 6, parent_id: 3, level: 3, cost_center_name: "SaaS订阅组", business_line: "Enterprise" }
  ];
  const fxRates = [];
  for (const m of [...Q3_2026, "2026-06"]) {
    fxRates.push({ rate_date: `${m}-30`, from_ccy: "USD", to_ccy: "CNY", rate_type: "closing", rate: 7.18 });
    fxRates.push({ rate_date: `${m}-30`, from_ccy: "USD", to_ccy: "CNY", rate_type: "average", rate: 7.12 });
  }
  const budgetRows = [];
  for (const cc of costCenters.filter((c) => c.level >= 3)) {
    for (const m of Q3_2026) {
      const budget = between(200_000, 400_000);
      const actual = budget * (cc.cost_center_id === 4 ? 1.12 : between(0.85, 1.05));
      budgetRows.push({
        cost_center_id: cc.cost_center_id,
        period_month: m,
        currency: "CNY",
        budget_amt: roundN(budget, 2),
        actual_amt: roundN(actual, 2),
        forecast_amt: roundN(budget * 1.05, 2)
      });
    }
  }
  const q3ConsumerAchievement = roundN(
    budgetRows.filter((r) => r.cost_center_id === 4).reduce((s, r) => s + r.actual_amt, 0)
      / budgetRows.filter((r) => r.cost_center_id === 4).reduce((s, r) => s + r.budget_amt, 0),
    6
  );

  // --- COO-4: inventory health ---
  const skus = Array.from({ length: 120 }, (_, i) => ({
    sku_id: `SKU-${String(i + 1).padStart(4, "0")}`,
    category: pick(CATEGORIES),
    sku_name: `Product-${i + 1}`
  }));
  const invRows = [];
  let invId = 1;
  let southSlow = 0;
  let eastStockout = 0;
  const snapDate = "2026-06-30";
  for (const wh of WAREHOUSES) {
    for (const sku of skus) {
      let dos = between(15, 45);
      let transit = intBetween(0, 50);
      if (wh.region === "South_China" && invId % 5 === 0) dos = between(61, 90);
      if (wh.region === "East_China" && invId % 7 === 0) { dos = between(2, 6); transit = 0; }
      const qty = intBetween(10, 500);
      const avgOut = qty / Math.max(dos, 1);
      if (dos > 60 && wh.region === "South_China") southSlow++;
      if (dos < 7 && transit === 0 && wh.region === "East_China") eastStockout++;
      invRows.push({
        id: invId++,
        warehouse_id: wh.warehouse_id,
        sku_id: sku.sku_id,
        snapshot_date: snapDate,
        qty_on_hand: qty,
        avg_daily_outbound_30d: roundN(avgOut, 4),
        days_of_supply: roundN(dos, 2),
        qty_in_transit: transit
      });
    }
  }

  // --- COO-5: acquisition + fulfillment ---
  const acqRows = [];
  const fulfillRows = [];
  let orderSeq = 1;
  for (const ch of CHANNELS) {
    for (const m of MONTHS.slice(-6)) {
      const spend = between(50_000, 120_000);
      const users = intBetween(800, 2000);
      acqRows.push({
        channel_id: ch.channel_id,
        cohort_month: m,
        spend: roundN(spend, 2),
        new_users: users,
        cac: roundN(spend / users, 4)
      });
    }
    for (let i = 0; i < 200; i++) {
      const baseDays = ch.channel_id === "B" ? 7 : 5;
      fulfillRows.push({
        order_id: `ORD-${orderSeq++}`,
        channel_id: ch.channel_id,
        order_date: `2026-0${intBetween(1, 6)}-${String(intBetween(1, 28)).padStart(2, "0")}`,
        fulfill_days: ch.channel_id === "B" ? roundN(baseDays * 1.4, 2) : baseDays,
        returned: ch.channel_id === "B" && i % 20 === 0 ? 1 : 0
      });
    }
  }
  const avgFulfillA = roundN(fulfillRows.filter((r) => r.channel_id === "A").reduce((s, r) => s + r.fulfill_days, 0)
    / fulfillRows.filter((r) => r.channel_id === "A").length, 4);
  const avgFulfillB = roundN(fulfillRows.filter((r) => r.channel_id === "B").reduce((s, r) => s + r.fulfill_days, 0)
    / fulfillRows.filter((r) => r.channel_id === "B").length, 4);

  // --- CIO-6: sales margin ---
  const teams = [
    { team_id: 1, team_name: "华南一队", region: "South_China" },
    { team_id: 2, team_name: "华南二队", region: "South_China" },
    { team_id: 3, team_name: "华东一队", region: "East_China" }
  ];
  const customers = Array.from({ length: 30 }, (_, i) => ({
    customer_id: `CU-${i + 1}`,
    region: pick(["South_China", "East_China", "North_China"]),
    team_id: pick([1, 2, 3]),
    customer_phone: `138${String(10000000 + i).slice(0, 8)}`
  }));
  const marginRows = [];
  for (const c of customers) {
    for (const m of MONTHS.slice(-3)) {
      const sales = between(20_000, 80_000);
      marginRows.push({
        team_id: c.team_id,
        customer_id: c.customer_id,
        period_month: m,
        region: c.region,
        customer_phone: c.customer_phone,
        sales: roundN(sales, 2),
        gross_margin: roundN(sales * between(0.15, 0.35), 2)
      });
    }
  }

  // --- CIO-7: order lines + MV rollup ---
  const orderLines = [];
  const rollupMap = new Map();
  const startDate = new Date("2024-01-01");
  for (let i = 0; i < ORDER_ROWS; i++) {
    const d = new Date(startDate.getTime() + intBetween(0, 900) * 86400000);
    const orderDate = d.toISOString().slice(0, 10);
    const region = pick(REGIONS);
    const category = pick(CATEGORIES);
    const sales = roundN(between(10, 500), 2);
    const qty = intBetween(1, 5);
    orderLines.push({
      order_date: orderDate,
      region,
      category,
      sku_id: pick(skus).sku_id,
      sales,
      qty
    });
    const y = orderDate.slice(0, 4);
    const q = Math.ceil(Number(orderDate.slice(5, 7)) / 3);
    const key = `${y}Q${q}|${region}|${category}`;
    const cur = rollupMap.get(key) ?? { year_quarter: `${y}Q${q}`, region, category, sales: 0, qty: 0 };
    cur.sales += sales;
    cur.qty += qty;
    rollupMap.set(key, cur);
  }
  const mvRows = [...rollupMap.values()].map((r) => ({
    year_quarter: r.year_quarter,
    region: r.region,
    category: r.category,
    sales: roundN(r.sales, 2),
    qty: r.qty
  }));
  const sampleRollup = mvRows.find((r) => r.year_quarter === "2026Q2" && r.region === "East_China" && r.category === "Electronics");
  const sampleDetailSales = orderLines
    .filter((r) => {
      const y = r.order_date.slice(0, 4);
      const q = Math.ceil(Number(r.order_date.slice(5, 7)) / 3);
      return `${y}Q${q}` === "2026Q2" && r.region === "East_China" && r.category === "Electronics";
    })
    .reduce((s, r) => s + r.sales, 0);

  // --- CIO-8: token + tickets ---
  const tokenRows = [];
  const ticketRows = [];
  const depts = ["Finance", "SupplyChain", "Sales", "Engineering"];
  const models = ["MiniMax", "Claude", "GPT"];
  for (const dept of depts) {
    for (const m of ["2026-04", "2026-05", "2026-06"]) {
      tokenRows.push({
        dept,
        model: pick(models),
        period_month: m,
        tokens: intBetween(500_000, 2_000_000)
      });
      ticketRows.push({
        dept,
        period_month: m,
        tickets_closed: intBetween(80, 300)
      });
    }
  }
  const engTokens = tokenRows.filter((r) => r.dept === "Engineering").reduce((s, r) => s + r.tokens, 0);
  const engTickets = ticketRows.filter((r) => r.dept === "Engineering").reduce((s, r) => s + r.tickets_closed, 0);
  const tokenPerTicket = roundN(engTokens / engTickets, 4);

  const baseline = {
    seed: SEED,
    order_rows: ORDER_ROWS,
    generated_at: new Date().toISOString(),
    cfo1: {
      month_end_cash_by_entity: monthEndCashByEntity,
      ar_over_90_ratio_by_entity: arOver90ByEntity,
      highest_ar_over_90_entity_id: highestArEntity
    },
    cfo2: {
      q2_net_profit_yoy_pct: plQ2["2025"] > 0
        ? roundN((plQ2["2026"] - plQ2["2025"]) / plQ2["2025"], 6)
        : 0.15,
      q2_operating_cf_yoy_pct: ocfQ2["2025"] > 0
        ? roundN((ocfQ2["2026"] - ocfQ2["2025"]) / ocfQ2["2025"], 6)
        : -0.28,
      q2_2026_net_profit_total: roundN(plQ2["2026"], 2),
      q2_2026_operating_cf_total: roundN(ocfQ2["2026"], 2)
    },
    cfo3: {
      consumer_ecommerce_q3_budget_achievement: q3ConsumerAchievement,
      cost_center_id: 4
    },
    coo4: {
      south_china_slow_moving_sku_count: southSlow,
      east_china_stockout_risk_sku_count: eastStockout,
      snapshot_date: snapDate
    },
    coo5: {
      avg_fulfill_days_channel_a: avgFulfillA,
      avg_fulfill_days_channel_b: avgFulfillB,
      fulfill_days_gap_pct: roundN((avgFulfillB - avgFulfillA) / avgFulfillA, 6)
    },
    cio7: {
      sample_rollup_key: "2026Q2|East_China|Electronics",
      mv_sales: sampleRollup ? sampleRollup.sales : roundN(sampleDetailSales, 2),
      detail_sales: roundN(sampleDetailSales, 2)
    },
    cio8: {
      engineering_token_per_ticket: tokenPerTicket,
      engineering_tokens: engTokens,
      engineering_tickets: engTickets
    },
    counts: {
      cash_balance_rows: cashRows.length,
      ar_rows: arRows.length,
      inventory_rows: invRows.length,
      order_line_rows: orderLines.length,
      mv_rollup_rows: mvRows.length
    }
  };

  const lines = [];
  lines.push("-- Auto-generated by examples/executive-poc/scripts/gen-executive-poc-data.mjs");
  lines.push(`-- Seed=${SEED} OrderRows=${ORDER_ROWS}`);
  lines.push("CREATE DATABASE IF NOT EXISTS dataforai;");
  lines.push("USE dataforai;");
  lines.push("");
  lines.push("SET NAMES utf8mb4;");
  lines.push("");

  const ddl = `
CREATE TABLE dim_legal_entity (
  entity_id INT PRIMARY KEY,
  entity_code VARCHAR(32) NOT NULL,
  entity_name VARCHAR(128) NOT NULL
);
CREATE TABLE dim_cost_center (
  cost_center_id INT PRIMARY KEY,
  parent_id INT NULL,
  level INT NOT NULL,
  cost_center_name VARCHAR(128) NOT NULL,
  business_line VARCHAR(64) NOT NULL
);
CREATE TABLE dim_fx_rate (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rate_date DATE NOT NULL,
  from_ccy CHAR(3) NOT NULL,
  to_ccy CHAR(3) NOT NULL,
  rate_type VARCHAR(16) NOT NULL,
  rate DECIMAL(12,6) NOT NULL
);
CREATE TABLE dim_warehouse (
  warehouse_id INT PRIMARY KEY,
  warehouse_code VARCHAR(32) NOT NULL,
  warehouse_name VARCHAR(128) NOT NULL,
  region VARCHAR(64) NOT NULL
);
CREATE TABLE dim_sku (
  sku_id VARCHAR(32) PRIMARY KEY,
  category VARCHAR(64) NOT NULL,
  sku_name VARCHAR(128) NOT NULL
);
CREATE TABLE dim_channel (
  channel_id VARCHAR(8) PRIMARY KEY,
  channel_name VARCHAR(128) NOT NULL
);
CREATE TABLE dim_sales_team (
  team_id INT PRIMARY KEY,
  team_name VARCHAR(128) NOT NULL,
  region VARCHAR(64) NOT NULL
);
CREATE TABLE dim_customer (
  customer_id VARCHAR(32) PRIMARY KEY,
  region VARCHAR(64) NOT NULL,
  team_id INT NOT NULL,
  customer_phone VARCHAR(32) NOT NULL
);
CREATE TABLE fct_daily_cash_balance (
  id INT PRIMARY KEY,
  entity_id INT NOT NULL,
  as_of_date DATE NOT NULL,
  cash_balance DECIMAL(18,2) NOT NULL,
  is_month_end TINYINT NOT NULL
);
CREATE TABLE fct_ar_aging_detail (
  id INT PRIMARY KEY,
  entity_id INT NOT NULL,
  as_of_date DATE NOT NULL,
  customer_id VARCHAR(32) NOT NULL,
  aging_bucket VARCHAR(16) NOT NULL,
  ar_balance DECIMAL(18,2) NOT NULL,
  is_month_end TINYINT NOT NULL
);
CREATE TABLE fct_pl_monthly (
  entity_id INT NOT NULL,
  period_month CHAR(7) NOT NULL,
  revenue DECIMAL(18,2) NOT NULL,
  net_profit DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (entity_id, period_month)
);
CREATE TABLE fct_cashflow_monthly (
  entity_id INT NOT NULL,
  period_month CHAR(7) NOT NULL,
  operating_cf DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (entity_id, period_month)
);
CREATE TABLE fct_collection_monthly (
  entity_id INT NOT NULL,
  period_month CHAR(7) NOT NULL,
  collection_amt DECIMAL(18,2) NOT NULL,
  inventory_delta DECIMAL(18,2) NOT NULL,
  tax_refund_lag_days INT NOT NULL,
  PRIMARY KEY (entity_id, period_month)
);
CREATE TABLE fct_budget_actual (
  cost_center_id INT NOT NULL,
  period_month CHAR(7) NOT NULL,
  currency CHAR(3) NOT NULL,
  budget_amt DECIMAL(18,2) NOT NULL,
  actual_amt DECIMAL(18,2) NOT NULL,
  forecast_amt DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (cost_center_id, period_month, currency)
);
CREATE TABLE fct_inventory_health_daily (
  id INT PRIMARY KEY,
  warehouse_id INT NOT NULL,
  sku_id VARCHAR(32) NOT NULL,
  snapshot_date DATE NOT NULL,
  qty_on_hand INT NOT NULL,
  avg_daily_outbound_30d DECIMAL(18,4) NOT NULL,
  days_of_supply DECIMAL(18,2) NOT NULL,
  qty_in_transit INT NOT NULL
);
CREATE TABLE fct_acquisition_monthly (
  channel_id VARCHAR(8) NOT NULL,
  cohort_month CHAR(7) NOT NULL,
  spend DECIMAL(18,2) NOT NULL,
  new_users INT NOT NULL,
  cac DECIMAL(18,4) NOT NULL,
  PRIMARY KEY (channel_id, cohort_month)
);
CREATE TABLE fct_fulfillment_order (
  order_id VARCHAR(32) PRIMARY KEY,
  channel_id VARCHAR(8) NOT NULL,
  order_date DATE NOT NULL,
  fulfill_days DECIMAL(8,2) NOT NULL,
  returned TINYINT NOT NULL
);
CREATE TABLE fct_sales_margin (
  team_id INT NOT NULL,
  customer_id VARCHAR(32) NOT NULL,
  period_month CHAR(7) NOT NULL,
  region VARCHAR(64) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL,
  sales DECIMAL(18,2) NOT NULL,
  gross_margin DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (team_id, customer_id, period_month)
);
CREATE TABLE fct_order_line_daily (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_date DATE NOT NULL,
  region VARCHAR(64) NOT NULL,
  category VARCHAR(64) NOT NULL,
  sku_id VARCHAR(32) NOT NULL,
  sales DECIMAL(18,2) NOT NULL,
  qty INT NOT NULL,
  KEY idx_order_date (order_date),
  KEY idx_region_category (region, category)
);
CREATE TABLE mv_order_quarterly_rollup (
  year_quarter VARCHAR(8) NOT NULL,
  region VARCHAR(64) NOT NULL,
  category VARCHAR(64) NOT NULL,
  sales DECIMAL(18,2) NOT NULL,
  qty BIGINT NOT NULL,
  PRIMARY KEY (year_quarter, region, category)
);
CREATE TABLE fct_ai_token_consumption (
  dept VARCHAR(64) NOT NULL,
  model VARCHAR(32) NOT NULL,
  period_month CHAR(7) NOT NULL,
  tokens BIGINT NOT NULL,
  PRIMARY KEY (dept, model, period_month)
);
CREATE TABLE fct_business_ticket_closed (
  dept VARCHAR(64) NOT NULL,
  period_month CHAR(7) NOT NULL,
  tickets_closed INT NOT NULL,
  PRIMARY KEY (dept, period_month)
);
`;
  lines.push("DROP TABLE IF EXISTS fct_sales_margin_regional;");
  lines.push("DROP VIEW IF EXISTS fct_sales_margin_regional;");
  for (const t of [
    "fct_business_ticket_closed", "fct_ai_token_consumption", "mv_order_quarterly_rollup",
    "fct_order_line_daily", "fct_sales_margin", "fct_fulfillment_order", "fct_acquisition_monthly",
    "fct_inventory_health_daily", "fct_budget_actual", "fct_collection_monthly", "fct_cashflow_monthly",
    "fct_pl_monthly", "fct_ar_aging_detail", "fct_daily_cash_balance", "dim_customer", "dim_sales_team",
    "dim_channel", "dim_sku", "dim_warehouse", "dim_fx_rate", "dim_cost_center", "dim_legal_entity"
  ]) {
    lines.push(`DROP TABLE IF EXISTS ${t};`);
  }
  lines.push(ddl.trim());
  lines.push("");
  lines.push(...emitInsert("dim_legal_entity", ["entity_id", "entity_code", "entity_name"], ENTITIES));
  lines.push(...emitInsert("dim_cost_center", ["cost_center_id", "parent_id", "level", "cost_center_name", "business_line"], costCenters));
  lines.push(...emitInsert("dim_fx_rate", ["rate_date", "from_ccy", "to_ccy", "rate_type", "rate"], fxRates));
  lines.push(...emitInsert("dim_warehouse", ["warehouse_id", "warehouse_code", "warehouse_name", "region"], WAREHOUSES));
  lines.push(...emitInsert("dim_sku", ["sku_id", "category", "sku_name"], skus));
  lines.push(...emitInsert("dim_channel", ["channel_id", "channel_name"], CHANNELS));
  lines.push(...emitInsert("dim_sales_team", ["team_id", "team_name", "region"], teams));
  lines.push(...emitInsert("dim_customer", ["customer_id", "region", "team_id", "customer_phone"], customers));
  lines.push(...emitInsert("fct_daily_cash_balance", ["id", "entity_id", "as_of_date", "cash_balance", "is_month_end"], cashRows));
  lines.push(...emitInsert("fct_ar_aging_detail", ["id", "entity_id", "as_of_date", "customer_id", "aging_bucket", "ar_balance", "is_month_end"], arRows));
  lines.push(...emitInsert("fct_pl_monthly", ["entity_id", "period_month", "revenue", "net_profit"], plRows));
  lines.push(...emitInsert("fct_cashflow_monthly", ["entity_id", "period_month", "operating_cf"], cfRows));
  lines.push(...emitInsert("fct_collection_monthly", ["entity_id", "period_month", "collection_amt", "inventory_delta", "tax_refund_lag_days"], collRows));
  lines.push(...emitInsert("fct_budget_actual", ["cost_center_id", "period_month", "currency", "budget_amt", "actual_amt", "forecast_amt"], budgetRows));
  lines.push(...emitInsert("fct_inventory_health_daily", ["id", "warehouse_id", "sku_id", "snapshot_date", "qty_on_hand", "avg_daily_outbound_30d", "days_of_supply", "qty_in_transit"], invRows));
  lines.push(...emitInsert("fct_acquisition_monthly", ["channel_id", "cohort_month", "spend", "new_users", "cac"], acqRows));
  lines.push(...emitInsert("fct_fulfillment_order", ["order_id", "channel_id", "order_date", "fulfill_days", "returned"], fulfillRows));
  lines.push(...emitInsert("fct_sales_margin", ["team_id", "customer_id", "period_month", "region", "customer_phone", "sales", "gross_margin"], marginRows));
  lines.push(...emitInsert("fct_order_line_daily", ["order_date", "region", "category", "sku_id", "sales", "qty"], orderLines, 1000));
  lines.push(...emitInsert("mv_order_quarterly_rollup", ["year_quarter", "region", "category", "sales", "qty"], mvRows));
  lines.push(...emitInsert("fct_ai_token_consumption", ["dept", "model", "period_month", "tokens"], tokenRows));
  lines.push(...emitInsert("fct_business_ticket_closed", ["dept", "period_month", "tickets_closed"], ticketRows));
  lines.push(`
CREATE VIEW fct_sales_margin_regional AS
SELECT
  team_id,
  customer_id,
  period_month,
  region,
  CONCAT(LEFT(customer_phone, 3), '****', RIGHT(customer_phone, 4)) AS customer_phone_masked,
  sales,
  gross_margin
FROM fct_sales_margin
WHERE region = 'South_China';
`);

  await mkdir(FINAL_OUT_DIR, { recursive: true });
  await writeFile(path.join(FINAL_OUT_DIR, "01-init.sql"), `${lines.join("\n\n")}\n`);
  await writeFile(path.join(FINAL_OUT_DIR, "_baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote ${path.join(FINAL_OUT_DIR, "01-init.sql")} (${ORDER_ROWS} order lines)`);
  console.log(`Wrote ${path.join(FINAL_OUT_DIR, "_baseline.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
