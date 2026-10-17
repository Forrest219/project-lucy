#!/usr/bin/env node
// Prepares one isolated, synthetic E2E run directory (Spec §6.2, §6.4).
//
//   node scripts/e2e/prepare-environment.mjs --run-id <id> --mode local
//   node scripts/e2e/prepare-environment.mjs --run-id <id> --mode release \
//        --candidate <identity.json> --profile scripts/e2e/profiles/customer-release.yaml
//
// Output lives under inbox/e2e/<runId>/ only. Real private project directories are refused, there is no
// option to point the run at an existing project, and nothing here talks to a running service.
// Exit codes: 0 prepared, 1 refused/invalid, 2 blocked (reserved for missing infrastructure checks).

import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { catalogDigest, loadCatalog } from "./lib/catalog.mjs";
import {
  DEFAULT_RUN_ROOT, REPO_ROOT, RUN_ID_RE, fail, fileDigest, isInside, parseArgv, sha256Text, treeDigest
} from "./lib/common.mjs";

const FIXTURE_ROOT = path.join(REPO_ROOT, "examples", "security-e2e");
const PROFILE_DIR = path.join(REPO_ROOT, "scripts", "e2e", "profiles");

export const AGENT_TOKENS = [
  ["e2e_finance", "FINANCE"],
  ["e2e_finance_east", "FINANCE_EAST"],
  ["e2e_sales", "SALES"],
  ["e2e_disabled", "DISABLED"],
  ["e2e_channel_only", "CHANNEL_ONLY"],
  ["e2e_discover_only", "DISCOVER_ONLY"],
  ["e2e_split_roles", "SPLIT"],
  ["e2e_legacy", "LEGACY"]
];

export class PrepareError extends Error {}

function secretFile(file, content) {
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function validateCandidate(candidate) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(candidate.gitSha ?? "")) problems.push("gitSha must be a full 40-hex sha");
  if (!/^(sha256:)?[0-9a-f]{64}$/.test(candidate.treeDigest ?? "")) problems.push("treeDigest must be sha256");
  if (!/^sha256:[0-9a-f]{64}$/.test(candidate.imageDigest ?? "")) problems.push("imageDigest must be sha256:<64 hex>");
  if (candidate.platform !== "linux/amd64") problems.push("platform must be linux/amd64 (customer image is single-arch)");
  for (const key of ["ktxVersion", "chartVersion"]) if (!candidate[key]) problems.push(`${key} is required`);
  return problems;
}

function resolveProfile(profilePath) {
  const real = realpathSync(path.resolve(profilePath));
  if (!isInside(PROFILE_DIR, real)) throw new PrepareError(`profile must live in ${PROFILE_DIR} (frozen inputs), got ${real}`);
  const profile = parse(readFileSync(real, "utf8"));
  if (profile?.deployment?.platform !== "linux/amd64" || profile?.deployment?.topology !== "single-replica-k8s") {
    throw new PrepareError("release profile must declare linux/amd64 and single-replica-k8s");
  }
  return { real, profile };
}

/** Resolves the per-run directory and proves it is a fresh child of the run root (or an explicit reset of it). */
function resolveRunDir(runRoot, runId, reset) {
  mkdirSync(runRoot, { recursive: true });
  const rootReal = realpathSync(runRoot);
  const runDir = path.join(rootReal, runId);
  if (existsSync(runDir)) {
    if (!reset) throw new PrepareError(`run directory already exists: ${runDir} (use --reset to recreate this run only)`);
    if (lstatSync(runDir).isSymbolicLink() || path.dirname(realpathSync(runDir)) !== rootReal) {
      throw new PrepareError(`refusing to reset ${runDir}: not a plain child of the run root`);
    }
    rmSync(runDir, { recursive: true, force: true });
  }
  mkdirSync(runDir, { recursive: true, mode: 0o755 });
  return runDir;
}

function renderTemplates(srcRoot, destRoot, values) {
  cpSync(srcRoot, destRoot, { recursive: true });
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      let text = readFileSync(full, "utf8");
      text = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in values)) throw new PrepareError(`template placeholder {{${key}}} in ${path.relative(srcRoot, full)} has no value`);
        return String(values[key]);
      });
      const target = full.endsWith(".template") ? full.slice(0, -".template".length) : full;
      writeFileSync(target, text);
      if (target !== full) rmSync(full);
    }
  };
  walk(destRoot);
}

