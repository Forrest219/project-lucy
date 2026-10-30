// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowPolicyView } from "../pages/admin/RowPolicyView";
import { ROW_POLICY_PREVIEW_BOUNDARY } from "../components/admin/RowPolicyDnfPreview";

/**
 * Lucy v0.25 P1 — 行权限视图呈现修订.
 *
 * Authority: docs/specs/lucy-20261030-row-policy-view-presentation-spec.md
 *   §5.1（页面骨架）, §5.2（URL）, §5.3（清单授予列）, §5.4（详情）; D1–D10;
 *   SC-01 … SC-18.
 *
 * The page has TWO parameter families and they must not mix:
 *   - 当前表：`connectionId` / `schema` / `sourceName`（深链三参数，只打开详情）
 *   - 清单筛选：`listConnectionId` / `listSchema` / `listSourceName` /
 *     `roleId` / `agentId` / `restricted`
 */

const { copyTextWithToastMock } = vi.hoisted(() => ({
  copyTextWithToastMock: vi.fn(async () => true)
}));

vi.mock("../lib/clipboard", () => ({
  copyTextWithToast: copyTextWithToastMock,
  copyTextToClipboard: vi.fn(async () => ({ ok: true })),
  CLIPBOARD_COPY_FAILED_MESSAGE: "复制失败，请手动选择文本"
}));

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
      grantStatus: "scoped",
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

/** The URL as the router sees it — the address bar is part of the contract. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderView(entry = "/admin/row-policies") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <RowPolicyView />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** The query string the router currently holds. */
function currentSearchParams(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
}

/** Every URL the page has requested so far. */
function fetchUrls(): string[] {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.map((call) => String(call[0] ?? ""));
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
type TestTable = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
  roleCount: number;
  agentCount: number;
  effectiveRowGrant: unknown;
  grantStatus?: string;
  grantStatusReason?: string;
  restricted: boolean;
};
type TestList = {
  snapshot: typeof SNAPSHOT;
  state: string;
  status: string;
  tables: TestTable[];
  failures: Array<{ subjectId: string; reason: string }>;
};

let detailResponse: TestDetail = DETAIL as unknown as TestDetail;
let listResponse: TestList = LIST as unknown as TestList;

