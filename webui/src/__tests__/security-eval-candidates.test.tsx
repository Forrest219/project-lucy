// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecurityCandidates } from "../pages/eval/SecurityCandidates";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SecurityCandidates />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/eval/security-candidates" && !init?.method) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          candidates: [{
            id: "sec_eval_001",
            normalizedEvent: "tool=lucy_query | reason=table_forbidden | query=展示 Token 消耗最高的表",
            decisionReason: "table_forbidden",
            tool: "lucy_query",
            userId: "agent-a",
            roleIds: ["finance_readonly"],
            tableRefs: ["mysql.dataforai.kx_fact_financial_amount"],
            riskTier: "P0",
            status: "accepted",
            redactionStatus: "kept",
            sourceTraceId: "trace-001"
          }]
        }
      }));
    }
    if (url === "/api/eval/security-candidates/extract" && init?.method === "POST") {
      return new Response(JSON.stringify({
        ok: true,
        data: { scanned: 1, inserted: 1, rejected: 0, duplicate: 0 }
      }));
    }
    if (url.endsWith("/review") && init?.method === "POST") {
      return new Response(JSON.stringify({ ok: true, data: { status: "accepted" } }));
    }
    if (url.endsWith("/promote/preview") && init?.method === "POST") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          candidateId: "sec_eval_001",
          relPath: "evals/security/eval/security-eval-cases.yaml",
          diff: "+ id: security_001"
        }
      }));
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SecurityCandidates", () => {
  it("renders security candidates and calls review/preview APIs", async () => {
    const fetchMock = stubFetch();
    renderPage();

    expect(await screen.findByRole("heading", { name: "安全候选" })).toBeInTheDocument();
    expect(await screen.findByText(/展示 Token 消耗最高的表/)).toBeInTheDocument();
    expect(screen.queryByText(/abcdefghijklmnopqrstuvwxyz1234567890/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/展示 Token 消耗最高的表/));
    fireEvent.click(screen.getByRole("button", { name: "审定接受" }));
    fireEvent.click(screen.getByRole("button", { name: "生成 Diff" }));

    await waitFor(() => expect(screen.getByText("+ id: security_001")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/eval/security-candidates/sec_eval_001/review",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/eval/security-candidates/sec_eval_001/promote/preview",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("extracts candidates from audit logs on demand", async () => {
    const fetchMock = stubFetch();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "抽取候选" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/eval/security-candidates/extract",
      expect.objectContaining({ method: "POST" })
    ));
  });
});
