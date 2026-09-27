// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETUP_STEPS,
  inferCurrentStep,
  buildClientConfigs,
  buildHelloWorldPrompt,
  getAssistantDraft,
  setAssistantDraft,
  clearAssistantDraft,
  formatAssistantProgressLabel,
  deriveAssistantResumeState,
  deriveSetupReadiness,
  formatProbeFailure
} from "../lib/setupAssistant";
import { SetupAssistantModal } from "../components/onboarding/SetupAssistantModal";
import { Step4SemanticOverlay } from "../components/onboarding/Step4SemanticOverlay";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { assertNoForbiddenTerms } from "./forbidden-terms";
import type { ConnectionInfo, ProjectInfo, SourcesResponse } from "../lib/types";

describe("Setup Assistant Library & Utilities", () => {
  it("defines 6 sequential steps with correct keys and optionality", () => {
    expect(SETUP_STEPS).toHaveLength(6);
    expect(SETUP_STEPS[0].key).toBe("connect_db");
    expect(SETUP_STEPS[0].isOptional).toBe(false);
    expect(SETUP_STEPS[1].key).toBe("upload_manifest");
    expect(SETUP_STEPS[2].key).toBe("select_tables");
    expect(SETUP_STEPS[3].key).toBe("semantic_overlay");
    expect(SETUP_STEPS[3].isOptional).toBe(true);
    expect(SETUP_STEPS[4].key).toBe("business_wiki");
    expect(SETUP_STEPS[4].isOptional).toBe(true);
    expect(SETUP_STEPS[5].key).toBe("connect_agent");
    expect(SETUP_STEPS[5].isOptional).toBe(false);
  });

  it("infers setup progress correctly based on assets", () => {
    // Step 1: No connection
    expect(inferCurrentStep({})).toBe(1);

    const mockConn: ConnectionInfo = {
      id: "mysql-test",
      schemas: ["test_db"],
      enabledTables: []
    };

    // Step 2: Connection exists, but no manifest
    expect(inferCurrentStep({ connection: mockConn, hasManifest: false })).toBe(2);

    // Step 3: Has manifest, but no tables enabled
    expect(
      inferCurrentStep({ connection: mockConn, hasManifest: true, enabledTableCount: 0 })
    ).toBe(3);

    // Step 4: Tables enabled, but no overlay
    mockConn.enabledTables = ["test_db.orders"];
    expect(
      inferCurrentStep({
        connection: mockConn,
        hasManifest: true,
        enabledTableCount: 1,
        overlayCount: 0
      })
    ).toBe(4);

    // Step 5: Has overlay, but no wiki
    expect(
      inferCurrentStep({
        connection: mockConn,
        hasManifest: true,
        enabledTableCount: 1,
        overlayCount: 1,
        wikiCount: 0
      })
    ).toBe(5);

    // Step 6: Ready
    expect(
      inferCurrentStep({
        connection: mockConn,
        hasManifest: true,
        enabledTableCount: 1,
        overlayCount: 1,
        wikiCount: 1
      })
    ).toBe(6);
  });

  it("formats progress labels", () => {
    expect(formatAssistantProgressLabel(1)).toContain("1/6");
    expect(formatAssistantProgressLabel(3)).toContain("3/6");
  });

  it("rehydrates resume state from the authoritative project and sources contracts", () => {
    const connection: ConnectionInfo = {
      id: "demo-mysql",
      schemas: ["dataforai"],
      enabledTables: [
        "dataforai.customers",
        "dataforai.orders",
        "dataforai.products"
      ]
    };
    const sources: SourcesResponse = {
      manifestSchemas: [
        {
          conn: "demo-mysql",
          schema: "dataforai",
          filePath: "semantic-layer/demo-mysql/_schema/dataforai.yaml",
          tableCount: 3,
          mtime: "2026-09-27T00:00:00.000Z"
        }
      ],
      tables: ["customers", "orders", "products"].map((table) => ({
        conn: "demo-mysql",
        schema: "dataforai",
        table,
        qualifiedName: `dataforai.${table}`,
        filePath: `semantic-layer/demo-mysql/dataforai/${table}.yaml`,
        columnCount: 3,
        columnNames: ["id", "name", "created_at"],
        hasTableDesc: true,
        hasGrain: false,
        measureCount: 0,
        joinCount: 0,
        wikiRefCount: 0,
        completion: "partial" as const,
        mtime: "2026-09-27T00:00:00.000Z",
        enabled: true,
        authorizedAgentCount: 1,
        semanticUpdatedAt: "2026-09-27T00:00:00.000Z",
        semanticUpdatedAtSource: "manifest" as const
      }))
    };

    const state = deriveAssistantResumeState({ connection, sources });

    expect(state.schema).toBe("dataforai");
    expect(state.hasManifest).toBe(true);
    expect(state.enabledTables).toEqual(connection.enabledTables);
    expect(state.availableTables).toHaveLength(3);
    expect(state.step).toBe(4);
  });

  it("never lets an optional local draft bypass an unmet required guard", () => {
    const connection: ConnectionInfo = {
      id: "demo-mysql",
      schemas: ["dataforai"],
      enabledTables: ["dataforai.orders"]
    };

    expect(
      deriveAssistantResumeState({
        connection,
        sources: { tables: [] },
        draft: { step: 6 }
      }).step
    ).toBe(2);
  });

  it("reports service readiness blockers instead of claiming a broken execution layer is ready", () => {
    const connection: ConnectionInfo = {
      id: "demo-mysql",
      schemas: ["dataforai"],
      enabledTables: ["dataforai.orders"]
    };
    const readiness = deriveSetupReadiness({
      connection,
      sources: {
        tables: [],
        manifestSchemas: [
          {
            conn: "demo-mysql",
            schema: "dataforai",
            filePath: "semantic-layer/demo-mysql/_schema/dataforai.yaml",
            tableCount: 1,
            mtime: "2026-09-27T00:00:00.000Z"
          }
        ]
      },
      probeStatus: "ok",
      endpointReady: true,
      runtime: {
        endpoint: { upstreamHost: "127.0.0.1", upstreamPort: 7879 },
        config: {
          projectRoot: "/workspace",
          ktxYamlDigest: "digest",
          connectionIds: ["demo-mysql"],
          updatedAt: "2026-09-27T00:00:00.000Z"
        },
        catalog: {
          connectionIds: ["demo-mysql"],
          lastByConnection: {
            "demo-mysql": {
              id: "reload-1",
              status: "success",
              finishedAt: "2026-09-27T00:00:00.000Z"
            }
          }
        },
        policy: {
          policyVersion: "1",
          degradedGlobal: false,
          degradedAgents: [],
          accessConfigDigest: "access",
          sourceMapVersion: "sources",
          healthy: true
        },
        execution: {
          status: "error",
          lastCheckedAt: "2026-09-27T00:00:00.000Z",
          missingConnections: ["demo-mysql"]
        }
      }
    });

    expect(readiness.serviceReady).toBe(false);
    expect(readiness.issues.map((issue) => issue.code)).toContain("execution_not_ready");
  });

  it("maps raw DNS probe output to an actionable summary", () => {
    const error = formatProbeFailure(
      "Project: /tmp/lucy-conn-probe-abc getaddrinfo EAI_AGAIN invalid.local"
    );
    expect(error.summary).toBe("无法解析主机地址，请检查主机名或 DNS 配置。");
    expect(error.technicalDetail).toContain("EAI_AGAIN");
    expect(error.summary).not.toContain("/tmp/");
  });

  it("builds client configurations for Cursor, Claude Code, Codex, and Generic JSON", () => {
    const configs = buildClientConfigs("https://lucy.example.com/mcp", "test-token-123", "mysql-test");
    expect(configs.cursor.snippet).toContain("lucy-mysql-test");
    expect(configs.cursor.snippet).toContain("Bearer test-token-123");
    expect(configs.claude_code.snippet).toContain("claude mcp add");
    expect(configs.codex.snippet).toContain("[mcp_servers.lucy-mysql-test]");
    expect(configs.json.snippet).toContain("https://lucy.example.com/mcp");
    expect(configs.cursor.snippet).not.toContain("localhost");
    expect(configs.cursor.snippet).not.toContain("127.0.0.1");
  });

  it("does not invent a localhost MCP endpoint when url is empty", () => {
    const configs = buildClientConfigs("", "test-token-123");
    expect(configs.cursor.snippet).toContain("<LUCY_PUBLIC_MCP_URL>");
    expect(configs.cursor.snippet).not.toContain("localhost");
    expect(configs.cursor.snippet).not.toContain("127.0.0.1:7879");
  });

  it("builds Hello World prompt", () => {
    const prompt = buildHelloWorldPrompt("mysql-test", "orders");
    expect(prompt).toContain("mysql-test");
    expect(prompt).toContain("orders");
  });

  it("persists and clears draft in localStorage", () => {
    localStorage.clear();
    setAssistantDraft("conn-1", { step: 3, selectedTables: ["db.t1"] });
    const draft = getAssistantDraft("conn-1");
    expect(draft?.step).toBe(3);
    expect(draft?.selectedTables).toEqual(["db.t1"]);

    clearAssistantDraft("conn-1");
    expect(getAssistantDraft("conn-1")).toBeNull();
  });
});

