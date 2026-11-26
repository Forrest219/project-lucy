#!/usr/bin/env node
/**
 * [HISTORICAL / ARCHIVED — 0.30 一次性迁移脚本]
 * 本脚本仅用于 2026-11-22 对旧 `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`
 * 做 P1-73 MIG 一次性回填。自 2026-11-25 起需求台 SOT 已切至常青需求池
 * `docs/backlog/README.md` 与 `docs/backlog/archive.md`，旧 0.30 清单池已只读冻结，
 * 请勿再次执行本脚本。保留文件仅作历史追溯。
 *
 * P1-73 MIG + 总账阶段前缀回填（委托人 2026-11-22 授权）。
 *
 * 范围：0.30 执行总账主表行 + 其主 Spec（docs/specs）及配对 Plan。
 * - Spec：补 `| 阶段 | CODE |`；状态行补 `CODE｜` 前缀（已有则对齐）。
 * - 发布取证：实施期 S1–S4；仅收口终态 X_REL；禁止 S5（D8 降熵口径）。
 * - Plan：状态行镜像 `CODE｜`。
 * - 总账跟进状态：前缀对齐 Spec 阶段（Spec 为开发台 SOT）。
 * - 已写入阶段的 Spec 从 status-funnel grandfather 名单移除。
 *
 * 用法：node scripts/mig-funnel-inventory-backfill.mjs [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inventoryPrimarySpecRels,
  inventoryStagePrefix
} from "./lint-spec-docs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const INVENTORY = "docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md";
const GRANDFATHER = "docs/governance/spec-status-funnel-grandfather.json";
const CODES = new Set(["S1", "S2", "S3", "S4", "S5", "X_DEF", "X_SUP", "X_REL"]);

function read(rel) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function write(rel, text) {
  if (dryRun) return;
  writeFileSync(path.join(repoRoot, rel), text);
}

function headerRows(text) {
  const rows = [];
  for (const line of text.split("\n").slice(0, 60)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const parts = trimmed.split("|");
    if (parts[0].trim() === "") parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
    rows.push(parts.map((c) => c.trim()));
  }
  return rows;
}

function statusCell(text) {
  return headerRows(text).find((c) => c[0]?.replace(/\*/g, "") === "状态")?.[1] ?? "";
}

function stageCell(text) {
  const rows = headerRows(text).filter((c) => c[0]?.replace(/\*/g, "") === "阶段");
  if (rows.length !== 1) return null;
  return (rows[0][1] ?? "").replace(/[\s*]/g, "");
}

function closeLayer(text) {
  const body = text.split(/^##[ \t]+闭口层级[ \t]*$/m)[1]?.split(/^##[ \t]+/m)[0] ?? "";
  for (const line of body.split("\n")) {
    const m = /[-*]\s*层级\s*[：:]\s*(.+?)\s*$/.exec(line.trim());
    if (m) return m[1].trim();
  }
  return "";
}

function inferStage(status, layer) {
  const prefixed = inventoryStagePrefix(status);
  if (prefixed && CODES.has(prefixed)) {
    if (layer === "发布取证" && prefixed === "S5") return "X_REL";
    return prefixed;
  }
  const s = status;
  const flat = s.replace(/\s+/g, "");
  if (/被取代|不得实施/.test(s)) return "X_SUP";
  if (/委托人结案|结案不做|0\.30 不开发|本分支明确\*\*不做|本分支不做/.test(s)) return "X_DEF";
  if (/Deferred/.test(s)) return "X_DEF";
  // 发布取证：仅证据齐／已收口才 X_REL；在途走主漏斗推断（勿一律 X_REL）。
  if (layer === "发布取证" && /发布取证已收口|发布取证出口证据齐/.test(s)) return "X_REL";
  if (/发布取证出口证据齐|发布取证已收口/.test(s) && !/实现进行中|终稿未确权|未获开发授权|开发未授权/.test(s)) {
    return "X_REL";
  }
  if (/≠完整功能合同|≠功能合同收口|≠功能已收口/.test(flat)) return "S4";
  if (layer !== "发布取证" && /功能合同已收口|功能合同层已收口|功能合同收口（|\*\*CLOSED/.test(s)) {
    return "S5";
  }
  if (/部分落地|实现已落地|代码已落地|代码已实现|已落地（|修复已落地/.test(s)) return "S4";
  if (/开发授权已获得|已获开发授权|开发已授权/.test(s)) return "S3";
  if (/终稿(已)?确权/.test(s) && /未获开发授权|开发未授权|冻结落地|未授权实现/.test(s)) return "S2";
  if (/终稿未确权|待严格评审|v0\.\d-draft|仅登记|入池|草案齐|待委托人/.test(s)) return "S1";
  return "S1";
}

function ensureStatusPrefix(status, code) {
  const stripped = status.trim().replace(/^\*+/, "");
  if (new RegExp(`^${code}[｜|]`).test(stripped)) {
    return status.replace(/^(\*+)?\s*(S[1-5]|X_DEF|X_SUP|X_REL)[｜|]/, `$1${code}｜`);
  }
  // replace wrong prefix
  if (/^(S[1-5]|X_DEF|X_SUP|X_REL)[｜|]/.test(stripped)) {
    return status.replace(/^((\*+)?\s*)(S[1-5]|X_DEF|X_SUP|X_REL)[｜|]/, `$1${code}｜`);
  }
  const star = /^(\*+)/.exec(status.trim());
  const body = status.trim().replace(/^\*+/, "");
  return `${star ? star[1] : ""}${code}｜${body}`;
}

function upsertStageRow(text, code) {
  const lines = text.split("\n");
  let statusIdx = -1;
  let stageIdx = -1;
  const limit = Math.min(lines.length, 60);
  for (let i = 0; i < limit; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("|")) continue;
    const parts = trimmed.split("|").map((p) => p.trim());
    const field = (parts[1] ?? "").replace(/\*/g, "");
    if (field === "阶段") stageIdx = i;
    if (field === "状态") statusIdx = i;
  }
  const stageLine = `| 阶段 | ${code} |`;
  if (stageIdx >= 0) {
    lines[stageIdx] = stageLine;
  } else if (statusIdx >= 0) {
    lines.splice(statusIdx, 0, stageLine);
    statusIdx += 1;
  } else {
    throw new Error("找不到「状态」行，无法插入「阶段」");
  }
  // rewrite status cell prefix
  if (statusIdx >= 0) {
    const parts = lines[statusIdx].trim().split("|");
    // | 状态 | value |
    const value = parts.slice(2, -1).join("|").trim();
    const next = ensureStatusPrefix(value, code);
    lines[statusIdx] = `| 状态 | ${next} |`;
  }
  return lines.join("\n");
}

