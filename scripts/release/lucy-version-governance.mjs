#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { runHandbookBaseline } from "./handbook-baseline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PRODUCT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function tagOnly(imageRef) {
  const lastSlash = imageRef.lastIndexOf("/");
  const lastColon = imageRef.lastIndexOf(":");
  return lastColon > lastSlash ? imageRef.slice(lastColon + 1) : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertProductVersion(value, label = "Lucy product version") {
  if (!PRODUCT_VERSION_RE.test(value)) {
    throw new Error(`${label} must use numeric X.Y.Z form without a v prefix; got ${JSON.stringify(value)}`);
  }
  return value;
}

export function isCustomerImageRefForVersion(imageRef, version) {
  assertProductVersion(version);
  const tag = tagOnly(imageRef);
  return new RegExp(`^customer-amd64-${escapeRegExp(version)}-\\d{8}-[0-9a-f]{7,}$`).test(tag);
}

export function isReleaseTagForVersion(tag, version) {
  assertProductVersion(version);
  if (tag === version || tag === `v${version}`) return true;
  return new RegExp(`^customer-(?:amd64|multiarch)-${escapeRegExp(version)}-\\d{8}-[0-9a-f]{7,}$`).test(tag);
}

function firstMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`could not read ${label}`);
  return match[1];
}

export function collectVersionGovernanceErrors() {
  const errors = [];
  const version = read("VERSION").trim();
  try {
    assertProductVersion(version, "VERSION");
  } catch (error) {
    errors.push(error.message);
    return { version, errors };
  }

  const rootPackage = readJson("package.json");
  const rootLock = readJson("package-lock.json");
  const dockerfile = read("Dockerfile");
  const compose = YAML.parse(read("docker-compose.yml"));
  const chart = YAML.parse(read("deploy/k8s/helm/lucy/Chart.yaml"));
  const helmValues = YAML.parse(read("deploy/k8s/helm/lucy/values.yaml"));
  const viteConfig = read("webui/vite.config.ts");
  const serverResolver = read("webui/server/lucy-version.ts");
  const clientVersion = read("webui/src/lib/lucyVersion.ts");
  const releaseArtifacts = read("scripts/release/release-artifacts.mjs");
  const releaseWorkflow = read(".github/workflows/lucy-release.yml");

  const projections = [
    ["package.json version", rootPackage.version],
    ["package-lock.json version", rootLock.version],
    ["package-lock.json packages[''] version", rootLock.packages?.[""]?.version],
    ["Dockerfile ARG LUCY_VERSION", firstMatch(dockerfile, /^ARG LUCY_VERSION=(\S+)$/m, "Dockerfile ARG LUCY_VERSION")],
    ["docker-compose build arg", compose.services?.lucy?.build?.args?.LUCY_VERSION?.match(/:-([^}]+)}/)?.[1]],
    ["Chart.appVersion", String(chart.appVersion)],
    ["values lucy.version", String(helmValues.lucy?.version)],
    ["values image.tag", String(helmValues.image?.tag)],
    ["Vite fallback", firstMatch(viteConfig, /return "([0-9]+\.[0-9]+\.[0-9]+)";/, "Vite fallback")],
    ["server fallback", firstMatch(serverResolver, /const FALLBACK = "([0-9]+\.[0-9]+\.[0-9]+)";/, "server fallback")],
    ["client fallback", firstMatch(clientVersion, /const FALLBACK = "([0-9]+\.[0-9]+\.[0-9]+)";/, "client fallback")]
  ];

  for (const [label, actual] of projections) {
    if (actual !== version) errors.push(`${label}=${JSON.stringify(actual)} does not match VERSION=${version}`);
  }

  if (!/SOURCE_BUNDLE_ENTRIES\s*=\s*\[[\s\S]*?"VERSION"/.test(releaseArtifacts)) {
    errors.push("release source bundle does not include repo-root VERSION");
  }
  if (!releaseWorkflow.includes('--build-arg "LUCY_VERSION=${LUCY_VERSION}"')) {
    errors.push("release workflow does not pass LUCY_VERSION into Docker build");
  }
  if (!releaseWorkflow.includes('printenv "${IMAGE_REF}" LUCY_VERSION')) {
    errors.push("release workflow does not verify final image LUCY_VERSION");
  }
  if (!releaseWorkflow.includes('--build-arg "LUCY_GIT_SHA=${GITHUB_SHA}"')) {
    errors.push("release workflow does not pass GITHUB_SHA into the image build revision");
  }
  if (!dockerfile.includes("node scripts/release/lucy-build-revision.mjs")) {
    errors.push("Dockerfile does not stamp /app/BUILD_REVISION from the source commit");
  }
  if (/^ENV\b[^\n]*\bLUCY_GIT_SHA\b/m.test(dockerfile) || /\\\n\s*LUCY_GIT_SHA=/.test(dockerfile)) {
    errors.push("Dockerfile must not persist LUCY_GIT_SHA as a runtime environment variable");
  }
  const helmTemplates = readdirSync(path.join(ROOT, "deploy/k8s/helm/lucy/templates"))
    .map((name) => read(`deploy/k8s/helm/lucy/templates/${name}`))
    .join("\n");
  if (helmTemplates.includes("LUCY_GIT_SHA")) {
    errors.push("Helm must not inject LUCY_GIT_SHA; the build revision is an image file");
  }

  // The 0.30 product-line open updated VERSION/Dockerfile/FALLBACK but left the
  // handbook and K8s contract claiming 0.25 / 0.20. Those surfaces are what
  // testers and operators read; keep them inside lint:version.
  try {
    runHandbookBaseline(ROOT);
  } catch (error) {
    errors.push(`SYSTEM_HANDBOOK baseline: ${error.message}`);
  }

  const k8sContract = read("deploy/k8s/K8S_CONTRACT.md");
  if (!k8sContract.includes(`current baseline \`${version}\``)) {
    errors.push(
      `K8S_CONTRACT LUCY_VERSION current baseline does not match VERSION=${version}`
    );
  }
  if (!new RegExp(`\\| \\\`0\\.2\\.8\\\` \\| \\\`${escapeRegExp(version)}\\\` \\|.*?\\| \\*\\*Current\\*\\*`, "s").test(k8sContract)) {
    errors.push(
      `K8S_CONTRACT compatibility matrix has no **Current** row for product ${version}`
    );
  }

  // Root compose must not let a host LUCY_VERSION override the image identity at
  // runtime — that is how a rebuild can still show an old product version.
  const composeRuntime = compose.services?.lucy?.environment?.LUCY_VERSION;
  if (composeRuntime !== undefined) {
    errors.push(
      "docker-compose.yml must not set runtime LUCY_VERSION; use the image-baked ENV from the Dockerfile ARG"
    );
  }

  return { version, errors };
}

export function assertVersionGovernance() {
  const result = collectVersionGovernanceErrors();
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => `- ${error}`).join("\n"));
  }
  return result.version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = assertVersionGovernance();
    const releaseTagIndex = process.argv.indexOf("--release-tag");
    if (releaseTagIndex !== -1) {
      const releaseTag = process.argv[releaseTagIndex + 1];
      if (!releaseTag || !isReleaseTagForVersion(releaseTag, version)) {
        throw new Error(`release tag ${JSON.stringify(releaseTag)} does not identify Lucy ${version}`);
      }
    }
    console.log(`[lucy-version] OK VERSION=${version}`);
  } catch (error) {
    console.error("[lucy-version] FAIL");
    console.error(error.message);
    process.exitCode = 1;
  }
}
