import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type KtxRuntimeStatus = {
  ready: boolean;
  status: "ready" | "missing" | "error";
  detail?: string;
};

/** Returns whether ktx Python runtime (uv + core) is baked in — required for live catalog offline. */
export async function readKtxRuntimeStatus(): Promise<KtxRuntimeStatus> {
  try {
    const { stdout } = await execFileAsync("ktx", ["admin", "runtime", "status"], {
      timeout: 15_000,
      maxBuffer: 256 * 1024
    });
    const text = stdout.trim();
    if (/^status:\s*ready/m.test(text)) {
      return { ready: true, status: "ready", detail: text.split("\n")[1]?.trim() };
    }
    return {
      ready: false,
      status: "missing",
      detail: text || "ktx runtime not ready"
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ktx admin runtime status failed";
    return { ready: false, status: "error", detail: message };
  }
}