function makeSecrets(secretsDir) {
  const tokens = {};
  const hashes = {};
  const fingerprints = {};
  for (const [agentId, key] of AGENT_TOKENS) {
    const token = `lucy_e2e_${randomBytes(24).toString("hex")}`;
    tokens[agentId] = token;
    hashes[`TOKEN_HASH_${key}`] = `sha256:${sha256Text(token)}`;
    fingerprints[agentId] = sha256Text(token).slice(0, 12);
  }
  const admins = {
    owner: { adminId: "e2e-owner", password: `Pw-${randomBytes(12).toString("hex")}` },
    operator: { adminId: "e2e-operator", password: `Pw-${randomBytes(12).toString("hex")}` }
  };
  const bootstrapToken = randomBytes(24).toString("hex");
  const dbPassword = randomBytes(18).toString("hex");
  secretFile(path.join(secretsDir, "tokens.json"), `${JSON.stringify(tokens, null, 2)}\n`);
  secretFile(path.join(secretsDir, "admins.json"), `${JSON.stringify(admins, null, 2)}\n`);
  secretFile(path.join(secretsDir, "bootstrap-token"), bootstrapToken);
  secretFile(path.join(secretsDir, "db-password"), dbPassword);
  return { hashes, fingerprints };
}

/**
 * Builds the run directory. Throws PrepareError for any refusal. Never contacts a service and never
 * writes outside `runRoot/<runId>`.
 */
