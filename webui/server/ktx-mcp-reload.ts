import { execFile, type ExecFileException } from "node:child_process";
import { createConnection } from "node:net";
import { KtxCliError } from "./ktx.js";
import { resetExecutionRuntimeProbeForTests } from "./admin/mcp-runtime.js";

type ExecFileImpl = typeof execFile;

export type KtxMcpReloadResult = {
  status: "reloaded" | "started" | "skipped" | "failed";
  detail: string;
};

export type ReloadKtxMcpOptions = {
  execFileImpl?: ExecFileImpl;
  waitForReady?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  timeoutMs?: number;
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
      const fail = () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        setTimeout(attempt, 150);
      };
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", fail);
      socket.setTimeout(400, fail);
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
  const timeoutMs = options.timeoutMs ?? 20_000;
  const { host, port } = mcpBind();
  const token = process.env.KTX_INTERNAL_TOKEN?.trim() || process.env.KTX_MCP_TOKEN?.trim();
  try {
    await runKtx(execFileImpl, ["--project-dir", projectRoot, "mcp", "stop"], projectRoot, timeoutMs);
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
    const started = await runKtx(execFileImpl, startArgs, projectRoot, timeoutMs, token ? { KTX_MCP_TOKEN: token } : {});
    const startedText = `${started.stdout}\n${started.stderr}`;
    // An old daemon that is still listening did not load the new ktx.yaml.
    // Port readiness alone is not a successful reload.
    if (started.exitCode !== 0 || /already running/i.test(startedText) || !/daemon started/i.test(started.stdout)) {
      return {
        status: "failed",
        detail: scrubSecrets(
          /already running/i.test(startedText)
            ? `KTX MCP was not restarted, so the new ktx.yaml is not loaded. ${startedText}`
            : startedText || `KTX MCP did not start a new daemon (exit ${started.exitCode})`
        ).trim()
      };
    }
    const ready = await (options.waitForReady ?? waitForTcpPort)(host, port, timeoutMs);
    resetExecutionRuntimeProbeForTests();
    if (!ready) {
      return {
        status: "failed",
        detail: `KTX MCP did not listen on ${host}:${port} after reload`
      };
    }
    return {
      status: "reloaded",
      detail: scrubSecrets(started.stdout).trim() || `KTX MCP listening on ${host}:${port}`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "failed", detail };
  }
}

export function reloadKtxMcpExecutionRuntime(
  projectRoot: string,
  options: ReloadKtxMcpOptions = {}
): Promise<KtxMcpReloadResult> {
  const run = reloadChain.then(
    () => reloadKtxMcpExecutionRuntimeUnqueued(projectRoot, options),
    () => reloadKtxMcpExecutionRuntimeUnqueued(projectRoot, options)
  );
  reloadChain = run.catch(() => undefined);
  return run;
}

export async function reloadKtxMcpAfterConfigWrite(projectRoot: string): Promise<KtxMcpReloadResult> {
  const result = await reloadKtxMcpExecutionRuntime(projectRoot);
  if (result.status === "failed") {
    console.error("[ktx-mcp-reload] failed to reload KTX MCP after ktx.yaml write:", result.detail);
  }
  return result;
}
