#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HANDBOOK_PATH = "docs/SYSTEM_HANDBOOK.md";
const VERSION_PATH = "VERSION";
const CHART_PATH = "deploy/k8s/helm/lucy/Chart.yaml";
const LUCY_VERSION_PATH = "webui/src/lib/lucyVersion.ts";
const DOCKERFILE_PATH = "Dockerfile";

function firstMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`could not read ${label}`);
  return match[1];
}

function readText(root, relativePath) {
  const absolute = path.join(root, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(
      `fact source not found at ${absolute}; restore the file (or update §0.0 in ${HANDBOOK_PATH}) then re-run \`npm run lint:handbook-baseline\`.`
    );
  }
  return readFileSync(absolute, "utf8");
}

export function readBaselineSources(root = ROOT) {
  let version;
  try {
    version = readText(root, VERSION_PATH).trim();
  } catch (error) {
    throw new Error(`${error.message} (source: ${VERSION_PATH})`);
  }
  if (!version) {
    throw new Error(`${VERSION_PATH} is empty; expected a non-empty semver-like X.Y.Z value.`);
  }

  let chart;
  try {
    chart = YAML.parse(readText(root, CHART_PATH));
  } catch (error) {
    throw new Error(
      `could not parse ${CHART_PATH}: ${error.message}; fix the fact source, then re-run \`npm run lint:handbook-baseline\`.`
    );
  }
  if (!chart || chart.appVersion === undefined || chart.appVersion === null) {
    throw new Error(
      `${CHART_PATH} has no \`appVersion\` field; add it, then re-run \`npm run lint:handbook-baseline\`.`
    );
  }
  const helmAppVersion = String(chart.appVersion);

  let lucyVersionSrc;
  try {
    lucyVersionSrc = readText(root, LUCY_VERSION_PATH);
  } catch (error) {
    throw new Error(`${error.message} (source: ${LUCY_VERSION_PATH})`);
  }
  let fallbackRaw;
  try {
    fallbackRaw = firstMatch(
      lucyVersionSrc,
      /const FALLBACK = "([0-9]+\.[0-9]+\.[0-9]+)";/,
      `${LUCY_VERSION_PATH} FALLBACK`
    );
  } catch (error) {
    throw new Error(
      `could not parse ${LUCY_VERSION_PATH} FALLBACK: ${error.message}; expected \`const FALLBACK = "X.Y.Z";\`. Fix the file or §0.0 in ${HANDBOOK_PATH}.`
    );
  }
  const sidebarLabel = `v${fallbackRaw}`;

  let dockerfile;
  try {
    dockerfile = readText(root, DOCKERFILE_PATH);
  } catch (error) {
    throw new Error(`${error.message} (source: ${DOCKERFILE_PATH})`);
  }
  let ktxVersion;
  try {
    ktxVersion = firstMatch(
      dockerfile,
      /^ARG KTX_VERSION=(\S+)$/m,
      `${DOCKERFILE_PATH} ARG KTX_VERSION`
    );
  } catch (error) {
    throw new Error(
      `could not parse ${DOCKERFILE_PATH} ARG KTX_VERSION: ${error.message}; expected \`ARG KTX_VERSION=X.Y.Z\`. Fix the file or §0.0 in ${HANDBOOK_PATH}.`
    );
  }

  return { version, sidebarLabel, helmAppVersion, ktxVersion };
}

function extractSection0_0(markdown) {
  const lines = markdown.split("\n");
  let inSection = false;
  const buffer = [];
  for (const line of lines) {
    if (/^### 0\.0 /.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^### /.test(line) || /^## /.test(line)) break;
      buffer.push(line);
    }
  }
  if (buffer.length === 0) {
    throw new Error(
      `could not find §0.0 文档基线 section in ${HANDBOOK_PATH}; ensure heading \`### 0.0 ...\` exists above \`## 0. 常见问题速查\`.`
    );
  }
  return buffer.join("\n");
}

