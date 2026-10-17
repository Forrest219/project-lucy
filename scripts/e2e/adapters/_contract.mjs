// Adapter contract for real product clients (Spec §6.3, §6.4). An adapter drives the product's OWN native
// client (a CLI here) with a native config generated from the MCP endpoint + a per-run Token. It must:
//   - never put the Token in argv or in a generated file (only an environment variable NAME appears in config),
//   - report the real binary path and version from actually executing it,
//   - report BLOCKED (never a fake pass) when the binary or the model credential is absent.

import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const REQUIRED_ADAPTER_FIELDS = ["product", "transport", "credentialEnv", "probe", "prepare", "buildInvocation", "parseResult"];
export const TOKEN_ENV = "LUCY_E2E_TOKEN";

export function validateAdapter(adapter) {
  const problems = [];
  for (const field of REQUIRED_ADAPTER_FIELDS) if (!(field in adapter)) problems.push(`missing ${field}`);
  if (!["cli", "gui"].includes(adapter.transport)) problems.push(`transport must be cli or gui (got ${adapter.transport}); raw HTTP is not a real client`);
  for (const fn of ["probe", "prepare", "buildInvocation", "parseResult"]) if (typeof adapter[fn] !== "function") problems.push(`${fn} must be a function`);
  return problems;
}

export function adapterDigest(file) {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}

/** First executable named in `names` found on PATH. Shell functions and aliases do not count. */
export function locateBinary(names, pathEnv = process.env.PATH ?? "") {
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (statSync(candidate).isFile()) {
          accessSync(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        // not here
      }
    }
  }
  return null;
}

/** Throws when an invocation would expose a secret on the command line (visible to every local process). */
export function assertNoSecretInArgv(args, secrets) {
  for (const arg of args) {
    for (const secret of secrets) {
      if (secret && String(arg).includes(secret)) throw new Error("refusing to put a credential on the command line");
    }
  }
}

/** Standard probe: binary on PATH, model credential present, `--version` really runs. */
export function probeCli({ names, versionArgs = ["--version"], credentialEnv, env, spawnSync, locate = locateBinary, accept }) {
  const reasons = [];
  const binaryPath = locate(names, env.PATH);
  if (!binaryPath) reasons.push(`binary_not_found: ${names.join(" | ")}`);
  const missing = credentialEnv.filter((name) => !env[name]);
  if (missing.length === credentialEnv.length) reasons.push(`credential_missing: ${credentialEnv.join(" | ")}`);
  let version = null;
  if (binaryPath) {
    const result = spawnSync(binaryPath, versionArgs, { encoding: "utf8", env, timeout: 20_000 });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status !== 0 || !output) reasons.push(`version_probe_failed: exit ${result.status}`);
    else if (accept && !accept.test(output)) reasons.push(`binary_is_not_the_expected_product: ${names.join(" | ")}`);
    else version = output.split("\n")[0].slice(0, 120);
  }
  return { status: reasons.length === 0 ? "ready" : "blocked", reasons, binaryPath, version };
}
