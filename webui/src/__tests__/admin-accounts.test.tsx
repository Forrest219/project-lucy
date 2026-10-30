// @vitest-environment jsdom
//
// 登录账户页（lucy-20261030-login-accounts）—— 名册、对话框、抽屉、四条保护。
//
// 名册是主画布；新建在对话框里；一个账户的维护在抽屉里。保护按钮用
// `aria-disabled="true"`（不是原生 `disabled`），因此仍可聚焦并能说明原因。
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAccounts } from "../pages/admin/AdminAccounts";

type AuthMe = {
  id: string;
  displayName: string;
  role: "owner" | "operator";
  enabled: boolean;
  createdAt: string | null;
};

const authState = vi.hoisted(() => ({
  status: {
    mode: "required" as "open" | "bootstrap" | "required",
    me: null as AuthMe | null,
    authEnabled: true,
    methods: ["local"] as string[]
  },
  loading: false,
  login: vi.fn(),
  bootstrap: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => authState
}));

const OWNER_ME: AuthMe = {
  id: "admin_zhang",
  displayName: "张管理员",
  role: "owner",
  enabled: true,
  createdAt: null
};

type AdminFixture = Record<string, unknown>;

const ADMINS: AdminFixture[] = [
  {
    id: "admin_zhang",
    displayName: "张管理员",
    role: "owner",
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    loginMethods: ["local"]
  },
  {
    id: "ops_li",
    displayName: "李运维",
    role: "operator",
    enabled: false,
    createdAt: "2026-08-02T00:00:00.000Z",
    loginMethods: ["local"]
  }
];

type RecordedCall = { url: string; method: string; body: unknown };

let calls: RecordedCall[] = [];

