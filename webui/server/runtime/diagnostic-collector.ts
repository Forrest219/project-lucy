import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ContentLayoutStatus } from "../content-layout.js";
import type { KtxRuntimeStatus } from "../ktx-runtime.js";
import type { ExecutionProbeResult, readMcpRuntimeStatus } from "../admin/mcp-runtime.js";
import type { ExecutionRuntimeObservation } from "../mcp-runtime-state.js";

export type DiagnosticCollectorInput = {
  probe?: ExecutionProbeResult;
  observations: ExecutionRuntimeObservation[];
  ktxRuntime: KtxRuntimeStatus;
  contentLayout?: ContentLayoutStatus;
};

export type DiagnosticCollectorResult = {
  contentLayout?: ContentLayoutStatus;
  ktxRuntime: KtxRuntimeStatus;
  execution: Awaited<ReturnType<typeof readMcpRuntimeStatus>>["execution"];
};

/** The permit's Promise settles on child close, never merely on abort/message. */
export function collectDiagnosticIo(signal: AbortSignal, input: DiagnosticCollectorInput): Promise<DiagnosticCollectorResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./diagnostic-collector-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", import.meta.resolve("tsx")],
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    let result: DiagnosticCollectorResult | undefined;
    let failed = false;
    let aborted = false;
    const stop = () => {
      aborted = true;
      // Kill the private process group too: no orphaned CLI descendants.
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill("SIGKILL");
    };
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", () => { failed = true; stop(); });
    child.on("message", (message: unknown) => {
      const record = message as { ok?: boolean; data?: DiagnosticCollectorResult; stage?: string };
      if (record.stage) console.info(`[diagnostic-collector] stage=${record.stage} pid=${child.pid}`);
      else if (record.ok && record.data) result = record.data;
      else failed = true;
    });
    child.once("close", (code, terminationSignal) => {
      signal.removeEventListener("abort", stop);
      console.info(`[diagnostic-collector] closed pid=${child.pid} aborted=${aborted} code=${code} signal=${terminationSignal}`);
      if (aborted || signal.aborted) reject(new Error("diagnostic collection aborted after process exit"));
      else if (failed || code !== 0 || !result) reject(new Error("diagnostic collection failed"));
      else resolve(result);
    });
    // A parent crash/disconnect is also terminal for this detached reader.
    child.send(input, (error) => { if (error) { failed = true; stop(); } });
    if (signal.aborted) stop();
  });
}
