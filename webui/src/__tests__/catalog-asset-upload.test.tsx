// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogAssetUploadButton } from "../components/catalog/CatalogAssetUploadButton";
import { CatalogAssetUploadDrawer } from "../components/catalog/CatalogAssetUploadDrawer";
import type {
  CatalogAssetUploadRecord,
  CatalogAssetUploadResponse,
  CatalogAssetValidateResponse
} from "../lib/types";
import { assertNoForbiddenTerms } from "./forbidden-terms";

type Handler = (body: unknown, init?: RequestInit) => Response | Promise<Response>;
type HandlerMap = Record<string, Handler>;

function stubFetch(handlers: HandlerMap) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const key = `${method} ${url.replace(/^http:\/\/[^/]+/, "")}`;
    const handler = handlers[key] ?? handlers[`${method} ${url}`];
    if (!handler) {
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
        { status: 404 }
      );
    }
    return handler(body, init);
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

function makeValidateResponse(overrides: Partial<CatalogAssetValidateResponse> = {}): CatalogAssetValidateResponse {
  return {
    valid: true,
    connectionId: "demo-mysql",
    schema: "openclaw_db",
    assetType: "schemaManifest",
    targetPath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
    exists: false,
    originalFilename: "openclaw_db.yaml",
    sizeBytes: 48,
    sha256: "0".repeat(64),
    tables: 1,
    tableNames: ["customers"],
    warnings: [],
    errors: [],
    ...overrides
  };
}

