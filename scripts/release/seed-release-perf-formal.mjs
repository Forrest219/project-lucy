#!/usr/bin/env node
/**
 * REQ-030-034 SC-10 / Plan Wave 2 — promote a process report into the formal baseline tree.
 *
 *   npm run perf:release-baseline:formal-seed -- --from inbox/perf-baselines/<run>
 *
 * Copies report.json (and a small META.json) to:
 *   inbox/perf-baselines/formal/<lucyVersion>-<gitShaShort>/
 * and updates formal/LATEST → that directory (relative symlink or pointer file).
 *
 * Does not re-run measurements. Refuses to promote status=fail. Secrets must not appear in report.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORMAL_ROOT = path.join(CHECKOUT_ROOT, "inbox", "perf-baselines", "formal");

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+=/]{16,}/i,
  /lucy-perf-fixture-mcp-bearer/i,
  /password\s*[:=]/i,
  /mysql:\/\/[^"'\s]+/i,
  /postgres(?:ql)?:\/\/[^"'\s]+/i
];

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = get("--from");
  if (!from) {
    throw new Error("usage: seed-release-perf-formal.mjs --from inbox/perf-baselines/<run> [--force]");
  }
  return { from, force: argv.includes("--force") };
}

function assertNoSecrets(text, label) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`refusing to promote ${label}: matches secret pattern ${pattern}`);
    }
  }
}

async function main() {
  const { from, force } = parseArgs(process.argv.slice(2));
  const runDir = path.resolve(CHECKOUT_ROOT, from);
  const reportPath = path.join(runDir, "report.json");
  if (!existsSync(reportPath)) throw new Error(`missing report.json under ${runDir}`);

  const raw = await readFile(reportPath, "utf8");
  assertNoSecrets(raw, "report.json");
  const report = JSON.parse(raw);
  if (report.schema !== "lucy-release-perf-baseline/v1") {
    throw new Error(`unexpected schema: ${report.schema}`);
  }
  if (report.status === "fail" && !force) {
    throw new Error(`report status is fail; refuse formal seed (pass --force only with written acceptance)`);
  }
  if (!["pass", "baseline-seed"].includes(report.status) && !force) {
    throw new Error(`report status ${report.status} is not promotable`);
  }

  const dirName = `${report.lucyVersion}-${report.gitShaShort || "unknown"}`;
  const destDir = path.join(FORMAL_ROOT, dirName);
  await mkdir(destDir, { recursive: true });
  const destReport = path.join(destDir, "report.json");
  if (existsSync(destReport) && !force) {
    throw new Error(`formal baseline already exists: ${destDir} (pass --force to overwrite)`);
  }

  await copyFile(reportPath, destReport);
  const digest = createHash("sha256").update(raw).digest("hex");
  const meta = {
    promotedAt: new Date().toISOString(),
    sourceRun: path.relative(CHECKOUT_ROOT, runDir),
    reportSha256: digest,
    status: report.status,
    fixtureTier: report.fixtureTier,
    runnerVersion: report.runnerVersion,
    note: "REQ-030-034 formal baseline; not a claim that the product is shippable"
  };
  await writeFile(path.join(destDir, "META.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  await mkdir(FORMAL_ROOT, { recursive: true });
  const latestLink = path.join(FORMAL_ROOT, "LATEST");
  await rm(latestLink, { force: true });
  try {
    await symlink(dirName, latestLink);
  } catch {
    await writeFile(latestLink, `${dirName}\n`, "utf8");
  }

  const readme = `# Formal release-perf baselines (REQ-030-034)

| 元数据 | 内容 |
|---|---|
| 文档名称 | Formal release-perf baselines |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Cursor |

- **LATEST** → 当前正式基线目录名（symlink 或单行文本）。
- 下一候选相对闸：\`--previous inbox/perf-baselines/formal/LATEST/report.json\`（若 LATEST 为文本指针，解析为 \`formal/<name>/report.json\`）。
- 本目录通过不表示可上线。

Current LATEST: \`${dirName}\`
`;
  await writeFile(path.join(FORMAL_ROOT, "README.md"), readme, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        formalDir: path.relative(CHECKOUT_ROOT, destDir),
        latest: "inbox/perf-baselines/formal/LATEST",
        status: report.status,
        reportSha256: digest
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