function upsertPlanStatus(text, code) {
  const lines = text.split("\n");
  const limit = Math.min(lines.length, 60);
  for (let i = 0; i < limit; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("|")) continue;
    const parts = trimmed.split("|").map((p) => p.trim());
    if ((parts[1] ?? "").replace(/\*/g, "") !== "状态") continue;
    const value = parts.slice(2, -1).join("|").trim();
    lines[i] = `| 状态 | ${ensureStatusPrefix(value, code)} |`;
    return lines.join("\n");
  }
  return text;
}

function parseInventoryRows(text) {
  const lines = text.split("\n");
  let started = false;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!started) {
      if (line.startsWith("| 清单 ID")) started = true;
      continue;
    }
    if (line.startsWith("#")) break;
    if (!line.trimStart().startsWith("|")) continue;
    const parts = line.trim().split("|");
    if (parts[0].trim() === "") parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
    const cells = parts.map((c) => c.trim());
    if (cells.length < 8 || cells[0].startsWith("---") || cells[0] === "清单 ID") continue;
    if (!/^P(?:0-[A-Z]|[012]-\d+)$/.test(cells[0])) continue;
    rows.push({ lineIndex: i, id: cells[0], cells });
  }
  return rows;
}

function rebuildInventoryLine(cells) {
  return `| ${cells.join(" | ")} |`;
}

const stats = {
  specsUpdated: [],
  plansUpdated: [],
  inventoryUpdated: [],
  grandfatherRemoved: [],
  skippedMissingSpec: []
};

// Spec stage map for inventory-linked specs
const specCode = new Map();

const invText = read(INVENTORY);
const invRows = parseInventoryRows(invText);

for (const row of invRows) {
  const specs = inventoryPrimarySpecRels(row.cells[7] ?? "");
  for (const specRel of specs) {
    if (!existsSync(path.join(repoRoot, specRel))) {
      stats.skippedMissingSpec.push(`${row.id}:${specRel}`);
      continue;
    }
    if (specCode.has(specRel)) continue;
    let text = read(specRel);
    const layer = closeLayer(text);
    let code = stageCell(text);
    if (!code || !CODES.has(code)) {
      code = inferStage(statusCell(text), layer);
    }
    if (layer === "发布取证") code = "X_REL";
    const next = upsertStageRow(text, code);
    if (next !== text) {
      write(specRel, next);
      stats.specsUpdated.push(`${specRel}→${code}`);
      text = next;
    } else if (stageCell(text) !== code) {
      write(specRel, upsertStageRow(text, code));
      stats.specsUpdated.push(`${specRel}→${code}`);
    }
    specCode.set(specRel, code);

    const planRel = path.posix.join(
      "docs/plans",
      path.posix.basename(specRel).replace(/-spec\.md$/, "-plan.md")
    );
    if (existsSync(path.join(repoRoot, planRel))) {
      const planText = read(planRel);
      const planNext = upsertPlanStatus(planText, code);
      if (planNext !== planText) {
        write(planRel, planNext);
        stats.plansUpdated.push(`${planRel}→${code}`);
      }
    }
  }
}

// Inventory prefixes: Spec SOT when linked; else infer from status prose
const invLines = invText.split("\n");
for (const row of invRows) {
  const specs = inventoryPrimarySpecRels(row.cells[7] ?? "");
  let code = null;
  for (const specRel of specs) {
    if (specCode.has(specRel)) {
      code = specCode.get(specRel);
      break;
    }
    if (existsSync(path.join(repoRoot, specRel))) {
      code = stageCell(read(specRel));
      break;
    }
  }
  if (!code) code = inferStage(row.cells[6], "");
  const nextStatus = ensureStatusPrefix(row.cells[6], code);
  if (nextStatus !== row.cells[6]) {
    row.cells[6] = nextStatus;
    invLines[row.lineIndex] = rebuildInventoryLine(row.cells);
    stats.inventoryUpdated.push(`${row.id}→${code}`);
  }
}

if (stats.inventoryUpdated.length) {
  write(INVENTORY, invLines.join("\n"));
}

// Drop migrated specs from grandfather
const gf = JSON.parse(read(GRANDFATHER));
const before = new Set(gf.files);
const migrated = [...specCode.keys()];
gf.files = gf.files.filter((f) => !specCode.has(f));
const removed = migrated.filter((f) => before.has(f) && !gf.files.includes(f));
stats.grandfatherRemoved = removed;
if (removed.length) {
  write(GRANDFATHER, `${JSON.stringify(gf, null, 2)}\n`);
}

console.log(JSON.stringify({ dryRun, ...stats, specCount: specCode.size }, null, 2));
