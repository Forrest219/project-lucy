#!/usr/bin/env node
// Writes the candidate identity that every later gate and the verifier compare against (Spec §8.1, §8.4):
// the exact commit, the content digest of its tree, the registry image digest, platform and versions.
//   node scripts/gates/write-candidate-identity.mjs --image-digest sha256:… --ktx-version 0.16.0 --out release/candidate-identity.json
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { REPO_ROOT, fail, parseArgv } from "../e2e/lib/common.mjs";

export function buildCandidateIdentity({ gitSha, treeDigest, imageDigest, ktxVersion, chartVersion }) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(gitSha ?? "")) problems.push("gitSha must be a full 40-hex sha");
  if (!/^sha256:[0-9a-f]{64}$/.test(treeDigest ?? "")) problems.push("treeDigest must be sha256:<64 hex>");
  if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest ?? "")) problems.push("imageDigest must be the registry manifest digest sha256:<64 hex>");
  if (!ktxVersion) problems.push("ktxVersion is required");
  if (!chartVersion) problems.push("chartVersion is required");
  if (problems.length > 0) throw new Error(problems.join("; "));
  return { gitSha, treeDigest, imageDigest, platform: "linux/amd64", ktxVersion, chartVersion };
}

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { "image-digest": "value", "ktx-version": "value", out: "value", "git-sha": "value" });
    if (!args["image-digest"] || !args["ktx-version"] || !args.out) fail("write-candidate-identity: --image-digest, --ktx-version and --out are required", 1);
    const gitSha = args["git-sha"] ?? git(["rev-parse", "HEAD"]).toString().trim();
    const treeDigest = `sha256:${createHash("sha256").update(git(["archive", "--format=tar", gitSha])).digest("hex")}`;
    const chart = parse(readFileSync(path.join(REPO_ROOT, "deploy/k8s/helm/lucy/Chart.yaml"), "utf8"));
    const identity = buildCandidateIdentity({ gitSha, treeDigest, imageDigest: args["image-digest"], ktxVersion: args["ktx-version"], chartVersion: String(chart.version) });
    mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(identity, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ out: args.out, gitSha, imageDigest: identity.imageDigest })}\n`);
  } catch (error) {
    fail(`write-candidate-identity: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
