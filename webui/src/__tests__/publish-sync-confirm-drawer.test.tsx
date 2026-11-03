// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishSyncConfirmDrawer } from "../components/semantic-assets/PublishSyncConfirmDrawer";
import type { PublishImpact, PublishImpactReason, PublishImpactTable } from "../lib/types";

/**
 * Spec `lucy-20261030-publish-workbench-three-column-spec.md` §4.5.4 / §4.4 —
 * the 「确认同步索引并生效」 panel.
 *
 * The rules under test:
 *   - PWB-25: a failed submission keeps the panel open AND keeps the reviewed
 *     content. The operator still has to decide what to do next, so the drawer
 *     must not close and must not throw the review away.
 *   - PWB-17: focus moves to the panel title when it opens, Escape closes the
 *     panel through the SAME path as the cancel button, and the focus goes
 *     back to the element that opened it when the panel closes.
 *   - §4.5.4: a duplicate submit is impossible while the request is in flight.
 */

function makeReason(overrides: Partial<PublishImpactReason> = {}): PublishImpactReason {
  return {
    kind: "overlay_change",
    summary: "指标定义变更",
    source: "pending_disk_change",
    filePath: "semantic-layer/conn-a/a_table.yaml",
    evidenceRef: "ref-a",
    ...overrides
  };
}

