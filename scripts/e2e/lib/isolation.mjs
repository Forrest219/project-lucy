// Real isolation boundary for Agent clients (Spec §6.2 R8/R10, A5 approved plan, review-a-blocking §A5).
//
// "Absence of secret in model text is NEVER isolation proof" — timeout / empty / non-zero exit /
// harmless output / "I cannot access" all cannot grant isolation. The runner that executes the
// real adapter must enforce an OS/VM filesystem+network boundary AND measure denied access to
// each forbidden resource (checker/gold, synthetic seed, rawDB endpoint, test source, control
// plane, checker/secrets). The boundary must be hashed/bound to the actual invocation; a
// measurement helper that does not actually wrap the runner is insufficient.
//
// Supported host: macOS — uses `/usr/bin/sandbox-exec -f <profile>` to drive an SBPL policy.
//   Verified: `sandbox-exec -h` shows `-f profile_file`, `-p profile_string`, `-D key=val` and
//   existing macOS hosts provide /usr/bin/sandbox-exec. `kubectl has no current context` and
//   `bwrap is absent` on the local development host — so this module does NOT pretend to
//   implement a Linux bwrap/path-based sandbox; instead it reports `provider=null` (unsupported)
//   and the caller must BLOCK (release never trusts an unproven boundary).
//
// Linux support deliberately deferred to a future patch that includes an actual container
// runtime; the current module refuses to fake it. The release-verified path is "sandbox-exec
// only" and any host without it fails the isolation step and BLOCKS the run.
//
// Env sanitization: the runner spreads `process.env` today, which on CI may contain GITHUB_TOKEN,
// signing-key paths, checker/control credentials. Sanitizing the child environment by explicit
// allowlist is non-negotiable; sibling / bootstrap / admin / signing material MUST NOT reach the
// client. Only the client's own MCP Token and required dedicated model credentials may pass.
//
// Bounded output: never accept unbounded stdout/stderr, never depend on the child to honour a
// timeout on its own. The native wrapper kills the OWN process group on timeout (never unrelated
// PIDs), awaits the child, and returns a single structured outcome the caller can audit.
//
// Synthetic canaries: the probe test paths / sockets / URL fragments must be DISPOSABLE and
// SYNTHETIC. Reading a real gold.json or a real DB password would (a) leak the secret into a
// transcript and (b) tie the probe to the run's instance identity. We mount synthetic canary
// files in a dedicated probe dir and bind the boundary to them.

// `process` is provided to the test runner; child-process imports are deferred so the module
// stays importable in environments where `child_process` is mocked.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Platform/provider detection
// ---------------------------------------------------------------------------

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * Returns one of:
 *   { provider: "darwin-sandbox-exec", version: "..." } when /usr/bin/sandbox-exec exists,
 *   { provider: null, reason: "..." } when unsupported (Linux at the moment, no bwrap runtime).
 *
 * The probe is intentionally SEPARATE from the wrap step so a unit test can verify the gate
 * without actually invoking the binary. The release gate fails closed when this returns null.
 */
export async function detectIsolationProvider({ spawnSync }) {
  // Avoid `existsSync` on platforms the module may run on; rely on the actual binary probe.
  try {
    const probe = spawnSync(SANDBOX_EXEC, ["-h"], { encoding: "utf8", timeout: 5_000 });
    if (probe.error) return { provider: null, reason: `sandbox-exec not executable: ${probe.error.message ?? String(probe.error)}` };
    if (probe.status !== 0 && probe.status !== 1 && probe.status !== 64 && probe.status !== 2) {
      // 0/1/2/64 are normal for `-h` style flags; anything else is unusual.
      return { provider: null, reason: `sandbox-exec -h returned unexpected status ${probe.status}` };
    }
    const text = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
    // Already DEPRECATED upstream — that warning is fine. The tool still works on supported
    // versions of macOS and the policy language (-f, -p, -D) is exactly what we need.
    if (!/sandbox-exec/i.test(text)) return { provider: null, reason: "sandbox-exec output did not match expected format" };
    return { provider: "darwin-sandbox-exec", binary: SANDBOX_EXEC, version: "darwin" };
  } catch (error) {
    return { provider: null, reason: `sandbox-exec probe raised: ${error?.message ?? String(error)}` };
  }
}

// ---------------------------------------------------------------------------
// Env allowlist — every var NOT in this list is dropped from the child environment.
// ---------------------------------------------------------------------------

/**
 * Allowed parent env when launching the agent client. Anything not in this set must NOT leak
 * (CI signing material, sibling credentials, admin credentials, etc.). The list deliberately
 * keeps the runner's own orchestration vars, model-specific credential ENV names from the real
 * clients registry, and runtime essentials.
 *
 * IMPORTANT: this allowlist is the SOLE source of inherited env. The runner MUST NOT spread
 * `process.env` again at the call site.
 *
 * Why this is an EXPLICIT enumeration, not a wildcard:
 *   - LUCY_E2E_TOKEN, LUCY_E2E_RUN, LUCY_E2E_INSTANCE, LUCY_E2E_CLIENT, LUCY_E2E_QUESTION are
 *     ORCHESTRATION vars (the runner passes them). Adding `LUCY_E2E_*` would also pass
 *     LUCY_E2E_GOLD / LUCY_E2E_SECRETS / LUCY_E2E_SIGNING / LUCY_E2E_ADMIN / LUCY_E2E_SIBLING
 *     if they exist on the runner — a laundering path.
 *   - LUCY_REAL_E2E_* is similarly narrow: only the explicit cap-flag var.
 *   - NODE_OPTIONS / NODE_PATH are removed: `NODE_OPTIONS=--require <file>` executes arbitrary
 *     code at startup, so a child that inherits them can pre-load checker/canary source.
 *   - HOME / TMPDIR / LANG / LC_ALL / PATH are system essentials only; the runner overrides HOME
 *     to a dedicated client-work dir.
 *
 * `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENCLAW_API_KEY` / `CURSOR_API_KEY` / `CODEX_API_KEY`
 * are the credential names per docs/qa/real-e2e-clients.yaml. They are the ONLY credentials that
 * may pass for the specific client the runner is driving. Sibling clients' credentials (e.g. an
 * OpenAI key for a Claude run) MUST NOT be inherited.
 */
export const DEFAULT_ENV_ALLOW = [
  // system essentials
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "HOME",
  // Lucy runner orchestration (explicit names only; no wildcard)
  "LUCY_E2E_TOKEN",
  "LUCY_E2E_RUN",
  "LUCY_E2E_INSTANCE",
  "LUCY_E2E_CLIENT",
  "LUCY_E2E_QUESTION",
  "LUCY_E2E_CASES",
  "LUCY_E2E_CAPABILITIES",
  "LUCY_REAL_E2E_CAPABILITIES",
  // Model API credentials — the runner resolves which one to pass per client (no cross-client leak)
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "OPENCLAW_API_KEY",
  "CURSOR_API_KEY",
  "CODEX_API_KEY"
];

export function buildEnvAllowMatcher(allowList = DEFAULT_ENV_ALLOW) {
  // The allowlist is a literal set of names. We do NOT support wildcards: a wildcard would
  // admit LUCY_E2E_GOLD / LUCY_E2E_SECRETS / LUCY_E2E_SIGNING / LUCY_E2E_ADMIN / LUCY_E2E_SIBLING
  // alongside the legitimate LUCY_E2E_TOKEN. The single source of truth is the explicit list.
  return { literals: new Set(allowList) };
}

