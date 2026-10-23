// Codex CLI adapter (Spec R4 v4: automated required product; transport=cli).
// Native config: <workDir>/codex-home/config.toml with an MCP server that reads its Bearer token from an
// environment variable (bearer_token_env_var). Non-interactive run: `codex exec`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv, probeCli } from "./_contract.mjs";

export const product = "codex";
export const transport = "cli";
export const credentialEnv = ["OPENAI_API_KEY"];

export function probe({ env, spawnSync, locate }) {
  const result = probeCli({ names: ["codex"], credentialEnv, env, spawnSync, locate, accept: /codex/i });
  return { ...result, model: env.LUCY_E2E_CODEX_MODEL || "default" };
}

export function prepare({ workDir, mcpUrl }) {
  const home = path.join(workDir, "codex-home");
  mkdirSync(home, { recursive: true });
  const toml = [
    "# Generated for one E2E run. The Token is read from the environment, never stored here.",
    "[mcp_servers.lucy]",
    `url = ${JSON.stringify(mcpUrl)}`,
    `bearer_token_env_var = ${JSON.stringify(TOKEN_ENV)}`,
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 120",
    ""
  ].join("\n");
  writeFileSync(path.join(home, "config.toml"), toml);
  return { env: { CODEX_HOME: home }, files: [path.join(home, "config.toml")], lastMessageFile: path.join(workDir, "codex-last-message.txt") };
}

export function buildInvocation({ binaryPath, question, workDir, prepared, env, secrets = [] }) {
  const args = ["exec", "--skip-git-repo-check", "--json", "--sandbox", "read-only", "--cd", workDir, "--output-last-message", prepared.lastMessageFile, question];
  assertNoSecretInArgv(args, secrets);
  return {
    command: binaryPath,
    args,
    cwd: workDir,
    env: { ...prepared.env, CODEX_API_KEY: env.OPENAI_API_KEY ?? "", OPENAI_API_KEY: env.OPENAI_API_KEY ?? "" }
  };
}

export function parseResult({ stdout, exitCode, lastMessage }) {
  let sessionId = null;
  let model = "";
  let finalAnswer = (lastMessage ?? "").trim();
  for (const line of String(stdout ?? "").split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "thread.started") sessionId = event.thread_id ?? sessionId;
    if (event.model) model = String(event.model);
    if (!finalAnswer && event.type === "item.completed" && event.item?.type === "agent_message") finalAnswer = String(event.item.text ?? "");
  }
  return { finalAnswer, model, sessionId, ok: exitCode === 0 && finalAnswer !== "" };
}
