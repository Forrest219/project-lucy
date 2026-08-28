// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
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
  formatAssistantProgressLabel
} from "../lib/setupAssistant";
import { SetupAssistantModal } from "../components/onboarding/SetupAssistantModal";
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

  it("builds client configurations for Cursor, Claude Code, Codex, and Generic JSON", () => {
    const configs = buildClientConfigs("http://127.0.0.1:7879/mcp", "test-token-123", "mysql-test");
    expect(configs.cursor.snippet).toContain("lucy-mysql-test");
    expect(configs.cursor.snippet).toContain("Bearer test-token-123");
    expect(configs.claude_code.snippet).toContain("claude mcp add");
    expect(configs.codex.snippet).toContain("[mcp_servers.lucy-mysql-test]");
    expect(configs.json.snippet).toContain("http://127.0.0.1:7879/mcp");
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
                sources: [
                  {
                    conn: "test-conn",
                    schema: "test_db",
                    table: "users",
                    qualifiedName: "test_db.users",
                    columnCount: 5,
                    columnNames: ["id", "name"]
                  }
                ]
              }
            })
          );
        }

        if (url.includes("/enabled-tables") && method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { ok: true } }));
        }

        if (url === "/api/wiki" && method === "POST") {
          return new Response(JSON.stringify({ ok: true, data: { ok: true } }));
        }

        if (url === "/api/project" && method === "GET") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                mcpEndpoint: { url: "http://127.0.0.1:7879/mcp" },
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
