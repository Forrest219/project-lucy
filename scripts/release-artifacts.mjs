#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// ---- arg parsing ----
// Allowed flags: --out <dir>, --tag <tag>, --help / -h.
// Anything else is rejected with a non-zero exit so we never silently
// misinterpret a stray token as a value (e.g. previously `--help` was
// treated as the directory passed to --out, which actually ran the
// full release pipeline and polluted the working tree).
const KNOWN_FLAGS = new Set(["--out", "--tag", "--help", "-h"]);
const args = process.argv.slice(2);

function failUsage(message) {
  console.error(`[release-artifacts] ${message}`);
  console.error("Usage: node scripts/release-artifacts.mjs [--out <dir>] [--tag <tag>] [--help|-h]");
  process.exit(2);
}

let outDir;
let releaseTag;
let help = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    help = true;
    continue;
  }
  if (arg === "--out") {
    const v = args[i + 1];
    if (!v || v.startsWith("--")) failUsage(`--out requires a directory value (got '${v}')`);
    outDir = path.resolve(v);
    i++;
    continue;
  }
  if (arg === "--tag") {
    const v = args[i + 1];
    if (!v || v.startsWith("--")) failUsage(`--tag requires a value (got '${v}')`);
    releaseTag = v;
    i++;
    continue;
  }
  if (KNOWN_FLAGS.has(arg)) continue; // unreachable guard
  failUsage(`unknown argument: ${arg}`);
}

// ---- required customer docs ----
// Each entry has explicit src -> dest mapping; no mechanical prefixing.
// Missing source files fail fast (see main loop).
const REQUIRED_DOCS = [
  { src: "docs/customer-deployment-guide.md", dest: "lucy-customer-deployment-guide.md" },
  { src: "docs/deployment-docker.md",          dest: "lucy-deployment-docker.md" },
  { src: "docs/lucy-test-cases.md",            dest: "lucy-test-cases.md" }
];

if (help) {
  console.log("Usage: node scripts/release-artifacts.mjs [--out <dir>] [--tag <tag>] [--help|-h]");
  console.log("");
  console.log("Writes lucy-release-metadata.json, lucy-release-notes.md, lucy-sbom.json,");
  console.log("and bundled customer docs to <dir> (default: release/).");
  console.log("Required bundled docs (fail-fast if any is missing):");
  for (const entry of REQUIRED_DOCS) {
    console.log(`  ${entry.src} -> ${entry.dest}`);
  }
  process.exit(0);
}

// Apply defaults + env fallbacks AFTER --help short-circuit.
const FINAL_OUT_DIR = outDir ?? path.resolve("release");
const FINAL_RELEASE_TAG = releaseTag ?? process.env.LUCY_RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? "local";
const ktxVersion = process.env.KTX_VERSION ?? process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.13.0";
const imageTag = process.env.LUCY_DOCKER_IMAGE ?? `project-lucy:${FINAL_RELEASE_TAG}`;

function run(command, args, fallback = "unknown") {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function dockerImageId(image) {
  const id = run("docker", ["image", "inspect", image, "--format", "{{.Id}}"], "");
  return id || "not-built-in-this-environment";
}

function packageComponents(lock, scope) {
  const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
  const components = [];
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath.startsWith("node_modules/")) continue;
    if (!meta?.version) continue;
    if (meta.dev === true) continue;
    const dependencyScope = meta.bundled === true || meta.inBundle === true
      ? "bundled"
      : meta.optional === true
        ? "optional"
        : meta.peer === true
          ? "peer"
          : "production";
    const name = pkgPath.replace(/^node_modules\//, "");
    components.push({
      type: "library",
      name,
      version: meta.version,
      scope,
      dependencyScope
    });
  }
  return components.sort((a, b) => `${a.scope}/${a.name}`.localeCompare(`${b.scope}/${b.name}`));
}

function auditWorkspace(name, cwd) {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  let parsed;
  try {
    parsed = result.stdout ? JSON.parse(result.stdout) : undefined;
  } catch {
    parsed = undefined;
  }
  const vulnerabilities = parsed?.vulnerabilities && typeof parsed.vulnerabilities === "object"
    ? Object.values(parsed.vulnerabilities).map((item) => ({
      name: item.name,
      severity: item.severity,
      isDirect: Boolean(item.isDirect),
      range: item.range,
      fixAvailable: item.fixAvailable === undefined ? false : item.fixAvailable
    })).sort((a, b) => `${b.severity}/${a.name}`.localeCompare(`${a.severity}/${b.name}`))
    : [];
  const counts = parsed?.metadata?.vulnerabilities ?? {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: vulnerabilities.length
  };
  return {
    workspace: name,
    command: "npm audit --json",
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    counts,
    vulnerabilities
  };
}

function combinedAudit(workspaces) {
  const totals = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const workspace of workspaces) {
    for (const key of Object.keys(totals)) {
      totals[key] += Number(workspace.counts?.[key] ?? 0);
    }
  }
  return {
    policy: {
      recordedInReleaseArtifacts: true,
      blocking: false,
      recommendedBlockingSeverities: ["high", "critical"]
    },
    ok: workspaces.every((workspace) => workspace.ok),
    hasHighOrCritical: totals.high > 0 || totals.critical > 0,
    totals,
    workspaces
  };
}