function findFirstTable(section) {
  const lines = section.split("\n");
  let tableStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|.*\|$/.test(lines[i])) {
      tableStart = i;
      break;
    }
  }
  if (tableStart === -1) {
    throw new Error(
      `§0.0 文档基线 section has no markdown table; restore the 字段 / 当前值 / 来源 table in ${HANDBOOK_PATH}.`
    );
  }
  const tableLines = [];
  for (let i = tableStart; i < lines.length; i++) {
    if (/^\|.*\|$/.test(lines[i])) {
      tableLines.push(lines[i]);
    } else if (tableLines.length > 0) {
      break;
    }
  }
  return tableLines;
}

function parseTableRow(line) {
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

export function parseHandbookBaselineTable(markdown) {
  const section = extractSection0_0(markdown);
  const tableLines = findFirstTable(section);
  if (tableLines.length < 3) {
    throw new Error(
      `§0.0 文档基线 table must have a header, a separator, and at least one data row; got ${tableLines.length} line(s) in ${HANDBOOK_PATH}.`
    );
  }
  const dataRows = tableLines.slice(2);
  const result = {};
  for (const row of dataRows) {
    const cells = parseTableRow(row);
    if (cells.length >= 2) {
      const key = cells[0];
      const value = cells[1];
      if (key) result[key] = value;
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`§0.0 文档基线 table has no data rows in ${HANDBOOK_PATH}.`);
  }
  return result;
}

const ROW_TO_SOURCE = {
  "产品版本（`VERSION`）": "version",
  "产品版本标签": "sidebarLabel",
  "Helm `appVersion`": "helmAppVersion",
  "捆绑 KTX 版本": "ktxVersion"
};

export function assertHandbookBaseline(handbookMd, sources) {
  const parsed = parseHandbookBaselineTable(handbookMd);
  const missing = [];
  const mismatches = [];
  for (const [rowKey, sourceKey] of Object.entries(ROW_TO_SOURCE)) {
    const expected = sources[sourceKey];
    if (expected === undefined || expected === null) {
      throw new Error(
        `sources object is missing required field ${JSON.stringify(sourceKey)}; pass { version, sidebarLabel, helmAppVersion, ktxVersion } from \`readBaselineSources\`.`
      );
    }
    if (!(rowKey in parsed)) {
      missing.push(rowKey);
      continue;
    }
    const actual = parsed[rowKey];
    if (actual !== expected) {
      mismatches.push(
        `row "${rowKey}": §0.0 says ${JSON.stringify(actual)} but fact source expects ${JSON.stringify(expected)} (mapped from \`${sourceKey}\`)`
      );
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `§0.0 文档基线 table is missing required rows: ${missing.join(", ")}. ` +
        `Restore them in ${HANDBOOK_PATH} or update the row labels in \`scripts/release/handbook-baseline.mjs\` \`ROW_TO_SOURCE\` if the labels changed intentionally.`
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `§0.0 文档基线 drift in ${HANDBOOK_PATH}:\n` +
        mismatches.map((m) => `  - ${m}`).join("\n") +
        `\nFix by editing §0.0 in ${HANDBOOK_PATH} to match the corresponding fact source ` +
        `(see the \`来源\` column), or fix the fact source itself and re-run \`npm run lint:handbook-baseline\`.`
    );
  }
  return sources;
}

export function runHandbookBaseline(root = ROOT) {
  const handbookPath = path.join(root, HANDBOOK_PATH);
  if (!existsSync(handbookPath)) {
    throw new Error(
      `handbook not found at ${handbookPath}; expected \`${HANDBOOK_PATH}\` at repo root.`
    );
  }
  const sources = readBaselineSources(root);
  const handbookMd = readFileSync(handbookPath, "utf8");
  assertHandbookBaseline(handbookMd, sources);
  return sources;
}

// 双边 realpath 比较：macOS 上 `process.argv[1]` 可能是软链路径（/tmp → /private/tmp），
// 直接比较会在软链调用时静默跳过执行块、退出码 0 却不报错 —— 门禁失效放行。
// realpath 对不存在的路径会抛 ENOENT，catch 后退回 path.resolve 比较。
function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return path.resolve(entry) === self;
  }
}

if (isMainModule()) {
  try {
    const sources = runHandbookBaseline();
    console.log(`[handbook-baseline] OK baseline aligned with VERSION=${sources.version}`);
  } catch (error) {
    console.error("[handbook-baseline] FAIL");
    console.error(error.message);
    process.exitCode = 1;
  }
}
