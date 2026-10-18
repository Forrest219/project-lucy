// OpenClaw CLI adapter (Spec R4 v4: automated required product; transport=cli).
// Binary: `openclaw`. MCP config is written as mcp.json; flags follow the eval preset (`openclaw agent -m`).
// Probe reports BLOCKED when the binary is missing. OPENCLAW_API_KEY is required only when the binary demands it.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv, probeCli } from "./_contract.mjs";

export const product = "openclaw";
export const transport = "cli";
export const credentialEnv = ["OPENCLAW_API_KEY"];

export function probe({ env, spawnSync, locate }) {
  // Prefer binary presence; treat API key as optional unless the product starts requiring it.
  const result = probeCli({ names: ["openclaw"], credentialEnv: [], env, spawnSync, locate, accept: /openclaw/i });
  return { ...result, model: env.LUCY_E2E_OPENCLAW_MODEL || "default" };
}

export function prepare({ workDir, mcpUrl }) {
  const dir = path.join(workDir, "openclaw-home");
  mkdirSync(dir, { recursive: true });
  const config = {
    mcpServers: {
      lucy: {
        url: mcpUrl,
        headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` }
      }
    }
  };
  const file = path.join(dir, "mcp.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { env: { OPENCLAW_HOME: dir }, files: [file], mcpConfigPath: file };
}

export function buildInvocation({ binaryPath, question, workDir, prepared, env, secrets = [] }) {
  const args = ["agent", "-m", question, "--mcp-config", prepared.mcpConfigPath];
  assertNoSecretInArgv(args, secrets);
  return {
    command: binaryPath,
    args,
    cwd: workDir,
    env: { ...prepared.env, OPENCLAW_API_KEY: env.OPENCLAW_API_KEY ?? "" }
  };
}

export function parseResult({ stdout, exitCode }) {
  const text = String(stdout ?? "").trim();
  let finalAnswer = text;
  let sessionId = null;
  let model = "";
  try {
    const payload = JSON.parse(text);
    finalAnswer = String(payload.result ?? payload.text ?? payload.message ?? text);
    sessionId = payload.session_id ?? payload.sessionId ?? null;
    model = String(payload.model ?? "");
  } catch {
    // plain text output is acceptable for this CLI
  }
  return { finalAnswer, model, sessionId, ok: exitCode === 0 && finalAnswer !== "" };
}
