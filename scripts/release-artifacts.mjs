#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "release");
const releaseTag = valueAfter("--tag") ?? process.env.LUCY_RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? "local";
const ktxVersion = process.env.KTX_VERSION ?? process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.13.0";
const imageTag = process.env.LUCY_DOCKER_IMAGE ?? `project-lucy:${releaseTag}`;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

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
    const name = pkgPath.replace(/^node_modules\//, "");
    components.push({
      type: "library",
      name,
      version: meta.version,
      scope
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
    releaseTag,
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
  const notes = `# Lucy ${releaseTag}

- Git commit: ${gitCommit}
- Docker image: ${imageTag}
- Docker image id: ${imageId}
- Bundled KTX: @kaelio/ktx ${ktxVersion}
- Verified databases: MySQL demo, PostgreSQL demo
- Required gates: ${requiredGates.join("; ")}
- npm audit summary: ${JSON.stringify(audit.totals)}

## Customer Deployment

Use docs/customer-deployment-guide.md and docs/deployment-docker.md for Docker Compose deployment.

## Artifacts

- lucy-release-metadata.json
- lucy-release-notes.md
- lucy-sbom.json
`;

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "lucy-release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "lucy-sbom.json"), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  await writeFile(path.join(outDir, "lucy-release-notes.md"), notes, "utf8");
  console.log(`[release-artifacts] wrote ${outDir}`);
}

main().catch((error) => {
  console.error(`[release-artifacts] FAIL: ${error.message}`);
  process.exit(1);
});
