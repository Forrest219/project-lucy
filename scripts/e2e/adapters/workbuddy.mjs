// WorkBuddy desktop adapter (Spec R4/R7 v3 2026-10-18: required product with Cursor Agent GUI; transport=gui).
// Native config shape matches ~/.workbuddy/mcp.json: mcpServers.<name>.{type,url,headers.Authorization}.
// The Lucy Token appears only as an environment variable NAME in the generated file; model auth is the
// in-app WorkBuddy login (no separate API key env required for the probe).
// GUI automation is not wired yet: probe reports BLOCKED with gui_driver_not_implemented until a reviewed
// driver (Computer Use / AppleScript) can open WorkBuddy, import the run MCP config, ask, and capture the answer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_ENV, assertNoSecretInArgv } from "./_contract.mjs";

export const product = "workbuddy";
export const transport = "gui";
export const credentialEnv = [];

const DEFAULT_APP = "/Applications/WorkBuddy.app";

function readAppVersion(appRoot) {
  const plist = path.join(appRoot, "Contents", "Info.plist");
  if (!existsSync(plist)) return null;
  const text = readFileSync(plist, "utf8");
  const match = text.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  return match ? match[1].trim() : null;
}

export function probe({ env }) {
  const appRoot = env.LUCY_E2E_WORKBUDDY_APP || DEFAULT_APP;
  const reasons = [];
  let binaryPath = null;
  let version = null;
  if (!existsSync(appRoot)) {
    reasons.push(`app_not_found: ${appRoot}`);
  } else {
    binaryPath = path.join(appRoot, "Contents", "MacOS", "Electron");
    if (!existsSync(binaryPath)) binaryPath = appRoot;
    version = readAppVersion(appRoot) ?? "workbuddy-app";
    reasons.push(
      "gui_driver_not_implemented: WorkBuddy required path is desktop GUI automation; no reviewed driver is wired yet (Computer Use / AppleScript)"
    );
  }
  return {
    status: "blocked",
    reasons,
    binaryPath,
    version,
    model: env.LUCY_E2E_WORKBUDDY_MODEL || "in-app"
  };
}

export function prepare({ workDir, mcpUrl }) {
  const home = path.join(workDir, "workbuddy-home");
  mkdirSync(home, { recursive: true });
  const config = {
    mcpServers: {
      lucy: {
        type: "http",
        url: mcpUrl,
        headers: {
          Authorization: `Bearer \${env:${TOKEN_ENV}}`
        }
      }
    }
  };
  const file = path.join(home, "mcp.json");
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { env: { WORKBUDDY_HOME: home }, files: [file], lastMessageFile: path.join(workDir, "workbuddy-last-message.txt") };
}

export function buildInvocation({ binaryPath, question, workDir, prepared, secrets = [] }) {
  // Placeholder until a GUI driver exists. Never put the Token or question gold on argv beyond the prompt text.
  const args = ["--lucy-e2e-workbuddy-gui-stub", "--cd", workDir, "--mcp-config", prepared.files[0], "--question", question];
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
