import { describe, expect, it } from "vitest";
import request from "supertest";
import { QUESTION_BUDGET_MAX_CALLS } from "../proxy/question-experience.js";

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * REQ-030-035／P1-14：calls.csv 字段说明含预算列；v2 metadata 排除；导出表头含扁平列。
 */
describe("budget retrospective CSV export (REQ-030-035)", () => {
  it("v1 export-metadata includes budget columns; v2 excludes them", async () => {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    try {
      const calls = await request(app.server)
        .get("/api/admin/audit/export-metadata?kind=calls")
        .expect(200);
      const names = (calls.body.fields as Array<{ name: string }>).map((f) => f.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "budget_event_kind",
          "budget_exhausted_by",
          "budget_calls",
          "budget_busy_ms",
          "budget_elapsed_ms",
          "budget_attempts",
          "budget_max_calls",
          "budget_max_busy_ms",
          "budget_max_wall_ms",
          "budget_wall_mode",
          "budget_window_id",
          "budget_continuations"
        ])
      );
      // 表尾 additive：budget_continuations 应为最后一列之一
      expect(names[names.length - 1]).toBe("budget_continuations");

      const v2 = await request(app.server)
        .get("/api/admin/audit/v2/export-metadata?kind=calls")
        .expect(200);
      const v2Names = (v2.body.fields as Array<{ name: string }>).map((f) => f.name);
      expect(v2Names).not.toContain("budget_event_kind");
      expect(v2Names).not.toContain("budget_exhausted_by");
      expect(v2Names).not.toContain("budget_continuations");
    } finally {
      await app.close();
    }
  });

  it("calls.csv header lists budget columns; snapshot row fills them; plain row stays empty", async () => {
    const { writeLog } = await import("../proxy/audit.js");
    const { buildServer } = await import("../index.js");

    await writeLog({
      ts: new Date().toISOString(),
      userId: "budget-retro-user",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 1,
      requestId: "budget-retro-plain",
      argsSummary: { connectionId: "demo" }
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "budget-retro-user",
      tool: "lucy_query",
      outcome: "budget_stop",
      decisionReason: "question_budget_exhausted",
      durationMs: 1,
      requestId: "budget-retro-stop",
      argsSummary: {
        budgetSnapshot: {
          schemaVersion: "lucy-budget-snapshot/v1",
          eventKind: "budget_stop",
          exhaustedBy: "calls",
          calls: QUESTION_BUDGET_MAX_CALLS,
          busyMs: 1200,
          elapsedMs: null,
          attempts: QUESTION_BUDGET_MAX_CALLS,
          maxCalls: QUESTION_BUDGET_MAX_CALLS,
          maxBusyMs: 300_000,
          maxWallMs: 300_000,
          wallMode: "settled",
          windowId: 0,
          round: 0,
          continuations: 0,
          archivedBusyMsByWindow: {}
        }
      }
    });

    const app = buildServer();
    await app.ready();
    try {
      const csvRes = await request(app.server).get("/api/admin/audit/export").expect(200);
      const body = csvRes.text.replace(/^\uFEFF/, "");
      const lines = body.trimEnd().split("\n");
      const headerCols = parseCsvLine(lines[0]!);
      expect(headerCols).toEqual(
        expect.arrayContaining([
          "budget_event_kind",
          "budget_exhausted_by",
          "budget_calls",
          "budget_continuations"
        ])
      );
      expect(headerCols[headerCols.length - 1]).toBe("budget_continuations");

      const eventKindIdx = headerCols.indexOf("budget_event_kind");
      const exhaustedIdx = headerCols.indexOf("budget_exhausted_by");
      const callsIdx = headerCols.indexOf("budget_calls");
      const requestIdIdx = headerCols.indexOf("request_id");

      const rows = lines.slice(1).map(parseCsvLine);
      const stopRow = rows.find((row) => row[requestIdIdx] === "budget-retro-stop");
      expect(stopRow).toBeTruthy();
      expect(stopRow![eventKindIdx]).toBe("budget_stop");
      expect(stopRow![exhaustedIdx]).toBe("calls");
      expect(stopRow![callsIdx]).toBe(String(QUESTION_BUDGET_MAX_CALLS));
      expect(stopRow!.length).toBe(headerCols.length);

      const plainRow = rows.find((row) => row[requestIdIdx] === "budget-retro-plain");
      expect(plainRow).toBeTruthy();
      expect(plainRow![eventKindIdx]).toBe("");
      expect(plainRow!.length).toBe(headerCols.length);
    } finally {
      await app.close();
    }
  });
});
