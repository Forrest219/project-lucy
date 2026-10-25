// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowPolicyView } from "../pages/admin/RowPolicyView";

const SNAPSHOT = {
  identity: {
    configVersion: "cfg-1",
    policyVersion: "pol-1",
    sourceMapVersion: "sm-1",
    capabilityDigest: "cap-1"
  },
  state: "ok",
  problem: null,
  failures: []
};

const SCOPED_GRANT = {
  kind: "scoped",
  digest: "east",
  orArms: [
    [{ field: "region", op: "eq", value: "East" }],
    [{ field: "region", op: "eq", value: "West" }]
  ]
};

const LIST = {
  snapshot: SNAPSHOT,
  state: "ok",
  status: "ok",
  tables: [
    {
      connectionId: "warehouse",
      schema: "fin",
      sourceName: "fin_ledger",
      physicalTable: "fin_ledger",
      roleCount: 2,
      agentCount: 1,
      effectiveRowGrant: SCOPED_GRANT,
      restricted: true
    }
  ],
  failures: []
};

const DETAIL = {
  snapshot: SNAPSHOT,
  table: {
    connectionId: "warehouse",
    schema: "fin",
    sourceName: "fin_ledger",
    physicalTable: "fin_ledger"
  },
  state: "ok",
  status: "ok",
  roles: [
    {
      roleId: "east_role",
      rowAccess: "scoped",
      templateRefs: ["by_region"],
      inlinePredicates: [{ field: "status", op: "eq", value: "SETTLED" }],
      rowGrant: SCOPED_GRANT,
    },
    {
      roleId: "west_role",
      rowAccess: "scoped",
      templateRefs: [],
      inlinePredicates: [{ field: "status", op: "eq", value: "SETTLED" }],
      rowGrant: SCOPED_GRANT
    }
  ],
  effectiveRowGrant: SCOPED_GRANT,
  agents: [
    {
      agentId: "agent_a",
      enabled: true,
      constraints: [{ field: "region", op: "eq", value: "East" }],
      finalRows: { kind: "scoped", digest: "agent", orArms: [[{ field: "region", op: "eq", value: "East" }]] }
    }
  ],
  catalog: { status: "loaded", catalogLoaded: true },
  failures: []
};

function renderView(entry = "/admin/row-policies") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <RowPolicyView />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * The fixture is widened on purpose: the four states differ in ways the detail
 * object must be able to express (a null grant, a null final row), and the
 * narrow literal type of the fixture would hide those.
 */
type TestPredicate = { field: string; op: string; value?: string; values?: string[] };
type TestDetail = {
  snapshot: typeof SNAPSHOT;
  table: typeof DETAIL.table;
  state: string;
  status: string;
  reason?: string;
  roles: Array<{
    roleId: string;
    rowAccess: string | null;
    templateRefs: string[];
    inlinePredicates: TestPredicate[];
    rowGrant: unknown;
    error?: string;
  }>;
  effectiveRowGrant: unknown;
  agents: Array<{
    agentId: string;
    enabled: boolean;
    constraints: TestPredicate[];
    finalRows: unknown;
    error?: string;
  }>;
  catalog: { status: string; catalogLoaded: boolean };
  failures: Array<{ subjectId: string; reason: string }>;
};
type TestList = {
  snapshot: typeof SNAPSHOT;
  state: string;
  status: string;
  tables: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    physicalTable: string;
    roleCount: number;
    agentCount: number;
    effectiveRowGrant: unknown;
    restricted: boolean;
  }>;
  failures: Array<{ subjectId: string; reason: string }>;
};

let detailResponse: TestDetail = DETAIL as unknown as TestDetail;
let listResponse: TestList = LIST as unknown as TestList;