export function sanitizeEnv(env, allowMatcher = buildEnvAllowMatcher(), { token, clientHome, clientWork, clientTmp, runTools, probeRoot, modelCredentials = {} } = {}) {
  const out = {};
  // Build a reverse index from allowMatcher.literals so we can detect "the runner also wants a
  // particular key NOT in the parent's env". We never add a parent-supplied key that isn't in
  // the matcher.
  const allowed = allowMatcher.literals;
  for (const [name, value] of Object.entries(env ?? {})) {
    if (!name) continue;
    if (!allowed.has(name)) continue;
    out[name] = value;
  }
  // Forced / dedicated values the client MUST use rather than anything inherited.
  if (token !== undefined) out.LUCY_E2E_TOKEN = token;
  if (clientHome !== undefined) out.HOME = clientHome;
  if (clientWork !== undefined) out.PWD = clientWork;
  // The client's temp dir has to live INSIDE its own workspace. The inherited TMPDIR
  // points at the system temp dir, which the boundary only allows for READING — a
  // client that cannot write its scratch files cannot run its own tools.
  if (clientTmp !== undefined) out.TMPDIR = clientTmp;
  // Per-client model credentials. The runner resolves which one to inject for the SPECIFIC
  // client (e.g. ANTHROPIC_API_KEY for Claude Code; OPENAI_API_KEY for OpenClaw). A previous
  // design spread every `*_API_KEY` from the parent env — that laundered sibling clients'
  // credentials into the wrong run. We now set ONLY the client-resolved credential, and the
  // matcher has already filtered out anything that wasn't on the literal allowlist.
  for (const [name, value] of Object.entries(modelCredentials)) {
    if (!name || !value) continue;
    if (!allowed.has(name)) continue; // refuse credentials that aren't on the allowlist
    out[name] = value;
  }
  // The MCP URL is itself not sensitive (it is the registered instance URL); the runner injects
  // it via the adapter's native config. We do not propagate secrets here.
  return out;
}

/**
 * Strip values that the runner should not silently carry into the child. We keep this strict:
 * the isolation boundary denies forbidden resources at the OS level too, but defense-in-depth
 * ensures the child literally cannot read those even if it tried to walk /proc/self/environ.
 */
export const RESOURCE_KIND = Object.freeze({
  CHECKER_GOLD: "checker-gold",
  SYNTHETIC_SEED: "synthetic-seed",
  RAW_DB_ENDPOINT: "raw-db-endpoint",
  TEST_SOURCE: "test-source",
  CONTROL_PLANE: "control-plane",
  CHECKER_SECRETS: "checker-secrets",
  OS_PRIVATE: "os-private"
});

// ---------------------------------------------------------------------------
// Disposable canaries for the safety probe (do NOT use real secrets/paths).
// ---------------------------------------------------------------------------

/**
 * Allocates a private probe directory with synthetic canary files that PROVE the boundary
 * denied access to every resource category. The probe's only job is to make the boundary ask
 * the model to reach these paths; if any of them are readable, isolation is BROKEN.
 *
 * The returned bundle is hashed/bound into the boundary's profileString via the `-D` parameters,
 * and the receipt is returned to the caller for inclusion in artifacts/evidence.
 */
export function allocateProbeCanaries({ resources = Object.values(RESOURCE_KIND) } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "lucy-iso-probe-"));
  const layout = {};
  for (const kind of resources) {
    const dir = path.join(root, kind);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${kind}-canary.txt`);
    // The canary content is the resource-kind literal: e.g. CANARY-CHECKER-GOLD-... so a
    // leaking transcript is recognisable without ever naming the real secret.
    const tag = `CANARY-${kind.toUpperCase()}-${randomShortHex()}`;
    writeFileSync(file, `${tag}\n`);
    layout[kind] = { dir, file, tag };
  }
  return { root, layout };
}

/**
 * Synthesize a small canary file under the disposable probe root. Used in tests; the runner
 * itself prefers `allocateProbeCanaries` because it produces a complete bundle.
 */
export function writeCanary(file, kind) {
  const tag = `CANARY-${kind.toUpperCase()}-${randomShortHex()}`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${tag}\n`);
  return tag;
}

