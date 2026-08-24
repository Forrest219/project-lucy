// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    const helpLink = screen.getByRole("link", { name: "查看系统手册" });
    expect(helpLink).toHaveAttribute("href", "/help?section=webui-admin-break-glass");
    expect(screen.getByText(/无需登录/)).toBeInTheDocument();
  });
});