function makeUploadResponse(
  recordOverrides: Partial<CatalogAssetUploadRecord> = {}
): CatalogAssetUploadResponse {
  return {
    uploaded: true,
    record: {
      id: "up_20260729_103000_001",
      createdAt: "2026-07-29T02:30:00.000Z",
      connectionId: "demo-mysql",
      schema: "openclaw_db",
      assetType: "schemaManifest",
      targetPath: "semantic-layer/demo-mysql/_schema/openclaw_db.yaml",
      originalFilename: "openclaw_db.yaml",
      sizeBytes: 48,
      sha256: "0".repeat(64),
      tables: 1,
      overwritten: false,
      warnings: [],
      reloadRunId: "rel_20260729_103000_001",
      ...recordOverrides
    },
    validation: makeValidateResponse(),
    reload: {
      id: "rel_20260729_103000_001",
      status: "success",
      startedAt: "2026-07-29T02:30:00.000Z",
      finishedAt: "2026-07-29T02:30:00.045Z",
      durationMs: 45,
      requestedConnectionId: "demo-mysql",
      requestedSchema: "openclaw_db",
      connectionIds: ["demo-mysql"],
      connections: 1,
      configuredSchemas: 2,
      manifestSchemas: 2,
      tables: 1,
      enabledTables: 1,
      warnings: [],
      source: "static-yaml"
    }
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CatalogAssetUploadButton + CatalogAssetUploadDrawer", () => {
  it("renders the button with the default label and opens the drawer on click", async () => {
    stubFetch({});
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadButton connectionId="demo-mysql" />
      </Wrapper>
    );

    const trigger = screen.getByRole("button", { name: "上传 YAML" });
    fireEvent.click(trigger);
    expect(await screen.findByTestId("catalog-asset-upload-drawer")).toBeInTheDocument();
  });

  it("uses the schema-specific default label when a schema is provided", async () => {
    stubFetch({});
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadButton connectionId="demo-mysql" schema="openclaw_db" />
      </Wrapper>
    );
    expect(
      screen.getByRole("button", { name: "上传该 Schema 的 YAML" })
    ).toBeInTheDocument();
  });

  it("triggers validate on textarea paste without selecting a file", async () => {
    const handlers: HandlerMap = {
      "POST /api/catalog/assets/validate": () =>
        new Response(JSON.stringify({ ok: true, data: makeValidateResponse() }))
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadButton connectionId="demo-mysql" schema="openclaw_db" />
      </Wrapper>
    );
    fireEvent.click(screen.getByRole("button", { name: "上传该 Schema 的 YAML" }));

    const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
    fireEvent.change(textarea, {
      target: { value: "tables:\n  customers:\n    table: openclaw_db.customers\n" }
    });
    await waitFor(() => {
      expect(screen.getByTestId("catalog-asset-target-path")).toHaveTextContent(
        "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"
      );
    });
    expect(screen.getByTestId("catalog-asset-validation-panel")).toHaveTextContent("1");
  });

  it("shows the overwrite checkbox and disables the upload action when the target exists", async () => {
    const handlers: HandlerMap = {
      "POST /api/catalog/assets/validate": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeValidateResponse({ exists: true, warnings: [{ code: "TARGET_EXISTS", message: "已存在" }] })
          })
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadButton connectionId="demo-mysql" schema="openclaw_db" />
      </Wrapper>
    );
    fireEvent.click(screen.getByRole("button", { name: "上传该 Schema 的 YAML" }));
    const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
    fireEvent.change(textarea, { target: { value: "tables: {}\n" } });
    await waitFor(() => screen.getByTestId("catalog-asset-upload-confirm-overwrite"));

    const confirmCheckbox = screen.getByTestId(
      "catalog-asset-upload-confirm-overwrite"
    ) as HTMLInputElement;
    const uploadBtn = screen.getByTestId("catalog-asset-upload-submit") as HTMLButtonElement;
    expect(confirmCheckbox).toBeInTheDocument();
    expect(uploadBtn).toBeDisabled();
    fireEvent.click(confirmCheckbox);
    expect(uploadBtn).not.toBeDisabled();
  });

  it("uploads, shows the success summary, and the primary action navigates to the whitelist", async () => {
    const handlers: HandlerMap = {
      "POST /api/catalog/assets/validate": () =>
        new Response(JSON.stringify({ ok: true, data: makeValidateResponse() })),
      "POST /api/catalog/assets/upload": () =>
        new Response(JSON.stringify({ ok: true, data: makeUploadResponse() })),
      "GET /api/catalog/asset-uploads": () =>
        new Response(
          JSON.stringify({ ok: true, data: { records: [], lastBySchema: {} } })
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper(["/connections"]);
    const onClose = vi.fn();
    render(
      <Wrapper>
        <CatalogAssetUploadDrawer
          open
          onClose={onClose}
          connectionId="demo-mysql"
          schema="openclaw_db"
        />
      </Wrapper>
    );

    const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
    fireEvent.change(textarea, {
      target: { value: "tables:\n  customers:\n    table: openclaw_db.customers\n" }
    });
    await waitFor(() => screen.getByTestId("catalog-asset-target-path"));

    fireEvent.click(screen.getByTestId("catalog-asset-upload-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("catalog-asset-upload-success")).toBeInTheDocument();
    });
    const primary = screen.getByTestId("catalog-asset-upload-primary");
    expect(primary).toHaveAttribute("href", "/connections/whitelist?schema=openclaw_db");
    expect(screen.getByTestId("catalog-asset-upload-secondary")).toBeInTheDocument();
  });

  it("shows structured errors and disables the upload action when validation fails", async () => {
    const handlers: HandlerMap = {
      "POST /api/catalog/assets/validate": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: makeValidateResponse({
              valid: false,
              errors: [{ code: "YAML_PARSE_FAILED", message: "第 14 行缩进错误" }],
              tableNames: [],
              tables: 0
            })
          })
        )
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadDrawer
          open
          onClose={vi.fn()}
          connectionId="demo-mysql"
          schema="openclaw_db"
        />
      </Wrapper>
    );
    const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
    fireEvent.change(textarea, { target: { value: ":\n: broken [\n" } });
    await waitFor(() =>
      expect(screen.getByTestId("catalog-asset-validation-panel")).toHaveTextContent(
        "YAML_PARSE_FAILED"
      )
    );
    const uploadBtn = screen.getByTestId("catalog-asset-upload-submit") as HTMLButtonElement;
    expect(uploadBtn).toBeDisabled();
  });

  it("disables upload when YAML changes after a successful validation", async () => {
    const handlers: HandlerMap = {
      "POST /api/catalog/assets/validate": () =>
        new Response(JSON.stringify({ ok: true, data: makeValidateResponse() })),
      "POST /api/catalog/assets/upload": () =>
        new Response(JSON.stringify({ ok: true, data: makeUploadResponse() }))
    };
    stubFetch(handlers);
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadDrawer
          open
          onClose={vi.fn()}
          connectionId="demo-mysql"
          schema="openclaw_db"
        />
      </Wrapper>
    );

    const prefix = "#".repeat(70);
    const first = `${prefix}\ntables:\n  customers:\n    table: openclaw_db.customers\n`;
    const second = `${prefix}\ntables:\n  accounts_:\n    table: openclaw_db.accounts_\n`;
    expect(first.length).toBe(second.length);
    expect(first.slice(0, 64)).toBe(second.slice(0, 64));

    const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
    fireEvent.change(textarea, { target: { value: first } });
    await waitFor(() => screen.getByTestId("catalog-asset-target-path"));
    const uploadBtn = screen.getByTestId("catalog-asset-upload-submit") as HTMLButtonElement;
    expect(uploadBtn).not.toBeDisabled();

    fireEvent.change(textarea, { target: { value: second } });
    expect(uploadBtn).toBeDisabled();
  });

  it("does not introduce a Monaco dependency", async () => {
    stubFetch({});
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadButton connectionId="demo-mysql" schema="openclaw_db" />
      </Wrapper>
    );
    fireEvent.click(screen.getByRole("button", { name: "上传该 Schema 的 YAML" }));
    const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
    // MVP uses a plain <textarea>; assert tag name to guard against future
    // accidental Monaco introduction.
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("M21: drawer uses Schema Manifest title, 目标 Schema label, legal YAML placeholder, exact filename display, and no machine-translation artifacts", async () => {
    stubFetch({});
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <CatalogAssetUploadDrawer
          open
          onClose={vi.fn()}
          connectionId="demo-mysql"
          schema="openclaw_db"
        />
      </Wrapper>
    );

    const drawer = await screen.findByTestId("catalog-asset-upload-drawer");
    expect(within(drawer).getByRole("heading", { name: /Schema Manifest/i })).toBeInTheDocument();
    expect(within(drawer).getByText(/目标 Schema/)).toBeInTheDocument();
    expect(within(drawer).queryByText("目标架构")).not.toBeInTheDocument();
    expect(within(drawer).queryByText("目标模式")).not.toBeInTheDocument();
    expect(within(drawer).queryByText("模式清单")).not.toBeInTheDocument();

    const textarea = within(drawer).getByTestId("catalog-asset-upload-textarea") as HTMLTextAreaElement;
    expect(textarea.placeholder).toContain("tables:");
    expect(textarea.placeholder).toContain("openclaw_db.customers");
    expect(textarea.placeholder).not.toMatch(/表:|客户:/);

    // Close button is single-line and does not split into a vertical stack.
    const closeBtn = within(drawer).getByRole("button", { name: "关闭" });
    expect(closeBtn.className).toMatch(/pl-drawer-close/);
    const closeStyles = window.getComputedStyle(closeBtn);
    expect(closeStyles.whiteSpace).not.toBe("normal");
    // Only one close button is rendered.
    expect(within(drawer).getAllByRole("button", { name: "关闭" })).toHaveLength(1);

    // Filename display is exact, with translate="no" + dir="ltr" so browser
    // translation plugins cannot corrupt the file name.
    const nameNode = within(drawer).getByText("openclaw_db.yaml");
    expect(nameNode).toBeInTheDocument();
    expect(nameNode).toHaveAttribute("translate", "no");
    expect(nameNode).toHaveAttribute("dir", "ltr");
    expect(within(drawer).queryByText("openclaw_db已.yaml")).not.toBeInTheDocument();

    assertNoForbiddenTerms(drawer);
  });
});