describe("SetupAssistantModal Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url === "/api/connections/probe" && method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { status: "ok", latencyMs: 15 } }));
        }

        if (url === "/api/connections" && method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                connection: { id: "test-conn", schemas: ["test_db"], enabledTables: [] },
                test: { status: "ok", latencyMs: 15 }
              }
            })
          );
        }

        if (url === "/api/catalog/assets" && method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { ok: true } }));
        }

        if (url === "/api/sources" && method === "GET") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                tables: [
                  {
                    conn: "test-conn",
                    schema: "test_db",
                    table: "users",
                    qualifiedName: "test_db.users",
                    columnCount: 5,
                    columnNames: ["id", "name"],
                    filePath: "semantic-layer/test-conn/test_db/users.yaml",
                    hasTableDesc: true,
                    hasGrain: false,
                    measureCount: 0,
                    joinCount: 0,
                    wikiRefCount: 0,
                    completion: "partial",
                    mtime: "2026-09-27T00:00:00.000Z",
                    enabled: false,
                    authorizedAgentCount: 0,
                    semanticUpdatedAt: "2026-09-27T00:00:00.000Z",
                    semanticUpdatedAtSource: "manifest"
                  }
                ]
              }
            })
          );
        }

        if (url.includes("/enabled-tables") && method === "PUT") {
          return new Response(JSON.stringify({ ok: true, data: { ok: true } }));
        }

        if (url === "/api/wiki" && method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { ok: true } }));
        }

        if (url === "/api/admin/agents" && method === "GET") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                agents: [
                  { id: "admin", name: "System Admin", enabled: true, role: "admin", roles: ["admin"], tokens: [] }
                ]
              }
            })
          );
        }

        if (url.startsWith("/api/admin/agents/") && url.endsWith("/tokens") && method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                token: "lucy_live_admin_token_abcdef123456",
                hash: "sha256:1234567890",
                label: "onboard-admin-quick",
                created: "2026-08-29",
                expires_at: "2026-09-28"
              }
            })
          );
        }

        if (url === "/api/project" && method === "GET") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                mcpEndpoint: {
                  url: "https://lucy.example.com/mcp",
                  status: "configured",
                  source: "env",
                  configured: true,
                  diagnostics: []
                },
                connections: []
              }
            })
          );
        }

        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders Step 1 and advances through probe and creation", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SetupAssistantModal open onClose={onClose} initialStep={1} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    assertNoForbiddenTerms(container);
    expect(screen.getByTestId("setup-assistant-modal")).toBeInTheDocument();
    expect(screen.getByTestId("setup-step-1")).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByTestId("setup-conn-id"), { target: { value: "test-conn" } });
    fireEvent.change(screen.getByTestId("setup-host"), { target: { value: "127.0.0.1" } });
    fireEvent.change(screen.getByTestId("setup-database"), { target: { value: "test_db" } });
    fireEvent.change(screen.getByTestId("setup-username"), { target: { value: "root" } });
    fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "secret123" } });

    // Test probe
    const probeBtn = screen.getByTestId("setup-probe-btn");
    fireEvent.click(probeBtn);
    await waitFor(() => {
      expect(screen.getByText(/连通测试成功/)).toBeInTheDocument();
    });

    // Submit step 1
    const nextBtn = screen.getByTestId("setup-step1-next");
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    // Should advance to Step 2
    await waitFor(() => {
      expect(screen.getByTestId("setup-step-2")).toBeInTheDocument();
    });
  });

  it("blocks creation after a failed probe and exposes an actionable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/connections/probe" && (init?.method || "GET") === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                status: "error",
                message: "Project: /tmp/lucy-conn-probe-abc getaddrinfo EAI_AGAIN invalid.local"
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SetupAssistantModal open onClose={vi.fn()} initialStep={1} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText(/连接 ID/), { target: { value: "test-conn" } });
    fireEvent.change(screen.getByLabelText(/主机地址/), { target: { value: "invalid.local" } });
    fireEvent.change(screen.getByLabelText(/数据库名/), { target: { value: "test_db" } });
    fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: "readonly_user" } });
    fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "secret123" } });

    fireEvent.click(screen.getByTestId("setup-probe-btn"));

    expect(
      await screen.findByText("无法解析主机地址，请检查主机名或 DNS 配置。")
    ).toBeInTheDocument();
    expect(screen.getByTestId("setup-step1-next")).toBeDisabled();
    expect(screen.getByText("技术详情")).toBeInTheDocument();
    expect(screen.queryByText(/Project: \/tmp\//)).not.toBeVisible();
  });

  it("names the dialog, manages focus, traps Tab, closes on Escape, and restores the opener", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>打开向导</button>
          <SetupAssistantModal open={open} onClose={() => setOpen(false)} initialStep={1} />
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Harness /></MemoryRouter>
      </QueryClientProvider>
    );
    const opener = screen.getByRole("button", { name: "打开向导" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "连接数据库" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "连接数据库" })).toHaveFocus());

    const close = screen.getByRole("button", { name: "关闭接入向导" });
    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "显示数据库密码" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("asks before discarding dirty form input", () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SetupAssistantModal open onClose={onClose} initialStep={1} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByTestId("setup-host"), { target: { value: "db.internal" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭接入向导" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("setup-discard-confirm")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("setup-discard-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks Step 4 with zero tables and requires table plus YAML in custom mode", () => {
    const onSuccess = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Step4SemanticOverlay
          connectionId="test-conn"
          enabledTables={[]}
          onSuccess={onSuccess}
          onSkip={vi.fn()}
          onBack={vi.fn()}
        />
      </QueryClientProvider>
    );
    expect(screen.getByTestId("setup-step4-table-guard")).toBeInTheDocument();
    expect(screen.getByTestId("setup-step4-next")).toBeDisabled();
    expect(screen.getByTestId("setup-step4-skip")).toBeDisabled();

    rerender(
      <QueryClientProvider client={queryClient}>
        <Step4SemanticOverlay
          connectionId="test-conn"
          enabledTables={["test_db.users"]}
          onSuccess={onSuccess}
          onSkip={vi.fn()}
          onBack={vi.fn()}
        />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByTestId("setup-overlay-mode-custom"));
    expect(screen.getByTestId("setup-step4-next")).toBeDisabled();
    fireEvent.change(screen.getByTestId("setup-overlay-textarea"), {
      target: { value: "measures:\n  - name: total" }
    });
    expect(screen.getByTestId("setup-step4-next")).not.toBeDisabled();
  });

  it("allows skipping Step 2, selecting tables in Step 3, skipping Step 4 & 5, and finishing at Step 6", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SetupAssistantModal open onClose={onClose} initialStep={2} initialConnectionId="test-conn" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Step 2: Skip
    expect(screen.getByTestId("setup-step-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("setup-step2-skip"));

    // Step 3: Select tables
    await waitFor(() => {
      expect(screen.getByTestId("setup-step-3")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("setup-table-item-test_db.users")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("setup-step3-next"));

    // Step 4: Skip semantic overlay
    await waitFor(() => {
      expect(screen.getByTestId("setup-step-4")).toBeInTheDocument();
    });
    const enabledTablesWrite = vi.mocked(global.fetch).mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/enabled-tables") && (init?.method || "GET") === "PUT"
    );
    expect(enabledTablesWrite).toBeDefined();
    expect(JSON.parse(String(enabledTablesWrite?.[1]?.body))).toMatchObject({
      enabledTables: ["test_db.users"],
      dryRun: false
    });
    fireEvent.click(screen.getByTestId("setup-step4-skip"));

    // Step 5: Skip business wiki
    await waitFor(() => {
      expect(screen.getByTestId("setup-step-5")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("setup-step5-skip"));

    // Step 6: Connect Agent / Finish
    await waitFor(() => {
      expect(screen.getByTestId("setup-step-6")).toBeInTheDocument();
    });
    expect(screen.getByTestId("setup-copy-config-btn")).toBeInTheDocument();
    expect(screen.getByTestId("setup-copy-prompt-btn")).toBeInTheDocument();

    // Tab switching
    fireEvent.click(screen.getByTestId("setup-mcp-tab-claude_code"));
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument();

    // Finish
    fireEvent.click(screen.getByTestId("setup-finish-btn"));
    expect(onClose).toHaveBeenCalled();
  });

  it("hydrates an existing connection before rendering Step 3", async () => {
    const connection: ConnectionInfo = {
      id: "test-conn",
      schemas: ["test_db"],
      enabledTables: ["test_db.users"]
    };
    const sources: SourcesResponse = {
      manifestSchemas: [
        {
          conn: "test-conn",
          schema: "test_db",
          filePath: "semantic-layer/test-conn/_schema/test_db.yaml",
          tableCount: 1,
          mtime: "2026-09-27T00:00:00.000Z"
        }
      ],
      tables: [
        {
          conn: "test-conn",
          schema: "test_db",
          table: "users",
          qualifiedName: "test_db.users",
          columnCount: 5,
          columnNames: ["id", "name"],
          filePath: "semantic-layer/test-conn/test_db/users.yaml",
          hasTableDesc: true,
          hasGrain: false,
          measureCount: 0,
          joinCount: 0,
          wikiRefCount: 0,
          completion: "partial",
          mtime: "2026-09-27T00:00:00.000Z",
          enabled: true,
          authorizedAgentCount: 1,
          semanticUpdatedAt: "2026-09-27T00:00:00.000Z",
          semanticUpdatedAtSource: "manifest"
        }
      ]
    };

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SetupAssistantModal
            open
            onClose={vi.fn()}
            initialStep={3}
            initialConnectionId="test-conn"
            initialConnection={connection}
            initialSources={sources}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByTestId("setup-step-4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← 上一步" }));
    await waitFor(() => {
      expect(screen.getByTestId("setup-step-3")).toBeInTheDocument();
    });
    expect(await screen.findByTestId("setup-table-item-test_db.users")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getAllByText("1 张", { selector: "span" })).toHaveLength(2);
  });

  it("requires admin-scope acknowledgment before token generation and auto-injects the token", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SetupAssistantModal open onClose={onClose} initialStep={6} initialConnectionId="test-conn" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("setup-step-6")).toBeInTheDocument();
    });

    // Before token generation, config snippet has placeholder token but real Advertise URL
    const configSnippet = screen.getByTestId("setup-mcp-config-snippet");
    await waitFor(() => {
      expect(configSnippet).toHaveTextContent("https://lucy.example.com/mcp");
    });
    expect(configSnippet).toHaveTextContent("<YOUR_LUCY_AGENT_TOKEN>");
    expect(configSnippet).not.toHaveTextContent("localhost");
    expect(configSnippet).not.toHaveTextContent("127.0.0.1");

    // Check token card is rendered in "待签发" state
    expect(screen.getByTestId("setup-token-card")).toBeInTheDocument();
    expect(screen.getByText("待签发")).toBeInTheDocument();

    // Admin/wildcard credentials require an explicit risk acknowledgment.
    const generateBtn = screen.getByTestId("setup-generate-token-btn");
    expect(generateBtn).toBeInTheDocument();
    expect(generateBtn).toBeDisabled();
    fireEvent.click(await screen.findByTestId("setup-token-broad-ack"));
    expect(generateBtn).not.toBeDisabled();
    fireEvent.click(generateBtn);

    // After token generation
    await waitFor(() => {
      expect(screen.getByTestId("setup-active-token")).toBeInTheDocument();
    });
    expect(screen.getByTestId("setup-active-token")).toHaveTextContent("lucy_live_admin_token_abcdef123456");
    expect(screen.getByText("✓ Token 已注入")).toBeInTheDocument();

    // Config snippet is updated automatically with the real token!
    expect(configSnippet).toHaveTextContent("Bearer lucy_live_admin_token_abcdef123456");

    // Copy buttons
    const copyTokenBtn = screen.getByTestId("setup-copy-token-btn");
    expect(copyTokenBtn).toBeInTheDocument();
    fireEvent.click(copyTokenBtn);

    const copyConfigBtn = screen.getByTestId("setup-copy-config-btn");
    fireEvent.click(copyConfigBtn);

    // Regenerate button is available
    expect(screen.getByTestId("setup-regenerate-token-btn")).toBeInTheDocument();
  });
});

