/**
 * mcp-inquiry-performance-docker.mjs — P1-78 Task 5 隔离 Docker 栈编排。
 *
 * 复用 `deploy/compose/docker-compose.demo.yml`（同一镜像与初始化 bind），以
 * 独立 compose 项目名获得专用网络与卷；端口经 demo compose 既有环境变量
 * 覆盖，避免与本机 demo 栈冲突。清理使用 `down -v` 删除专用卷。
 *
 * 容器名遵循 compose v2 默认规则 `<project>-<service>-1`，与既有 UAT seed
 * 脚本的 `UAT_LUCY_CONTAINER`／`UAT_DEMO_DB_CONTAINER` 约定对接。
 */
import { execFileSync } from "node:child_process";

const COMPOSE_FILE = new URL("../../../deploy/compose/docker-compose.demo.yml", import.meta.url).pathname;

export const DEFAULT_STACK = {
  project: "lucy-mip-uat",
  webuiPort: 55276,
  proxyPort: 57981,
  mysqlPort: 54306,
};

function composeEnv(stack) {
  return {
    ...process.env,
    LUCY_DEMO_WEBUI_HOST_PORT: String(stack.webuiPort),
    LUCY_DEMO_PROXY_HOST_PORT: String(stack.proxyPort),
    LUCY_DEMO_MYSQL_HOST_PORT: String(stack.mysqlPort),
    LUCY_PUBLIC_MCP_URL: `http://127.0.0.1:${stack.proxyPort}/mcp`,
  };
}

function compose(stack, args, opts = {}) {
  return execFileSync("docker", ["compose", "-p", stack.project, "-f", COMPOSE_FILE, ...args], {
    stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
    env: composeEnv(stack),
    timeout: opts.timeoutMs ?? 600_000,
    ...(opts.capture ? {} : {}),
  });
}

export function lucyContainer(stack) {
  return `${stack.project}-lucy-1`;
}

export function dbContainer(stack) {
  return `${stack.project}-demo-db-1`;
}

export function seedEnv(stack, extra = {}) {
  return {
    ...process.env,
    UAT_LUCY_CONTAINER: lucyContainer(stack),
    UAT_DEMO_DB_CONTAINER: dbContainer(stack),
    COMPOSE_PROJECT_NAME: stack.project,
    LUCY_DEMO_WEBUI_HOST_PORT: String(stack.webuiPort),
    LUCY_DEMO_PROXY_HOST_PORT: String(stack.proxyPort),
    LUCY_PUBLIC_MCP_URL: `http://127.0.0.1:${stack.proxyPort}/mcp`,
    ...extra,
  };
}

export function stackRunning(stack) {
  try {
    const out = execFileSync(
      "docker",
      ["compose", "-p", stack.project, "-f", COMPOSE_FILE, "ps", "--format", "json", "lucy"],
      { stdio: ["pipe", "pipe", "pipe"], env: composeEnv(stack), timeout: 60_000 },
    ).toString();
    const lines = out.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ps = JSON.parse(line);
        if (ps.State === "running" || ps.Status?.includes("Up")) return true;
      } catch { /* ignore parse noise */ }
    }
    return false;
  } catch {
    return false;
  }
}

export function startStack(stack, log = () => {}) {
  log(`[mip-docker] 启动隔离栈 ${stack.project}（webui:${stack.webuiPort} proxy:${stack.proxyPort} mysql:${stack.mysqlPort}）`);
  compose(stack, ["up", "-d", "demo-db", "lucy"]);
}

/** 等待 WebUI /api/health 报告 gitSha（与既有 seed 脚本同判据）。 */
export async function waitHealthy(stack, { timeoutMs = 300_000, log = () => {} } = {}) {
  const url = `http://127.0.0.1:${stack.webuiPort}/api/health`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      if (res.ok && (text.includes("gitSha") || text.includes("\"ok\""))) {
        log(`[mip-docker] 健康检查通过 ${url}`);
        return;
      }
    } catch { /* retry */ }
    if (Date.now() >= deadline) throw new Error(`隔离栈健康检查超时：${url}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

/** down -v：删除专用网络与卷（夹具随卷销毁）。 */
export function stopStack(stack, log = () => {}) {
  log(`[mip-docker] 清理隔离栈 ${stack.project}（down -v）`);
  compose(stack, ["down", "-v", "--remove-orphans"]);
}
