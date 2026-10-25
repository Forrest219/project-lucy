/**
 * P1-4 Hive 直连（编译侧）— H4 只编译桥。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.2
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H4）
 *
 * 测试全部使用可编程的假进程：不下载、不安装、不调用真实 KTX 运行时。
 */
import { describe, expect, it } from "vitest";
import {
  DAEMON_INPUT_REJECTED_EXIT_CODE,
  buildCompileEnv,
  compileHiveQuery,
  redactCompileDiagnostic,
  resolveHiveDaemonCommand,
  validateCompileEnvelope,
  type HiveCompileChild,
  type HiveServerQueryPolicy,
  type HiveSpawner
} from "../hive/compile-bridge";

type FakePlan = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Never close — the deadline has to fire. */
  hang?: boolean;
  /** Emit this many bytes of stdout (for the output cap). */
  stdoutBytes?: number;
  /** Report `close` this many ms after `kill` was called. */
  closeAfterKillMs?: number;
  /** Never report `close`, not even after `kill`. */
  neverClose?: boolean;
};

type SpawnCall = {
  command: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
};

function fakeSpawner(plan: FakePlan): { spawner: HiveSpawner; calls: SpawnCall[]; events: string[] } {
  const calls: SpawnCall[] = [];
  const events: string[] = [];
  const spawner: HiveSpawner = (input) => {
    const call: SpawnCall = { command: input.command, args: input.args, env: input.env, stdin: "" };
    calls.push(call);

    let stdoutListener: ((chunk: Buffer) => void) | undefined;
    let stderrListener: ((chunk: Buffer) => void) | undefined;
    let closeListener: ((code: number | null, signal: string | null) => void) | undefined;
    let closed = false;

    const emitClose = (code: number | null): void => {
      if (closed) return;
      closed = true;
      events.push("close");
      closeListener?.(code, null);
    };

    const child: HiveCompileChild = {
      write: (payload) => {
        call.stdin += payload;
      },
      end: () => {
        if (plan.hang) return;
        queueMicrotask(() => {
          if (plan.stdoutBytes !== undefined) {
            stdoutListener?.(Buffer.alloc(plan.stdoutBytes, 0x61));
          } else if (plan.stdout !== undefined) {
            stdoutListener?.(Buffer.from(plan.stdout, "utf8"));
          }
          if (plan.stderr !== undefined) {
            stderrListener?.(Buffer.from(plan.stderr, "utf8"));
          }
          emitClose(plan.exitCode ?? 0);
        });
      },
      onStdout: (listener) => {
        stdoutListener = listener;
      },
      onStderr: (listener) => {
        stderrListener = listener;
      },
      onClose: (listener) => {
        closeListener = listener;
      },
      onError: () => {
        // not used by these tests
      },
      kill: () => {
        events.push("kill");
        if (plan.neverClose) return;
        // A killed process really does report its terminal state.
        setTimeout(() => emitClose(null), plan.closeAfterKillMs ?? 0);
      }
    };
    return child;
  };
  return { spawner, calls, events };
}

const GOOD_RESPONSE = JSON.stringify({
  sql: "SELECT SUM(finance_orders.amount) AS revenue FROM finance.orders AS finance_orders LIMIT 100",
  dialect: "hive",
  columns: [{ name: "revenue" }],
  plan: { sources_used: ["finance_orders"] }
});

const SOURCE = {
  name: "finance_orders",
  table: "finance.orders",
  grain: ["order_id"],
  columns: [{ name: "order_id", type: "number", visibility: "public", role: "default" }]
};

const POLICY: HiveServerQueryPolicy = {
  predefinedMeasuresOnly: true,
  maxLimit: 500
};

const DAEMON = { command: "/opt/ktx/ktx-daemon", args: [] };