describe("ConnectionOverview Setup Assistant Bridge", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders page header '启动接入向导' and opens modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/project") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                connections: [
                  {
                    id: "demo-db",
                    driver: "mysql",
                    schemas: ["demo_schema"],
                    enabledTables: []
                  }
                ]
              }
            })
          );
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { sources: [] } }));
        }
        if (url === "/api/catalog/reloads") {
          return new Response(JSON.stringify({ ok: true, data: { reloads: [], lastByConnection: {} } }));
        }
        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConnectionOverview />
        </MemoryRouter>
      </QueryClientProvider>
    );

    assertNoForbiddenTerms(container);

    await waitFor(() => {
      expect(screen.getByTestId("start-onboarding-assistant-btn")).toBeInTheDocument();
    });

    // Connection card displays resume assistant button
    await waitFor(() => {
      expect(screen.getByTestId("resume-assistant-demo-db")).toBeInTheDocument();
    });

    // Click resume
    fireEvent.click(screen.getByTestId("resume-assistant-demo-db"));
    await waitFor(() => {
      expect(screen.getByTestId("setup-assistant-modal")).toBeInTheDocument();
    });
  });

  it("renders empty state with hero assistant button when no connections exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/project") {
          return new Response(JSON.stringify({ ok: true, data: { connections: [] } }));
        }
        if (url === "/api/sources") {
          return new Response(JSON.stringify({ ok: true, data: { sources: [] } }));
        }
        if (url === "/api/catalog/reloads") {
          return new Response(JSON.stringify({ ok: true, data: { reloads: [], lastByConnection: {} } }));
        }
        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConnectionOverview />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("connections-empty-state")).toBeInTheDocument();
      expect(screen.getByTestId("start-assistant-empty-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("start-assistant-empty-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("setup-assistant-modal")).toBeInTheDocument();
    });
  });
});
