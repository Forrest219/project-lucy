import { execFile, type ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { KtxCliError } from "./ktx.js";
import { resetExecutionRuntimeProbeForTests } from "./admin/mcp-runtime.js";
import { acquireMcpReloadWindow, awaitReloadDeadline, remainingReloadMs } from "./runtime/mcp-process-work.js";

type ExecFileImpl = typeof execFile;

export type KtxMcpReloadResult = {
  status: "reloaded" | "started" | "skipped" | "failed";
  detail: string;
};

export type ReloadKtxMcpOptions = {
  execFileImpl?: ExecFileImpl;
  waitForReady?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  timeoutMs?: number;
  deadlineAt?: number;
  connectionId?: string;
  verifyLoaded?: (deadlineAt: number) => Promise<boolean>;
};

let reloadChain: Promise<unknown> = Promise.resolve();

function scrubSecrets(text: string): string {
  let out = text;
  for (const key of ["KTX_INTERNAL_TOKEN", "KTX_MCP_TOKEN"]) {
    const value = process.env[key]?.trim();
    if (value) out = out.split(value).join("[redacted]");
  }
  return out;
}

function mcpBind() {
  const host = process.env.LUCY_PROXY_UPSTREAM_HOST?.trim() || process.env.KTX_MCP_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.LUCY_PROXY_UPSTREAM_PORT || process.env.KTX_MCP_PORT || 7878);
  return { host, port: Number.isInteger(port) && port > 0 ? port : 7878 };
}

function runKtx(
  execFileImpl: ExecFileImpl,
  args: string[],
  projectRoot: string,
  timeoutMs: number,
  extraEnv: Record<string, string> = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "ktx",
      args,
      {
        cwd: projectRoot,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        env: { ...process.env, POSTHOG_DISABLED: process.env.POSTHOG_DISABLED ?? "1", ...extraEnv }
      },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const out = stdout.toString();
        const err = stderr.toString();
        if (error?.code === "ENOENT") {
          reject(new KtxCliError("ktx CLI was not found in PATH"));
          return;
        }
        const exitCode = !error ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ exitCode, stdout: out, stderr: err });
      }
    );
  });
}

export function waitForTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = createConnection({ host, port });
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(attempt, Math.min(150, Math.max(1, deadline - Date.now())));
      };
      socket.once("connect", () => {
        if (settled) return;
        settled = true;
        socket.end();
        resolve(true);
      });
      socket.once("error", fail);
      socket.setTimeout(Math.min(400, Math.max(1, deadline - Date.now())), fail);
    };
    attempt();
  });
}

async function reloadKtxMcpExecutionRuntimeUnqueued(
  projectRoot: string,
  options: ReloadKtxMcpOptions = {}
): Promise<KtxMcpReloadResult> {
  if (process.env.LUCY_KTX_MCP_RELOAD === "0") {
    return { status: "skipped", detail: "LUCY_KTX_MCP_RELOAD=0" };
  }
  const execFileImpl = options.execFileImpl ?? execFile;
  const deadlineAt = options.deadlineAt ?? Date.now() + Math.min(options.timeoutMs ?? 60_000, 60_000);
  let lease: ReturnType<typeof acquireMcpReloadWindow> | undefined;
  const { host, port } = mcpBind();
  const token = process.env.KTX_INTERNAL_TOKEN?.trim() || process.env.KTX_MCP_TOKEN?.trim();
  try {
    remainingReloadMs(deadlineAt);
    lease = acquireMcpReloadWindow(`cli-${randomUUID()}`, deadlineAt);
    const drainMs = Math.min(20_000, Number(process.env.LUCY_KTX_RELOAD_DRAIN_TIMEOUT_MS) || 20_000);
    if (!await lease.waitForIdle(Math.min(drainMs, remainingReloadMs(deadlineAt)))) {
      return { status: "failed", detail: "执行层重载等待在途查询结束超时；未停止执行层，请待原查询结束后重试" };
    }
    lease.assertCanProceed();
    const configuration = options.verifyLoaded ? null : await (async () => {
      const { readProject } = await import("./project.js");
      const evidence = await import("./mcp-runtime-state.js");
      const project = await readProject(projectRoot);
      const digest = await evidence.readKtxYamlDigest(projectRoot);
      return { expected: project.connections.map((c) => c.id), digest, evidence };
    })();
    lease.assertCanProceed();
    configuration?.evidence.clearExecutionRuntimeObservations();
    const stopped = await runKtx(execFileImpl, ["--project-dir", projectRoot, "mcp", "stop"], projectRoot, remainingReloadMs(deadlineAt, 10_000));
    if (stopped.exitCode !== 0) return { status: "failed", detail: scrubSecrets(stopped.stderr || "KTX MCP stop failed") };
    lease.assertCanProceed();
    const startArgs = [
      "--project-dir",
      projectRoot,
      "mcp",
      "start",
      "--host",
      host,
      "--port",
      String(port)
    ];
    if (token) startArgs.push("--token", token);
    const startDeadline = Math.min(deadlineAt, Date.now() + 20_000);
    const started = await runKtx(execFileImpl, startArgs, projectRoot, remainingReloadMs(startDeadline), token ? { KTX_MCP_TOKEN: token } : {});
    const startedText = `${started.stdout}\n${started.stderr}`;
    // An old daemon that is still listening did not load the new ktx.yaml.
    // Port readiness alone is not a successful reload. "already in use" is the
    // supervised-port collision (Spec 191 / connection-create plan UT-RELOAD-02).
    const portBusy = /already running|already in use/i.test(startedText);
    if (started.exitCode !== 0 || portBusy || !/daemon started/i.test(started.stdout)) {
      return {
        status: "failed",
        detail: scrubSecrets(
          portBusy
            ? `KTX MCP was not restarted, so the new ktx.yaml is not loaded. ${startedText}`
            : startedText || `KTX MCP did not start a new daemon (exit ${started.exitCode})`
        ).trim()
      };
    }
    lease.assertCanProceed();
    const ready = await (options.waitForReady ?? waitForTcpPort)(host, port, remainingReloadMs(startDeadline));
    remainingReloadMs(startDeadline); // A readiness callback cannot extend the start phase.
    resetExecutionRuntimeProbeForTests();
    if (!ready) {
      return {
        status: "failed",
        detail: `KTX MCP did not listen on ${host}:${port} after reload`
      };
    }
    lease.assertCanProceed();
    const verified = options.verifyLoaded
      ? await options.verifyLoaded(deadlineAt)
      : await (async () => {
        const { verifyConfigLoaded } = await import("./admin/mcp-runtime-reload.js");
        if (!configuration) return false;
        const outcome = await verifyConfigLoaded(configuration.expected, options.connectionId, deadlineAt);
        const current = await configuration.evidence.readKtxYamlDigest(projectRoot);
        if (outcome.state !== "verified" || current !== configuration.digest) return false;
        for (const connectionId of configuration.expected) configuration.evidence.recordExecutionRuntimeObservation({
          connectionId, configDigest: configuration.digest, status: "ok", checkedAt: new Date().toISOString(), detail: "直接重载后通过连接级证据确认已加载"
        });
        return true;
      })();
    if (!verified) return { status: "failed", detail: "执行层已重启，但没有取得连接级配置加载证据" };
    lease.assertCanProceed();
    return {
      status: "reloaded",
      detail: scrubSecrets(started.stdout).trim() || `KTX MCP listening on ${host}:${port}`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "failed", detail: scrubSecrets(detail) };
  } finally {
    lease?.release(); // Runs on ACTUAL settlement, never on caller Promise.race timeout.
  }
}

