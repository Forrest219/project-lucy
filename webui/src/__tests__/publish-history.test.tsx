// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishHistory } from "../pages/publish/PublishHistory";
import type { SemanticAssetReleaseRecord } from "../lib/types";

function makePublishRecord(overrides: Partial<SemanticAssetReleaseRecord> = {}): SemanticAssetReleaseRecord {
  return {
    id: "rel_20260731_150000_001",
    createdAt: "2026-07-31T07:00:00.000Z",
    actor: "local-admin",
    status: "published",
    trigger: "webui_publish",
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
    diff: "Index: international_country_metrics.yaml\n+++ b/international_country_metrics.yaml\n",
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
    reindex: { ok: true, exitCode: 0, stdout: "ok", stderr: "" },
    ...overrides
  };
}

function makeFailedReindexRecord(): SemanticAssetReleaseRecord {
  return makePublishRecord({
    id: "idx_20260731_121000_002",
    createdAt: "2026-07-31T04:10:00.000Z",
    trigger: "webui_manual_reindex",
    status: "reindex_failed",
    connectionIds: [],
    files: [],
    changedSources: [],
    diff: undefined,
    reindex: {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "ktx admin reindex failed: database not reachable"
    }
  });
}

function renderHistory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublishHistory />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // Publish history talks to GET /api/semantic-assets/releases; the export
  // button triggers POST /api/semantic-assets/export. Tests that exercise
  // the export click override these handlers as needed.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/semantic-assets/releases") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: { records: [makePublishRecord(), makeFailedReindexRecord()] }
          })
        );
      }
      if (url === "/api/semantic-assets/export" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              exportId: "exp_20260731_150500_003",
              filename: "lucy-semantic-asset-exp_20260731_150500_003.zip",
              sizeBytes: 1024,
              sha256: "0".repeat(64),
              downloadUrl: "/api/semantic-assets/exports/exp_20260731_150500_003/download",
              includedFiles: ["semantic-layer/customer-db/international_country_metrics.yaml"],
              excludedFiles: []
            }
          })
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
        { status: 404 }
      );
    })
  );
});