beforeEach(() => {
  detailResponse = DETAIL;
  listResponse = LIST;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // The list URL starts with the detail URL, so it must be matched first.
      if (url.startsWith("/api/admin/row-policy/views/tables")) {
        return new Response(JSON.stringify({ ok: true, data: listResponse }));
      }
      if (url.startsWith("/api/admin/row-policy/views/table")) {
        return new Response(JSON.stringify({ ok: true, data: detailResponse }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("行权限视图（R3）", () => {
  it("列出完整表身份、角色数、Agent 数与有效行授予", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    expect(screen.getByText("warehouse/fin/fin_ledger")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-view-table-grant")).toHaveTextContent("受限行授予");
  });

  it("两个受限角色不显示「全部行」，并保留 OR-of-AND 结构", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-role-branches")).toBeInTheDocument());
    expect(screen.queryByTestId("row-policy-dnf-all")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-union")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-union-arm-0")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-union-arm-1")).toBeInTheDocument();
    // One access label per Role branch — neither of them says 「全部行」.
    const accessLabels = screen.getAllByTestId("row-policy-view-role-access");
    expect(accessLabels).toHaveLength(2);
    expect(accessLabels.map((node) => node.textContent)).toEqual(["受限行授予", "受限行授予"]);
  });

  it("角色分支显示模板引用与内联条件，并提供角色详情深链", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-role-templates")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-view-role-templates")).toHaveTextContent("by_region");
    expect(screen.getByTestId("row-policy-view-role-east_role")).toHaveTextContent("status");
    expect(screen.getByRole("link", { name: "east_role" })).toHaveAttribute("href", "/admin/roles/east_role");
  });

  it("无授权与编译失败显示不同的状态，不共用空态", async () => {
    detailResponse = {
      ...DETAIL,
      status: "no_applicable_grant",
      reason: "row_policy_no_applicable_grant",
      effectiveRowGrant: null,
      roles: [{ roleId: "east_role", rowAccess: null, templateRefs: [], inlinePredicates: [], rowGrant: null }],
      agents: []
    };
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-status-no_applicable_grant")).toBeInTheDocument());
    expect(screen.queryByTestId("row-policy-status-compile_failed")).not.toBeInTheDocument();
  });

  it("不可满足与编译失败是两个不同的状态", async () => {
    detailResponse = {
      ...DETAIL,
      status: "final_rows_unsatisfiable",
      reason: "final_rows_unsatisfiable",
      agents: [
        {
          agentId: "agent_a",
          enabled: true,
          constraints: [{ field: "region", op: "eq", value: "West" }],
          finalRows: null,
          error: "final_rows_unsatisfiable"
        }
      ]
    };
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() =>
      expect(screen.getByTestId("row-policy-status-final_rows_unsatisfiable")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("row-policy-status-compile_failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-policy-dnf-all")).not.toBeInTheDocument();
  });

  it("空筛选结果显示为空筛选，而不是无授权", async () => {
    listResponse = { ...LIST, status: "no_match", tables: [] };
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-list-empty")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-status-no_match")).toBeInTheDocument();
    expect(screen.queryByTestId("row-policy-status-no_applicable_grant")).not.toBeInTheDocument();
  });

  it("筛选写入 URL，可分享", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("角色筛选"), { target: { value: "east_role" } });
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const last = String(calls[calls.length - 1]?.[0] ?? "");
      expect(last).toContain("roleId=east_role");
    });
  });

  it("选中一张表时按完整表身份写入 URL", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    fireEvent.click(screen.getByText("warehouse/fin/fin_ledger"));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const urls = calls.map((call) => String(call[0] ?? ""));
      expect(
        urls.some((url) =>
          url.includes("/api/admin/row-policy/views/table?") &&
          url.includes("connectionId=warehouse") &&
          url.includes("schema=fin") &&
          url.includes("sourceName=fin_ledger")
        )
      ).toBe(true);
    });
  });
});

/**
 * P0-2：深链参数名是 `connectionId` / `schema` / `sourceName`。
 *
 * 服务端的 `rowPolicyViewUrlForTable()` 曾用 `connection` / `schema` / `table`，
 * 与本页实际读取的参数名对不上 → 单表详情面板永远不渲染。
 */
