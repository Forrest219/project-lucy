// @vitest-environment jsdom
//
// L25-06 OIDC 单点登录 + 登录账户页（lucy-20261030-login-accounts）——
// 新建对话框的条件字段、抽屉里的身份绑定、以及「移除本地密码」的出现条件。
//
// Guards: 单点登录未启用时不展开绑定字段；绑定分组在抽屉里；operators never
// get binding write controls; missing backend binding fields degrade to
// "not bound"; business-rule failures show the backend's user-safe message
// while everything else falls back to fixed copy.
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
    mode: "required" as "open" | "bootstrap" | "required" | "unavailable",
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

const OPERATOR_ME: AuthMe = {
  id: "ops_li",
  displayName: "李运维",
  role: "operator",
  enabled: true,
  createdAt: null
};

const BINDING = {
  issuer: "https://idp.example.com",
  sub: "zhang|0042",
  email: "zhang@example.com"
};

const ADMINS_WITH_BINDING = {
  mode: "required",
  admins: [
    {
      id: "admin_zhang",
      displayName: "张管理员",
      role: "owner",
      enabled: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      loginMethods: ["local", "oidc"],
      oidcBindings: [BINDING]
    },
    {
      id: "ops_li",
      displayName: "李运维",
      role: "operator",
      enabled: true,
      createdAt: "2026-08-02T00:00:00.000Z",
      loginMethods: ["local"]
    }
  ]
};

