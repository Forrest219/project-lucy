// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Review } from "../pages/Review";

function renderReview() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Review />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Review", () => {
  it("switches changed files and shows validate changed results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/diff") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                files: [
                  { filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml", status: "modified", diff: "+ orders diff" },
                  { filePath: "semantic-layer/mysql-aliyun/customers.yaml", status: "added", diff: "+ customers diff" }
                ]
              }
            })
          );
        }
        if (url === "/api/validate-changed" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                results: [
                  { conn: "mysql-aliyun", schema: "dataforai", table: "superstore_orders", validation: { ok: true, exitCode: 0, stdout: "", stderr: "" } },
                  { conn: "mysql-aliyun", schema: "dataforai", table: "customers", validation: { ok: false, exitCode: 1, stdout: "", stderr: "bad" } }
                ]
              }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );

    renderReview();

    expect(await screen.findByText(/\+ orders diff/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /customers.yaml/ }));
    expect(screen.getByText(/\+ customers diff/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Validate changed" }));
    expect(await screen.findByText("1 张表未通过")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("FAIL")).toBeInTheDocument());
  });
});
