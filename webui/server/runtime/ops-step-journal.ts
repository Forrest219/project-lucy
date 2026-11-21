import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeSync
} from "node:fs";
import { appendFile as defaultAppendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

export type OpsOperation =
  | "diagnostic_collect"
  | "runtime_reload"
  | "enabled_tables_save"
  | "schema_structure_read"
  | "sync_section";

export type OpsStepName =
  | "read_project"
  | "read_ktx_yaml"
  | "read_catalog_reloads"
  | "read_reload_state"
  | "probe_execution"
  | "write_config"
  | "catalog_reload"
  | "policy_commit"
  | "execution_reload"
  | "execution_ack"
  | "list_tables"
  | "read_columns"
  | "uat_sync_section";

export type OpsPhase = "enter" | "leave" | "fail";
export type OpsReasonCode =
  | "timeout"
  | "io_error"
  | "aborted"
  | "missing"
  | "unreadable"
  | "too_large"
  | "permission"
  | "ambiguous";
export type OpsResult = "running" | "ok" | "error";

export interface OpsStepWriteInput {
  op: OpsOperation;
  opId: string;
  step: OpsStepName;
  phase: OpsPhase;
  reasonCode?: OpsReasonCode;
  at?: Date | string;
  elapsedMs?: number;
}

export type OpsStepTerminal = { ok: true } | { ok: false; reasonCode: OpsReasonCode };

export interface OpsStepView {
  key: string;
  op: OpsOperation;
  opId: string;
  step: OpsStepName;
  phase: OpsPhase;
  ts: string;
  elapsedMs: number;
  result: OpsResult;
  reasonCode: OpsReasonCode | "";
  state: "running" | "ended" | "previous_incomplete" | "start_truncated";
  enteredAt: string | null;
  durationMs: number | null;
}

export interface OpsStepReadModel {
  history: OpsStepView[];
  inFlight: OpsStepView[];
  historyTruncated: boolean;
  truncationReasons: Array<"row_limit" | "age_limit">;
  stdoutWriteFailed: boolean;
  stdoutDroppedCount: number;
  fileWritable: "ok" | "error" | "unknown";
  fileDroppedCount: number;
  formatDroppedCount: number;
  fileWriteReason: "io_error" | "queue_full" | "";
  historyResidual: boolean;
}

interface OpsStepLine {
  ts: string;
  op: OpsOperation;
  op_id: string;
  step: OpsStepName;
  phase: OpsPhase;
  elapsed_ms: number;
  result: OpsResult;
  reason_code: OpsReasonCode | "";
}

interface StepPair {
  enter: StepEntry | null;
  terminal: StepEntry | null;
  enteredMonoMs: number | null;
  durationMs: number | null;
}

interface StepEntry {
  key: string;
  op: OpsOperation;
  opId: string;
  step: OpsStepName;
  phase: OpsPhase;
  ts: string;
  elapsedMs: number;
  result: OpsResult;
  reasonCode: OpsReasonCode | "";
  source: "history" | "current";
  pair: StepPair;
}

export interface OpsStepJournalOptions {
  contentRoot?: string;
  stdoutWriter?: (line: Buffer) => number;
  appendFile?: (filePath: string, line: Buffer) => Promise<void>;
  fileMaxBytes?: number;
  queueMaxBytes?: number;
  historyRowLimit?: number;
  historyAgeMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  stringify?: (line: OpsStepLine) => string;
}

const OPERATIONS = new Set<OpsOperation>([
  "diagnostic_collect",
  "runtime_reload",
  "enabled_tables_save",
  "schema_structure_read",
  "sync_section"
]);
const STEPS = new Set<OpsStepName>([
  "read_project",
  "read_ktx_yaml",
  "read_catalog_reloads",
  "read_reload_state",
  "probe_execution",
  "write_config",
  "catalog_reload",
  "policy_commit",
  "execution_reload",
  "execution_ack",
  "list_tables",
  "read_columns",
  "uat_sync_section"
]);
const REASONS = new Set<OpsReasonCode>([
  "timeout",
  "io_error",
  "aborted",
  "missing",
  "unreadable",
  "too_large",
  "permission",
  "ambiguous"
]);
const IO_CODES = new Set([
  "EACCES",
  "EAGAIN",
  "EBADF",
  "EBUSY",
  "EEXIST",
  "EFAULT",
  "EIO",
  "EISDIR",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ENOSPC",
  "ENOTDIR",
  "EPERM",
  "EROFS",
  "EWOULDBLOCK"
]);
const LINE_KEYS = ["ts", "op", "op_id", "step", "phase", "elapsed_ms", "result", "reason_code"];

function normalizedReason(value: unknown): OpsReasonCode | null {
  if (value === "too_wide") return "too_large";
  if (value === "deferred") return "timeout";
  return typeof value === "string" && REASONS.has(value as OpsReasonCode)
    ? (value as OpsReasonCode)
    : null;
}

export function opsStepReasonFromError(
  error: unknown,
  fallback: OpsReasonCode = "unreadable"
): OpsReasonCode {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      reason?: unknown;
      reasonCode?: unknown;
      code?: unknown;
      name?: unknown;
      syscall?: unknown;
    };
    for (const value of [candidate.reason, candidate.reasonCode, candidate.code]) {
      const reason = normalizedReason(value);
      if (reason) return reason;
    }
    if (
      candidate.name === "AbortError" ||
      candidate.code === "ABORT_ERR" ||
      candidate.code === "ERR_ABORTED" ||
      candidate.code === "aborted"
    ) {
      return "aborted";
    }
    if (typeof candidate.code === "string" && IO_CODES.has(candidate.code)) return "io_error";
    if (typeof candidate.syscall === "string") return "io_error";
  }
  return fallback;
}