beforeEach(() => {
  detailResponse = DETAIL;
  listResponse = LIST;
  copyTextWithToastMock.mockClear();
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
  it("列出表身份、角色数、Agent 数与有效行授予", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    // 表列主文是 sourceName，次行是「connectionId · schema」。
    expect(screen.getByRole("button", { name: "warehouse/fin/fin_ledger" })).toHaveTextContent("fin_ledger");
    expect(screen.getByText("warehouse · fin")).toBeInTheDocument();
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
});

/**
 * P0-2：深链参数名是 `connectionId` / `schema` / `sourceName`。
 *
 * 服务端的 `rowPolicyViewUrlForTable()` 曾用 `connection` / `schema` / `table`，
 * 与本页实际读取的参数名对不上 → 单表详情面板永远不渲染。
 *
 * 呈现修订后：深链三参数**只**打开单表详情，不再预置清单筛选（SC-02）。
 */
describe("行权限视图的深链参数契约（P0-2）", () => {
  it("单表详情请求用同一套参数名", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-detail")).toBeInTheDocument());
    const urls = fetchUrls();
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
 * 呈现修订 SC-01–SC-07、SC-13、SC-16：URL 拆分、筛选、页壳、清单网格。
 */
describe("行权限视图的呈现修订（Spec §5.1 / §5.2）", () => {
  it("SC-01 点表只打开详情，清单请求不带当前表三参数", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "warehouse/fin/fin_ledger" }));
    await waitFor(() => {
      const urls = fetchUrls();
      expect(
        urls.some((url) =>
          url.includes("/api/admin/row-policy/views/table?") &&
          url.includes("connectionId=warehouse") &&
          url.includes("schema=fin") &&
          url.includes("sourceName=fin_ledger")
        )
      ).toBe(true);
    });
    // 清单请求（带筛选的与选项的）都不带当前表三参数。
    const listUrls = fetchUrls().filter((url) => url.startsWith("/api/admin/row-policy/views/tables"));
    expect(listUrls.length).toBeGreaterThan(0);
    for (const url of listUrls) {
      expect(url).not.toContain("connectionId=");
      expect(url).not.toContain("schema=");
      expect(url).not.toContain("sourceName=");
    }
  });

  it("SC-02 深链三参数只打开详情，三个清单筛选控件为空", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() =>
      expect(screen.getByTestId("row-policy-view-detail")).toHaveTextContent("warehouse/fin/fin_ledger")
    );
    expect(screen.getByLabelText("连接筛选")).toHaveValue("");
    expect(screen.getByLabelText("Schema 筛选")).toHaveValue("");
    expect(screen.getByLabelText("表筛选")).toHaveValue("");
    expect(screen.getByLabelText("角色筛选")).toHaveValue("");
    expect(screen.getByLabelText("Agent 筛选")).toHaveValue("");
    // 单表详情按三段表身份渲染。
    expect(screen.getByTestId("row-policy-view-role-branches")).toBeInTheDocument();
  });

  it("SC-03 切到仅受限表时当前表三参数保留，表筛选框不显示当前表名", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-detail")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "仅受限表" }));
    await waitFor(() => {
      const params = currentSearchParams();
      expect(params.get("restricted")).toBe("true");
      expect(params.get("connectionId")).toBe("warehouse");
      expect(params.get("schema")).toBe("fin");
      expect(params.get("sourceName")).toBe("fin_ledger");
    });
    // 表筛选框是清单筛选，不是当前表——它不显示已被 URL 改写的表名。
    expect(screen.getByLabelText("表筛选")).toHaveValue("");
  });

  it("SC-04 可见值来自本地镜像，URL 存原文，请求参数才 trim", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("角色筛选"), { target: { value: " east_role " } });
    await waitFor(() => {
      // URL 里是原文（带空格）。
      expect(currentSearchParams().get("roleId")).toBe(" east_role ");
    });
    expect(screen.getByLabelText("角色筛选")).toHaveValue(" east_role ");
    await waitFor(() => {
      const listUrls = fetchUrls().filter((url) => url.includes("roleId="));
      expect(listUrls.length).toBeGreaterThan(0);
      // 发请求时才 trim。
      expect(listUrls[listUrls.length - 1]).toContain("roleId=east_role");
      expect(listUrls[listUrls.length - 1]).not.toContain("roleId=east_role%20");
    });
  });

  it("SC-05 空筛选的徽章与句子不与无授权、快照不可用混用", async () => {
    listResponse = { ...LIST, status: "no_match", tables: [] };
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-list-empty")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-status-no_match")).toHaveTextContent("空筛选");
    expect(screen.getByTestId("row-policy-view-list-empty")).toHaveTextContent("没有符合筛选条件的表。");
    expect(screen.queryByText("无授权")).not.toBeInTheDocument();
    expect(screen.queryByText(/快照当前不可用/)).not.toBeInTheDocument();
  });

  it("SC-06 清除筛选去掉整组清单筛选，当前表三参数保留", async () => {
    renderView(
      "/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger&listConnectionId=warehouse&listSchema=fin&listSourceName=fin_ledger&roleId=east_role&agentId=agent_a&restricted=true"
    );
    await waitFor(() => expect(screen.getByTestId("row-policy-view-clear-filters")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("row-policy-view-clear-filters"));
    await waitFor(() => {
      const params = currentSearchParams();
      expect(params.get("listConnectionId")).toBeNull();
      expect(params.get("listSchema")).toBeNull();
      expect(params.get("listSourceName")).toBeNull();
      expect(params.get("roleId")).toBeNull();
      expect(params.get("agentId")).toBeNull();
      expect(params.get("restricted")).toBeNull();
      expect(params.get("connectionId")).toBe("warehouse");
      expect(params.get("schema")).toBe("fin");
      expect(params.get("sourceName")).toBe("fin_ledger");
    });
    // 镜像字段也归零——输入框不留旧文本。
    expect(screen.getByLabelText("角色筛选")).toHaveValue("");
    expect(screen.getByLabelText("Agent 筛选")).toHaveValue("");
    expect(screen.getByLabelText("表筛选")).toHaveValue("");
  });

  it("SC-07 清单是数据网格，选中行 aria-current，列表按钮 aria-label 是三元组", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    const list = await screen.findByTestId("row-policy-view-table-list");
    expect(list.className).toContain("pl-data-grid");
    expect(list.className).toContain("pl-data-table");
    const row = screen.getByTestId("row-policy-view-table-warehouse-fin-fin_ledger");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row.className).toContain("bg-bg-muted");
    expect(screen.getByRole("button", { name: "warehouse/fin/fin_ledger" })).toBeInTheDocument();
  });

  it("SC-13 快照默认折叠但仍在 DOM，模板入口是 secondary 按钮", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-snapshot")).toBeInTheDocument());
    const snapshot = screen.getByTestId("row-policy-snapshot");
    expect(snapshot.tagName).toBe("DETAILS");
    expect(snapshot).not.toHaveAttribute("open");
    expect(snapshot).toHaveTextContent("cfg-1");
    const templateLink = screen.getByRole("link", { name: "行策略模板" });
    expect(templateLink.className).toContain("pl-btn--secondary");
    expect(templateLink).toHaveAttribute("href", "/admin/row-policy-templates");
  });

  it("SC-16 当前表不在筛选结果中时详情仍渲染并说明", async () => {
    listResponse = {
      ...LIST,
      tables: [{ ...LIST.tables[0], sourceName: "other_table", physicalTable: "other_table" }]
    };
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() =>
      expect(screen.getByTestId("row-policy-view-outside-filter")).toHaveTextContent(
        "当前表不在筛选结果中。"
      )
    );
  });
});