const ADMINS_WITHOUT_BINDING_FIELDS = {
  mode: "required",
  admins: [
    {
      id: "admin_zhang",
      displayName: "张管理员",
      role: "owner",
      enabled: true,
      createdAt: "2026-08-01T00:00:00.000Z"
    }
  ]
};

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
      const list = Array.isArray(admins) ? admins : ((admins as { admins?: unknown[] })?.admins ?? []);
      return new Response(JSON.stringify({ ok: true, data: { mode: "required", admins: list } }));
    }
    if (url.startsWith("/api/admin/admins") && method === "POST") {
      return new Response(JSON.stringify({ ok: true, data: { admin: {} } }));
    }
    if (url.startsWith("/api/admin/admins") && method === "PATCH") {
      return new Response(JSON.stringify({ ok: true, data: { admin: {} } }));
    }
    if (url.startsWith("/api/admin/admins") && method === "PUT") {
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

async function openDrawer(id: string) {
  fireEvent.click(await screen.findByTestId(`admin-account-manage-${id}`));
  return screen.findByTestId(`admin-account-drawer-${id}`);
}

beforeEach(() => {
  authState.status = {
    mode: "required",
    me: OWNER_ME,
    authEnabled: true,
    methods: ["local", "oidc"]
  };
  vi.spyOn(window, "confirm").mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("登录账户页 OIDC 身份绑定（L25-06 + lucy-20261030-login-accounts）", () => {
  it("SC-04 运维名册只有四列，没有登录方式、新建账户、管理和禁用", async () => {
    authState.status = {
      mode: "required",
      me: OPERATOR_ME,
      authEnabled: true,
      methods: ["local", "oidc"]
    };
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    expect(await screen.findByRole("columnheader", { name: "登录账户" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "显示名" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "角色" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "登录方式" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新建账户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "禁用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增／替换绑定" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除本地密码" })).not.toBeInTheDocument();
  });

  it("SC-06 单点登录未启用时新建对话框只有四个字段，页头下一句说明", async () => {
    authState.status = {
      mode: "required",
      me: OWNER_ME,
      authEnabled: true,
      methods: ["local"]
    };
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    // 页头下只有一句未启用说明。
    const notice = await screen.findByTestId("admin-accounts-oidc-disabled-notice");
    expect(notice).toHaveTextContent("当前未启用单点登录；新增或替换绑定需要先启用身份源配置。");
    expect(
      screen.getAllByText("当前未启用单点登录；新增或替换绑定需要先启用身份源配置。")
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId("admin-account-create-open"));
    const modal = await screen.findByTestId("admin-account-create-modal");
    expect(within(modal).getByLabelText("登录账户")).toBeInTheDocument();
    expect(within(modal).getByLabelText("显示名")).toBeInTheDocument();
    expect(within(modal).getByLabelText("初始密码")).toBeInTheDocument();
    expect(within(modal).getByLabelText("角色")).toBeInTheDocument();
    expect(within(modal).queryByTestId("admin-create-binding-issuer")).not.toBeInTheDocument();
    expect(within(modal).queryByTestId("admin-create-binding-sub")).not.toBeInTheDocument();
    expect(within(modal).queryByTestId("admin-create-binding-email")).not.toBeInTheDocument();
    expect(within(modal).queryByTestId("admin-create-bind-toggle")).not.toBeInTheDocument();
    expect(within(modal).queryByText(/身份源/)).not.toBeInTheDocument();
  });

  it("SC-07 单点登录已启用时，未勾选不出现三项，勾选后三项必填且密码可留空", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    fireEvent.click(await screen.findByTestId("admin-account-create-open"));
    const modal = await screen.findByTestId("admin-account-create-modal");
    const password = within(modal).getByLabelText("初始密码");

    expect(within(modal).queryByTestId("admin-create-binding-issuer")).not.toBeInTheDocument();
    expect(password).toBeRequired();

    fireEvent.click(within(modal).getByTestId("admin-create-bind-toggle"));
    expect(within(modal).getByTestId("admin-create-binding-issuer")).toBeRequired();
    expect(within(modal).getByTestId("admin-create-binding-sub")).toBeRequired();
    expect(within(modal).getByTestId("admin-create-binding-email")).toBeRequired();
    expect(password).not.toBeRequired();
    expect(within(modal).getByText(/已填写单点登录身份绑定/)).toBeInTheDocument();
  });

  it("SC-15 未勾选时 POST 不带 oidcBinding", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    fireEvent.click(await screen.findByTestId("admin-account-create-open"));
    const modal = await screen.findByTestId("admin-account-create-modal");
    fireEvent.change(within(modal).getByLabelText("登录账户"), { target: { value: "admin_new" } });
    fireEvent.change(within(modal).getByLabelText("初始密码"), {
      target: { value: "correct-horse-battery" }
    });
    // 勾选并填齐后又取消勾选：请求仍然不带绑定。
    fireEvent.click(within(modal).getByTestId("admin-create-bind-toggle"));
    fireEvent.change(within(modal).getByTestId("admin-create-binding-issuer"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(within(modal).getByTestId("admin-create-binding-sub"), {
      target: { value: "new|1" }
    });
    fireEvent.change(within(modal).getByTestId("admin-create-binding-email"), {
      target: { value: "new@example.com" }
    });
    fireEvent.click(within(modal).getByTestId("admin-create-bind-toggle"));
    expect(within(modal).queryByTestId("admin-create-binding-issuer")).not.toBeInTheDocument();
    fireEvent.click(within(modal).getByTestId("admin-account-create-submit"));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/admin/admins");
    expect(post?.body).not.toHaveProperty("oidcBinding");
    expect(post?.body).toHaveProperty("password", "correct-horse-battery");
  });

  it("SC-15 勾选并填齐三项、密码留空时 POST 带 oidcBinding 且不带 password", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    fireEvent.click(await screen.findByTestId("admin-account-create-open"));
    const modal = await screen.findByTestId("admin-account-create-modal");
    fireEvent.change(within(modal).getByLabelText("登录账户"), { target: { value: "admin_new" } });
    fireEvent.click(within(modal).getByTestId("admin-create-bind-toggle"));
    fireEvent.change(within(modal).getByTestId("admin-create-binding-issuer"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(within(modal).getByTestId("admin-create-binding-sub"), {
      target: { value: "new|1" }
    });
    fireEvent.change(within(modal).getByTestId("admin-create-binding-email"), {
      target: { value: "new@example.com" }
    });
    fireEvent.click(within(modal).getByTestId("admin-account-create-submit"));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/admin/admins");
    expect(post?.body).toEqual({
      adminId: "admin_new",
      role: "operator",
      oidcBinding: {
        issuer: "https://idp.example.com",
        sub: "new|1",
        email: "new@example.com"
      }
    });
    expect(post?.body).not.toHaveProperty("password");
    // 成功后对话框关闭。
    await waitFor(() =>
      expect(screen.queryByTestId("admin-account-create-modal")).not.toBeInTheDocument()
    );
  });

  describe("SC-11 「移除本地密码」的出现条件", () => {
    const owner = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      displayName: id,
      role: "owner",
      enabled: true,
      createdAt: null,
      ...extra
    });

    it.each([
      {
        name: "未绑定的运维",
        oidcEnabled: true,
        admins: [
          owner("admin_zhang", { loginMethods: ["local"] }),
          { ...owner("ops_unbound", { role: "operator", loginMethods: ["local"] }) }
        ],
        target: "ops_unbound",
        expectButton: false
      },
      {
        name: "已绑定但身份源关闭",
        oidcEnabled: false,
        admins: [
          owner("admin_zhang", { loginMethods: ["local"] }),
          {
            ...owner("ops_bound", { role: "operator", loginMethods: ["local", "oidc"] }),
            oidcBindings: [BINDING]
          }
        ],
        target: "ops_bound",
        expectButton: false
      },
      {
        name: "只有单点登录",
        oidcEnabled: true,
        admins: [
          owner("admin_zhang", { loginMethods: ["local"] }),
          {
            ...owner("ops_oidc", { role: "operator", loginMethods: ["oidc"] }),
            oidcBindings: [BINDING]
          }
        ],
        target: "ops_oidc",
        expectButton: false
      },
      {
        name: "字段缺失的唯一所有者",
        oidcEnabled: true,
        admins: [{ ...owner("admin_zhang"), oidcBindings: [BINDING] }],
        target: "admin_zhang",
        expectButton: false
      },
      {
        name: "字段缺失，另有明确本地密码",
        oidcEnabled: true,
        admins: [
          { ...owner("admin_missing"), oidcBindings: [BINDING] },
          { ...owner("admin_local", { loginMethods: ["local"] }), oidcBindings: [BINDING] }
        ],
        target: "admin_missing",
        expectButton: true,
        alsoExpect: "admin_local"
      },
      {
        name: "已绑定的运维",
        oidcEnabled: true,
        admins: [
          owner("admin_zhang", { loginMethods: ["local"] }),
          {
            ...owner("ops_bound", { role: "operator", loginMethods: ["local", "oidc"] }),
            oidcBindings: [BINDING]
          }
        ],
        target: "ops_bound",
        expectButton: true
      },
      {
        name: "不是最后一名本地密码所有者",
        oidcEnabled: true,
        admins: [
          owner("admin_zhang", { loginMethods: ["local"] }),
          {
            ...owner("admin_two", { loginMethods: ["local", "oidc"] }),
            oidcBindings: [BINDING]
          }
        ],
        target: "admin_two",
        expectButton: true
      }
    ])("$name", async ({ oidcEnabled, admins, target, expectButton, alsoExpect }) => {
      authState.status = {
        mode: "required",
        me: { ...OWNER_ME, id: admins[0].id as string },
        authEnabled: true,
        methods: oidcEnabled ? ["local", "oidc"] : ["local"]
      };
      stubAdminsFetch({ mode: "required", admins });
      renderAdminAccounts();

      const drawer = await openDrawer(target);
      const button = within(drawer).queryByTestId(`oidc-password-remove-${target}`);
      if (expectButton) {
        expect(button).toBeInTheDocument();
      } else {
        expect(button).not.toBeInTheDocument();
        // 条件不成立时不渲染，而不是渲染成禁用按钮。
        expect(within(drawer).queryByRole("button", { name: "移除本地密码" })).not.toBeInTheDocument();
      }
      if (alsoExpect) {
        const other = await openDrawer(alsoExpect as string);
        expect(within(other).getByTestId(`oidc-password-remove-${alsoExpect}`)).toBeInTheDocument();
      }
    });

    it("允许态断言 PATCH body 为 { removeLocalPassword: true }", async () => {
      stubAdminsFetch({
        mode: "required",
        admins: [
          {
            id: "admin_zhang",
            displayName: "张管理员",
            role: "owner",
            enabled: true,
            createdAt: null,
            loginMethods: ["local"],
            oidcBindings: [BINDING]
          },
          {
            id: "admin_local",
            displayName: "李所有者",
            role: "owner",
            enabled: true,
            createdAt: null,
            loginMethods: ["local"],
            oidcBindings: [BINDING]
          }
        ]
      });
      renderAdminAccounts();

      const drawer = await openDrawer("admin_zhang");
      fireEvent.click(within(drawer).getByTestId("oidc-password-remove-admin_zhang"));
      await waitFor(() =>
        expect(calls.some((call) => call.method === "PATCH")).toBe(true)
      );
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch?.url).toBe("/api/admin/admins/admin_zhang");
      expect(patch?.body).toEqual({ removeLocalPassword: true });
    });
  });

  describe("SC-18 抽屉里的身份绑定四格", () => {
    async function openBindingDrawer(
      bound: boolean,
      oidcEnabled: boolean
    ): Promise<HTMLElement> {
      const admins = [
        {
          id: "admin_zhang",
          displayName: "张管理员",
          role: "owner",
          enabled: true,
          createdAt: null,
          loginMethods: ["local", "oidc"],
          ...(bound ? { oidcBindings: [BINDING] } : {})
        },
        {
          id: "admin_local",
          displayName: "李所有者",
          role: "owner",
          enabled: true,
          createdAt: null,
          loginMethods: ["local"]
        }
      ];
      authState.status = {
        mode: "required",
        me: OWNER_ME,
        authEnabled: true,
        methods: oidcEnabled ? ["local", "oidc"] : ["local"]
      };
      stubAdminsFetch({ mode: "required", admins });
      renderAdminAccounts();
      return openDrawer("admin_zhang");
    }

    it("未启用且没有绑定：写「未绑定单点登录身份。」，没有写入口", async () => {
      const drawer = await openBindingDrawer(false, false);
      expect(within(drawer).getByText("未绑定单点登录身份。")).toBeInTheDocument();
      expect(within(drawer).getByTestId("admin-oidc-bindings-disabled")).toHaveTextContent(
        "当前未启用单点登录"
      );
      expect(within(drawer).queryByTestId("oidc-binding-issuer")).not.toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "新增／替换绑定" })).not.toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "删除绑定" })).not.toBeInTheDocument();
      expect(within(drawer).queryByTestId("oidc-binding-issuer-input")).not.toBeInTheDocument();
    });

    it("未启用但已有绑定：只读展示绑定事实，不写成未绑定", async () => {
      const drawer = await openBindingDrawer(true, false);
      expect(within(drawer).getByTestId("oidc-binding-issuer")).toHaveTextContent(
        "https://idp.example.com"
      );
      expect(within(drawer).getByTestId("oidc-binding-sub")).toHaveTextContent("zhang|0042");
      expect(within(drawer).getByTestId("oidc-binding-email")).toHaveTextContent(
        "zhang@example.com"
      );
      expect(within(drawer).queryByText("未绑定单点登录身份。")).not.toBeInTheDocument();
      expect(within(drawer).getByTestId("admin-oidc-bindings-disabled")).toHaveTextContent(
        "当前未启用单点登录"
      );
      expect(within(drawer).queryByRole("button", { name: "新增／替换绑定" })).not.toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "删除绑定" })).not.toBeInTheDocument();
      expect(within(drawer).queryByTestId("oidc-binding-issuer-input")).not.toBeInTheDocument();
    });

    it("已启用且没有绑定：可以「新增／替换绑定」，没有只读身份源", async () => {
      const drawer = await openBindingDrawer(false, true);
      expect(within(drawer).getByText("未绑定单点登录身份。")).toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "新增／替换绑定" })).toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "删除绑定" })).not.toBeInTheDocument();
      expect(within(drawer).queryByTestId("oidc-binding-issuer")).not.toBeInTheDocument();
      expect(within(drawer).queryByTestId("admin-oidc-bindings-disabled")).not.toBeInTheDocument();
    });

    it("已启用且已有绑定：只读展示，可以新增／替换和删除", async () => {
      const drawer = await openBindingDrawer(true, true);
      expect(within(drawer).getByTestId("oidc-binding-issuer")).toHaveTextContent(
        "https://idp.example.com"
      );
      expect(within(drawer).getByRole("button", { name: "新增／替换绑定" })).toBeInTheDocument();
      expect(within(drawer).getByRole("button", { name: "删除绑定" })).toBeInTheDocument();
      expect(within(drawer).queryByText("未绑定单点登录身份。")).not.toBeInTheDocument();
      expect(within(drawer).queryByTestId("admin-oidc-bindings-disabled")).not.toBeInTheDocument();
    });
  });

  it("页面上没有整块 OIDC 身份绑定标题，绑定事实只在抽屉里", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    await screen.findByTestId("admin-accounts-grid-frame");
    expect(screen.queryByRole("heading", { name: /OIDC 身份绑定/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-oidc-bindings")).not.toBeInTheDocument();

    const drawer = await openDrawer("admin_zhang");
    expect(within(drawer).getByTestId("oidc-binding-issuer")).toHaveTextContent(
      "https://idp.example.com"
    );
  });

  it("reads a singular binding field defensively (backend shape not fixed yet)", async () => {
    stubAdminsFetch({
      mode: "required",
      admins: [
        {
          id: "admin_zhang",
          displayName: "张管理员",
          role: "owner",
          enabled: true,
          createdAt: null,
          loginMethods: ["local", "oidc"],
          oidcBinding: BINDING
        }
      ]
    });
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    expect(within(drawer).getByTestId("oidc-binding-issuer")).toHaveTextContent(
      "https://idp.example.com"
    );
  });

  it("treats missing backend binding fields as not bound instead of crashing", async () => {
    stubAdminsFetch(ADMINS_WITHOUT_BINDING_FIELDS);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    expect(within(drawer).getByText("未绑定单点登录身份。")).toBeInTheDocument();
    expect(within(drawer).queryByTestId("oidc-binding-issuer")).not.toBeInTheDocument();
  });

  it("writes a binding with the owner binding endpoint", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    fireEvent.click(within(drawer).getByTestId("oidc-binding-edit-admin_zhang"));
    fireEvent.change(screen.getByTestId("oidc-binding-issuer-input"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(screen.getByTestId("oidc-binding-sub-input"), { target: { value: "zhang|0042" } });
    fireEvent.change(screen.getByTestId("oidc-binding-email-input"), {
      target: { value: "zhang@example.com" }
    });
    fireEvent.click(screen.getByTestId("oidc-binding-save"));

    await waitFor(() => {
      const call = calls.find(
        (entry) => entry.url === "/api/admin/admins/admin_zhang/oidc-binding" && entry.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(call?.body).toEqual({
        issuer: "https://idp.example.com",
        sub: "zhang|0042",
        email: "zhang@example.com"
      });
    });
  });

  it("deletes a binding with the issuer query", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    fireEvent.click(within(drawer).getByTestId("oidc-binding-delete-admin_zhang"));
    await waitFor(() => {
      const call = calls.find((entry) => entry.method === "DELETE");
      expect(call).toBeTruthy();
      expect(call?.url).toContain("issuer=https%3A%2F%2Fidp.example.com");
    });
  });

  it("shows the backend business message for a binding conflict", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING, (url, method) => {
      if (method === "PUT" && url.endsWith("/oidc-binding")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: "OIDC_BINDING_CONFLICT", message: "该身份已绑定其他登录账户" }
          }),
          { status: 409 }
        );
      }
      return undefined;
    });
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    fireEvent.click(within(drawer).getByTestId("oidc-binding-edit-admin_zhang"));
    fireEvent.change(screen.getByTestId("oidc-binding-issuer-input"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(screen.getByTestId("oidc-binding-sub-input"), { target: { value: "zhang|0042" } });
    fireEvent.change(screen.getByTestId("oidc-binding-email-input"), {
      target: { value: "zhang@example.com" }
    });
    fireEvent.click(screen.getByTestId("oidc-binding-save"));

    const alert = await screen.findByTestId("admin-oidc-binding-error");
    expect(alert).toHaveTextContent("该身份已绑定其他登录账户");
  });

  it("falls back to fixed copy for unknown binding failures", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING, (url, method) => {
      if (method === "PUT" && url.endsWith("/oidc-binding")) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: "INTERNAL", message: "Error: stack trace at /srv/app.js:12" }
          }),
          { status: 500 }
        );
      }
      return undefined;
    });
    renderAdminAccounts();

    const drawer = await openDrawer("admin_zhang");
    fireEvent.click(within(drawer).getByTestId("oidc-binding-edit-admin_zhang"));
    fireEvent.change(screen.getByTestId("oidc-binding-issuer-input"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(screen.getByTestId("oidc-binding-sub-input"), { target: { value: "zhang|0042" } });
    fireEvent.change(screen.getByTestId("oidc-binding-email-input"), {
      target: { value: "zhang@example.com" }
    });
    fireEvent.click(screen.getByTestId("oidc-binding-save"));

    const alert = await screen.findByTestId("admin-oidc-binding-error");
    expect(alert).toHaveTextContent("操作失败，请稍后重试");
    expect(alert.textContent).not.toContain("stack trace");
  });

  it("uses the canonical wording and no forbidden term", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    const { container } = renderAdminAccounts();

    await screen.findByTestId("admin-accounts-grid-frame");
    const drawer = await openDrawer("admin_zhang");
    const text = `${container.textContent ?? ""}${drawer.textContent ?? ""}`;
    for (const forbidden of [
      "免密登录",
      "统一权限",
      "权限源",
      "管理员后门",
      "邮箱绑定",
      "退出所有账户",
      "用户管理",
      "新建用户",
      "当前用户"
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
