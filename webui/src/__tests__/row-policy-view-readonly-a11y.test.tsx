// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowPolicyView } from "../pages/admin/RowPolicyView";

/**
 * Lucy v0.25 P1-1（L25-14 R3）—— RTV-07：只读与可达性。
 *
 * Authority:
 *   - `docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` §8
 *     RTV-07 | 只读与可达性 | 页面无写 API；键盘、表格、焦点和翻译防御满足设计规范
 *   - 同文 §7 Design System Compliance（沿用 `webui/docs/design-system/`：
 *     `00-principles.md` §3 可读与可达、`11-components-data-grid.md` §3 Base Contract
 *     与 §3.1 滚动区可访问性分级、§8.1 可访问性、`20-patterns-page-layout.md` §6
 *     「所有可交互区域必须可键盘访问，焦点顺序符合视觉阅读顺序」）
 *   - 同文 Terminology Compliance 的 Protected DOM 段
 *
 * 2026-10-30 的收口记录把 RTV-07 记为「开放：页面为只读，键盘、表格、焦点与
 * 翻译防御尚无测试」。本文件补的就是这四样此前**没有任何断言**的东西。
 *
 * 本文件只断言**行为**，不碰实现；写入口的另一半（服务端没有写路由）落在
 * `webui/server/__tests__/p1-row-policy-closure.test.ts`。
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
      rowGrant: SCOPED_GRANT
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

type FetchCall = [unknown, RequestInit | undefined];

function fetchCalls(): FetchCall[] {
  return (globalThis.fetch as unknown as { mock: { calls: FetchCall[] } }).mock.calls;
}

function fetchUrls(): string[] {
  return fetchCalls().map((call) => String(call[0] ?? ""));
}

/**
 * 翻译防御是否成立。
 *
 * `translate="no"` 与 `notranslate` 都是**子树级**语义：放在祖先上即可覆盖后代。
 * 因此判据是「该节点自己或它在页面根内的任一祖先」同时带 `translate="no"` 与
 * `notranslate` class。
 */
function isTranslationDefended(node: Element, pageRoot: Element): boolean {
  let current: Element | null = node;
  while (current) {
    const classes = typeof current.className === "string" ? current.className : "";
    if (current.getAttribute("translate") === "no" && classes.includes("notranslate")) return true;
    if (current === pageRoot) return false;
    current = current.parentElement;
  }
  return false;
}

/**
 * 已知实现缺口名单已删除。
 *
 * 收口记录 `docs/reviews/2026-11-01-row-policy-templates-and-view-closure.md` §七 登记的
 * 唯一一处缺口——并集小节的「来源角色：{角色 id 列表}」没有翻译防御——已由 70f27ba0 修复：
 * `RowPolicyDnfPreview.tsx` 的 `row-policy-dnf-source-roles` 段现在带 `notranslate` +
 * `translate="no"`。名单随之清空，全页机器标识扫描现在对**任何**没受防御的标识都转红。
 */

