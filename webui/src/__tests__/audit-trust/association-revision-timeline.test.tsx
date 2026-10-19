// @vitest-environment jsdom
/**
 * T05c AssociationRevisionTimeline 组件测试
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  AssociationRevisionTimeline,
  type AssociationRevisionTimelineItem
} from "../../components/audit-trust/AssociationRevisionTimeline";

const baseRevision = (overrides: Partial<AssociationRevisionTimelineItem> = {}): AssociationRevisionTimelineItem => ({
  id: 1,
  ts: "2026-10-19T12:00:00Z",
  originalTurnId: "turn-1",
  effectiveTurnId: "turn-1",
  originalAssociationStatus: "session_bound",
  effectiveAssociationStatus: "confirmed",
  reason: "explicit turn validated",
  attributionRuleVersion: "v1",
  actorKind: "person",
  actorId: "admin-1",
  classificationVersion: "audit-trust-2026-10-19-r1.v1",
  ...overrides
});

describe("T05c AssociationRevisionTimeline", () => {
  it("renders empty state when no revisions", () => {
    const { container } = render(<AssociationRevisionTimeline revisions={[]} />);
    expect(container.querySelector('[data-testid="association-revision-timeline"]')?.getAttribute("data-empty")).toBe("true");
    expect(container.textContent).toContain("无修订记录");
  });

  it("renders the latest revision as the effective view", () => {
    const revisions = [
      baseRevision({ id: 2, ts: "2026-10-19T13:00:00Z", effectiveAssociationStatus: "conflict", reason: "revalidated" }),
      baseRevision({ id: 1, ts: "2026-10-19T12:00:00Z", effectiveAssociationStatus: "confirmed" })
    ];
    const { container } = render(<AssociationRevisionTimeline revisions={revisions} />);
    const effective = container.querySelector('[data-testid="association-revision-effective"]');
    expect(effective?.textContent).toContain("conflict");
    expect(effective?.textContent).toContain("revalidated");
    expect(effective?.textContent).toContain("v1");
  });

  it("lists older revisions in history <details>", () => {
    const revisions = [
      baseRevision({ id: 3, ts: "2026-10-19T13:00:00Z", effectiveAssociationStatus: "conflict" }),
      baseRevision({ id: 2, ts: "2026-10-19T12:30:00Z", effectiveAssociationStatus: "confirmed" }),
      baseRevision({ id: 1, ts: "2026-10-19T12:00:00Z", effectiveAssociationStatus: "candidate" })
    ];
    const { container } = render(<AssociationRevisionTimeline revisions={revisions} />);
    expect(container.querySelectorAll('[data-testid="association-revision-item"]')).toHaveLength(2);
    const history = container.querySelector('[data-testid="association-revision-history"]');
    expect(history?.textContent).toContain("历史修订 (2)");
  });

  it("renders original access_log row when provided", () => {
    const revisions = [baseRevision({ id: 1 })];
    const { container } = render(
      <AssociationRevisionTimeline revisions={revisions} originalFromAccessLog="session_bound" />
    );
    const orig = container.querySelector('[data-testid="association-revision-original"]');
    expect(orig?.getAttribute("data-status")).toBe("session_bound");
    expect(orig?.textContent).toContain("原始 (access_log)");
    expect(orig?.textContent).toContain("准入时记录");
  });

  it("reports the revision count via data-revision-count", () => {
    const revisions = [
      baseRevision({ id: 3 }),
      baseRevision({ id: 2 }),
      baseRevision({ id: 1 })
    ];
    const { container } = render(<AssociationRevisionTimeline revisions={revisions} />);
    expect(container.querySelector('[data-testid="association-revision-timeline"]')?.getAttribute("data-revision-count")).toBe("3");
  });

  it("shows actor info on history items", () => {
    const revisions = [
      baseRevision({ id: 3, ts: "2026-10-19T14:00:00Z", effectiveAssociationStatus: "conflict" }),
      baseRevision({ id: 2, ts: "2026-10-19T13:00:00Z", actorKind: "system", actorId: null }),
      baseRevision({ id: 1, ts: "2026-10-19T12:00:00Z", actorKind: "person", actorId: "admin-1" })
    ];
    const { container } = render(<AssociationRevisionTimeline revisions={revisions} />);
    const items = container.querySelectorAll('[data-testid="association-revision-item"]');
    expect(items.length).toBe(2); // slice(1) of 3-item list
    const item0 = items[0] as HTMLElement;
    const item1 = items[1] as HTMLElement;
    expect(item0.textContent).toContain("system:—");
    expect(item1.textContent).toContain("person:admin-1");
  });
});