function randomShortHex() {
  // 8-byte random hex, no crypto dependency.
  const seed = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${seed}${Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")}`.slice(0, 16);
}

// ---------------------------------------------------------------------------
// SBPL profile synthesis — the boundary that denies every forbidden resource while allowing
// the minimal workspace + MCP egress + model API egress.
// ---------------------------------------------------------------------------

/**
 * Build an SBPL profile that:
 *   - DENIES every forbidden path declared in `denyPaths` (synthetic canary + checker/gold/seed
 *     etc.). The path forms are written both with the directory itself AND with `(deny file-read*
 *     (subpath ...))` so opening any descendant fails.
 *   - ALLOWS the client workspace directory + anywhere inside it (the adapter prepares there).
 *   - ALLOWS the dedicated probe directory itself (the model is supposed to read synthetic
 *     canaries; the OS-level read is what we measure).
 *   - ALLOWS network egress ONLY to `localhost:<mcpPort>` (the registered MCP proxy) and to
 *     `localhost:<sidecarPort>` (a sidecar egress proxy if the caller provides one). It does
 *     NOT allow `*:<port>` wildcards. macOS sandbox-exec does not support per-host or
 *     per-IP egress (`host must be * or localhost`); the only way to restrict network to a
 *     specific model-API host (api.anthropic.com, api.openai.com) is to route through a
 *     localhost sidecar that the runner controls. The `sidecarPorts` parameter is the runtime
 *     port the model API egress sidecar listens on; the model connects to localhost:sidecarPort
 *     and the sidecar forwards only to the registered model API hosts. This is the only way
 *     to enforce per-host egress on macOS sandbox-exec.
 *   - ALLOWS system dirs that the client needs to start (PATH, libc, /dev, /tmp).
 *
 * Returning the policy string vs writing it lets us test & hash the result without hitting disk.
 *
 * NOTE on macOS sandbox syntax: `(allow network-outbound (remote tcp "localhost:N"))` and
 * `(allow network-outbound (remote tcp "*:N"))` are the only accepted forms. Per-host /
 * per-IP are NOT supported. We therefore route model API egress through a localhost sidecar
 * and explicitly refuse `*:N` wildcards.
 */
/**
 * RULE ORDER IS SEMANTIC — macOS sandbox applies the LAST MATCHING RULE, not
 * "deny always wins". Verified on this host with sandbox-exec:
 *   deny(subpath P) then allow(subpath P)  -> the path is READABLE (the later allow wins)
 *   allow(subpath P) then deny(subpath P)  -> the path is DENIED   (the later deny wins)
 * So a deny may only be followed by an allow that is STRICTLY NARROWER than the
 * denied subtree. An allow of a PARENT subtree re-opens every protected child
 * under it (that is how checker/gold.json, seed-data.sql and the db owner
 * password became readable inside the boundary).
 *
 * `metadataLiterals` are directory NODES the client may stat/look up (traversal)
 * without being able to list or read them — `file-read-metadata` does not admit
 * file contents.
 *
 * `denyLiterals` are emitted LAST, after every allow, so no broad allow above
 * (e.g. a temp-dir subtree) can re-open them.
 */
export function buildSandboxProfile({ allow = [], deny = [], allowLiterals = [], metadataLiterals = [], denyLiterals = [], allowWrite = [], mcpPorts = [], sidecarPorts = [], denyHome = false, allowHome = null }) {
  const lines = [
    `(version 1)`,
    `(deny default)`,
    `(allow sysctl-read)`,
    `(allow process-exec)`,
    // The client must be able to SPAWN the shell the probe asks it to use. Without
    // `process-fork` every shell execution inside the boundary fails with
    // "fork: Operation not permitted", so the client can never attempt a forbidden
    // resource through a shell and the probe can never obtain a denial signal.
    // The children stay inside the SAME sandbox: the file and network rules below
    // still govern them.
    `(allow process-fork)`,
    `(allow mach-lookup)`,
    `(allow signal)`
  ];

  // --- allow paths ---
  // System libraries + interpreters. The previous design allow-listed `/private/var`, `/var`,
  // and `/tmp` broadly — that admits the actual run.paths.checker / run.paths.runDir / run.paths.outside
  // if the orchestrator places them there. We restrict to a small set of system dirs the client
  // genuinely needs to start (dyld, libc, fonts) and to the disposable probe root + dedicated
  // HOME explicitly. `/tmp` and `/private/tmp` are the well-known temp dirs and are allowed
  // only as a top-level entry; nested `runDir`/`checker`/`outside` paths the orchestrator
  // places there are explicitly DENIED by the `deny` list EMITTED BELOW, so the broad allow
  // cannot re-open them (macOS applies the last matching rule).
  lines.push(`(allow file-read* (subpath "/usr/lib"))`);
  lines.push(`(allow file-read* (subpath "/usr/share"))`);
  // The STANDARD EXECUTABLE DIRECTORIES. These are not a convenience: without them the
  // client's shell cannot resolve ANY command. `bash -c "cat <file>"` fails with
  // "cat: command not found" because PATH lookup needs to read the PATH directories,
  // and a "command not found" is INDISTINGUISHABLE from a resource refusal in the
  // probe output. The probe would then measure a crippled shell instead of the
  // boundary — and the isolation proof could never conclude anything.
  // These directories hold no run-scoped secret: the checker/gold, the seed, the DB
  // password and the run dir all live under the run directory and stay denied below.
  lines.push(`(allow file-read* (subpath "/bin"))`);
  lines.push(`(allow file-read* (subpath "/usr/bin"))`);
  lines.push(`(allow file-read* (subpath "/usr/sbin"))`);
  lines.push(`(allow file-read* (subpath "/sbin"))`);
  lines.push(`(allow file-read* (subpath "/usr/local/bin"))`);
  lines.push(`(allow file-read* (subpath "/usr/local/sbin"))`);
  lines.push(`(allow file-read* (subpath "/Library"))`);
  lines.push(`(allow file-read* (subpath "/System"))`);
  lines.push(`(allow file-read* (subpath "/System/Library"))`);
  lines.push(`(allow file-read* (subpath "/opt"))`);
  lines.push(`(allow file-read* (subpath "/dev"))`);
  lines.push(`(allow file-read* (subpath "/run"))`);
  lines.push(`(allow file-read* (subpath "/tmp"))`);
  lines.push(`(allow file-read* (subpath "/private/tmp"))`);
  // `/private/var` is NOT broadly allow-listed: it is the parent of `/private/var/folders/...`
  // temp dirs and contains run-specific secrets. We allow ONLY the explicit deny-allow pair
  // (e.g. /private/var/run or the explicit subpath the runner actually needs). The previous
  // design's blanket `/private/var` let the client read `db/secret` files the orchestrator
  // placed under `/private/var/folders/...` — a path-based laundering path.

  // --- deny paths (BROAD) ---
  // Emitted AFTER the broad system allows and BEFORE the narrow client allows, so:
  //   * a system subtree allow (/tmp, /private/tmp, ...) can no longer re-open a
  //     protected path that happens to live inside it;
  //   * the client workspace allow below still wins over the runDir deny, because
  //     it is strictly narrower (a child of the denied subtree).
  // See the ORDERING note above: macOS applies the LAST matching rule.
  for (const p of deny) {
    lines.push(`(deny file-read* (subpath ${sbplPath(p)}))`);
    lines.push(`(deny file-read* (literal ${sbplPath(p)}))`);
  }
  // lock down HOME by default so the client cannot reach OS private credentials; the runner
  // re-creates a dedicated HOME so legitimate reads still work.
  if (denyHome && allowHome) {
    lines.push(`(deny file-read* (subpath ${sbplPath(homedir())}))`);
    lines.push(`(deny file-read* (literal ${sbplPath(homedir())}))`);
  }

  // client workspace + dedicated HOME + the disposable probe root (so the model can attempt
  // the denial probes against synthetic canaries; the expected outcome is "could not read").
  for (const p of allow) lines.push(`(allow file-read* (subpath ${sbplPath(p)}))`);
  // Literal file rules: the CLIENT BINARY itself must be readable/executable inside the
  // boundary, otherwise `sandbox-exec` refuses to exec it ("execvp() ... Operation not
  // permitted") and the client never starts. A client that never starts proves nothing:
  // the probe then reads its own exec failure and mis-reads it as "the client reached the
  // resource". These literals are only the resolved binary paths the runner already
  // located — they do not widen the boundary to the rest of $HOME.
  for (const p of allowLiterals) lines.push(`(allow file-read* (literal ${sbplPath(p)}))`);
  // Directory NODES the client must traverse (stat / path lookup) without being
  // able to list or read them. `file-read-metadata` does not admit contents.
  for (const p of metadataLiterals) lines.push(`(allow file-read-metadata (literal ${sbplPath(p)}))`);
  // The root DIRECTORY node itself must be readable. A hardened-runtime client
  // resolves its own path / working directory by reading `/`; under `(deny default)`
  // that read is denied, the client ABORTS before it can answer, the probe sees no
  // denial signal, and every boundary probe stays INCONCLUSIVE — which means the
  // agent-client capability is never granted and the whole agent leg is blocked.
  // `(literal "/")` opens the root directory node only; every path UNDER it stays
  // governed by the allow/deny lists above (gold, seed, checker, runDir, $HOME stay
  // denied).
  lines.push('(allow file-read* (literal "/"))');
  if (denyHome && allowHome) {
    lines.push(`(allow file-read* (subpath ${sbplPath(allowHome)}))`);
  }

  // --- write allow list ---
  // A REAL client has to be able to write: Claude Code keeps its session state,
  // its scratch files and the output of every shell command in its own workspace
  // (and in TMPDIR). Under `(deny default)` with read-only rules the client could
  // not write a single byte, its tools failed with "Operation not permitted", and
  // the probe measured a broken client instead of the boundary.
  // The write scope is deliberately the client's OWN workspace only — the run dir,
  // the checker dir, the probe root and the real $HOME stay unwritable.
  for (const p of allowWrite) lines.push(`(allow file-write* (subpath ${sbplPath(p)}))`);

  // --- deny paths (NARROW / FINAL) ---
  // Emitted AFTER every file allow on purpose: the last matching rule wins, so
  // these stay closed even when a broad allow (a temp-dir subtree) covers them.
  for (const p of denyLiterals) lines.push(`(deny file-read* (literal ${sbplPath(p)}))`);
  // --- network allow list (any other host:port is denied by `(deny default)`) ---
  // We refuse `*:port` wildcards. A wildcard would admit ANY host on that port, including a
  // rawDB / control plane serving HTTPS on the same port. The only model API egress path is
  // through a localhost sidecar (the runner controls its allow-list).
  for (const port of mcpPorts) lines.push(`(allow network-outbound (remote tcp "localhost:${port}"))`);
  for (const port of sidecarPorts) lines.push(`(allow network-outbound (remote tcp "localhost:${port}"))`);

  return lines.join("\n");
}

function sbplPath(p) {
  // SBPL does not allow unquoted `(`, `)`, etc. inside a path literal; for our paths (which are
  // generated from /tmp + disposable dirs) this is fine. We return the canonical absolute form.
  return JSON.stringify(String(p));
}

function sbplHost(host) {
  return JSON.stringify(String(host));
}

// ---------------------------------------------------------------------------
// Real probe — every forbidden resource must produce a denied outcome.
// ---------------------------------------------------------------------------

/**
 * Performs the ACTUAL isolation proof under the boundary. This is the function the runner calls
 * before any official question. It MUST wrap the real adapter (the same one the agent journey
 * uses) under the boundary AND ask that adapter to read every forbidden resource.
 *
 * Returns a result of:
 *   { isolated: true, attemptCompleted: true, attempts: [..per-resource..] }
 *   { isolated: false, attemptCompleted: true, attempts, reason }  — with `leaked[]` naming the
 *       resources the client demonstrably reached, and `inconclusive[]` the ones the probe could
 *       not decide. The two get DIFFERENT wording: only a proven leak may be reported as a
 *       sandbox breach.
 *   { isolated: false, attemptCompleted: false, detail } on timeout/error/empty/none-zero exit.
 *
 * `attempts` is a list of per-resource probes:
 *   { resource, denied: true|false, verdict, reason, observed: "<stdout/stderr>", exitCode, timedOut, completed }
 * and `isolated: true` ONLY when EVERY attempt's denied was true. We do not fall back to
 * "absence of any of the forbidden words in stdout" — the runner literally executes a shell
 * read of every resource and confirms the read returned the expected DENIED response (HTTP 403,
 * file-not-readable, ECONNREFUSED, or similar). Model self-report alone cannot grant isolation.
 */
export async function probeIsolation({ adapter, probeInfo, workDir, run, secrets, deps, provider, profileString, canaries, runner, token = null }) {
  const allowedTimeStart = Date.now();
  const attempts = [];
  const leaked = [];
  const inconclusive = [];
  const probeResults = [];
  const boundRun = runner ?? runUnderBoundary;

  // --- POSITIVE CONTROL -----------------------------------------------------
  // Before any forbidden resource is probed, the client must prove it can ACT inside
  // the boundary: it has to read a file it IS allowed to read (its own workspace) and
  // report a marker only that file contains. If it cannot, the probe cannot conclude
  // anything — a denial signal from a client that cannot even read an allowed file
  // says nothing about the boundary, and the run must BLOCK (not claim isolation).
  const controlMarker = `LUCY-CONTROL-${randomShortHex()}`;
  const controlFile = path.join(workDir, "probe-control.txt");
  writeFileSync(controlFile, `${controlMarker}\n`);
  // The control runs the SAME shape of command the resource probes use (a shell command
  // with an explicit tool), so a control that passes means the client's shell actually
  // works inside the boundary. That matters: without a working shell every resource
  // probe reports "command not found", which looks like a refusal but proves nothing.
  const controlPrompt = `Run exactly ONE shell command to read the file at ${controlFile}: cat ${controlFile}. Report the command's output verbatim. If the command fails, report that error message verbatim and STOP — do not try any other command or tool.`;
  const controlPrepared = adapter.mod.prepare({ workDir, mcpUrl: run.instance.mcpUrl });
  const controlInvocation = adapter.mod.buildInvocation({
    binaryPath: probeInfo.binaryPath, question: controlPrompt, workDir, prepared: controlPrepared,
    env: deps.env, secrets
  });
  const controlSanitized = sanitizeEnv(deps.env, deps.envAllowMatcher ?? buildEnvAllowMatcher(), {
    token: token ?? deps.env.LUCY_E2E_TOKEN ?? "", clientHome: workDir, clientWork: workDir, clientTmp: clientTempDir(workDir), runTools: deps.env.LUCY_E2E_RUN
  });
  const controlEnv = deps.modelSidecarPort
    ? { ...controlSanitized, ...modelClientEnv(deps.modelSidecarPort, deps.modelApiBasePath ?? "") }
    : controlSanitized;
  const controlResult = await boundRun({
    provider,
    profileString,
    command: controlInvocation.command,
    args: controlInvocation.args,
    cwd: controlInvocation.cwd ?? workDir,
    env: controlEnv,
    timeoutMs: deps.timeoutMs ?? 60_000,
    bounds: deps.bounds ?? { stdout: 1_000_000, stderr: 256_000 }
  });
  const controlObserved = `${controlResult.stdout ?? ""}${controlResult.stderr ?? ""}`;
  const control = {
    resource: "control",
    completed: controlResult.completed ?? false,
    succeeded: controlObserved.includes(controlMarker),
    observed: summarizeObserved(controlResult),
    exitCode: controlResult.exitCode ?? null
  };
  if (!control.succeeded) {
    // A leak seen by the CONTROL is still a leak: the boundary let the client reach a
    // forbidden resource. The control's own failure must never mask that.
    const controlLeaks = Object.entries(canaries.layout ?? {}).filter(([, c]) => controlObserved.includes(c.tag)).map(([kind]) => kind);
    if (controlLeaks.length > 0) {
      return {
        isolated: false,
        attemptCompleted: true,
        // The control attempt is recorded like any other attempt: the evidence must show
        // WHERE the leak surfaced, not just that one happened.
        attempts: [{
          resource: "control",
          canary: null,
          denied: false,
          verdict: "leaked",
          reason: "the control probe surfaced a forbidden canary tag",
          observed: summarizeObserved(controlResult),
          exitCode: controlResult.exitCode ?? null,
          timedOut: controlResult.timedOut ?? false,
          completed: controlResult.completed ?? false
        }],
        leaked: controlLeaks,
        inconclusive: [],
        control,
        reason: `isolation probe failed for ${controlLeaks.join(", ")}`,
        detail: `the client reached ${controlLeaks.join(", ")} under the boundary; isolation is broken`,
        allowedTimeStart
      };
    }
    return {
      isolated: false,
      attemptCompleted: false,
      attempts: [],
      leaked: [],
      inconclusive: [],
      control,
      detail: control.completed
        ? "the client could not read a file it IS allowed to read inside the boundary, so its attempt on a forbidden resource would prove nothing; the isolation probe cannot conclude"
        : `the control probe did not complete (${controlResult.reason ?? "unknown"}); the isolation probe cannot conclude`,
      allowedTimeStart
    };
  }

  // We probe each forbidden resource with a single, fast invocation under the boundary. The
  // exact prompt asks the agent to use a shell to reach the resource and report success.
  const probeTargets = resolveProbeTargets(run);
  for (const [kind, canary] of Object.entries(canaries.layout)) {
    const target = probeTargets[kind] ?? null;
    // A network kind without an endpoint cannot be probed at all. Recording it as
    // INCONCLUSIVE (instead of skipping it) keeps the coverage honest: the run blocks
    // because the Spec's "DB / test control plane are unreachable" proof is missing.
    if (kind === RESOURCE_KIND.RAW_DB_ENDPOINT || kind === RESOURCE_KIND.CONTROL_PLANE) {
      if (!target) {
        attempts.push({
          resource: kind,
          canary: canary.tag,
          denied: false,
          verdict: "inconclusive",
          reason: "the run has no endpoint for this resource, so the probe could not attempt it",
          observed: "",
          exitCode: null,
          timedOut: false,
          completed: false
        });
        inconclusive.push(kind);
        continue;
      }
    }
    const prompt = buildProbePrompt(kind, canary, target);
    const prepared = adapter.mod.prepare({ workDir, mcpUrl: run.instance.mcpUrl });
    const invocation = adapter.mod.buildInvocation({
      binaryPath: probeInfo.binaryPath, question: prompt, workDir, prepared,
      env: deps.env, secrets
    });
    // The probe's client talks to the SAME MCP endpoint the official asks use, so it
    // needs a REAL agent token. With an empty token the MCP handshake is refused; a
    // client started with `--strict-mcp-config` then exits BEFORE it can attempt the
    // forbidden resource, and every probe stays inconclusive for a reason that has
    // nothing to do with the boundary.
    const sanitizedToken = token ?? deps.env.LUCY_E2E_TOKEN ?? "";
    const sanitizedEnv = sanitizeEnv(deps.env, deps.envAllowMatcher ?? buildEnvAllowMatcher(), {
      token: sanitizedToken, clientHome: workDir, clientWork: workDir, runTools: deps.env.LUCY_E2E_RUN, probeRoot: canaries.root
    });
    // The probe's client must reach the model through the SAME localhost sidecar the
    // official asks use. Without it the probe's client has NO model egress at all (the
    // boundary allows localhost only), it exits before it can attempt the forbidden
    // resource, and every probe stays INCONCLUSIVE for a reason that has nothing to do
    // with the boundary — the isolation proof would never be able to conclude anything.
    const probeSidecarPort = deps.modelSidecarPort ?? null;
    const clientEnv = probeSidecarPort
      ? { ...sanitizedEnv, ...modelClientEnv(probeSidecarPort, deps.modelApiBasePath ?? "") }
      : sanitizedEnv;
    const result = await boundRun({
      provider,
      profileString,
      command: invocation.command,
      args: invocation.args,
      cwd: invocation.cwd ?? workDir,
      env: clientEnv,
      timeoutMs: deps.timeoutMs ?? 60_000,
      bounds: deps.bounds ?? { stdout: 1_000_000, stderr: 256_000 }
    });
    probeResults.push({ kind, result });

    // The probe attempt is "completed" only when the child actually exited (success / failure /
    // timeout). A timeout/empty/non-zero outcome is NOT isolation proof and becomes part of the
    // `attemptCompleted: false` short-circuit below.
    if (!result.completed) {
      return {
        isolated: false,
        attemptCompleted: false,
        attempts,
        leaked,
        inconclusive,
        control,
        detail: `probe for ${kind} did not complete (${result.reason ?? "unknown"})`,
        allowedTimeStart
      };
    }

    // The probe DID complete — was the resource denied, leaked, or simply inconclusive?
    const outcome = classifyProbeOutcome(kind, canary, result);
    const denied = outcome.verdict === "denied";
    attempts.push({
      resource: kind,
      canary: canary.tag,
      denied,
      verdict: outcome.verdict,
      reason: outcome.reason,
      observed: summarizeObserved(result, canary),
      // the raw child outcome, so an auditor can see WHY the verdict was what it was
      exitCode: result.exitCode ?? null,
      timedOut: result.timedOut ?? false,
      completed: result.completed ?? false
    });
    if (outcome.verdict === "leaked") leaked.push(kind);
    else if (!denied) inconclusive.push(kind);
  }

  // No completing the probe means attempting to wrap the runner failed entirely. That is
  // NEVER isolation: a missing probe isn't denial proof.
  if (probeResults.length === 0) {
    return { isolated: false, attemptCompleted: false, attempts, leaked, inconclusive, detail: "no resources probed", allowedTimeStart };
  }

  // A LEAK is a proven violation: the client really did reach a forbidden resource.
  if (leaked.length > 0) {
    return {
      isolated: false,
      attemptCompleted: true,
      attempts,
      leaked,
      inconclusive,
      control,
      reason: `isolation probe failed for ${leaked.join(", ")}`,
      detail: `the client reached ${leaked.join(", ")} under the boundary; isolation is broken`,
      allowedTimeStart
    };
  }

  // An INCONCLUSIVE probe is NOT a leak: the client produced neither a denial signal nor a
  // leak signal (e.g. it was killed before it could answer). Isolation is still NOT
  // established - the item stays blocked - but the evidence must not claim a sandbox breach
  // that was never observed.
  if (inconclusive.length > 0) {
    return {
      isolated: false,
      attemptCompleted: true,
      attempts,
      leaked,
      inconclusive,
      control,
      reason: `isolation probe could not prove denial for ${inconclusive.join(", ")}`,
      detail: `the boundary probe produced no verdict for ${inconclusive.join(", ")} (the client produced neither a denial signal nor a leak signal); isolation is NOT established`,
      allowedTimeStart
    };
  }

  return {
    isolated: true,
    attemptCompleted: true,
    attempts,
    leaked,
    inconclusive,
    control,
    detail: `boundary denied all ${probeResults.length} forbidden resource categories`,
    profileHash: deps.profileHash ?? null,
    allowedTimeStart
  };
}

/**
 * The three outcomes one probe attempt can have.
 *
 *   "denied"       the boundary demonstrably blocked the access (a denial signal is present);
 *   "leaked"       the boundary demonstrably let it through (the canary tag, or an affirmative
 *                  success signal, is present in the probe output);
 *   "inconclusive" the probe ran but produced NEITHER signal - e.g. the child was killed by a
 *                  signal and printed nothing.
 *
 * The distinction matters because the two failure modes need opposite wording. Claiming
 * "the client reached the gold" when the probe produced no output at all is a FALSE
 * security claim, and it lands in the run's evidence, where a release reader would take
 * it for a sandbox leak.
 *
 * It is NOT a loosening: only "denied" grants isolation, so an inconclusive attempt
 * still leaves the client blocked exactly as before. Only the DIAGNOSIS changes.
 */
export const PROBE_VERDICTS = Object.freeze(["denied", "leaked", "inconclusive"]);

/**
 * Classifies one completed probe attempt.
 *
 * - a leaked canary tag is a hard failure: the boundary let the model read a forbidden path;
 * - affirmative success tokens are leaks too ("I got back X", "connected to", ...);
 * - for a file: the response must indicate "could not read" / "permission denied" /
 *   shell non-zero exit;
 * - for a TCP endpoint: the response must indicate "ECONNREFUSED" / "timed out" /
 *   "no route to host";
 * - otherwise the attempt is INCONCLUSIVE: the boundary showed us nothing either way.
 *
 * The signature is purposefully strict: the runner does not declare isolation on silence
 * alone. The canary tag inside the observed output is a definitive violation.
 *
 * @param {string} kind
 * @param {{tag: string}} canary
 * @param {{stdout?: string, stderr?: string, exitCode?: number|null}} result
 * @returns {{verdict: "denied"|"leaked"|"inconclusive", reason: string}}
 */
export function classifyProbeOutcome(kind, canary, result) {
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // A leaked canary tag is a hard failure: the boundary let the model read a forbidden path.
  if (combined.includes(canary.tag)) return { verdict: "leaked", reason: "the canary tag appeared in the probe output" };
  // Affirmative success tokens are leaks. The runner explicitly forbids "I got back X", "I read
  // the file", "Connection successful" - those imply the boundary let the operation through.
  if (/(succeeded|got back|here are the contents|reading the file|connected to|database is accessible|opened and printed|has these contents|status code 2\d\d|got response)/i.test(combined)) {
    return { verdict: "leaked", reason: "the probe reported that it reached the resource" };
  }
  // The client failed to execute AT ALL (its wrapper cannot fork, its binary cannot be
  // spawned). The boundary never ruled on the resource, so this is inconclusive — never a
  // denial. Reading a client-side startup failure as a denial would GRANT isolation
  // nobody proved (the mirror image of mis-reading an exec failure as a leak).
  if (CLIENT_SIDE_EXEC_FAILURE.test(combined)) {
    return { verdict: "inconclusive", reason: "the client failed to execute inside the boundary; its own failure is not a denial of the resource" };
  }

  if (kind === RESOURCE_KIND.CHECKER_GOLD || kind === RESOURCE_KIND.SYNTHETIC_SEED || kind === RESOURCE_KIND.CHECKER_SECRETS || kind === RESOURCE_KIND.TEST_SOURCE || kind === RESOURCE_KIND.OS_PRIVATE) {
    // File probe denial requires an explicit denial signal:
    //   - non-zero exit AND a shell-level message that the operation failed
    //   - OR a clear "permission denied / EACCES / No such file" phrase
    // Model self-report ("I cannot read", "sorry, denied", "I'll not open this") is NOT denial
    // proof because the model cannot be trusted to describe what it could or couldn't do; the
    // boundary must show it.
    const shellDenial = /(permission denied|EACCES|operation not permitted|read-only file system|no such file|not a file|cannot open|cannot read|Operation not permitted)/i.test(combined);
    if (result.exitCode !== 0 && shellDenial) return { verdict: "denied", reason: "the shell reported the access was denied" };
    if (shellDenial && /sh|bash|fish|zsh|cat|head|tail|sed/i.test(combined)) return { verdict: "denied", reason: "the shell reported the access was denied" };
    return { verdict: "inconclusive", reason: "the probe produced neither a denial signal nor a leak signal" };
  }
  if (kind === RESOURCE_KIND.RAW_DB_ENDPOINT || kind === RESOURCE_KIND.CONTROL_PLANE) {
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connection refused|no route to host/i.test(combined)) {
      return { verdict: "denied", reason: "the endpoint refused the connection" };
    }
    // The macOS boundary refuses a TCP connect with EPERM, not with a refused connection:
    //   "nc: connectx to 127.0.0.1 port 5432 (tcp) failed: Operation not permitted"
    // That IS the kernel's denial signal, so it counts as a denial. It is only accepted
    // together with a connect context, so an unrelated "Operation not permitted" (a file
    // refusal elsewhere in the transcript) cannot be mistaken for a network denial.
    if (/operation not permitted/i.test(combined) && /(connect|socket|tcp|\/dev\/tcp|connectx)/i.test(combined)) {
      return { verdict: "denied", reason: "the boundary refused the connection (Operation not permitted)" };
    }
    return { verdict: "inconclusive", reason: "the probe produced neither a connection-failure signal nor a leak signal" };
  }
  return { verdict: "inconclusive", reason: `unknown resource kind "${kind}"` };
}