beforeEach(() => {
  copyTextWithToastMock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/row-policy/views/tables")) {
        return new Response(JSON.stringify({ ok: true, data: LIST }));
      }
      if (url.startsWith("/api/admin/row-policy/views/table")) {
        return new Response(JSON.stringify({ ok: true, data: DETAIL }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
        status: 404
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RTV-07 只读：页面没有写入口", () => {
  it("RTV-07 页面无写 API：所有请求都是读方法，页面上没有写控件，也没有表单", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await screen.findByTestId("row-policy-view-role-branches");

    // 交互一次筛选，确认**交互路径**也不发写请求。
    fireEvent.change(screen.getByLabelText("角色筛选"), { target: { value: "east_role" } });
    await waitFor(() =>
      expect(fetchUrls().some((url) => url.includes("roleId=east_role"))).toBe(true)
    );

    // ① 请求方法只有 GET（`apiGet` 不带 method，fetch 默认 GET）。
    const methods = fetchCalls().map((call) => String(call[1]?.method ?? "GET").toUpperCase());
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) expect(method).toBe("GET");

    // ② 请求 URL 只落在两个只读读接口上。
    for (const url of fetchUrls()) {
      expect(
        url.startsWith("/api/admin/row-policy/views/tables") ||
          url.startsWith("/api/admin/row-policy/views/table?")
      ).toBe(true);
    }

    // ③ 没有表单：表单提交就是一个写入口。
    expect(document.querySelectorAll("form")).toHaveLength(0);

    // ④ 没有写控件（按钮）。页面上只有读控件与只读深链。
    for (const label of [/保存/, /新建/, /删除/, /应用/, /提交/, /修改/, /预演/, /导入/, /导出/]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
    // 页面自己就写着只读，并指向真正的写入口。67e1117e（行权限视图答案优先双栏 v0.4）
    // 把这句话从一句扁平文本改成「文案 + 指向 /admin/roles 的深链」，所以断言要跟着结构走：
    // 文案仍然在，写入口仍然是那个角色权限链接。
    const readOnlyNotice = screen.getByText(/本页只读。修改请到/);
    expect(readOnlyNotice).toBeInTheDocument();
    expect(within(readOnlyNotice).getByRole("link", { name: "角色权限" })).toHaveAttribute(
      "href",
      "/admin/roles"
    );
  });
});

describe("RTV-07 键盘可达与焦点", () => {
  it("RTV-07 键盘可达：五个筛选控件按阅读顺序可聚焦，没有正 tabindex 停靠点", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());

    const labels = ["连接筛选", "Schema 筛选", "表筛选", "角色筛选", "Agent 筛选"];
    const controls = labels.map((label) => screen.getByLabelText(label));

    // ① DOM 顺序 = 视觉阅读顺序（从左到右）。
    for (let index = 1; index < controls.length; index += 1) {
      const position = controls[index - 1].compareDocumentPosition(controls[index]);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    // ② 每个控件都能被 Tab 停靠：没有 disabled，没有 tabindex="-1"。
    for (const control of controls) {
      expect(control).not.toBeDisabled();
      expect(control.getAttribute("tabindex")).not.toBe("-1");
    }

    // ③ 没有正 tabindex——正 tabindex 会打乱自然焦点顺序。
    const positiveTabindex = Array.from(document.querySelectorAll("[tabindex]")).filter(
      (node) => Number(node.getAttribute("tabindex")) > 0
    );
    expect(positiveTabindex).toHaveLength(0);

    // ④ 普通不滚动表格不产生额外 Tab 停靠点（data-grid §3.1 滚动区可访问性分级）。
    const scroll = document.querySelector(".pl-data-grid-scroll");
    expect(scroll).not.toBeNull();
    expect(scroll?.getAttribute("tabindex")).toBeNull();
    expect(scroll?.getAttribute("role")).not.toBe("region");
  });

  it("RTV-07 键盘可达：交互控件是原生 button，不是 div 冒充", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger&roleId=east_role");
    await screen.findByTestId("row-policy-view-role-branches");

    // 选表的触发控件：原生 <button type="button">，键盘可激���。
    const trigger = screen.getByRole("button", { name: "warehouse/fin/fin_ledger" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");

    // 分段控件的每一项：原生 button。
    for (const name of ["全部表", "仅受限表"]) {
      const item = screen.getByRole("button", { name });
      expect(item.tagName).toBe("BUTTON");
      expect(item).toHaveAttribute("type", "button");
    }

    // 清除筛选：原生 button。
    const clear = screen.getByTestId("row-policy-view-clear-filters");
    expect(clear.tagName).toBe("BUTTON");
    expect(clear).toHaveAttribute("type", "button");

    // 只读深链是真链接（可聚焦、可中键新开），不是 onClick 的 span。
    const roleLink = screen.getByRole("link", { name: "east_role" });
    expect(roleLink.tagName).toBe("A");
    expect(roleLink).toHaveAttribute("href", "/admin/roles/east_role");
  });

  it("RTV-07 焦点：选中表后焦点留在触发控件上，详情加载不抢焦点", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("row-policy-view-table-list")).toBeInTheDocument());

    const trigger = screen.getByRole("button", { name: "warehouse/fin/fin_ledger" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId("row-policy-view-detail")).toBeInTheDocument());

    // 详情出现后，焦点既没有掉到 body，也没有被详情抢走。
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("RTV-07 表格：数据网格 Base Contract", () => {
  it("RTV-07 表格：网格基类、frame／scroll 外框、表头列语义与选中态", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    const table = await screen.findByTestId("row-policy-view-table-list");

    // ① Base Contract：复用共享基类，不另起一套表格基线。
    expect(table.tagName).toBe("TABLE");
    expect(table.className).toContain("pl-data-grid");
    expect(table.className).toContain("pl-data-table");

    // ② frame／scroll 外框与宽度约束（data-grid §3.1）。
    const frame = table.closest(".pl-data-grid-frame");
    expect(frame).not.toBeNull();
    expect(frame?.className).toContain("min-w-0");
    expect(frame?.className).toContain("max-w-full");
    const scroll = table.closest(".pl-data-grid-scroll");
    expect(scroll).not.toBeNull();
    expect(scroll?.className).toContain("min-w-0");
    expect(scroll?.className).toContain("max-w-full");
    expect(scroll?.className).toContain("w-full");

    // ③ 表头列语义：每列都有 `scope="col"` 的清晰列名。
    const headers = Array.from(table.querySelectorAll("thead th"));
    expect(headers.map((th) => th.textContent)).toEqual(["表", "角色数", "Agent 数", "有效行授予"]);
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col");
    }

    // ④ 单元格数与列数一致；选中行用 aria-current（不只用颜色表达状态）。
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(1);
    for (const row of rows) {
      expect(row.querySelectorAll("td")).toHaveLength(headers.length);
    }
    expect(rows[0]).toHaveAttribute("aria-current", "true");
  });
});

