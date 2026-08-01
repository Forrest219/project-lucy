// webui/tests/e2e/fixtures/helpers/reset.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §8
// Fixture Project 生命周期管理 + process-level 安全 guard
//
// 真实项目仓库只读：E2E 任何时刻对 /Users/zhangxingchen/Projects/project-lucy
// 的写入都视为 bug，会被本模块的 guard 抛出。

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REAL_PROJECT = "/Users/zhangxingchen/Projects/project-lucy";
const FIXTURE_ROOT = process.env.LUCY_E2E_PROJECT_DIR ?? "/tmp/lucy-e2e-fixture";
const BACKEND_URL = process.env.LUCY_E2E_BACKEND_URL ?? "http://127.0.0.1:5173";
// helpers/ → fixtures/ → e2e/ → webui/ → repo root → scripts/
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// helpers/ → fixtures/ → e2e/ → tests/ → webui/ → repo root（5 级）
const REPO_ROOT = resolve(__dirname, "../../../../../");
const INIT_SCRIPT = resolve(REPO_ROOT, "scripts/init-e2e-fixture.sh");

/**
 * process-level guard：在所有 reset / setup 调用前断言。
 * 任何 E2E 进程对真实项目目录的写操作都会通过此 guard 短路。
 *
 * 严格模式（默认）：fixture 缺失 / 指向真实项目 → throw
 * 宽松模式（fixture 不存在时）：仅当 LUCY_E2E_GUARD_MODE=warn 才不 throw；
 *   L1 smoke 只读 URL 访问可以容忍 fixture 缺失（不会写到任何路径）。
 *
 * 写盘操作（resetFixture / upload / publish）走严格模式自动 throw。
 */
export function assertFixtureOnly(opts: { warnIfMissing?: boolean } = {}): void {
  if (
    process.env.LUCY_PROJECT_DIR === REAL_PROJECT ||
    process.env.LUCY_E2E_PROJECT_DIR === REAL_PROJECT ||
    FIXTURE_ROOT === REAL_PROJECT
  ) {
    throw new Error(
      `[E2E-GUARD] Refusing to run against real project dir ${REAL_PROJECT}. ` +
        `Use ${FIXTURE_ROOT} as fixture.`
    );
  }
  if (!existsSync(FIXTURE_ROOT)) {
    const allow =
      opts.warnIfMissing || process.env.LUCY_E2E_GUARD_MODE === "warn";
    if (allow) {
      console.warn(
        `[E2E-GUARD-WARN] Fixture dir not found: ${FIXTURE_ROOT}. ` +
          `Set LUCY_E2E_GUARD_MODE=strict (default) or init fixture via scripts/init-e2e-fixture.sh.`
      );
      return;
    }
    throw new Error(
      `[E2E-GUARD] Fixture dir not found: ${FIXTURE_ROOT}. ` +
        `Run scripts/init-e2e-fixture.sh first.`
    );
  }
  // 二次确认 fixture 不是真实项目目录的 symlink
  const real = realpathSync(FIXTURE_ROOT);
  if (real === REAL_PROJECT || real.startsWith(REAL_PROJECT + "/")) {
    throw new Error(
      `[E2E-GUARD] Fixture ${FIXTURE_ROOT} resolves to real project ${real}. ` +
        `Refusing to proceed.`
    );
  }
}

/**
 * beforeEach / beforeAll 钩子：跑 init 脚本重置 fixture 到干净状态。
 * 失败时抛错并阻止测试继续。
 */
export async function resetFixture(): Promise<void> {
  assertFixtureOnly();
  if (!existsSync(INIT_SCRIPT)) {
    throw new Error(
      `[E2E-GUARD] init script not found: ${INIT_SCRIPT}. ` +
        `See docs/qa/changelog.md "待办" 列表。`
    );
  }
  try {
    execFileSync("bash", [INIT_SCRIPT, FIXTURE_ROOT, REAL_PROJECT], {
      stdio: "pipe",
      env: { ...process.env, LUCY_E2E_PROJECT_DIR: FIXTURE_ROOT },
    });
  } catch (err) {
    const e = err as { stderr?: Buffer; message?: string };
    throw new Error(
      `[E2E-GUARD] resetFixture failed: ${e.message ?? "unknown"}\n` +
        (e.stderr ? e.stderr.toString() : "")
    );
  }
}

/**
 * 调后端 fixture-reset 接口（专用，仅 E2E 开启；非 production 暴露）。
 * 失败时退回到 init 脚本。
 */
export async function resetViaBackend(): Promise<void> {
  assertFixtureOnly();
  try {
    const r = await fetch(`${BACKEND_URL}/api/test/reset-fixture`, {
      method: "POST",
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch {
    // 后端接口不存在时退回到脚本
    await resetFixture();
  }
}

/**
 * 断言文件存在且可读。
 */
export function fixtureFile(relative: string): string {
  return resolve(FIXTURE_ROOT, relative);
}

/**
 * 报告 fixture 当前大小（用于监控 fixture 异常增长）。
 */
export function fixtureSize(): number {
  assertFixtureOnly();
  return statSync(FIXTURE_ROOT).size;
}
