// Shared primitives for the real-user E2E scripts: exit-code contract (Spec §8.2), digests, run.json access.
// bash 3.2 / Node >= 22; no dependencies beyond `yaml`.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_RUN_ROOT = path.join(REPO_ROOT, "inbox", "e2e");

/** Spec §8.2: status <-> exit code is a strict, bidirectional contract. */
export const EXIT_CODES = Object.freeze({ passed: 0, failed: 1, blocked: 2, skipped: 3, dry_run: 3, collect: 3 });

export function exitCodeFor(status) {
  if (!(status in EXIT_CODES)) throw new Error(`unknown status "${status}"`);
  return EXIT_CODES[status];
}

export const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;

export function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Stable digest of a directory tree: sorted relative paths + file digests (symlinks are not followed). */
export function sha256Tree(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(`${path.relative(root, full)}\0${sha256File(full)}\n`);
    }
  };
  walk(root);
  return hash.digest("hex");
}

export function fileDigest(file) {
  return `sha256:${sha256File(file)}`;
}

export function treeDigest(root) {
  return `sha256:${sha256Tree(root)}`;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function isInside(parent, child) {
  const rel = path.relative(realpathSync(parent), existsSync(child) ? realpathSync(child) : path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/** Reads `<runDir>/run.json` and checks it is the contract this tooling understands. */
export function loadRun(runJsonPath) {
  const run = readJson(runJsonPath);
  if (run.contract !== "lucy-e2e-run-v1") throw new Error(`${runJsonPath} is not a lucy-e2e-run-v1 file`);
  // A run directory can be downloaded to another machine (CI artifact). Paths are always interpreted relative to
  // where run.json actually is, so the verifier reads the files next to it, never a path from the producing host.
  const here = path.dirname(path.resolve(runJsonPath));
  const recorded = run.paths?.runDir;
  if (recorded && recorded !== here) {
    const rebase = (value) => (typeof value === "string" && value.startsWith(recorded) ? here + value.slice(recorded.length) : value);
    run.paths = Object.fromEntries(Object.entries(run.paths).map(([key, value]) => [key, rebase(value)]));
    if (run.secretsDir) run.secretsDir = rebase(run.secretsDir);
  }
  return run;
}

export function parseArgv(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!(name in spec)) throw new Error(`unknown argument --${name}`);
    out[name] = spec[name] === "boolean" ? true : argv[++i];
    if (spec[name] !== "boolean" && out[name] === undefined) throw new Error(`--${name} needs a value`);
  }
  return out;
}

export function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
