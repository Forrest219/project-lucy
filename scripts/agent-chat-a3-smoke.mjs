#!/usr/bin/env node
/**
 * Optional Agent Chat (A3) packaging / live smoke.
 *
 * Default: static checks only (compose overlay, templates, gitignore).
 * --live: probe Hermes health + Open WebUI HTTP if endpoints reachable;
 *         missing stack => blocked (exit 2), never a headless P0 hard fail.
 *
 * See docs/design-lucy-agent-chat-a3.md and docs/runbook-lucy-agent-chat-a3.md.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = "inbox/agent-chat-a3-smoke-evidence.json";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    "hermes-health-url": { type: "string" },
    "open-webui-url": { type: "string" },
    "api-server-key": { type: "string" },
    out: { type: "string", short: "o", default: DEFAULT_OUT },
    "timeout-ms": { type: "string", default: "5000" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

if (values.help) {
  console.log(`Usage:
  npm run smoke:agent-chat:a3
  npm run smoke:agent-chat:a3 -- --live
  npm run smoke:agent-chat:a3 -- --live --hermes-health-url http://127.0.0.1:8642/health

Exit: 0 pass, 1 fail, 2 blocked (live stack missing / unreachable).
Does NOT belong in smoke:p0:headless-config.`);
  process.exit(0);
}

const outFile = path.resolve(ROOT, String(values.out ?? DEFAULT_OUT));
const timeoutMs = Number.parseInt(String(values["timeout-ms"] ?? "5000"), 10);
const live = Boolean(values.live);

const evidence = {
  contract: "agent-chat-a3-optional",
  gateKind: "optional-smoke",
  headlessHardGate: false,
  checkedAt: new Date().toISOString(),
  generatedBy: "scripts/agent-chat-a3-smoke.mjs",
  live,
  status: "fail",
  checks: {},
  notes: []
};

function record(name, ok, detail = {}) {
  evidence.checks[name] = { ok, ...detail };
  return ok;
}

async function exists(rel) {
  try {
    await access(path.join(ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

async function readText(rel) {
  return readFile(path.join(ROOT, rel), "utf8");
}

async function fetchText(url, { headers = {}, method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, signal: controller.signal });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function runStatic() {
  let ok = true;

  ok =
    record("composeOverlayExists", await exists("docker-compose.agent-chat.yml")) &&
    ok;
  ok = record("envExampleExists", await exists("agent-chat/.env.example")) && ok;
  ok =
    record("hermesConfigExampleExists", await exists("agent-chat/hermes-home.example/config.yaml")) &&
    ok;
  ok = record("agentChatGitignoreExists", await exists("agent-chat/.gitignore")) && ok;
  ok = record("runbookExists", await exists("docs/runbook-lucy-agent-chat-a3.md")) && ok;
  ok = record("designSpecExists", await exists("docs/design-lucy-agent-chat-a3.md")) && ok;

  if (await exists("docker-compose.agent-chat.yml")) {
    const compose = await readText("docker-compose.agent-chat.yml");
    ok =
      record("composeUsesAgentChatProfile", compose.includes('profiles: ["agent-chat"]'), {
        hint: "services must set profiles: [agent-chat]"
      }) && ok;
    ok =
      record("composeDoesNotPublishHermesPort", !compose.includes("8642:8642"), {
        hint: "8642 must not be published to the host"
      }) && ok;
    ok =
      record("composeDocumentsOptionalProfile", compose.includes("NOT part of default Lucy delivery") || compose.includes("Optional Agent Chat")) &&
      ok;
    if (await exists("docker-compose.yml")) {
      const main = await readText("docker-compose.yml");
      ok =
        record("defaultComposeHasNoAgentChat", !main.includes("open-webui") && !main.includes("lucy-agent-chat"), {
          hint: "docker-compose.yml must stay Lucy-only"
        }) && ok;
    }
  }

  if (await exists("agent-chat/hermes-home.example/config.yaml")) {
    const cfg = await readText("agent-chat/hermes-home.example/config.yaml");
    ok =
      record("hermesConfigHasMcpLucyOnlyApiServer", /platform_toolsets:[\s\S]*api_server:[\s\S]*mcp-lucy/.test(cfg), {
        hint: "api_server toolsets should list mcp-lucy"
      }) && ok;
    ok =
      record("hermesConfigOmitsTerminalBrowserToolsets", !/api_server:[\s\S]*\n\s*-\s*terminal\b/.test(cfg) && !/api_server:[\s\S]*\n\s*-\s*browser\b/.test(cfg), {
        hint: "api_server must not enable terminal/browser"
      }) && ok;
    ok =
      record("hermesConfigUsesEnvPlaceholdersForLucySecrets", cfg.includes("${LUCY_PUBLIC_MCP_URL}") && cfg.includes("${LUCY_AGENT_TOKEN}")) &&
      ok;
  }

  if (await exists("agent-chat/.gitignore")) {
    const gi = await readText("agent-chat/.gitignore");
    ok = record("gitignoreCoversEnv", gi.includes(".env")) && ok;
    ok = record("gitignoreCoversHermesHome", /hermes-home\/?/.test(gi)) && ok;
  }

  if (await exists("agent-chat/.env.example")) {
    const envEx = await readText("agent-chat/.env.example");
    ok =
      record("envExampleHasLayerKeys", envEx.includes("API_SERVER_KEY") && envEx.includes("LUCY_AGENT_TOKEN") && envEx.includes("LUCY_PUBLIC_MCP_URL")) &&
      ok;
    ok = record("envExampleModelName", envEx.includes("lucy-data-agent")) && ok;
  }

  return ok;
}

async function runLive() {
  const hermesUrl =
    (typeof values["hermes-health-url"] === "string" && values["hermes-health-url"].trim()) ||
    process.env.AGENT_CHAT_HERMES_HEALTH_URL ||
    "";
  const openWebuiUrl =
    (typeof values["open-webui-url"] === "string" && values["open-webui-url"].trim()) ||
    process.env.AGENT_CHAT_OPEN_WEBUI_URL ||
    "http://127.0.0.1:3000";
  const apiKey =
    (typeof values["api-server-key"] === "string" && values["api-server-key"].trim()) ||
    process.env.API_SERVER_KEY ||
    "";

  evidence.liveTargets = {
    hermesHealthUrl: hermesUrl || null,
    openWebuiUrl,
    apiServerKeyPresent: Boolean(apiKey)
  };

  // Hermes health is optional on host (port not published by default).
  if (!hermesUrl) {
    record("hermesHealth", false, {
      skipped: true,
      reason: "no --hermes-health-url / AGENT_CHAT_HERMES_HEALTH_URL (expected when 8642 is not published)"
    });
    evidence.notes.push("Hermes health skipped: API port is internal-only by design.");
  } else {
    try {
      const res = await fetchText(hermesUrl);
      record("hermesHealth", res.ok, { status: res.status, bodyPreview: res.body.slice(0, 200) });
    } catch (err) {
      record("hermesHealth", false, { error: String(err?.message || err) });
    }
  }

  try {
    const res = await fetchText(openWebuiUrl);
    record("openWebuiHttp", res.status > 0 && res.status < 500, {
      status: res.status,
      hint: "Open WebUI should respond on AGENT_CHAT_WEBUI_HOST_PORT"
    });
  } catch (err) {
    record("openWebuiHttp", false, { error: String(err?.message || err) });
  }

  if (hermesUrl && apiKey) {
    const modelsUrl = hermesUrl.replace(/\/health\/?$/, "/v1/models");
    try {
      const res = await fetchText(modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const hasLucyModel = /lucy-data-agent|hermes/i.test(res.body);
      record("hermesModels", res.ok && hasLucyModel, {
        status: res.status,
        bodyPreview: res.body.slice(0, 300)
      });
    } catch (err) {
      record("hermesModels", false, { error: String(err?.message || err) });
    }
  } else {
    record("hermesModels", false, {
      skipped: true,
      reason: "needs hermes health URL + API_SERVER_KEY for /v1/models"
    });
  }

  const liveChecks = ["openWebuiHttp", "hermesHealth", "hermesModels"];
  const relevant = liveChecks
    .map((k) => evidence.checks[k])
    .filter((c) => c && !c.skipped);
  if (relevant.length === 0) {
    return "blocked";
  }
  if (relevant.every((c) => c.ok)) {
    return "pass";
  }
  if (relevant.every((c) => !c.ok)) {
    return "blocked";
  }
  return relevant.some((c) => c.ok) && relevant.some((c) => !c.ok) ? "fail" : "blocked";
}

async function main() {
  const staticOk = await runStatic();
  let liveStatus = "skipped";
  if (live) {
    liveStatus = await runLive();
  }

  if (!staticOk) {
    evidence.status = "fail";
  } else if (live && liveStatus === "blocked") {
    evidence.status = "blocked";
    evidence.notes.push("Live stack unreachable or not started; packaging checks passed.");
  } else if (live && liveStatus === "fail") {
    evidence.status = "fail";
  } else {
    evidence.status = "pass";
  }

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: evidence.status, out: outFile, live }, null, 2));

  if (evidence.status === "pass") process.exit(0);
  if (evidence.status === "blocked") process.exit(2);
  process.exit(1);
}

main().catch(async (err) => {
  evidence.status = "fail";
  evidence.notes.push(String(err?.stack || err));
  try {
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
});
