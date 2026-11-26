/**
 * access-write-window-stack.mjs — REQ-0117 隔离 compose 栈编排。
 *
 * 复用 `deploy/compose/docker-compose.demo.yml`（同镜像与初始化 bind），以独立
 * compose 项目名 `lucy-req0117-uat` 获得专用网络与卷；端口经 demo compose 既有
 * 环境变量覆盖，不与共享 demo / 既有 UAT 栈冲突。清理使用 `down -v` 删除专用卷。
 *
 * 命令：up（build + up -d + 等健康）、down（down -v）、status。
 * 凭据：bootstrap token 落 /private/tmp/lucy-req0117-private/（0700，不入库）。
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPOSE_FILE = path.join(ROOT, "deploy/compose/docker-compose.demo.yml");

export const STACK = {
  project: "lucy-req0117-uat",
  webuiPort: 55386,
  proxyPort: 57995,
  mysqlPort: 54326,
};

export const PRIVATE_DIR = process.env.REQ0117_PRIVATE_DIR
  ?? path.join(homedir(), "..", "private", "tmp", "lucy-req0117-private");
/** macOS /private/tmp；非 darwin 回退 /tmp。 */
export const SECRET_DIR = existsSync("/private/tmp") ? "/private/tmp/lucy-req0117-private" : "/tmp/lucy-req0117-private";

export const WEB = `http://127.0.0.1:${STACK.webuiPort}`;
export const MCP = `http://127.0.0.1:${STACK.proxyPort}/mcp`;

export function lucyContainer() {
  return `${STACK.project}-lucy-1`;
}

export function dbContainer() {
  return `${STACK.project}-demo-db-1`;
}

function ensureBootstrapSecret() {
  mkdirSync(SECRET_DIR, { recursive: true });
  chmodSync(SECRET_DIR, 0o700);
  const file = path.join(SECRET_DIR, "webui-bootstrap-token");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  return file;
}

function gitEnv() {
  try {
    const sha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 }).trim();
    const dirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8", timeout: 10_000 }).trim().length > 0;
    return { LUCY_GIT_SHA: sha, LUCY_GIT_DIRTY: dirty ? "1" : "0" };
  } catch {
    return {};
  }
}

function composeEnv() {
  return {
    ...process.env,
    ...gitEnv(),
    LUCY_DEMO_WEBUI_HOST_PORT: String(STACK.webuiPort),
    LUCY_DEMO_PROXY_HOST_PORT: String(STACK.proxyPort),
    LUCY_DEMO_MYSQL_HOST_PORT: String(STACK.mysqlPort),
    LUCY_PUBLIC_MCP_URL: MCP,
    LUCY_DEMO_SECRET_DIR: SECRET_DIR,
  };
}

export function compose(args, opts = {}) {
  return execFileSync("docker", ["compose", "-p", STACK.project, "-f", COMPOSE_FILE, ...args], {
    cwd: ROOT,
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    env: composeEnv(),
    timeout: opts.timeoutMs ?? 900_000,
  });
}

export function stackRunning() {
  try {
    const out = compose(["ps", "--format", "json", "lucy"], { capture: true, timeoutMs: 60_000 }).toString();
    const lines = out.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.State === "running") return true;
      } catch { /* 多行 JSON 忽略 */ }
    }
  } catch { /* 未启动 */ }
  return false;
}

async function waitHealthy(timeoutMs = 300_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${WEB}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const body = await res.json();
        if (body?.ok) return { ms: Date.now() - started };
      }
    } catch { /* 未就绪 */ }
    if (Date.now() - started > timeoutMs) throw new Error(`lucy 未在 ${timeoutMs}ms 内健康`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function main() {
  const command = process.argv[2] ?? "up";
  if (command === "up") {
    ensureBootstrapSecret();
    compose(["build"], { timeoutMs: 1_800_000 });
    compose(["up", "-d", "--force-recreate"], { timeoutMs: 600_000 });
    const health = await waitHealthy();
    console.log(`[req0117-stack] healthy in ${health.ms}ms webui=${WEB}`);
    console.log(JSON.stringify({ project: STACK.project, webui: WEB, mcp: MCP, secretDir: SECRET_DIR, lucyContainer: lucyContainer(), dbContainer: dbContainer() }));
    return;
  }
  if (command === "build") {
    compose(["build"], { timeoutMs: 1_800_000 });
    return;
  }
  if (command === "down") {
    try { compose(["down", "-v", "--remove-orphans"], { timeoutMs: 300_000 }); } catch { /* 已不存在 */ }
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify({ running: stackRunning(), project: STACK.project, webui: WEB, mcp: MCP, secretDir: SECRET_DIR }));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
