/**
 * Access grade is orthogonal to Spec 189 usage class.
 * SQL and TypeScript must agree on the same tool name.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  accessGrade,
  accessGradeSql,
  classifyUsage
} from "../proxy/usage-classification.js";

const CASES: Array<{ tool: string | null; grade: ReturnType<typeof accessGrade> }> = [
  { tool: "initialize", grade: "connect" },
  { tool: "notifications/initialized", grade: "connect" },
  { tool: "tools/list", grade: "connect" },
  { tool: "server/discover", grade: "connect" },
  { tool: "server/anything-new", grade: "connect" },
  { tool: "lucy_catalog", grade: "browse" },
  { tool: "connection_list", grade: "browse" },
  { tool: "wiki_read", grade: "prepare" },
  { tool: "lucy_read_source", grade: "prepare" },
  { tool: "resources/read", grade: "prepare" },
  { tool: "prompts/get", grade: "prepare" },
  { tool: "lucy_begin_question", grade: "ask" },
  { tool: "lucy_query", grade: "query" },
  { tool: "lucy_explain_query", grade: "query" },
  { tool: "lucy_certified_route", grade: "query" },
  { tool: "lucy_report_template", grade: "query" },
  { tool: "lucy_ops_source_import", grade: "control" },
  { tool: "lucy_ops_connection_tables", grade: "control" },
  { tool: "not_a_lucy_tool", grade: "unclassified" },
  { tool: "", grade: "unclassified" },
  { tool: null, grade: "unclassified" }
];

describe("access grade", () => {
  it("SC-01 initialize is connect and still a protocol event", () => {
    expect(accessGrade("initialize")).toBe("connect");
    expect(classifyUsage({ tool: "initialize" })).toBe("protocol");
  });

  it("SC-02 lucy_catalog is browse and still default usage", () => {
    expect(accessGrade("lucy_catalog")).toBe("browse");
    expect(classifyUsage({ tool: "lucy_catalog" })).toBe("default_usage");
  });

  it("SC-03 wiki_read, lucy_read_source and resources/read are prepare, not query", () => {
    for (const tool of ["wiki_read", "lucy_read_source", "resources/read"]) {
      expect(accessGrade(tool)).toBe("prepare");
      expect(accessGrade(tool)).not.toBe("query");
    }
  });

  it("SC-16 an unknown tool is unclassified", () => {
    expect(accessGrade("not_a_lucy_tool")).toBe("unclassified");
  });

  it("SC-26 TypeScript and SQLite assign the same grade", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE access_log (tool TEXT)");
      const insert = db.prepare("INSERT INTO access_log (tool) VALUES (?)");
      const select = db.prepare(`SELECT ${accessGradeSql().sql} AS grade FROM access_log WHERE rowid = ?`);
      for (const entry of CASES) {
        const row = insert.run(entry.tool);
        const sql = select.get(row.lastInsertRowid) as { grade: string };
        expect(accessGrade(entry.tool), String(entry.tool)).toBe(entry.grade);
        expect(sql.grade, String(entry.tool)).toBe(entry.grade);
      }
    } finally {
      db.close();
    }
  });
});
