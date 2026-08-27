#!/usr/bin/env node
/**
 * Lucy delivery isolation gate (hard):
 * - A3 Agent Chat paths must not enter the Lucy image build context
 * - Internal test DB contexts (mysql-aliyun / poc / starrocks) must not enter
 *   /app/project-template (customer seed)
 * Does not require private local files to exist in the checkout.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Paths that must be covered by .dockerignore (repo-relative). */
export const A3_DOCKERIGNORE_PATTERNS = [
  "agent-chat",
  "docker-compose.agent-chat.yml",
  "docs/design-lucy-agent-chat-a3.md",
  "docs/runbook-lucy-agent-chat-a3.md",
  "scripts/agent-chat-a3-smoke.mjs",
  "scripts/agent-chat-a3-smoke.test.mjs"
];

/** Repo-root internal test context that must stay out of the Docker build context. */
export const INTERNAL_TEST_DOCKERIGNORE_PATTERNS = [
  "raw-sources",
  "semantic-layer",
  "wiki",
  "skills",
  "evals",
  "ktx.yaml.example"
];

/** Absolute paths inside the Lucy image that must not exist (A3). */
export const A3_IMAGE_DENYLIST = [
  "/app/agent-chat",
  "/app/docker-compose.agent-chat.yml",
  "/app/docs/design-lucy-agent-chat-a3.md",
  "/app/docs/runbook-lucy-agent-chat-a3.md",
  "/app/scripts/agent-chat-a3-smoke.mjs",
  "/app/scripts/agent-chat-a3-smoke.test.mjs"
];

/** Paths that must not appear under the customer seed template. */
export const PROJECT_TEMPLATE_DENY_DIRS = [
  "/app/project-template/semantic-layer/mysql-aliyun",
  "/app/project-template/semantic-layer/poc-mysql-aliyun",
  "/app/project-template/semantic-layer/starrocks-r1"
];

/** Agent ids that must not appear in the seeded access.yaml. */
export const PROJECT_TEMPLATE_DENIED_AGENT_IDS = [
  "poc_demo",
  "forrest_local",
  "kx_guard_tester",
  "zhangsan",
  "workhorse"
];

const DEFAULT_IMAGES = ["project-lucy:p0-smoke", "project-lucy:local"];

