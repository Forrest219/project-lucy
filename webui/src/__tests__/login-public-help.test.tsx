// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { readHelpHandbook } from "../../server/help";
import { LoginPage } from "../pages/Login";

const authState = vi.hoisted(() => ({
  status: {
    mode: "required" as const,
    me: null,
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage public help link", () => {
  it("links to the handbook break-glass section without requiring login", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const helpLink = screen.getByRole("link", { name: "查看系统手册" });
    expect(helpLink).toHaveAttribute("href", "/help?section=admin-break-glass");
    expect(screen.getByText(/无需登录/)).toBeInTheDocument();
  });

  it("points the help link at a section id that actually exists in the handbook", async () => {
    // 回归：登录失败时这是唯一的自助入口。链接曾写成 webui-admin-break-glass，
    // 该 id 在 help.ts 的 SECTION_ALIASES 中不存在，Help 页能打开但滚不到任何章节。
    // 只断言 href 字符串相等的测试无法发现这类断链，必须对真实 handbook TOC 校验。
    const handbook = await readHelpHandbook();
    const tocIds = new Set(handbook.toc.map((t) => t.id));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const href = screen.getByRole("link", { name: "查看系统手册" }).getAttribute("href");
    const sectionId = new URL(href!, "https://lucy.local").searchParams.get("section");

    expect(sectionId).toBeTruthy();
    expect(tocIds.has(sectionId!), `Help 链接指向不存在的 section id：${sectionId}`).toBe(true);
  });
});
