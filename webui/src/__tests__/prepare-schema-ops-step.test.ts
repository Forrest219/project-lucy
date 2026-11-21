// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createElement as h, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaStructurePrep } from "../components/SchemaStructurePrep";
import { Step2UploadManifest } from "../components/onboarding/Step2UploadManifest";
import { ApiError } from "../lib/apiClient";
import * as prepareSchemaStructure from "../lib/prepareSchemaStructure";
import { readCheckedTableColumns, schemaStructureOpsStepRefs } from "../lib/prepareSchemaStructure";

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("../lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/apiClient")>()),
  apiPost
}));

const tableNames = (count: number) =>
  Array.from({ length: count }, (_, index) => `t${String(index).padStart(4, "0")}`);

function yamlFor(names: string[]) {
  return `tables:\n${names.map((name) =>
    `  ${name}:\n    table: s.${name}\n    columns:\n      - name: id\n        type: number\n`
  ).join("")}`;
}

function response(
  names: string[],
  options: { opsStepId?: string; deferred?: string[]; rejections?: Array<{ table: string; reason: string }> } = {}
) {
  return {
    schema: "s",
    readable: true,
    namesOnly: false,
    yaml: yamlFor(names),
    tableCount: names.length,
    columnCount: names.length,
    mapped: { number: names.length, string: 0, time: 0 },
    downgraded: [],
    ...(options.opsStepId ? { opsStepId: options.opsStepId } : {}),
    ...(options.deferred ? { deferred: options.deferred } : {}),
    ...(options.rejections ? {
      rejections: options.rejections.map((item) => ({ ...item, message: `表「${item.table}」失败。` }))
    } : {})
  };
}

function singleTableFailure(table: string, opsStepId: string) {
  return new ApiError({
    code: "READ_FAILED",
    message: `表「${table}」没有读到字段。`,
    detail: {
      tableRejection: { scope: "table", table, reason: "missing" },
      opsStepId
    }
  });
}

