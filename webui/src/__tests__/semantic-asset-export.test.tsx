// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticAssetExportButton } from "../components/semantic-assets/SemanticAssetExportButton";
import type { SemanticAssetExportResponse } from "../lib/types";

type Handler = (body: unknown, init?: RequestInit) => Response | Promise<Response>;
type HandlerMap = Record<string, Handler>;

function stubFetch(handlers: HandlerMap) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const key = `${method} ${url.replace(/^http:\/\/[^/]+/, "")}`;
    const handler = handlers[key] ?? handlers[`${method} ${url}`];
    if (!handler) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
        { status: 404 }
      );
    }
    return handler(init?.body, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { client, Wrapper };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SemanticAssetExportButton", () => {
  it("calls the export endpoint and shows included/excluded summary using the backend download URL", async () => {
    const exportResponse: SemanticAssetExportResponse = {
      exportId: "exp_20260730_163000_001",
      filename: "lucy-semantic-asset-exp_20260730_163000_001.zip",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      downloadUrl: "/api/semantic-assets/exports/exp_20260730_163000_001/download",
      includedFiles: [
        "semantic-layer/customer-db/international_country_metrics.yaml",
        "ktx.yaml"
      ],
      excludedFiles: [
        { path: ".ktx/secrets", reason: "forbidden-prefix" },
        { path: ".env", reason: "forbidden-file" },
        { path: ".ktx-ui/audit.sqlite", reason: "hard-block" }
      ]
    };
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/export": () =>
        new Response(JSON.stringify({ ok: true, data: exportResponse }))
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetExportButton label="下载当前全量资产包 (.zip)" />
      </Wrapper>
    );
    fireEvent.click(screen.getByRole("button", { name: /下载当前全量资产包/ }));
    await waitFor(() => screen.getByTestId("semantic-asset-export-summary"));

    // Always use the backend-provided downloadUrl — never construct one.
    const link = screen.getByTestId("semantic-asset-export-download") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(exportResponse.downloadUrl);
    expect(link.textContent).toContain("下载");

    // Safety copy and counts.
    const summary = screen.getByTestId("semantic-asset-export-summary");
    expect(summary).toHaveTextContent("Secrets 已强制排除");
    expect(summary).toHaveTextContent("包含 2 个文件");
    expect(summary).toHaveTextContent("排除 3 个");

    // Excluded files are surfaced by reason category, never by secret value.
    expect(summary).toHaveTextContent("forbidden-prefix");
    expect(summary).toHaveTextContent("forbidden-file");
    expect(summary).toHaveTextContent("hard-block");
  });

  it("never inlines a constructed file path (the button defers to the backend downloadUrl)", async () => {
    const exportResponse: SemanticAssetExportResponse = {
      exportId: "exp_20260730_170000_001",
      filename: "lucy-semantic-asset-exp_20260730_170000_001.zip",
      sizeBytes: 2048,
      sha256: "1".repeat(64),
      downloadUrl: "/api/semantic-assets/exports/exp_20260730_170000_001/download",
      includedFiles: ["ktx.yaml"],
      excludedFiles: []
    };
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/export": () =>
        new Response(JSON.stringify({ ok: true, data: exportResponse }))
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetExportButton />
      </Wrapper>
    );
    fireEvent.click(screen.getByTestId("semantic-asset-export-button"));
    await waitFor(() => screen.getByTestId("semantic-asset-export-summary"));
    const link = screen.getByTestId("semantic-asset-export-download") as HTMLAnchorElement;
    // The href must NOT be a `blob:` or a data URL or any client-built path.
    expect(link.getAttribute("href")).toMatch(/^\/api\//);
    expect(link.getAttribute("href")).toContain(exportResponse.exportId);
  });

  it("surfaces API errors as a toast and does not render the success summary", async () => {
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/export": () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "EXPORT_FAILED", message: "打包失败" }
          }),
          { status: 500 }
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetExportButton />
      </Wrapper>
    );
    fireEvent.click(screen.getByTestId("semantic-asset-export-button"));
    // After the error, the summary must NOT be present.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("semantic-asset-export-summary")).toBeNull();
  });
});
