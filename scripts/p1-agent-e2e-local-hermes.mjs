#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_OUT = "inbox/p1-agent-e2e-hermes-moz-evidence.json";
const DEFAULT_ARTIFACTS = "inbox/p1-agent-e2e-artifacts";
const DEFAULT_HTML_REPORT = "inbox/p1-agent-e2e-hermes-moz-report.html";
const DEFAULT_ACCESS_OUT = "inbox/p1-agent-e2e-local-access.yaml";
const DEFAULT_WRAPPER_OUT = "inbox/p1-agent-e2e-local-hermes-run.json";
const DEFAULT_WEBUI_LOG = "inbox/p1-agent-e2e-local-webui.log";
const DEFAULT_PROXY_URL = "http://127.0.0.1:7879/mcp";
const WEBUI_HEALTH_URL = "http://127.0.0.1:5174/api/health";
const HERMES_BIN = "/Users/forrest/.local/bin/hermes";
const HERMES_WORKHORSE_HOME = "/Users/forrest/.hermes/profiles/workhorse";
const HERMES_MOZ_HOME = "/Users/forrest/.hermes/profiles/moz";

const EXIT_CODES = {
  pass: 0,
  fail: 1,
  usage: 2,
  blocked: 42
};

const USAGE = `Usage:
  npm run e2e:agent:local-hermes
  npm run smoke:p1:agent-e2e:local-hermes
  node scripts/p1-agent-e2e-local-hermes.mjs --replace-existing

Options:
  --out <path>               E2E evidence path. Defaults to ${DEFAULT_OUT}.
  --artifacts <dir>          Redacted artifact dir. Defaults to ${DEFAULT_ARTIFACTS}.
  --html-report <path>       Human-readable HTML report path. Defaults to ${DEFAULT_HTML_REPORT}.
  --access-out <path>        Ignored temporary access config path. Defaults to ${DEFAULT_ACCESS_OUT}.
  --wrapper-out <path>       Harness evidence path. Defaults to ${DEFAULT_WRAPPER_OUT}.
  --webui-log <path>         WebUI server log path. Defaults to ${DEFAULT_WEBUI_LOG}.
  --agent-timeout-ms <n>     Agent subprocess timeout. Defaults to 900000.
  --startup-timeout-ms <n>   WebUI/proxy startup timeout. Defaults to 60000.
  --replace-existing         Stop listeners on 5174/7878/7879 before starting local services.
  --keep-services            Leave services started by this harness running after the E2E run.
  --dry-run                  Validate local files and write temporary config, but do not start services or agents.
  --help                     Show this help.

This harness generates one-run tokens in memory, writes only their hashes to an ignored access config,
starts KTX MCP and Lucy WebUI/proxy with LUCY_ACCESS_CONFIG_PATH, then runs real Hermes workhorse
and moz E2E. The smoke:* command name is a compatibility alias; this harness is a real-agent E2E gate.`;

