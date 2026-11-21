import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOpsStepId,
  OpsStepJournal,
  opsStepReasonFromError,
  type OpsStepJournalOptions,
  type OpsStepWriteInput
} from "../runtime/ops-step-journal";

const FIXED_AT = "2026-11-20T08:00:00.000Z";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stepInput(overrides: Partial<OpsStepWriteInput> = {}): OpsStepWriteInput {
  return {
    op: "diagnostic_collect",
    opId: createOpsStepId(),
    step: "read_project",
    phase: "enter",
    at: FIXED_AT,
    elapsedMs: 0,
    ...overrides
  };
}

function fixedLine(opId: string): string {
  return `${JSON.stringify({
    ts: FIXED_AT,
    op: "diagnostic_collect",
    op_id: opId,
    step: "read_project",
    phase: "enter",
    elapsed_ms: 0,
    result: "running",
    reason_code: ""
  })}\n`;
}

describe("P1-68 ops step journal", () => {
  let root: string;
  let journals: OpsStepJournal[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lucy-ops-step-journal-"));
    journals = [];
  });

  afterEach(async () => {
    for (const journal of journals) await journal.closeForTests();
    await rm(root, { recursive: true, force: true });
  });

  async function makeJournal(options: OpsStepJournalOptions = {}): Promise<OpsStepJournal> {
    const journal = new OpsStepJournal({
      contentRoot: root,
      stdoutWriter: (line) => line.length,
      now: () => new Date(FIXED_AT),
      ...options
    });
    journals.push(journal);
    return journal;
  }

  function journalPath(): string {
    return path.join(root, ".lucy", "ops-steps.jsonl");
  }

  it("creates operation ids with the frozen shape", () => {
    expect(createOpsStepId()).toMatch(/^ops_[0-9a-f]{32}$/);
    expect(createOpsStepId()).not.toBe(createOpsStepId());
  });

  it("keeps enter visible before an awaited body and pairs repeated serial steps", async () => {
    let mono = 0;
    const journal = await makeJournal({ monotonicNow: () => mono });
    const opId = createOpsStepId();
    const gate = deferred<string>();
    const running = journal.runStep({
      op: "runtime_reload",
      opId,
      step: "catalog_reload",
      body: () => gate.promise
    });
    expect(journal.read().inFlight).toHaveLength(1);
    expect(journal.read().history).toHaveLength(0);
    mono = 20;
    gate.resolve("first");
    await expect(running).resolves.toBe("first");
    mono = 40;
    await journal.runStep({
      op: "runtime_reload",
      opId,
      step: "catalog_reload",
      body: async () => {
        mono = 75;
        return "second";
      }
    });
    const history = journal.read().history;
    expect(history.map((entry) => entry.phase)).toEqual(["leave", "leave"]);
    expect(history.every((entry) => entry.state === "ended")).toBe(true);
    expect(history[0]?.durationMs).toBe(20);
    expect(history[1]?.durationMs).toBe(35);
    expect(new Set(history.map((entry) => entry.key)).size).toBe(2);
    expect(journal.read().inFlight).toHaveLength(0);
  });

  it("rethrows the original error and classifies returned failures without throwing", async () => {
    const journal = await makeJournal();
    const original = Object.assign(new Error("driver SQL and sentinel must not leak"), { code: "EIO" });
    const opId = createOpsStepId();
    await expect(journal.runStep({
      op: "schema_structure_read",
      opId,
      step: "read_columns",
      body: () => {
        throw original;
      }
    })).rejects.toBe(original);
    const value = { ack: false };
    await expect(journal.runStep({
      op: "enabled_tables_save",
      opId,
      step: "execution_ack",
      body: () => value,
      classifyReturn: () => ({ ok: false, reasonCode: "unreadable" })
    })).resolves.toBe(value);
    const history = journal.read().history;
    expect(history[0]).toMatchObject({ phase: "fail", reasonCode: "io_error" });
    expect(history[1]).toMatchObject({ phase: "fail", reasonCode: "unreadable", result: "error" });
    await journal.flushForTests();
    const file = await readFile(journalPath(), "utf8");
    expect(file).not.toContain("driver SQL");
    expect(file).not.toContain("sentinel");
  });

  it("maps structured reasons, aborts and operating-system I/O without using error text", () => {
    expect(opsStepReasonFromError({ reason: "too_wide" })).toBe("too_large");
    expect(opsStepReasonFromError({ code: "deferred" })).toBe("timeout");
    expect(opsStepReasonFromError({ code: "ambiguous" })).toBe("ambiguous");
    expect(opsStepReasonFromError(new DOMException("stop", "AbortError"))).toBe("aborted");
    expect(opsStepReasonFromError({ code: "EACCES" })).toBe("io_error");
    expect(opsStepReasonFromError({ syscall: "read" })).toBe("io_error");
    expect(opsStepReasonFromError(new Error("timeout in driver text"), "missing")).toBe("missing");
  });

  it("accepts 511/512-byte lines and only format-drops a 513-byte line", async () => {
    const writes: Buffer[] = [];
    const journal = await makeJournal({ stdoutWriter: (line) => {
      writes.push(line);
      return line.length;
    } });
    for (const target of [511, 512, 513]) {
      const baseLength = Buffer.byteLength(fixedLine(""));
      const opId = "x".repeat(target - baseLength);
      expect(Buffer.byteLength(fixedLine(opId))).toBe(target);
      journal.writeStep(stepInput({ opId }));
    }
    expect(writes.map((line) => line.length)).toEqual([511, 512]);
    expect(journal.read().formatDroppedCount).toBe(1);
    expect(journal.read().inFlight).toHaveLength(3);
    await journal.flushForTests();
    const lines = (await readFile(journalPath(), "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => Buffer.byteLength(`${line}\n`))).toEqual([511, 512]);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual([
        "ts", "op", "op_id", "step", "phase", "elapsed_ms", "result", "reason_code"
      ]);
    }
  });

  it("updates memory but neither output channel when serialization fails", async () => {
    let stdoutCalls = 0;
    const journal = await makeJournal({
      stringify: () => {
        throw new Error("cannot serialize");
      },
      stdoutWriter: (line) => {
        stdoutCalls += 1;
        return line.length;
      }
    });
    journal.writeStep(stepInput());
    expect(journal.read().formatDroppedCount).toBe(1);
    expect(journal.read().inFlight).toHaveLength(1);
    expect(stdoutCalls).toBe(0);
    expect(await readFile(journalPath(), "utf8")).toBe("");
  });

  it("isolates a startup residual before history loading and appends independent new lines", async () => {
    const oldOpId = createOpsStepId();
    await mkdir(path.join(root, ".lucy"), { recursive: true });
    await writeFile(journalPath(), `${fixedLine(oldOpId)}{"ts":"partial"}`);
    const journal = await makeJournal();
    expect(journal.read().historyResidual).toBe(true);
    expect(journal.read().fileDroppedCount).toBe(0);
    expect(journal.read().inFlight).toHaveLength(0);
    expect(journal.read().history).toHaveLength(1);
    expect(journal.read().history[0]).toMatchObject({
      opId: oldOpId,
      state: "previous_incomplete",
      enteredAt: FIXED_AT,
      durationMs: null
    });
    expect(await readFile(journalPath(), "utf8")).toBe("");
    expect(await readFile(`${journalPath()}.1`, "utf8")).toContain('{"ts":"partial"}');

    await journal.runStep({
      op: "diagnostic_collect",
      opId: createOpsStepId(),
      step: "read_ktx_yaml",
      body: () => "ok"
    });
    await journal.flushForTests();
    const current = await readFile(journalPath(), "utf8");
    expect(current.endsWith("\n")).toBe(true);
    const lines = current.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => (JSON.parse(line) as { phase: string }).phase)).toEqual(["enter", "leave"]);
    expect(journal.read().fileDroppedCount).toBe(0);
  });

  it("counts stdout errors once and suppresses every line after a short write", async () => {
    let calls = 0;
    const journal = await makeJournal({ stdoutWriter: (line) => {
      calls += 1;
      return line.length;
    } });
    const firstOp = createOpsStepId();
    journal.armStdoutFailureForUat("error");
    await journal.runStep({
      op: "diagnostic_collect",
      opId: firstOp,
      step: "read_project",
      body: () => "ok"
    });
    expect(calls).toBe(1);
    expect(journal.read()).toMatchObject({ stdoutWriteFailed: true, stdoutDroppedCount: 1 });

    const secondOp = createOpsStepId();
    journal.armStdoutFailureForUat("short");
    journal.writeStep(stepInput({ opId: secondOp }));
    expect(calls).toBe(2);
    expect(journal.read().stdoutDroppedCount).toBe(2);
    journal.writeStep(stepInput({ opId: secondOp, phase: "leave" }));
    expect(calls).toBe(2);
    expect(journal.read().stdoutDroppedCount).toBe(3);
    await journal.flushForTests();
    const lines = (await readFile(journalPath(), "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(journal.read().history).toHaveLength(2);
  });

  it("survives real append failure and recovers only after a real successful append", async () => {
    const stdout: Buffer[] = [];
    const journal = await makeJournal({ stdoutWriter: (line) => {
      stdout.push(line);
      return line.length;
    } });
    const filePath = journalPath();
    await rm(filePath);
    await mkdir(filePath);
    journal.writeStep(stepInput({ phase: "enter" }));
    journal.writeStep(stepInput({ phase: "leave" }));
    await journal.flushForTests();
    expect(journal.read()).toMatchObject({
      fileWritable: "error",
      fileWriteReason: "io_error",
      fileDroppedCount: 2
    });
    expect(stdout).toHaveLength(2);

    await rm(filePath, { recursive: true });
    journal.writeStep(stepInput({ opId: createOpsStepId(), phase: "enter" }));
    await journal.flushForTests();
    expect(journal.read()).toMatchObject({
      fileWritable: "ok",
      fileWriteReason: "",
      fileDroppedCount: 2
    });
    expect((await readFile(filePath, "utf8")).trimEnd().split("\n")).toHaveLength(1);
  });

  it("bounds the queue including its active write, drops new lines and preserves memory", async () => {
    const gate = deferred<void>();
    const first = createOpsStepId();
    const second = createOpsStepId();
    const journal = await makeJournal({
      queueMaxBytes: Buffer.byteLength(fixedLine(first)),
      appendFile: async (filePath, line) => {
        await gate.promise;
        await appendFile(filePath, line);
      }
    });
    journal.writeStep(stepInput({ opId: first }));
    journal.writeStep(stepInput({ opId: second }));
    expect(journal.read()).toMatchObject({
      fileWritable: "error",
      fileWriteReason: "queue_full",
      fileDroppedCount: 1
    });
    expect(journal.read().inFlight.map((entry) => entry.opId).sort()).toEqual([first, second].sort());
    gate.resolve();
    await journal.flushForTests();
    expect(journal.read()).toMatchObject({ fileWritable: "ok", fileWriteReason: "", fileDroppedCount: 1 });
    const file = await readFile(journalPath(), "utf8");
    expect(file).toContain(first);
    expect(file).not.toContain(second);
  });

  it("writes accepted file lines in FIFO order", async () => {
    const observed: string[] = [];
    const journal = await makeJournal({
      appendFile: async (filePath, line) => {
        const parsed = JSON.parse(line.toString("utf8")) as { op_id: string };
        observed.push(parsed.op_id);
        await appendFile(filePath, line);
      }
    });
    const opIds = Array.from({ length: 12 }, () => createOpsStepId());
    for (const opId of opIds) journal.writeStep(stepInput({ opId }));
    await journal.flushForTests();
    expect(observed).toEqual(opIds);
  });

  it("rotates twice with an injected small threshold and retains only current plus .1", async () => {
    const journal = await makeJournal({ fileMaxBytes: 300 });
    const opIds = [createOpsStepId(), createOpsStepId(), createOpsStepId()];
    for (const opId of opIds) {
      journal.writeStep(stepInput({ opId }));
      await journal.flushForTests();
      expect(Buffer.byteLength(fixedLine(opId))).toBeLessThan(300);
      expect(Buffer.byteLength(fixedLine(opId))).toBeGreaterThan(150);
    }
    await journal.flushForTests();
    const current = await readFile(journalPath(), "utf8");
    const rotated = await readFile(`${journalPath()}.1`, "utf8");
    expect(current).toContain(opIds[2]);
    expect(current).not.toContain(opIds[1]);
    expect(rotated).toContain(opIds[1]);
    expect(rotated).not.toContain(opIds[0]);
    expect((await stat(journalPath())).size).toBeLessThanOrEqual(300);
    expect((await stat(`${journalPath()}.1`)).size).toBeLessThanOrEqual(300);
    await expect(stat(`${journalPath()}.2`)).rejects.toThrow();
  });

  it("trims whole instances instead of splitting them", async () => {
    const journal = await makeJournal({ historyRowLimit: 1 });
    await journal.runStep({
      op: "runtime_reload",
      opId: createOpsStepId(),
      step: "write_config",
      body: () => "ok"
    });
    const model = journal.read();
    expect(model.history).toHaveLength(0);
    expect(model.history.every((view) => view.state !== "start_truncated")).toBe(true);
    expect(model.historyTruncated).toBe(true);
    expect(model.truncationReasons).toContain("row_limit");
  });

  it("marks a terminal without an enter as start_truncated", async () => {
    const journal = await makeJournal();
    await journal.flushForTests();
    const orphan = `${JSON.stringify({
      ts: FIXED_AT,
      op: "runtime_reload",
      op_id: createOpsStepId(),
      step: "policy_commit",
      phase: "leave",
      elapsed_ms: 10,
      result: "ok",
      reason_code: ""
    })}\n`;
    await writeFile(journalPath(), orphan);
    const reopened = new OpsStepJournal({
      contentRoot: root,
      stdoutWriter: (line) => line.length,
      now: () => new Date(FIXED_AT)
    });
    journals.push(reopened);
    const model = reopened.read();
    expect(model.history).toHaveLength(1);
    expect(model.history[0]).toMatchObject({
      state: "start_truncated",
      enteredAt: null,
      durationMs: null
    });
  });

  it("applies row and age trimming without evicting an old in-flight step", async () => {
    let now = new Date("2026-11-20T08:00:00.000Z");
    let mono = 0;
    const journal = await makeJournal({
      historyRowLimit: 1,
      now: () => now,
      monotonicNow: () => mono
    });
    await journal.runStep({
      op: "diagnostic_collect",
      opId: createOpsStepId(),
      step: "read_project",
      body: () => "old"
    });
    now = new Date("2026-11-20T10:00:00.000Z");
    journal.writeStep(stepInput({
      opId: createOpsStepId(),
      at: now.toISOString()
    }));
    mono = 5_000;
    const model = journal.read();
    expect(model.history).toHaveLength(0);
    expect(model.historyTruncated).toBe(true);
    expect(model.truncationReasons).toEqual(expect.arrayContaining(["age_limit"]));
    expect(model.inFlight).toHaveLength(1);
    expect(model.inFlight[0]).toMatchObject({ state: "running", durationMs: 5_000 });
  });

  it("recreates a deleted current file and keeps appending", async () => {
    const journal = await makeJournal();
    const opId = createOpsStepId();
    journal.writeStep(stepInput({ opId }));
    await journal.flushForTests();
    await rm(journalPath(), { force: true });
    const second = createOpsStepId();
    journal.writeStep(stepInput({ opId: second }));
    await journal.flushForTests();
    const content = await readFile(journalPath(), "utf8");
    expect(content).toContain(second);
    expect(journal.read().fileDroppedCount).toBe(0);
    expect(journal.read().fileWritable).toBe("ok");
  });

  it("keeps a finished sibling and a running sibling in separate partitions", async () => {
    const journal = await makeJournal();
    const opId = createOpsStepId();
    await journal.runStep({
      op: "diagnostic_collect",
      opId,
      step: "read_project",
      body: () => "done"
    });
    const gate = deferred<string>();
    const running = journal.runStep({
      op: "diagnostic_collect",
      opId,
      step: "read_ktx_yaml",
      body: () => gate.promise
    });
    const model = journal.read();
    expect(model.history).toHaveLength(1);
    expect(model.history[0]).toMatchObject({ step: "read_project", state: "ended" });
    expect(model.inFlight).toHaveLength(1);
    expect(model.inFlight[0]).toMatchObject({ step: "read_ktx_yaml", state: "running" });
    gate.resolve("done");
    await expect(running).resolves.toBe("done");
  });

  it("writes byte-identical lines to stdout and to the file", async () => {
    const captured: Buffer[] = [];
    const journal = await makeJournal({ stdoutWriter: (line) => { captured.push(Buffer.from(line)); return line.length; } });
    journal.writeStep(stepInput());
    await journal.flushForTests();
    const file = await readFile(journalPath());
    expect(captured).toHaveLength(1);
    expect(captured[0].equals(file)).toBe(true);
  });

  it("emits a real partial line on a short write and suppresses later lines", async () => {
    const captured: Buffer[] = [];
    const journal = await makeJournal({ stdoutWriter: (line) => { captured.push(Buffer.from(line)); return line.length; } });
    journal.armStdoutFailureForUat("short");
    journal.writeStep(stepInput());
    journal.writeStep(stepInput({ phase: "leave" }));
    await journal.flushForTests();
    expect(captured).toHaveLength(1);
    expect(captured[0].toString("utf8")).not.toContain("\n");
    expect(journal.read().stdoutDroppedCount).toBe(2);
    expect(journal.read().stdoutWriteFailed).toBe(true);
  });

  it("resetForUat clears only this journal's memory and files", async () => {
    const unrelated = path.join(root, ".lucy", "unrelated.txt");
    await mkdir(path.dirname(unrelated), { recursive: true });
    await writeFile(unrelated, "keep");
    const journal = await makeJournal();
    journal.armStdoutFailureForUat("short");
    journal.writeStep(stepInput());
    await journal.flushForTests();
    await journal.resetForUat();
    expect(journal.read()).toMatchObject({
      history: [],
      inFlight: [],
      stdoutDroppedCount: 0,
      fileDroppedCount: 0,
      formatDroppedCount: 0,
      historyResidual: false,
      historyTruncated: false
    });
    expect(await readFile(journalPath(), "utf8")).toBe("");
    expect(await readFile(unrelated, "utf8")).toBe("keep");
  });
});