export function createOpsStepId(): string {
  return `ops_${randomBytes(16).toString("hex")}`;
}

export class OpsStepJournal {
  private readonly directory: string;
  private readonly currentPath: string;
  private readonly rotatedPath: string;
  private readonly appendFile: (filePath: string, line: Buffer) => Promise<void>;
  private readonly fileMaxBytes: number;
  private readonly queueMaxBytes: number;
  private readonly historyRowLimit: number;
  private readonly historyAgeMs: number;
  private readonly now: () => Date;
  private readonly monotonicNow: () => number;
  private readonly stringify: (line: OpsStepLine) => string;
  private stdoutWriter: ((line: Buffer) => number) | undefined;
  private stdoutFd: number | undefined;
  private stdoutOpenFailed = false;
  private stdoutSuppressed = false;
  private stdoutFailure: "error" | "short" | null = null;
  private stdoutWriteFailed = false;
  private stdoutDroppedCount = 0;
  private fileDroppedCount = 0;
  private formatDroppedCount = 0;
  private fileWritable: "ok" | "error" | "unknown" = "unknown";
  private fileWriteReason: "io_error" | "queue_full" | "" = "";
  private historyResidual = false;
  private historyTruncated = false;
  private readonly truncationReasons = new Set<"row_limit" | "age_limit">();
  private fileStartupBlocked = false;
  private currentSize = 0;
  private queuedBytes = 0;
  private readonly fileQueue: Buffer[] = [];
  private drainPromise: Promise<void> | null = null;
  private closed = false;
  private nextKey = 0;
  private historyEntries: StepEntry[] = [];
  private currentEntries: StepEntry[] = [];
  private readonly currentActivePairs = new Set<StepPair>();
  private readonly currentActiveByStep = new Map<string, StepPair[]>();
  private readonly operationStarts = new Map<string, number>();

  constructor(options: OpsStepJournalOptions = {}) {
    const fallbackRoot = process.env.VITEST === "true"
      ? path.join(tmpdir(), `lucy-ops-step-journal-${process.pid}`)
      : path.join(process.env.KTX_PROJECT_ROOT?.trim() || process.cwd(), "config");
    const contentRoot = options.contentRoot
      ?? process.env.LUCY_CONTENT_ROOT?.trim()
      ?? fallbackRoot;
    this.directory = path.resolve(contentRoot, ".lucy");
    this.currentPath = path.join(this.directory, "ops-steps.jsonl");
    this.rotatedPath = `${this.currentPath}.1`;
    this.appendFile = options.appendFile ?? ((filePath, line) => defaultAppendFile(filePath, line));
    this.fileMaxBytes = Math.max(1, Math.floor(options.fileMaxBytes ?? 8 * 1024 * 1024));
    this.queueMaxBytes = Math.max(1, Math.floor(options.queueMaxBytes ?? 1024 * 1024));
    this.historyRowLimit = Math.max(0, Math.floor(options.historyRowLimit ?? 2000));
    this.historyAgeMs = Math.max(0, options.historyAgeMs ?? 60 * 60 * 1000);
    this.now = options.now ?? (() => new Date());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.stringify = options.stringify ?? ((line) => JSON.stringify(line));
    this.stdoutWriter = options.stdoutWriter;
    this.initializeFileAndHistory();
  }

