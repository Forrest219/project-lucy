// @vitest-environment jsdom
//
// SC-01 —— 旧路径 `/admin/admins` 只是 WebUI 里的替换入口：打开后地址栏变成
// `/admin/accounts`，页头仍是「登录账户」。
//
// 登录守卫在路由替换之前就把 `from` 记成旧路径；登录后回到这个旧路径时，
// 最终地址仍然必须是 `/admin/accounts`。
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";

const captured = vi.hoisted(() => ({ loginFrom: "" }));

vi.mock("../pages/Login", async () => {
  const { useLocation } = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    LoginPage: () => {
      const location = useLocation();
      captured.loginFrom = (location.state as { from?: string } | null)?.from ?? "";
      return <div data-testid="login-page">登录</div>;
    }
  };
});

const OWNER_ME = {
  id: "admin_zhang",
  displayName: "张管理员",
  role: "owner",
  enabled: true,
  createdAt: null
};

function stubFetch(authed: boolean) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/auth/status")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            mode: "required",
            me: authed ? OWNER_ME : null,
            authEnabled: true,
            methods: ["local"]
          }
        })
      );
    }
    if (url.startsWith("/api/admin/admins")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            mode: "required",
            admins: [
              {
                id: "admin_zhang",
                displayName: "张管理员",
                role: "owner",
                enabled: true,
                createdAt: null,
                loginMethods: ["local"]
              }
            ]
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: true, data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  captured.loginFrom = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("登录账户页路径（SC-01）", () => {
  it("打开旧路径后地址栏变成 /admin/accounts，页头是「登录账户」", async () => {
    stubFetch(true);
    window.history.pushState({}, "", "/admin/admins");

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/admin/accounts"));
    expect(await screen.findByRole("heading", { name: "登录账户" })).toBeInTheDocument();
  });

  it("登录守卫把旧路径记成 from；登录后回到这个旧路径仍落在 /admin/accounts", async () => {
    stubFetch(false);
    window.history.pushState({}, "", "/admin/admins");

    render(<App />);

    // 未登录时守卫先把 from 记成旧路径，再跳到登录页。
    await waitFor(() => expect(screen.getByTestId("login-page")).toBeInTheDocument());
    expect(captured.loginFrom).toBe("/admin/admins");
    expect(window.location.pathname).toBe("/login");

    // 登录之后导航回这个旧路径，地址栏仍然是新路径。
    cleanup();
    stubFetch(true);
    window.history.pushState({}, "", "/admin/admins");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/admin/accounts"));
    expect(await screen.findByRole("heading", { name: "登录账户" })).toBeInTheDocument();
  });
});