export function reloadKtxMcpExecutionRuntime(
  projectRoot: string,
  options: ReloadKtxMcpOptions = {}
): Promise<KtxMcpReloadResult> {
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + Math.min(options.timeoutMs ?? 60_000, 60_000));
  const actual = reloadChain.then(
    () => reloadKtxMcpExecutionRuntimeUnqueued(projectRoot, { ...options, deadlineAt }),
    () => reloadKtxMcpExecutionRuntimeUnqueued(projectRoot, { ...options, deadlineAt })
  );
  reloadChain = actual.catch(() => undefined);
  return awaitReloadDeadline(actual, deadlineAt).catch((error: unknown) => ({
    status: "failed" as const, detail: error instanceof Error ? error.message : String(error)
  }));
}

/**
 * Make the running execution layer re-read ktx.yaml.
 *
 * The customer container owns KTX with `mcp start --foreground`. `ktx mcp stop`
 * cannot replace that process, and "already running" means the new file was
 * not loaded. Ask the supervisor to restart its own child first. The CLI
 * stop/start path remains for a process that is not supervised.
 */
export async function reloadKtxMcpAfterConfigWrite(
  projectRoot: string,
  connectionId?: string
): Promise<KtxMcpReloadResult> {
  const deadlineAt = Date.now() + Math.min(60_000, Number(process.env.LUCY_KTX_RELOAD_TIMEOUT_MS) || 60_000);
  const channel = await reloadThroughSupervisor(projectRoot, connectionId, deadlineAt);
  const result = channel ?? await reloadKtxMcpExecutionRuntime(projectRoot, { deadlineAt, connectionId });
  if (result.status === "failed") {
    console.error("[ktx-mcp-reload] failed to reload KTX MCP after ktx.yaml write:", result.detail);
  }
  return result;
}

async function reloadThroughSupervisor(
  projectRoot: string,
  connectionId?: string,
  deadlineAt?: number
): Promise<KtxMcpReloadResult | null> {
  try {
    const { reloadExecutionRuntime } = await import("./admin/mcp-runtime-reload.js");
    const channel = await reloadExecutionRuntime({
      projectRoot,
      deadlineAt,
      ...(connectionId ? { connectionId } : {}),
      reason: "ktx.yaml write"
    });
    if (channel.reloadStatus === "unsupported") return null;
    if (channel.reloadStatus === "succeeded" && channel.configVerification === "verified") {
      return {
        status: "reloaded",
        detail: channel.detail?.trim() || "执行层已重读 ktx.yaml"
      };
    }
    if (channel.reloadStatus === "succeeded") {
      return {
        status: "failed",
        detail: channel.detail?.trim() || "执行层已重启，但没有确认新连接已加载"
      };
    }
    return {
      status: "failed",
      detail: channel.detail?.trim() || `执行层重载未完成（${channel.reloadStatus}）`
    };
  } catch (error) {
    // Missing supervisor module means this process is not a customer/supervised
    // runtime — keep the CLI stop/start fallback. Other failures stay hard fails.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
      return null;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "failed", detail };
  }
}