async function main() {
  const [rootPkg, webuiPkg, rootLock, webuiLock] = await Promise.all([
    readJson("package.json"),
    readJson("webui/package.json"),
    readJson("package-lock.json"),
    readJson("webui/package-lock.json")
  ]);
  const gitCommit = run("git", ["rev-parse", "HEAD"]);
  const gitShort = run("git", ["rev-parse", "--short", "HEAD"]);
  const imageId = dockerImageId(imageTag);
  const generatedAt = new Date().toISOString();
  const audit = combinedAudit([
    auditWorkspace("root", "."),
    auditWorkspace("webui", "webui")
  ]);
  const requiredGates = [
    "npm run lint:spec",
    "npm run security:baseline",
    "npm audit --json (root, webui)",
    "npm run smoke:p0:docker",
    "npm run smoke:p0:demo",
    "npm run smoke:p0:postgres-demo",
    "npm run smoke:p0:business-eval",
    "npm run audit:ktx-diff"
  ];
  const metadata = {
    generatedAt,
    releaseTag: FINAL_RELEASE_TAG,
    lucy: {
      gitCommit,
      gitShort,
      package: rootPkg.name,
      version: rootPkg.version,
      webuiPackage: webuiPkg.name,
      webuiVersion: webuiPkg.version
    },
    docker: {
      image: imageTag,
      imageId,
      baseImage: "node:22-bookworm-slim"
    },
    ktx: {
      npmPackage: "@kaelio/ktx",
      npmVersion: ktxVersion,
      pythonRuntimeFeature: "core"
    },
    databases: {
      verified: ["mysql:8.4-demo", "postgres:16-alpine-demo"]
    },
    gates: {
      required: requiredGates,
      audit,
      ktxUpgrade: ["npm run compat:ktx-upgrade -- --candidate <ktx-version>"]
    }
  };
  const sbom = {
    bomFormat: "CycloneDX-lite",
    specVersion: "1.0-local",
    serialNumber: `urn:lucy:${gitCommit}`,
    version: 1,
    metadata: {
      timestamp: generatedAt,
      component: {
        type: "application",
        name: rootPkg.name,
        version: rootPkg.version,
        commit: gitCommit
      },
      docker: metadata.docker,
      ktx: metadata.ktx
    },
    components: [
      {
        type: "container",
        name: "node",
        version: "22-bookworm-slim"
      },
      {
        type: "library",
        name: "@kaelio/ktx",
        version: ktxVersion,
        scope: "runtime"
      },
      ...packageComponents(rootLock, "root"),
      ...packageComponents(webuiLock, "webui")
    ]
  };
  const notes = `# Lucy ${FINAL_RELEASE_TAG}

- Git commit: ${gitCommit}
- Docker image: ${imageTag}
- Docker image id: ${imageId}
- Bundled KTX: @kaelio/ktx ${ktxVersion}
- Verified databases: MySQL demo, PostgreSQL demo
- Required gates: ${requiredGates.join("; ")}
- npm audit summary: ${JSON.stringify(audit.totals)}

## Customer Deployment

Use docs/customer-deployment-guide.md and docs/deployment-docker.md for Docker Compose deployment.
Full P0/P1/P2 test case matrix: docs/lucy-test-cases.md (bundled as release/lucy-test-cases.md).

## Artifacts

- lucy-release-metadata.json
- lucy-release-notes.md
- lucy-sbom.json (production/runtime dependencies; dev dependencies omitted)
- lucy-customer-deployment-guide.md (copy of docs/customer-deployment-guide.md)
- lucy-deployment-docker.md (copy of docs/deployment-docker.md)
- lucy-test-cases.md (copy of docs/lucy-test-cases.md)
`;

  await mkdir(FINAL_OUT_DIR, { recursive: true });
  await writeFile(path.join(FINAL_OUT_DIR, "lucy-release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await writeFile(path.join(FINAL_OUT_DIR, "lucy-sbom.json"), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  await writeFile(path.join(FINAL_OUT_DIR, "lucy-release-notes.md"), notes, "utf8");
  // Bundle customer-facing docs as release artifacts.
  // REQUIRED_DOCS use explicit src -> dest mapping (no mechanical prefixing)
  // and fail fast on missing sources; release-notes above already advertises
  // these files, so a partial release would mislead downstream consumers.
  for (const entry of REQUIRED_DOCS) {
    let content;
    try {
      content = await readFile(entry.src, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        console.error(`[release-artifacts] required doc missing: ${entry.src}`);
        process.exit(3);
      }
      throw error;
    }
    await writeFile(path.join(FINAL_OUT_DIR, entry.dest), content, "utf8");
    console.log(`[release-artifacts] bundled ${entry.src} -> ${entry.dest}`);
  }
  console.log(`[release-artifacts] wrote ${FINAL_OUT_DIR}`);
}

main().catch((error) => {
  console.error(`[release-artifacts] FAIL: ${error.message}`);
  process.exit(1);
});
