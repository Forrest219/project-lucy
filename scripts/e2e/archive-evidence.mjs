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
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { scanRetainedArtifacts, scanText } from "./lib/leak-scan.mjs";
import { EXIT_CODES, fail, loadRun, parseArgv, sha256File } from "./lib/common.mjs";

export const MANIFEST_NAME = "archive-manifest.json";
export const SIGNATURE_NAME = "archive-manifest.sig";

/**
 * Walk a tree and emit every regular file relative to `root`. The root index files
 * (archive-manifest.json / .sig) are excluded so a re-run after a manifest write does not
 * chain old/new manifest hashes. Nested copies of these reserved names (e.g. inside
 * `results/gates/archive-manifest.json`) are NOT excluded: any sub-tree of the archive can
 * legitimately contain a file by that name, and pretending otherwise would silently drop
 * it from the signed manifest. Symlinks are reported with `kind: "symlink"`; the caller
 * refuses to archive when any symlink is present, because a symlink can point outside the
 * archive and bypass the manifest's path allowlist.
 */
function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isSymbolicLink()) {
        out.push({ full, symlink: true });
        continue;
      }
      if (entry.isFile()) {
        // Only the root index files are excluded; nested files with the same name are real
        // evidence and must appear in the manifest. A bare string match on the basename
        // anywhere in the tree (the old behaviour) would let a runner hide files under a
        // reserved name and bypass the signed manifest.
        const rel = path.relative(root, full);
        const isRootIndex = (rel === MANIFEST_NAME || rel === SIGNATURE_NAME) && path.dirname(rel) === ".";
        if (isRootIndex) continue;
        out.push({ full, symlink: false });
      }
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
 * Defensive structural checks for the archive. The archive is meant to be a portable copy of
 * the run: the verifier should be able to read every byte after the source directory has
 * been deleted or moved. The four rules here catch the most common foot-guns:
 *   - outDir must not be a child of sourceDir (would let a follow-up scan re-read the same bytes
 *     through the destination).
 *   - sourceDir must not equal outDir (would let `cpSync` overwrite the source).
 *   - The destination must be new/empty: re-using an existing archive directory could let a
 *     stale manifest survive a fresh write.
 *   - Symlinks anywhere in the source tree are refused; they could point outside the archive
 *     and bypass the manifest's path allowlist.
 *
 * Returns an array of refusal reasons. An empty array means the structural check passed.
 */
function validateArchiveLayout({ sourceDir, outDir }) {
  const reasons = [];
  const sourceReal = realpathSync(sourceDir);
  // outDir may not exist yet; resolve its parent (which must exist) to a real path so the
  // nesting check works on macOS where /var is a symlink to /private/var. We then reconstruct
  // outAbsolute from the resolved parent + the basename.
  const outAbsolute = path.resolve(outDir);
  const outBasename = path.basename(outAbsolute);
  let outParentReal;
  try { outParentReal = realpathSync(path.dirname(outAbsolute)); } catch { outParentReal = path.dirname(outAbsolute); }
  const outResolved = path.join(outParentReal, outBasename);
  if (outResolved === sourceReal) reasons.push("outDir equals sourceDir; refusing to overwrite the source tree");
  // Detect nesting by lexical prefix: outDir = <sourceDir>/... would make any later copy
  // recurse into the source tree. The prefix check works whether or not outDir already exists.
  if (outResolved !== sourceReal && outResolved.startsWith(sourceReal + path.sep)) {
    reasons.push(`outDir ${outResolved} is nested inside sourceDir ${sourceReal}; refusing to recurse into the source tree`);
  }
  // When outDir already exists, also do the canonical realpath check (a symlinked outDir
  // that lands inside sourceReal) and the non-empty check (we never mix new bytes with an
  // old archive).
  if (existsSync(outAbsolute)) {
    let outReal;
    try { outReal = realpathSync(outAbsolute); } catch { outReal = outAbsolute; }
    const rel = path.relative(sourceReal, outReal);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) reasons.push(`outDir ${outReal} is nested inside sourceDir ${sourceReal}; refusing to recurse into the source tree`);
    const existing = readdirSync(outAbsolute);
    if (existing.length > 0) reasons.push(`outDir ${outReal} is not empty (${existing.length} entries); refusing to mix new archive bytes with a previous archive`);
  }
  return reasons;
}

