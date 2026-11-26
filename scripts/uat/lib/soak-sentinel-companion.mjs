#!/usr/bin/env node
/**
 * soak-sentinel-companion.mjs — 将 stability-sentinel.mjs (--mode=gate) 作为
 * 伴随子进程挂载到 Soak / 压测入口的公共轻量封装。
 *
 * 停止语义（B5/N9）：哨兵主循环睡眠可被 SIGINT 即时唤醒；默认 stopGraceMs=30s
 * （大于 intervalMs + probeTimeoutMs），确保在途探针完成后正常落盘 summary.json。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SENTINEL_SCRIPT_PATH = path.resolve(HERE, "../stability-sentinel.mjs");

export function startSoakSentinel({
  baseUrl,
  mcpUrl = "",
  intervalMs = 15_000,
  timeoutMs = 8_000,
  outPath,
  logPath = "",
  adminId = "",
  passwordFile = "",
  p99ThresholdMs = 250,
  p99Consecutive = 3,
  maxEventLoopMs = 1000,
  stopGraceMs = 30_000,
  nodeBin = process.execPath,
} = {}) {
  if (!baseUrl) throw new Error("startSoakSentinel requires baseUrl");
  if (!outPath) throw new Error("startSoakSentinel requires outPath");

  const args = [
    SENTINEL_SCRIPT_PATH,
    "--mode=gate",
    `--base-url=${baseUrl}`,
    `--interval-ms=${intervalMs}`,
    `--timeout-ms=${timeoutMs}`,
    `--p99-threshold-ms=${p99ThresholdMs}`,
    `--p99-consecutive=${p99Consecutive}`,
    `--max-event-loop-ms=${maxEventLoopMs}`,
    `--out=${outPath}`,
    "--quiet",
  ];
  if (mcpUrl) args.push(`--mcp-url=${mcpUrl}`);
  if (logPath) args.push(`--log=${logPath}`);
  if (adminId) args.push(`--admin-id=${adminId}`);
  if (passwordFile) args.push(`--password-file=${passwordFile}`);

  const child = spawn(nodeBin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (err) => resolve({ code: 1, signal: null, error: err.message }));
  });

  let stopped = false;

  return {
    pid: child.pid ?? null,
    async stop() {
      if (!stopped) {
        stopped = true;
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGINT");
        }
      }
      let timer;
      let result = await Promise.race([
        exited,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
            resolve({ code: 1, signal: "SIGKILL", timedOut: true });
          }, stopGraceMs);
          timer.unref?.();
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (result.timedOut) {
        // N9: 等待被 SIGKILL 的子进程实际被回收，避免僵尸进程。
        await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
      }

      let summary = null;
      if (existsSync(outPath)) {
        try {
          summary = JSON.parse(readFileSync(outPath, "utf8"));
        } catch {
          summary = null;
        }
      }
      const exitCode = typeof result.code === "number" ? result.code : 1;
      const passed = exitCode === 0 && summary?.verdict === "PASS";
      return {
        exitCode,
        passed,
        summary,
        outPath,
        logPath: logPath || null,
        stderr: stderr.trim() || null,
      };
    },
  };
}
