// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestoreReleaseDrawer } from "../components/semantic-assets/RestoreReleaseDrawer";

vi.mock("../lib/apiClient", () => ({
  apiPost: vi.fn()
}));

import { apiPost } from "../lib/apiClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const READY_PREVIEW = {
  previewId: "prv_1",
  sourceReleaseId: "rel_source",
  snapshotId: "snap_1",
  planDigest: "digest_1",
  expiresAt: "2026-10-30T16:00:00.000Z",
  verdict: "ready" as const,
  conflicts: [],
  targets: [
    {
      targetPath: "semantic-layer/demo/orders.yaml",
      assetKind: "overlay" as const,
      action: "restore_bytes" as const,
      currentDigest: "a".repeat(64),
      expectedCurrentDigest: "a".repeat(64),
      restoredDigest: "b".repeat(64),
      siblingCurrentDigest: "a".repeat(64)
    }
  ],
  reindexMode: "incremental" as const,
  semanticDeletionSet: [],
  readbackExpectations: [],
  mirrorSyncWriteSet: [],
  fullIndexScope: ["semantic-layer/demo/orders.yaml"],
  knownPending: [],
  unknownCoverage: 0.5,
  noChange: false
};

describe("RestoreReleaseDrawer", () => {
  it("previews a batch and submits only the preview id, plan digest and idempotency key", async () => {
    vi.mocked(apiPost)
      .mockResolvedValueOnce(READY_PREVIEW)
      .mockResolvedValueOnce({ release: { id: "rel_restore" } });
    render(
      <RestoreReleaseDrawer
        releaseId="rel_source"
        createdAt="2026-10-30T15:00:00.000Z"
        actor="local-admin"
        onClose={() => undefined}
      />
    );
    expect(screen.getByText("恢复到本批次发布前。这会生成一条新的发布记录，原来的记录保持不变。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复预检" }));
    await screen.findByTestId("restore-preview-targets");
    fireEvent.click(screen.getByTestId("restore-release-confirm"));
    await waitFor(() => {
      expect(apiPost).toHaveBeenLastCalledWith(
        "/api/semantic-assets/releases/rel_source/restore",
        {
          previewId: "prv_1",
          planDigest: "digest_1",
          idempotencyKey: "prv_1"
        }
      );
    });
    expect(screen.getByText("rel_restore")).toBeInTheDocument();
  });

  it("separates the restore targets, the index scope and the mirror sync write set", async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({
      ...READY_PREVIEW,
      reindexMode: "force",
      semanticDeletionSet: [{ connectionId: "demo", schema: "shop", table: "orders" }],
      readbackExpectations: [
        {
          kind: "table_gone",
          table: { connectionId: "demo", schema: "shop", table: "orders" }
        }
      ],
      mirrorSyncWriteSet: [
        {
          contentRelPath: "semantic-layer/demo/other.yaml",
          siblingRelPath: "semantic-layer/demo/other.yaml",
          contentDigest: "c".repeat(64),
          siblingDigest: null
        }
      ],
      fullIndexScope: [
        "semantic-layer/demo/orders.yaml",
        "semantic-layer/demo/other.yaml"
      ],
      knownPending: ["semantic-layer/demo/other.yaml"],
      unknownCoverage: 0.5
    });
    render(
      <RestoreReleaseDrawer
        releaseId="rel_source"
        createdAt="2026-10-30T15:00:00.000Z"
        actor="local-admin"
        onClose={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "恢复预检" }));
    await screen.findByTestId("restore-preview-targets");

    // Three separate areas, not one merged "sync" claim.
    expect(screen.getByTestId("restore-preview-index-scope")).toBeInTheDocument();
    expect(screen.getByTestId("restore-preview-mirror-sync-write-set")).toBeInTheDocument();

    // The mirror sync write set says who writes it and in which direction.
    expect(
      screen.getByText(/这些文件不由本次恢复写入。它们是内容根与 ktx 视图之间已有的差异，变化方向是镜像向内容根对齐。/)
    ).toBeInTheDocument();
    expect(screen.getAllByText("semantic-layer/demo/other.yaml").length).toBeGreaterThan(0);

    // The index mode is visible before the operator confirms.
    expect(screen.getByText("索引模式：强制重建（存在语义删除）")).toBeInTheDocument();

    // The delete direction readback is classified, not blanket "the table is gone".
    expect(screen.getAllByText("demo/shop/orders").length).toBeGreaterThan(0);
    expect(screen.getByTestId("restore-preview-readback")).toHaveTextContent("整表不可检索、不可读取");

    // The unknown coverage is disclosed, not rendered as an empty list.
    expect(screen.getByText(/无法逐文件确认的内容也可能被本次索引纳入/)).toBeInTheDocument();
  });

  it("does not offer a confirm action when every target is already at its pre-batch state", async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ ...READY_PREVIEW, noChange: true });
    render(
      <RestoreReleaseDrawer
        releaseId="rel_source"
        createdAt="2026-10-30T15:00:00.000Z"
        actor="local-admin"
        onClose={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "恢复预检" }));
    await screen.findByTestId("restore-preview-targets");
    expect(screen.getByTestId("restore-release-confirm")).toBeDisabled();
    expect(screen.getByText("所选批次的发布前内容已经就位，没有需要恢复的差异。")).toBeInTheDocument();
  });
});
