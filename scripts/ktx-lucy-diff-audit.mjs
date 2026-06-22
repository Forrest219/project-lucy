#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, opendir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_KTX_ROOT = "/Users/forrest/projects/ktx/ktx";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LUCY_ROOT = path.resolve(SCRIPT_DIR, "..");
const EXCLUDED_NAMES = new Set([
  ".git",
  ".DS_Store",
  "node_modules",
  "dist",
  "coverage",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".turbo",
  ".next",
  ".nuxt",
  ".cache"
]);
const EXCLUDED_PREFIXES = [
  "inbox/",
  "temp/",
  "tmp/",
  ".ktx/secrets/",
  ".ktx/cache/",
  ".ktx/logs/",
  ".ktx/runtime/",
  ".ktx-ui/"
];
const MAX_SAMPLE_ROWS = 80;

function parseArgs(argv) {
  const options = {
    ktxRoot: process.env.KTX_ROOT ?? DEFAULT_KTX_ROOT,
    lucyRoot: process.env.LUCY_ROOT ?? DEFAULT_LUCY_ROOT,
    out: undefined,
    jsonOut: undefined
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ktx") options.ktxRoot = argv[++i];
    else if (arg === "--lucy") options.lucyRoot = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--json") options.jsonOut = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.ktxRoot = path.resolve(options.ktxRoot);
  options.lucyRoot = path.resolve(options.lucyRoot);
  if (!options.out) {
    options.out = path.join(options.lucyRoot, "inbox", `ktx-lucy-diff-${todayInShanghai()}.md`);
  } else {
    options.out = path.resolve(options.out);
  }
  if (options.jsonOut) options.jsonOut = path.resolve(options.jsonOut);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/ktx-lucy-diff-audit.mjs [options]

Options:
  --ktx <path>    Upstream KTX checkout. Default: ${DEFAULT_KTX_ROOT}
  --lucy <path>   Lucy repo root. Default: current repo root
  --out <path>    Markdown report path. Default: inbox/ktx-lucy-diff-YYYY-MM-DD.md
  --json <path>   Optional machine-readable JSON summary path
`);
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function normalizeRel(value) {
  return value.split(path.sep).join("/");
}

function isExcluded(relPath) {
  if (!relPath) return false;
  const normalized = normalizeRel(relPath);
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_NAMES.has(part))) return true;
  if (EXCLUDED_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) return true;
  if (/^\.ktx-ui\/.*\.sqlite(?:-shm|-wal)?$/.test(normalized)) return true;
  return false;
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function scanTree(root) {
  const files = new Map();
  const dirs = new Set();
  const pathTypes = new Map();

  async function walk(absDir, relDir) {
    const handle = await opendir(absDir);
    for await (const entry of handle) {
      const relPath = normalizeRel(path.join(relDir, entry.name));
      if (isExcluded(relPath)) continue;
      const absPath = path.join(root, relPath);
      if (entry.isDirectory()) {
        dirs.add(relPath);
        pathTypes.set(relPath, "dir");
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        const buffer = await readFile(absPath);
        files.set(relPath, {
          hash: hashBuffer(buffer),
          size: buffer.byteLength,
          type: "file"
        });
        pathTypes.set(relPath, "file");
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(absPath);
        files.set(relPath, {
          hash: hashBuffer(Buffer.from(`symlink:${target}`)),
          size: target.length,
          type: "symlink",
          target
        });
        pathTypes.set(relPath, "symlink");
      }
    }
  }

  await walk(root, "");
  return { root, files, dirs, pathTypes };
}

function gitInfo(root) {
  function run(args) {
    try {
      return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "unknown";
    }
  }
  return {
    branch: run(["branch", "--show-current"]) || "detached",
    commit: run(["rev-parse", "--short", "HEAD"])
  };
}

function compareTrees(ktx, lucy) {
  const same = [];
  const modified = [];
  const ktxOnly = [];
  const lucyOnly = [];
  for (const [relPath, ktxFile] of ktx.files.entries()) {
    const lucyFile = lucy.files.get(relPath);
    if (!lucyFile) {
      ktxOnly.push(relPath);
    } else if (lucyFile.hash === ktxFile.hash && lucyFile.type === ktxFile.type) {
      same.push(relPath);
    } else {
      modified.push(relPath);
    }
  }
  for (const relPath of lucy.files.keys()) {
    if (!ktx.files.has(relPath)) lucyOnly.push(relPath);
  }
  for (const list of [same, modified, ktxOnly, lucyOnly]) list.sort();
  return { same, modified, ktxOnly, lucyOnly };
}

function isUnderPrefix(relPath, prefix) {
  return relPath === prefix || relPath.startsWith(`${prefix}/`);
}

function groupStats(prefix, comparison, ktx, lucy) {
  const ktxFiles = [...ktx.files.keys()].filter((file) => isUnderPrefix(file, prefix)).length;
  const lucyFiles = [...lucy.files.keys()].filter((file) => isUnderPrefix(file, prefix)).length;
  return {
    path: prefix,
    ktxFiles,
    lucyFiles,
    same: comparison.same.filter((file) => isUnderPrefix(file, prefix)).length,
    modified: comparison.modified.filter((file) => isUnderPrefix(file, prefix)).length,
    ktxOnly: comparison.ktxOnly.filter((file) => isUnderPrefix(file, prefix)).length,
    lucyOnly: comparison.lucyOnly.filter((file) => isUnderPrefix(file, prefix)).length
  };
}

function pathStatus(stats, ktx, lucy) {
  const ktxType = ktx.pathTypes.get(stats.path) ?? (ktx.files.has(stats.path) ? "file" : undefined);
  const lucyType = lucy.pathTypes.get(stats.path) ?? (lucy.files.has(stats.path) ? "file" : undefined);
  if (!lucyType) return "missing in lucy";
  if (ktxType && lucyType && ktxType !== lucyType) return `type changed: ${ktxType} -> ${lucyType}`;
  if (ktxType !== "dir") {
    if (stats.same === 1 && stats.modified === 0 && stats.ktxOnly === 0) return "same";
    if (stats.modified > 0) return "modified";
    return "changed";
  }
  if (stats.ktxOnly === 0 && stats.modified === 0 && stats.lucyOnly === 0) return "same";
  if (stats.same === 0 && stats.modified === 0 && stats.ktxOnly > 0) return "mostly missing/replaced";
  if (stats.ktxOnly === 0 && stats.modified === 0 && stats.lucyOnly > 0) return "lucy additions";
  return "partial overlap";
}

function primarySegments(tree) {
  const paths = new Set();
  for (const relPath of [...tree.pathTypes.keys(), ...tree.files.keys()]) {
    paths.add(relPath.split("/")[0]);
  }
  return [...paths].sort();
}

function secondarySegments(tree) {
  const paths = new Set();
  for (const relPath of [...tree.pathTypes.keys(), ...tree.files.keys()]) {
    const parts = relPath.split("/");
    if (parts.length >= 2) paths.add(parts.slice(0, 2).join("/"));
  }
  return [...paths].sort();
}

function folderDepth(pathValue) {
  return pathValue.split("/").length;
}

function typeOfPath(tree, relPath) {
  return tree.pathTypes.get(relPath) ?? (tree.files.has(relPath) ? tree.files.get(relPath).type : "missing");
}

function scriptDiff(ktx, lucy) {
  const ktxScripts = readPackageScripts(ktx.root);
  const lucyScripts = readPackageScripts(lucy.root);
  const rows = [];
  const names = [...new Set([...Object.keys(ktxScripts), ...Object.keys(lucyScripts)])].sort();
  for (const name of names) {
    const left = ktxScripts[name];
    const right = lucyScripts[name];
    if (left === right) continue;
    rows.push({
      script: name,
      ktx: left ?? "",
      lucy: right ?? "",
      status: left === undefined ? "lucy-only" : right === undefined ? "ktx-only" : "changed"
    });
  }
  return rows;
}

function readPackageScripts(root) {
  try {
    const pkg = JSON.parse(execFileSync("node", ["-e", "console.log(JSON.stringify(require(process.argv[1])))", path.join(root, "package.json")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function mdEscape(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function mdTable(headers, rows) {
  if (rows.length === 0) return "_No rows._\n";
  const out = [];
  out.push(`| ${headers.map(mdEscape).join(" | ")} |`);
  out.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) out.push(`| ${row.map(mdEscape).join(" | ")} |`);
  return `${out.join("\n")}\n`;
}

function statsTableRows(paths, comparison, ktx, lucy) {
  return paths.map((prefix) => {
    const stats = groupStats(prefix, comparison, ktx, lucy);
    return [
      prefix,
      typeOfPath(ktx, prefix),
      typeOfPath(lucy, prefix),
      stats.ktxFiles,
      stats.lucyFiles,
      stats.same,
      stats.modified,
      stats.ktxOnly,
      stats.lucyOnly,
      pathStatus(stats, ktx, lucy)
    ];
  });
}

function listSample(title, files) {
  const rows = files.slice(0, MAX_SAMPLE_ROWS).map((file) => [file]);
  const suffix = files.length > MAX_SAMPLE_ROWS ? `\n_Only first ${MAX_SAMPLE_ROWS} of ${files.length} rows shown._\n` : "";
  return `## ${title}\n\n${mdTable(["path"], rows)}${suffix}`;
}

function inferFunctionalDiffs(comparison, ktx, lucy) {
  const lucyPrimary = new Set(primarySegments(lucy));
  const ktxPrimary = new Set(primarySegments(ktx));
  const lucyOnlyPrimary = [...lucyPrimary].filter((item) => !ktxPrimary.has(item)).sort();
  const ktxOnlyPrimary = [...ktxPrimary].filter((item) => !lucyPrimary.has(item)).sort();
  const bullets = [
    "以下为基于目录、配置与脚本差异的静态推断，不等同于运行时行为证明。",
    `Lucy 新增顶层路径：${lucyOnlyPrimary.length > 0 ? lucyOnlyPrimary.join(", ") : "none"}。`,
    `KTX 上游独有顶层路径：${ktxOnlyPrimary.length > 0 ? ktxOnlyPrimary.join(", ") : "none"}。`
  ];
  if (lucyPrimary.has("webui")) bullets.push("Lucy 增加 WebUI/API/MCP proxy 管理面，用于承载数据库接入、agent 配置、审计与平台运维流程。");
  if (lucyPrimary.has("semantic-layer")) bullets.push("Lucy 增加业务语义层目录，目标是把客户数据库暴露为可治理的数据问答能力。");
  if (lucyPrimary.has("evals")) bullets.push("Lucy 增加业务 eval/验收资产，用于验证 agent 面向业务问题的回答质量。");
  if (lucyPrimary.has("docker-compose.yml") || lucyPrimary.has("Dockerfile")) bullets.push("Lucy 增加 Docker 交付面，镜像内置 pinned KTX runtime，而不是在仓库内 vendor KTX 源码。");
  if (ktxOnlyPrimary.includes(".github") || ktxOnlyPrimary.includes("release-policy.json")) bullets.push("上游 KTX 的 CI/release/质量发布资产未在 Lucy 仓库等价保留；Lucy 需要以自身 release gates 覆盖产品交付质量。");
  if (comparison.modified.includes("package.json")) bullets.push("两边 package scripts 已分化：Lucy 增加 eval、spec lint、Docker smoke、business eval 等产品化门禁。");
  return bullets;
}

function renderReport({ options, ktxInfo, lucyInfo, ktx, lucy, comparison, packageRows }) {
  const ktxPrimaryDirs = [...ktx.dirs].filter((dir) => folderDepth(dir) === 1).sort();
  const ktxSecondaryDirs = [...ktx.dirs].filter((dir) => folderDepth(dir) === 2).sort();
  const ktxPrimaryPaths = primarySegments(ktx);
  const ktxSecondaryPaths = secondarySegments(ktx);
  const lucyAddedPrimary = primarySegments(lucy).filter((item) => !primarySegments(ktx).includes(item)).sort();
  const functionalBullets = inferFunctionalDiffs(comparison, ktx, lucy).map((item) => `- ${item}`).join("\n");

  return `# KTX vs Lucy Diff Audit

| Metadata | Value |
|---|---|
| Generated At | ${new Date().toISOString()} |
| KTX Root | ${options.ktxRoot} |
| KTX Git | ${ktxInfo.branch}@${ktxInfo.commit} |
| Lucy Root | ${options.lucyRoot} |
| Lucy Git | ${lucyInfo.branch}@${lucyInfo.commit} |
| Exclusions | ${[...EXCLUDED_NAMES].join(", ")}; ${EXCLUDED_PREFIXES.join(", ")} |

## Summary

| Metric | Count |
|---|---:|
| KTX files scanned | ${ktx.files.size} |
| Lucy files scanned | ${lucy.files.size} |
| Same files | ${comparison.same.length} |
| Modified files | ${comparison.modified.length} |
| KTX-only files | ${comparison.ktxOnly.length} |
| Lucy-only files | ${comparison.lucyOnly.length} |

## Functional Difference Notes

${functionalBullets}

## package.json Script Diff

${mdTable(["script", "ktx", "lucy", "status"], packageRows.map((row) => [row.script, row.ktx, row.lucy, row.status]))}

## KTX First-Level Folder Diff

${mdTable(["path", "ktx type", "lucy type", "ktx files", "lucy files", "same", "modified", "ktx-only", "lucy-only", "status"], statsTableRows(ktxPrimaryDirs, comparison, ktx, lucy))}

## KTX Second-Level Folder Diff

${mdTable(["path", "ktx type", "lucy type", "ktx files", "lucy files", "same", "modified", "ktx-only", "lucy-only", "status"], statsTableRows(ktxSecondaryDirs, comparison, ktx, lucy))}

## KTX First-Level Path Diff

${mdTable(["path", "ktx type", "lucy type", "ktx files", "lucy files", "same", "modified", "ktx-only", "lucy-only", "status"], statsTableRows(ktxPrimaryPaths, comparison, ktx, lucy))}

## KTX Second-Level Path Diff

${mdTable(["path", "ktx type", "lucy type", "ktx files", "lucy files", "same", "modified", "ktx-only", "lucy-only", "status"], statsTableRows(ktxSecondaryPaths, comparison, ktx, lucy))}

## Lucy Added First-Level Paths

${mdTable(["path", "lucy type"], lucyAddedPrimary.map((item) => [item, typeOfPath(lucy, item)]))}

${listSample("Modified File Samples", comparison.modified)}

${listSample("KTX-Only File Samples", comparison.ktxOnly)}

${listSample("Lucy-Only File Samples", comparison.lucyOnly)}

## Reproduction

\`\`\`bash
npm run audit:ktx-diff -- --ktx ${options.ktxRoot} --lucy ${options.lucyRoot} --out ${options.out}
\`\`\`
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [ktx, lucy] = await Promise.all([scanTree(options.ktxRoot), scanTree(options.lucyRoot)]);
  const comparison = compareTrees(ktx, lucy);
  const report = renderReport({
    options,
    ktxInfo: gitInfo(options.ktxRoot),
    lucyInfo: gitInfo(options.lucyRoot),
    ktx,
    lucy,
    comparison,
    packageRows: scriptDiff(ktx, lucy)
  });

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, report, "utf8");
  if (options.jsonOut) {
    await mkdir(path.dirname(options.jsonOut), { recursive: true });
    await writeFile(options.jsonOut, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      ktxRoot: options.ktxRoot,
      lucyRoot: options.lucyRoot,
      counts: {
        ktxFiles: ktx.files.size,
        lucyFiles: lucy.files.size,
        same: comparison.same.length,
        modified: comparison.modified.length,
        ktxOnly: comparison.ktxOnly.length,
        lucyOnly: comparison.lucyOnly.length
      },
      modified: comparison.modified,
      ktxOnly: comparison.ktxOnly,
      lucyOnly: comparison.lucyOnly
    }, null, 2)}\n`, "utf8");
  }
  console.log(`[ktx-lucy-diff-audit] wrote ${options.out}`);
  if (options.jsonOut) console.log(`[ktx-lucy-diff-audit] wrote ${options.jsonOut}`);
}

main().catch((error) => {
  console.error(`[ktx-lucy-diff-audit] FAIL: ${error.message}`);
  process.exit(1);
});