async function readFailure(names: string[]) {
  const error = await readCheckedTableColumns("c", "s", names).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

function opsStepRefs(error: ApiError) {
  return (error.detail as { opsStepRefs?: unknown }).opsStepRefs;
}

beforeEach(() => {
  apiPost.mockReset();
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/sources") {
      return new Response(JSON.stringify({ ok: true, data: { tables: [], manifestSchemas: [] } }));
    }
    if (url === "/api/project") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          root: "/tmp/project",
          connections: [{ id: "c", driver: "mysql", wireProtocol: "mysql", schemas: ["s"], enabledTables: [] }],
          ktxAvailable: true
        }
      }));
    }
    return new Response(JSON.stringify({
      ok: false,
      error: { code: "NOT_FOUND", message: `Route ${url} not found` }
    }), { status: 404 });
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readCheckedTableColumns ops step refs", () => {
  it("associates 51 tables across HTTP 200 partial failure and single-table HTTP error", async () => {
    const names = tableNames(51);
    apiPost.mockImplementation(async (_path: string, body: { tables: string[] }) => {
      if (body.tables.length === 50) {
        return response(names.slice(1, 50), {
          opsStepId: "ops_http200",
          rejections: [{ table: "t0000", reason: "permission" }]
        });
      }
      throw singleTableFailure("t0050", "ops_http400");
    });

    const error = await readFailure(names);

    expect(apiPost.mock.calls.map(([, body]) => body.tables.length)).toEqual([50, 1]);
    expect(error.message).toBe("有 2 张表没有读到字段：表「t0000」没有读取权限；表「t0050」没有读到字段。");
    expect(opsStepRefs(error)).toEqual([
      { table: "t0000", opsStepId: "ops_http200" },
      { table: "t0050", opsStepId: "ops_http400" }
    ]);
    expect(Object.keys(error.data as Record<string, unknown>)).toEqual(["partial"]);
    expect(error.data).toMatchObject({ partial: { tableCount: 49, columnCount: 49 } });
  });

  it("associates 52 tables across two HTTP 200 partial failures without mixing request ids", async () => {
    const names = tableNames(52);
    apiPost.mockImplementation(async (_path: string, body: { tables: string[] }) => {
      if (body.tables.length === 50) {
        return response(names.slice(0, 50).filter((name) => name !== "t0001"), {
          opsStepId: "ops_first200",
          rejections: [{ table: "t0001", reason: "timeout" }]
        });
      }
      return response(["t0050"], {
        opsStepId: "ops_second200",
        rejections: [{ table: "t0051", reason: "ambiguous" }]
      });
    });

    const error = await readFailure(names);

    expect(apiPost.mock.calls.map(([, body]) => body.tables.length)).toEqual([50, 2]);
    expect(error.message).toBe("有 2 张表没有读到字段：表「t0001」读取超时；表「t0051」对应多张表。");
    expect(opsStepRefs(error)).toEqual([
      { table: "t0001", opsStepId: "ops_first200" },
      { table: "t0051", opsStepId: "ops_second200" }
    ]);
    expect(error.data).toMatchObject({ partial: { tableCount: 50, columnCount: 50 } });
  });

  it("uses the final deferred retry request id instead of copying the first id", async () => {
    apiPost
      .mockResolvedValueOnce(response([], { deferred: ["t0"], opsStepId: "ops_deferred_first" }))
      .mockResolvedValueOnce(response([], { deferred: ["t0"], opsStepId: "ops_deferred_final" }));

    const error = await readFailure(["t0"]);

    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(opsStepRefs(error)).toEqual([{ table: "t0", opsStepId: "ops_deferred_final" }]);
  });

  it("does not invent or retain an id when the final deferred response omits it", async () => {
    apiPost
      .mockResolvedValueOnce(response([], { deferred: ["t0"], opsStepId: "ops_deferred_first" }))
      .mockResolvedValueOnce(response([], { deferred: ["t0"] }));

    const error = await readFailure(["t0"]);

    expect(opsStepRefs(error)).toEqual([]);
  });

  it("uses final singleton ids after a multi-table deferred response shrinks the batch", async () => {
    apiPost
      .mockResolvedValueOnce(response([], { deferred: ["t0", "t1"], opsStepId: "ops_multi" }))
      .mockResolvedValueOnce(response([], { deferred: ["t0"], opsStepId: "ops_t0_first" }))
      .mockResolvedValueOnce(response([], { deferred: ["t0"], opsStepId: "ops_t0_final" }))
      .mockResolvedValueOnce(response([], { deferred: ["t1"], opsStepId: "ops_t1_first" }))
      .mockResolvedValueOnce(response([], { deferred: ["t1"], opsStepId: "ops_t1_final" }));

    const error = await readFailure(["t0", "t1"]);

    expect(apiPost.mock.calls.map(([, body]) => body.tables)).toEqual([
      ["t0", "t1"], ["t0"], ["t0"], ["t1"], ["t1"]
    ]);
    expect(opsStepRefs(error)).toEqual([
      { table: "t0", opsStepId: "ops_t0_final" },
      { table: "t1", opsStepId: "ops_t1_final" }
    ]);
    expect(JSON.stringify(opsStepRefs(error))).not.toContain("ops_multi");
    expect(JSON.stringify(opsStepRefs(error))).not.toContain("ops_t0_first");
    expect(JSON.stringify(opsStepRefs(error))).not.toContain("ops_t1_first");
  });
});

describe("schemaStructureOpsStepRefs", () => {
  it("deduplicates repeated tables while preserving the first-seen order", () => {
    const error = new ApiError({
      code: "READ_FAILED",
      message: "读取失败",
      detail: {
        opsStepRefs: [
          { table: "orders", opsStepId: "ops_orders" },
          { table: "people", opsStepId: "ops_people" },
          { table: "orders", opsStepId: "ops_orders_duplicate" },
          { table: "people", opsStepId: "ops_people_duplicate" }
        ]
      }
    });

    expect(schemaStructureOpsStepRefs(error)).toEqual([
      { table: "orders", opsStepId: "ops_orders" },
      { table: "people", opsStepId: "ops_people" }
    ]);
  });
});

function renderWithQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(h(QueryClientProvider, { client }, element));
}

function tableNamesResponse() {
  return {
    schema: "s",
    readable: true,
    namesOnly: true,
    yaml: "tables:\n  orders: {}\n",
    tableCount: 1,
    columnCount: 0,
    mapped: { number: 0, string: 0, time: 0 },
    downgraded: []
  };
}

function mockSingleTableReadFailure(opsStepId: string) {
  apiPost.mockImplementation(async (_path: string, body: { tables?: string[] }) => {
    if (!body.tables) return tableNamesResponse();
    throw singleTableFailure("orders", opsStepId);
  });
}

