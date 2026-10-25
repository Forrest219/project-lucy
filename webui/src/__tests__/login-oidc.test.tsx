// @vitest-environment jsdom
//
// L25-06 OIDC 单点登录 — login page entry point.
//
// Guards: the local 「登录账户＋密码」 form always stays, the 单点登录 button
// only appears when the backend reports the `oidc` method, bootstrap never
// shows it, the callback error codes render the fixed Spec §9 copy, and the
// error code is dropped from the URL afterwards.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../pages/Login";
import { LOGGED_OUT_FLAG } from "../lib/logoutSignal";

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

const BRANDING = {
  productTitle: "Lucy WebUI",
  tagline: "可信 Agent 数据层",
  productTitleOverride: "",
  taglineOverride: "",
  hasCustomLogo: false,
  logoUrl: null,
  logoContentType: null,
  logoWidth: null,
  logoHeight: null,
  updatedAt: null,
  defaults: { productTitle: "Lucy WebUI", tagline: "可信 Agent 数据层" }
};

let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(handler?: (url: string, init?: RequestInit) => Response | undefined) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (handler) {
      const handled = handler(url, init);
      if (handled) return handled;
    }
    if (url.startsWith("/api/branding")) {
      return new Response(JSON.stringify({ ok: true, data: BRANDING }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
      status: 404
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderLogin(entry: string = "/login", state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[state ? { pathname: entry, state } : entry]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** jsdom forbids navigation, so the browser hand-off is captured instead. */
let assignMock: ReturnType<typeof vi.fn>;

function stubLocation() {
  assignMock = vi.fn();
  const original = window.location;
  try {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { pathname: "/login", search: "", assign: assignMock }
    });
  } catch {
    const spy = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    assignMock = spy as unknown as ReturnType<typeof vi.fn>;
  }
  return original;
}

beforeEach(() => {
  stubLocation();
  authState.status = {
    mode: "required",
    me: null,
    authEnabled: true,
    methods: ["local"]
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LoginPage 单点登录 entry point (L25-06)", () => {
  it("keeps the local login form and hides 单点登录 when the identity source is off", async () => {
    stubFetch();
    renderLogin();

    expect(await screen.findByLabelText("登录账户")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用单点登录" })).not.toBeInTheDocument();
    expect(screen.queryByText("由贵组织的身份源完成认证")).not.toBeInTheDocument();
    // No forced redirect to the identity source.
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("offers 单点登录 beside the local form when the backend reports the oidc method", async () => {
    authState.status = { mode: "required", me: null, authEnabled: true, methods: ["local", "oidc"] };
    stubFetch();
    renderLogin();

    const oidcButton = await screen.findByRole("button", { name: "使用单点登录" });
    expect(oidcButton).toBeInTheDocument();
    expect(screen.getByText("由贵组织的身份源完成认证")).toBeInTheDocument();
    // Local 登录账户登录 stays available next to the identity source entry.
    expect(screen.getByLabelText("登录账户")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("never shows 单点登录 in bootstrap mode", async () => {
    authState.status = {
      mode: "bootstrap",
      me: null,
      authEnabled: true,
      methods: ["local", "oidc"]
    };
    stubFetch();
    renderLogin();

    expect(await screen.findByRole("heading", { name: "创建首个所有者" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "使用单点登录" })).not.toBeInTheDocument();
  });

  it("starts the identity source flow with the internal return path and follows the authorization URL", async () => {
    authState.status = { mode: "required", me: null, authEnabled: true, methods: ["local", "oidc"] };
    stubFetch((url) => {
      if (url === "/api/auth/oidc/start") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { authorizationUrl: "https://idp.example.com/oauth2/authorize?client_id=lucy" }
          })
        );
      }
      return undefined;
    });
    renderLogin("/login", { from: "/admin/admins" });

    fireEvent.click(await screen.findByRole("button", { name: "使用单点登录" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/auth/oidc/start");
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));
      expect(body).toEqual({ returnTo: "/admin/admins" });
    });
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "https://idp.example.com/oauth2/authorize?client_id=lucy"
      );
    });
  });

  it("renders the fixed copy for every callback error code and drops the code from the URL", async () => {
    const cases: Array<[string, string]> = [
      ["OIDC_LOGIN_INVALID", "单点登录校验失败，请重新发起登录"],
      ["OIDC_LOGIN_FAILED", "身份源未完成登录，请重试或使用本地账户登录"],
      ["OIDC_PROVIDER_UNAVAILABLE", "暂时无法连接身份源，请稍后重试或使用本地账户登录"],
      ["OIDC_ACCOUNT_NOT_BOUND", "该身份尚未绑定 Lucy 登录账户，请联系所有者"],
      ["OIDC_ACCOUNT_UNAVAILABLE", "绑定的登录账户当前不可用，请联系所有者"],
      ["AUTH_STATE_UNAVAILABLE", "认证状态暂不可用，请稍后重试或联系部署人员"]
    ];

    for (const [code, copy] of cases) {
      cleanup();
      const replaceState = vi.spyOn(window.history, "replaceState");
      stubFetch();
      renderLogin(`/login?oidc_error=${code}`);

      const alert = await screen.findByTestId("login-oidc-error");
      expect(alert).toHaveTextContent(copy);
      await waitFor(() => {
        expect(replaceState).toHaveBeenCalled();
      });
      const usedUrl = String(replaceState.mock.calls[0]?.[2] ?? "");
      expect(usedUrl).not.toContain("oidc_error");
      replaceState.mockRestore();
    }
  });

  it("never renders a raw server message for an unknown callback error code", async () => {
    stubFetch();
    renderLogin("/login?oidc_error=RAW_STACK_TRACE");

    const alert = await screen.findByTestId("login-oidc-error");
    expect(alert).toHaveTextContent("单点登录未完成，请稍后重试或使用本地账户登录");
    expect(alert.textContent).not.toContain("RAW_STACK_TRACE");
  });

  it("shows the fixed copy when the identity source is not available", async () => {
    authState.status = { mode: "required", me: null, authEnabled: true, methods: ["local", "oidc"] };
    stubFetch((url) => {
      if (url === "/api/auth/oidc/start") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: "OIDC_NOT_AVAILABLE", message: "内部细节不应展示" }
          }),
          { status: 503 }
        );
      }
      return undefined;
    });
    renderLogin();

    fireEvent.click(await screen.findByRole("button", { name: "使用单点登录" }));

    const alert = await screen.findByTestId("login-oidc-start-error");
    expect(alert).toHaveTextContent("单点登录当前不可用，请使用本地账户登录或联系部署人员");
    expect(alert.textContent).not.toContain("内部细节不应展示");
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("uses the canonical 单点登录 wording and no forbidden term", async () => {
    authState.status = { mode: "required", me: null, authEnabled: true, methods: ["local", "oidc"] };
    stubFetch();
    const { container } = renderLogin();

    await screen.findByRole("button", { name: "使用单点登录" });
    const text = container.textContent ?? "";
    for (const forbidden of ["免密登录", "统一权限", "权限源", "管理员后门", "邮箱绑定", "退出所有账户"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("states that the identity source session may still be valid after an explicit logout", async () => {
    stubFetch();
    // An explicit logout writes the flag; a mere bounce from a protected page does not.
    window.sessionStorage.setItem(LOGGED_OUT_FLAG, "1");
    renderLogin("/login", { from: "/overview" });

    const notice = await screen.findByTestId("login-logout-notice");
    expect(notice).toHaveTextContent("已退出 Lucy；组织身份源的登录状态可能仍然有效");
    expect(notice.textContent).not.toContain("退出所有账户");
    // The flag is consumed, so a refresh does not repeat the notice.
    expect(window.sessionStorage.getItem(LOGGED_OUT_FLAG)).toBeNull();
  });

  it("does not claim a logout when the user was only bounced from a protected page", async () => {
    stubFetch();
    renderLogin("/login", { from: "/overview" });

    await screen.findByRole("button", { name: "登录" });
    expect(screen.queryByTestId("login-logout-notice")).not.toBeInTheDocument();
  });
});
