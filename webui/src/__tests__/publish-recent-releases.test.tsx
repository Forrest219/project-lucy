// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishRecentReleases } from "../components/semantic-assets/PublishRecentReleases";
import type {
  SemanticAssetReleaseRecord,
  SemanticAssetReleaseStatus
} from "../lib/types";

/**
 * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.3 — the right
 * column of the publish workbench.
 *
 * The column shows RECENT ATTEMPTS. A failed or running attempt stays visible
 * and a `published` record without activation proof is never dressed up as
 * 已生效.
 */

function makeRecord(
  overrides: Partial<SemanticAssetReleaseRecord> & { id: string }
): SemanticAssetReleaseRecord {
  return {
    createdAt: "2026-10-30T08:15:00.000Z",
    actor: "tester",
    status: "published" as SemanticAssetReleaseStatus,
    trigger: "webui_publish",
    connectionIds: ["mysql-aliyun"],
    files: [],
    changedSources: [{ connectionId: "mysql-aliyun", sourceName: "superstore_orders" }],
    validation: { ok: true, results: [] },
    activationStatus: "confirmed",
    ...overrides
  };
}

function renderColumn(props: {
  records?: SemanticAssetReleaseRecord[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  return render(
    <MemoryRouter>
      <PublishRecentReleases
        records={props.records ?? []}
        isLoading={props.isLoading ?? false}
        error={props.error ?? null}
        onRetry={props.onRetry}
      />
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PublishRecentReleases", () => {
  it("renders the section title and the records it is given", () => {
    renderColumn({
      records: [
        makeRecord({ id: "rel-1" }),
        makeRecord({
          id: "rel-2",
          status: "reindex_failed",
          activationStatus: "unconfirmed",
          reindex: { ok: false, exitCode: 1, stdout: "", stderr: "boom" }
        })
      ]
    });

    expect(screen.getByRole("heading", { name: "最近发布" })).toBeInTheDocument();
    const items = screen.getAllByTestId("publish-recent-release");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("发布 ID rel-1");
    expect(items[1]).toHaveTextContent("发布 ID rel-2");
    // The technical id is secondary information; the scope is the main content.
    expect(items[0]).toHaveTextContent("mysql-aliyun");
  });

  it("does not present an unconfirmed published record as 已生效", () => {
    renderColumn({
      records: [
        makeRecord({ id: "rel-confirmed", activationStatus: "confirmed" }),
        makeRecord({ id: "rel-unconfirmed", activationStatus: "unconfirmed" })
      ]
    });

    const items = screen.getAllByTestId("publish-recent-release");
    expect(items).toHaveLength(2);
    expect(
      within(items[0]).getByTestId("publish-recent-release-activation")
    ).toHaveTextContent("已生效");

    const unconfirmed = within(items[1]).getByTestId("publish-recent-release-activation");
    expect(unconfirmed).toHaveTextContent("生效状态待确认");
    expect(items[1].textContent).not.toContain("已生效");
    expect(items[1]).toHaveAttribute("data-activation", "warning");
  });

  it("renders failed and in-progress attempts as such", () => {
    renderColumn({
      records: [
        makeRecord({
          id: "rel-failed",
          status: "reindex_failed",
          activationStatus: "unconfirmed",
          reindex: { ok: false, exitCode: 2, stdout: "", stderr: "boom" }
        }),
        makeRecord({
          id: "rel-running",
          status: "reindexing",
          activationStatus: "unknown"
        })
      ]
    });

    const items = screen.getAllByTestId("publish-recent-release");
    expect(items[0]).toHaveTextContent("重建索引失败");
    expect(items[0]).toHaveTextContent("重建索引：失败");
    expect(items[1]).toHaveTextContent("重建索引中");
    expect(items[1]).toHaveTextContent("重建索引：进行中");
    // Neither attempt is dressed up as 已生效.
    expect(screen.queryByText("已生效")).not.toBeInTheDocument();
  });

  it("does not announce an empty state while loading", () => {
    renderColumn({ isLoading: true });

    expect(screen.getByTestId("publish-recent-releases-loading")).toHaveTextContent(
      "正在加载最近发布…"
    );
    expect(screen.queryByTestId("publish-recent-releases-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-recent-releases-list")).not.toBeInTheDocument();
  });

  it("shows the error and a retry control when the history request fails", () => {
    const onRetry = vi.fn();
    renderColumn({ error: new Error("历史读取失败"), onRetry });

    const errorBox = screen.getByTestId("publish-recent-releases-error");
    expect(errorBox).toHaveTextContent("最近发布加载失败：历史读取失败");
    expect(screen.queryByTestId("publish-recent-releases-empty")).not.toBeInTheDocument();

    const retry = screen.getByTestId("publish-recent-releases-retry");
    expect(retry).toHaveTextContent("重试");
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows 暂无发布记录 for an empty list", () => {
    renderColumn({ records: [] });

    expect(screen.getByTestId("publish-recent-releases-empty")).toHaveTextContent(
      "暂无发布记录"
    );
    expect(screen.queryByTestId("publish-recent-releases-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("publish-recent-releases-error")).not.toBeInTheDocument();
  });

  it("links to the complete publish history page", () => {
    renderColumn({ records: [] });

    const link = screen.getByRole("link", { name: "查看发布记录" });
    expect(link).toHaveAttribute("href", "/publish/history");
  });
});