  writeStep(input: OpsStepWriteInput): void {
    if (
      !OPERATIONS.has(input.op) ||
      !STEPS.has(input.step) ||
      (input.phase === "fail" && input.reasonCode !== undefined && !REASONS.has(input.reasonCode))
    ) {
      this.formatDroppedCount += 1;
      return;
    }
    const mono = this.monotonicNow();
    if (input.phase === "enter" && !this.operationStarts.has(input.opId)) {
      this.operationStarts.set(input.opId, mono);
      while (this.operationStarts.size > 512) {
        const oldest = this.operationStarts.keys().next();
        if (oldest.done) break;
        this.operationStarts.delete(oldest.value);
      }
    }
    const operationStart = this.operationStarts.get(input.opId) ?? mono;
    const rawElapsedMs = input.elapsedMs ?? Math.max(0, mono - operationStart);
    const elapsedMs = Number.isFinite(rawElapsedMs) ? Math.max(0, Math.floor(rawElapsedMs)) : 0;
    let ts: string;
    try {
      ts = input.at === undefined ? this.now().toISOString() : new Date(input.at).toISOString();
    } catch {
      ts = this.now().toISOString();
    }
    const result: OpsResult = input.phase === "enter" ? "running" : input.phase === "leave" ? "ok" : "error";
    const reasonCode = input.phase === "fail" ? input.reasonCode ?? "unreadable" : "";
    this.applyCurrentMemory({
      op: input.op,
      opId: input.opId,
      step: input.step,
      phase: input.phase,
      ts,
      elapsedMs,
      result,
      reasonCode
    }, mono);

    let line: Buffer;
    try {
      const value: OpsStepLine = {
        ts,
        op: input.op,
        op_id: input.opId,
        step: input.step,
        phase: input.phase,
        elapsed_ms: elapsedMs,
        result,
        reason_code: reasonCode
      };
      const serialized = this.stringify(value);
      if (typeof serialized !== "string") throw new Error("invalid JSON");
      line = Buffer.from(`${serialized}\n`, "utf8");
      if (line.length > 512) throw new Error("line too long");
    } catch {
      this.formatDroppedCount += 1;
      return;
    }

    this.tryStdout(line);
    this.enqueueFile(line);
  }

  async runStep<T>(input: {
    op: OpsOperation;
    opId: string;
    step: OpsStepName;
    body: () => Promise<T> | T;
    classifyReturn?: (value: T) => OpsStepTerminal;
  }): Promise<T> {
    this.writeStep({ op: input.op, opId: input.opId, step: input.step, phase: "enter" });
    let value: T;
    try {
      value = await input.body();
    } catch (error) {
      this.writeStep({
        op: input.op,
        opId: input.opId,
        step: input.step,
        phase: "fail",
        reasonCode: opsStepReasonFromError(error)
      });
      throw error;
    }
    let terminal: OpsStepTerminal;
    try {
      terminal = input.classifyReturn?.(value) ?? { ok: true };
    } catch {
      terminal = { ok: false, reasonCode: "unreadable" };
    }
    this.writeStep({
      op: input.op,
      opId: input.opId,
      step: input.step,
      phase: terminal.ok ? "leave" : "fail",
      reasonCode: terminal.ok ? undefined : terminal.reasonCode
    });
    return value;
  }

