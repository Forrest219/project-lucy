import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import { readCheckedTableColumns } from "../lib/prepareSchemaStructure";

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("../lib/apiClient", async (original) => ({
  ...await original<typeof import("../lib/apiClient")>(), apiPost
}));

function response(names: string[], deferred: string[] = []) {
  return {
    schema: "s", readable: true, namesOnly: false,
    yaml: `tables:\n${names.map((name) => `  ${name}:\n    table: s.${name}\n    columns:\n      - name: id\n        type: number\n`).join("")}`,
    tableCount: names.length, columnCount: names.length,
    mapped: { number: names.length, string: 0, time: 0 }, downgraded: [], deferred
  };
}

beforeEach(() => { apiPost.mockReset(); });

it("LS-27 reads all 600 legal tables after shrinking to singleton batches", async () => {
  const names = Array.from({ length: 600 }, (_, index) => `t${index}`);
  apiPost.mockImplementation(async (_: string, { tables }: { tables: string[] }) =>
    tables.length > 1 ? response([], tables) : response(tables));
  const progress: number[] = [];
  const result = await readCheckedTableColumns("c", "s", names, (done) => progress.push(done));
  expect(result.tableCount).toBe(600);
  expect(result.columnCount).toBe(600);
  expect(apiPost).toHaveBeenCalledTimes(606);
  expect(progress.at(-1)).toBe(600);
});

it("LS-28 terminates every indefinitely deferred table and continues legal tables", async () => {
  const names = ["t0", "t1", "t2", "t3"];
  const seen: string[] = [];
  apiPost.mockImplementation(async (_: string, { tables }: { tables: string[] }) => {
    if (tables.length > 1) return response([], tables);
    seen.push(tables[0]);
    return tables[0] === "t0" ? response([], tables) : response(tables);
  });
  const progress: number[] = [];
  const error = await readCheckedTableColumns("c", "s", names, (done) => progress.push(done)).catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.message).toContain("有 1 张表没有读到字段");
  expect(error.message).toContain("t0");
  expect(seen).toEqual(["t0", "t0", "t1", "t2", "t3"]);
  expect(progress.at(-1)).toBe(4);
  expect(apiPost.mock.calls.length).toBeLessThanOrEqual(2 * names.length + 2);
});

it.each([
  ["duplicate deferred", () => ({ ...response([], ["t0", "t0"]) })],
  ["overlapping outcomes", () => ({ ...response(["t0"]), deferred: ["t0"] })],
  ["unexpected table", () => ({ ...response(["t0", "foreign"]) })],
  ["repeated rejection", () => ({ ...response([]), rejections: [{ table: "t0", reason: "permission" }, { table: "t0", reason: "permission" }] })],
  ["unread fields", () => ({ ...response([]), yaml: "tables:\n  t0:\n    columns: []\n" })]
])("LS-29 fails closed on %s instead of counting fake progress", async (_name, makeResponse) => {
  apiPost.mockImplementation(async () => makeResponse());
  await expect(readCheckedTableColumns("c", "s", ["t0"])).rejects.toMatchObject({ code: "READ_FAILED" });
  expect(apiPost).toHaveBeenCalledTimes(1);
});

it.each([
  new ApiError({ code: "AUTH_REQUIRED", message: "auth" }),
  new ApiError({ code: "FORBIDDEN", message: "forbidden" }),
  new ApiError({ code: "STALE_RESPONSE", message: "stale" }),
  new ApiError({ code: "INTERNAL", message: "server" }),
  new TypeError("fetch failed"),
  new ApiError({ code: "READ_FAILED", message: "unknown" }),
  new ApiError({ code: "READ_FAILED", message: "missing scope", detail: { tableRejection: { table: "t0", reason: "permission" } } }),
  new ApiError({ code: "READ_FAILED", message: "unknown scope", detail: { tableRejection: { scope: "connection", table: "t0", reason: "permission" } } }),
  new ApiError({ code: "READ_FAILED", message: "wrong table", detail: { tableRejection: { scope: "table", table: "foreign", reason: "permission" } } }),
  new ApiError({ code: "READ_FAILED", message: "connection", detail: { tableRejection: { scope: "table", table: "t0", reason: "unreadable" } } })
])("LS-26 preserves global or unscoped failure %#", async (failure) => {
  apiPost.mockRejectedValue(failure);
  await expect(readCheckedTableColumns("c", "s", ["t0"])).rejects.toBe(failure);
  expect(apiPost).toHaveBeenCalledTimes(1);
});