function mockDirectReadFailure(message: string, opsStepId: string) {
  apiPost.mockRejectedValue(new ApiError({
    code: "READ_FAILED",
    message,
    detail: { opsStepId }
  }));
}

function multipleRefsFailure() {
  return new ApiError({
    code: "READ_FAILED",
    message: "有 2 张表没有读到字段：表「orders」没有读到字段；表「people」读取超时。",
    detail: {
      opsStepRefs: [
        { table: "orders", opsStepId: "ops_orders" },
        { table: "people", opsStepId: "ops_people" },
        { table: "orders", opsStepId: "ops_orders_duplicate" }
      ]
    }
  });
}

function mockMultipleRefsFailure() {
  apiPost.mockImplementation(async () => tableNamesResponse());
  vi.spyOn(prepareSchemaStructure, "readCheckedTableColumns").mockRejectedValue(multipleRefsFailure());
}

function expectProtectedRef(testId: string, table: string, opsStepId: string) {
  const item = screen.getByTestId(testId);
  expect(item).toHaveTextContent(`表「${table}」操作号：${opsStepId}`);
  const codes = item.querySelectorAll("code");
  expect(codes).toHaveLength(2);
  expect(codes[0]).toHaveTextContent(table);
  expect(codes[1]).toHaveTextContent(opsStepId);
  for (const code of codes) {
    expect(code).toHaveAttribute("translate", "no");
    expect(code).toHaveClass("notranslate");
  }
}

describe("prepare structure error surfaces", () => {
  it("keeps the client summary and shows the table operation id in SchemaStructurePrep", async () => {
    mockSingleTableReadFailure("ops_prepare_entry");
    renderWithQuery(h(SchemaStructurePrep, {
      connection: { id: "c", driver: "mysql", wireProtocol: "mysql", schemas: ["s"], enabledTables: [] },
      schema: "s",
      showAddedStatus: false,
      exitLabel: "关闭",
      idPrefix: "prepare-structure",
      onExit: vi.fn(),
      onPrepared: vi.fn()
    }));

    fireEvent.click(screen.getByTestId("prepare-structure-read-structure"));
    expect(await screen.findByTestId("prepare-structure-table-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("prepare-structure-add-tables"));

    const alert = await screen.findByTestId("prepare-structure-structure-error");
    expect(within(alert).getByText("有 1 张表没有读到字段：表「orders」没有读到字段。")).toBeInTheDocument();
    expectProtectedRef("prepare-structure-ops-step-ref-orders", "orders", "ops_prepare_entry");
  });

  it("keeps the client summary and shows the table operation id in Step2UploadManifest", async () => {
    mockSingleTableReadFailure("ops_onboarding_entry");
    renderWithQuery(h(Step2UploadManifest, {
      connectionId: "c",
      schema: "s",
      onSuccess: vi.fn(),
      onExit: vi.fn()
    }));

    const next = await screen.findByTestId("setup-step2-next");
    await screen.findByText("从数据库读取表结构");
    fireEvent.click(next);
    expect(await screen.findByTestId("setup-table-picker")).toBeInTheDocument();
    fireEvent.click(next);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("有 1 张表没有读到字段：表「orders」没有读到字段。")).toBeInTheDocument();
    expectProtectedRef("setup-step2-ops-step-ref-orders", "orders", "ops_onboarding_entry");
  });

  it("shows a standalone operation id when the failure carries no table rejection", async () => {
    mockDirectReadFailure("表结构读取失败。", "ops_direct_entry");
    renderWithQuery(h(SchemaStructurePrep, {
      connection: { id: "c", driver: "mysql", wireProtocol: "mysql", schemas: ["s"], enabledTables: [] },
      schema: "s",
      showAddedStatus: false,
      exitLabel: "关闭",
      idPrefix: "prepare-structure",
      onExit: vi.fn(),
      onPrepared: vi.fn()
    }));

    fireEvent.click(screen.getByTestId("prepare-structure-read-structure"));

    const alert = await screen.findByTestId("prepare-structure-structure-error");
    expect(within(alert).getByText("表结构读取失败。")).toBeInTheDocument();
    const operationId = within(alert).getByTestId("prepare-structure-ops-step-id");
    expect(operationId).toHaveTextContent("ops_direct_entry");
    expect(operationId.querySelectorAll("code")).toHaveLength(1);
    expect(operationId.querySelector("code")).toHaveAttribute("translate", "no");
  });
});
