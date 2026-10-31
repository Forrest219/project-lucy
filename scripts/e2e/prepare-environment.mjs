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
const DB_ENGINES = new Set(["mysql", "postgres"]);

/** MySQL is the floor. PostgreSQL is selected only with --db-engine postgres. */
function resolveDbEngine(value) {
  const engine = value ?? "mysql";
  if (!DB_ENGINES.has(engine)) throw new PrepareError(`--db-engine must be mysql or postgres, got ${engine}`);
  return engine;
}

export const AGENT_TOKENS = [
  ["e2e_finance", "FINANCE"],
  ["e2e_finance_east", "FINANCE_EAST"],
  ["e2e_sales", "SALES"],
  ["e2e_disabled", "DISABLED"],
  ["e2e_channel_only", "CHANNEL_ONLY"],
  ["e2e_discover_only", "DISCOVER_ONLY"],
  ["e2e_split_roles", "SPLIT"],
  ["e2e_legacy", "LEGACY"],
  // C1 disposable fixtures for SEC-10-V04 (multi-role OR East ∪ West) and SEC-10-V05
  // (Agent Constraints AND role). The matching role declarations and `users` blocks live
  // in examples/security-e2e/project-template/webui/config/access.yaml.template.
  ["e2e_east_west", "EAST_WEST"],
  ["e2e_east_constrained", "EAST_CONSTRAINED"]
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
  // The reader/owner passwords live in their own files (mode 0600) so the DB producer
  // can read them through a per-run file path; never in env or argv. `db-password` is
  // kept for backward compatibility with anything that still references it.
  const readerPassword = randomBytes(18).toString("hex");
  const ownerPassword = randomBytes(18).toString("hex");
  secretFile(path.join(secretsDir, "tokens.json"), `${JSON.stringify(tokens, null, 2)}\n`);
  secretFile(path.join(secretsDir, "admins.json"), `${JSON.stringify(admins, null, 2)}\n`);
  secretFile(path.join(secretsDir, "bootstrap-token"), bootstrapToken);
  secretFile(path.join(secretsDir, "db-password"), readerPassword);
  secretFile(path.join(secretsDir, "db-reader.password"), readerPassword);
  secretFile(path.join(secretsDir, "db-owner.password"), ownerPassword);
  return { hashes, fingerprints, readerPassword, ownerPassword };
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
  const dbEngine = resolveDbEngine(options.dbEngine);
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
  const { generateDataset, computeGold, renderSeedSql, computeDatasetDigest } = await import(path.join(FIXTURE_ROOT, "gold", "compute-gold.mjs"));
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
  const seedDataSql = renderSeedSql(dataset);
  const seedSqlDigest = `sha256:${sha256Text(seedDataSql)}`;
  const datasetDigest = computeDatasetDigest(dataset);
  secretFile(path.join(paths.checker, "gold.json"), `${JSON.stringify(goldDoc, null, 2)}\n`);
  secretFile(path.join(paths.checker, "seed-data.sql"), seedDataSql);
  writeFileSync(path.join(paths.outside, "canary.txt"), `${dataset.canaries.outsideFile}\n`);

  const { hashes, fingerprints, readerPassword } = makeSecrets(secretsDir);
  const fixtureDigest = treeDigest(FIXTURE_ROOT);
  const logicalInstanceId = randomUUID();
  const markerKey = "shared/e2e-instance-marker";
  const dbHost = options.dbHost ?? "127.0.0.1";
  const dbPort = Number(options.dbPort ?? (dbEngine === "postgres" ? 5432 : 3306));
  // Per-run isolation id flows from the run id (a long random hex) so every
  // disposable database / role is owned by THIS run; a leftover from a prior
  // run cannot satisfy a check. The same string is used in runOwnerIsolationId
  // (run.db.runOwnerIsolationId) below.
  const runOwnerIsolationId = randomBytes(12).toString("hex");
  // Per-run DB / role names are computed here AND recorded in run.db so the
  // producer and the rendered ktx.yaml stay in lockstep. The ktx.yaml
  // placeholders below reference exactly these names.
  const safeIso = runOwnerIsolationId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
  const dbFinName = `lucy_e2e_fin_${safeIso}`;
  const dbSalesName = `lucy_e2e_sales_${safeIso}`;
  const dbReaderRole = `lucy_e2e_reader_${safeIso}`;
  const dbOwnerRole = options.dbOwnerRole ?? (dbEngine === "postgres" ? "postgres" : "root");
  const secretFilePath = path.join(secretsDir, "db-reader.password");
  // Where the reader password must be READABLE.
  //
  // In a customer deployment the WebUI and the KTX upstream run inside the pod
  // and the password arrives through a mounted Secret at `/var/run/secrets/...`.
  // In a LOCAL run both processes run on the host, where that path does not
  // exist — so the run keeps its own copy inside the run directory. Without it
  // the host-side processes cannot read the password, the database stays
  // unreachable and every data-plane call answers empty.
  const defaultSecretMount = mode === "local" ? path.join(secretsDir, "db") : "/var/run/secrets/lucy/db";
  const secretMountPath = options.dbSecretMountPath ?? defaultSecretMount;
  const containerPasswordPath = path.join(secretMountPath, "password");
  if (mode === "local" && options.dbSecretMountPath === undefined) {
    mkdirSync(secretMountPath, { recursive: true, mode: 0o700 });
    secretFile(containerPasswordPath, readerPassword);
  }
  const ownerPasswordFile = path.join(secretsDir, "db-owner.password");
  renderTemplates(path.join(FIXTURE_ROOT, "project-template"), paths.project, {
    ...hashes,
    DB_DRIVER: dbEngine,
    DB_HOST: dbHost,
    DB_PORT: dbPort,
    DB_FIN_NAME: dbFinName,
    DB_SALES_NAME: dbSalesName,
    DB_READER_ROLE: dbReaderRole,
    DB_PASSWORD_FILE: containerPasswordPath,
    RUN_ID: runId,
    INSTANCE_ID: logicalInstanceId,
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
  // The dual-stack flood origin exists ONLY for the locally started development instance:
  // an externally started instance and the release-mode image keep their own bind
  // address, because their networking is not the harness' to change.
  const floodOriginAvailable = !external && mode === "local";
  if (external && mode !== "release") throw new PrepareError("--base-url (external instance) is only valid in release mode");
  if (external && !options.mcpUrl) throw new PrepareError("--base-url requires --mcp-url");
  // --apply-db asks for a measured seed. prepare-environment only DECLARES the
  // contract (engine/host/port/role/password file paths/digests); it does NOT
  // touch the database. The floor engine is mysql. PostgreSQL is selected with
  // --db-engine postgres, and only that engine has a seed producer
  // (scripts/e2e/apply-db.mjs). The producer writes `run.db.applied = true`
  // only after applySyntheticDbSeed returns applied=true. Until that step runs,
  // `run.db.applied` is false and the harness records `applyRequested: true`.
  const applyDb = options.applyDb === true;
  const seededDbName = options.dbName ?? dbFinName; // legacy alias kept for back-compat
  const readonlyRoles = options.dbReadonlyRoles?.split(",").map((s) => s.trim()).filter(Boolean) ?? [dbReaderRole];
  const { cases } = loadCatalog();
  const run = {
    contract: "lucy-e2e-run-v1",
    runId,
    mode,
    executionMode: mode === "release" ? "release" : "local",
    releaseEligible: mode === "release",
    createdAt: new Date().toISOString(),
    instanceId: logicalInstanceId,
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
      // The rate-limit flood of the security leg needs a SOURCE ADDRESS of its own: the
      // product buckets logins by source (`webui/server/auth/rate-limit.ts`,
      // `sourceTotal` = 30 per 5 minutes), and the flood deliberately burns that bucket.
      // On a locally started instance the WebUI listens dual-stack, so the IPv6 loopback
      // reaches the SAME server while the server sees `::1` instead of `::ffff:127.0.0.1`
      // — a different bucket, with no product threshold, window or key touched.
      // An externally started instance (customer K8s) and the release-mode image are not
      // ours to re-bind, so they have no flood origin and the flood falls back to the main
      // source (see `SecurityContext.floodLogin`).
      floodBaseUrl: floodOriginAvailable ? `http://[::1]:${webuiPort}` : null,
      env: {
        LUCY_DEPLOYMENT_MODE: "customer",
        LUCY_WEBUI_AUTH: "required",
        // Dual-stack on a locally started instance: the main traffic keeps arriving on
        // 127.0.0.1 (the server sees `::ffff:127.0.0.1`, normalized to `127.0.0.1`),
        // while the rate-limit flood can arrive over the IPv6 loopback as `::1`.
        LUCY_WEBUI_HOST: floodOriginAvailable ? "::" : "127.0.0.1",
        LUCY_WEBUI_PORT: String(webuiPort),
        LUCY_PROXY_PORT: String(proxyPort),
        // The WebUI generates copyable client configs from this value; pointing it at the run keeps copied configs on the run's own instance.
        LUCY_PUBLIC_MCP_URL: external ? options.mcpUrl : `http://127.0.0.1:${proxyPort}/mcp`,
        LUCY_WEBUI_COOKIE_SECURE: mode === "release" ? "1" : "0",
        LUCY_WEBUI_TEST_PROFILE: mode === "release" ? "0" : "1",
        KTX_PROJECT_ROOT: paths.project,
        LUCY_CONTENT_ROOT: paths.project,
        LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: path.join(secretsDir, "bootstrap-token"),
        // The DB contract is propagated to the WebUI container via env so the WebUI can read
        // its password from the mounted Secret file at the in-container path.
        LUCY_DB_HOST: dbHost,
        LUCY_DB_PORT: String(dbPort),
        LUCY_DB_NAME: seededDbName,
        LUCY_DB_PASSWORD_FILE: containerPasswordPath
      }
    },
    db: {
      engine: dbEngine,
      host: dbHost,
      port: dbPort,
      name: seededDbName,
      // Per-run disposable DB and reader role names. The producer (apply-db.mjs)
      // creates databases named `${finName}` and `${salesName}` and a single role
      // `${readerRole}`; the rendered ktx.yaml uses the same names so the WebUI
      // connects to the right targets without any host-side renaming.
      finName: dbFinName,
      salesName: dbSalesName,
      readerRole: dbReaderRole,
      ownerRole: dbOwnerRole,
      runOwnerIsolationId,
      seedSql: path.join(paths.checker, "seed-data.sql"),
      seedSqlDigest,
      datasetDigest,
      // `applied` is the contract; it stays false until the producer
      // (applySyntheticDbSeed) actually seeds the disposable DB. `applyRequested`
      // records that the user opted into the seed step; the harness treats it as
      // a signal to call apply-db.mjs before deploy, NOT as a readiness claim.
      applied: false,
      applyRequested: applyDb,
      readonlyRoles,
      // Password files are mode 0600 on disk. They reach the WebUI container
      // through a Kubernetes Secret (the deploy script mounts them at
      // `containerPasswordPath`); the DB host is reached directly by the runner.
      passwordFile: secretFilePath,
      ownerPasswordFile,
      secretMount: secretMountPath,
      containerPasswordPath,
      // The Secret name is the contract the harness uses when applying the seed and
      // when mounting it into the WebUI container. It is generated deterministically from the
      // run id so re-running the same id reuses the same Secret.
      secretName: `lucy-e2e-db-${runId}`
    },
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
      "db-host": "value", "db-port": "value", "db-engine": "value", "webui-port": "value", "proxy-port": "value", "project-dir": "value", "base-url": "value", "mcp-url": "value", reset: "boolean",
      "apply-db": "boolean", "db-name": "value", "db-readonly-roles": "value", "db-secret-mount-path": "value",
      "db-owner-role": "value"
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
      dbEngine: args["db-engine"],
      webuiPort: args["webui-port"],
      proxyPort: args["proxy-port"],
      projectDir: args["project-dir"],
      baseUrl: args["base-url"],
      mcpUrl: args["mcp-url"],
      reset: args.reset === true,
      applyDb: args["apply-db"] === true,
      dbName: args["db-name"],
      dbReadonlyRoles: args["db-readonly-roles"],
      dbSecretMountPath: args["db-secret-mount-path"],
      dbOwnerRole: args["db-owner-role"]
    });
    // Secrets stay in checker/secrets; only the location of run.json and public identity is printed.
    process.stdout.write(`${JSON.stringify({ runJson: runJsonPath, runId: run.runId, executionMode: run.executionMode, instanceId: run.instanceId, fixtureDigest: run.fixtureDigest })}\n`);
  } catch (error) {
    fail(error instanceof PrepareError || error instanceof Error ? `prepare-environment: ${error.message}` : String(error), 1);
  }
}
