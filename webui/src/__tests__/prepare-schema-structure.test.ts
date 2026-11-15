import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/apiClient";
import {
  manifestTableNames,
  mergeManifestTables,
  newTablesFromGenerated,
  readCheckedTableColumns
} from "../lib/prepareSchemaStructure";

const { apiPost, yamlCalls } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  yamlCalls: { parse: 0, stringify: 0 }
}));

vi.mock("../lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/apiClient")>()),
  apiPost
}));

vi.mock("yaml", async (importOriginal) => {
  const real = await importOriginal<typeof import("yaml")>();
  return {
    ...real,
    parse: ((...args: Parameters<typeof real.parse>) => {
      yamlCalls.parse += 1;
      return real.parse(...args);
    }) as typeof real.parse,
    stringify: ((...args: Parameters<typeof real.stringify>) => {
      yamlCalls.stringify += 1;
      return real.stringify(...args);
    }) as typeof real.stringify
  };
});

const existing = `schema: dataforai
tables:
  orders:
    table: dataforai.orders
    columns:
      - name: id
        type: number
        descriptions:
          human: 订单号
`;

const generated = `tables:
  orders:
    table: dataforai.orders
    columns:
      - name: id
        type: string
  people:
    table: dataforai.people
    columns:
      - name: name
        type: string
  extra:
    table: dataforai.extra
    columns:
      - name: note
        type: string
`;

describe("mergeManifestTables", () => {
  it("keeps existing table YAML and only appends selected new tables", () => {
    expect(manifestTableNames(existing)).toEqual(["orders"]);
    expect(newTablesFromGenerated(existing, generated)).toEqual(["extra", "people"]);
    const merged = mergeManifestTables(existing, generated, ["people"]);
    expect(manifestTableNames(merged)).toEqual(["orders", "people"]);
    expect(merged).toContain("human: 订单号");
    expect(merged).toContain("people:");
    expect(merged).not.toContain("extra:");
    const tables = (parseYaml(merged) as { tables: Record<string, { columns: Array<{ type?: string }> }> }).tables;
    expect(tables.orders.columns[0]?.type).toBe("number");
  });
});

type Part = { yaml: string; columnCount: number };

/** Server stand-in: per-table YAML text is prebuilt, a response is plain string concatenation. */
function serverOf(names: string[], columns: number, opts: {
  rejected?: Record<string, string>;
  deferOnce?: Set<string>;
  deferAll?: boolean;
} = {}) {
  const entry = new Map<string, string>();
  for (const name of names) {
    const cols = Array.from({ length: columns }, (_, index) => ({ name: `c${index}`, type: index % 3 === 0 ? "number" : "string" }));
    entry.set(
      name,
      stringifyYaml({ [name]: { table: `dw.${name}`, columns: cols } })
        .split("\n")
        .filter(Boolean)
        .map((line) => `  ${line}`)
        .join("\n") + "\n"
    );
  }
  const deferred = new Set<string>();
  const requests: string[][] = [];
  apiPost.mockImplementation(async (_path: string, body: { tables: string[] }) => {
    requests.push(body.tables);
    const readable: string[] = [];
    const rejections: Array<{ table: string; reason: string; message: string }> = [];
    const later: string[] = [];
    for (const table of body.tables) {
      if (opts.deferAll) later.push(table);
      else if (opts.deferOnce?.has(table) && !deferred.has(table)) {
        deferred.add(table);
        later.push(table);
      } else if (opts.rejected?.[table]) rejections.push({ table, reason: opts.rejected[table], message: `表「${table}」x。` });
      else readable.push(table);
    }
    return {
      schema: "dw",
      readable: true,
      yaml: `tables:\n${readable.map((table) => entry.get(table)).join("")}`,
      tableCount: readable.length,
      columnCount: readable.length * columns,
      namesOnly: false,
      mapped: { number: readable.length * Math.ceil(columns / 3), string: 0, time: 0 },
      downgraded: [],
      ...(rejections.length > 0 ? { rejections } : {}),
      ...(later.length > 0 ? { deferred: later } : {})
    };
  });
  return { requests };
}

const tableNames = (count: number) => Array.from({ length: count }, (_, index) => `t_${String(index).padStart(4, "0")}`);

describe("readCheckedTableColumns", () => {
  beforeEach(() => {
    apiPost.mockReset();
    yamlCalls.parse = 0;
    yamlCalls.stringify = 0;
  });

  it("LS-10 reads 600 tables in batches of 50 and re-asks for the deferred ones", async () => {
    const names = tableNames(600);
    const deferOnce = new Set(["t_0003", "t_0004", "t_0100"]);
    const { requests } = serverOf(names, 3, { deferOnce });
    const progress: Array<[number, number]> = [];
    const result = await readCheckedTableColumns("c1", "dw", names, (done, total) => progress.push([done, total]));
    expect(requests.every((tables) => tables.length <= 50)).toBe(true);
    expect(requests.length).toBe(12 + 1);
    expect(new Set(requests.flat())).toEqual(new Set(names));
    expect(manifestTableNames(result.yaml)).toEqual(names);
    expect(result.tableCount).toBe(600);
    expect(result.columnCount).toBe(1800);
    expect(progress[0]).toEqual([0, 600]);
    expect(progress.at(-1)?.[1]).toBe(600);
  });

  it("LS-11 accumulates 600 tables x 30 columns with one serialisation and a parse per batch", async () => {
    const names = tableNames(600);
    serverOf(names, 30);
    yamlCalls.parse = 0;
    yamlCalls.stringify = 0;
    const started = performance.now();
    const result = await readCheckedTableColumns("c1", "dw", names);
    const elapsed = performance.now() - started;
    expect(yamlCalls.stringify).toBe(1);
    expect(yamlCalls.parse).toBeLessThanOrEqual(12 + 1);
    expect(elapsed).toBeLessThan(5_000);
    expect(result.columnCount).toBe(18_000);
    expect(manifestTableNames(result.yaml)).toHaveLength(600);
  });

  it("LS-12 reads the other 597 tables and reports all three failures in one error", async () => {
    const names = tableNames(600);
    const { requests } = serverOf(names, 2, {
      rejected: { t_0010: "permission", t_0300: "timeout", t_0599: "ambiguous" }
    });
    const failure = await readCheckedTableColumns("c1", "dw", names).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    const message = (failure as ApiError).message;
    expect(message).toContain("有 3 张表没有读到字段");
    expect(message).toContain("表「t_0010」没有读取权限");
    expect(message).toContain("表「t_0300」读取超时");
    expect(message).toContain("表「t_0599」对应多张表");
    expect(requests).toHaveLength(12);
  });

  it("stops instead of looping when the server makes no progress", async () => {
    const names = tableNames(5);
    serverOf(names, 2, { deferAll: true });
    await expect(readCheckedTableColumns("c1", "dw", names)).rejects.toBeInstanceOf(ApiError);
    expect(apiPost.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("keeps the request order of the tables in the manifest", async () => {
    serverOf(["b", "a", "c"], 1);
    const result = await readCheckedTableColumns("c1", "dw", ["b", "a", "c"]);
    expect(Object.keys((parseYaml(result.yaml) as { tables: Record<string, unknown> }).tables)).toEqual(["b", "a", "c"]);
  });
});