function parseArgs(argv = process.argv) {
  const args = {
    out: DEFAULT_OUT,
    artifacts: DEFAULT_ARTIFACTS,
    htmlReport: DEFAULT_HTML_REPORT,
    accessOut: DEFAULT_ACCESS_OUT,
    wrapperOut: DEFAULT_WRAPPER_OUT,
    webuiLog: DEFAULT_WEBUI_LOG,
    agentTimeoutMs: 900_000,
    startupTimeoutMs: 60_000,
    replaceExisting: false,
    keepServices: false,
    dryRun: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--out":
        args.out = requiredValue(argv, ++i, "--out");
        break;
      case "--artifacts":
        args.artifacts = requiredValue(argv, ++i, "--artifacts");
        break;
      case "--html-report":
        args.htmlReport = requiredValue(argv, ++i, "--html-report");
        break;
      case "--access-out":
        args.accessOut = requiredValue(argv, ++i, "--access-out");
        break;
      case "--wrapper-out":
        args.wrapperOut = requiredValue(argv, ++i, "--wrapper-out");
        break;
      case "--webui-log":
        args.webuiLog = requiredValue(argv, ++i, "--webui-log");
        break;
      case "--agent-timeout-ms":
        args.agentTimeoutMs = parsePositiveInt(requiredValue(argv, ++i, "--agent-timeout-ms"), "--agent-timeout-ms");
        break;
      case "--startup-timeout-ms":
        args.startupTimeoutMs = parsePositiveInt(requiredValue(argv, ++i, "--startup-timeout-ms"), "--startup-timeout-ms");
        break;
      case "--replace-existing":
        args.replaceExisting = true;
        break;
      case "--keep-services":
        args.keepServices = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  return args;
}

function requiredValue(argv, index, label) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${label} requires a value`);
  return value;
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function ensureDirFor(filePath) {
  mkdirSync(dirname(resolve(REPO_ROOT, filePath)), { recursive: true });
}

function tokenHash(token) {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function createRuntimeTokens() {
  const hermesToken = `lucy_e2e_hermes_${randomBytes(32).toString("base64url")}`;
  const mozToken = `lucy_e2e_moz_${randomBytes(32).toString("base64url")}`;
  return {
    hermesToken,
    mozToken,
    hermesHash: tokenHash(hermesToken),
    mozHash: tokenHash(mozToken)
  };
}

function stripRuntimeTokens(tokens = []) {
  return tokens.filter((token) => !String(token?.label || "").startsWith("lucy-e2e-"));
}

function upsertRuntimeUser(config, user) {
  if (!Array.isArray(config.users)) config.users = [];
  const existing = config.users.find((item) => item?.id === user.id);
  if (!existing) {
    config.users.push(user);
    return;
  }
  existing.name = existing.name || user.name;
  existing.enabled = true;
  existing.note = user.note;
  existing.tokens = user.tokens;
  existing.role = user.role;
}

function buildTemporaryAccessConfig(rawYaml, { hermesHash, mozHash, created = new Date().toISOString().slice(0, 10) }) {
  const config = parseYaml(rawYaml);
  if (!config || typeof config !== "object") throw new Error("access config must be a YAML object");
  if (!Array.isArray(config.users)) throw new Error("access config must contain users[]");

  const workhorse = config.users.find((user) => user?.id === "workhorse");
  if (!workhorse) throw new Error("access config must contain workhorse user");
  workhorse.enabled = true;
  workhorse.role = "kx_readonly";
  workhorse.tokens = [
    ...stripRuntimeTokens(workhorse.tokens || []),
    { hash: hermesHash, label: "lucy-e2e-workhorse-runtime", created }
  ];

  upsertRuntimeUser(config, {
    id: "moz",
    name: "Hermes Moz",
    enabled: true,
    note: "Local runtime-only Hermes moz profile E2E token; generated by scripts/p1-agent-e2e-local-hermes.mjs.",
    tokens: [{ hash: mozHash, label: "lucy-e2e-moz-runtime", created }],
    role: "kx_readonly"
  });

  const moz = config.users.find((user) => user?.id === "moz");
  if (moz) {
    moz.tokens = [
      ...stripRuntimeTokens(moz.tokens || []),
      { hash: mozHash, label: "lucy-e2e-moz-runtime", created }
    ];
    moz.enabled = true;
    moz.role = "kx_readonly";
  }

  return `${stringifyYaml(config)}\n`;
}

function writeTemporaryAccessConfig({ accessOut, tokens }) {
  const sourcePath = resolve(REPO_ROOT, "webui/config/access.yaml");
  const targetPath = resolve(REPO_ROOT, accessOut);
  const raw = readFileSync(sourcePath, "utf8");
  const yaml = buildTemporaryAccessConfig(raw, tokens);
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, yaml, { encoding: "utf8", mode: 0o600 });
  chmodSync(targetPath, 0o600);
  return targetPath;
}

function localAgentCommands() {
  return {
    hermes: [
      "env",
      `HERMES_HOME=${HERMES_WORKHORSE_HOME}`,
      HERMES_BIN,
      "chat",
      "-q",
      "{prompt}",
      "--quiet",
      "--source",
      "lucy-e2e-workhorse",
      "--accept-hooks",
      "--max-turns",
      "45"
    ],
    moz: [
      "env",
      `HERMES_HOME=${HERMES_MOZ_HOME}`,
      HERMES_BIN,
      "chat",
      "-q",
      "{prompt}",
      "--quiet",
      "--source",
      "lucy-e2e-moz",
      "--accept-hooks",
      "--max-turns",
      "45"
    ]
  };
}

function redactText(value, knownTokens = []) {
  let text = String(value ?? "");
  for (const token of knownTokens.filter(Boolean)) {
    text = text.split(token).join("[REDACTED]");
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/(token|password|secret|api[_-]?key)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/\.ktx\/secrets\/[^\s"'`]+/g, ".ktx/secrets/[REDACTED]");
}

function redactValue(value, knownTokens = [], depth = 0) {
  if (depth > 10) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactText(value, knownTokens);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, knownTokens, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/authorization|token|password|secret|api[_-]?key/i.test(key)) {
      out[key] = item ? "[REDACTED]" : item;
    } else {
      out[key] = redactValue(item, knownTokens, depth + 1);
    }
  }
  return out;
}

function tail(value, max = 6000) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(text.length - max) : text;
}

function pidsForPort(port) {
  const result = spawnSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (result.status !== 0 && !result.stdout.trim()) return [];
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

function isPortListening(port) {
  return pidsForPort(port).length > 0;
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function stopPorts(ports) {
  const pids = Array.from(new Set(ports.flatMap((port) => pidsForPort(port))));
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Process may have exited between lsof and kill.
    }
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && ports.some(isPortListening)) await sleep(250);
  for (const pid of Array.from(new Set(ports.flatMap((port) => pidsForPort(port))))) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // Process may have exited after the final lsof check.
    }
  }
}