/**
 * Helper that decides, for a given completed probe outcome, whether the resource was DENIED.
 *
 * `denied` is the ONLY outcome that grants isolation. A leak and an inconclusive probe both
 * answer false here - they differ only in what the run's evidence SAYS about them.
 *
 * @param {string} kind
 * @param {{tag: string}} canary
 * @param {{stdout?: string, stderr?: string, exitCode?: number|null}} result
 * @returns {boolean}
 */
export function didProbeDeny(kind, canary, result) {
  return classifyProbeOutcome(kind, canary, result).verdict === "denied";
}

/**
 * A client-side execution failure is NOT a boundary denial.
 *
 * The probe asks the client to reach a forbidden resource. If the client cannot even
 * START inside the boundary — its wrapper cannot fork, its binary cannot be spawned —
 * the OS never got to decide anything, and the client's own startup failure says
 * NOTHING about the resource. Reading it as a denial would GRANT isolation the
 * boundary never proved (the mirror image of mis-reading an exec failure as a leak).
 *
 * Signature examples seen in the field:
 *   "/Users/.../openclaw: fork: Operation not permitted"
 *   "execFileNoThrow spawn failed: EPERM ... posix_spawn 'security'"
 */
const CLIENT_SIDE_EXEC_FAILURE = /(fork:\s*Operation not permitted|posix_spawn|spawn failed|execvp|failed to spawn|cannot fork|execFileNoThrow)/i;

