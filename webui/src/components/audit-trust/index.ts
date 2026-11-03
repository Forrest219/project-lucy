/**
 * audit-trust-2026-10-19-r1 / T05d — audit-trust components barrel.
 *
 * All audit-trust UI components for the WebUI Audit page surface here. The
 * Audit page itself (`webui/src/pages/admin/Audit.tsx`) is currently a
 * sibling dirty file outside the audit-trust commit scope; integration of
 * these components into Audit.tsx is the Audit.tsx owner's task. The barrel
 * keeps the integration surface narrow.
 *
 * Contract §5.2 components:
 *   - AuditStatusTriad         (item 1) — execution / association / coverage badges
 *   - CredentialPrincipalCell  (item 3) — userId display + copy + hint
 *   - AssociationRevisionTimeline (item 4) — original + effective + history
 *   - ClientCoveragePill       (item 5) — controlled-client coverage state
 *   - ReadonlySqlRowset        (item 6) — rows + cols + bytes + usability label
 *
 * AuditTopMetaBar (item 2) removed 2026-11-01: window/zone/stats/lag/refresh
 * no longer shown on /admin/audit; pause + projection lag remain on PageHeader.
 */

export { AuditStatusTriad } from "./AuditStatusTriad";
export type {
  AuditStatusTriadProps,
  ExecutionAxis,
  AssociationAxis,
  CoverageAxis
} from "./AuditStatusTriad";

export { CredentialPrincipalCell } from "./CredentialPrincipalCell";
export type { CredentialPrincipalCellProps } from "./CredentialPrincipalCell";

export { AssociationRevisionTimeline } from "./AssociationRevisionTimeline";
export type {
  AssociationRevisionTimelineProps,
  AssociationRevisionTimelineItem
} from "./AssociationRevisionTimeline";

export { ClientCoveragePill } from "./ClientCoveragePill";
export type { ClientCoveragePillProps } from "./ClientCoveragePill";

export { ReadonlySqlRowset } from "./ReadonlySqlRowset";
export type {
  ReadonlySqlRowsetProps,
  ReadonlySqlRowsetStatus
} from "./ReadonlySqlRowset";