describe("行权限视图的深链参数契约（P0-2）", () => {
  it("带 connectionId／schema／sourceName 进来时预置筛选并自动打开单表详情", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    // 三个筛选框都预置成 URL 里的值。
    await waitFor(() => expect(screen.getByTestId("row-policy-view-detail")).toBeInTheDocument());
    expect(screen.getByLabelText("连接筛选")).toHaveValue("warehouse");
    expect(screen.getByLabelText("Schema 筛选")).toHaveValue("fin");
    expect(screen.getByLabelText("表筛选")).toHaveValue("fin_ledger");
    // 单表详情按三段表身份渲染。
    await waitFor(() =>
      expect(screen.getByTestId("row-policy-view-detail")).toHaveTextContent("warehouse/fin/fin_ledger")
    );
    expect(screen.getByTestId("row-policy-view-role-branches")).toBeInTheDocument();
  });

  it("单表详情请求用同一套参数名", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-detail")).toBeInTheDocument());
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const urls = calls.map((call) => String(call[0] ?? ""));
    expect(
      urls.some((url) =>
        url.includes("/api/admin/row-policy/views/table?") &&
        url.includes("connectionId=warehouse") &&
        url.includes("schema=fin") &&
        url.includes("sourceName=fin_ledger")
      )
    ).toBe(true);
  });
});

/**
 * P1-3：清单视图不能丢弃 `partial` 状态与失败集合（RTV-05）。
 */
describe("行权限视图的清单降级披露（P1-3）", () => {
  it("快照不完整时披露状态与失败集合", async () => {
    listResponse = {
      ...LIST,
      state: "partial",
      status: "ok",
      failures: [{ subjectId: "east_role", reason: "role_resolution_failed:east_role" }]
    };
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-list-state")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-view-list-state")).toHaveTextContent("partial");
    const failures = screen.getByTestId("row-policy-view-list-failures");
    expect(failures).toHaveTextContent("east_role");
    expect(failures).toHaveTextContent("role_resolution_failed");
  });

  it("全部 Role 编译失败时清单不可用，不显示成「空筛选」", async () => {
    listResponse = {
      ...LIST,
      state: "unavailable",
      status: "unavailable",
      tables: [],
      failures: [{ subjectId: "east_role", reason: "role_resolution_failed:east_role" }]
    };
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-list-empty")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-view-list-empty")).toHaveTextContent("快照当前不可用");
    expect(screen.getByTestId("row-policy-view-list-empty")).not.toHaveTextContent("没有符合筛选条件的表");
  });
});

/**
 * P2-9：「快照不可用」与「空筛选」不共用同一句空态。
 */
describe("行权限视图的空态分类（P2-9）", () => {
  it("空筛选与快照不可用是两句不同的话", async () => {
    listResponse = { ...LIST, state: "ok", status: "no_match", tables: [] };
    const { unmount } = renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-list-empty")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-view-list-empty")).toHaveTextContent("没有符合筛选条件的表");
    expect(screen.getByTestId("row-policy-view-list-empty")).not.toHaveTextContent("快照当前不可用");
    unmount();

    listResponse = { ...LIST, state: "unavailable", status: "unavailable", tables: [] };
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-list-empty")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-view-list-empty")).toHaveTextContent("快照当前不可用");
    expect(screen.getByTestId("row-policy-view-list-empty")).not.toHaveTextContent("没有符合筛选条件的表");
  });
});

/**
 * P1-5：承载标识的筛选输入框必须受翻译防御（术语标准 §2.6）。
 */
describe("行权限视图的标识翻译防御（P1-5）", () => {
  it("连接／表／角色筛选框带 translate=\"no\" + notranslate", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    for (const label of ["连接筛选", "表筛选", "角色筛选", "Schema 筛选", "Agent 筛选"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("translate", "no");
      expect(input.className).toContain("notranslate");
    }
  });
});