/**
 * 呈现修订 SC-08–SC-12、SC-14、SC-15、SC-17：清单授予列与详情阅读顺序。
 */
describe("行权限视图的清单授予列与详情顺序（Spec §5.3 / §5.4）", () => {
  it("SC-08 四态 grantStatus 显示四句话，编译失败不写无授权", async () => {
    const base = LIST.tables[0];
    listResponse = {
      ...LIST,
      tables: [
        { ...base, sourceName: "all_rows", physicalTable: "all_rows", effectiveRowGrant: { kind: "all" }, grantStatus: "all" },
        { ...base, sourceName: "scoped_rows", physicalTable: "scoped_rows", grantStatus: "scoped" },
        {
          ...base,
          sourceName: "no_grant",
          physicalTable: "no_grant",
          effectiveRowGrant: null,
          grantStatus: "no_applicable_grant",
          grantStatusReason: "row_policy_no_applicable_grant"
        },
        {
          ...base,
          sourceName: "broken_rows",
          physicalTable: "broken_rows",
          effectiveRowGrant: null,
          grantStatus: "compile_failed",
          grantStatusReason: "role_resolution_failed:broken_role"
        }
      ]
    };
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());
    const cellOf = (sourceName: string) =>
      within(screen.getByTestId(`row-policy-view-table-warehouse-fin-${sourceName}`)).getByTestId(
        "row-policy-view-table-grant"
      );
    expect(cellOf("all_rows")).toHaveTextContent("行权限：全部行");
    expect(cellOf("scoped_rows")).toHaveTextContent("受限行授予（2 个分支）");
    expect(cellOf("no_grant")).toHaveTextContent("无授权");
    expect(cellOf("broken_rows")).toHaveTextContent("编译失败");
    // 编译失败的那一格不能写成「无授权」。
    expect(cellOf("broken_rows")).not.toHaveTextContent("无授权");
    // 机器 reason 只进 title，不当主文案。
    expect(cellOf("broken_rows")).toHaveAttribute("title", "role_resolution_failed:broken_role");
    expect(cellOf("broken_rows").textContent).not.toContain("role_resolution_failed");
  });

  it("SC-09 两个受限分支仍是两个 arm，分支之间看得见「或」", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-dnf-union")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-dnf-union-arm-0")).toHaveTextContent("region 等于 East");
    expect(screen.getByTestId("row-policy-dnf-union-arm-1")).toHaveTextContent("region 等于 West");
    expect(screen.queryByTestId("row-policy-dnf-all")).not.toBeInTheDocument();
    expect(screen.getByText("或")).toBeInTheDocument();
  });

  it("SC-10 没有模板也没有内联条件的角色不显示编写方式徽章", async () => {
    detailResponse = {
      ...DETAIL,
      roles: [
        {
          roleId: "east_role",
          rowAccess: "scoped",
          templateRefs: ["by_region"],
          inlinePredicates: [],
          rowGrant: SCOPED_GRANT
        },
        { roleId: "plain_role", rowAccess: null, templateRefs: [], inlinePredicates: [], rowGrant: null }
      ]
    };
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-role-plain_role")).toBeInTheDocument());
    const plain = screen.getByTestId("row-policy-view-role-plain_role");
    expect(within(plain).queryByText("仅直接写条件")).not.toBeInTheDocument();
    expect(within(plain).queryByText(/编写方式/)).not.toBeInTheDocument();
    // 有模板引用时仍显示模板名与徽章，角色链接仍指向角色详情。
    const east = screen.getByTestId("row-policy-view-role-east_role");
    expect(within(east).getByText("仅引用模板")).toBeInTheDocument();
    expect(within(east).getByTestId("row-policy-view-role-templates")).toHaveTextContent("by_region");
    expect(screen.getByRole("link", { name: "east_role" })).toHaveAttribute("href", "/admin/roles/east_role");
  });

  it("SC-11 角色与 Agent 各有授权摘要只读深链", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-role-east_role")).toBeInTheDocument());
    const roleLink = within(screen.getByTestId("row-policy-view-role-east_role")).getByRole("link", {
      name: "授权摘要"
    });
    expect(roleLink).toHaveAttribute("href", "/admin/authorization-summary?kind=role&id=east_role");
    const agentLink = within(screen.getByTestId("row-policy-dnf-agent-agent_a")).getByRole("link", {
      name: "授权摘要"
    });
    expect(agentLink).toHaveAttribute("href", "/admin/authorization-summary?kind=agent&id=agent_a");
  });

  it("SC-12 全体 Agent 都是全部行时先给一句统一结论，展开后仍逐个渲染", async () => {
    detailResponse = {
      ...DETAIL,
      agents: [
        { agentId: "agent_a", enabled: true, constraints: [], finalRows: { kind: "all" } },
        { agentId: "agent_b", enabled: true, constraints: [], finalRows: { kind: "all" } }
      ]
    };
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-agent-uniform")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-view-agent-uniform")).toHaveTextContent(
      "这 2 个 Agent 的最终行约束都是行权限：全部行。"
    );
    fireEvent.click(screen.getByTestId("row-policy-view-agent-expand"));
    expect(screen.getByTestId("row-policy-dnf-agent-agent_a")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-agent-agent_b")).toBeInTheDocument();
  });

  it("SC-14 复制表身份调用 copyTextWithToast，参数是三元组", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-view-copy-identity")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("row-policy-view-copy-identity"));
    expect(copyTextWithToastMock).toHaveBeenCalledWith(
      "warehouse/fin/fin_ledger",
      expect.objectContaining({ successMessage: "已复制表身份" })
    );
  });

  it("SC-15 页面只读：没有保存／删除／预演，既有 row-policy-view-* id 仍在", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() =>
      expect(screen.getByTestId("row-policy-view-role-branches")).toBeInTheDocument()
    );
    for (const label of [/保存/, /删除/, /预演/]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    for (const testId of [
      "row-policy-view-page",
      "row-policy-view-detail",
      "row-policy-view-role-branches",
      "row-policy-view-role-east_role",
      "row-policy-view-role-templates",
      "row-policy-view-table-list",
      "row-policy-view-table-grant",
      "row-policy-view-table-warehouse-fin-fin_ledger"
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId("row-policy-view-role-access").length).toBeGreaterThan(0);
  });

  it("SC-17 边界句原文不变", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-dnf-boundary")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-dnf-boundary")).toHaveTextContent(ROW_POLICY_PREVIEW_BOUNDARY);
  });

  it("详情顺序是结论 → 边界句 → 角色 → Agent", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByTestId("row-policy-dnf-preview")).toBeInTheDocument());
    const preview = screen.getByTestId("row-policy-dnf-preview");
    const order = Array.from(preview.querySelectorAll("[data-testid]")).map((node) =>
      node.getAttribute("data-testid")
    );
    expect(order.indexOf("row-policy-dnf-union-section")).toBeLessThan(
      order.indexOf("row-policy-dnf-boundary")
    );
    expect(order.indexOf("row-policy-dnf-boundary")).toBeLessThan(
      order.indexOf("row-policy-view-role-branches")
    );
    expect(order.indexOf("row-policy-view-role-branches")).toBeLessThan(
      order.indexOf("row-policy-dnf-agents-section")
    );
  });

  it("角色分三组：参与并集／不授予该表／编译失败", async () => {
    detailResponse = {
      ...DETAIL,
      roles: [
        {
          roleId: "east_role",
          rowAccess: "scoped",
          templateRefs: ["by_region"],
          inlinePredicates: [],
          rowGrant: SCOPED_GRANT
        },
        { roleId: "plain_role", rowAccess: null, templateRefs: [], inlinePredicates: [], rowGrant: null },
        {
          roleId: "broken_role",
          rowAccess: null,
          templateRefs: [],
          inlinePredicates: [],
          rowGrant: null,
          error: "role_resolution_failed:broken_role"
        }
      ]
    };
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await waitFor(() => expect(screen.getByText("参与并集")).toBeInTheDocument());
    // 组标题是 heading；角色自己的「不授予该表」访问标签是 span，不冲突。
    expect(screen.getByRole("heading", { name: "不授予该表" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "编译失败" })).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-view-role-east_role")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-view-role-plain_role")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-view-role-broken_role")).toBeInTheDocument();
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