  read(): OpsStepReadModel {
    this.pruneHistory();
    const retained = new Set(this.historyEntries.concat(this.currentEntries));
    const historyEntries = this.historyEntries.concat(
      this.currentEntries.filter((entry) => !this.currentActivePairs.has(entry.pair))
    );
    const instances = new Map<StepEntry["pair"], StepEntry[]>();
    for (const entry of historyEntries) {
      const bucket = instances.get(entry.pair) ?? [];
      bucket.push(entry);
      instances.set(entry.pair, bucket);
    }
    const history = Array.from(instances.values()).map((bucket) => {
      const representative = bucket.find((entry) => entry.phase !== "enter") ?? bucket[0];
      return this.toView(representative, retained, false);
    });
    return {
      history,
      inFlight: this.currentEntries
        .filter((entry) => this.currentActivePairs.has(entry.pair))
        .map((entry) => this.toView(entry, retained, true)),
      historyTruncated: this.historyTruncated,
      truncationReasons: Array.from(this.truncationReasons),
      stdoutWriteFailed: this.stdoutWriteFailed,
      stdoutDroppedCount: this.stdoutDroppedCount,
      fileWritable: this.fileWritable,
      fileDroppedCount: this.fileDroppedCount,
      formatDroppedCount: this.formatDroppedCount,
      fileWriteReason: this.fileWriteReason,
      historyResidual: this.historyResidual
    };
  }

  async flushForTests(): Promise<void> {
    while (this.drainPromise || this.fileQueue.length > 0) {
      this.startFileDrain();
      await this.drainPromise;
    }
  }

