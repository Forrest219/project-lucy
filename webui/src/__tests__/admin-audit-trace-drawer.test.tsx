// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceLink } from "../pages/admin/Audit";
import { apiGet } from "../lib/apiClient";

vi.mock("../lib/apiClient", () => ({
  apiGet: vi.fn()
}));

const mockedApiGet = vi.mocked(apiGet);

function renderLink(traceId: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
        <TraceLink traceId={traceId} />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}

const SAMPLE_TRACE = {
  ok: true,
  data: {
    events: [
      {
        id: 1,
        traceId: "trace-drawer-1",
        spanId: "mcp_tools_call:connection_list:trace-drawer-1",
        parentSpanId: undefined,
        spanType: "mcp_tools_call",
        actorKind: "agent",
        actorId: "agent-zhangsan",
        status: "ok",
        startedAt: "2026-08-03T08:00:01.000Z",
        endedAt: "2026-08-03T08:00:02.000Z",
        requestId: "req-42",
        policyDecision: {
          allowed: true,
          reason: "matched: role analyst allowlist",
          toolName: "connection_list",
          matchedRule: "role:analyst",
          source: "access_policy"
        },
        artifactHashes: ["5576284f14bd3c3ff12378638bddf01e", "deadbeefcafebabedeadbeefcafebabe"],
        metadata: {
          toolName: "connection_list",
          note: "happy path"
        }
      },
      {
        id: 2,
        traceId: "trace-drawer-1",
        spanId: "policy_decision:connection_list:trace-drawer-1",
        parentSpanId: "mcp_tools_call:connection_list:trace-drawer-1",
        spanType: "policy_decision",
        actorKind: "system",
        status: "ok",
        startedAt: "2026-08-03T08:00:01.500Z",
        policyDecision: {
          allowed: true,
          source: "access_policy",
          matchedRule: "role:analyst"
        },
        artifactHashes: [],
        metadata: {}
      }
    ],
    evidence: [
      {
        id: 10,
        traceEventId: 2,
        traceId: "trace-drawer-1",
        evidenceKind: "access_policy",
        evidenceRef: "role:analyst:allowlist:v3",
        evidenceVersion: "v3",
        evidenceHash: "abc123abc123abc123abc123abc123ab",
        relation: "used",
        metadata: { roleCount: 1 }
      },
      {
        id: 11,
        traceEventId: 2,
        traceId: "trace-drawer-1",
        evidenceKind: "permission_snapshot",
        evidenceRef: "snap-7e57",
        relation: "observed",
        metadata: {}
      }
    ]
  }
} as const;

