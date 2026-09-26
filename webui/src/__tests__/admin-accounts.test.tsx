// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    authEnabled: true
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

const ADMINS_RESPONSE = {
  mode: "required",
  admins: [
    { id: "admin_zhang", displayName: "张管理员", role: "owner", enabled: true, createdAt: "2026-08-01T00:00:00.000Z" },
    { id: "ops_li", displayName: "李运维", role: "operator", enabled: false, createdAt: "2026-08-02T00:00:00.000Z" }
  ]
};

function stubAdminsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/admin/admins")) {
        return new Response(JSON.stringify({ ok: true, data: ADMINS_RESPONSE }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

function renderAdminAccounts() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/admins"]}>
        <AdminAccounts />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  authState.status = { mode: "required", me: OWNER_ME, authEnabled: true };
});

describe("AdminAccounts (/admin/admins)", () => {
  it("wraps the admin accounts table in the shared data grid frame (owner mode)", async () => {
    authState.status = { mode: "required", me: OWNER_ME, authEnabled: true };
    stubAdminsFetch();

    renderAdminAccounts();

    expect(await screen.findByRole("heading", { name: "登录账户" })).toBeInTheDocument();
    const frame = await screen.findByTestId("admin-accounts-grid-frame");
    expect(frame).toHaveClass("pl-data-grid-frame");
    expect(screen.getByTestId("admin-accounts-grid-scroll")).toHaveClass("pl-data-grid-scroll");
    const table = screen.getByTestId("admin-accounts-table");
    expect(table).toHaveClass("pl-data-grid", "pl-data-table");
    expect(table).toHaveTextContent("admin_zhang");
    expect(table).toHaveTextContent("ops_li");

    // 所有者条件列与行操作按权限呈现
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "禁用" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "删除" }).length).toBeGreaterThanOrEqual(1);

    // 创建表单按所有者权限呈现
    expect(screen.getByRole("button", { name: "创建账户" })).toBeInTheDocument();
  });

  it("keeps the shared grid structure in open mode without owner-only affordances", async () => {
    authState.status = { mode: "open", me: null, authEnabled: false };
    stubAdminsFetch();

    renderAdminAccounts();

    expect(await screen.findByText(/当前为开放模式/)).toBeInTheDocument();
    const frame = await screen.findByTestId("admin-accounts-grid-frame");
    expect(frame).toHaveClass("pl-data-grid-frame");
    expect(screen.getByTestId("admin-accounts-grid-scroll")).toHaveClass("pl-data-grid-scroll");
    expect(screen.getByTestId("admin-accounts-table")).toHaveClass("pl-data-grid", "pl-data-table");

    // 开放模式下无所有者条件列、行操作与创建表单
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建账户" })).not.toBeInTheDocument();
  });
});