function parseArgs(argv) {
  const args = {
    checkImages: false,
    images: [...DEFAULT_IMAGES],
    out: null,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--check-images") args.checkImages = true;
    else if (a === "--image") {
      const v = argv[++i];
      if (!v) throw new Error("--image requires a value");
      if (!args._imagesCustom) {
        args.images = [];
        args._imagesCustom = true;
      }
      args.images.push(v);
    } else if (a === "--out") {
      args.out = argv[++i];
      if (!args.out) throw new Error("--out requires a path");
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

export function parseDockerignore(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

/**
 * Minimal dockerignore matcher for anchored relative paths used by this gate.
 * Supports exact file patterns and directory prefixes (pattern without trailing slash).
 */
export function isIgnoredByDockerignore(relPath, patterns) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const raw of patterns) {
    let p = raw.replace(/\\/g, "/");
    if (p.startsWith("/")) p = p.slice(1);
    if (p.endsWith("/")) p = p.slice(0, -1);
    if (norm === p) return true;
    if (norm.startsWith(p + "/")) return true;
  }
  return false;
}

function assertDockerignoreCovers(dockerignoreText, required, label) {
  const patterns = parseDockerignore(dockerignoreText);
  const missing = [];
  for (const req of required) {
    const covered = patterns.some((p) => {
      const n = p.replace(/^\//, "").replace(/\/$/, "");
      return n === req || req.startsWith(n + "/");
    });
    if (!covered) missing.push(req);
  }
  if (missing.length) {
    throw new Error(`.dockerignore missing ${label} isolation patterns: ${missing.join(", ")}`);
  }
  return patterns;
}

export function assertDockerignoreCoversA3(dockerignoreText) {
  return assertDockerignoreCovers(dockerignoreText, A3_DOCKERIGNORE_PATTERNS, "A3");
}

export function assertDockerignoreCoversInternalTest(dockerignoreText) {
  return assertDockerignoreCovers(dockerignoreText, INTERNAL_TEST_DOCKERIGNORE_PATTERNS, "internal-test");
}

export async function runFixtureSentinelCheck(patterns) {
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-a3-isolation-"));
  const sentinel = `sentinel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const samples = [
      `agent-chat/.env`,
      `agent-chat/hermes-home/${sentinel}`,
      `docker-compose.agent-chat.yml`,
      `docs/design-lucy-agent-chat-a3.md`,
      `docs/runbook-lucy-agent-chat-a3.md`,
      `scripts/agent-chat-a3-smoke.mjs`,
      `scripts/agent-chat-a3-smoke.test.mjs`,
      `semantic-layer/mysql-aliyun/_schema/dataforai.yaml`,
      `wiki/global/poc-playbook.md`,
      `skills/domains/superstore/x.md`,
      `evals/kx_financial/eval/cases.yaml`,
      `raw-sources/mysql-aliyun/connection.json`,
      `ktx.yaml.example`
    ];
    for (const rel of samples) {
      const full = path.join(dir, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, sentinel, "utf8");
      if (!isIgnoredByDockerignore(rel, patterns)) {
        throw new Error(`fixture path not ignored by .dockerignore patterns: ${rel}`);
      }
    }
    const keep = "customer-config.example/ktx.yaml";
    if (isIgnoredByDockerignore(keep, [...A3_DOCKERIGNORE_PATTERNS, ...INTERNAL_TEST_DOCKERIGNORE_PATTERNS])) {
      throw new Error(`isolation patterns incorrectly ignore ${keep}`);
    }
    if (isIgnoredByDockerignore("webui/package.json", A3_DOCKERIGNORE_PATTERNS)) {
      throw new Error(`A3 patterns incorrectly ignore webui/package.json`);
    }
    return { fixtureDir: dir, samplesChecked: samples.length, sentinelValueLength: sentinel.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function checkImageDenylist(imageTag) {
  const a3Checks = A3_IMAGE_DENYLIST.map((p) => `test ! -e '${p.replace(/'/g, `'\\''`)}'`).join(" && ");
  const templateDirChecks = PROJECT_TEMPLATE_DENY_DIRS.map(
    (p) => `test ! -e '${p.replace(/'/g, `'\\''`)}'`
  ).join(" && ");
  const agentPattern = PROJECT_TEMPLATE_DENIED_AGENT_IDS.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
    "|"
  );
  const accessPath = "/app/project-template/webui/config/access.yaml";
  const agentCheck = `if [ -f '${accessPath}' ]; then ! grep -Eq '(^|[[:space:]])id:[[:space:]]*(${agentPattern})([[:space:]]|$)' '${accessPath}'; else true; fi`;
  const script = [a3Checks, templateDirChecks, agentCheck].filter(Boolean).join(" && ");
  const result = spawnSync(
    "docker",
    ["run", "--rm", "--entrypoint", "sh", imageTag, "-c", script],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `image ${imageTag} failed delivery denylist (exit ${result.status}): ${result.stderr || result.stdout || ""}`
    );
  }
  return { image: imageTag, denylistOk: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/lucy-delivery-isolation-smoke.mjs [--check-images] [--image tag]... [--out path]
Lucy hard gate: .dockerignore must exclude A3 + internal test paths; optional docker image denylist.`);
    process.exit(0);
  }

  const checks = [];
  let ok = true;
  const record = (name, pass, detail = {}) => {
    checks.push({ name, pass, ...detail });
    if (!pass) ok = false;
    console.log(JSON.stringify({ check: name, pass, ...detail }));
    return pass;
  };

  try {
    const dockerignoreText = await readFile(path.join(ROOT, ".dockerignore"), "utf8");
    assertDockerignoreCoversA3(dockerignoreText);
    record("dockerignoreCoversA3", true, { patterns: A3_DOCKERIGNORE_PATTERNS });
    assertDockerignoreCoversInternalTest(dockerignoreText);
    record("dockerignoreCoversInternalTest", true, { patterns: INTERNAL_TEST_DOCKERIGNORE_PATTERNS });

    const patterns = parseDockerignore(dockerignoreText);
    const fixture = await runFixtureSentinelCheck(patterns);
    record("fixtureSentinelIgnored", true, fixture);

    if (args.checkImages) {
      for (const image of args.images) {
        try {
          const r = checkImageDenylist(image);
          record(`imageDenylist:${image}`, true, r);
        } catch (error) {
          record(`imageDenylist:${image}`, false, { error: error.message });
        }
      }
    }
  } catch (error) {
    record("isolationGate", false, { error: error.message });
  }

  const evidence = {
    contract: "lucy-delivery-isolation",
    status: ok ? "pass" : "fail",
    checks,
    note: "Private local assets may be absent; gate passes when ignore rules and (optional) images are clean"
  };
  const line = JSON.stringify(evidence, null, 2);
  console.log(line);
  if (args.out) {
    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await writeFile(path.resolve(args.out), line + "\n", "utf8");
  }
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
