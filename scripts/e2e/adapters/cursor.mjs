// Cursor Agent GUI adapter (Spec R4/R7 revision 2026-10-18: required product; transport=gui).
// Drives the Agent panel inside Cursor.app (not the separate Cursor Agent CLI `agent` / `cursor-agent`).
// Native config: project `.cursor/mcp.json` with Authorization via environment variable NAME only.
// Model auth is the in-app Cursor login. GUI automation is not wired yet: probe reports BLOCKED with
// gui_driver_not_implemented until a reviewed driver can open Agent, import MCP config, ask, and capture the answer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv } from "./_contract.mjs";

export const product = "cursor";
export const transport = "gui";
export const credentialEnv = [];

const DEFAULT_APP = "/Applications/Cursor.app";

function readAppVersion(appRoot) {
  const plist = path.join(appRoot, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const text = readFileSync(plist, "utf8");
  const match = text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  return match ? match[1].trim() : null;
}

export function probe({ env }) {
  const appRoot = env.LUCY_E2E_CURSOR_APP || DEFAULT_APP;
  const reasons = [];
  let binaryPath = null;
  let version = null;
  if (!existsSync(appRoot)) {
    reasons.push(`app_not_found: ${appRoot}`);
  } else {
    binaryPath = path.join(appRoot, "Contents", "MacOS", "Cursor");
    if (!existsSync(binaryPath)) binaryPath = appRoot;
    version = readAppVersion(appRoot) ?? "cursor-app";
    reasons.push(
      "gui_driver_not_implemented: Cursor Agent required path is the in-app Agent GUI; no reviewed driver is wired yet (Computer Use / AppleScript). Cursor Agent CLI is out of the first-release denominator."
    );
  }
  return {
    status: "blocked",
    reasons,
    binaryPath,
    version,
    model: env.LUCY_E2E_CURSOR_MODEL || "in-app"
  };
}

export function prepare({ workDir, mcpUrl }) {
  const dir = path.join(workDir, ".cursor");
  mkdirSync(dir, { recursive: true });
  const config = { mcpServers: { lucy: { url: mcpUrl, headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` } } } };
  const file = path.join(dir, "mcp.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { env: {}, files: [file], lastMessageFile: path.join(workDir, "cursor-last-message.txt") };
}

export function buildInvocation({ binaryPath, question, workDir, prepared, secrets = [] }) {
  const args = ["--lucy-e2e-cursor-agent-gui-stub", "--cd", workDir, "--mcp-config", prepared.files[0], "--question", question];
  assertNoSecretInArgv(args, secrets);
  return {
    command: binaryPath || "/usr/bin/false",
    args,
    cwd: workDir,
    env: { ...prepared.env }
  };
}

export function parseResult({ stdout, exitCode, lastMessage }) {
  const finalAnswer = String(lastMessage ?? stdout ?? "").trim();
  return {
    finalAnswer,
    model: "in-app",
    sessionId: null,
    ok: exitCode === 0 && finalAnswer !== ""
  };
}