function stubAdminsFetch(
  admins: unknown,
  handler?: (url: string, method: string, init?: RequestInit) => Response | undefined
) {
  calls = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    });
    if (handler) {
      const handled = handler(url, method, init);
      if (handled) return handled;
    }
    if (url.startsWith("/api/admin/admins") && method === "GET") {
      return new Response(JSON.stringify({ ok: true, data: { mode: "required", admins } }));
    }
    if (url.startsWith("/api/admin/admins") && method === "PATCH") {
      return new Response(JSON.stringify({ ok: true, data: { admin: {} } }));
    }
    if (url.startsWith("/api/admin/admins") && method === "DELETE") {
      return new Response(JSON.stringify({ ok: true, data: { deleted: "ok" } }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
      status: 404
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAdminAccounts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/accounts"]}>
        <AdminAccounts />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function patchCalls() {
  return calls.filter((call) => call.method === "PATCH");
}

function deleteCalls() {
  return calls.filter((call) => call.method === "DELETE");
}

async function openDrawer(id: string) {
  fireEvent.click(await screen.findByTestId(`admin-account-manage-${id}`));
  return screen.findByTestId(`admin-account-drawer-${id}`);
}

beforeEach(() => {
  authState.status = {
    mode: "required",
    me: OWNER_ME,
    authEnabled: true,
    methods: ["local"]
  };
  vi.spyOn(window, "confirm").mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("登录账户页（lucy-20261030-login-accounts）", () => {
  it("SC-03 所有者看到页头「新建账户」，页面没有旧的常驻标题", async () => {
    stubAdminsFetch(ADMINS);
    renderAdminAccounts();

    expect(await screen.findByRole("button", { name: "新建账户" })).toBeInTheDocument();
    expect(screen.queryByText("添加登录账户")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /OIDC 身份绑定/ })).not.toBeInTheDocument();
    // 名册是主画布：表格与帧还在，创建表单不再常驻。
    expect(await screen.findByTestId("admin-accounts-grid-frame")).toHaveClass(
      "pl-data-grid-frame"
    );
    expect(screen.getByRole("columnheader", { name: "登录账户" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(screen.queryByLabelText("登录账户")).not.toBeInTheDocument();
  });

  it("SC-05 开放模式保留原说明，没有「新建账户」和「管理」", async () => {
    authState.status = { mode: "open", me: null, authEnabled: false, methods: [] };
    stubAdminsFetch(ADMINS);
    renderAdminAccounts();

    expect(await screen.findByText(/当前为开放模式/)).toBeInTheDocument();
    expect(screen.getByTestId("admin-accounts-table")).toHaveClass("pl-data-grid", "pl-data-table");
    expect(screen.queryByRole("button", { name: "新建账户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
  });

  it("SC-08 当前登录的行有标记，抽屉标题是该登录账户 id", async () => {
    stubAdminsFetch(ADMINS);
    renderAdminAccounts();

    expect(await screen.findByTestId("admin-account-current-admin_zhang")).toHaveTextContent(
      "当前登录"
    );
    expect(screen.queryByTestId("admin-account-current-ops_li")).not.toBeInTheDocument();

    const drawer = await openDrawer("admin_zhang");
    expect(within(drawer).getByTestId("admin-account-drawer-title")).toHaveTextContent(
      "admin_zhang"
    );
  });

  it("SC-09 当前登录账户的禁用与删除不可执行，且不发请求", async () => {
    stubAdminsFetch([
      {
        id: "admin_zhang",
        displayName: "张管理员",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      },
      {
        id: "admin_li",
        displayName: "李所有者",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      }
    ]);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    const toggle = within(drawer).getByTestId("admin-account-toggle-admin_zhang");
    const remove = within(drawer).getByTestId("admin-account-delete-admin_zhang");

    // 不可执行，但仍然可聚焦，并用 aria-disabled 而不是原生 disabled。
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled();
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).not.toBeDisabled();
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    // 气泡关闭时，说明节点已经在 DOM 里。
    expect(
      within(drawer).getByTestId("admin-account-toggle-admin_zhang-reason")
    ).toHaveTextContent("无法禁用当前登录账户");
    expect(
      within(drawer).getByTestId("admin-account-delete-admin_zhang-reason")
    ).toHaveTextContent("无法删除当前登录账户");

    // 点击、Enter、Space 都不发请求，也不打开删除确认。
    fireEvent.click(toggle);
    fireEvent.click(remove);
    expect(fireEvent.keyDown(toggle, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(toggle, { key: " " })).toBe(false);
    expect(fireEvent.keyDown(remove, { key: "Enter" })).toBe(false);
    expect(patchCalls()).toHaveLength(0);
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.queryByTestId("admin-account-delete-modal")).not.toBeInTheDocument();

    // 另一名所有者不受影响：禁用可执行并发出 PATCH。
    const otherDrawer = await openDrawer("admin_li");
    const otherToggle = within(otherDrawer).getByTestId("admin-account-toggle-admin_li");
    expect(otherToggle).not.toHaveAttribute("aria-disabled");
    fireEvent.click(otherToggle);
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0].url).toBe("/api/admin/admins/admin_li");
    expect(patchCalls()[0].body).toEqual({ enabled: false });
  });

  it("SC-10 唯一一名启用且有本地密码的所有者：禁用、删除和降权都不可执行", async () => {
    stubAdminsFetch([
      {
        id: "admin_zhang",
        displayName: "张管理员",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      }
    ]);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    const toggle = within(drawer).getByTestId("admin-account-toggle-admin_zhang");
    const remove = within(drawer).getByTestId("admin-account-delete-admin_zhang");
    const roleSelect = within(drawer).getByTestId("admin-account-role-select-admin_zhang");

    for (const node of [toggle, remove]) {
      expect(node).toHaveAttribute("aria-disabled", "true");
      expect(node).not.toBeDisabled();
    }
    // 两条底线文案都在。
    expect(within(drawer).getByTestId("admin-account-toggle-admin_zhang-reason")).toHaveTextContent(
      "至少保留一名启用中的所有者"
    );
    expect(
      within(drawer).getByTestId("admin-account-toggle-admin_zhang-reason")
    ).toHaveTextContent("至少保留一名可使用本地密码登录的启用中所有者");
    expect(
      within(drawer).getByTestId("admin-account-delete-admin_zhang-reason")
    ).toHaveTextContent("至少保留一名启用中的所有者");

    // 「运维」选项不可选，控件旁有可见原因。
    const operatorOption = within(roleSelect).getByRole("option", { name: "运维" });
    expect(operatorOption).toBeDisabled();
    const roleReason = within(drawer).getByTestId("admin-account-role-reason-admin_zhang");
    expect(roleReason).toBeVisible();
    expect(roleReason).toHaveTextContent("至少保留一名启用中的所有者");
    expect(roleReason).toHaveTextContent("至少保留一名可使用本地密码登录的启用中所有者");
    expect(roleSelect).toHaveAttribute("aria-describedby", roleReason.id);

    fireEvent.click(toggle);
    fireEvent.click(remove);
    fireEvent.change(roleSelect, { target: { value: "operator" } });
    expect(patchCalls()).toHaveLength(0);
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.queryByTestId("admin-account-delete-modal")).not.toBeInTheDocument();
  });

  it("SC-10 两名启用所有者中只有一人有本地密码：底线落在有本地密码的那一侧", async () => {
    // A 有本地密码，B 只有单点登录，当前人是 B。
    authState.status = {
      mode: "required",
      me: { ...OWNER_ME, id: "admin_b" },
      authEnabled: true,
      methods: ["local", "oidc"]
    };
    stubAdminsFetch([
      {
        id: "admin_a",
        displayName: "甲所有者",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      },
      {
        id: "admin_b",
        displayName: "乙所有者",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["oidc"]
      }
    ]);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_a");
    const toggle = within(drawer).getByTestId("admin-account-toggle-admin_a");
    const remove = within(drawer).getByTestId("admin-account-delete-admin_a");
    const roleSelect = within(drawer).getByTestId("admin-account-role-select-admin_a");

    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAttribute("aria-disabled", "true");

    const reasons = [
      "admin-account-toggle-admin_a-reason",
      "admin-account-delete-admin_a-reason",
      "admin-account-role-reason-admin_a"
    ];
    for (const testId of reasons) {
      const node = within(drawer).getByTestId(testId);
      expect(node).toHaveTextContent("至少保留一名可使用本地密码登录的启用中所有者");
      expect(node.textContent).not.toContain("无法禁用当前登录账户");
      expect(node.textContent).not.toContain("无法删除当前登录账户");
    }

    fireEvent.click(toggle);
    fireEvent.click(remove);
    fireEvent.change(roleSelect, { target: { value: "operator" } });
    expect(patchCalls()).toHaveLength(0);
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.queryByTestId("admin-account-delete-modal")).not.toBeInTheDocument();

    // 降权 B（当前人、本人没有本地密码）可以执行。
    const drawerB = await openDrawer("admin_b");
    const roleSelectB = within(drawerB).getByTestId("admin-account-role-select-admin_b");
    fireEvent.change(roleSelectB, { target: { value: "operator" } });
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0].url).toBe("/api/admin/admins/admin_b");
    expect(patchCalls()[0].body).toEqual({ role: "operator" });
  });

  it("SC-10 两名启用所有者都有本地密码时，当前人可以把自己改为运维", async () => {
    stubAdminsFetch([
      {
        id: "admin_zhang",
        displayName: "张管理员",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      },
      {
        id: "admin_li",
        displayName: "李所有者",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      }
    ]);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    const roleSelect = within(drawer).getByTestId("admin-account-role-select-admin_zhang");
    expect(within(roleSelect).getByRole("option", { name: "运维" })).not.toBeDisabled();

    fireEvent.change(roleSelect, { target: { value: "operator" } });
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0].url).toBe("/api/admin/admins/admin_zhang");
    expect(patchCalls()[0].body).toEqual({ role: "operator" });
  });

  it("SC-12 删除确认在登录账户 id 一致前不发出 DELETE", async () => {
    stubAdminsFetch([
      {
        id: "admin_zhang",
        displayName: "张管理员",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      },
      {
        id: "xingchen",
        displayName: "王账户",
        role: "operator",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      }
    ]);
    renderAdminAccounts();

    const drawer = await openDrawer("xingchen");
    fireEvent.click(within(drawer).getByTestId("admin-account-delete-xingchen"));
    const modal = await screen.findByTestId("admin-account-delete-modal");

    const confirm = within(modal).getByTestId("admin-account-delete-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).not.toBeDisabled();
    // 气泡关闭时说明节点已经在 DOM 里，并说清必须输入登录账户 id。
    const reason = within(modal).getByTestId("admin-account-delete-confirm-reason");
    expect(reason).toHaveTextContent("登录账户 id");
    expect(screen.queryByTestId("admin-account-delete-confirm-tooltip")).not.toBeInTheDocument();

    fireEvent.click(confirm);
    expect(fireEvent.keyDown(confirm, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(confirm, { key: " " })).toBe(false);
    expect(deleteCalls()).toHaveLength(0);
  });

  it.each([
    ["xingchen", 1],
    [" xingchen ", 1],
    ["\nxingchen\n", 1],
    ["Xingchen", 0],
    ["xing\nchen", 0]
  ])("SC-12 删除比较：输入 %j 发出 %i 次 DELETE", async (typed, expected) => {
    stubAdminsFetch([
      {
        id: "admin_zhang",
        displayName: "张管理员",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      },
      {
        id: "xingchen",
        displayName: "王账户",
        role: "operator",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      }
    ]);
    renderAdminAccounts();

    const drawer = await openDrawer("xingchen");
    fireEvent.click(within(drawer).getByTestId("admin-account-delete-xingchen"));
    const modal = await screen.findByTestId("admin-account-delete-modal");

    fireEvent.change(within(modal).getByTestId("admin-account-delete-input"), {
      target: { value: typed }
    });
    const confirm = within(modal).getByTestId("admin-account-delete-confirm");
    if (expected === 0) {
      expect(confirm).toHaveAttribute("aria-disabled", "true");
    } else {
      expect(confirm).not.toHaveAttribute("aria-disabled");
      expect(confirm).toHaveClass("pl-btn--danger");
    }
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteCalls()).toHaveLength(expected));
    if (expected === 1) {
      expect(deleteCalls()[0].url).toBe("/api/admin/admins/xingchen");
      expect(deleteCalls()[0].method).toBe("DELETE");
    }
  });

  it("SC-13 接口拒绝时把接口文案留在抽屉或确认框里", async () => {
    stubAdminsFetch(
      [
        {
          id: "admin_zhang",
          displayName: "张管理员",
          role: "owner",
          enabled: true,
          createdAt: null,
          loginMethods: ["local"]
        },
        {
          id: "admin_li",
          displayName: "李所有者",
          role: "owner",
          enabled: true,
          createdAt: null,
          loginMethods: ["local"]
        }
      ],
      (url, method) => {
        if (method === "PATCH") {
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: "LAST_OWNER_REQUIRED", message: "至少保留一名启用中的所有者" }
            }),
            { status: 400 }
          );
        }
        if (method === "DELETE") {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "LOCAL_OWNER_REQUIRED",
                message: "至少保留一名可使用本地密码登录的启用中所有者"
              }
            }),
            { status: 400 }
          );
        }
        return undefined;
      }
    );
    renderAdminAccounts();

    const drawer = await openDrawer("admin_li");
    fireEvent.click(within(drawer).getByTestId("admin-account-toggle-admin_li"));
    expect(await screen.findByTestId("admin-account-drawer-error")).toHaveTextContent(
      "至少保留一名启用中的所有者"
    );

    fireEvent.click(within(drawer).getByTestId("admin-account-delete-admin_li"));
    const modal = await screen.findByTestId("admin-account-delete-modal");
    fireEvent.change(within(modal).getByTestId("admin-account-delete-input"), {
      target: { value: "admin_li" }
    });
    fireEvent.click(within(modal).getByTestId("admin-account-delete-confirm"));
    expect(await screen.findByTestId("admin-account-delete-error")).toHaveTextContent(
      "至少保留一名可使用本地密码登录的启用中所有者"
    );
  });

  it("SC-14 保存密码调用 PATCH，成功后显示「本地密码已更新。」", async () => {
    stubAdminsFetch(ADMINS);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    fireEvent.change(within(drawer).getByTestId("admin-account-password-input-admin_zhang"), {
      target: { value: "correct-horse-battery" }
    });
    fireEvent.click(within(drawer).getByTestId("admin-account-password-save-admin_zhang"));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0].url).toBe("/api/admin/admins/admin_zhang");
    expect(patchCalls()[0].body).toEqual({ password: "correct-horse-battery" });
    expect(await screen.findByTestId("admin-account-password-saved")).toHaveTextContent(
      "本地密码已更新。"
    );
  });

  it("SC-16 用户可见文案不含禁用词", async () => {
    stubAdminsFetch(ADMINS);
    const { container } = renderAdminAccounts();

    await screen.findByTestId("admin-accounts-grid-frame");

    // 页头、侧栏、对话框标题不得使用禁用词。
    const titled = Array.from(
      container.querySelectorAll("h1, h2, h3, button, label, option, th")
    );
    for (const node of titled) {
      const text = (node.textContent ?? "").trim();
      for (const forbidden of ["用户管理", "账户管理", "新建用户", "添加用户"]) {
        expect(text).not.toBe(forbidden);
      }
    }

    // 其余禁用词在整页可见文案里都不得出现。
    const text = container.textContent ?? "";
    for (const forbidden of ["用户管理", "新建用户", "添加用户", "当前用户", "输入用户名"]) {
      expect(text).not.toContain(forbidden);
    }

    // 页头仍然是「登录账户」。
    expect(screen.getByRole("heading", { name: "登录账户" })).toBeInTheDocument();
  });

  it("SC-17 两组不可执行按钮都断言：可聚焦、气泡关闭时节点在 DOM、气泡文本与节点相同", async () => {
    stubAdminsFetch([
      {
        id: "admin_zhang",
        displayName: "张管理员",
        role: "owner",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      },
      {
        id: "ops_li",
        displayName: "李运维",
        role: "operator",
        enabled: true,
        createdAt: null,
        loginMethods: ["local"]
      }
    ]);
    renderAdminAccounts();

    // 角色控件的 aria-describedby 指向控件旁可见的原因（SC-10 的拒绝夹具）。
    const drawer = await openDrawer("admin_zhang");
    const roleSelect = within(drawer).getByTestId("admin-account-role-select-admin_zhang");
    const roleReason = within(drawer).getByTestId("admin-account-role-reason-admin_zhang");
    expect(roleSelect).toHaveAttribute("aria-describedby", roleReason.id);
    expect(roleReason).toBeVisible();
    expect(roleReason).toHaveTextContent("至少保留一名启用中的所有者");

    // 第一组：SC-09 的保护按钮（抽屉里的「禁用」）。
    const toggle = within(drawer).getByTestId("admin-account-toggle-admin_zhang");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled();
    const toggleReason = within(drawer).getByTestId("admin-account-toggle-admin_zhang-reason");
    expect(toggleReason).toBeInTheDocument();
    expect(screen.queryByTestId("admin-account-toggle-admin_zhang-tooltip")).not.toBeInTheDocument();
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    const toggleTooltip = await screen.findByTestId("admin-account-toggle-admin_zhang-tooltip");
    expect(toggleTooltip).toHaveTextContent(toggleReason.textContent ?? "");
    fireEvent.blur(toggle);
    // 悬浮也显示同一句。
    fireEvent.pointerMove(toggle);
    await waitFor(() =>
      expect(screen.getByTestId("admin-account-toggle-admin_zhang-tooltip")).toHaveTextContent(
        toggleReason.textContent ?? ""
      )
    );
    fireEvent.blur(toggle);

    // 第二组：SC-12 的删除确认按钮——不能用保护按钮的断言代替。
    const opsDrawer = await openDrawer("ops_li");
    fireEvent.click(within(opsDrawer).getByTestId("admin-account-delete-ops_li"));
    const modal = await screen.findByTestId("admin-account-delete-modal");
    const confirm = within(modal).getByTestId("admin-account-delete-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).not.toBeDisabled();
    const confirmReason = within(modal).getByTestId("admin-account-delete-confirm-reason");
    expect(confirmReason).toBeInTheDocument();
    expect(screen.queryByTestId("admin-account-delete-confirm-tooltip")).not.toBeInTheDocument();
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    const confirmTooltip = await screen.findByTestId("admin-account-delete-confirm-tooltip");
    expect(confirmTooltip).toHaveTextContent(confirmReason.textContent ?? "");
    fireEvent.blur(confirm);
    fireEvent.pointerMove(confirm);
    await waitFor(() =>
      expect(screen.getByTestId("admin-account-delete-confirm-tooltip")).toHaveTextContent(
        confirmReason.textContent ?? ""
      )
    );
  });
});