/** Reject any symlink anywhere in the source tree. */
function findSymlinks(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        found.push(full);
        continue;
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found;
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
export function archiveEvidence({ sourceDir, outDir, secrets, verify: runVerify, privateKeyPem, provenance, runId, archiveExtras = null }) {
  const reasons = [];
  if (!privateKeyPem) reasons.push("signing key missing (LUCY_EVIDENCE_SIGNING_KEY_FILE)");
  if (!provenance.trusted) reasons.push("no trusted CI provenance: only a protected CI runner may sign release evidence");
  if (reasons.length > 0) return { status: "blocked", reasons };

  // 0a. Structural layout: refuse to archive into a nested / non-empty / source-equal outDir.
  const layoutReasons = validateArchiveLayout({ sourceDir, outDir });
  if (layoutReasons.length > 0) return { status: "blocked", reasons: layoutReasons };

  // 0b. Symlink refusal: any symlink in the source tree could point outside the archive root
  // and bypass the manifest's path allowlist. We do the leak scan first so callers that
  // inspect the returned tree see the symlink report (defence in depth — the carrier scanner
  // also reports symlinks as blocked), then bail before copying. A symlink is a hard refusal,
  // not a "scan and decide": a symlink could point at a credential that wasn't in the leak
  // scan's view (e.g. a credential the symlink target carries but the symlink entry itself
  // does not), so the safe answer is to never sign such an archive.
  const tree = scanRetainedArtifacts(sourceDir, { secrets, forbiddenCanaries: [] });
  if (tree.status === "failed") {
    const sample = tree.failures[0] ?? "(unknown file)";
    return { status: "failed", reasons: [`credential found in ${sample}; archive refused`], tree };
  }
  if (tree.status === "blocked") {
    const sample = tree.blockedEntries[0] ?? "(unknown file)";
    return { status: "blocked", reasons: [`carrier scan could not inspect ${sample}; archive refused`], tree };
  }
  const symlinks = findSymlinks(sourceDir);
  if (symlinks.length > 0) return { status: "blocked", reasons: [`source tree contains ${symlinks.length} symlink(s); refusing to sign bytes that could resolve outside the archive (${symlinks[0]})`], tree };

  // 1. Carrier-aware leak scan already ran above; the tree verdict is reused here.
  // The single-file `scanText` path used to silently miss anything that wasn't a text
  // extension (compressed payloads, screenshots, archives, binary blobs).
  // `scanRetainedArtifacts` walks every regular file, decompresses archives, and refuses
  // unsupported carriers rather than pretending they are safe. The verdict is failed >
  // blocked > passed; a real leak wins over a structural block, and either prevents signing.
  // 2. copy + hash. We copy the source directory UNDER outDir (as `results/`) and the run.json
  // alongside it, so loadResults(outDir) finds results/*.json at the canonical location. The
  // previous implementation copied the contents of `sourceDir` directly into outDir, which made
  // loadResults look for `outDir/results/*.json` while the actual files were at outDir/*.
  mkdirSync(outDir, { recursive: true });
  const resultsDest = path.join(outDir, "results");
  cpSync(sourceDir, resultsDest, { recursive: true });
  if (archiveExtras?.runJsonPath) {
    const runJsonDest = path.join(outDir, "run.json");
    cpSync(archiveExtras.runJsonPath, runJsonDest);
  }
  // Snapshot the file list + their sha256 BEFORE verification. The signature step below signs
  // this exact manifest, so any later mutation (including a verify callback that rewrites a
  // case-result file) would be detectable by re-hashing the bytes we hashed here.
  const listed = listFiles(outDir);
  const symDuringWalk = listed.find((e) => e.symlink);
  if (symDuringWalk) return { status: "blocked", reasons: [`destination tree contains a symlink (${symDuringWalk.full}); refusing to sign`], tree };
  const manifest = { contract: "lucy-evidence-archive-v1", runId, createdAt: new Date().toISOString(), provenance, files: listed.map((e) => ({ path: path.relative(outDir, e.full), sha256: sha256File(e.full) })) };
  // 3. verification on the archived copy
  const verdict = runVerify(outDir);
  if (verdict.status !== "passed") return { status: verdict.status === "failed" ? "failed" : "blocked", reasons: [`verifier verdict on the archive: ${verdict.status}`], verdict };
  // 4. signature last. Re-hash the archived bytes here so any in-place mutation by the verify
  // callback is detected before signing; a mismatch between the snapshot above and the
  // re-hash means the verifier's exit code does not match the on-disk state.
  const recheck = manifest.files.map((entry) => ({ path: entry.path, sha256: sha256File(path.join(outDir, entry.path)) }));
  for (let i = 0; i < recheck.length; i += 1) if (recheck[i].sha256 !== manifest.files[i].sha256) return { status: "failed", reasons: [`archived byte mutated between snapshot and sign: ${recheck[i].path}`], manifest };
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
  const walked = listFiles(dir);
  for (const file of walked) {
    if (file.symlink) { problems.push(`${path.relative(dir, file.full)} is a symlink; the archive must contain only regular files`); continue; }
    const rel = path.relative(dir, file.full);
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
    const archiveOut = path.resolve(args.out);
    const outcome = archiveEvidence({
      sourceDir: path.join(run.paths.runDir, "results"),
      outDir: archiveOut,
      secrets,
      archiveExtras: { runJsonPath: path.join(run.paths.runDir, "run.json") },
      // Verify the ARCHIVED copy (outDir), not the source. The source may be modified by a later run, and the
      // archive's manifest must guarantee that what was signed is what was verified.
      verify: () => verifyEvidenceDir({ archiveDir: archiveOut, candidatePath: args.candidate }),
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