describe("RTV-07 翻译防御：受保护标识", () => {
  it("RTV-07 翻译防御：连接／Schema／表／角色／Agent／字段标识与快照身份都受翻译防御", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await screen.findByTestId("row-policy-view-role-branches");

    const page = screen.getByTestId("row-policy-view-page");
    const eastRole = screen.getByTestId("row-policy-view-role-east_role");

    const protectedNodes: Element[] = [
      // 连接／Schema／表标识
      screen.getByText("warehouse/fin/fin_ledger"),
      screen.getByText("warehouse · fin"),
      screen.getByRole("button", { name: "warehouse/fin/fin_ledger" }),
      // 角色标识
      screen.getByRole("link", { name: "east_role" }),
      // 模板标识（`templateRefs`）
      screen.getByText("引用模板：by_region"),
      // 字段标识（内联谓词）
      ...screen.getAllByText("status 等于 SETTLED"),
      // 谓词分支里的字段标识
      ...screen.getAllByText("region 等于 East"),
      // Agent 标识
      within(screen.getByTestId("row-policy-dnf-agent-agent_a")).getByText("agent_a"),
      // 快照身份四字段（configVersion／policyVersion／sourceMapVersion／capabilityDigest）
      ...Array.from(screen.getByTestId("row-policy-snapshot").querySelectorAll("dd"))
    ];

    for (const node of protectedNodes) {
      expect({ node: node.textContent, defended: isTranslationDefended(node, page) }).toEqual({
        node: node.textContent,
        defended: true
      });
    }
  });

  it("RTV-07 翻译防御：页面上没有新的、没受防御的机器标识文本", async () => {
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await screen.findByTestId("row-policy-view-role-branches");

    const page = screen.getByTestId("row-policy-view-page");
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const undefended: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (!text) continue;
      // 机器 token：含下划线或连字符的 ASCII 标识符（表名、角色 id、Agent id、
      // 模板名、快照哈希……）。纯中文文案与纯数字不在此列。
      if (!/[A-Za-z][A-Za-z0-9]*[_-][A-Za-z0-9]/.test(text)) continue;
      const element = node.parentElement;
      if (!element) continue;
      if (isTranslationDefended(element, page)) continue;
      undefended.push(text);
    }

    // 收口记录 §七 登记的唯一已知缺口已修复（见本文件顶部的说明），
    // 已知缺口名单随之清空。这里现在对**任何**没受防御的机器标识都转红。
    expect(undefended).toEqual([]);
  });

  it("RTV-07 翻译防御：并集小节的「来源角色」列表受翻译防御", async () => {
    // 收口记录 §七 登记的实现缺口已由 70f27ba0 修复：
    // webui/src/components/admin/RowPolicyDnfPreview.tsx 的「来源角色：{角色 id 列表}」
    // 现在带 translate="no" + notranslate，符合本 Spec Terminology Compliance 的
    // Protected DOM 段（角色标识）。原用例以 `it.fails` 如实登记缺口，实现修好后
    // 必须去掉 `.fails` 并转为正向断言。
    renderView("/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger");
    await screen.findByTestId("row-policy-view-role-branches");

    const page = screen.getByTestId("row-policy-view-page");
    const source = screen.getByText(/来源角色/);
    expect(source.textContent).toContain("east_role");
    expect(isTranslationDefended(source, page)).toBe(true);
  });
});