  async resetForUat(): Promise<void> {
    await this.flushForTests();
    await Promise.all([
      rm(this.currentPath, { force: true }),
      rm(this.rotatedPath, { force: true })
    ]);
    this.historyEntries = [];
    this.currentEntries = [];
    this.currentActivePairs.clear();
    this.currentActiveByStep.clear();
    this.operationStarts.clear();
    this.nextKey = 0;
    this.stdoutWriteFailed = false;
    this.stdoutDroppedCount = 0;
    this.stdoutSuppressed = false;
    this.stdoutFailure = null;
    this.fileDroppedCount = 0;
    this.formatDroppedCount = 0;
    this.fileWritable = "unknown";
    this.fileWriteReason = "";
    this.historyResidual = false;
    this.historyTruncated = false;
    this.truncationReasons.clear();
    this.fileStartupBlocked = false;
    this.currentSize = 0;
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(this.currentPath, "", { flag: "a" });
    } catch {
      this.fileWritable = "error";
      this.fileWriteReason = "io_error";
      this.fileStartupBlocked = true;
    }
  }

  async closeForTests(): Promise<void> {
    this.terminalizeInFlight("aborted");
    await this.flushForTests();
    this.closed = true;
    if (this.stdoutFd !== undefined) {
      try {
        closeSync(this.stdoutFd);
      } catch {
      }
      this.stdoutFd = undefined;
    }
    this.stdoutWriter = undefined;
    this.stdoutOpenFailed = true;
  }

  private terminalizeInFlight(reasonCode: OpsReasonCode): void {
    for (const pair of [...this.currentActivePairs]) {
      const enter = pair.enter;
      if (!enter || pair.terminal) continue;
      this.writeStep({
        op: enter.op,
        opId: enter.opId,
        step: enter.step,
        phase: "fail",
        reasonCode
      });
    }
  }

  armStdoutFailureForUat(mode: "error" | "short"): void {
    this.stdoutFailure = mode;
  }

  private applyCurrentMemory(
    value: Omit<OpsStepLine, "op_id" | "elapsed_ms" | "reason_code"> & {
      opId: string;
      elapsedMs: number;
      reasonCode: OpsReasonCode | "";
    },
    mono: number
  ): void {
    const entry: StepEntry = {
      key: `current:${this.nextKey++}`,
      op: value.op,
      opId: value.opId,
      step: value.step,
      phase: value.phase,
      ts: value.ts,
      elapsedMs: value.elapsedMs,
      result: value.result,
      reasonCode: value.reasonCode,
      source: "current",
      pair: { enter: null, terminal: null, enteredMonoMs: null, durationMs: null }
    };
    const pairKey = `${value.opId}\0${value.step}`;
    if (value.phase === "enter") {
      entry.pair.enter = entry;
      entry.pair.enteredMonoMs = mono;
      this.currentEntries.push(entry);
      this.currentActivePairs.add(entry.pair);
      const queue = this.currentActiveByStep.get(pairKey) ?? [];
      queue.push(entry.pair);
      this.currentActiveByStep.set(pairKey, queue);
    } else {
      const queue = this.currentActiveByStep.get(pairKey);
      const pair = queue?.shift() ?? null;
      if (queue && queue.length === 0) this.currentActiveByStep.delete(pairKey);
      if (pair) {
        entry.pair = pair;
        pair.terminal = entry;
        pair.durationMs = pair.enteredMonoMs === null ? null : Math.max(0, mono - pair.enteredMonoMs);
        this.currentActivePairs.delete(pair);
      } else {
        entry.pair.terminal = entry;
      }
      this.currentEntries.push(entry);
    }
  }

  private tryStdout(line: Buffer): void {
    if (this.stdoutSuppressed) {
      this.stdoutDroppedCount += 1;
      return;
    }
    try {
      const armed = this.stdoutFailure;
      this.stdoutFailure = null;
      let written: number;
      if (armed === "error") {
        throw new Error("injected stdout error");
      } else if (armed === "short") {
        const partial = line.subarray(0, Math.max(0, line.length - 1));
        written = this.getStdoutWriter()(partial);
      } else {
        written = this.getStdoutWriter()(line);
      }
      if (written !== line.length) {
        this.stdoutDroppedCount += 1;
        this.stdoutWriteFailed = true;
        this.stdoutSuppressed = true;
      }
    } catch {
      this.stdoutDroppedCount += 1;
      this.stdoutWriteFailed = true;
    }
  }

  private getStdoutWriter(): (line: Buffer) => number {
    if (this.stdoutWriter) return this.stdoutWriter;
    if (process.platform !== "linux") {
      // /dev/fd/1 on macOS is a dup of fd 1: opening it with O_NONBLOCK would
      // change the shared open file description and make ordinary console
      // writes fail with EAGAIN. Only Linux reopens the pipe through
      // /proc/self/fd/1 with an independent description.
      this.stdoutWriter = (line) => {
        process.stdout.write(line);
        return line.length;
      };
      return this.stdoutWriter;
    }
    if (this.stdoutFd === undefined) {
      if (this.stdoutOpenFailed) throw new Error("stdout unavailable");
      try {
        const fd = openSync("/proc/self/fd/1", constants.O_WRONLY | constants.O_NONBLOCK);
        const stats = fstatSync(fd);
        if (!stats.isFIFO() && !stats.isSocket()) {
          // A regular file or terminal keeps a shared offset: a second
          // description would write at offset 0 and overwrite existing logs.
          closeSync(fd);
          this.stdoutWriter = (line) => writeSync(1, line);
          return this.stdoutWriter;
        }
        this.stdoutFd = fd;
      } catch {
        this.stdoutOpenFailed = true;
        throw new Error("stdout unavailable");
      }
    }
    const fd = this.stdoutFd;
    this.stdoutWriter = (line) => writeSync(fd, line);
    return this.stdoutWriter;
  }

  private enqueueFile(line: Buffer): void {
    if (this.closed || this.fileStartupBlocked) {
      this.fileDroppedCount += 1;
      this.fileWritable = "error";
      this.fileWriteReason = "io_error";
      return;
    }
    if (this.queuedBytes + line.length > this.queueMaxBytes) {
      this.fileDroppedCount += 1;
      this.fileWritable = "error";
      this.fileWriteReason = "queue_full";
      return;
    }
    this.fileQueue.push(line);
    this.queuedBytes += line.length;
    this.startFileDrain();
  }

  private startFileDrain(): void {
    if (this.drainPromise || this.fileQueue.length === 0) return;
    this.drainPromise = this.drainFileQueue().finally(() => {
      this.drainPromise = null;
      this.startFileDrain();
    });
  }

  private async drainFileQueue(): Promise<void> {
    while (this.fileQueue.length > 0) {
      const line = this.fileQueue.shift() as Buffer;
      try {
        await this.appendWithRotation(line);
        this.fileWritable = "ok";
        this.fileWriteReason = "";
      } catch {
        this.fileDroppedCount += 1;
        this.fileWritable = "error";
        this.fileWriteReason = "io_error";
      } finally {
        this.queuedBytes -= line.length;
      }
    }
  }

  private async appendWithRotation(line: Buffer): Promise<void> {
    await this.ensureCurrentFile();
    if (this.currentSize > 0 && this.currentSize + line.length > this.fileMaxBytes) {
      try {
        await rename(this.currentPath, this.rotatedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await writeFile(this.currentPath, "", { flag: "a" });
        this.currentSize = 0;
      }
      this.currentSize = 0;
      await this.ensureCurrentFile();
    }
    await this.appendFile(this.currentPath, line);
    this.currentSize += line.length;
  }

  /** Recreate a missing current file and re-sync the tracked size with disk. */
  private async ensureCurrentFile(): Promise<void> {
    try {
      const stats = await stat(this.currentPath);
      if (stats.isFile()) {
        this.currentSize = stats.size;
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(this.currentPath, "", { flag: "a" });
    this.currentSize = 0;
  }

  private initializeFileAndHistory(): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      let residual = false;
      if (existsSync(this.currentPath)) {
        const stats = statSync(this.currentPath);
        this.currentSize = stats.size;
        if (stats.size > 0) {
          const fd = openSync(this.currentPath, "r");
          const last = Buffer.alloc(1);
          try {
            readSync(fd, last, 0, 1, stats.size - 1);
          } finally {
            closeSync(fd);
          }
          residual = last[0] !== 10;
        }
      }
      if (residual) {
        try {
          renameSync(this.currentPath, this.rotatedPath);
          const fd = openSync(this.currentPath, "a");
          closeSync(fd);
          this.currentSize = 0;
          this.historyResidual = true;
        } catch {
          this.fileStartupBlocked = true;
          this.fileWritable = "error";
          this.fileWriteReason = "io_error";
        }
      } else if (!existsSync(this.currentPath)) {
        const fd = openSync(this.currentPath, "a");
        closeSync(fd);
        this.currentSize = 0;
      }
    } catch {
      this.fileWritable = "error";
      this.fileWriteReason = "io_error";
    }
    this.loadHistory();
  }

  private loadHistory(): void {
    const historyPairs = new Map<string, StepPair[]>();
    for (const filePath of [this.rotatedPath, this.currentPath]) {
      if (!existsSync(filePath)) continue;
      let content: string;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        this.fileWritable = "error";
        this.fileWriteReason = "io_error";
        continue;
      }
      const parts = content.split("\n");
      for (let index = 0; index < parts.length; index += 1) {
        if (index === parts.length - 1 && parts[index] !== "") continue;
        const line = this.parseHistoryLine(parts[index]);
        if (!line) continue;
        const entry: StepEntry = {
          key: `history:${this.nextKey++}`,
          op: line.op,
          opId: line.op_id,
          step: line.step,
          phase: line.phase,
          ts: line.ts,
          elapsedMs: line.elapsed_ms,
          result: line.result,
          reasonCode: line.reason_code,
          source: "history",
          pair: { enter: null, terminal: null, enteredMonoMs: null, durationMs: null }
        };
        const pairKey = `${line.op_id}\0${line.step}`;
        if (line.phase === "enter") {
          entry.pair.enter = entry;
          const queue = historyPairs.get(pairKey) ?? [];
          queue.push(entry.pair);
          historyPairs.set(pairKey, queue);
        } else {
          const queue = historyPairs.get(pairKey);
          const pair = queue?.shift() ?? null;
          if (queue && queue.length === 0) historyPairs.delete(pairKey);
          if (pair) {
            entry.pair = pair;
            pair.terminal = entry;
            if (pair.enter) {
              pair.durationMs = Math.max(0, Date.parse(line.ts) - Date.parse(pair.enter.ts));
            }
          } else {
            entry.pair.terminal = entry;
          }
        }
        this.historyEntries.push(entry);
      }
    }
  }

  private parseHistoryLine(text: string): OpsStepLine | null {
    if (!text) return null;
    try {
      const value = JSON.parse(text) as Partial<OpsStepLine>;
      if (Object.keys(value).join(",") !== LINE_KEYS.join(",")) return null;
      if (
        typeof value.ts !== "string" ||
        !Number.isFinite(Date.parse(value.ts)) ||
        typeof value.op_id !== "string" ||
        !OPERATIONS.has(value.op as OpsOperation) ||
        !STEPS.has(value.step as OpsStepName) ||
        (value.phase !== "enter" && value.phase !== "leave" && value.phase !== "fail") ||
        typeof value.elapsed_ms !== "number" ||
        !Number.isInteger(value.elapsed_ms) ||
        value.elapsed_ms < 0
      ) {
        return null;
      }
      const expectedResult: OpsResult = value.phase === "enter" ? "running" : value.phase === "leave" ? "ok" : "error";
      if (value.result !== expectedResult) return null;
      if (value.phase === "fail") {
        if (!REASONS.has(value.reason_code as OpsReasonCode)) return null;
      } else if (value.reason_code !== "") {
        return null;
      }
      return value as OpsStepLine;
    } catch {
      return null;
    }
  }

  private pruneHistory(): void {
    const candidates = this.historyEntries.concat(
      this.currentEntries.filter((entry) => !this.currentActivePairs.has(entry.pair))
    );
    const groups = new Map<StepPair, StepEntry[]>();
    const order: StepPair[] = [];
    for (const entry of candidates) {
      let bucket = groups.get(entry.pair);
      if (!bucket) {
        bucket = [];
        groups.set(entry.pair, bucket);
        order.push(entry.pair);
      }
      bucket.push(entry);
    }
    const cutoff = this.now().getTime() - this.historyAgeMs;
    const kept = new Set<StepEntry>();
    let rows = 0;
    let rowTruncated = false;
    let ageTruncated = false;
    const ageKept: StepEntry[][] = [];
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const bucket = groups.get(order[index]) as StepEntry[];
      const newestTs = bucket.reduce((max, entry) => Math.max(max, Date.parse(entry.ts)), 0);
      if (newestTs < cutoff) {
        ageTruncated = true;
        continue;
      }
      ageKept.push(bucket);
    }
    for (const bucket of ageKept) {
      if (rows + bucket.length > this.historyRowLimit) {
        rowTruncated = true;
        continue;
      }
      rows += bucket.length;
      for (const entry of bucket) kept.add(entry);
    }
    if (rowTruncated) {
      this.historyTruncated = true;
      this.truncationReasons.add("row_limit");
    }
    if (ageTruncated) {
      this.historyTruncated = true;
      this.truncationReasons.add("age_limit");
    }
    this.historyEntries = this.historyEntries.filter((entry) => kept.has(entry));
    this.currentEntries = this.currentEntries.filter(
      (entry) => this.currentActivePairs.has(entry.pair) || kept.has(entry)
    );
  }

  private toView(entry: StepEntry, retained: Set<StepEntry>, inFlight: boolean): OpsStepView {
    let state: OpsStepView["state"];
    let enteredAt: string | null = null;
    let durationMs: number | null = null;
    const pair = entry.pair;
    if (inFlight) {
      state = "running";
      enteredAt = entry.ts;
      durationMs = pair.enteredMonoMs === null
        ? null
        : Math.max(0, Math.floor(this.monotonicNow() - pair.enteredMonoMs));
    } else if (!pair.enter) {
      state = "start_truncated";
    } else if (!pair.terminal) {
      state = "previous_incomplete";
      enteredAt = pair.enter.ts;
    } else if (!retained.has(pair.enter)) {
      state = "start_truncated";
    } else if (!retained.has(pair.terminal)) {
      state = "previous_incomplete";
      enteredAt = pair.enter.ts;
    } else {
      state = "ended";
      enteredAt = pair.enter.ts;
      durationMs = pair.durationMs;
    }
    return {
      key: entry.key,
      op: entry.op,
      opId: entry.opId,
      step: entry.step,
      phase: entry.phase,
      ts: entry.ts,
      elapsedMs: entry.elapsedMs,
      result: entry.result,
      reasonCode: entry.reasonCode,
      state,
      enteredAt,
      durationMs
    };
  }
}

let singleton: OpsStepJournal | undefined;

export function getOpsStepJournal(): OpsStepJournal {
  singleton ??= new OpsStepJournal();
  return singleton;
}

export function resetOpsStepJournalForTests(): void {
  if (singleton) void singleton.closeForTests();
  singleton = undefined;
}
