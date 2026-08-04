#!/usr/bin/env node
/**
 * 202608-GOV-06 P2-B — Release Readiness Evidence Package One-shot Generator
 *
 * Writes `inbox/202608-governance-release-readiness.md` from the same
 * package shape that GET /api/admin/governance/release-readiness-package
 * serves. Reads the current project access.yaml / audit / eval facts and
 * writes only the bounded Markdown export.
 *
 * Run:
 *   cd /Users/zhangxingchen/Projects/project-lucy
 *   node scripts/generate-202608-release-readiness.mjs
 *
 * The script is intentionally idempotent: re-running it overwrites the
 * previous inbox file with the latest package snapshot.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = path.join(projectRoot, "webui", "node_modules", ".bin", "tsx");

if (!existsSync(tsxBin)) {
  process.stderr.write(`tsx not found at ${tsxBin}; install webui deps first\n`);
  process.exit(2);
}

const outputPath = path.join(projectRoot, "inbox", "202608-governance-release-readiness.md");

const runnerPath = path.join(projectRoot, "scripts", "_run-release-readiness.mts");

const child = spawnSync(
  tsxBin,
  [runnerPath],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      _LRR_PROJECT_ROOT: projectRoot,
      _LRR_OUTPUT_PATH: outputPath,
      TSX_TSCONFIG_PATH: path.join(projectRoot, "webui", "tsconfig.json")
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }
);

if (child.status !== 0) {
  process.stderr.write(`tsx runner failed (status=${child.status}):\n${child.stderr}\n`);
  process.exit(1);
}

const lastLine = child.stdout.trim().split(/\n/).at(-1) ?? "{}";
let parsed;
try {
  parsed = JSON.parse(lastLine);
} catch (error) {
  process.stderr.write(`could not parse runner output: ${lastLine}\n${child.stderr}\n`);
  process.exit(1);
}

process.stdout.write(`wrote ${parsed.path} (${parsed.bytes} bytes, sha256=${parsed.sha256})\n`);

const onDisk = await readFile(parsed.path, "utf8");
if (onDisk.length === 0) {
  process.stderr.write("refusing to leave an empty release readiness file in place\n");
  process.exit(1);
}