describe("H4 只编译桥", () => {
  it("成功编译：请求经 stdin、响应经 stdout，argv 只带子命令", async () => {
    const { spawner, calls } = fakeSpawner({ stdout: GOOD_RESPONSE });
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"], filters: [] },
      policy: POLICY,
      daemon: DAEMON,
      spawner
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain("FROM finance.orders AS finance_orders");
    expect(result.dialect).toBe("hive");
    expect(result.plan.sources_used).toEqual(["finance_orders"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["semantic-query"]);
    // 请求绝不能出现在 argv 里。
    expect(calls[0]!.args.join(" ")).not.toContain("finance_orders");
    // 请求走 stdin。
    const envelope = JSON.parse(calls[0]!.stdin);
    expect(envelope.dialect).toBe("hive");
    expect(envelope.sources[0].name).toBe("finance_orders");
  });

  it("编译请求里出现连接 ID 或凭据字段 → 在 schema 层拒绝，根本不启动进程", async () => {
    const { spawner, calls } = fakeSpawner({ stdout: GOOD_RESPONSE });
    const result = await compileHiveQuery({
      sources: [{ ...SOURCE, connectionId: "prod_hive" }],
      query: { measures: [] },
      policy: POLICY,
      daemon: DAEMON,
      spawner
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("input_rejected");
    expect(result.reason).toBe("hive_compile_credential_in_request");
    expect(calls).toHaveLength(0);

    const credential = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: [], credentials: { password: "x" } },
      policy: POLICY,
      daemon: DAEMON,
      spawner
    });
    expect(credential.ok).toBe(false);
    if (credential.ok) return;
    expect(credential.reason).toBe("hive_compile_credential_in_request");
    expect(calls).toHaveLength(0);
  });

  it("未知方言不静默回退 Postgres：请求只可能是 hive，响应方言不符即故障", async () => {
    const { spawner, calls } = fakeSpawner({
      stdout: JSON.stringify({ ...JSON.parse(GOOD_RESPONSE), dialect: "postgres" })
    });
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("process_fault");
    expect(result.reason).toBe("hive_compile_dialect_mismatch");
    // 发出去的方言只能是 hive。
    expect(JSON.parse(calls[0]!.stdin).dialect).toBe("hive");
  });

  it("退出码 3（计算层拒绝）与退出码 1（进程故障）分开分类", async () => {
    const rejected = fakeSpawner({
      exitCode: DAEMON_INPUT_REJECTED_EXIT_CODE,
      stderr: "ValueError: Unknown measure 'finance_orders.nope'"
    });
    const rejectedResult = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.nope"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: rejected.spawner
    });
    expect(rejectedResult.ok).toBe(false);
    if (rejectedResult.ok) return;
    expect(rejectedResult.kind).toBe("input_rejected");
    expect(rejectedResult.exitCode).toBe(DAEMON_INPUT_REJECTED_EXIT_CODE);

    const crashed = fakeSpawner({ exitCode: 1, stderr: "Traceback (most recent call last): ..." });
    const crashedResult = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: crashed.spawner
    });
    expect(crashedResult.ok).toBe(false);
    if (crashedResult.ok) return;
    expect(crashedResult.kind).toBe("process_fault");
    expect(crashedResult.reason).toBe("hive_compile_process_failed");
    expect(crashedResult.exitCode).toBe(1);
  });

  it("超时分类为进程故障，不与输入拒绝混淆", async () => {
    const { spawner } = fakeSpawner({ hang: true });
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner,
      deadlineMs: 20
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("process_fault");
    expect(result.reason).toBe("hive_compile_timeout");
  });

  it("超时后等到子进程报告终态（close）才兑现，不在 kill 的瞬间返回", async () => {
    const { spawner, events } = fakeSpawner({ hang: true, closeAfterKillMs: 40 });
    const started = Date.now();
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner,
      deadlineMs: 20,
      closeGraceMs: 2_000
    });
    events.push("resolve");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 原因码与对外行为不变。
    expect(result.kind).toBe("process_fault");
    expect(result.reason).toBe("hive_compile_timeout");
    // kill 先发生，close 才是终态，Promise 最后才兑现。
    expect(events).toEqual(["kill", "close", "resolve"]);
    // 确实等到了 close，而不是 kill 后立刻返回。
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("子进程永不报告终态时由二级超时兜底，请求不会挂死", async () => {
    const { spawner, events } = fakeSpawner({ hang: true, neverClose: true });
    const started = Date.now();
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner,
      deadlineMs: 20,
      closeGraceMs: 50
    });
    events.push("resolve");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("hive_compile_timeout");
    // 兜底到期就返回，且没有等到终态。
    expect(events).toEqual(["kill", "resolve"]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("输出超限分类为进程故障", async () => {
    const { spawner } = fakeSpawner({ stdoutBytes: 4096 });
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner,
      maxOutputBytes: 128
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("process_fault");
    expect(result.reason).toBe("hive_compile_output_too_large");
  });

  it("predefined_measures_only 由服务端策略决定：调用方给的值被覆盖", async () => {
    const { spawner, calls } = fakeSpawner({ stdout: GOOD_RESPONSE });
    await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"], predefined_measures_only: false },
      policy: { predefinedMeasuresOnly: true, maxLimit: 500 },
      daemon: DAEMON,
      spawner
    });
    const envelope = JSON.parse(calls[0]!.stdin);
    expect(envelope.query.predefined_measures_only).toBe(true);
  });

  it("LIMIT 受服务端上限约束", async () => {
    const { spawner, calls } = fakeSpawner({ stdout: GOOD_RESPONSE });
    await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"], limit: 100000 },
      policy: POLICY,
      daemon: DAEMON,
      spawner
    });
    expect(JSON.parse(calls[0]!.stdin).query.limit).toBe(500);
  });

  it("环境隔离：只转发白名单变量，不带 Lucy 会话变量", () => {
    const env = buildCompileEnv({
      PATH: "/usr/bin",
      HOME: "/root",
      LUCY_SESSION_TOKEN: "super-secret",
      KTX_INTERNAL_TOKEN: "another-secret",
      DATABASE_URL: "postgres://user:pw@host/db"
    } as NodeJS.ProcessEnv);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/root");
    expect(env.LUCY_SESSION_TOKEN).toBeUndefined();
    expect(env.KTX_INTERNAL_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    // 编译进程不得联网装依赖。
    expect(env.PIP_NO_INDEX).toBe("1");
  });

  it("错误诊断脱敏：凭据样式的片段不外泄", () => {
    const redacted = redactCompileDiagnostic(
      "connection failed password=hunter2 host=hive.example.com token=abc123"
    );
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("hive.example.com");

    const url = redactCompileDiagnostic("jdbc:hive2://user:sekret@hive.example.com:10000/default");
    expect(url).not.toContain("sekret");
  });

  it("请求信封的字段白名单拒绝未知字段", () => {
    expect(validateCompileEnvelope({ sources: [], query: {}, dialect: "hive" }).ok).toBe(true);
    const unknown = validateCompileEnvelope({ sources: [], query: {}, dialect: "hive", extra: 1 });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.reason).toBe("hive_compile_request_invalid");
  });

  it("进程无法启动时归类为进程故障，不抛出未分类异常", async () => {
    const throwingSpawner: HiveSpawner = () => {
      throw new Error("ENOENT: no such file or directory");
    };
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: throwingSpawner
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("process_fault");
    expect(result.reason).toBe("hive_compile_spawn_failed");
  });

  it("ktx-daemon 路径从受管 runtime 解析，不硬编码；解析不到就失败关闭", async () => {
    const override = await resolveHiveDaemonCommand({
      env: { LUCY_HIVE_KTX_DAEMON: process.execPath } as NodeJS.ProcessEnv
    });
    expect(override.ok).toBe(true);
    if (!override.ok) return;
    expect(override.source).toBe("env");
    expect(override.command.command).toBe(process.execPath);

    const missing = await resolveHiveDaemonCommand({
      env: { LUCY_HIVE_KTX_DAEMON: "/nonexistent/ktx-daemon" } as NodeJS.ProcessEnv
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe("hive_compile_daemon_unavailable");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * P1-4 §7 验收矩阵 — 按编号命名的用例（V01、V06）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.2（编译与
 *     执行隔离）、§5（失败顺序）、§7（验收矩阵 V01 / V06 的通过标准）
 *
 * V01：固定 runtime 的 semantic-validate／query —— 无数据库配置和凭据仍返回
 *       结构化 SQL／plan；输入拒绝与进程失败可分。
 * V06：非法输入、编译异常、超时、超大输出 —— 无 JDBC 分派；不回退 Postgres、
 *       不返回未校验 SQL。
 *
 * 全部用假进程：不下载、不安装、不调用真实 KTX 运行时，也不连任何数据库。
 * ─────────────────────────────────────────────────────────────────────────────
 */

describe("P1-4 §7 — V01 固定 runtime 的只编译", () => {
  it("V01 — 无数据库配置和凭据仍返回结构化 SQL／plan；输入拒绝与进程失败可分", async () => {
    // ① 请求里只有 sources + query + 服务端策略：没有数据库配置，也没有任何凭据。
    const { spawner, calls } = fakeSpawner({ stdout: GOOD_RESPONSE });
    const result = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"], filters: [] },
      policy: POLICY,
      daemon: DAEMON,
      spawner
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 结构化 SQL／plan 都回来了（不是一句报错，也不是空对象）。
    expect(typeof result.sql).toBe("string");
    expect(result.sql.length).toBeGreaterThan(0);
    expect(result.dialect).toBe("hive");
    expect(Array.isArray(result.columns)).toBe(true);
    expect(typeof result.plan).toBe("object");
    expect(result.plan.sources_used).toEqual(["finance_orders"]);

    // 固定 runtime：只调用 semantic-query 子命令，请求走 stdin 而非 argv。
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(["semantic-query"]);
    expect(calls[0]!.args.join(" ")).not.toContain("finance_orders");
    const envelope = JSON.parse(calls[0]!.stdin);
    expect(envelope.dialect).toBe("hive");

    // 编译进程拿不到任何数据库凭据或连接身份。
    expect(calls[0]!.stdin).not.toContain("password");
    expect(calls[0]!.stdin).not.toContain("jdbc:");
    expect(calls[0]!.stdin).not.toContain("connectionId");

    // ② 输入拒绝与进程失败可分：两类不同的 kind，且原因码互不相同。
    const illegal = fakeSpawner({ stdout: GOOD_RESPONSE });
    const rejected = await compileHiveQuery({
      sources: [{ ...SOURCE, connectionId: "prod_hive" }],
      query: { measures: [] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: illegal.spawner
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.kind).toBe("input_rejected");
    expect(rejected.reason).toBe("hive_compile_credential_in_request");
    // 输入拒绝根本不启动进程。
    expect(illegal.calls).toHaveLength(0);

    const crashed = fakeSpawner({ exitCode: 1, stderr: "Traceback (most recent call last): ..." });
    const fault = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: crashed.spawner
    });
    expect(fault.ok).toBe(false);
    if (fault.ok) return;
    expect(fault.kind).toBe("process_fault");
    expect(fault.reason).toBe("hive_compile_process_failed");
    expect(rejected.kind).not.toBe(fault.kind);
    expect(rejected.reason).not.toBe(fault.reason);
  });
});

describe("P1-4 §7 — V06 非法输入／编译异常／超时／超大输出", () => {
  it("V06 — 四类失败各自可分；不回退 Postgres；失败结果不携带任何未校验 SQL", async () => {
    // ① 非法输入：请求里带凭据字段 → 输入拒绝，且不启动进程。
    const illegal = fakeSpawner({ stdout: GOOD_RESPONSE });
    const invalid = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: [], credentials: { password: "x" } },
      policy: POLICY,
      daemon: DAEMON,
      spawner: illegal.spawner
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.kind).toBe("input_rejected");
    expect(invalid.reason).toBe("hive_compile_credential_in_request");
    expect(illegal.calls).toHaveLength(0);

    // ② 编译异常（进程非零退出）→ 进程故障。
    const crashed = fakeSpawner({ exitCode: 1, stderr: "Traceback (most recent call last): ..." });
    const failed = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: crashed.spawner
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.kind).toBe("process_fault");
    expect(failed.reason).toBe("hive_compile_process_failed");

    // ③ 超时 → 进程故障（与输入拒绝不混淆）。
    const hung = fakeSpawner({ hang: true });
    const timedOut = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: hung.spawner,
      deadlineMs: 20
    });
    expect(timedOut.ok).toBe(false);
    if (timedOut.ok) return;
    expect(timedOut.kind).toBe("process_fault");
    expect(timedOut.reason).toBe("hive_compile_timeout");

    // ④ 超大输出 → 进程故障。
    const huge = fakeSpawner({ stdoutBytes: 4096 });
    const tooLarge = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: huge.spawner,
      maxOutputBytes: 128
    });
    expect(tooLarge.ok).toBe(false);
    if (tooLarge.ok) return;
    expect(tooLarge.kind).toBe("process_fault");
    expect(tooLarge.reason).toBe("hive_compile_output_too_large");

    // 四类失败互不混淆：原因码两两不同。
    const reasons = [invalid.reason, failed.reason, timedOut.reason, tooLarge.reason];
    expect(new Set(reasons).size).toBe(4);

    // 不回退 Postgres：发出去的方言永远是 hive；响应方言不符即故障。
    const postgres = fakeSpawner({
      stdout: JSON.stringify({ ...JSON.parse(GOOD_RESPONSE), dialect: "postgres" })
    });
    const mismatched = await compileHiveQuery({
      sources: [SOURCE],
      query: { measures: ["finance_orders.revenue"] },
      policy: POLICY,
      daemon: DAEMON,
      spawner: postgres.spawner
    });
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.kind).toBe("process_fault");
    expect(mismatched.reason).toBe("hive_compile_dialect_mismatch");
    expect(JSON.parse(postgres.calls[0]!.stdin).dialect).toBe("hive");

    // 不返回未校验 SQL：任何失败结果都不带 sql 字段（结构上就没有）。
    for (const failure of [invalid, failed, timedOut, tooLarge, mismatched]) {
      expect("sql" in failure).toBe(false);
    }
  });
});
