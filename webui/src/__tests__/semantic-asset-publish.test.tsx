// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SemanticAssetPublishButton } from "../components/semantic-assets/SemanticAssetPublishButton";
import { SemanticAssetPublishDrawer } from "../components/semantic-assets/SemanticAssetPublishDrawer";
import type {
  SemanticAssetExportResponse,
  SemanticAssetPublishResponse,
  SemanticAssetReleaseRecord,
  SemanticAssetReleaseStatusResponse,
  SemanticAssetValidateResponse
} from "../lib/types";

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

function makeWrapper(initialEntries: string[] = ["/connections"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { client, Wrapper };
}

function makeValidateResponse(overrides: Partial<SemanticAssetValidateResponse> = {}): SemanticAssetValidateResponse {
  return {
    valid: true,
    validationId: "val_20260730_163000_001",
    files: [
      {
        originalFilename: "chatbi.yaml",
        kind: "schemaManifest",
        targetPath: "semantic-layer/customer-db/_schema/chatbi.yaml",
        exists: false,
        sizeBytes: 96,
        sha256: "a".repeat(64),
        connectionId: "customer-db",
        schema: "chatbi",
        warnings: []
      },
      {
        originalFilename: "international_country_metrics.yaml",
        kind: "semanticSource",
        targetPath: "semantic-layer/customer-db/international_country_metrics.yaml",
        exists: false,
        sizeBytes: 84,
        sha256: "b".repeat(64),
        connectionId: "customer-db",
        sourceName: "international_country_metrics",
        physicalTable: "chatbi.ai_metric_international_country_daily",
        warnings: []
      }
    ],
    changedSources: [
      { connectionId: "customer-db", sourceName: "international_country_metrics" }
    ],
    diff: "Index: semantic-layer/customer-db/international_country_metrics.yaml\n+++ new file\n",
    warnings: [],
    errors: [],
    ...overrides
  };
}

function makeReleaseRecord(overrides: Partial<SemanticAssetReleaseRecord> = {}): SemanticAssetReleaseRecord {
  return {
    id: "rel_20260730_163000_001",
    createdAt: "2026-07-30T08:30:00.000Z",
    actor: "local-admin",
    status: "reindexing",
    connectionIds: ["customer-db"],
    files: [
      {
        targetPath: "semantic-layer/customer-db/international_country_metrics.yaml",
        kind: "semanticSource",
        sha256: "b".repeat(64),
        overwritten: false
      }
    ],
    changedSources: [
      { connectionId: "customer-db", sourceName: "international_country_metrics" }
    ],
    diff: "...",
    validation: {
      ok: true,
      results: [
        {
          connectionId: "customer-db",
          sourceName: "international_country_metrics",
          ok: true,
          exitCode: 0,
          issues: []
        }
      ]
    },
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SemanticAssetPublishButton + SemanticAssetPublishDrawer", () => {
  it("opens the drawer when the button is clicked", async () => {
    stubFetch({});
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishButton connectionId="customer-db" />
      </Wrapper>
    );
    fireEvent.click(screen.getByRole("button", { name: "上传语义包" }));
    expect(await screen.findByTestId("semantic-asset-publish-drawer")).toBeInTheDocument();
  });

  it("auto-validates after the user pastes a YAML file and shows the target paths", async () => {
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/validate": () =>
        new Response(JSON.stringify({ ok: true, data: makeValidateResponse() }))
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishDrawer
          open
          onClose={() => undefined}
          defaultConnectionId="customer-db"
        />
      </Wrapper>
    );

    const textarea = await screen.findByTestId("semantic-asset-publish-paste");
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => "name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n" }
    });
    await waitFor(() => {
      expect(screen.getByTestId("semantic-asset-target-paths")).toHaveTextContent(
        "semantic-layer/customer-db/international_country_metrics.yaml"
      );
    });
  });

  it("disables the publish action while validation has errors", async () => {
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/validate": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeValidateResponse({
              valid: false,
              errors: [
                {
                  code: "UNKNOWN_SHAPE",
                  message: "既不是 schema manifest 也不是 semantic overlay",
                  line: 1,
                  column: 1
                }
              ]
            })
          })
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishDrawer open onClose={() => undefined} />
      </Wrapper>
    );
    const textarea = await screen.findByTestId("semantic-asset-publish-paste");
    fireEvent.paste(textarea, {
      clipboardData: { getData: () => "title: random\n" }
    });
    await waitFor(() =>
      expect(screen.getByTestId("semantic-asset-validation-panel")).toHaveTextContent(
        "UNKNOWN_SHAPE"
      )
    );
    const submit = screen.getByTestId("semantic-asset-publish-submit") as HTMLButtonElement;
    expect(submit).toBeDisabled();
  });

  it("revalidates when file content changes even if filename and byte length stay the same", async () => {
    const bodies: unknown[] = [];
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/validate": (body) => {
        bodies.push(JSON.parse(String(body)));
        return new Response(JSON.stringify({ ok: true, data: makeValidateResponse() }));
      }
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishDrawer open onClose={() => undefined} />
      </Wrapper>
    );

    const input = await screen.findByTestId("semantic-asset-publish-file");
    const first = new File(["name: source_a\ntable: chatbi.table_a\n"], "source.yaml", {
      type: "text/yaml"
    });
    const second = new File(["name: source_b\ntable: chatbi.table_b\n"], "source.yaml", {
      type: "text/yaml"
    });

    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(() => expect(bodies).toHaveLength(1));
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(bodies).toHaveLength(2));

    expect((bodies[0] as { files: Array<{ content: string }> }).files[0]?.content).toContain("source_a");
    expect((bodies[1] as { files: Array<{ content: string }> }).files[0]?.content).toContain("source_b");
  });

  it("sends zip selections as package payloads for server-side extraction", async () => {
    const bodies: unknown[] = [];
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/validate": (body) => {
        bodies.push(JSON.parse(String(body)));
        return new Response(JSON.stringify({ ok: true, data: makeValidateResponse() }));
      }
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishDrawer open onClose={() => undefined} />
      </Wrapper>
    );

    const input = await screen.findByTestId("semantic-asset-publish-file");
    const zip = new File([new Uint8Array([1, 2, 3, 4])], "semantic-assets.zip", {
      type: "application/zip"
    });

    fireEvent.change(input, { target: { files: [zip] } });
    await waitFor(() => expect(bodies).toHaveLength(1));

    const payload = bodies[0] as {
      files: unknown[];
      packages: Array<{ filename: string; contentBase64: string }>;
    };
    expect(payload.files).toEqual([]);
    expect(payload.packages[0]?.filename).toBe("semantic-assets.zip");
    expect(payload.packages[0]?.contentBase64).toBe("AQIDBA==");
  });

  it("publishes and shows the reindexing state before the release status reaches published", async () => {
    let statusCalls = 0;
    const publishResponse: SemanticAssetPublishResponse = {
      accepted: true,
      release: makeReleaseRecord({ status: "reindexing" })
    };
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/validate": () =>
        new Response(JSON.stringify({ ok: true, data: makeValidateResponse() })),
      "POST /api/semantic-assets/publish": () =>
        new Response(JSON.stringify({ ok: true, data: publishResponse })),
      "GET /api/semantic-assets/releases/rel_20260730_163000_001/status": () => {
        statusCalls += 1;
        const release = makeReleaseRecord({
          status: statusCalls < 2 ? "reindexing" : "published",
          reindex: { ok: true, exitCode: 0, stdout: "ok", stderr: "" }
        });
        const payload: SemanticAssetReleaseStatusResponse = { release };
        return new Response(JSON.stringify({ ok: true, data: payload }));
      }
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishDrawer open onClose={() => undefined} />
      </Wrapper>
    );
    const textarea = await screen.findByTestId("semantic-asset-publish-paste");
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => "name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n"
      }
    });
    await waitFor(() => screen.getByTestId("semantic-asset-target-paths"));

    const submit = await screen.findByTestId("semantic-asset-publish-submit");
    fireEvent.click(submit);

    // The first paint is "reindexing" (the publish response).
    await waitFor(() => screen.getByTestId("semantic-asset-publish-reindexing"));

    // Status polling eventually flips the UI to "published".
    await waitFor(
      () => {
        expect(screen.getByTestId("semantic-asset-publish-success")).toBeInTheDocument();
      },
      { timeout: 4000 }
    );
    expect(statusCalls).toBeGreaterThanOrEqual(2);
  });

  it("shows the blocked banner when the publish returns 422 VALIDATION_GATE_FAILED", async () => {
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/validate": () =>
        new Response(JSON.stringify({ ok: true, data: makeValidateResponse() })),
      "POST /api/semantic-assets/publish": () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "VALIDATION_GATE_FAILED", message: "ktx sl validate failed" },
            data: {
              errors: [
                {
                  code: "VALIDATION_GATE_FAILED",
                  message: "ktx sl validate failed: measure expr is invalid"
                }
              ]
            }
          }),
          { status: 422 }
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <SemanticAssetPublishDrawer open onClose={() => undefined} />
      </Wrapper>
    );
    const textarea = await screen.findByTestId("semantic-asset-publish-paste");
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => "name: international_country_metrics\ntable: chatbi.ai_metric_international_country_daily\n"
      }
    });
    await waitFor(() => screen.getByTestId("semantic-asset-target-paths"));

    fireEvent.click(screen.getByTestId("semantic-asset-publish-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("semantic-asset-publish-blocked")).toHaveTextContent("发布被阻断")
    );
  });

  it("renders the export button as a primary action and never inlines a constructed file URL", async () => {
    const exportResponse: SemanticAssetExportResponse = {
      exportId: "exp_20260730_163000_001",
      filename: "lucy-semantic-asset-exp_20260730_163000_001.zip",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      downloadUrl: "/api/semantic-assets/exports/exp_20260730_163000_001/download",
      includedFiles: ["semantic-layer/customer-db/international_country_metrics.yaml"],
      excludedFiles: [
        { path: ".ktx/secrets", reason: "forbidden-prefix" },
        { path: ".env", reason: "forbidden-file" }
      ]
    };
    const handlers: HandlerMap = {
      "POST /api/semantic-assets/export": () =>
        new Response(
          JSON.stringify({ ok: true, data: exportResponse })
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    // Import via the test path: pulling the named export would force a circular
    // import from the page; we just render the button directly.
    const { SemanticAssetExportButton } = await import(
      "../components/semantic-assets/SemanticAssetExportButton"
    );
    render(
      <Wrapper>
        <SemanticAssetExportButton label="下载当前全量资产包 (.zip)" />
      </Wrapper>
    );
    fireEvent.click(screen.getByTestId("semantic-asset-export-button"));
    await waitFor(() => screen.getByTestId("semantic-asset-export-summary"));
    const link = screen.getByTestId("semantic-asset-export-download") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/api/semantic-assets/exports/exp_20260730_163000_001/download"
    );
    // The summary must explicitly show "Secrets 已强制排除".
    expect(screen.getByTestId("semantic-asset-export-summary")).toHaveTextContent(
      "Secrets 已强制排除"
    );
  });
});