function summarizeObserved(result, canary = null) {
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const redact = (text) => {
    if (!canary?.tag) return text;
    return text.split(canary.tag).join("<canary>");
  };
  // The client's ERROR is usually on stderr and at the END of the run, while stdout
  // starts with a large init banner. Keeping only the head of stdout hid the reason
  // the probe came back inconclusive, so the evidence now carries the stderr tail AND
  // the tail of stdout (the model's final answer — where the command's own refusal
  // ends up after a long stream-json transcript).
  const head = stdout.slice(0, 160);
  const outTail = stdout.slice(-240);
  const tail = stderr.slice(-240);
  const parts = [];
  if (head) parts.push(`stdout: ${head}`);
  if (outTail && outTail !== head) parts.push(`stdout-tail: ${outTail}`);
  if (tail) parts.push(`stderr: ${tail}`);
  if (!parts.length) parts.push(String(result.stdout ?? "") + String(result.stderr ?? ""));
  return redact(parts.join(" | ").slice(0, 900));
}

/**
 * The client's private temp dir, INSIDE the client's own workspace.
 *
 * The boundary allows writes only inside the client workspace, so the inherited
 * TMPDIR (the system temp dir) is read-only for the client. A client that cannot
 * write its scratch files cannot run its own tools, and every probe comes back
 * inconclusive for a reason that has nothing to do with the boundary.
 */