function runSync(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    env: options.env ?? process.env
  });
}

function assertHermesProfileEnvRefs() {
  const checks = [
    { profile: "workhorse", home: HERMES_WORKHORSE_HOME, envName: "LUCY_E2E_HERMES_TOKEN" },
    { profile: "moz", home: HERMES_MOZ_HOME, envName: "LUCY_E2E_MOZ_TOKEN" }
  ];
  return checks.map((check) => {
    const configPath = resolve(check.home, "config.yaml");
    if (!existsSync(configPath)) {
      return { ...check, status: "blocked", reason: "missing_profile_config", configPath };
    }
    const content = readFileSync(configPath, "utf8");
    if (!content.includes(`\${${check.envName}}`)) {
      return { ...check, status: "blocked", reason: "profile_not_using_env_token", configPath };
    }
    return { ...check, status: "pass", configPath };
  });
}

async function waitForWebui(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`webui server exited before readiness with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(WEBUI_HEALTH_URL);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await sleep(500);
  }
  throw new Error(`webui did not become ready at ${WEBUI_HEALTH_URL}`);
}

async function startKtxIfNeeded({ replaceExisting }) {
  if (isPortListening(7878)) {
    if (!replaceExisting) return { started: false, reused: true };
    const stop = runSync("ktx", ["mcp", "stop", "--project-dir", REPO_ROOT], { timeout: 30_000 });
    if (isPortListening(7878)) await stopPorts([7878]);
    if (isPortListening(7878)) {
      return {
        started: false,
        reused: false,
        blocked: true,
        message: stop.stderr || stop.stdout || "failed to stop existing listener on 7878"
      };
    }
  }
  const start = runSync("ktx", ["mcp", "start", "--project-dir", REPO_ROOT], { timeout: 45_000 });
  if (start.status !== 0) {
    return { started: false, reused: false, blocked: true, message: start.stderr || start.stdout || "failed to start KTX MCP" };
  }
  return { started: true, reused: false };
}

function stopKtx() {
  runSync("ktx", ["mcp", "stop", "--project-dir", REPO_ROOT], { timeout: 30_000 });
}

async function startWebui({ accessPath, logPath, replaceExisting, startupTimeoutMs }) {
  if ([5174, 7879].some(isPortListening)) {
    if (!replaceExisting) {
      throw new Error("ports 5174/7879 already have listeners; rerun with --replace-existing or stop old services");
    }
    await stopPorts([5174, 7879]);
  }
  mkdirSync(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "w" });
  const env = {
    ...process.env,
    LUCY_ACCESS_CONFIG_PATH: accessPath,
    KTX_PROJECT_ROOT: REPO_ROOT
  };
  const child = spawn("npm", ["--prefix", "webui", "run", "start"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitForWebui(child, startupTimeoutMs);
  return { child, log };
}

function stopChild(child) {
  return new Promise((resolveStop) => {
    if (!child || child.exitCode != null) {
      resolveStop();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Child may have already exited.
      }
    }, 10_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

function runCapture(command, args, { env, timeoutMs }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ code: EXIT_CODES.usage, signal: null, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

function writeWrapperEvidence(pathValue, evidence, knownTokens = []) {
  const abs = resolve(REPO_ROOT, pathValue);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(redactValue(evidence, knownTokens), null, 2)}\n`, "utf8");
  return abs;
}

