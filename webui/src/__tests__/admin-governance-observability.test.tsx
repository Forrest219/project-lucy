// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GovernanceOverview } from "../pages/admin/GovernanceOverview";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GovernanceOverview />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/admin/governance/overview")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          windowHours: 168,
          localAdminNotice: "local-admin mode",
          cards: {
            calls: 3,
            denied: 1,
            deniedRate: 33.3,
            p95LatencyMs: 120,
            activeTokenCount: 1,
            staleTokenCount: 1,
            highDenialAgentCount: 1,
            brokenRoleCount: 1,
            overBroadRoleCount: 1,
            configChangeCount: 2
          }
        }
      }));
    }
    if (url.startsWith("/api/admin/governance/agents")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          agents: [{
            id: "agent-a",
            name: "Agent A",
            enabled: true,
            roleId: "finance_readonly",
            calls: 3,
            denied: 1,
            deniedRate: 33.3,
            p95LatencyMs: 120,
            lastSeen: "2026-08-03T01:00:00.000Z",
            activeTokenCount: 1,
            configuredTokenCount: 2,
            topDeniedReason: "table_forbidden",
            auditHref: "/admin/audit?user=agent-a",
            agentHref: "/admin/agents/agent-a"
          }]
        }
      }));
    }
    if (url.startsWith("/api/admin/governance/roles")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          roles: [{
            id: "finance_readonly",
            description: "Finance scoped role",
            sourceCount: 1,
            toolCount: 1,
            usageCount: 2,
            status: "sensitive",
            flags: ["sensitive_scope"]
          }]
        }
      }));
    }
    if (url.startsWith("/api/admin/governance/tokens")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          tokens: [{
            agentId: "agent-a",
            label: "active-token",
            tokenHashPrefix: "abc123def456",
            lastUsed: "2026-08-03T01:00:00.000Z",
            stale: false,
            auditHref: "/admin/audit?user=agent-a"
          }]
        }
      }));
    }
    if (url.startsWith("/api/admin/governance/denials")) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          reasonCounts: [{ reason: "table_forbidden", count: 1 }],
          topTools: [{ tool: "lucy_query", count: 1 }],
          topSources: []
        }
      }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GovernanceOverview", () => {
  it("renders governance aggregates and sanitized drilldowns", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole("heading", { name: "治理概览" })).toBeInTheDocument();
    expect((await screen.findAllByText("33.3%")).length).toBeGreaterThan(0);
    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(screen.getAllByText("finance_readonly").length).toBeGreaterThan(0);
    expect(screen.getByText("table_forbidden")).toBeInTheDocument();
    expect(screen.getByText("active-token")).toBeInTheDocument();
    expect(screen.queryByText(/select \*/i)).not.toBeInTheDocument();
  });
});