describe("PublishHistory", () => {
  it("renders the publish history and audit page header", async () => {
    renderHistory();
    expect(
      screen.getByRole("heading", { name: "发布历史与审计" })
    ).toBeInTheDocument();
  });

  it("renders the audit table with the WebUI publish and manual reindex rows", async () => {
    renderHistory();
    const table = await screen.findByTestId("publish-history-table");
    expect(table).toHaveClass("pl-data-grid");
    expect(screen.getByRole("columnheader", { name: "#" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "变更范围" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "规模" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "动作/快照" })).not.toBeInTheDocument();

    expect(await screen.findByText("WebUI 发布")).toBeInTheDocument();
    expect(screen.getByText("WebUI 强制重建索引")).toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();

    const serials = screen.getAllByTestId("publish-history-serial");
    expect(serials[0]).toHaveTextContent("1");
    expect(serials[1]).toHaveTextContent("2");

    expect(screen.getByText("customer-db")).toBeInTheDocument();
    expect(screen.getByText("international_country_metrics")).toBeInTheDocument();
    expect(screen.getByText(/文件 1 · 语义源 1/)).toBeInTheDocument();
    expect(screen.getByText("全库索引重建（无资产变更）")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "查看 Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看错误" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "下载当前快照" })).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "导出当前语义资产包 (.zip)" })
    ).toBeInTheDocument();
  });

  it("expands the diff panel when 查看 Diff is clicked", async () => {
    renderHistory();
    const toggle = await screen.findByRole("button", { name: "查看 Diff" });
    fireEvent.click(toggle);
    expect(
      await screen.findByTestId("publish-history-expanded-panel")
    ).toHaveTextContent("Index: international_country_metrics.yaml");
    expect(screen.getByRole("button", { name: "收起 Diff" })).toBeInTheDocument();
  });

  it("expands the error panel when 查看错误 is clicked", async () => {
    renderHistory();
    const toggle = await screen.findByRole("button", { name: "查看错误" });
    fireEvent.click(toggle);
    const panel = await screen.findByTestId("publish-history-expanded-panel");
    expect(panel).toHaveTextContent("ktx admin reindex failed");
    expect(screen.getByRole("button", { name: "收起错误" })).toBeInTheDocument();
  });

  it("renders the empty state when no records exist", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/semantic-assets/releases") {
          return new Response(JSON.stringify({ ok: true, data: { records: [] } }));
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );
    renderHistory();
    expect(await screen.findByTestId("publish-history-empty")).toBeInTheDocument();
  });

  it("treats records missing the trigger field as WebUI 发布 for backwards compatibility", async () => {
    vi.unstubAllGlobals();
    const legacy = makePublishRecord();
    delete (legacy as { trigger?: string }).trigger;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/semantic-assets/releases") {
          return new Response(
            JSON.stringify({ ok: true, data: { records: [legacy] } })
          );
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );
    renderHistory();
    expect(await screen.findByText("WebUI 发布")).toBeInTheDocument();
  });

  it("exposes a 查看错误 action for blocked publish records and surfaces validation issues", async () => {
    vi.unstubAllGlobals();
    const blocked = makePublishRecord({
      id: "rel_20260731_140000_blocked",
      createdAt: "2026-07-31T06:00:00.000Z",
      trigger: "webui_publish",
      status: "blocked",
      reindex: undefined,
      validation: {
        ok: false,
        results: [
          {
            connectionId: "customer-db",
            sourceName: "superstore_orders",
            ok: false,
            exitCode: 1,
            stderr: "ktx sl validate failed",
            issues: [
              {
                message: "measure expr is invalid",
                filePath: "semantic-layer/customer-db/superstore_orders.yaml",
                line: 42,
                column: 7
              }
            ]
          }
        ]
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/semantic-assets/releases") {
          return new Response(JSON.stringify({ ok: true, data: { records: [blocked] } }));
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );
    renderHistory();
    // Two buttons (the row toggle + the header one) — at least one exists.
    const toggle = await screen.findByRole("button", { name: "查看错误" });
    fireEvent.click(toggle);
    const panel = await screen.findByTestId("publish-history-expanded-panel");
    expect(panel).toHaveTextContent("发布被阻断");
    expect(panel).toHaveTextContent("measure expr is invalid");
    expect(panel).toHaveTextContent("superstore_orders.yaml");
    expect(screen.getByRole("button", { name: "收起错误" })).toBeInTheDocument();
  });

  it("exposes a 查看错误 action for promote_failed records and links back to the gate", async () => {
    vi.unstubAllGlobals();
    const promoteFailed = makePublishRecord({
      id: "rel_20260731_141000_promote_failed",
      createdAt: "2026-07-31T06:10:00.000Z",
      trigger: "webui_publish",
      status: "promote_failed",
      reindex: undefined,
      validation: {
        ok: false,
        results: [
          {
            connectionId: "customer-db",
            sourceName: "orders",
            ok: false,
            exitCode: 2,
            issues: [{ message: "rename collision" }]
          }
        ]
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/semantic-assets/releases") {
          return new Response(JSON.stringify({ ok: true, data: { records: [promoteFailed] } }));
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );
    renderHistory();
    const toggle = await screen.findByRole("button", { name: "查看错误" });
    fireEvent.click(toggle);
    const panel = await screen.findByTestId("publish-history-expanded-panel");
    expect(panel).toHaveTextContent("Promote 失败");
    expect(panel).toHaveTextContent("rename collision");
  });

  it("exposes a 查看错误 action when validation.ok is false even if status is not blocked", async () => {
    vi.unstubAllGlobals();
    const partialFailure = makePublishRecord({
      id: "rel_20260731_142000_partial",
      createdAt: "2026-07-31T06:20:00.000Z",
      trigger: "webui_publish",
      // The status here is a legacy / non-canonical state; the audit page
      // should still surface the validation failure so the row is auditable.
      status: "reindexing",
      reindex: { ok: true, exitCode: 0, stdout: "ok", stderr: "" },
      validation: {
        ok: false,
        results: [
          {
            connectionId: "customer-db",
            sourceName: "orders",
            ok: false,
            exitCode: 1,
            issues: [{ message: "secondary validation gap" }]
          }
        ]
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/semantic-assets/releases") {
          return new Response(JSON.stringify({ ok: true, data: { records: [partialFailure] } }));
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );
    renderHistory();
    const toggle = await screen.findByRole("button", { name: "查看错误" });
    fireEvent.click(toggle);
    const panel = await screen.findByTestId("publish-history-expanded-panel");
    expect(panel).toHaveTextContent("校验失败");
    expect(panel).toHaveTextContent("secondary validation gap");
  });

  it("renders the in-progress label for reindexing status rows", async () => {
    vi.unstubAllGlobals();
    const inflight = makePublishRecord({
      id: "rel_20260731_150000_inflight",
      status: "reindexing",
      trigger: "webui_publish",
      reindex: undefined
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/semantic-assets/releases") {
          return new Response(
            JSON.stringify({ ok: true, data: { records: [inflight] } })
          );
        }
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
          { status: 404 }
        );
      })
    );
    renderHistory();
    const reindexBadge = await screen.findByTestId("publish-history-reindex-status");
    expect(reindexBadge).toHaveTextContent("进行中");
  });

  it("shows the loading and error states gracefully", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "BOOM", message: "无法连接历史 sidecar" } }),
          { status: 500 }
        );
      })
    );
    renderHistory();
    await waitFor(() =>
      expect(
        screen.getByText("发布历史加载失败：无法连接历史 sidecar")
      ).toBeInTheDocument()
    );
  });
});
