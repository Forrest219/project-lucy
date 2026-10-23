// Claude Code CLI adapter (Spec R4 v4: automated required product; transport=cli).
// Binary: `claude`. Native config: mcp.json passed via `--mcp-config` (Authorization interpolates env var name).
// Auth: ANTHROPIC_API_KEY, or a successful `claude auth status` after `claude login`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv, locateBinary, probeCli } from "./_contract.mjs";

export const product = "claude-code";
export const transport = "cli";
export const credentialEnv = ["ANTHROPIC_API_KEY"];

export function probe({ env, spawnSync, locate = locateBinary }) {
  const base = probeCli({
    names: ["claude"],
    credentialEnv: [],
    env,
    spawnSync,
    locate,
    accept: /claude|anthropic/i
  });
  const reasons = [...base.reasons];
  if (!env.ANTHROPIC_API_KEY && base.binaryPath) {
    const auth = spawnSync(base.binaryPath, ["auth", "status"], { encoding: "utf8", env, timeout: 20_000 });
    const text = `${auth.stdout ?? ""}${auth.stderr ?? ""}`;
    if (auth.status !== 0 || !/logged.?in|apiProvider|anthropic|ok/i.test(text)) {
      reasons.push("credential_missing: ANTHROPIC_API_KEY | claude login");
    }
  }
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    reasons,
    binaryPath: base.binaryPath,
    version: base.version,
    model: env.LUCY_E2E_CLAUDE_MODEL || "default"
  };
}

export function prepare({ workDir, mcpUrl }) {
  const dir = path.join(workDir, "claude-mcp");
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      lucy: {
        type: "http",
        url: mcpUrl,
        headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` }
      }
    }
  };
  const file = path.join(dir, "mcp.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { env: {}, files: [file], mcpConfigPath: file };
}

export function buildInvocation({ binaryPath, question, workDir, prepared, env, secrets = [] }) {
  const args = [
    "-p",
    question,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    prepared.mcpConfigPath,
    "--strict-mcp-config",
    "--permission-mode",
    "bypassPermissions"
  ];
  assertNoSecretInArgv(args, secrets);
  return {
    command: binaryPath,
    args,
    cwd: workDir,
    env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "" }
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
    if (event.session_id) sessionId = event.session_id;
    if (event.model) model = String(event.model);
    if (event.type === "result" && event.result) finalAnswer = String(event.result);
    if (event.type === "assistant" && event.message?.content) {
      const text = event.message.content.map((c) => c.text ?? "").join("");
      if (text) finalAnswer = text;
    }
  }
  if (!finalAnswer) finalAnswer = String(stdout ?? "").trim();
  return { finalAnswer, model, sessionId, ok: exitCode === 0 && finalAnswer !== "" };
}
