// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewToken } from "../pages/admin/NewToken";

function renderNewToken() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/agents/zhangsan/tokens/new"]}>
        <Routes>
          <Route path="/admin/agents/:userId/tokens/new" element={<NewToken />} />
          <Route path="/admin/agents/:userId" element={<div data-testid="agent-detail">Agent detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NewToken", () => {
  it("shows plaintext token only on the creation success screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/admin/agents/zhangsan/tokens" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                token: "lucy_plaintext_token_once",
                hash: "sha256:hash",
                label: "hermes-laptop",
                created: "2026-06-20T00:00:00.000Z",
                expires_at: null
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderNewToken();

    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_plaintext_token_once")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我已保存，关闭" }));

    expect(await screen.findByTestId("agent-detail")).toBeInTheDocument();
    expect(screen.queryByText("lucy_plaintext_token_once")).not.toBeInTheDocument();
  });

  it("renders delivery tabs for Hermes, Claude Code, Codex, and Generic MCP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/admin/agents/zhangsan/tokens" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                token: "lucy_oneshot_token",
                hash: "sha256:hash",
                label: "hermes-laptop",
                created: "2026-06-20T00:00:00.000Z",
                expires_at: null
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();
    const tabbar = screen.getByRole("tablist", { name: "客户端接入配置" });
    const tabs = within(tabbar).getAllByRole("tab");
    const tabNames = tabs.map((tab) => tab.textContent);
    expect(tabNames).toEqual(expect.arrayContaining(["Hermes", "Claude Code", "Codex", "Generic MCP"]));
  });

  it("default active snippet is Hermes and includes the generated token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/admin/agents/zhangsan/tokens" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                token: "lucy_oneshot_token",
                hash: "sha256:hash",
                label: "hermes-laptop",
                created: "2026-06-20T00:00:00.000Z",
                expires_at: null
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();
    const hermesTab = screen.getByRole("tab", { name: "Hermes" });
    expect(hermesTab).toHaveAttribute("aria-selected", "true");
    const snippet = screen.getByTestId("snippet-active");
    expect(snippet.textContent).toContain("Bearer lucy_oneshot_token");
  });

  it("copy snippet button writes bearer with plaintext token to clipboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/admin/agents/zhangsan/tokens" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                token: "lucy_oneshot_token",
                hash: "sha256:hash",
                label: "hermes-laptop",
                created: "2026-06-20T00:00:00.000Z",
                expires_at: null
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));
    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /复制当前/ }));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const payload = writeText.mock.calls.at(-1)?.[0] as string;
    expect(payload).toContain("Bearer lucy_oneshot_token");
  });

  it("switching to Generic MCP updates the snippet to JSON config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/admin/agents/zhangsan/tokens" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                token: "lucy_oneshot_token",
                hash: "sha256:hash",
                label: "hermes-laptop",
                created: "2026-06-20T00:00:00.000Z",
                expires_at: null
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));
    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Generic MCP" }));
    const snippet = screen.getByTestId("snippet-active");
    expect(snippet.textContent).toContain("mcpServers");
    expect(snippet.textContent).toContain("Bearer lucy_oneshot_token");
  });
});
