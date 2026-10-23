// Cursor Agent CLI adapter (optional after R4 revision 2026-10-18 afternoon: required path is Cursor Agent GUI).
// Binary: `agent` (primary) or `cursor-agent` (alias) when that executable identifies itself as Cursor.
// Kept for local/CI experiments; not part of the first-release denominator.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv, probeCli } from "./_contract.mjs";

export const product = "cursor-cli";
export const transport = "cli";
export const credentialEnv = ["CURSOR_API_KEY"];

export function probe({ env, spawnSync, locate }) {
  const result = probeCli({ names: ["cursor-agent", "agent"], credentialEnv, env, spawnSync, locate, accept: /cursor|^\d{4}\.\d{2}\.\d{2}/i });
  return { ...result, model: env.LUCY_E2E_CURSOR_MODEL || "default" };
}

export function prepare({ workDir, mcpUrl }) {
  const dir = path.join(workDir, ".cursor");
  mkdirSync(dir, { recursive: true });
  const config = { mcpServers: { lucy: { url: mcpUrl, headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` } } } };
  writeFileSync(path.join(dir, "mcp.json"), `${JSON.stringify(config, null, 2)}\n`);
  return { env: {}, files: [path.join(dir, "mcp.json")] };
}

export function buildInvocation({ binaryPath, question, workDir, env, secrets = [] }) {
  const args = ["-p", "--output-format", "json", "--force", "--approve-mcps", question];
  assertNoSecretInArgv(args, secrets);
  return { command: binaryPath, args, cwd: workDir, env: { CURSOR_API_KEY: env.CURSOR_API_KEY ?? "" } };
}

export function parseResult({ stdout, exitCode }) {
  let payload = null;
  const text = String(stdout ?? "").trim();
  try {
    payload = JSON.parse(text);
  } catch {
    for (const line of text.split("\n").reverse()) {
      try {
        payload = JSON.parse(line);
        break;
      } catch {
        // keep scanning
      }
    }
  }
  const finalAnswer = String(payload?.result ?? payload?.text ?? "").trim();
  return { finalAnswer, model: String(payload?.model ?? ""), sessionId: payload?.session_id ?? null, ok: exitCode === 0 && finalAnswer !== "" && payload?.is_error !== true };
}