export async function prepareEnvironment(options) {
  const { runId, mode = "local", candidatePath, profilePath, runRoot = DEFAULT_RUN_ROOT, reset = false } = options;
  if (options.projectDir) {
    throw new PrepareError("拒绝真实私有项目目录：本脚本只生成 inbox/e2e/<runId>/project，不接受外部项目路径");
  }
  if (!RUN_ID_RE.test(runId ?? "")) throw new PrepareError(`run id must match ${RUN_ID_RE}`);
  if (mode !== "local" && mode !== "release") throw new PrepareError('mode must be "local" or "release"');
  for (const envName of ["KTX_PROJECT_ROOT", "LUCY_PROJECT_DIR"]) {
    const value = process.env[envName];
    if (value && existsSync(path.join(value, ".ktx", "secrets"))) {
      throw new PrepareError(`${envName} points at a directory with .ktx/secrets; refusing to run next to private configuration`);
    }
  }

  let candidate = null;
  let profileInfo = null;
  if (mode === "release") {
    if (!candidatePath || !profilePath) throw new PrepareError("release mode requires --candidate <identity.json> and --profile <profile.yaml>");
    candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
    const problems = validateCandidate(candidate);
    if (problems.length > 0) throw new PrepareError(`candidate identity invalid: ${problems.join("; ")}`);
    profileInfo = resolveProfile(profilePath);
  } else if (profilePath) {
    profileInfo = resolveProfile(profilePath);
  }

  const seed = options.seed ?? randomBytes(16).toString("hex");
  const { generateDataset, computeGold, renderSeedSql } = await import(path.join(FIXTURE_ROOT, "gold", "compute-gold.mjs"));
  const dataset = generateDataset(seed);

  const runDir = resolveRunDir(runRoot, runId, reset);
  const paths = Object.fromEntries(
    ["project", "checker", "probe", "outside", "client-work", "logs"].map((name) => [name, path.join(runDir, name)])
  );
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  chmodSync(paths.checker, 0o700);
  const secretsDir = path.join(paths.checker, "secrets");
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

  const goldDoc = { ...computeGold(dataset), canaries: dataset.canaries };
  secretFile(path.join(paths.checker, "gold.json"), `${JSON.stringify(goldDoc, null, 2)}\n`);
  secretFile(path.join(paths.checker, "seed-data.sql"), renderSeedSql(dataset));
  writeFileSync(path.join(paths.outside, "canary.txt"), `${dataset.canaries.outsideFile}\n`);

  const { hashes, fingerprints } = makeSecrets(secretsDir);
  const fixtureDigest = treeDigest(FIXTURE_ROOT);
  const markerKey = "shared/e2e-instance-marker";
  const dbHost = options.dbHost ?? "127.0.0.1";
  const dbPort = Number(options.dbPort ?? 5432);
  renderTemplates(path.join(FIXTURE_ROOT, "project-template"), paths.project, {
    ...hashes,
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    DB_PASSWORD_FILE: path.join(secretsDir, "db-password"),
    RUN_ID: runId,
    FIXTURE_DIGEST: fixtureDigest,
    CANARY_FIN_WIKI: dataset.canaries.financeWiki,
    CANARY_SALES_WIKI: dataset.canaries.salesWiki,
    CANARY_SHARED_WIKI: dataset.canaries.sharedWiki,
    CANARY_SPLIT_WIKI: dataset.canaries.splitWiki,
    CANARY_RESTRICTED_WIKI: dataset.canaries.restrictedWiki,
    CANARY_PUBLISHED_SKILL: dataset.canaries.publishedSkill,
    CANARY_DRAFT_SKILL: dataset.canaries.draftSkill,
    CANARY_DEPRECATED_SKILL: dataset.canaries.deprecatedSkill,
    CANARY_INJECTION: dataset.canaries.injection
  });

  const webuiPort = Number(options.webuiPort ?? 15174);
  const proxyPort = Number(options.proxyPort ?? 17879);
  // An external (K8s) instance is addressed by its ingress URLs; the runner then never starts a process.
  const external = Boolean(options.baseUrl);
  if (external && mode !== "release") throw new PrepareError("--base-url (external instance) is only valid in release mode");
  if (external && !options.mcpUrl) throw new PrepareError("--base-url requires --mcp-url");
  const { cases } = loadCatalog();
  const run = {
    contract: "lucy-e2e-run-v1",
    runId,
    mode,
    executionMode: mode === "release" ? "release" : "local",
    releaseEligible: mode === "release",
    createdAt: new Date().toISOString(),
    instanceId: randomUUID(),
    seedDigest: sha256Text(seed),
    fixtureDigest,
    profileDigest: profileInfo ? fileDigest(profileInfo.real) : null,
    caseCatalogDigest: catalogDigest(cases),
    candidate,
    paths: { runDir, ...paths },
    instance: {
      host: "127.0.0.1",
      webuiPort,
      proxyPort,
      baseUrl: external ? options.baseUrl : `http://127.0.0.1:${webuiPort}`,
      mcpUrl: external ? options.mcpUrl : `http://127.0.0.1:${proxyPort}/mcp`,
      startedBy: external ? "external" : "runner",
      markerWikiKey: markerKey,
      env: {
        LUCY_DEPLOYMENT_MODE: "customer",
        LUCY_WEBUI_AUTH: "required",
        LUCY_WEBUI_HOST: "127.0.0.1",
        LUCY_WEBUI_PORT: String(webuiPort),
        LUCY_PROXY_PORT: String(proxyPort),
        // The WebUI generates copyable client configs from this value; pointing it at the run keeps copied configs on the run's own instance.
        LUCY_PUBLIC_MCP_URL: external ? options.mcpUrl : `http://127.0.0.1:${proxyPort}/mcp`,
        LUCY_WEBUI_COOKIE_SECURE: mode === "release" ? "1" : "0",
        LUCY_WEBUI_TEST_PROFILE: mode === "release" ? "0" : "1",
        KTX_PROJECT_ROOT: paths.project,
        LUCY_CONTENT_ROOT: paths.project,
        LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: path.join(secretsDir, "bootstrap-token")
      }
    },
    db: { host: dbHost, port: dbPort, seedSql: path.join(paths.checker, "seed-data.sql"), applied: false },
    agents: AGENT_TOKENS.map(([id]) => ({ id, tokenFingerprint: fingerprints[id] })),
    secretsDir
  };
  writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  return { run, runJsonPath: path.join(runDir, "run.json") };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), {
      "run-id": "value", mode: "value", candidate: "value", profile: "value", "run-root": "value", seed: "value",
      "db-host": "value", "db-port": "value", "webui-port": "value", "proxy-port": "value", "project-dir": "value", "base-url": "value", "mcp-url": "value", reset: "boolean"
    });
    const { run, runJsonPath } = await prepareEnvironment({
      runId: args["run-id"],
      mode: args.mode,
      candidatePath: args.candidate,
      profilePath: args.profile,
      runRoot: args["run-root"],
      seed: args.seed,
      dbHost: args["db-host"],
      dbPort: args["db-port"],
      webuiPort: args["webui-port"],
      proxyPort: args["proxy-port"],
      projectDir: args["project-dir"],
      baseUrl: args["base-url"],
      mcpUrl: args["mcp-url"],
      reset: args.reset === true
    });
    // Secrets stay in checker/secrets; only the location of run.json and public identity is printed.
    process.stdout.write(`${JSON.stringify({ runJson: runJsonPath, runId: run.runId, executionMode: run.executionMode, instanceId: run.instanceId, fixtureDigest: run.fixtureDigest })}\n`);
  } catch (error) {
    fail(error instanceof PrepareError || error instanceof Error ? `prepare-environment: ${error.message}` : String(error), 1);
  }
}
