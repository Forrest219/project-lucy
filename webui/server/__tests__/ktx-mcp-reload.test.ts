import { describe, expect, it, vi } from "vitest";
import type { ExecFileException } from "node:child_process";
import { reloadKtxMcpAfterConfigWrite, reloadKtxMcpExecutionRuntime } from "../ktx-mcp-reload";

const supervisor = vi.hoisted(() => ({
  reloadExecutionRuntime: vi.fn()
}));

vi.mock("../admin/mcp-runtime-reload.js", () => ({
  reloadExecutionRuntime: supervisor.reloadExecutionRuntime
}));

function execFileMock(script: (args: string[]) => { stdout: string; stderr?: string; error?: ExecFileException | null }) {
  return vi.fn((
    _cmd: string,
    args: readonly string[],
    _opts: unknown,
    cb: (error: ExecFileException | null, stdout: string, stderr: string) => void
  ) => {
    const result = script([...args]);
    cb(result.error ?? null, result.stdout, result.stderr ?? "");
  });
}

describe("reloadKtxMcpExecutionRuntime", () => {
  it("stops then starts the managed KTX MCP daemon and waits until it listens", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "1";
    const calls: string[][] = [];
    const execFileImpl = execFileMock((args) => {
      calls.push(args);
      return { stdout: args.includes("stop") ? "ktx MCP daemon stopped.\n" : "ktx MCP daemon started: http://127.0.0.1:7878/mcp\n" };
    }) as never;

    try {
      const result = await reloadKtxMcpExecutionRuntime("/tmp/lucy-project", {
        execFileImpl,
        waitForReady: async () => true
      });

      expect(result.status).toBe("reloaded");
      expect(calls[0]).toEqual(["--project-dir", "/tmp/lucy-project", "mcp", "stop"]);
      expect(calls[1]?.slice(0, 8)).toEqual([
        "--project-dir",
        "/tmp/lucy-project",
        "mcp",
        "start",
        "--host",
        "127.0.0.1",
        "--port",
        "7878"
      ]);
      expect(calls[1]).not.toContain("--foreground");
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("does not treat a still-running daemon as a successful reload", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "1";
    const execFileImpl = execFileMock((args) => {
      if (args.includes("stop")) return { stdout: "ktx MCP daemon stopped.\n" };
      return { stdout: "ktx MCP daemon already running: http://127.0.0.1:7878/mcp\n", error: { code: 1 } as ExecFileException };
    }) as never;
    try {
      const result = await reloadKtxMcpExecutionRuntime("/tmp/lucy-project", {
        execFileImpl,
        waitForReady: async () => true
      });
      expect(result.status).toBe("failed");
      expect(result.detail).toContain("not restarted");
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("asks the supervisor to re-read ktx.yaml before touching the CLI daemon", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "0";
    supervisor.reloadExecutionRuntime.mockResolvedValue({
      reloadStatus: "succeeded",
      configVerification: "verified",
      detail: "执行层已重读 ktx.yaml"
    });
    try {
      const result = await reloadKtxMcpAfterConfigWrite("/tmp/lucy-project", "hive-jd");
      expect(result).toEqual({ status: "reloaded", detail: "执行层已重读 ktx.yaml" });
      expect(supervisor.reloadExecutionRuntime).toHaveBeenCalledWith({
        projectRoot: "/tmp/lucy-project",
        connectionId: "hive-jd",
        reason: "ktx.yaml write"
      });
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("does not report reloaded when the supervisor restarted without loading the connection", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "0";
    supervisor.reloadExecutionRuntime.mockResolvedValue({
      reloadStatus: "succeeded",
      configVerification: "failed",
      detail: "Connection \"hive-jd\" is not configured in ktx.yaml"
    });
    try {
      const result = await reloadKtxMcpAfterConfigWrite("/tmp/lucy-project", "hive-jd");
      expect(result.status).toBe("failed");
      expect(result.detail).toContain("hive-jd");
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("does not use ktx mcp stop when the supervisor reports the reload failed", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "0";
    supervisor.reloadExecutionRuntime.mockResolvedValue({
      reloadStatus: "failed",
      detail: "执行层重载通道的 supervisor 进程已退出"
    });
    try {
      const result = await reloadKtxMcpAfterConfigWrite("/tmp/lucy-project");
      expect(result.status).toBe("failed");
      expect(result.detail).toContain("supervisor");
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("falls back to the CLI daemon when this process has no supervisor", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "0";
    supervisor.reloadExecutionRuntime.mockResolvedValue({
      reloadStatus: "unsupported",
      detail: "当前部署不支持执行层重载"
    });
    try {
      const result = await reloadKtxMcpAfterConfigWrite("/tmp/lucy-project");
      expect(result).toEqual({ status: "skipped", detail: "LUCY_KTX_MCP_RELOAD=0" });
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("falls back to the CLI daemon when the supervisor module is missing", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "0";
    supervisor.reloadExecutionRuntime.mockRejectedValue(
      Object.assign(new Error("Cannot find module './admin/mcp-runtime-reload.js'"), {
        code: "ERR_MODULE_NOT_FOUND"
      })
    );
    try {
      const result = await reloadKtxMcpAfterConfigWrite("/tmp/lucy-project");
      expect(result).toEqual({ status: "skipped", detail: "LUCY_KTX_MCP_RELOAD=0" });
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });

  it("can be skipped with LUCY_KTX_MCP_RELOAD=0", async () => {
    const previous = process.env.LUCY_KTX_MCP_RELOAD;
    process.env.LUCY_KTX_MCP_RELOAD = "0";
    try {
      const execFileImpl = execFileMock(() => ({ stdout: "" })) as never;
      const result = await reloadKtxMcpExecutionRuntime("/tmp/lucy-project", { execFileImpl });
      expect(result.status).toBe("skipped");
      expect(execFileImpl).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.LUCY_KTX_MCP_RELOAD;
      else process.env.LUCY_KTX_MCP_RELOAD = previous;
    }
  });
});
