// @vitest-environment jsdom
//
// L25-06 OIDC 单点登录 — owner-only account binding management.
//
// Guards: owners see 登录方式 and the OIDC 身份绑定 section, operators never
// get binding write controls, missing backend binding fields degrade to
// "not bound", and business-rule failures show the backend's user-safe
// message while everything else falls back to fixed copy.
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      oidcBindings: [
        {
          issuer: "https://idp.example.com",
          sub: "zhang|0042",
          email: "zhang@example.com"
        }
      ]
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

let fetchMock: ReturnType<typeof vi.fn>;

function stubAdminsFetch(
  admins: unknown,
  handler?: (url: string, init?: RequestInit) => Response | undefined
) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (handler) {
      const handled = handler(url, init);
      if (handled) return handled;
    }
    if (url.startsWith("/api/admin/admins")) {
      return new Response(JSON.stringify({ ok: true, data: admins }));
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
      <MemoryRouter initialEntries={["/admin/admins"]}>
        <AdminAccounts />
      </MemoryRouter>
    </QueryClientProvider>
  );
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

describe("AdminAccounts OIDC 身份绑定 (L25-06)", () => {
  it("shows 登录方式 and the owner-only binding section", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    expect(await screen.findByRole("columnheader", { name: "登录方式" })).toBeInTheDocument();
    expect(await screen.findByTestId("admin-login-methods-admin_zhang")).toHaveTextContent(
      "本地账户登录 · 单点登录"
    );
    expect(screen.getByTestId("admin-login-methods-ops_li")).toHaveTextContent("本地账户登录");

    const panel = await screen.findByTestId("admin-oidc-bindings");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent("OIDC 身份绑定");
    expect(screen.getByTestId("oidc-binding-issuer")).toHaveTextContent("https://idp.example.com");
    expect(screen.getByTestId("oidc-binding-sub")).toHaveTextContent("zhang|0042");
    expect(screen.getByTestId("oidc-binding-email")).toHaveTextContent("zhang@example.com");
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
          oidcBinding: {
            issuer: "https://idp.example.com",
            sub: "zhang|0042",
            email: "zhang@example.com"
          }
        }
      ]
    });
    renderAdminAccounts();

    expect(await screen.findByTestId("oidc-binding-issuer")).toHaveTextContent(
      "https://idp.example.com"
    );
  });

  it("never shows binding write controls to an operator", async () => {
    authState.status = {
      mode: "required",
      me: OPERATOR_ME,
      authEnabled: true,
      methods: ["local", "oidc"]
    };
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    expect(await screen.findByRole("columnheader", { name: "登录账户" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "登录方式" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-oidc-bindings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增／替换绑定" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除本地密码" })).not.toBeInTheDocument();
  });

  it("treats missing backend binding fields as not bound instead of crashing", async () => {
    stubAdminsFetch(ADMINS_WITHOUT_BINDING_FIELDS);
    renderAdminAccounts();

    const row = await screen.findByTestId("oidc-binding-row-admin_zhang");
    expect(row).toHaveTextContent("未绑定单点登录身份。");
    expect(screen.queryByTestId("oidc-binding-issuer")).not.toBeInTheDocument();
  });

  it("writes a binding with the owner binding endpoint", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    fireEvent.click(await screen.findByTestId("oidc-binding-edit-admin_zhang"));
    fireEvent.change(screen.getByTestId("oidc-binding-issuer-input"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(screen.getByTestId("oidc-binding-sub-input"), { target: { value: "zhang|0042" } });
    fireEvent.change(screen.getByTestId("oidc-binding-email-input"), {
      target: { value: "zhang@example.com" }
    });
    fireEvent.click(screen.getByTestId("oidc-binding-save"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url]) => String(url) === "/api/admin/admins/admin_zhang/oidc-binding"
      );
      expect(call).toBeTruthy();
      expect((call?.[1] as RequestInit).method).toBe("PUT");
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        issuer: "https://idp.example.com",
        sub: "zhang|0042",
        email: "zhang@example.com"
      });
    });
  });

  it("deletes a binding with the issuer query and removes the local password explicitly", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    fireEvent.click(await screen.findByTestId("oidc-binding-delete-admin_zhang"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("/api/admin/admins/admin_zhang/oidc-binding?")
      );
      expect(call).toBeTruthy();
      expect(String(call?.[0])).toContain("issuer=https%3A%2F%2Fidp.example.com");
      expect((call?.[1] as RequestInit).method).toBe("DELETE");
    });

    fireEvent.click(screen.getByTestId("oidc-password-remove-admin_zhang"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/admin/admins/admin_zhang" && (init as RequestInit).method === "PATCH"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        removeLocalPassword: true
      });
    });
  });

  it("shows the backend business message for a binding conflict", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING, (url) => {
      if (url.endsWith("/oidc-binding")) {
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

    fireEvent.click(await screen.findByTestId("oidc-binding-edit-admin_zhang"));
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
    stubAdminsFetch(ADMINS_WITH_BINDING, (url) => {
      if (url.endsWith("/oidc-binding")) {
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

    fireEvent.click(await screen.findByTestId("oidc-binding-edit-admin_zhang"));
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

  it("creates an account with an OIDC 身份绑定 and no local password", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    renderAdminAccounts();

    fireEvent.change(await screen.findByLabelText("登录账户"), {
      target: { value: "admin_new" }
    });
    fireEvent.change(screen.getByTestId("admin-create-binding-issuer"), {
      target: { value: "https://idp.example.com" }
    });
    fireEvent.change(screen.getByTestId("admin-create-binding-sub"), { target: { value: "new|1" } });
    fireEvent.change(screen.getByTestId("admin-create-binding-email"), {
      target: { value: "new@example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/admin/admins" && (init as RequestInit).method === "POST"
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body.oidcBinding).toEqual({
        issuer: "https://idp.example.com",
        sub: "new|1",
        email: "new@example.com"
      });
    });
  });

  it("uses the canonical wording and no forbidden term", async () => {
    stubAdminsFetch(ADMINS_WITH_BINDING);
    const { container } = renderAdminAccounts();

    await screen.findByTestId("admin-oidc-bindings");
    const text = container.textContent ?? "";
    for (const forbidden of ["免密登录", "统一权限", "权限源", "管理员后门", "邮箱绑定", "退出所有账户"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
