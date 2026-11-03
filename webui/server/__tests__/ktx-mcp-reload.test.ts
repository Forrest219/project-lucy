import { describe, expect, it, vi } from "vitest";
import type { ExecFileException } from "node:child_process";
import { reloadKtxMcpExecutionRuntime } from "../ktx-mcp-reload";

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