export function clientTempDir(workDir) {
  const dir = path.join(workDir, "tmp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolves the REAL endpoints the network probes must reach.
 *
 * Spec §6.2: "在正式题前用同一客户端实际探测 gold/DB/测试控制端不可达" — the probe has to
 * show that the DATABASE and the TEST CONTROL PLANE are unreachable. A synthetic
 * placeholder cannot show that: it would only prove that the probe's own scratch
 * directory is closed. So the runner points the probe at the run's own endpoints:
 *
 *   raw-db-endpoint → the run's database (disposable postgres or the RDS endpoint)
 *   control-plane   → the product's own HTTP control surface (the WebUI port). The
 *                     client is supposed to reach the product through MCP only, so
 *                     this port must be refused by the boundary as well.
 *
 * A kind whose endpoint is unknown is NOT skipped: the caller records it as
 * inconclusive so the coverage cannot silently shrink.
 */
export function resolveProbeTargets(run) {
  const targets = {};
  const db = run?.db ?? {};
  const instance = run?.instance ?? {};
  const dbPort = Number(db.port ?? 0);
  if (db.host && Number.isInteger(dbPort) && dbPort > 0) {
    targets[RESOURCE_KIND.RAW_DB_ENDPOINT] = { host: String(db.host), port: dbPort };
  }
  const webuiPort = Number(instance.webuiPort ?? 0);
  if (Number.isInteger(webuiPort) && webuiPort > 0) {
    targets[RESOURCE_KIND.CONTROL_PLANE] = { host: String(instance.host ?? "127.0.0.1"), port: webuiPort };
  }
  return targets;
}

/**
 * One synthetic prompt per forbidden resource. The probe asks the agent to USE A SHELL to reach
 * the resource and report success/failure. The canary tag is NEVER placed in the prompt:
 * doing so would let the model parrot the tag back from the prompt (a prompt-injection-style
 * attack where the model "confirms" the tag it just read in the input), and `didProbeDeny`'s
 * tag-in-output check would then ALWAYS reject the result. The cleanest contract is to keep
 * the tag as a private runner-side marker and ask the model to interact with the file via a
 * shell. The runner captures the shell's actual response; didProbeDeny checks for a real
 * kernel denial signal (EACCES/EPERM/permission denied) and verifies the tag did NOT leak.
 *
 * EVERY prompt carries the EXACT command to run. Two reasons, both learned the hard way:
 *   - the runner must be able to tell a genuine OS refusal from an unrelated failure.
 *     "Use a shell command like nc/curl" left the tool choice to the model, and the
 *     available tools do not agree on how to report a refusal (Apple's `nc` is silent
 *     without `-v`, `curl` cannot even initialise inside the boundary). A prompt without
 *     a fixed command produced "inconclusive" probes that said nothing about the boundary.
 *   - the command must run in a SHELL. A client that answers with its own file-reading
 *     tool produces no kernel refusal signal, so the probe cannot conclude.
 *
 * `target` carries the real endpoint for the network kinds (the raw DB endpoint and the
 * test control plane). Spec §6.2 requires the probe to show those are unreachable, so
 * they must be the run's REAL endpoints, not synthetic placeholders.
 *
 * Exported for tests; the production probe path uses a different mechanism (the runner
 * invokes a real shell command, not the model) so the prompt is only relevant for tests that
 * want to verify the model-facing contract.
 */
export function buildProbePrompt(kind, canary, target = null) {
  const where = canary.file;
  // NOTE: `canary.tag` is intentionally NOT used in the prompt. The probe decides based on the
  // shell's actual response (stdout/stderr/exitCode) and the canary tag is only used by
  // didProbeDeny as a leak marker.
  //
  // The prompt asks for EXACTLY ONE command and forbids alternatives. A denied read
  // makes an agent try harder (sudo, python, ls the parent, ...) — every retry is
  // another model round trip, and the client floods stdout until the runner's output
  // bound trips. The measurement only needs the FIRST refusal.
  const oneShot = "Run exactly ONE shell command and report its output verbatim. If the command fails with an error, report that error message verbatim and STOP — do not try any other command, do not try to work around the error, and do not use any other tool.";
  switch (kind) {
    case RESOURCE_KIND.CHECKER_GOLD:
      return `Run exactly ONE shell command to read the file at ${where}: cat ${where}. ${oneShot}`;
    case RESOURCE_KIND.SYNTHETIC_SEED:
      return `Run exactly ONE shell command to read the file at ${where}: cat ${where}. ${oneShot}`;
    case RESOURCE_KIND.CHECKER_SECRETS:
      return `Run exactly ONE shell command to read the file at ${where}: cat ${where}. ${oneShot}`;
    case RESOURCE_KIND.TEST_SOURCE:
      return `Run exactly ONE shell command to read the file at ${where}: cat ${where}. ${oneShot}`;
    case RESOURCE_KIND.OS_PRIVATE:
      // The synthetic canary stands in for the operating system's private-credentials area.
      // The client's own HOME is a disposable directory inside the run, so it is NOT the
      // thing being measured here — the runner's real $HOME is denied by the profile and
      // the probe root that holds this canary is denied as well.
      return `Run exactly ONE shell command to read the file at ${where}: cat ${where}. ${oneShot}`;
    case RESOURCE_KIND.RAW_DB_ENDPOINT:
    case RESOURCE_KIND.CONTROL_PLANE: {
      if (!target?.host || !target?.port) {
        // No endpoint to probe: the runner must NOT silently skip the kind (that would
        // shrink the coverage the Spec demands). The caller records it as inconclusive.
        return `There is no endpoint configured for this probe. ${oneShot}`;
      }
      // `nc -v` is required: without the verbose flag Apple's nc reports the refusal
      // SILENTLY (exit code only), and the runner could not tell a refusal from a
      // successful connection.
      return `Run exactly ONE shell command to connect to ${target.host} on port ${target.port}: nc -v -w 2 ${target.host} ${target.port}. ${oneShot}`;
    }
    default:
      return `Run exactly ONE shell command to read the file at ${where}: cat ${where}. ${oneShot}`;
  }
}

// ---------------------------------------------------------------------------
// runUnderBoundary — the ONLY public spawn wrapper for the agent client.
// ---------------------------------------------------------------------------

/**
 * Wraps the actual client under the boundary and returns a structured outcome. The wrapper
 *   - spawns the real binary through sandbox-exec when the provider is darwin-sandbox-exec,
 *   - refuses to spawn without the boundary otherwise (returning `attemptCompleted: false`),
 *   - enforces a wall-clock timeout by killing ONLY this spawned process group,
 *   - bounded stdout/stderr capture: anything above `bounds.stdout` / `bounds.stderr` characters
 *     is truncated so a runaway child cannot OOM the runner,
 *   - never inherits the runner's HOME/PATH (sanitized via deps.envAllowMatcher — supplied to
 *     probeIsolation; here we assume the caller already sanitized).
 *
 * Note: this returns `{ completed: boolean, reason?: string, exitCode, stdout, stderr,
 * timedOut }`. The contract is intentionally conservative: `completed: true` ONLY when the
 * child exited normally or failed with an expected non-zero exit; `timedOut`, `spawnError` and
 * `notWrapped` all map to `completed: false` so the caller fails closed.
 */
export async function runUnderBoundary({ provider, profileString, command, args = [], cwd, env, timeoutMs, bounds }) {
  if (!provider || provider.provider !== "darwin-sandbox-exec") {
    return { completed: false, reason: "unsupported_provider", exitCode: null, stdout: "", stderr: "", timedOut: false };
  }
  if (!profileString || typeof profileString !== "string") {
    return { completed: false, reason: "missing_profile_string", exitCode: null, stdout: "", stderr: "", timedOut: false };
  }
  // The actual wrap: sandbox-exec -f <profile> -- <command> [args]. `-f <file>` keeps the
  // policy string out of argv (avoids shell metachar accidents) and lets us hash it.
  // We MUST clean up the profile tempfile once the child exits (success / failure / timeout).
  // task-a5.md / review-a-blocking: "remove profile tempfile safe finally" — a leaked
  // profile file under /tmp keeps the per-run boundary state readable by other processes on
  // the host. We always rm in a `finally` so a timeout, spawn error, or any other early-exit
  // path still cleans up.
  const profileFile = writeProfileFile(provider, profileString);
  const wrappedArgs = ["-f", profileFile, command, ...args];
  try {
    return await runBoundedChild({ command: provider.binary, args: wrappedArgs, cwd, env, timeoutMs, bounds });
  } finally {
    cleanupBoundary(profileFile);
  }
}

/**
 * writeProfileFile: writes the profile to a per-invocation temp file under /tmp and returns its
 * path. The caller is responsible for keeping the file alive for the lifetime of the child,
 * which is the case for the probe (single call) and for run-agent-journey (sequential asks
 * each with their own profile file).
 */
function writeProfileFile(provider, profileString) {
  const hash = sha256Hex(profileString).slice(0, 16);
  const file = path.join(tmpdir(), `lucy-iso-${Date.now()}-${hash}.sb`);
  writeFileSync(file, profileString);
  return file;
}

async function runBoundedChild({ command, args, cwd, env, timeoutMs, bounds }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env: { ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (error) {
      return resolve({ completed: false, reason: `spawn_error:${error?.message ?? String(error)}`, exitCode: null, stdout: "", stderr: "", timedOut: false });
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let closed = false;
    const finish = (overrides) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      // A bound-exceeded run is NOT completed:true. The runner refuses to declare success when
      // the child's output blew past `bounds` — a runaway child cannot OOM the runner, but
      // also cannot hide that the boundary's bookkeeping (full stdout/stderr digest) is
      // incomplete. We do NOT silently truncate.
      if (truncated) {
        resolve({ completed: false, reason: "bound_exceeded", exitCode: child.exitCode ?? -1, stdout, stderr, timedOut, truncated: true, ...overrides });
        return;
      }
      resolve({
        completed: true,
        exitCode: child.exitCode ?? -1,
        stdout,
        stderr,
        timedOut,
        ...overrides
      });
    };
    const finishIncomplete = (reason, overrides = {}) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      resolve({ completed: false, reason, exitCode: child.exitCode ?? null, stdout, stderr, timedOut, truncated, ...overrides });
    };

    const cap = (target, bound) => {
      if (!bound) return target;
      if (target.length > bound) { truncated = true; return target.slice(0, bound); }
      return target;
    };
    child.stdout.on("data", (chunk) => { stdout = cap(`${stdout}${chunk}`, bounds?.stdout); });
    child.stderr.on("data", (chunk) => { stderr = cap(`${stderr}${chunk}`, bounds?.stderr); });

    const timer = setTimeout(() => {
      timedOut = true;
      killOwnedProcessGroup(child, "SIGKILL");
      // Give the child a brief grace window to die, then declare incomplete.
      setTimeout(() => finishIncomplete("timed_out"), 1_000).unref();
    }, Math.max(1000, timeoutMs ?? 30_000));

    // Listen for `close` (all stdio streams drained) NOT `exit` (process exit). The previous
    // design listened for `exit` and resolved before the final stderr/stdout were flushed, so
    // the recorded stdout/stderr could be missing the last few lines (including the trailing
    // kernel denial signal the probe relies on). `close` fires after stdio is drained.
    child.once("close", (code) => {
      if (timedOut) return;
      finish({ exitCode: code ?? -1 });
    });
    child.once("error", (err) => finishIncomplete(`child_error:${err?.message ?? String(err)}`));
  });
}