describe("TraceLink — Drawer (P0-CLOSE-01)", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the Drawer, renders ordered spans (parent before child), and shows policy decision", async () => {
    mockedApiGet.mockResolvedValue(SAMPLE_TRACE);
    renderLink("trace-drawer-1");
    fireEvent.click(screen.getByRole("button", { name: /查看 Trace/ }));

    const drawer = await screen.findByTestId("audit-trace-drawer-trace-drawer-1");
    // Wait for the spans to render (i.e. the query to settle)
    await within(drawer).findByTestId("trace-span-mcp_tools_call:connection_list:trace-drawer-1");
    // Drawer title shows Trace 详情; Trace ID is in a protected mono line
    expect(within(drawer).getByTestId("trace-detail-title").textContent).toBe("Trace 详情");
    expect(within(drawer).getByTestId("trace-detail-trace-id").textContent).toBe("trace-drawer-1");
    expect(within(drawer).getByText("有序 Span")).toBeTruthy();
    expect(within(drawer).getByText("Evidence Ref")).toBeTruthy();
    expect(within(drawer).getAllByText("策略裁决").length).toBeGreaterThan(0);
    // Two spans rendered — span root divs carry both data-testid
    // "trace-span-<spanId>" AND data-span-type="<spanType>". Inner
    // sub-blocks (trace-span-artifacts, trace-span-policy) don't have
    // data-span-type, so we can filter on it for a precise count.
    const spansSection = within(drawer).getByTestId("trace-detail-spans");
    const rootEls = spansSection.querySelectorAll<HTMLElement>("[data-span-type]");
    expect(rootEls).toHaveLength(2);
    // The mcp_tools_call span comes first (root) — startedAt is 08:00:01.000
    const rootSpan = within(spansSection).getByTestId(
      "trace-span-mcp_tools_call:connection_list:trace-drawer-1"
    );
    const childSpan = within(spansSection).getByTestId(
      "trace-span-policy_decision:connection_list:trace-drawer-1"
    );
    expect(
      rootSpan.compareDocumentPosition(childSpan) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Policy decision on the root span is visible
    expect(within(rootSpan).getByTestId("trace-span-policy-allowed").textContent).toMatch(/允许/);
    expect(within(rootSpan).getByTestId("trace-span-policy-source").textContent).toMatch(/访问策略/);
  });

  it("renders artifact hashes (truncated) and never the full hash string as text", async () => {
    mockedApiGet.mockResolvedValue(SAMPLE_TRACE);
    renderLink("trace-drawer-1");
    fireEvent.click(screen.getByRole("button", { name: /查看 Trace/ }));
    const drawer = await screen.findByTestId("audit-trace-drawer-trace-drawer-1");
    const artifacts = await within(drawer).findAllByTestId("trace-span-artifacts");
    expect(artifacts.length).toBeGreaterThan(0);
    // The artifact hash block truncates to 16 chars + ellipsis; the full
    // 32-char hash is in the title attribute, not in any visible text node.
    const drawerText = drawer.textContent ?? "";
    expect(drawerText).toContain("5576284f14bd3c3f…");
    expect(drawerText).not.toContain("5576284f14bd3c3ff12378638bddf01e");
  });

  it("renders evidence refs grouped by evidenceKind and sorted by group size", async () => {
    mockedApiGet.mockResolvedValue(SAMPLE_TRACE);
    renderLink("trace-drawer-1");
    fireEvent.click(screen.getByRole("button", { name: /查看 Trace/ }));
    const drawer = await screen.findByTestId("audit-trace-drawer-trace-drawer-1");
    const evidenceSection = await within(drawer).findByTestId("trace-detail-evidence");
    // Both groups have 1 entry, sorted alphabetically: access_policy < permission_snapshot
    const headings = within(evidenceSection).getAllByRole("heading", { level: 4 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "access_policy · 1",
      "permission_snapshot · 1"
    ]);
  });

  it("renders [REDACTED] chip with tooltip for sensitive metadata keys, never the raw value", async () => {
    mockedApiGet.mockResolvedValue({
      ok: true,
      data: {
        events: [
          {
            id: 1,
            traceId: "t",
            spanId: "s",
            spanType: "mcp_tools_call",
            status: "ok",
            startedAt: "2026-08-03T08:00:00.000Z",
            policyDecision: undefined,
            artifactHashes: [],
            metadata: {
              password: "hunter2-secret-value",
              note: "non-sensitive note"
            }
          }
        ],
        evidence: []
      }
    });
    renderLink("trace-redact-2");
    fireEvent.click(screen.getByRole("button", { name: /查看 Trace/ }));
    const drawer = await screen.findByTestId("audit-trace-drawer-trace-redact-2");
    const chip = await within(drawer).findByTestId("trace-meta-redacted-password");
    expect(chip.textContent).toBe("[REDACTED]");
    // The sensitive value is not present anywhere in visible text
    expect((drawer.textContent ?? "")).not.toContain("hunter2-secret-value");
    // The non-sensitive note is visible as-is
    expect(within(drawer).getByText("non-sensitive note")).toBeDefined();
  });

  it("shows error state inside the Drawer when the kernel rejects the request", async () => {
    mockedApiGet.mockRejectedValue(new Error("kernel offline"));
    renderLink("trace-fail-2");
    fireEvent.click(screen.getByRole("button", { name: /查看 Trace/ }));
    const drawer = await screen.findByTestId("audit-trace-drawer-trace-fail-2");
    const err = await within(drawer).findByTestId("trace-detail-error");
    expect(err.textContent).toMatch(/Trace 加载失败.*kernel offline/);
  });
});
