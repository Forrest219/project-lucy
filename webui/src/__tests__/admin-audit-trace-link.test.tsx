// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("TraceLink — read-only kernel entry (202608-01)", () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a '查看 Trace' button that does not fetch until clicked", () => {
    renderLink("trace-click-1");
    expect(screen.getByRole("button", { name: /查看 Trace/ })).toBeDefined();
    expect(mockedApiGet).not.toHaveBeenCalled();
  });

  it("fetches /api/admin/trace/events on click and renders span/evidence counts in the Drawer", async () => {
    mockedApiGet.mockResolvedValue({
      ok: true,
      data: {
        events: [
          { id: 1, traceId: "t", spanId: "a", spanType: "mcp_tools_call", status: "denied" },
          { id: 2, traceId: "t", spanId: "a:policy", spanType: "policy_decision", status: "denied" }
        ],
        evidence: [
          { id: 1, traceId: "t", evidenceKind: "access_policy", relation: "denied_by" }
        ]
      }
    });
    renderLink("trace-click-2");
    const button = screen.getByRole("button", { name: /查看 Trace/ });
    button.click();
    await waitFor(() => {
      expect(mockedApiGet).toHaveBeenCalledWith(
        "/api/admin/trace/events?traceId=trace-click-2"
      );
    });
    // After P0-CLOSE-01 the counts live inside the Drawer subtitle, not as
    // inline text next to the button. Wait for the query to settle (subtitle
    // flips from 0 to 2 once data arrives) — the microtask of mockResolvedValue
    // needs a tick to land.
    await waitFor(() => {
      const drawer = screen.queryByTestId("audit-trace-drawer-trace-click-2");
      expect(drawer?.textContent ?? "").toMatch(/2\s*Span/);
      expect(drawer?.textContent ?? "").toMatch(/1\s*Evidence/);
    });
  });

  it("shows a '加载失败' hint when the kernel rejects the request", async () => {
    mockedApiGet.mockRejectedValue(new Error("kernel offline"));
    renderLink("trace-fail");
    screen.getByRole("button", { name: /查看 Trace/ }).click();
    await waitFor(() => {
      expect(screen.getByText(/Trace 加载失败/)).toBeDefined();
    });
  });

  it("never renders raw args, raw SQL, or full question payloads (even in the Drawer)", async () => {
    // Even if a misbehaving server returns forbidden payloads, the link only
    // shows counts and redacted chips — never the payload itself.
    mockedApiGet.mockResolvedValue({
      ok: true,
      data: {
        events: [
          {
            id: 1,
            traceId: "t",
            spanId: "a",
            spanType: "mcp_tools_call",
            status: "ok",
            metadata: {
              raw_sql_ast: "SELECT * FROM users",
              full_question_payload: "DROP TABLE users",
              password: "hunter2"
            }
          }
        ],
        evidence: []
      }
    });
    renderLink("trace-redact");
    screen.getByRole("button", { name: /查看 Trace/ }).click();
    // After P0-CLOSE-01 the data lives in the Drawer. Wait for the query to
    // settle (subtitle flips from 0 to 1) before scanning the document.
    await waitFor(() => {
      const drawer = screen.queryByTestId("audit-trace-drawer-trace-redact");
      expect(drawer?.textContent ?? "").toMatch(/1\s*Span/);
    });
    const fullDocumentText = document.body.textContent ?? "";
    expect(fullDocumentText).not.toContain("SELECT * FROM users");
    expect(fullDocumentText).not.toContain("DROP TABLE users");
    expect(fullDocumentText).not.toContain("hunter2");
  });
});