async function runLocalHermesE2E({ args, env = process.env } = {}) {
  const startedAt = new Date().toISOString();
  const tokens = createRuntimeTokens();
  const accessPath = writeTemporaryAccessConfig({ accessOut: args.accessOut, tokens });
  const profileChecks = assertHermesProfileEnvRefs();
  const wrapper = {
    generatedAt: startedAt,
    generatedBy: "scripts/p1-agent-e2e-local-hermes.mjs",
    contract: "p1-agent-database-e2e-local-hermes",
    status: "running",
    config: {
      out: args.out,
      artifacts: args.artifacts,
      htmlReport: args.htmlReport,
      accessConfig: accessPath,
      wrapperOut: resolve(REPO_ROOT, args.wrapperOut),
      webuiLog: resolve(REPO_ROOT, args.webuiLog),
      proxyUrl: DEFAULT_PROXY_URL,
      profiles: ["hermes", "moz"],
      gateKind: "e2e",
      agentRuntime: "hermes",
      runtimeProfiles: [
        { id: "hermes", hermesHome: HERMES_WORKHORSE_HOME },
        { id: "moz", hermesHome: HERMES_MOZ_HOME }
      ],
      stub: false,
      replaceExisting: args.replaceExisting,
      keepServices: args.keepServices,
      dryRun: args.dryRun
    },
    precheck: profileChecks,
    services: {},
    runner: {}
  };

  if (profileChecks.some((check) => check.status === "blocked")) {
    wrapper.status = "blocked";
    wrapper.exitCode = EXIT_CODES.blocked;
    wrapper.finishedAt = new Date().toISOString();
    return { wrapper, exitCode: wrapper.exitCode, knownTokens: [tokens.hermesToken, tokens.mozToken] };
  }

  if (args.dryRun) {
    wrapper.status = "pass";
    wrapper.exitCode = EXIT_CODES.pass;
    wrapper.finishedAt = new Date().toISOString();
    return { wrapper, exitCode: wrapper.exitCode, knownTokens: [tokens.hermesToken, tokens.mozToken] };
  }

  let webui;
  let ktxStarted = false;
  try {
    const ktx = await startKtxIfNeeded({ replaceExisting: args.replaceExisting });
    wrapper.services.ktx = ktx;
    if (ktx.blocked) {
      wrapper.status = "blocked";
      wrapper.exitCode = EXIT_CODES.blocked;
      return { wrapper, exitCode: wrapper.exitCode, knownTokens: [tokens.hermesToken, tokens.mozToken] };
    }
    ktxStarted = Boolean(ktx.started);

    webui = await startWebui({
      accessPath,
      logPath: resolve(REPO_ROOT, args.webuiLog),
      replaceExisting: args.replaceExisting,
      startupTimeoutMs: args.startupTimeoutMs
    });
    wrapper.services.webui = { started: true, healthUrl: WEBUI_HEALTH_URL };

    const childEnv = {
      ...env,
      LUCY_ACCESS_CONFIG_PATH: accessPath,
      LUCY_E2E_PROXY_URL: DEFAULT_PROXY_URL,
      LUCY_E2E_HERMES_TOKEN: tokens.hermesToken,
      LUCY_E2E_MOZ_TOKEN: tokens.mozToken,
      LUCY_E2E_MOZ_EXPECTED_ROLE: "kx_readonly",
      LUCY_E2E_AGENT_RUNTIME: "hermes-local-real",
      LUCY_E2E_STUB: "false",
      LUCY_E2E_AGENT_COMMANDS: JSON.stringify(localAgentCommands())
    };
    const result = await runCapture(process.execPath, [
      "scripts/p1-agent-e2e.mjs",
      "--profile", "hermes",
      "--profile", "moz",
      "--proxy-url", DEFAULT_PROXY_URL,
      "--out", args.out,
      "--artifacts", args.artifacts,
      "--html-report", args.htmlReport,
      "--agent-timeout-ms", String(args.agentTimeoutMs)
    ], {
      env: childEnv,
      timeoutMs: args.agentTimeoutMs * 2
    });
    wrapper.runner = {
      command: "npm run e2e:agent -- --profile hermes --profile moz",
      exitCode: result.code,
      signal: result.signal,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr)
    };
    wrapper.status = result.code === 0 ? "pass" : result.code === EXIT_CODES.blocked ? "blocked" : "fail";
    wrapper.exitCode = result.code ?? EXIT_CODES.fail;
    return { wrapper, exitCode: wrapper.exitCode, knownTokens: [tokens.hermesToken, tokens.mozToken] };
  } catch (error) {
    wrapper.status = /already have listeners|did not become ready|failed to start|failed to stop/.test(error.message)
      ? "blocked"
      : "fail";
    wrapper.error = error.stack || error.message;
    wrapper.exitCode = wrapper.status === "blocked" ? EXIT_CODES.blocked : EXIT_CODES.fail;
    return { wrapper, exitCode: wrapper.exitCode, knownTokens: [tokens.hermesToken, tokens.mozToken] };
  } finally {
    if (!args.keepServices) {
      await stopChild(webui?.child);
      webui?.log?.end();
      if (ktxStarted) stopKtx();
    }
    wrapper.finishedAt = new Date().toISOString();
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(`error: ${error.message}\n\n${USAGE}`);
    process.exit(EXIT_CODES.usage);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { wrapper, exitCode, knownTokens } = await runLocalHermesE2E({ args });
  const wrapperPath = writeWrapperEvidence(args.wrapperOut, wrapper, knownTokens);
  console.error(`[p1-agent-e2e-local-hermes] wrote wrapper evidence: ${wrapperPath}`);
  console.error(`[p1-agent-e2e-local-hermes] ${wrapper.status.toUpperCase()}`);
  process.exit(exitCode);
}

export {
  EXIT_CODES,
  buildTemporaryAccessConfig,
  localAgentCommands,
  parseArgs,
  redactText,
  runLocalHermesE2E,
  stripRuntimeTokens,
  tokenHash
};

if (process.argv[1] === __filename) {
  main();
}
