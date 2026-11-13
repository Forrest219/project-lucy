import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type KtxRuntimeStatus = {
  ready: boolean;
  status: "ready" | "missing" | "error";
  detail?: string;
};

let ktxSpawnCount = 0;

/** How many times this process has spawned `ktx admin runtime status`. */
export function ktxRuntimeSpawnCount(): number {
  return ktxSpawnCount;
}

export function resetKtxRuntimeSpawnCountForTests(): void {
  ktxSpawnCount = 0;
}

/** Returns whether ktx Python runtime (uv + core) is baked in — required for live catalog offline. */
export async function readKtxRuntimeStatus(): Promise<KtxRuntimeStatus> {
  ktxSpawnCount += 1;
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

const KTX_RUNTIME_TTL_MS = 60_000;
let ktxCached: { at: number; value: KtxRuntimeStatus } | null = null;
let ktxInflight: Promise<KtxRuntimeStatus> | null = null;

/** Last cached runtime status. Does not spawn a process. */
export function peekKtxRuntimeStatus(): KtxRuntimeStatus {
  return ktxCached?.value ?? { ready: false, status: "missing", detail: "not_cached" };
}

/**
 * At most one `ktx admin runtime status` per minute. Concurrent callers share
 * the in-flight check.
 */
export function readKtxRuntimeStatusCached(): Promise<KtxRuntimeStatus> {
  if (ktxCached && Date.now() - ktxCached.at < KTX_RUNTIME_TTL_MS) return Promise.resolve(ktxCached.value);
  if (!ktxInflight) {
    ktxInflight = readKtxRuntimeStatus()
      .then((value) => {
        ktxCached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        ktxInflight = null;
      });
  }
  return ktxInflight;
}

export function setKtxRuntimeStatusForTests(status: KtxRuntimeStatus): void {
  ktxCached = { at: Date.now(), value: status };
  ktxInflight = null;
}

export function resetKtxRuntimeCacheForTests(): void {
  ktxCached = null;
  ktxInflight = null;
}
