#!/usr/bin/env node
/**
 * Lucy delivery isolation gate (hard): A3 paths must not enter the Lucy image
 * build context. Does not require A3 files to exist in the checkout.
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

/** Absolute paths inside the Lucy image that must not exist. */
export const A3_IMAGE_DENYLIST = [
  "/app/agent-chat",
  "/app/docker-compose.agent-chat.yml",
  "/app/docs/design-lucy-agent-chat-a3.md",
  "/app/docs/runbook-lucy-agent-chat-a3.md",
  "/app/scripts/agent-chat-a3-smoke.mjs",
  "/app/scripts/agent-chat-a3-smoke.test.mjs"
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

export function assertDockerignoreCoversA3(dockerignoreText) {
  const patterns = parseDockerignore(dockerignoreText);
  const missing = [];
  for (const required of A3_DOCKERIGNORE_PATTERNS) {
    const covered = patterns.some((p) => {
      const n = p.replace(/^\//, "").replace(/\/$/, "");
      return n === required || required.startsWith(n + "/");
    });
    if (!covered) missing.push(required);
  }
  if (missing.length) {
    throw new Error(`.dockerignore missing A3 isolation patterns: ${missing.join(", ")}`);
  }
  return patterns;
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
      `scripts/agent-chat-a3-smoke.test.mjs`
    ];
    for (const rel of samples) {
      const full = path.join(dir, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, sentinel, "utf8");
      if (!isIgnoredByDockerignore(rel, patterns)) {
        throw new Error(`fixture path not ignored by .dockerignore patterns: ${rel}`);
      }
    }
    // A non-A3 path must not be ignored solely by our A3 patterns
    const keep = "webui/package.json";
    if (isIgnoredByDockerignore(keep, A3_DOCKERIGNORE_PATTERNS)) {
      throw new Error(`A3 patterns incorrectly ignore ${keep}`);
    }
    return { fixtureDir: dir, samplesChecked: samples.length, sentinelValueLength: sentinel.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function checkImageDenylist(imageTag) {
  const script = A3_IMAGE_DENYLIST.map((p) => `test ! -e '${p.replace(/'/g, `'\\''`)}'`).join(" && ");
  const result = spawnSync(
    "docker",
    ["run", "--rm", "--entrypoint", "sh", imageTag, "-c", script],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `image ${imageTag} contains denied A3 paths (exit ${result.status}): ${result.stderr || result.stdout || ""}`
    );
  }
  return { image: imageTag, denylistOk: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/lucy-delivery-isolation-smoke.mjs [--check-images] [--image tag]... [--out path]
Lucy hard gate: .dockerignore must exclude A3 paths; optional docker image denylist.`);
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
    const patterns = assertDockerignoreCoversA3(dockerignoreText);
    record("dockerignoreCoversA3", true, { patterns: A3_DOCKERIGNORE_PATTERNS });

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
    note: "A3 checkout may be absent; gate still passes when ignore rules and (optional) images are clean"
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
