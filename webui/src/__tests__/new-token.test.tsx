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

type McpEndpointStub = {
  url: string | null;
  status: "configured" | "fallback" | "invalid";
  source: "env" | "fallback";
  configured: boolean;
  diagnostics: Array<{ code: string; message: string }>;
};

type FetchOptions = {
  mcpEndpoint?: McpEndpointStub;
  tokenResponse?: { token: string; label: string; expires_at?: string | null };
  projectError?: boolean;
};

const DEFAULT_MCP_ENDPOINT: McpEndpointStub = {
  url: "https://lucy.example.com/mcp",
  status: "configured",
  source: "env",
  configured: true,
  diagnostics: []
};

const DEFAULT_TOKEN_RESPONSE = {
  token: "lucy_oneshot_token",
  hash: "sha256:hash",
  label: "hermes-laptop",
  created: "2026-06-20T00:00:00.000Z",
  expires_at: null
};

function stubNewTokenFetch(opts: FetchOptions = {}) {
  const mcpEndpoint = opts.mcpEndpoint ?? DEFAULT_MCP_ENDPOINT;
  const tokenResponse = { ...DEFAULT_TOKEN_RESPONSE, ...(opts.tokenResponse ?? {}) };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/project") {
        if (opts.projectError) {
          return new Response(
            JSON.stringify({ ok: false, error: { code: "PROJECT_ERROR", message: "project unavailable" } }),
            { status: 500 }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              root: "/tmp/project-lucy",
              ktxAvailable: true,
              connections: [],
              mcpEndpoint
            }
          })
        );
      }
      if (url === "/api/admin/agents/zhangsan/tokens" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: tokenResponse
          })
        );
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NewToken", () => {
  it("shows plaintext token only on the creation success screen", async () => {
    stubNewTokenFetch();

    renderNewToken();

    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我已保存，关闭" }));

    expect(await screen.findByTestId("agent-detail")).toBeInTheDocument();
    expect(screen.queryByText("lucy_oneshot_token")).not.toBeInTheDocument();
  });

  it("renders delivery tabs for Hermes, Claude Code, Codex, and Generic MCP", async () => {
    stubNewTokenFetch();

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
    stubNewTokenFetch();

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();
    const hermesTab = screen.getByRole("tab", { name: "Hermes" });
    expect(hermesTab).toHaveAttribute("aria-selected", "true");
    const snippet = screen.getByTestId("snippet-active");
    expect(snippet.textContent).toContain("Bearer lucy_oneshot_token");
    expect(snippet.textContent).toContain("https://lucy.example.com/mcp");
    expect(snippet.textContent).not.toContain("http://localhost:7879/mcp");
    expect(snippet.textContent).not.toContain("http://127.0.0.1:7879/mcp");
  });

  it("copy snippet button writes bearer with plaintext token to clipboard", async () => {
    stubNewTokenFetch();
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));
    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /复制当前/ }));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const payload = String((writeText.mock.calls as Array<[string]>).at(-1)?.[0] ?? "");
    expect(payload).toContain("Bearer lucy_oneshot_token");
    expect(payload).toContain("https://lucy.example.com/mcp");
    expect(payload).not.toContain("http://localhost:7879/mcp");
  });

  it("switching to Generic MCP updates the snippet to JSON config", async () => {
    stubNewTokenFetch();

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));
    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Generic MCP" }));
    const snippet = screen.getByTestId("snippet-active");
    expect(snippet.textContent).toContain("mcpServers");
    expect(snippet.textContent).toContain("Bearer lucy_oneshot_token");
    expect(snippet.textContent).toContain("https://lucy.example.com/mcp");
  });

  it("switching to Codex copies a config that includes bearer with plaintext token", async () => {
    stubNewTokenFetch({ tokenResponse: { token: "lucy_oneshot_token", label: "codex-laptop" } });
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "codex-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));
    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Codex" }));
    const codexSnippet = screen.getByTestId("snippet-active");
    expect(codexSnippet.textContent).toContain("Bearer lucy_oneshot_token");
    expect(codexSnippet.textContent).toContain("https://lucy.example.com/mcp");
    expect(codexSnippet.textContent).not.toContain("http://localhost:7879/mcp");
    fireEvent.click(screen.getByRole("button", { name: /复制当前/ }));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer lucy_oneshot_token"));
    });
    const payload = String((writeText.mock.calls as Array<[string]>).at(-1)?.[0] ?? "");
    expect(payload).toContain("https://lucy.example.com/mcp");
  });

  it("hides ready-to-copy snippets and surfaces the runtime diagnostic when MCP endpoint is invalid", async () => {
    stubNewTokenFetch({
      mcpEndpoint: {
        url: null,
        status: "invalid",
        source: "env",
        configured: false,
        diagnostics: [
          {
            code: "INVALID_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL must be a valid absolute URL."
          }
        ]
      }
    });

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));
    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();

    expect(
      screen.getByText("LUCY_PUBLIC_MCP_URL must be a valid absolute URL.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("snippet-active")).not.toBeInTheDocument();
  });

  it("keeps the plaintext token visible when project endpoint lookup fails after token creation", async () => {
    stubNewTokenFetch({ projectError: true });

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();
    expect(screen.getByText(/无法加载 Lucy MCP endpoint/)).toBeInTheDocument();
    expect(screen.queryByTestId("snippet-active")).not.toBeInTheDocument();
  });

  it("shows a deployment warning when token snippets use the local fallback endpoint", async () => {
    stubNewTokenFetch({
      mcpEndpoint: {
        url: "http://127.0.0.1:7879/mcp",
        status: "fallback",
        source: "fallback",
        configured: false,
        diagnostics: [
          {
            code: "MISSING_PUBLIC_MCP_URL",
            message: "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
          }
        ]
      }
    });

    renderNewToken();
    fireEvent.change(screen.getByLabelText(/Token 标签/), { target: { value: "hermes-laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "生成 Token" }));

    expect(await screen.findByText("lucy_oneshot_token")).toBeInTheDocument();
    expect(screen.getByText(/当前使用本地默认 MCP endpoint/)).toBeInTheDocument();
    expect(screen.getByTestId("snippet-active")).toHaveTextContent("http://127.0.0.1:7879/mcp");
  });
});