function makeImpact(): PublishImpact {
  const table: PublishImpactTable = {
    identity: { connectionId: "conn-a", schema: "schema_x", table: "a_table" },
    reasons: [makeReason()]
  };
  return {
    pendingDigest: "digest-1",
    complete: true,
    counts: { files: 1, tables: 1, manifests: 0, wikiPages: 0 },
    tables: [table],
    wikiChanges: [],
    schemaChanges: [],
    relatedScope: [],
    otherChanges: [],
    unresolved: []
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type DrawerProps = {
  error?: string | null;
  isSubmitting?: boolean;
  submitDisabled?: boolean;
  baselineState?: "ready" | "uninitialized" | "needs_verification";
};

function renderDrawer(props: DrawerProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublishSyncConfirmDrawer
          open
          impact={makeImpact()}
          pendingDigest="digest-1"
          baselineState={props.baselineState ?? "ready"}
          submitDisabled={props.submitDisabled ?? false}
          isSubmitting={props.isSubmitting ?? false}
          error={props.error ?? null}
          onCancel={() => {}}
          onSubmit={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * A page-shaped harness: the drawer is opened by a button, so the focus
 * return has a real element to go back to.
 */
function renderHarness(props: DrawerProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Harness() {
    const [open, setOpen] = useState(false);
    const [cancelled, setCancelled] = useState(false);
    return (
      <>
        <button type="button" data-testid="open-drawer" onClick={() => setOpen(true)}>
          同步索引并生效
        </button>
        <span data-testid="cancel-count">{cancelled ? "1" : "0"}</span>
        <PublishSyncConfirmDrawer
          open={open}
          impact={makeImpact()}
          pendingDigest="digest-1"
          baselineState={props.baselineState ?? "ready"}
          submitDisabled={props.submitDisabled ?? false}
          isSubmitting={props.isSubmitting ?? false}
          error={props.error ?? null}
          onCancel={() => {
            setCancelled(true);
            setOpen(false);
          }}
          onSubmit={() => {}}
        />
      </>
    );
  }

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PublishSyncConfirmDrawer — PWB-25 失败保留侧栏与已核对内容", () => {
  it("keeps the panel open and the reviewed content when the submission fails", () => {
    renderDrawer({ error: "索引失败：ktx CLI 未找到" });

    // The panel is still there — a failure does NOT close it.
    expect(screen.getByTestId("publish-sync-confirm-panel")).toBeInTheDocument();

    // The error is rendered INSIDE the body, not in a toast that replaces the
    // review.
    const body = screen.getByTestId("publish-sync-confirm-body");
    const alert = screen.getByTestId("publish-sync-confirm-error");
    expect(body).toContainElement(alert);
    expect(alert).toHaveTextContent("索引失败：ktx CLI 未找到");
    expect(alert).toHaveAttribute("role", "alert");

    // The content the operator already reviewed is still there.
    expect(screen.getByTestId("publish-impact-summary")).toHaveTextContent("涉及表 1 张");
    expect(screen.getAllByTestId("publish-impact-table")).toHaveLength(1);

    // The operator can retry: the failure does not leave the button blocked.
    expect(screen.getByTestId("publish-sync-confirm-submit")).not.toBeDisabled();
  });

  it("keeps the reviewed content and the block reason when the range needs verification", () => {
    renderDrawer({ baselineState: "needs_verification" });

    expect(screen.getByTestId("publish-sync-confirm-panel")).toBeInTheDocument();
    expect(screen.getAllByTestId("publish-impact-table")).toHaveLength(1);
    expect(screen.getByTestId("publish-sync-confirm-blocked-reason")).toHaveTextContent(
      "生效基线需要核对，恢复前不能提交。"
    );
    expect(screen.getByTestId("publish-sync-confirm-submit")).toBeDisabled();
  });

  it("refuses a duplicate submit while the request is in flight", () => {
    const onSubmit = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PublishSyncConfirmDrawer
            open
            impact={makeImpact()}
            pendingDigest="digest-1"
            baselineState="ready"
            submitDisabled={false}
            isSubmitting
            error={null}
            onCancel={() => {}}
            onSubmit={onSubmit}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const submit = screen.getByTestId("publish-sync-confirm-submit");
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("处理中…");
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("PublishSyncConfirmDrawer — PWB-16 抽屉里的差异内容", () => {
  it("shows the difference of the proven version against the current content in place", async () => {
    const evidenceCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/publish-workbench/evidence")) {
          evidenceCalls.push(url);
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                kind: "diff",
                logicalPath: "semantic-layer/conn-a/a_table.yaml",
                content:
                  "--- semantic-layer/conn-a/a_table.yaml（生效版本）\n+++ semantic-layer/conn-a/a_table.yaml（当前内容）\n+  - name: extra\n"
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

    renderDrawer();

    // 证据就地展开，不另开第二个抽屉。
    fireEvent.click(screen.getByTestId("publish-impact-evidence-toggle"));

    const evidence = await screen.findByTestId("publish-impact-evidence");
    expect(evidence).toHaveTextContent("（生效版本）");
    expect(evidence).toHaveTextContent("（当前内容）");
    // `toHaveTextContent` 会归一空白，所以 diff 里的两个空格在断言里是一个。
    expect(evidence).toHaveTextContent("+ - name: extra");
    expect(evidenceCalls[0]).toContain("/api/publish-workbench/evidence?ref=ref-a");

    // 抽屉只有一个，正文仍在抽屉里。
    expect(screen.getAllByTestId("publish-sync-confirm-panel")).toHaveLength(1);
    expect(screen.getByTestId("publish-sync-confirm-body")).toContainElement(evidence);
  });
});

describe("PublishSyncConfirmDrawer — PWB-17 焦点顺序、Escape 与焦点归还", () => {
  it("moves the focus to the panel title when it opens", () => {
    renderHarness();

    const trigger = screen.getByTestId("open-drawer");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByTestId("publish-sync-confirm-title"));
  });

  it("closes through the cancel path on Escape", () => {
    renderHarness();

    fireEvent.click(screen.getByTestId("open-drawer"));
    expect(screen.getByTestId("publish-sync-confirm-panel")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    // The SAME path as the cancel button: the panel is closed and the caller
    // was notified. There is exactly ONE way to leave the panel.
    expect(screen.queryByTestId("publish-sync-confirm-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("cancel-count")).toHaveTextContent("1");
  });

  it("returns the focus to the element that opened it when it closes", () => {
    renderHarness();

    const trigger = screen.getByTestId("open-drawer");
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId("publish-sync-confirm-title"));

    fireEvent.click(screen.getByTestId("publish-sync-confirm-cancel"));

    expect(document.activeElement).toBe(trigger);
  });

  it("returns the focus to the trigger when Escape closes the panel", () => {
    renderHarness();

    const trigger = screen.getByTestId("open-drawer");
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
  });
});
