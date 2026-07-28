import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendIngestRun,
  ingestFailureHint,
  readIngestRuns,
  redactIngestLog,
  type IngestRun
} from "../ingest-runs";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-webui-ingest-runs-"));
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function makeRun(overrides: Partial<IngestRun> = {}): IngestRun {
  return {
    id: "ing_test_demo_mysql",
    connectionId: "demo-mysql",
    schema: "dataforai",
    requestedScope: "connection",
    executedScope: "connection",
    schemaScopedSupported: false,
    status: "success",
    startedAt: "2026-07-28T10:30:00.000Z",
    finishedAt: "2026-07-28T10:30:01.245Z",
    durationMs: 1245,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    command: ["ktx", "ingest", "demo-mysql"],
    scannedTableCount: 3,
    scannedSchemas: ["dataforai"],
    ...overrides
  };
}

describe("ingest-runs sidecar", () => {
  it("returns an empty payload when no sidecar exists", async () => {
    await expect(readIngestRuns(projectRoot)).resolves.toEqual({
      runs: [],
      lastByConnection: {}
    });
  });

  it("persists appended runs into .ktx-ui/ingest-runs.json", async () => {
    const run = makeRun();
    const result = await appendIngestRun(projectRoot, run);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toEqual(run);
    expect(result.lastByConnection["demo-mysql"]).toEqual(run);

    const raw = await readFile(path.join(projectRoot, ".ktx-ui", "ingest-runs.json"), "utf8");
    const parsed = JSON.parse(raw) as { runs: IngestRun[]; lastByConnection: Record<string, IngestRun> };
    expect(parsed.runs).toEqual([run]);
  });

  it("keeps only the most recent 20 runs", async () => {
    for (let index = 0; index < 25; index += 1) {
      await appendIngestRun(
        projectRoot,
        makeRun({
          id: `ing_${index.toString().padStart(2, "0")}`,
          startedAt: new Date(2026, 6, 28, 10, index, 0).toISOString(),
          finishedAt: new Date(2026, 6, 28, 10, index, 1).toISOString()
        })
      );
    }

    const result = await readIngestRuns(projectRoot);
    expect(result.runs).toHaveLength(20);
    expect(result.runs[0]?.id).toBe("ing_05");
    expect(result.runs[19]?.id).toBe("ing_24");
  });

  it("truncates stdout and stderr to 16KB before persisting", async () => {
    const hugeStdout = "x".repeat(40_000);
    const hugeStderr = "y".repeat(40_000);

    const result = await appendIngestRun(
      projectRoot,
      makeRun({
        stdout: hugeStdout,
        stderr: hugeStderr
      })
    );

    expect(result.runs[0]?.stdout?.length).toBe(16 * 1024);
    expect(result.runs[0]?.stderr?.length).toBe(16 * 1024);
  });

  it("redacts obvious secrets in stdout and stderr before persisting", async () => {
    const result = await appendIngestRun(
      projectRoot,
      makeRun({
        stdout: "loaded token=abcdef0123456789 plain",
        stderr: "DSN password=hunter2 sent; Authorization: Bearer eyJabc.def.ghi"
      })
    );

    const stdout = result.runs[0]?.stdout ?? "";
    const stderr = result.runs[0]?.stderr ?? "";
    expect(stdout).toContain("token=[REDACTED]");
    expect(stdout).not.toContain("abcdef0123456789");
    expect(stderr).toContain("password=[REDACTED]");
    expect(stderr).toContain("Authorization: [REDACTED]");
    expect(stderr).not.toContain("hunter2");
    expect(stderr).not.toContain("eyJabc.def.ghi");
  });

  it("picks the newest finished run per connection as lastByConnection", async () => {
    await appendIngestRun(
      projectRoot,
      makeRun({
        id: "ing_a_old",
        finishedAt: "2026-07-28T10:00:00.000Z",
        startedAt: "2026-07-28T09:59:59.000Z"
      })
    );
    await appendIngestRun(
      projectRoot,
      makeRun({
        id: "ing_b_new",
        finishedAt: "2026-07-28T10:30:00.000Z",
        startedAt: "2026-07-28T10:29:59.000Z"
      })
    );
    await appendIngestRun(
      projectRoot,
      makeRun({
        id: "ing_c_other_conn",
        connectionId: "other-mysql",
        finishedAt: "2026-07-28T11:00:00.000Z",
        startedAt: "2026-07-28T10:59:59.000Z"
      })
    );

    const result = await readIngestRuns(projectRoot);
    expect(result.lastByConnection["demo-mysql"]?.id).toBe("ing_b_new");
    expect(result.lastByConnection["other-mysql"]?.id).toBe("ing_c_other_conn");
  });

  it("ignores running entries when picking lastByConnection", async () => {
    await appendIngestRun(
      projectRoot,
      makeRun({
        id: "ing_finished",
        status: "success",
        finishedAt: "2026-07-28T10:00:00.000Z"
      })
    );
    await appendIngestRun(
      projectRoot,
      makeRun({
        id: "ing_in_progress",
        status: "running",
        // Note: no finishedAt set.
      })
    );

    const result = await readIngestRuns(projectRoot);
    expect(result.lastByConnection["demo-mysql"]?.id).toBe("ing_finished");
  });
});

describe("redactIngestLog", () => {
  it("redacts password/token/api-key/--flag forms", () => {
    const input =
      "password=secret123 token=tok_abc " +
      "PASSWORD=CaseInsensitive api_key=k1 --token=hidden";
    const output = redactIngestLog(input);
    expect(output).toContain("password=[REDACTED]");
    expect(output).toContain("token=[REDACTED]");
    expect(output).toContain("PASSWORD=[REDACTED]");
    expect(output).toContain("api_key=[REDACTED]");
    expect(output).toContain("--token=[REDACTED]");
    expect(output).not.toContain("secret123");
    expect(output).not.toContain("tok_abc");
  });

  it("redacts Authorization single-token values", () => {
    const input = "Authorization: Bearer abc123";
    const output = redactIngestLog(input);
    expect(output).toBe("Authorization: [REDACTED]");
    expect(output).not.toContain("abc123");
  });

  it("redacts DSN-style multi-word keys like 'dsn password'", () => {
    const input = "DSN password=hunter2 sent";
    const output = redactIngestLog(input);
    expect(output).toMatch(/DSN password=\[REDACTED\]/i);
    expect(output).not.toContain("hunter2");
  });

  it("is a no-op for empty strings", () => {
    expect(redactIngestLog("")).toBe("");
  });
});

describe("ingestFailureHint", () => {
  it("points at unknown database for missing schema", () => {
    expect(ingestFailureHint("demo-mysql", "openclaw_db", "Unknown database 'openclaw_db'"))
      .toContain("物理库");
  });

  it("points at access denied for permission errors", () => {
    expect(ingestFailureHint("demo-mysql", "dataforai", "Access denied for user 'l'"))
      .toMatch(/权限|permission/i);
  });

  it("points at empty result for 0 tables scenarios", () => {
    expect(ingestFailureHint("demo-mysql", "dataforai", "scanned 0 tables"))
      .toMatch(/0|no tables/i);
  });

  it("falls back to a generic message when stderr does not match any rule", () => {
    const hint = ingestFailureHint("demo-mysql", "dataforai", "totally unknown boom");
    expect(hint).toMatch(/stderr/);
  });
});
