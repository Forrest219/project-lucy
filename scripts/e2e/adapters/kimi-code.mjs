// Kimi Code CLI adapter (compat Agent pool candidate).
// Binary: `kimi` (home: ~/.kimi-code/bin). Non-interactive: `-p` + `--output-format stream-json`.
// MCP: project-local `<workDir>/.kimi-code/mcp.json` with `bearerTokenEnvVar` (Kimi does not
// expand ${VAR} in headers). Requires `KIMI_CODE_TRUST_WORKSPACE=1` so untrusted workdirs
// still load the project MCP server. Multi-turn: `-S <sessionId>` with a fresh `-p`.
// Auth: product-native login (`~/.kimi-code/credentials/…`) or `KIMI_API_KEY` / `MOONSHOT_API_KEY`.
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv, locateBinary, probeCli } from "./_contract.mjs";

export const product = "kimi-code";
export const transport = "cli";
export const credentialEnv = ["KIMI_API_KEY", "MOONSHOT_API_KEY"];

function credentialOf(env = {}) {
  if (env.KIMI_API_KEY) return { name: "KIMI_API_KEY", value: env.KIMI_API_KEY };
  if (env.MOONSHOT_API_KEY) return { name: "MOONSHOT_API_KEY", value: env.MOONSHOT_API_KEY };
  return null;
}

function hasNativeLogin(env = {}) {
  const home = env.KIMI_CODE_HOME || path.join(env.HOME || "", ".kimi-code");
  if (!home) return false;
  const candidates = [
    path.join(home, "credentials", "kimi-code.json"),
    path.join(home, "credentials.json")
  ];
  for (const file of candidates) {
    try {
      accessSync(file, constants.R_OK);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export function probe({ env, spawnSync, locate = locateBinary }) {
  // `kimi --version` prints a bare semver (e.g. "2.6.3"), not the product name.
  const base = probeCli({
    names: ["kimi"],
    credentialEnv: [],
    env,
    spawnSync,
    locate,
    accept: /^\d+\.\d+/
  });
  const reasons = [...base.reasons];
  if (!credentialOf(env) && !hasNativeLogin(env) && base.binaryPath) {
    reasons.push("credential_missing: KIMI_API_KEY | MOONSHOT_API_KEY | kimi login");
  }
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    reasons,
    binaryPath: base.binaryPath,
    version: base.version,
    model: env.LUCY_E2E_KIMI_MODEL || "default"
  };
}

export function prepare({ workDir, mcpUrl }) {
  const dir = path.join(workDir, ".kimi-code");
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      lucy: {
        url: mcpUrl,
        bearerTokenEnvVar: TOKEN_ENV
      }
    }
  };
  const file = path.join(dir, "mcp.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { env: { KIMI_CODE_TRUST_WORKSPACE: "1" }, files: [file] };
}

export const supportsContinuation = true;

export function buildInvocation({
  binaryPath,
  question,
  workDir,
  prepared,
  env,
  secrets = [],
  sessionId = null,
  continueSession = false
}) {
  // `-p` cannot combine with `--yolo` / `--auto`; MCP tools still run in prompt mode.
  const args = ["-p", question, "--output-format", "stream-json"];
  if ((continueSession || sessionId) && sessionId) {
    args.push("-S", String(sessionId));
  }
  const model = env.LUCY_E2E_KIMI_MODEL || "";
  if (model) args.push("-m", model);
  assertNoSecretInArgv(args, secrets);
  const credential = credentialOf(env);
  return {
    command: binaryPath,
    args,
    cwd: workDir,
    env: {
      ...(prepared?.env ?? {}),
      KIMI_CODE_TRUST_WORKSPACE: "1",
      KIMI_API_KEY: env.KIMI_API_KEY ?? "",
      MOONSHOT_API_KEY: env.MOONSHOT_API_KEY ?? "",
      ...(credential ? { [credential.name]: credential.value } : {})
    }
  };
}

export function parseResult({ stdout, exitCode }) {
  let finalAnswer = "";
  let sessionId = null;
  let model = "";
  for (const line of String(stdout ?? "").split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "session.resume_hint" && event.session_id) {
      sessionId = String(event.session_id);
    }
    if (event.session_id && !sessionId) sessionId = String(event.session_id);
    if (event.model) model = String(event.model);
    if (event.role === "assistant" && event.content) {
      finalAnswer = String(event.content);
    }
  }
  if (!finalAnswer) finalAnswer = String(stdout ?? "").trim();
  return { finalAnswer, model, sessionId, ok: exitCode === 0 && finalAnswer !== "" };
}
