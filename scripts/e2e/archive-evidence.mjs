#!/usr/bin/env node
// Long-term evidence archive (Spec §8.3 "长期归档"). Fixed order:
//   in-memory collection (already done by the runners) -> leak scan -> file hashes -> verification -> signature.
// After the signature nothing may change: `verifyArchive` recomputes every hash and the signature, so any later
// edit (or a "re-redaction") is detected and the archive must be re-hashed, re-verified and re-signed.
// Failure to archive is BLOCKED (never a signed release): no signing key, no trusted CI provenance, a leak, or a
// failing verification all stop here.
//
//   node scripts/e2e/archive-evidence.mjs --run <run.json> --candidate <identity.json> --out <dir>
//   env: LUCY_EVIDENCE_SIGNING_KEY_FILE (ed25519 private key PEM)  LUCY_EVIDENCE_PUBLIC_KEY_FILE (for --verify)

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { scanText } from "./lib/leak-scan.mjs";
import { EXIT_CODES, fail, loadRun, parseArgv, sha256File } from "./lib/common.mjs";

export const MANIFEST_NAME = "archive-manifest.json";
export const SIGNATURE_NAME = "archive-manifest.sig";

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== MANIFEST_NAME && entry.name !== SIGNATURE_NAME) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** CI provenance from the environment; `trusted` only inside a real GitHub Actions run on a non-local runner. */
export function provenanceFromEnv(env = process.env) {
  const inCi = env.GITHUB_ACTIONS === "true" && Boolean(env.GITHUB_RUN_ID) && Boolean(env.GITHUB_SHA);
  return {
    trusted: inCi && env.RUNNER_ENVIRONMENT !== undefined,
    runner: env.RUNNER_NAME ?? "local",
    ...(inCi ? { ciRunId: env.GITHUB_RUN_ID, ciSha: env.GITHUB_SHA, workflow: env.GITHUB_WORKFLOW ?? "unknown" } : {})
  };
}

export function canonicalManifest(manifest) {
  return JSON.stringify({ ...manifest, files: [...manifest.files].sort((a, b) => a.path.localeCompare(b.path)) });
}

/**
 * @param {object} p
 * @param {string} p.sourceDir evidence directory (already redacted at write time)
 * @param {string} p.outDir archive destination (created)
 * @param {string[]} p.secrets credential values that must not appear anywhere
 * @param {() => {status:string, exitCode:number}} p.verify runs the verifier on the archived copy
 * @param {string|null} p.privateKeyPem signing key
 * @param {object} p.provenance CI provenance
 */
export function archiveEvidence({ sourceDir, outDir, secrets, verify: runVerify, privateKeyPem, provenance, runId }) {
  const reasons = [];
  if (!privateKeyPem) reasons.push("signing key missing (LUCY_EVIDENCE_SIGNING_KEY_FILE)");
  if (!provenance.trusted) reasons.push("no trusted CI provenance: only a protected CI runner may sign release evidence");
  if (reasons.length > 0) return { status: "blocked", reasons };

  // 1. leak scan over every source file BEFORE anything is copied or hashed
  const files = listFiles(sourceDir);
  for (const file of files) {
    if (statSync(file).size > 64 * 1024 * 1024) continue;
    const hits = scanText(readFileSync(file, "utf8").toString(), { secrets });
    if (hits.length > 0) return { status: "failed", reasons: [`credential found in ${path.relative(sourceDir, file)}; archive refused`] };
  }
  // 2. copy + hash
  mkdirSync(outDir, { recursive: true });
  cpSync(sourceDir, outDir, { recursive: true });
  const manifest = { contract: "lucy-evidence-archive-v1", runId, createdAt: new Date().toISOString(), provenance, files: listFiles(outDir).map((file) => ({ path: path.relative(outDir, file), sha256: sha256File(file) })) };
  // 3. verification on the archived copy
  const verdict = runVerify(outDir);
  if (verdict.status !== "passed") return { status: verdict.status === "failed" ? "failed" : "blocked", reasons: [`verifier verdict on the archive: ${verdict.status}`], verdict };
  // 4. signature last
  const manifestText = canonicalManifest(manifest);
  const signature = sign(null, Buffer.from(manifestText), createPrivateKey(privateKeyPem)).toString("base64");
  writeFileSync(path.join(outDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(outDir, SIGNATURE_NAME), `${signature}\n`);
  return { status: "passed", manifest, signature };
}

/** Recomputes every hash and the signature; detects any modification made after signing. */
export function verifyArchive(dir, publicKeyPem) {
  const problems = [];
  if (!existsSync(path.join(dir, MANIFEST_NAME)) || !existsSync(path.join(dir, SIGNATURE_NAME))) return { ok: false, problems: ["manifest or signature missing"] };
  const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST_NAME), "utf8"));
  const signature = Buffer.from(readFileSync(path.join(dir, SIGNATURE_NAME), "utf8").trim(), "base64");
  if (!verify(null, Buffer.from(canonicalManifest(manifest)), createPublicKey(publicKeyPem), signature)) problems.push("signature does not verify (manifest altered or wrong signer)");
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const file of manifest.files) {
    const full = path.join(dir, file.path);
    if (!existsSync(full)) problems.push(`${file.path} is missing`);
    else if (sha256File(full) !== file.sha256) problems.push(`${file.path} was modified after signing`);
  }
  for (const file of listFiles(dir)) {
    const rel = path.relative(dir, file);
    if (!listed.has(rel)) problems.push(`${rel} is not covered by the signed manifest`);
  }
  if (!manifest.provenance?.trusted) problems.push("manifest provenance is not trusted");
  return { ok: problems.length === 0, problems };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", candidate: "value", out: "value", verify: "boolean" });
    if (args.verify) {
      if (!args.out || !process.env.LUCY_EVIDENCE_PUBLIC_KEY_FILE) fail("archive-evidence --verify needs --out <archive dir> and LUCY_EVIDENCE_PUBLIC_KEY_FILE", 1);
      const result = verifyArchive(args.out, readFileSync(process.env.LUCY_EVIDENCE_PUBLIC_KEY_FILE, "utf8"));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.ok ? 0 : 1);
    }
    if (!args.run || !args.out || !args.candidate) fail("archive-evidence: --run, --candidate and --out are required", 1);
    const run = loadRun(args.run);
    const keyFile = process.env.LUCY_EVIDENCE_SIGNING_KEY_FILE;
    const admins = JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8"));
    const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
    const secrets = [...Object.values(tokens), admins.owner.password, admins.operator.password, readFileSync(path.join(run.secretsDir, "bootstrap-token"), "utf8").trim()];
    const { verifyEvidenceDir } = await import("./lib/verify-dir.mjs");
    const outcome = archiveEvidence({
      sourceDir: path.join(run.paths.runDir, "results"),
      outDir: path.resolve(args.out),
      secrets,
      verify: () => verifyEvidenceDir({ runDir: run.paths.runDir, candidatePath: args.candidate }),
      privateKeyPem: keyFile && existsSync(keyFile) ? readFileSync(keyFile, "utf8") : null,
      provenance: provenanceFromEnv(),
      runId: run.runId
    });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    process.exit(EXIT_CODES[outcome.status]);
  } catch (error) {
    fail(`archive-evidence: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}