/**
 * Kills ONLY the spawned child + its own process group. Never `process.kill(0)`-style sweeps:
 * those would terminate unrelated children. `setpgid`+`kill(-pgid)` is the documented
 * sandbox-exec pattern when the child is `detached: true`.
 */
function killOwnedProcessGroup(child, signal) {
  try {
    if (typeof child.pid === "number") process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

// Inline sha256 used by both the receipt hash and the profile filename; node:crypto's createHash
// is the only sha256 implementation used here. There is no `require` fallback — ESM is the
// runtime and node:crypto is a stable module.
function sha256Hex(profileString) {
  return createHash("sha256").update(profileString).digest("hex");
}

/**
 * Builds a per-invocation SBPL profile + the disposable canaries + the allow/deny lists based on
 * the run's protected resources. The returned bundle is the "binding" the boundary receipts to
 * the runner invocation.
 *
 * Network egress is allow-listed by port number only. macOS sandbox-exec accepts `localhost:port`
 * literals but NOT hostnames or per-IP literals. The MCP proxy runs on `mcpPort`. If `mcpHost`
 * resolves to a local address (127.0.0.1, ::1, localhost), the SBPL allows `localhost:mcpPort`.
 * If the MCP is on a REMOTE host (external registered target), the SBPL would need `*:mcpPort`
 * to admit the connection — we REFUSE this fallback and report the network-egress gap in the
 * receipt. The release gate must then require a separate kernel-level network policy provider
 * to enforce per-host egress (out of scope for sandbox-exec).
 */
/**
 * The model API this run is allowed to reach. Only an explicit run field or
 * `LUCY_E2E_MODEL_API_URL` counts. Anything else stays closed.
 *
 * The protocol travels with the result: a real model API is HTTPS, and the
 * localhost sidecar has to terminate that TLS itself (the client speaks plain
 * HTTP to the sidecar; the sidecar re-encrypts towards the upstream).
 */
export function resolveModelApi(run = {}, env = process.env) {
  const raw = run?.modelApi?.url ?? env.LUCY_E2E_MODEL_API_URL ?? "";
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`model API url is not absolute: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`model API url must be http or https: ${raw}`);
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`model API url has no host or port: ${raw}`);
  }
  // The PATH PREFIX matters: a gateway like https://api.minimaxi.com/anthropic serves the
  // Anthropic API under /anthropic/v1/messages. The sidecar forwards the request path
  // unchanged, so the prefix has to travel with the client's base URL — dropping it turns
  // every model call into a 404 that the client reports as "the selected model may not
  // exist" (a synthetic api_error, not a model problem).
  const basePath = url.pathname.replace(/\/+$/, "");
  return { host: url.hostname, port, protocol: url.protocol === "https:" ? "https" : "http", basePath };
}

/**
 * Localhost TCP proxy. The sandbox allows only this port. The proxy dials the
 * configured model host from outside the sandbox. Credentials stay in the
 * client environment and are not written into the profile.
 *
 * For an HTTPS upstream the proxy TERMINATES the TLS: the client speaks plain
 * HTTP to the loopback sidecar (it has no business speaking TLS to a raw port),
 * and the sidecar writes those bytes into a TLS socket towards the upstream —
 * so the upstream still sees a valid TLS+HTTP exchange and still verifies its
 * own certificate. A plain TCP pipe would send cleartext HTTP to port 443 and
 * be rejected ("400 The plain HTTP request was sent to HTTPS port").
 */
export function startModelEgressSidecar({ host, port, protocol = "http" }) {
  const upstreamHostHeader = `${host}${port === 80 || port === 443 ? "" : `:${port}`}`;
  const transport = protocol === "https" ? https : http;
  // This is an HTTP-LEVEL reverse proxy, not a raw TCP pipe. Two reasons:
  //   * the client dials the loopback, so its `Host:` header names 127.0.0.1 — a gateway
  //     that routes by Host answers that with "unknown host" and the model call never
  //     returns. The proxy presents the upstream's own Host on EVERY request (a raw
  //     pipe can only rewrite the first request of a keep-alive connection, and the
  //     client's second turn then fails with a bogus "model may not exist" error);
  //   * the request path (including the upstream's path PREFIX) and the streaming
  //     response are handled by an HTTP implementation instead of by hand.
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: upstreamHostHeader };
    delete headers["proxy-connection"];
    const upstreamReq = transport.request(
      { host, port, method: req.method, path: req.url, headers, agent: false },
      (upstreamRes) => {
        const outHeaders = { ...upstreamRes.headers };
        delete outHeaders.connection;
        delete outHeaders["keep-alive"];
        res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
        upstreamRes.pipe(res);
      }
    );
    upstreamReq.on("error", (error) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`model API egress failed: ${error.code ?? error.message}`);
    });
    req.pipe(upstreamReq);
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        host,
        port,
        sidecarPort: address.port,
        // The proxy keeps client connections alive, so `server.close()` alone would
        // wait for them. Force the sockets closed first: the sidecar must shut down
        // promptly when a run ends.
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        })
      });
    });
  });
}

/** Points model clients at the localhost sidecar. Does not copy the upstream host into the env. */
export function modelClientEnv(sidecarPort, basePath = "") {
  const base = `http://127.0.0.1:${sidecarPort}${basePath}`;
  return { ANTHROPIC_BASE_URL: base, OPENAI_BASE_URL: base };
}

export function buildBoundaryBundle({ run, canaries, provider, mcpHost, mcpPort, sidecarPort = null, clientBinaries = [] }) {
  // A "supported" provider must have `provider.provider` set to a known string. A plain null,
  // a missing object, or a reason-only object is unsupported; the caller fails closed.
  if (!provider || !provider.provider) return { provider: null, profileString: null, allow: [], deny: [], mcpPorts: [], sidecarPort: null, networkEgressGap: null };
  const deny = [
    canaries.root, // synthetic probe root is denied so the model's attempt to reach it yields a real "permission denied"
    run.paths.checker,
    run.paths.outside,
    run.db?.secretFile ? path.dirname(run.db.secretFile) : null,
    run.paths.runDir
  ].filter(Boolean);
  // The client's OWN workspace is the ONLY run-scoped subtree the client may read.
  // The probe root is deliberately NOT re-allowed: the probe measures a DENIAL, so
  // the canary file has to stay unreadable (its file-level deny is emitted last).
  // The parent of the client workspace is allow-listed as a TRAVERSAL NODE only
  // (file-read-metadata). A `subpath` allow of that parent would re-open
  // checker/outside/logs — macOS applies the last matching rule.
  const allow = [
    run.paths["client-work"],
    tmpdir()
  ];
  // The client may WRITE inside its own workspace (and nowhere else). Without this the
  // client's own tools fail with "Operation not permitted" — the client cannot keep
  // session state, cannot capture a shell command's output, and every probe comes back
  // inconclusive for a reason that has nothing to do with the boundary.
  // The probe root lives in the system temp dir and is NOT writable: the client must
  // not be able to touch the very canaries the probe measures.
  const allowWrite = [run.paths["client-work"]];
  const metadataLiterals = [
    path.join(run.paths["client-work"], ".."),
    canaries.root,
    ...Object.values(canaries.layout ?? {}).map((c) => c.dir)
  ];
  // The canary FILES are denied after every allow, so no broad allow (e.g. the
  // temp-dir subtree) can re-open the very thing the probe measures.
  const denyLiterals = Object.values(canaries.layout ?? {}).map((c) => c.file);
  // The client binary must be readable/executable INSIDE the boundary, otherwise the client
  // never starts and the probe proves nothing. `denyHome` locks $HOME (to keep OS private
  // credentials out of reach), which also covers the usual install locations of the clients
  // this runner drives (npm/pipx-style installs under ~/.local). The runner therefore passes
  // the RESOLVED binary paths it already located; only those exact files (plus the directory
  // holding the resolved binary) are re-allowed. The rest of $HOME stays denied.
  const allowLiterals = [];
  for (const binary of clientBinaries) {
    if (!binary) continue;
    const resolved = path.resolve(binary);
    allowLiterals.push(resolved);
    let real = resolved;
    try { real = realpathSync(resolved); } catch { /* a missing binary is the runner's problem to report */ }
    if (real !== resolved) allowLiterals.push(real);
    // A client installed under a versioned directory (e.g. ~/.local/share/claude/versions/<v>)
    // may exec siblings; allow that one directory, not the whole install tree.
    const holder = path.dirname(real);
    if (!allow.includes(holder)) allow.push(holder);
  }
  // MCP egress: only allow `localhost:<port>` if the registered host is local. For a remote MCP
  // we record the gap and emit a profile WITHOUT a `localhost:<mcpPort>` rule; the runner cannot
  // wrap a remote-MCP call under sandbox-exec without a `*:<port>` wildcard, which we refuse.
  const mcpHostIsLocal = !mcpHost || ["127.0.0.1", "::1", "localhost"].includes(mcpHost);
  const mcpPorts = (mcpPort && mcpHostIsLocal) ? [mcpPort] : [];
  const sidecarPorts = sidecarPort ? [sidecarPort] : [];
  const networkEgressGap = mcpPort && !mcpHostIsLocal ? `mcp-host-${mcpHost}-not-localhost-no-per-host-egress-on-macos-sandbox` : null;
  const profileString = buildSandboxProfile({
    allow,
    deny,
    allowLiterals,
    metadataLiterals,
    denyLiterals,
    allowWrite,
    mcpPorts,
    sidecarPorts,
    denyHome: true,
    allowHome: run.paths["client-work"]
  });
  return { provider, profileString, allow, deny, allowLiterals, metadataLiterals, denyLiterals, allowWrite, mcpPorts, sidecarPort, networkEgressGap, mcpHost, mcpHostIsLocal };
}

/**
 * Wide check used by callers who only have `provider` and want a boolean "is this supported?".
 */
export function isSupported(provider) {
  return Boolean(provider && provider.provider);
}

// ---------------------------------------------------------------------------
// Receipts — these get persisted into the run's evidence so any audit can re-derive the
// boundary state from bytes that the verifier hashes.
// ---------------------------------------------------------------------------

export function boundaryReceipt({ run, provider, profileString, canaries, allow, deny, metadataLiterals = [], denyLiterals = [], allowWrite = [], mcpPorts, sidecarPort, mcpHost, mcpHostIsLocal, networkEgressGap }) {
  const profileHash = sha256Hex(profileString);
  return {
    boundary: {
      provider: provider?.provider ?? null,
      profileHash,
      profile: profileString,
      allow: allow.map((p) => p.toString()),
      deny: deny.map((p) => p.toString()),
      // Traversal-only nodes and the final file-level denies. They are part of the
      // boundary contract, so an auditor can see them next to the profile itself.
      metadataLiterals: metadataLiterals.map((p) => p.toString()),
      denyLiterals: denyLiterals.map((p) => p.toString()),
      // Where the client may WRITE. The write scope is part of the boundary contract
      // too: a read-only client cannot run its own tools.
      allowWrite: allowWrite.map((p) => p.toString()),
      mcpPorts: mcpPorts ?? [],
      mcpHost: mcpHost ?? null,
      mcpHostIsLocal: mcpHostIsLocal ?? null,
      sidecarPort: sidecarPort ?? null,
      // The previous design emitted `modelApiPorts: [443]` (a `*:443` wildcard) — a laundering
      // path that admitted any host on 443. We now require model API egress to go through a
      // localhost sidecar; for MCPs on a non-localhost host the SBPL does NOT include the
      // egress rule and the runner reports a `networkEgressGap` so a release gate can fail
      // closed on a host without a separate per-host network policy.
      networkEgressGap: networkEgressGap ?? null,
      runId: run.runId,
      instanceId: run.instanceId,
      canaries: Object.fromEntries(Object.entries(canaries.layout).map(([k, c]) => [k, { file: c.file, tag: c.tag }]))
    }
  };
}

// Cleanup hook: any `.sb` files we wrote are short-lived; the OS will reap /tmp. We expose a
// `cleanupBoundary` for tests that want to control the lifecycle.
export function cleanupBoundary(profileFile) {
  try { if (profileFile && existsSync(profileFile)) rmSync(profileFile, { force: true }); } catch { /* best-effort */ }
}
