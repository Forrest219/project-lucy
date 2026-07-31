#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webuiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webuiRoot, "..");

const fileExtensions = new Set([".ts", ".tsx", ".md"]);
const ignoredPathParts = new Set(["node_modules", "dist", "coverage", ".vite"]);

export const RULE_IDS = {
  CONNECTION_BARE_UPLOAD_YAML: "CONNECTION_BARE_UPLOAD_YAML",
  CONNECTION_SEMANTIC_MODELING_ACTION: "CONNECTION_SEMANTIC_MODELING_ACTION",
  SEMANTIC_LAYER_CONNECTION_ACTION: "SEMANTIC_LAYER_CONNECTION_ACTION",
  RELOAD_INGEST_CONFUSION: "RELOAD_INGEST_CONFUSION",
  DOC_UPLOAD_YAML_UNTYPED: "DOC_UPLOAD_YAML_UNTYPED"
};

const typedUploadContext = [
  /Schema Manifest/i,
  /\bManifest\b/i,
  /\bmanifest\b/,
  /semantic overlay/i,
  /\boverlay\b/i,
  /资产包/,
  /该 Schema/,
  /Schema/,
  /_schema/,
  /semantic-layer/
];

const docAllowanceContext = [
  /禁止/,
  /禁用/,
  /不得/,
  /不应/,
  /不能/,
  /不要/,
  /禁止文案/,
  /反例/,
  /错位/,
  /裸用/,
  /裸字符串/,
  /not bare/i,
  /forbidden/i,
  /fails?/i,
  /queryBy/i,
  /not\.toBe/i,
  /expect\(/,
  /Current/i,
  /Replace With/i,
  /Keep M\d+/i,
  /M\d+/,
  /Step \d+/i,
  /Mount/i,
  /label=/,
  /button/i,
  /Drawer/i,
  /动作/,
  /暂不支持/,
  /MVP 只支持/,
  /只写入/,
  /目标路径/,
  /No naked/i,
  /历史/,
  /归档/
];

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if ([...ignoredPathParts].some((part) => absolute.split(path.sep).includes(part))) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile() && fileExtensions.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function lineTextAt(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end).trim();
}

function paragraphAt(text, index) {
  const before = text.lastIndexOf("\n\n", index);
  const after = text.indexOf("\n\n", index);
  return text.slice(before === -1 ? 0 : before + 2, after === -1 ? text.length : after);
}

function hasTypedUploadContext(text) {
  return typedUploadContext.some((pattern) => pattern.test(text));
}

function isAllowedDocContext(text) {
  return hasTypedUploadContext(text) || docAllowanceContext.some((pattern) => pattern.test(text));
}

function issue(filePath, text, index, ruleId, message) {
  return {
    file: filePath,
    line: lineNumberAt(text, index),
    ruleId,
    message,
    text: lineTextAt(text, index)
  };
}

function isConnectionScope(filePath) {
  const file = normalize(filePath);
  return file.includes("/src/pages/connections/") || file.includes("/src/components/catalog/");
}

function isSemanticLayerScope(filePath) {
  const file = normalize(filePath);
  return file.endsWith("/src/pages/Catalog.tsx") || file.endsWith("/src/pages/TableEditor.tsx");
}

function isDocumentationScope(filePath) {
  const file = normalize(filePath);
  return file.includes("/webui/docs/") || file.startsWith("webui/docs/");
}

function scanPattern(filePath, text, pattern, ruleId, message, allow) {
  const issues = [];
  let match;
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  while ((match = regex.exec(text)) !== null) {
    if (!allow?.(match.index, match)) {
      issues.push(issue(filePath, text, match.index, ruleId, message));
    }
  }
  return issues;
}

export function scanText(filePath, text) {
  const issues = [];

  if (isConnectionScope(filePath)) {
    issues.push(
      ...scanPattern(
        filePath,
        text,
        /上传\s*YAML/g,
        RULE_IDS.CONNECTION_BARE_UPLOAD_YAML,
        "Connection module upload actions must say Schema Manifest / Manifest, not bare 上传 YAML.",
        (index) => {
          const context = paragraphAt(text, index);
          return hasTypedUploadContext(context);
        }
      )
    );
    issues.push(
      ...scanPattern(
        filePath,
        text,
        /新增指标|编辑\s*Join|保存到语义层/g,
        RULE_IDS.CONNECTION_SEMANTIC_MODELING_ACTION,
        "Connection module must not expose semantic modeling actions as primary actions."
      )
    );
  }

  if (isSemanticLayerScope(filePath)) {
    issues.push(
      ...scanPattern(
        filePath,
        text,
        /添加\s*Schema|测试连接/g,
        RULE_IDS.SEMANTIC_LAYER_CONNECTION_ACTION,
        "Semantic-layer maintenance must not expose connection onboarding/testing actions as primary actions."
      )
    );
  }

  issues.push(
    ...scanPattern(
      filePath,
      text,
      /刷新本地目录[\s\S]{0,120}(触发\s*ingest|扫描数据库|重新生成语义层)/g,
      RULE_IDS.RELOAD_INGEST_CONFUSION,
      "Catalog Reload copy must not imply ingest, physical database scanning, or semantic layer generation.",
      (index) => isDocumentationScope(filePath) && isAllowedDocContext(paragraphAt(text, index))
    )
  );

  if (isDocumentationScope(filePath)) {
    issues.push(
      ...scanPattern(
        filePath,
        text,
        /上传\s*YAML/g,
        RULE_IDS.DOC_UPLOAD_YAML_UNTYPED,
        "Documentation must type 上传 YAML as Schema Manifest, semantic overlay, or asset package.",
        (index) => isAllowedDocContext(paragraphAt(text, index))
      )
    );
  }

  return issues;
}

function defaultTargets() {
  if (process.env.LINT_TARGET_DIR) return [path.resolve(process.env.LINT_TARGET_DIR)];
  return [
    path.join(webuiRoot, "src/pages/connections"),
    path.join(webuiRoot, "src/components/catalog"),
    path.join(webuiRoot, "src/pages/Catalog.tsx"),
    path.join(webuiRoot, "src/pages/TableEditor.tsx"),
    path.join(webuiRoot, "docs"),
    path.join(webuiRoot, "docs/plans")
  ];
}

function filesForTarget(target) {
  if (!existsSync(target)) return [];
  const stat = readdirSync(path.dirname(target), { withFileTypes: true }).find((entry) => entry.name === path.basename(target));
  if (stat?.isFile()) return fileExtensions.has(path.extname(target)) ? [target] : [];
  return walk(target);
}

export function scanFiles(targets = defaultTargets()) {
  const files = [...new Set(targets.flatMap(filesForTarget))];
  return files.flatMap((file) => scanText(file, readFileSync(file, "utf8")));
}

function printIssues(issues) {
  for (const item of issues) {
    const relative = path.relative(repoRoot, item.file);
    console.error(`${relative}:${item.line}: ${item.ruleId}: ${item.message}`);
    console.error(`  ${item.text}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issues = scanFiles();
  if (issues.length > 0) {
    console.error("IA boundary lint failed.\n");
    printIssues(issues);
    process.exit(1);
  }
  console.log("IA boundary lint passed.");
}
