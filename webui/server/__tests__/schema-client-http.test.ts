import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";

const ctx = vi.hoisted(() => ({
  tick: 0, columns: 1, reject: "", threshold: 1,
  seen: [] as string[], requests: [] as { size: number; elapsed: number }[]
}));
vi.mock("../metadata-channel", async (original) => ({
  ...await original<typeof import("../metadata-channel")>(),
  openMetadataChannel: async () => ({
    close() {},
    async run(sql: string, options: { maxRows: number }) {
      ctx.tick += 6_000;
      const selected = [...sql.matchAll(/'(t\d+)'/g)].map((m) => m[1]);
      if (sql.includes("FROM information_schema.tables")) return { rows: selected.map((t) => [t]), truncated: false };
      if (selected.length > ctx.threshold) return { rows: [], truncated: true };
      ctx.seen.push(...selected);
      if (selected.includes(ctx.reject)) throw new Error("permission denied; private driver stderr SELECT secret");
      const rows = selected.flatMap((t) => Array.from({ length: ctx.columns }, (_, i) => [t, `c${i}`, "int", "YES", "", ""]));
      return { rows: rows.slice(0, options.maxRows), truncated: rows.length >= options.maxRows };
    }
  })
}));

let root: string;
let app: ReturnType<typeof import("../index").buildServer>;
let base: string;
const nativeFetch = globalThis.fetch;

beforeEach(async () => {
  vi.resetModules();
  ctx.tick = Date.now(); ctx.columns = 1; ctx.reject = ""; ctx.threshold = 1;
  ctx.seen = []; ctx.requests = [];
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-schema-http-"));
  await writeFile(path.join(root, "ktx.yaml"), "connections:\n  c:\n    driver: mysql\n    host: isolated\n    database: s\n    schemas: [s]\n");
  vi.stubEnv("KTX_PROJECT_ROOT", root);
  vi.stubEnv("LUCY_CONTENT_ROOT", ".");
  vi.stubEnv("LUCY_AUDIT_DB", path.join(root, "audit.sqlite"));
  vi.spyOn(Date, "now").mockImplementation(() => ctx.tick);
  const { buildServer } = await import("../index");
  app = buildServer();
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const start = ctx.tick;
    const result = await nativeFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, options);
    if (options?.body && typeof options.body === "string") {
      const body = JSON.parse(options.body);
      if (body.tables) ctx.requests.push({ size: body.tables.length, elapsed: ctx.tick - start });
    }
    return result;
  });
});

afterEach(async () => {
  await app?.close();
  const { closeRebuildWriteWorker } = await import("../proxy/audit-rebuild-write");
  await closeRebuildWriteWorker();
  const { closeAuditDb } = await import("../proxy/audit");
  closeAuditDb();
  const { resetAuditDbForTests } = await import("../admin/audit");
  resetAuditDbForTests();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

it("LS-20/26 reads 29 legal tables through real HTTP after a singleton 400 and keeps direct rejection", async () => {
  ctx.reject = "t0";
  const direct = await fetch(base + "/api/connections/c/schema-structure", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schema: "s", tables: ["t0"] })
  });
  expect(direct.status).toBe(400);
  const envelope = await direct.json();
  expect(envelope.error.detail.tableRejection).toEqual({ scope: "table", table: "t0", reason: "permission" });
  expect(JSON.stringify(envelope)).not.toMatch(/SELECT secret|private driver stderr/);
  ctx.seen = []; ctx.requests = [];
  const { readCheckedTableColumns } = await import("../../src/lib/prepareSchemaStructure");
  const names = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const error = await readCheckedTableColumns("c", "s", names).catch((e) => e);
  expect(error.message).toContain("有 1 张表没有读到字段");
  expect(error.message).toContain("t0");
  expect(ctx.seen).toEqual(names);
  expect(error.data.partial.tableCount).toBe(29);
  expect(Object.keys(parse(error.data.partial.yaml).tables)).toEqual(names.slice(1));
});

it("LS-19/30 traverses three truncations with real preview and bounds every virtual HTTP response", async () => {
  ctx.threshold = 7; ctx.columns = 400;
  const { readCheckedTableColumns } = await import("../../src/lib/prepareSchemaStructure");
  const result = await readCheckedTableColumns("c", "s", Array.from({ length: 50 }, (_, i) => `t${i}`));
  expect(ctx.requests.slice(0, 3).map((r) => r.size)).toEqual([50, 25, 13]);
  expect(ctx.requests.every((r) => r.elapsed <= 20_000)).toBe(true);
  expect(ctx.requests.length).toBeLessThanOrEqual(100);
  expect(result.tableCount).toBe(50);
  expect(result.columnCount).toBe(20_000);
  expect(Object.values(parse(result.yaml).tables).every((t: any) => t.columns.length === 400)).toBe(true);
});
