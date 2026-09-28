# PageHeader Context Dedup Spec

| Metadata | Value |
|---|---|
| Spec | 159 |
| Version | v1.0 |
| Date | 2026-09-28 |
| Status | Implemented |
| Routes | `/admin/agents/:id`, `/eval/monitor`, `/eval/cases`, `/eval/cases/:domain/:caseId`, `/eval/runs/:id`, `/publish/workbench` |
| Supersedes | Spec 91 §3 exceptions for `/eval/monitor` and `/publish/workbench` PageHeader badges |

## 1. Decision

PageHeader context must not repeat information that is already visible in the page's primary workspace, summary metrics, or adjacent controls. This change is limited to six confirmed duplicate surfaces and does not change the shared `PageHeader` component.

| Route | PageHeader after this change | Authoritative body source |
|---|---|---|
| `/admin/agents/:id` | No badges | Basic information, Token, and permission-preview tabs |
| `/eval/monitor` | No badges | Domain selector, time-window control, and metric cards |
| `/eval/cases` | No badges | Latest completed run metric cards |
| `/eval/cases/:domain/:caseId` | No badges | Domain and `case_type` fields in the metadata form |
| `/publish/workbench` | No badges | Change queue, activation pipeline, and validation summary |
| `/eval/runs/:id` | Run status only | Domain and pass rate in the run summary |

## 2. Non-Goals

- Do not change Help, connection testing, Role detail, Agent list, or call monitoring headers.
- Do not change `PageHeader` props, styles, layout, or accessibility implementation.
- Do not change APIs, data models, routes, permission behavior, publishing gates, or Token calculations.
- Do not add browser automation or mobile-layout validation.

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Existing protected technical identifiers remain unchanged in their authoritative body locations.

## 4. Design System Compliance

- Follows `webui/docs/design-system/20-patterns-page-layout.md`: PageHeader contains page identity and global actions; summary and task state remain in the Summary Region or Primary Workspace.
- Follows `webui/docs/42-page-header-standardization-spec.md`: the shared component contract remains unchanged.
- Revises `webui/docs/91-list-page-header-consistency-spec.md` §3 only where it excluded `/eval/monitor` filter-context badges and `/publish/workbench` workflow-state badges from deduplication.

## 5. Accessibility

- Removing repeated header text shortens the reading order before the primary task.
- The remaining controls and body summaries retain their existing labels and semantics.
- Run status remains available in the Run detail PageHeader; no unique status information is removed.

## 6. Acceptance Criteria

1. Agent detail, Eval monitor, Case list, Case editor, and Publish workbench do not render `page-header-badges`.
2. Run detail renders a single status badge and does not repeat domain or pass rate in the header.
3. Each removed value remains available in its authoritative body control, field, card, panel, or tab.
4. Publish validation success, failure, zero-table handling, and synchronization gates behave unchanged.
5. Focused tests, terminology lint, IA-boundary lint, and the production build pass.
