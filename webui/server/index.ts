import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { parse, parseDocument } from "yaml";
import { buildProxy, getDataQaInstructionsStatus } from "./proxy/mcp-proxy.js";
import { serveStaticAsset } from "./static-assets";
import { addTiming, registerEntryPerformanceTiming, withRequestTiming } from "./entry-performance-timing";
import { displayGenerations, onDisplayGenerationChange, withDisplayWriteBarrier } from "./display-generation";
import { withKtxYamlWriteLock } from "./ktx-yaml-write-lock";
import { parseProbePurpose, ProbeScheduler, type ProbeTiming } from "./background-probes";
import {
  getDisplaySnapshot,
  prewarmDisplaySnapshots,
  registerDisplayPrewarmer,
  ensureDisplayReconciler
} from "./display-snapshot";
import { changedFiles, previewDiff, type SessionWrittenFile } from "./diff";
function makeDiff(oldText: string, newText: string): string {
  return previewDiff(oldText, newText, "ktx.yaml");
}

import {
  enabledTableError,
  patchConnectionEnabledTablesYaml,
  scannedTableCatalog,
  validateEnabledTables,
  type EnabledTableWarning
} from "./enabled-tables";
import { isSqlServerDriver, normalizeEnabledTableNames } from "../src/lib/enabled-table-identity.js";
import { joinCandidatesPath, readJoinCandidates, writeJoinCandidates, type JoinCandidate } from "./joins-sidecar";
import { formatConnectionErrorMessage } from "./connection-errors";
import { readKtxRuntimeStatus } from "./ktx-runtime";
import { resolveLucyVersion } from "./lucy-version.js";
import { loadRuntimeRevision } from "./lucy-revision.js";
import { reindexProject, validateSource, testConnection, type ValidationResult } from "./ktx";
import { applyColumnTypeContractToValidation } from "./publish-gate";
import {
  clearLiveCatalogCache,
  listLiveSchemas,
  LiveCatalogConnectionNotFoundError,
  peekLiveSchemasCache
} from "./live-catalog";
import { previewSchemaStructure, SchemaStructureError } from "./schema-structure";
import {
  addSchema,
  createConnection,
  ktxYamlWithBlockConnections,
  KtxYamlParseError,
  probeConnection,
  readConnections,
  readProject,
  resolveProjectRoot,
  removeConnection,
  removeSchema
} from "./project";
import { loadContentPaths, resolveContentPaths } from "./paths";
import { collectContentLayout, mirrorOnlySemanticRelPaths } from "./content-layout";
import { buildSemanticModelIndex } from "./semantic-identity";
import {
  // Ingest sidecar is M13 legacy. M14 keeps the helpers for the deprecated
  // `/api/connections/:connId/ingest` alias compatibility route.
  readIngestRuns as readLegacyIngestRuns,
  type IngestRunsResponse
} from "./ingest-runs";
import {
  reloadCatalog,
  readCatalogReloads,
  type CatalogReloadsResponse
} from "./catalog-reload";
import {
  CatalogAssetOverwriteRequiredError,
  CatalogAssetReadError,
  CatalogAssetValidationError,
  readCatalogAssetUploads,
  readCatalogSchemaManifest,
  uploadCatalogAsset,
  validateCatalogAsset,
  type CatalogSchemaManifestReadRequest,
  type CatalogAssetUploadRequest,
  type CatalogAssetValidateRequest
} from "./catalog-assets";
import type { TablePatch } from "./model";
import {
  listSourcesWithManifests,
  sourcesDisplayMeta,
  type SourcesDisplayMeta,
  previewSourcePatch,
  previewSourceYamlImport,
  readChangedSourceColumnContracts,
  readSource,
  writeSourcePatch,
  writeSourceYamlImport
} from "./semantic-layer";
import {
  createTableYamlVersionSnapshot,
  listTableYamlVersions,
  previewTableYamlVersionRestore,
  readTableYamlVersion,
  restoreTableYamlVersionDraft
} from "./table-yaml-history";
import {
  createWikiDirectory,
  commitWikiUpload,
  deleteWiki,
  deleteWikiDirectory,
  listWiki,
  listWikiDirectories,
  listWikiVersions,
  moveWiki,
  previewWikiDirectoryRename,
  previewWikiMove,
  previewWikiUpload,
  previewWikiVersionRestore,
  previewWikiWrite,
  readWiki,
  readWikiVersion,
  renameWikiDirectory,
  restoreWikiVersion,
  writeWiki,
  type WikiDirectoryCreateInput,
  type WikiDirectoryRenameInput,
  type WikiMoveInput,
  type WikiUploadInput,
  type WikiWriteInput
} from "./wiki";
import { FRONTMATTER_ENGINE_FORBIDDEN } from "./markdown-frontmatter";
import {
  readHelpDiagram,
  readHelpHandbook,
  searchHelpHandbook
} from "./help.js";
import { registerAgentRoutes } from "./admin/agents.js";
import { registerRoleRoutes } from "./admin/roles.js";
import { registerTokenRoutes } from "./admin/tokens.js";
import { registerPolicyRuntimeRoutes } from "./admin/policy-runtime.js";
import { getPolicyRuntimeStatus, isPolicyRuntimeHealthy, runtimeConsistencyForInputs, type DisplayPolicyInputs } from "./proxy/acl.js";
import { getAuditDb, recordConfigChange, registerAgentAuditRoutes, registerAuditRoutes } from "./admin/audit.js";
import { registerAuditReconciliationRoutes } from "./admin/audit-reconciliation-routes.js";
import { configureReconciliationPorts } from "./admin/reconciliation.js";
import {
  createProductionAuditCoveragePort,
  productionPrimaryStatusPort
} from "./admin/reconciliation-ports.js";
import { registerRowPolicyRoutes } from "./admin/row-policy-routes.js";
// Lucy v0.25 / L25-14 R1 — 行策略模板与按表反查（P1-1）。
import { registerRowPolicyTemplateRoutes } from "./admin/routes/row-policy.js";
// Lucy v0.25 / L25-01 — Agent 与角色授权摘要（P1-2）。
import { registerAuthorizationSummaryRoutes } from "./admin/routes/authorization-summary.js";
// Lucy v0.25 / L25-08 — 访问关系图（P1-3）。
import { registerAccessMapRoutes } from "./admin/routes/access-map.js";
// Lucy v0.25 / L25-10 — Hive 直连的配置面（P1-4，仅编译侧）。
import { registerHiveConnectionRoutes } from "./admin/routes/hive.js";
import { auditedWriteFile } from "./admin/config-audit-write.js";
import { registerMcpToolsRoutes } from "./admin/mcp-tools.js";
import { registerMcpPlaygroundRoutes } from "./admin/mcp-playground.js";
import {
  readMcpRuntimeStatus,
  registerMcpRuntimeRoutes,
  runMcpRuntimeCanary
} from "./admin/mcp-runtime.js";
import { markExecutionRuntimePending } from "./admin/mcp-runtime-reload.js";
import { readKtxYamlDigest } from "./mcp-runtime-state.js";
import { registerRiskReviewRoutes } from "./admin/risk-review.js";
import { registerReleaseReadinessRoutes } from "./admin/release-readiness-package.js";
import { removeLegacyLicenseFile } from "./remove-legacy-license-file.js";
import { registerImportScopeRoutes } from "./admin/import-scope.js";
import { registerLiveDiscoveryRoutes } from "./admin/live-discovery.js";
import { startDiscoveryWorker } from "./live-table-worker.js";
import { registerGovernanceObservabilityRoutes } from "./admin/governance-observability.js";
import { registerUiUsageRoutes } from "./admin/ui-usage.js";
import { registerAuthRoutes, registerAdminAccountRoutes } from "./auth/routes.js";
import { registerOidcRoutes } from "./auth/oidc-routes.js";
import { registerBrandingRoutes } from "./branding.js";
import { actorIdFromRequest, requireWebuiAuthHook } from "./auth/guard.js";
import { auditActorFields, trustedActorFromRequest } from "./security/request-actor.js";
import { assertStartupPolicy, resolveCookieSecure } from "./auth/deployment-mode.js";
import { reconcileBootstrapOnStartup } from "./auth/bootstrap.js";
import { closeSecurityStore, getSecurityStore } from "./security/instance.js";
import {
  getWikiAccessSummary,
  previewWikiAccess,
  saveWikiAccess
} from "./wiki-access.js";
import {
  commitWikiAccessBatch,
  getWikiAccessBatchResult,
  previewWikiAccessBatch
} from "./wiki-access-batch.js";
import { loadWikiAccessConfigSnapshot } from "./wiki-access-effects.js";
import { recoverWikiAccessOperations } from "./wiki-access-recovery.js";
import { recoverInterruptedOperations } from "./security/ledger.js";
import { AUDIT_PROJECTOR_NAME, createProjectionScheduler, readTargetCursor } from "./security/projector.js";
import { recoverProjectionCursor } from "./security/recovery.js";
import { recordProjectionStatus } from "./proxy/audit-write-health.js";
import { registerWebSecurity } from "./web-security.js";
import { registerSkillsRoutes } from "./admin/skills.js";
import { registerNotificationRoutes } from "./admin/notifications.js";
import { initNotifications } from "./notifications/init.js";
import { registerCaseRoutes } from "./eval/cases.js";
import { registerSecurityCandidateRoutes } from "./eval/security-candidates.js";
import { registerSuiteImportRoutes } from "./eval/suite-import.js";
import { registerRunnerRoutes } from "./eval/runner.js";
import { registerMonitorRoutes } from "./eval/monitor.js";
import { registerFieldQuestionRoutes } from "./eval/field-questions.js";
import { registerR1ObservabilityRoutes } from "./observability.js";
import { registerCallMonitorRoutes } from "./ops/call-monitor.js";
import { safeWrite } from "./fs-safe.js";
import { isPublishCoordinatorBusy, withPublishCoordinator } from "./publish-coordinator.js";
import {
  beginPublishConsumptionEvidence,
  commitPublishConsumptionEvidence,
  describePendingReleaseAssets,
  publishSemanticAssets,
  readSemanticAssetRelease,
  readSemanticAssetReleases,
  recordManualReindex,
  reconcilePublishWorkbenchAttempts,
  SemanticAssetValidationError,
  validateSemanticAssets,
  type SemanticAssetPublishRequest,
  type SemanticAssetReleaseListQuery,
  type SemanticAssetReleaseTrigger,
  type SemanticAssetValidateRequest,
  persistSemanticBatchSnapshot
} from "./semantic-assets.js";
import {
  readPublishPendingSnapshot,
  type PublishPendingSnapshot
} from "./publish-workbench-state.js";
import {
  buildPublishImpact,
  evidenceRefFor,
  isOverlayLogicalPath,
  readPublishEvidence,
  type PublishImpact
} from "./publish-impact.js";
import { exportSemanticAssetPackage, recordSemanticAssetExport } from "./semantic-asset-export.js";
import { recoverSemanticJournalsAtStartup, isRecoveryRequired } from "./semantic-recovery-journal.js";
import { verifyAccessRecoveryOnStartup } from "./access-recovery.js";
import { registerSemanticBatchRoutes } from "./semantic-batch-routes.js";
import { SEMANTIC_BATCH_LIMITS } from "./semantic-limits.js";
import {
  assertSemanticHttpBodySize,
  exportSemanticMaintenancePackage,
  isMaintenancePackageZip,
  parseSemanticValidateEnvelope,
  stageSemanticMaintenanceImport,
  SemanticBatchError
} from "./semantic-batch-service.js";
import { resolveSemanticInstanceId } from "./semantic-scopes.js";
import { readMaintenanceExportBaseline } from "./semantic-maintenance-package.js";
import {
  buildSemanticBatchAuditPayload,
  buildSemanticBatchAuditRecord
} from "./semantic-batch-audit.js";
import {
  buildPublishHistoryCsvRows,
  formatPublishHistoryExportFilenameStamp,
  projectPublicRelease
} from "../src/lib/publishHistoryLabels.js";
import {
  buildSemanticRestorePackage,
  previewSemanticRestore,
  readRestoreIndexScope,
  reconcileSemanticReleaseStartup,
  retryRestoreIndex,
  SemanticRestoreError,
  submitSemanticRestore
} from "./semantic-release-restore.js";

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    detail?: unknown;
  };
};

type SupportedError = FastifyError & {
  code?: string;
  statusCode?: number;
  detail?: unknown;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function endpointMatchList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") return [];
    return [{
      id: row.id,
      driver: typeof row.driver === "string" ? row.driver : "",
      host: typeof row.host === "string" ? row.host : "",
      port: typeof row.port === "string" ? row.port : "",
      database: typeof row.database === "string" ? row.database : "",
      username: typeof row.username === "string" ? row.username : "",
      schemas: stringList(row.schemas)
    }];
  });
}

function endpointGateDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== "object") return undefined;
  const source = detail as Record<string, unknown>;
  if (
    source.reason === "multiple" ||
    source.reason === "username_differs" ||
    source.reason === "reuse_existing_credentials"
  ) {
    return {
      reason: source.reason,
      ...(typeof source.schema === "string" ? { schema: source.schema } : {}),
      matches: endpointMatchList(source.matches)
    };
  }
  if (typeof source.connectionId === "string" && typeof source.schema === "string" && !("matches" in source)) {
    return { connectionId: source.connectionId, schema: source.schema };
  }
  if (typeof source.actual === "number") {
    return { actual: source.actual };
  }
  if (typeof source.requestedDatabase === "string") {
    return {
      matches: endpointMatchList(source.matches),
      requestedDatabase: source.requestedDatabase
    };
  }
  return undefined;
}

function supportedErrorDetail(error: SupportedError): unknown {
  if (error.code === "SCHEMA_NAME_INVALID") {
    const detail = error.detail;
    if (
      detail &&
      typeof detail === "object" &&
      "pattern" in detail &&
      typeof (detail as { pattern?: unknown }).pattern === "string"
    ) {
      return { pattern: (detail as { pattern: string }).pattern };
    }
  }
  if (error.code === "CONNECTION_ID_INVALID") {
    const detail = error.detail;
    if (
      detail &&
      typeof detail === "object" &&
      "pattern" in detail &&
      typeof (detail as { pattern?: unknown }).pattern === "string"
    ) {
      return { pattern: (detail as { pattern: string }).pattern };
    }
  }
  if (
    error.code === "ENDPOINT_ALREADY_CONNECTED" ||
    error.code === "SCHEMA_ALREADY_ON_CONNECTION" ||
    error.code === "ENDPOINT_SCHEMA_COUNT" ||
    error.code === "SAME_SERVER_DIFFERENT_DATABASE"
  ) {
    return endpointGateDetail(error.detail);
  }
  if (error.code === "CONNECTION_TEST_FAILED") {
    const detail = error.detail;
    if (detail && typeof detail === "object") {
      const source = detail as Record<string, unknown>;
      return Object.fromEntries(
        ["stdout", "stderr", "reason"]
          .filter((key) => typeof source[key] === "string")
          .map((key) => [key, source[key]])
      );
    }
  }
  if (error.code === "connection_references_remain") {
    // Spec 179 §3 / §5: blockers let the Admin client say which of 角色 / 用户 /
    // 业务 Wiki / 本地 YAML 资产 still block deletion. Pinned shape — only `{kind, id}`.
    const detail = error.detail;
    if (detail && typeof detail === "object" && Array.isArray((detail as { blockers?: unknown }).blockers)) {
      const blockers = (detail as { blockers: unknown[] }).blockers
        .filter(
          (entry): entry is { kind: string; id: string } =>
            !!entry &&
            typeof entry === "object" &&
            typeof (entry as { kind?: unknown }).kind === "string" &&
            typeof (entry as { id?: unknown }).id === "string"
        )
        .map((entry) => ({ kind: entry.kind, id: entry.id }));
      return { blockers };
    }
  }
  return undefined;
}

const DEFAULT_WEBUI_PORT = 5174;

function distDir(): string {
  return process.env.LUCY_WEBUI_DIST_DIR
    ? path.resolve(process.env.LUCY_WEBUI_DIST_DIR)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
}

/**
 * Apply a local patch to a single connection's `enabled_tables` list while
 * preserving every other connection, field, comment and quoting in the file.
 *
 * Previously the endpoint round-tripped through `parse() -> mutate -> stringify()`,
 * which reordered keys and produced a large noisy diff for a 1-table change.
 * This helper validates the structure with the YAML parser, then applies a
 * line-level replacement to the target block so unrelated bytes stay untouched.
 */

/**
 * Spec 191 §11.1 — a write that changes ktx.yaml leaves the execution layer
 * behind: the configuration is on disk, but the daemon has not confirmed
 * loading it. The write path only REPORTS that fact (and never triggers a
 * reload by itself); the owner decides when to reload.
 */
async function noteExecutionRuntimePending(
  projectRoot: string,
  digestBefore: string
): Promise<boolean> {
  try {
    return await markExecutionRuntimePending(projectRoot, digestBefore);
  } catch (error) {
    console.error("[execution-runtime] failed to record the pending activation", error);
    return false;
  }
}

/** The configuration digest as it was BEFORE a write, for the pending check. */
async function ktxDigestSnapshot(projectRoot: string): Promise<string> {
  return readKtxYamlDigest(projectRoot).catch(() => "");
}

async function executionAckForConnection(connectionId: string): Promise<{
  executionRuntimeAck: boolean;
  executionRuntimeStatus: "unknown" | "ok" | "stale" | "unavailable" | "error";
  executionDecisionReason: string;
  executionRuntimeError?: string;
}> {
  try {
    const canary = await runMcpRuntimeCanary({ connectionId, mode: "connection" });
    const executionRuntimeStatus = canary.executionRuntimeAck
      ? "ok"
      : canary.decisionReason === "execution_config_stale"
        ? "stale"
        : canary.decisionReason === "execution_runtime_unavailable"
          ? "unavailable"
          : canary.decisionReason === "upstream_error"
            ? "error"
            : "unknown";
    const executionRuntimeError = canary.checks.slice().reverse().find(
      (check) => check.status !== "pass"
    )?.detail;
    return {
      executionRuntimeAck: canary.executionRuntimeAck,
      executionRuntimeStatus,
      executionDecisionReason: canary.decisionReason,
      ...(executionRuntimeError ? { executionRuntimeError } : {})
    };
  } catch (error) {
    return {
      executionRuntimeAck: false,
      executionRuntimeStatus: "error",
      executionDecisionReason: "upstream_error",
      executionRuntimeError: error instanceof Error ? error.message : String(error)
    };
  }
}

type SourcesSnapshotSidecar = {
  policyInputs: DisplayPolicyInputs | null;
  meta: Pick<SourcesDisplayMeta, "snapshotVersion" | "generatedAt" | "authorizedCountsState">;
};

/**
 * Spec 174 §3.2 — `/api/sources` envelope as a versioned, pre-serialized display
 * snapshot. The cached payload ends right before `meta`; §3.3 runtimeConsistency
 * is evaluated against the current runtime policy for every response.
 */
function getSourcesDisplaySnapshot(projectRoot: string) {
  return getDisplaySnapshot("sources", ["D", "P", "C"], async (version) => {
    const listing = await listSourcesWithManifests(projectRoot);
    const started = performance.now();
    const payload = `{"ok":true,"data":{"tables":${JSON.stringify(listing.tables)},"manifestSchemas":${JSON.stringify(listing.manifestSchemas)},"meta":`;
    const sidecar: SourcesSnapshotSidecar = {
      policyInputs: listing.policyInputs,
      meta: { snapshotVersion: version, generatedAt: new Date().toISOString(), authorizedCountsState: listing.authorizedCountsState }
    };
    addTiming("serialize", performance.now() - started);
    return { payload, sidecar: JSON.stringify(sidecar) };
  });
}

function sourcesResponseBody(snapshot: { payload: string; sidecar?: string }): string {
  const sidecar = JSON.parse(snapshot.sidecar ?? "null") as SourcesSnapshotSidecar;
  const meta = sourcesDisplayMeta(sidecar.meta, runtimeConsistencyForInputs(sidecar.policyInputs));
  return `${snapshot.payload}${JSON.stringify(meta)}}}`;
}

registerDisplayPrewarmer("sources", async () => getSourcesDisplaySnapshot(await resolveProjectRoot()));

/** Client disconnect (not normal completion) aborts this request's probe subscription. */
function clientAbortSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

function logProbeTiming(request: FastifyRequest, kind: string, purpose: string, timing: ProbeTiming): void {
  addTiming("queue", timing.queueMs);
  request.log.info({ probe: { kind, purpose, queueMs: Math.round(timing.queueMs), executionMs: Math.round(timing.executionMs), totalMs: Math.round(timing.totalMs), shared: timing.shared } }, "connection probe");
}

/**
 * Build the pending file list for `/api/diff`.
 *
 * Each entry carries the change type and a diff that compares the last
 * PROVEN content version with the current bytes. A path with no trustworthy
 * previous version gets an empty diff — the UI then says "暂无可比较的生效
 * 版本" instead of pretending the Git diff is the before/after view.
 */
async function buildPendingChangedFiles(
  projectRoot: string,
  snapshot: PublishPendingSnapshot
): Promise<Array<{ filePath: string; status: string; diff: string }>> {
  const files: Array<{ filePath: string; status: string; diff: string }> = [];
  for (const change of snapshot.changes) {
    const evidence = await readPublishEvidence(
      projectRoot,
      evidenceRefFor(change.logicalPath, "diff")
    );
    files.push({
      filePath: change.logicalPath,
      status: change.changeType,
      diff: evidence?.kind === "diff" ? evidence.content : ""
    });
  }
  return files;
}

/**
 * Build the impact model, degrading to an explicitly incomplete result when
 * the model cannot be resolved. An incomplete impact is never dressed up as
 * an exact confirmation.
 */
async function buildPublishImpactSafely(
  projectRoot: string,
  snapshot: PublishPendingSnapshot
): Promise<PublishImpact> {
  try {
    return await buildPublishImpact({ projectRoot, snapshot });
  } catch (error) {
    return {
      pendingDigest: snapshot.pendingDigest,
      complete: false,
      counts: { files: snapshot.changes.length, tables: 0, manifests: 0, wikiPages: 0 },
      tables: [],
      wikiChanges: [],
      schemaChanges: [],
      relatedScope: [],
      otherChanges: [],
      unresolved: [
        {
          filePath: "",
          reason: `影响范围解析失败：${error instanceof Error ? error.message : String(error)}`,
          blocking: true
        }
      ]
    };
  }
}

/**
 * Resolve the tables whose semantics must be validated for this batch.
 *
 * The scope comes from the content snapshot, so a file edited outside this
 * process is validated too. A DELETED overlay has no semantics left to
 * validate — it is a file-level change, not a table failure.
 */
async function resolvePendingValidationTargets(
  projectRoot: string,
  snapshot: PublishPendingSnapshot
): Promise<Array<{ conn: string; schema: string; table: string }>> {
  const targets: Array<{ conn: string; schema: string; table: string }> = [];
  const seen = new Set<string>();
  let modelIndex;
  try {
    modelIndex = await buildSemanticModelIndex(projectRoot);
  } catch {
    // An unreadable model blocks the impact, but it must not crash the
    // validation route: the caller still gets an empty, honest result.
    return targets;
  }
  for (const change of snapshot.changes) {
    if (change.changeType === "deleted") continue;
    if (!isOverlayLogicalPath(change.logicalPath)) continue;
    const owners = modelIndex.overlayOwners.get(change.logicalPath) ?? [];
    if (owners.length !== 1) continue;
    const entry = modelIndex.byKey.get(owners[0]!);
    if (!entry) continue;
    const key = `${entry.identity.connectionId}/${entry.identity.schema}/${entry.identity.table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      conn: entry.identity.connectionId,
      schema: entry.identity.schema,
      table: entry.identity.table
    });
  }
  return targets;
}

export function buildServer() {
  assertStartupPolicy(); // invalid mode, Chart-mode override or insecure customer cookie refuses to start
  const app = Fastify({ logger: true });
  const writtenFiles: SessionWrittenFile[] = [];
  const changedSources = new Map<string, { conn: string; schema: string; table: string }>();

  registerWebSecurity(app);
  registerEntryPerformanceTiming(app);
  // Spec 174 §5 — one bounded probe queue per server; config changes cancel stale work.
  const probeScheduler = new ProbeScheduler({ currentGeneration: () => displayGenerations().L });
  const stopProbeInvalidation = onDisplayGenerationChange((scopes) => {
    if (!scopes.includes("L")) return;
    probeScheduler.invalidateGeneration();
    clearLiveCatalogCache();
  });
  // Spec 174 §3.2 — display snapshots are only served while a reconciler verifies them.
  let stopOwnReconciler: () => void = () => undefined;
  app.addHook("onReady", async () => {
    try {
      stopOwnReconciler = await ensureDisplayReconciler();
    } catch (error) {
      console.warn("[display-snapshot] reconciler unavailable; display reads stay busy:", error);
    }
  });
  // Spec 175: a leftover deployment-license file is not a credential store. Delete it, do not back it up.
  app.addHook("onReady", async () => {
    try {
      await removeLegacyLicenseFile(await resolveProjectRoot());
    } catch (error) {
      console.warn("[license] leftover license.yaml was not removed:", error);
    }
  });
  // Close an interrupted first-owner bootstrap before anything can clear admins.yaml (Spec §3.1 item 7).
  app.addHook("onReady", async () => {
    try {
      await reconcileBootstrapOnStartup();
    } catch (error) {
      console.warn("[auth] bootstrap reconciliation failed; bootstrap re-checks on the next attempt:", error);
    }
  });
  // Spec 193 §8.2 — reconstruct the widening hold before the Agent Wiki
  // channel accepts requests. A crash between the durable audit terminal and
  // the security operation commit leaves a `pending` operation; the recovery
  // either commits it (the bytes already prove the narrowing) or parks it in
  // `needs_review` and KEEPS the hold. It never re-writes a document and
  // never ratifies a widening on its own.
  app.addHook("onReady", async () => {
    try {
      const report = await recoverWikiAccessOperations();
      if (report.committed.length || report.aborted.length || report.needsReview.length) {
        console.warn(
          `[wiki-access] recovered ${report.committed.length} committed / ${report.aborted.length} aborted / ${report.needsReview.length} needs-review access operation(s)`
        );
      }
    } catch (error) {
      console.warn("[wiki-access] access operation recovery failed; the hold stays in place:", error);
    }
  });
  // Spec 190 §8.2 — continuous discovery worker. It only queries a database for
  // connections whose operator enabled the switch, and it keeps its own probe
  // quota so it never competes with `test` / `live-schemas`.
  let stopDiscoveryWorker: () => void = () => undefined;
  app.addHook("onReady", async () => {
    stopDiscoveryWorker = startDiscoveryWorker();
  });
  app.addHook("onClose", async () => {
    stopDiscoveryWorker();
  });
  app.addHook("onClose", async () => {
    closeSecurityStore();
    stopOwnReconciler();
    stopProbeInvalidation();
    probeScheduler.close();
  });
  app.addHook("onRequest", requireWebuiAuthHook);

  app.setErrorHandler((error: SupportedError, request, reply) => {
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      const limitMiB = request.routeOptions.bodyLimit / 1024 / 1024;
      reply.status(413).send({
        ok: false,
        error: {
          code: error.code,
          message: `请求体超过 ${limitMiB} MiB 上限，请减少本次提交内容后重试。`
        }
      } satisfies ErrorEnvelope);
      return;
    }
    if (error.code === FRONTMATTER_ENGINE_FORBIDDEN) {
      // V-08: reads of an already-stored file are 422; upload/save/restore are 400.
      const reading = request.method === "GET";
      reply.status(reading ? 422 : 400).send({
        ok: false,
        error: {
          code: "WIKI_FRONTMATTER_UNSUPPORTED",
          message: reading ? "仅支持 YAML 格式的文档属性，请修复该文档后再读取。" : "仅支持 YAML 格式的文档属性。"
        }
      } satisfies ErrorEnvelope);
      return;
    }
    const statusCode = error.statusCode ?? 500;
    const code = error.code ?? (statusCode === 500 ? "INTERNAL" : "BAD_REQUEST");
    const payload: ErrorEnvelope = {
      ok: false,
      error: {
        code,
        message: error.message || "Internal server error"
      }
    };
    const detail = supportedErrorDetail(error);
    if (detail !== undefined) {
      payload.error.detail = detail;
    }
    const retryAfter = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof retryAfter === "number") reply.header("Retry-After", String(retryAfter));

    reply.status(statusCode).send(payload);
  });

  app.get("/api/health", async () => {
    const policy = getPolicyRuntimeStatus();
    // Spec 180 §2 — the content layout diagnostic is a *side* check on
    // `/api/health`. Health must not depend on it resolving: a project root
    // we cannot locate (early boot, missing ktx.yaml) must still produce
    // a 200 with the existing policy / ktx / execution signal.
    let contentLayout: import("./content-layout").ContentLayoutStatus | null = null;
    try {
      const projectRoot = await resolveProjectRoot();
      const contentPaths = await resolveContentPaths(projectRoot);
      contentLayout = await collectContentLayout(projectRoot, contentPaths);
    } catch {
      // leave null; `contentLayout` is omitted from the envelope.
    }
    const [ktxRuntime, mcpRuntime] = await Promise.all([
      readKtxRuntimeStatus(),
      readMcpRuntimeStatus().catch((error) => ({
        execution: {
          status: "error" as const,
          lastCheckedAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : String(error)
        }
      }))
    ]);
    const policyHealthy = isPolicyRuntimeHealthy(policy);
    const executionHardFailure = ["stale", "unavailable", "error"].includes(
      mcpRuntime.execution.status
    );
    // Spec 180 §2 — drift is informational; it must not turn `status` into a
    // failure. `healthy` only reflects policy + ktx runtime + MCP execution.
    const healthy = policyHealthy && ktxRuntime.ready && !executionHardFailure;
    return {
      ok: true,
      data: {
        // Spec 98 §8.4 — align with /api/admin/policy-runtime; empty policyVersion is not healthy.
        status: healthy ? "ok" : "degraded",
        // Spec §3.1 item 8: surfaced only while customer mode runs without Secure cookies (test profile).
        ...(resolveCookieSecure().insecureTestProfile ? { insecureTestProfile: true } : {}),
        lucyVersion: resolveLucyVersion(),
        // Commit identity from /app/BUILD_REVISION or the Lucy source checkout. Not LUCY_GIT_SHA.
        ...loadRuntimeRevision(),
        bundledKtxVersion: process.env.LUCY_BUNDLED_KTX_VERSION ?? "unknown",
        ktxRuntime: {
          ready: ktxRuntime.ready,
          status: ktxRuntime.status,
          ...(ktxRuntime.detail ? { detail: ktxRuntime.detail } : {})
        },
        policy: {
          policyVersion: policy.policyVersion,
          degradedGlobal: policy.degradedGlobal,
          degradedAgents: policy.degradedAgents,
          healthy: policyHealthy
        },
        execution: mcpRuntime.execution,
        // T9 — guidance is advisory; missing guidance must not fail liveness.
        // The status is exposed for operator visibility and so an Admin can
        // confirm the proxy is still functional when the file is being rolled out.
        dataQaInstructions: getDataQaInstructionsStatus(),
        // Spec 180 §2 — content root vs. mirror layout snapshot; read-only,
        // surfaces drift without flipping `status`. Omitted when no project
        // root can be resolved (e.g. before ktx.yaml is wired up).
        ...(contentLayout ? { contentLayout } : {})
      }
    };
  });

  app.get("/api/project", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readProject(projectRoot)
    };
  });

  app.get("/api/sources", async (request, reply) => withRequestTiming(request, async () => {
    const projectRoot = await resolveProjectRoot();
    const snapshot = await getSourcesDisplaySnapshot(projectRoot);
    return reply.type("application/json; charset=utf-8").send(sourcesResponseBody(snapshot));
  }));

  app.get<{
    Params: { conn: string; schema: string; table: string };
  }>("/api/sources/:conn/:schema/:table", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    return {
      ok: true,
      data: await readSource(projectRoot, conn, schema, table)
    };
  });

  app.put<{
    Params: { conn: string; schema: string; table: string };
    Body: { patch?: TablePatch; dryRun?: boolean; restoredFromVersionId?: string };
  }>("/api/sources/:conn/:schema/:table", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    if (dryRun) {
      const data = await previewSourcePatch(projectRoot, conn, schema, table, request.body?.patch ?? {});
      return reply.send({
        ok: true,
        data
      });
    }

    const preview = await writeSourcePatch(
      projectRoot,
      conn,
      schema,
      table,
      request.body?.patch ?? {},
      trustedActorFromRequest(request)
    );
    for (const file of preview.files) {
      writtenFiles.push({ filePath: file.filePath });
    }
    changedSources.set(`${conn}/${schema}/${table}`, { conn, schema, table });
    const validation = await validateSource(projectRoot, conn, schema, table);
    const files = await changedFiles(projectRoot, writtenFiles);
    const nextSource = await readSource(projectRoot, conn, schema, table);
    const version = await createTableYamlVersionSnapshot(
      projectRoot,
      conn,
      schema,
      table,
      nextSource.rawYaml,
      {
        operation: request.body?.restoredFromVersionId ? "restore" : "save",
        restoredFromVersionId: request.body?.restoredFromVersionId,
        affectedFiles: preview.files.map((file) => file.filePath)
      }
    );
    return reply.send({
      ok: true,
      data: {
        written: true,
        validation,
        changedFiles: files,
        version
      }
    });
  });

  app.post<{
    Params: { conn: string; schema: string; table: string };
    Body: { yaml?: string; dryRun?: boolean; sourceFileName?: string; restoredFromVersionId?: string };
  }>("/api/sources/:conn/:schema/:table/import", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const yaml = request.body?.yaml;
    if (typeof yaml !== "string" || !yaml.trim()) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "INVALID_IMPORT_YAML",
          message: "Imported YAML must be a non-empty string"
        }
      });
    }
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    if (dryRun) {
      const data = await previewSourceYamlImport(projectRoot, conn, schema, table, yaml);
      return reply.send({
        ok: true,
        data
      });
    }

    const preview = await writeSourceYamlImport(projectRoot, conn, schema, table, yaml, trustedActorFromRequest(request));
    for (const file of preview.files) {
      writtenFiles.push({ filePath: file.filePath });
    }
    changedSources.set(`${conn}/${schema}/${table}`, { conn, schema, table });
    const validation = await validateSource(projectRoot, conn, schema, table);
    const files = await changedFiles(projectRoot, writtenFiles);
    const nextSource = await readSource(projectRoot, conn, schema, table);
    const version = await createTableYamlVersionSnapshot(
      projectRoot,
      conn,
      schema,
      table,
      nextSource.rawYaml,
      {
        operation: request.body?.restoredFromVersionId ? "restore" : "import",
        sourceFileName: request.body?.sourceFileName,
        restoredFromVersionId: request.body?.restoredFromVersionId,
        affectedFiles: preview.files.map((file) => file.filePath)
      }
    );
    return reply.send({
      ok: true,
      data: {
        written: true,
        validation,
        changedFiles: files,
        version
      }
    });
  });

  app.get<{
    Params: { conn: string; schema: string; table: string };
  }>("/api/sources/:conn/:schema/:table/versions", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    return {
      ok: true,
      data: await listTableYamlVersions(projectRoot, conn, schema, table)
    };
  });

  app.get<{
    Params: { conn: string; schema: string; table: string; versionId: string };
  }>("/api/sources/:conn/:schema/:table/versions/:versionId", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table, versionId } = request.params;
    const current = await readSource(projectRoot, conn, schema, table);
    return {
      ok: true,
      data: await readTableYamlVersion(projectRoot, conn, schema, table, versionId, current.rawYaml)
    };
  });

  app.post<{
    Params: { conn: string; schema: string; table: string; versionId: string };
  }>("/api/sources/:conn/:schema/:table/versions/:versionId/restore/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table, versionId } = request.params;
    const current = await readSource(projectRoot, conn, schema, table);
    return {
      ok: true,
      data: await previewTableYamlVersionRestore(projectRoot, conn, schema, table, versionId, current.rawYaml)
    };
  });

  app.post<{
    Params: { conn: string; schema: string; table: string; versionId: string };
  }>("/api/sources/:conn/:schema/:table/versions/:versionId/restore", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table, versionId } = request.params;
    const current = await readSource(projectRoot, conn, schema, table);
    return {
      ok: true,
      data: await restoreTableYamlVersionDraft(projectRoot, conn, schema, table, versionId, current.rawYaml)
    };
  });

  app.post<{
    Params: { conn: string; schema: string; table: string };
  }>("/api/sources/:conn/:schema/:table/validate", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { conn, schema, table } = request.params;
    return {
      ok: true,
      data: await validateSource(projectRoot, conn, schema, table)
    };
  });

  app.get("/api/diff", async () => {
    const projectRoot = await resolveProjectRoot();
    let mirrorOnlySemanticFiles: string[] = [];
    let mirrorDriftTruncated = false;
    try {
      const contentPaths = await resolveContentPaths(projectRoot);
      const layout = await collectContentLayout(projectRoot, contentPaths);
      mirrorOnlySemanticFiles = mirrorOnlySemanticRelPaths(layout);
      mirrorDriftTruncated = layout.driftTruncated;
    } catch {
      // Spec 180: drift is advisory and must not fail the pending-change read.
    }
    // Spec §5.1 — the pending list is the difference between the current author
    // content and the last content version with proven sync evidence. The Git
    // diff can DISCOVER a change; it cannot prove that the change took effect,
    // so it is no longer the source of this list.
    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const impact = await buildPublishImpactSafely(projectRoot, snapshot);
    return {
      ok: true,
      data: {
        files: await buildPendingChangedFiles(projectRoot, snapshot),
        pendingDigest: snapshot.pendingDigest,
        baselineState: snapshot.baselineState,
        baselineGeneration: snapshot.baselineGeneration,
        impact,
        mirrorOnlySemanticFiles,
        mirrorDriftTruncated
      }
    };
  });

  /**
   * GET /api/publish-workbench/evidence
   *
   * Resolve ONE evidence reference from the impact model into its content.
   * The reference names a logical path that must be inside the current
   * snapshot or the current baseline — the server never reads an arbitrary
   * path from a client-supplied string.
   */
  app.get<{
    Querystring: { ref?: string };
  }>("/api/publish-workbench/evidence", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const ref = typeof request.query.ref === "string" ? request.query.ref : "";
    if (!ref) {
      reply.status(400);
      return reply.send({
        ok: false,
        error: { code: "EVIDENCE_REF_REQUIRED", message: "缺少证据引用。" }
      });
    }
    const evidence = await readPublishEvidence(projectRoot, ref);
    if (!evidence) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: { code: "EVIDENCE_NOT_FOUND", message: "证据不存在或已过期，请重新预览。" }
      });
    }
    return { ok: true, data: evidence };
  });

  app.post("/api/validate-changed", async () => {    const projectRoot = await resolveProjectRoot();
    // Spec §6 — the validation scope is derived from the SAME content snapshot
    // the list and the confirmation use, not from an in-process set of written
    // files. A file edited outside this process is validated too.
    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const results: Array<{ conn: string; schema: string; table: string; validation: ValidationResult }> = [];
    for (const { conn, schema, table } of await resolvePendingValidationTargets(projectRoot, snapshot)) {
      const validation = await validateSource(projectRoot, conn, schema, table);
      const contracts = await readChangedSourceColumnContracts(projectRoot, conn, schema, table);
      const withContract = applyColumnTypeContractToValidation(validation, contracts);
      results.push({
        conn,
        schema,
        table,
        validation: withContract
      });
    }
    return {
      ok: true,
      data: {
        results,
        pendingDigest: snapshot.pendingDigest,
        baselineState: snapshot.baselineState
      }
    };
  });

  app.get("/api/wiki", async () => {
    const projectRoot = await resolveProjectRoot();
    // One aggregate response: every row carries its authorization status and
    // the Role / Agent configuration is read exactly once (Spec 193 §6.1).
    const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
    const [pages, directories] = await Promise.all([
      listWiki(projectRoot, snapshot),
      listWikiDirectories(projectRoot)
    ]);
    return {
      ok: true,
      data: {
        pages,
        directories,
        role_channel_version: snapshot.role_channel_version
      }
    };
  });

  app.post<{
    Body: WikiDirectoryCreateInput;
  }>("/api/wiki/directories", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await createWikiDirectory(projectRoot, request.body);
    writtenFiles.push({ filePath: "wiki/.lucy-directories.json" });
    writtenFiles.push({ filePath: result.filePath });
    return {
      ok: true,
      data: result
    };
  });

  app.post<{
    Body: WikiDirectoryRenameInput;
  }>("/api/wiki/directories/rename/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiDirectoryRename(projectRoot, request.body ?? { sourcePath: "", newName: "" })
    };
  });

  app.post<{
    Body: WikiDirectoryRenameInput;
  }>("/api/wiki/directories/rename", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await renameWikiDirectory(
      projectRoot,
      request.body ?? { sourcePath: "", newName: "" }
    );
    for (const filePath of result.writtenFiles) {
      writtenFiles.push({ filePath });
    }
    return {
      ok: true,
      data: result
    };
  });

  app.delete<{
    Params: { path: string };
  }>("/api/wiki/directories/:path", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await deleteWikiDirectory(projectRoot, request.params.path);
    writtenFiles.push({ filePath: "wiki/.lucy-directories.json" });
    writtenFiles.push({ filePath: result.filePath });
    return {
      ok: true,
      data: result
    };
  });

  app.delete<{
    Params: { key: string };
    Querystring: { expected_version?: string };
  }>("/api/wiki/:key", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await deleteWiki(
      projectRoot,
      request.params.key,
      trustedActorFromRequest(request),
      request.query?.expected_version
    );
    writtenFiles.push({ filePath: result.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: result
    };
  });

  app.post<{
    Params: { key: string };
    Body: { targetDirectory?: string };
  }>("/api/wiki/:key/move/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const targetDirectory = request.body?.targetDirectory ?? "";
    return {
      ok: true,
      data: await previewWikiMove(projectRoot, request.params.key, targetDirectory)
    };
  });

  app.post<{
    Params: { key: string };
    Body: WikiMoveInput & { expected_version?: string };
  }>("/api/wiki/:key/move", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const targetDirectory = request.body?.targetDirectory ?? "";
    const result = await moveWiki(
      projectRoot,
      request.params.key,
      targetDirectory,
      trustedActorFromRequest(request),
      request.body?.expected_version
    );
    writtenFiles.push({ filePath: result.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    writtenFiles.push({ filePath: "wiki/.lucy-directories.json" });
    return reply.send({ ok: true, data: result });
  });

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key/raw", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const page = await readWiki(projectRoot, request.params.key);
    reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${path.posix.basename(page.key)}"`);
    // The reply MUST be returned. A handler that sends and then falls through makes
    // Fastify send a SECOND response: `reply.sent` is only true once the response has
    // ENDED, so the framework's own send races the first one and `writeHead` throws
    // `ERR_HTTP_HEADERS_SENT` from the onSend hook chain — an uncaught exception that
    // kills the whole server process. A plain wiki download could therefore take the
    // instance down.
    return reply.send(page.rawMarkdown);
  });

  app.post<{
    Body: WikiUploadInput;
  }>("/api/wiki/upload/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiUpload(projectRoot, request.body)
    };
  });

  app.post<{
    Body: WikiUploadInput;
  }>("/api/wiki/upload/commit", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const preview = await commitWikiUpload(projectRoot, request.body, trustedActorFromRequest(request));
    writtenFiles.push({ filePath: preview.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: preview
    };
  });

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key/versions", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await listWikiVersions(projectRoot, request.params.key)
    };
  });

  app.get<{
    Params: { key: string; versionId: string };
  }>("/api/wiki/:key/versions/:versionId", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readWikiVersion(projectRoot, request.params.key, request.params.versionId)
    };
  });

  app.post<{
    Params: { key: string; versionId: string };
  }>("/api/wiki/:key/versions/:versionId/restore/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiVersionRestore(projectRoot, request.params.key, request.params.versionId)
    };
  });

  app.post<{
    Params: { key: string; versionId: string };
    Body: { expected_version?: string };
  }>("/api/wiki/:key/versions/:versionId/restore", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await restoreWikiVersion(
      projectRoot,
      request.params.key,
      request.params.versionId,
      trustedActorFromRequest(request),
      request.body?.expected_version
    );
    writtenFiles.push({ filePath: result.filePath });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: result
    };
  });

  // ─── Spec 193: business Wiki access management ────────────────────────────
  //
  // The authorization of a document is an object fact of its Markdown file.
  // These routes manage it WITHOUT touching the body.

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key/access", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await getWikiAccessSummary(projectRoot, request.params.key)
    };
  });

  app.post<{
    Params: { key: string };
    Body: { allowed_roles?: unknown; expected_version?: string };
  }>("/api/wiki/:key/access/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiAccess(projectRoot, request.params.key, {
        allowed_roles: request.body?.allowed_roles,
        expected_version: request.body?.expected_version
      })
    };
  });

  app.put<{
    Params: { key: string };
    Body: { allowed_roles?: unknown; expected_version?: string; preview_digest?: string };
  }>("/api/wiki/:key/access", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await saveWikiAccess(
      projectRoot,
      request.params.key,
      {
        allowed_roles: request.body?.allowed_roles,
        expected_version: request.body?.expected_version,
        preview_digest: request.body?.preview_digest
      },
      trustedActorFromRequest(request)
    );
    writtenFiles.push({ filePath: `wiki/${request.params.key}` });
    writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    return {
      ok: true,
      data: result
    };
  });

  app.post<{
    Body: {
      items?: Array<{ key: string; expected_version?: string }>;
      action?: unknown;
      operation_id?: string;
    };
  }>("/api/wiki/access/batch/preview", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await previewWikiAccessBatch(projectRoot, {
        items: request.body?.items,
        action: request.body?.action,
        operation_id: request.body?.operation_id
      })
    };
  });

  app.post<{
    Body: {
      operation_id?: string;
      plan_digest?: string;
      idempotency_key?: string;
      items?: Array<{ key: string; expected_version?: string }>;
      action?: unknown;
      confirmed_empty?: boolean;
      confirmed_all?: boolean;
    };
  }>("/api/wiki/access/batch/commit", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const result = await commitWikiAccessBatch(
      projectRoot,
      {
        operation_id: request.body?.operation_id,
        plan_digest: request.body?.plan_digest,
        idempotency_key: request.body?.idempotency_key,
        items: request.body?.items,
        action: request.body?.action,
        confirmed_empty: request.body?.confirmed_empty,
        confirmed_all: request.body?.confirmed_all
      },
      trustedActorFromRequest(request)
    );
    return {
      ok: true,
      data: result
    };
  });

  app.get<{
    Params: { operationId: string };
  }>("/api/wiki/access/batches/:operationId", async (request, reply) => {
    const result = await getWikiAccessBatchResult(request.params.operationId);
    if (!result) {
      return reply.status(404).send({
        ok: false,
        error: { code: "wiki_batch_not_found", message: "未找到该批量授权操作。" }
      });
    }
    return { ok: true, data: result };
  });

  app.get<{
    Params: { key: string };
  }>("/api/wiki/:key", async (request) => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readWiki(projectRoot, request.params.key)
    };
  });

  app.put<{
    Params: { key: string };
    Body: { dryRun?: boolean; frontmatter?: WikiWriteInput["frontmatter"]; content?: string; expected_version?: string };
  }>("/api/wiki/:key", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const writeInput: WikiWriteInput = {
      frontmatter: request.body?.frontmatter,
      content: request.body?.content,
      expected_version: request.body?.expected_version
    };
    const preview = request.body?.dryRun === false
      ? await writeWiki(projectRoot, request.params.key, writeInput, trustedActorFromRequest(request))
      : await previewWikiWrite(projectRoot, request.params.key, writeInput);
    if (request.body?.dryRun === false) {
      writtenFiles.push({ filePath: preview.filePath });
      writtenFiles.push({ filePath: "wiki/.lucy-history/index.json" });
    }
    return {
      ok: true,
      data: preview
    };
  });

  app.get("/api/help/handbook", async () => {
    return {
      ok: true,
      data: await readHelpHandbook()
    };
  });

  app.get<{
    Querystring: { q?: string; limit?: string };
  }>("/api/help/search", async (request) => {
    const rawLimit = request.query.limit;
    const parsedLimit =
      rawLimit === undefined || rawLimit === "" ? undefined : Number.parseInt(rawLimit, 10);
    const limit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    return {
      ok: true,
      data: await searchHelpHandbook(request.query.q ?? "", { limit })
    };
  });

  // Product architecture HTML diagrams (SSOT: docs/user-guide/*.html).
  app.get<{
    Params: { id?: string };
  }>("/api/help/diagrams/:id", async (request, reply) => {
    const diagram = await readHelpDiagram(request.params.id ?? "");
    return reply.type("text/html; charset=utf-8").send(diagram.html);
  });

  app.get("/api/joins/candidates", async () => {
    const projectRoot = await resolveProjectRoot();
    return {
      ok: true,
      data: await readJoinCandidates(projectRoot)
    };
  });

  app.put<{
    Body: { candidates?: JoinCandidate[] };
  }>("/api/joins/candidates", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const data = await writeJoinCandidates(projectRoot, request.body?.candidates ?? []);
    writtenFiles.push({ filePath: joinCandidatesPath() });
    return {
      ok: true,
      data
    };
  });

  // ─── Database connection routes ───────────────────────────────────────────

  app.get("/api/connections", async () => {
    const projectRoot = await resolveProjectRoot();
    const connections = await readConnections(projectRoot);
    return { ok: true, data: { connections } };
  });

  const VALID_CREATE_DRIVERS = new Set(["mysql", "postgres", "sqlserver", "oracle", "sqlite", "athena"]);

  // Spec 124 Phase A: create connection (secret one-shot write + ktx.yaml patch).
  // dryRun defaults to true. No UI in this spike — API + security tests only.
  app.post<{
    Body: {
      id?: string;
      driver?: string;
      engine?: string;
      wireProtocol?: string;
      readonly?: boolean;
      host?: string;
      port?: number;
      database?: string;
      username?: string;
      password?: string;
      schemas?: string[];
      region?: string;
      s3StagingDir?: string;
      workgroup?: string;
      catalog?: string;
      dryRun?: boolean;
      acknowledgeSeparateConnection?: boolean;
      acknowledgeDifferentDatabase?: boolean;
    };
  }>("/api/connections", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (typeof body.id !== "string") {
      throw enabledTableError("BAD_REQUEST", "id is required");
    }
    if (!VALID_CREATE_DRIVERS.has(body.driver ?? "")) {
      throw enabledTableError("BAD_REQUEST", "driver must be one of mysql, postgres, sqlserver, oracle, sqlite, athena");
    }
    const skipsHost = body.driver === "sqlite" || body.driver === "athena";
    if (typeof body.database !== "string" || !body.database.trim()) {
      throw enabledTableError("BAD_REQUEST", "database is required");
    }
    if (body.driver === "athena") {
      if (typeof body.region !== "string" || !body.region.trim()) {
        throw enabledTableError("BAD_REQUEST", "region is required");
      }
      if (typeof body.s3StagingDir !== "string" || !body.s3StagingDir.trim()) {
        throw enabledTableError("BAD_REQUEST", "s3StagingDir is required");
      }
    } else if (!skipsHost) {
      if (typeof body.host !== "string" || !body.host.trim()) {
        throw enabledTableError("BAD_REQUEST", "host is required");
      }
      if (typeof body.port !== "number") {
        throw enabledTableError("BAD_REQUEST", "port is required");
      }
      if (typeof body.username !== "string" || !body.username.trim()) {
        throw enabledTableError("BAD_REQUEST", "username is required");
      }
    }
    const digestBefore = await ktxDigestSnapshot(projectRoot);
    const result = await createConnection(
      projectRoot,
      {
        id: body.id,
        driver: body.driver as "mysql" | "postgres" | "sqlserver" | "oracle" | "sqlite" | "athena",
        ...(typeof body.engine === "string" ? { engine: body.engine } : {}),
        ...(typeof body.wireProtocol === "string" ? { wireProtocol: body.wireProtocol } : {}),
        readonly: body.readonly,
        host: body.host,
        port: body.port,
        database: body.database,
        username: body.username,
        ...(typeof body.password === "string" ? { password: body.password } : {}),
        ...(Array.isArray(body.schemas) ? { schemas: body.schemas } : {}),
        ...(typeof body.region === "string" ? { region: body.region } : {}),
        ...(typeof body.s3StagingDir === "string" ? { s3StagingDir: body.s3StagingDir } : {}),
        ...(typeof body.workgroup === "string" ? { workgroup: body.workgroup } : {}),
        ...(typeof body.catalog === "string" ? { catalog: body.catalog } : {})
      },
      dryRun,
      {
        recordConfigChange,
        endpointFlags: {
          acknowledgeSeparateConnection: body.acknowledgeSeparateConnection === true,
          acknowledgeDifferentDatabase: body.acknowledgeDifferentDatabase === true
        }
      }
    );
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
      if ("secretRelPath" in result && result.secretRelPath) {
        writtenFiles.push({ filePath: result.secretRelPath });
      }

      let catalogRuntimeAck = false;
      try {
        const catalogRun = await reloadCatalog(projectRoot, { connectionId: body.id });
        catalogRuntimeAck = catalogRun.status === "success" && !catalogRun.warnings.some(
          (warning) => warning.code === "SCHEMA_MANIFEST_MISSING"
        );
      } catch (error) {
        console.error("[connection-create] catalog reload failed", error);
      }

      let policyVersion = "";
      let policyRuntimeAck = false;
      try {
        const { commitEffectivePolicy } = await import("./proxy/acl.js");
        const status = await commitEffectivePolicy();
        policyVersion = status.policyVersion;
        policyRuntimeAck = status.policyVersion !== "" && !status.degradedGlobal;
      } catch (error) {
        console.error("[connection-create] policy runtime commit failed", error);
      }

      const executionAck = await executionAckForConnection(body.id);
      const executionRuntimePending = await noteExecutionRuntimePending(projectRoot, digestBefore);

      return {
        ok: true,
        data: {
          ...result,
          policyVersion,
          policyRuntimeAck,
          catalogRuntimeAck,
          ...executionAck,
          executionRuntimePending,
          runtimeAck: policyRuntimeAck
        }
      };
    }
    return { ok: true, data: result };
  });

  app.post<{
    Body: {
      driver?: string;
      engine?: string;
      wireProtocol?: string;
      readonly?: boolean;
      host?: string;
      port?: number;
      database?: string;
      username?: string;
      password?: string;
      region?: string;
      s3StagingDir?: string;
      workgroup?: string;
      catalog?: string;
    };
  }>("/api/connections/probe", async (request) => {
    const body = request.body ?? {};
    if (!VALID_CREATE_DRIVERS.has(body.driver ?? "")) {
      throw enabledTableError("BAD_REQUEST", "driver must be one of mysql, postgres, sqlserver, oracle, sqlite, athena");
    }
    const skipsHost = body.driver === "sqlite" || body.driver === "athena";
    if (typeof body.database !== "string" || !body.database.trim()) {
      throw enabledTableError("BAD_REQUEST", "database is required");
    }
    if (body.driver === "athena") {
      if (typeof body.region !== "string" || !body.region.trim()) {
        throw enabledTableError("BAD_REQUEST", "region is required");
      }
      if (typeof body.s3StagingDir !== "string" || !body.s3StagingDir.trim()) {
        throw enabledTableError("BAD_REQUEST", "s3StagingDir is required");
      }
    } else if (!skipsHost) {
      if (typeof body.host !== "string" || !body.host.trim()) {
        throw enabledTableError("BAD_REQUEST", "host is required");
      }
      if (typeof body.port !== "number") {
        throw enabledTableError("BAD_REQUEST", "port is required");
      }
      if (typeof body.username !== "string" || !body.username.trim()) {
        throw enabledTableError("BAD_REQUEST", "username is required");
      }
      if (typeof body.password !== "string" || body.password.length === 0) {
        throw enabledTableError("CONNECTION_PASSWORD_REQUIRED", "数据库密码为必填项");
      }
    }
    const data = await probeConnection({
      driver: body.driver as "mysql" | "postgres" | "sqlserver" | "oracle" | "sqlite" | "athena",
      ...(typeof body.engine === "string" ? { engine: body.engine } : {}),
      ...(typeof body.wireProtocol === "string" ? { wireProtocol: body.wireProtocol } : {}),
      readonly: body.readonly,
      host: body.host,
      port: body.port,
      database: body.database,
      username: body.username,
      password: body.password,
      ...(typeof body.region === "string" ? { region: body.region } : {}),
      ...(typeof body.s3StagingDir === "string" ? { s3StagingDir: body.s3StagingDir } : {}),
      ...(typeof body.workgroup === "string" ? { workgroup: body.workgroup } : {}),
      ...(typeof body.catalog === "string" ? { catalog: body.catalog } : {})
    });
    return { ok: true, data };
  });

  app.get<{
    Params: { connId: string };
  }>("/api/connections/:connId/tables", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const catalog = await scannedTableCatalog(projectRoot, connId);
    return {
      ok: true,
      data: { tables: catalog.logicalNames, physicalNames: catalog.physicalNames }
    };
  });

  app.post<{
    Params: { connId: string };
    Body: { schema?: string };
  }>("/api/connections/:connId/schema-structure", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const schema = request.body?.schema;
    if (typeof schema !== "string" || !schema.trim()) {
      throw enabledTableError("BAD_REQUEST", "schema is required");
    }
    try {
      const data = await previewSchemaStructure(projectRoot, request.params.connId, schema);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof SchemaStructureError) {
        throw enabledTableError(err.code, err.message);
      }
      throw err;
    }
  });

  app.get<{
    Params: { connId: string };
    Querystring: { refresh?: string; purpose?: string };
  }>("/api/connections/:connId/live-schemas", async (request, reply) => withRequestTiming(request, async () => {
    const purpose = parseProbePurpose(request.query?.purpose);
    if (!purpose) throw enabledTableError("BAD_REQUEST", "purpose must be automatic or manual");
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const refresh =
      request.query?.refresh === "1" ||
      request.query?.refresh === "true" ||
      request.query?.refresh === "yes";
    try {
      // Spec 107 10-minute success cache; refresh=1 skips completed results but
      // still merges with an in-flight probe of the same config generation.
      const generation = displayGenerations().L;
      const cached = refresh ? null : peekLiveSchemasCache(projectRoot, connId, generation);
      if (cached) return { ok: true, data: cached };
      const { value: data, timing } = await probeScheduler.submit({
        key: `${projectRoot}\u0000L${generation}\u0000${connId}\u0000live-schemas`,
        generation,
        purpose,
        signal: clientAbortSignal(reply),
        run: () => listLiveSchemas(projectRoot, connId, { refresh: true }, {
          generation,
          currentGeneration: () => displayGenerations().L
        })
      });
      logProbeTiming(request, "live-schemas", purpose, timing);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof LiveCatalogConnectionNotFoundError) {
        throw enabledTableError(err.code, err.message);
      }
      throw err;
    }
  }));

  app.put<{
    Params: { connId: string };
    Body: { enabledTables?: string[]; dryRun?: boolean };
  }>("/api/connections/:connId/enabled-tables", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const { enabledTables } = request.body ?? {};
    const dryRun = request.body?.dryRun !== false;
    const yamlPath = path.join(projectRoot, "ktx.yaml");
    const yamlText = await readFile(yamlPath, "utf8");
    const config = parse(yamlText) as Record<string, unknown>;
    const connections = config.connections as Record<string, Record<string, unknown>> | undefined;
    if (!connections || !connections[connId]) {
      throw enabledTableError("CONNECTION_NOT_FOUND", `Connection '${connId}' not found in ktx.yaml`);
    }
    const catalog = await scannedTableCatalog(projectRoot, connId);
    const driver = typeof connections[connId].driver === "string" ? connections[connId].driver : "";
    const normalized = normalizeEnabledTableNames(
      enabledTables,
      catalog.entries,
      isSqlServerDriver(driver)
    );
    const oldEnabledTables = Array.isArray(connections[connId].enabled_tables)
      ? connections[connId].enabled_tables.filter((item): item is string => typeof item === "string")
      : [];
    const { tables: newEnabledTables, warnings } = validateEnabledTables(
      normalized.tables,
      catalog.physicalTables,
      new Set(oldEnabledTables)
    );

    // M45: local patch preserves order, comments and unknown
    // fields in unrelated parts of ktx.yaml so the dry-run diff only shows
    // the enabled_tables sequence change.
    const { proposedYaml } = patchConnectionEnabledTablesYaml(yamlText, connId, newEnabledTables);
    const diff = makeDiff(yamlText, proposedYaml);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, oldEnabledTables, newEnabledTables, warnings } };
    }

    const digestBefore = await ktxDigestSnapshot(projectRoot);

    // Spec 174 §3.2 — barrier spans ktx.yaml write → catalog reload → policy commit.
    // L25-16 N05 / G17 — the legacy write entry joins the SAME ktx.yaml write lock as the
    // control-plane batch service; otherwise the batch service's mutual-exclusion promise
    // does not hold (the legacy entry could interleave while the batch holds the lock).
    return withKtxYamlWriteLock(() =>
    withDisplayWriteBarrier(["C", "D", "P", "L"], async () => {
    const { auditId } = await auditedWriteFile(projectRoot, "ktx.yaml", proposedYaml, {
      enabled: true,
      changeType: "enabled_tables_update",
      assetKind: "governance",
      ...auditActorFields(trustedActorFromRequest(request)),
      source: "connections_enabled_tables_api",
      targetId: connId,
      oldSummary: { count: oldEnabledTables.length, enabledTables: oldEnabledTables },
      newSummary: { count: newEnabledTables.length, enabledTables: newEnabledTables },
      diff
    });

    let catalogRuntimeAck = false;
    try {
      const catalogRun = await reloadCatalog(projectRoot, { connectionId: connId });
      catalogRuntimeAck = catalogRun.status === "success" && !catalogRun.warnings.some(
        (warning) => warning.code === "SCHEMA_MANIFEST_MISSING"
      );
    } catch (err) {
      console.error("[enabled-tables] ktx.yaml written but catalog reload failed", err);
    }

    // Spec 131 / P1-1: catalog_bound capabilities depend on enabled_tables — recompile now.
    let policyVersion = "";
    let policyRuntimeAck = false;
    try {
      const { commitEffectivePolicy } = await import("./proxy/acl.js");
      const status = await commitEffectivePolicy();
      policyVersion = status.policyVersion;
      policyRuntimeAck = status.policyVersion !== "" && !status.degradedGlobal;
      if (!policyRuntimeAck) {
        console.error("[enabled-tables] ktx.yaml written but policy runtime not acknowledged", {
          connId,
          policyVersion: status.policyVersion,
          degradedGlobal: status.degradedGlobal
        });
      }
    } catch (err) {
      console.error("[enabled-tables] ktx.yaml written but commitEffectivePolicy failed", err);
      policyRuntimeAck = false;
    }

    const executionAck = await executionAckForConnection(connId);
    const executionRuntimePending = await noteExecutionRuntimePending(projectRoot, digestBefore);

    return {
      ok: true,
      data: {
        written: true,
        auditId,
        oldEnabledTables,
        newEnabledTables,
        warnings,
        policyVersion,
        policyRuntimeAck,
        catalogRuntimeAck,
        ...executionAck,
        executionRuntimePending,
        runtimeAck: policyRuntimeAck
      }
    };
    })
    );
  });

  app.post<{
    Params: { connId: string };
    Body: { purpose?: string };
  }>("/api/connections/:connId/test", async (request, reply) => withRequestTiming(request, async () => {
    const purpose = parseProbePurpose(request.body?.purpose);
    if (!purpose) throw enabledTableError("BAD_REQUEST", "purpose must be automatic or manual");
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    // Spec 174 §5 — bounded shared queue; latencyMs stays the KTX command time only.
    const generation = displayGenerations().L;
    const { value: result, timing } = await probeScheduler.submit({
      key: `${projectRoot}\u0000L${generation}\u0000${connId}\u0000test`,
      generation,
      purpose,
      signal: clientAbortSignal(reply),
      run: () => testConnection(projectRoot, connId)
    });
    logProbeTiming(request, "test", purpose, timing);
    return { ok: true, data: result };
  }));

  app.post<{
    Params: { connId: string };
    Body: { dryRun?: boolean; deleteSecret?: boolean; deleteAssets?: boolean };
  }>("/api/connections/:connId/remove", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    const digestBefore = await ktxDigestSnapshot(projectRoot);
    const result = await removeConnection(projectRoot, connId, dryRun, {
      recordConfigChange,
      deleteSecret: body.deleteSecret,
      deleteAssets: body.deleteAssets
    });
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
      if ("deletedFiles" in result) {
        for (const filePath of result.deletedFiles) {
          writtenFiles.push({ filePath });
        }
      }
    }
    const executionRuntimePending = dryRun
      ? false
      : await noteExecutionRuntimePending(projectRoot, digestBefore);
    return { ok: true, data: { ...result, executionRuntimePending } };
  });

  app.post<{
    Params: { connId: string };
    Body: { schema?: string; dryRun?: boolean };
  }>("/api/connections/:connId/schemas", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (typeof body.schema !== "string") {
      throw enabledTableError("BAD_REQUEST", "schema is required");
    }
    const digestBefore = await ktxDigestSnapshot(projectRoot);
    const result = await addSchema(projectRoot, connId, body.schema, dryRun, {
      recordConfigChange
    });
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
    }
    const executionRuntimePending = dryRun
      ? false
      : await noteExecutionRuntimePending(projectRoot, digestBefore);
    return { ok: true, data: { ...result, executionRuntimePending } };
  });

  app.post<{
    Params: { connId: string };
    Body: { schema?: string; dryRun?: boolean; deleteManifest?: boolean; deleteOverlays?: boolean };
  }>("/api/connections/:connId/schemas/remove", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (typeof body.schema !== "string") {
      throw enabledTableError("BAD_REQUEST", "schema is required");
    }
    const digestBefore = await ktxDigestSnapshot(projectRoot);
    const result = await removeSchema(projectRoot, connId, body.schema, dryRun, {
      recordConfigChange,
      deleteManifest: body.deleteManifest,
      deleteOverlays: body.deleteOverlays
    });
    if (!dryRun) {
      writtenFiles.push({ filePath: "ktx.yaml" });
      if ("deletedFiles" in result) {
        for (const filePath of result.deletedFiles) {
          writtenFiles.push({ filePath });
        }
      }
    }
    const executionRuntimePending = dryRun
      ? false
      : await noteExecutionRuntimePending(projectRoot, digestBefore);
    return { ok: true, data: { ...result, executionRuntimePending } };
  });

  // M14: deprecated alias for `/api/connections/:connId/ingest`. The M13
  // route used to shell out to `ktx ingest <conn>`, which transitively
  // required LLM/embedding/enrichment configuration. We now satisfy the
  // request by reloading the static local catalog and return a `deprecated:
  // true` envelope so legacy clients get a structured 200 response instead
  // of a 404 or an enrichment-misconfiguration crash.
  app.post<{
    Params: { connId: string };
    Body: { schema?: string };
  }>("/api/connections/:connId/ingest", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { connId } = request.params;
    const body = request.body ?? {};
    const schema = typeof body.schema === "string" && body.schema.trim().length > 0
      ? body.schema.trim()
      : undefined;
    const reload = await reloadCatalog(projectRoot, {
      connectionId: connId,
      ...(schema ? { schema } : {}),
      deprecatedIngestAlias: true
    });
    return {
      ok: true,
      data: {
        deprecated: true,
        replacement: "/api/catalog/reload",
        message: "WebUI no longer executes ktx ingest. Static catalog reload completed.",
        reload
      }
    };
  });

  app.get<{
    Params: { connId?: string };
  }>("/api/connections/ingest-runs", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const data: IngestRunsResponse = await readLegacyIngestRuns(projectRoot);
    if (request.params.connId && data.lastByConnection[request.params.connId] === undefined) {
      // No history for that connection: still return an empty record so the
      // frontend can render "未运行" without falling back to the global view.
      return { ok: true, data: { runs: [], lastByConnection: {} } };
    }
    return { ok: true, data };
  });

  // M14: the new core catalog refresh endpoints. They read only the local
  // filesystem and never shell out to the ktx CLI. They are the replacement
  // for the M13 ingest route (which is preserved as a deprecated alias above).
  app.post<{
    Body: { connectionId?: string; schema?: string };
  }>("/api/catalog/reload", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const connectionId =
      typeof body.connectionId === "string" && body.connectionId.trim().length > 0
        ? body.connectionId.trim()
        : undefined;
    const schema =
      typeof body.schema === "string" && body.schema.trim().length > 0
        ? body.schema.trim()
        : undefined;
    const run = await reloadCatalog(projectRoot, {
      ...(connectionId ? { connectionId } : {}),
      ...(schema ? { schema } : {})
    });
    return { ok: true, data: run };
  });

  app.get("/api/catalog/reloads", async () => {
    const projectRoot = await resolveProjectRoot();
    const data: CatalogReloadsResponse = await readCatalogReloads(projectRoot);
    return { ok: true, data };
  });

  // ─── M17: Controlled YAML catalog asset upload ───────────────────────────
  // WebUI uses these endpoints to let analysts commit a schema manifest
  // without going through ops. The target path is server-computed, never
  // client-supplied. Symlink chains and arbitrary writes are rejected.

  app.post<{
    Body: Partial<CatalogAssetValidateRequest>;
  }>("/api/catalog/assets/validate", { bodyLimit: SEMANTIC_BATCH_LIMITS.maxHttpBodyBytes }, async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const rawAssetKind = (body as { assetKind?: unknown }).assetKind;
    const rawAssetType = (body as { assetType?: unknown }).assetType;
    const validation = await validateCatalogAsset(projectRoot, {
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      schema: typeof body.schema === "string" ? body.schema : "",
      assetKind: rawAssetKind as CatalogAssetValidateRequest["assetKind"],
      assetType: rawAssetType as CatalogAssetValidateRequest["assetType"],
      filename: typeof body.filename === "string" ? body.filename : "",
      content: typeof body.content === "string" ? body.content : ""
    });
    return reply.send({ ok: true, data: validation });
  });

  app.post<{
    Body: Partial<CatalogAssetUploadRequest>;
  }>("/api/catalog/assets/upload", { bodyLimit: SEMANTIC_BATCH_LIMITS.maxHttpBodyBytes }, async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const rawAssetKind = (body as { assetKind?: unknown }).assetKind;
    const rawAssetType = (body as { assetType?: unknown }).assetType;
    const upload: CatalogAssetUploadRequest = {
      connectionId: typeof body.connectionId === "string" ? body.connectionId : "",
      schema: typeof body.schema === "string" ? body.schema : "",
      assetKind: rawAssetKind as CatalogAssetUploadRequest["assetKind"],
      assetType: rawAssetType as CatalogAssetUploadRequest["assetType"],
      filename: typeof body.filename === "string" ? body.filename : "",
      content: typeof body.content === "string" ? body.content : "",
      confirmOverwrite: body.confirmOverwrite === true
    };
    try {
      const result = await uploadCatalogAsset(projectRoot, upload);
      return reply.send({ ok: true, data: result });
    } catch (error) {
      if (error instanceof CatalogAssetValidationError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: { validation: error.validation }
        });
      }
      if (error instanceof CatalogAssetOverwriteRequiredError) {
        reply.status(409);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: { validation: error.validation }
        });
      }
      throw error;
    }
  });

  app.get("/api/catalog/assets/uploads", async () => {
    const projectRoot = await resolveProjectRoot();
    return { ok: true, data: await readCatalogAssetUploads(projectRoot) };
  });

  app.get<{
    Querystring: Partial<CatalogSchemaManifestReadRequest>;
  }>("/api/catalog/assets/schema-manifest", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    try {
      const data = await readCatalogSchemaManifest(projectRoot, {
        connectionId: typeof request.query.connectionId === "string" ? request.query.connectionId : "",
        schema: typeof request.query.schema === "string" ? request.query.schema : ""
      });
      return reply.send({ ok: true, data });
    } catch (error) {
      if (error instanceof CatalogAssetReadError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });

  // ─── M19: Semantic Asset Self-Service Publish And Export ────────────────

  app.post<{
    Body: Partial<SemanticAssetValidateRequest>;
  }>("/api/semantic-assets/validate", { bodyLimit: SEMANTIC_BATCH_LIMITS.maxHttpBodyBytes }, async (request, reply) => {
    const projectRoot = await resolveProjectRoot();

    // ★ Lucy v0.25 / L25-11 §8 (D11): the envelope is validated BEFORE any
    // unpacking or semantic check. A single malformed entry rejects the WHOLE
    // batch — the old behaviour filtered the bad entries out and then
    // validated the rest, which silently accepted a 29-valid + 1-broken batch.
    let envelope;
    try {
      assertSemanticHttpBodySize(Buffer.byteLength(JSON.stringify(request.body ?? {}), "utf8"));
      envelope = parseSemanticValidateEnvelope(request.body ?? {});
    } catch (error) {
      if (error instanceof SemanticBatchError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: { errors: error.errors }
        });
      }
      throw error;
    }

    // ★ L25-11 §5 / §12 (D12): a maintenance package is staged against the
    // SERVER-SIDE export baseline. The client cannot re-authorize anything.
    // The package declares its kind in its metadata — a generic ZIP of YAML
    // files keeps its existing meaning.
    const uploadedPackages = envelope.packages.map((file) => ({
      filename: file.filename,
      buffer: Buffer.from(file.contentBase64, "base64")
    }));
    const maintenancePackage = uploadedPackages.find((file) =>
      isMaintenancePackageZip(file.buffer)
    );
    if (maintenancePackage) {
      try {
        const instanceId = await resolveSemanticInstanceId(projectRoot);
        const actor = actorIdFromRequest(request);
        const staged = await stageSemanticMaintenanceImport(projectRoot, {
          actor,
          instanceId,
          zip: maintenancePackage.buffer
        });        // ★ L25-11 §3.2: the import only writes the CONTROLLED STAGING. The
        // formal files and the index stay untouched until the publish
        // workbench confirms the complete plan.
        if (staged.status === "staged") {
          await persistSemanticBatchSnapshot(projectRoot, {
            validationId: staged.validationId,
            batchId: staged.batchId,
            scopeId: staged.scopeId,
            exportId: staged.exportId,
            instanceId,
            actor,
            candidateDigest: staged.candidateDigest,
            planDigest: staged.planDigest,
            refs: staged.refs,
            dependencies: staged.dependencies,
            targetDigests: staged.targetDigests,
            overwriteSet: staged.overwriteSet,
            candidates: staged.candidates,
            changedSources: staged.changedSources,
            diff: staged.diff
          });
        }

        // ★ L25-11 §7.3 (D22): the staging is audited as "staged" — never as a
        // publish. The staging itself has no formal effect.
        const stagePayload = buildSemanticBatchAuditPayload({
          actor,
          actorType: "ui_admin",
          operationId: `stage_${staged.batchId}`,
          outcome: staged.status === "staged" ? "staged" : "validated",
          scopeId: staged.scopeId,
          planDigest: staged.planDigest,
          candidateDigest: staged.candidateDigest,
          objectCount: staged.candidates.length,
          recovery: { recoveryRequired: false, activationStatus: "unknown" },
          details: {
            batchId: staged.batchId,
            exportId: staged.exportId,
            status: staged.status,
            overwriteSet: staged.overwriteSet,
            dependencyCount: staged.dependencies.length
          }
        });
        await recordConfigChange(buildSemanticBatchAuditRecord(stagePayload));
        return reply.send({
          ok: true,
          data: {
            valid: staged.status === "staged",
            validationId: staged.validationId,
            batchId: staged.batchId,
            status: staged.status,
            noChange: staged.status === "no_change",
            scopeId: staged.scopeId,
            exportId: staged.exportId,
            candidateDigest: staged.candidateDigest,
            planDigest: staged.planDigest,
            targetDigests: staged.targetDigests,
            overwriteSet: staged.overwriteSet,
            dependencies: staged.dependencies,
            readonlyEntries: staged.readonlyEntries,
            files: staged.candidates.map((candidate) => ({
              originalFilename: `${candidate.identity.connectionId}/${candidate.identity.table}.yaml`,
              kind: "semanticSource" as const,
              targetPath: candidate.targetPath,
              exists: !candidate.absentBefore,
              sizeBytes: Buffer.byteLength(candidate.content, "utf8"),
              sha256: createHash("sha256").update(Buffer.from(candidate.content, "utf8")).digest("hex"),
              connectionId: candidate.identity.connectionId,
              schema: candidate.identity.schema,
              sourceName: candidate.identity.table,
              physicalTable: `${candidate.identity.schema}.${candidate.identity.table}`,
              warnings: []
            })),
            changedSources: staged.changedSources,
            diff: staged.diff,
            warnings: [],
            errors: []
          }
        });
      } catch (error) {
        if (error instanceof SemanticBatchError) {
          reply.status(error.statusCode);
          return reply.send({
            ok: false,
            error: { code: error.code, message: error.message },
            data: { errors: error.errors }
          });
        }
        throw error;
      }
    }

    const result = await validateSemanticAssets(projectRoot, {
      files: envelope.files,
      packages: envelope.packages,
      defaultConnectionId: envelope.defaultConnectionId,
      defaultSchema: envelope.defaultSchema
    });
    return reply.send({ ok: true, data: result });
  });

  app.post<{
    Body: Partial<SemanticAssetPublishRequest>;
  }>("/api/semantic-assets/publish", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    const validationId =
      typeof body.validationId === "string" ? body.validationId : "";
    try {
      const result = await publishSemanticAssets(
        projectRoot,
        {
          validationId,
          confirmOverwrite: body.confirmOverwrite === true,
          ...(typeof body.planDigest === "string" ? { planDigest: body.planDigest } : {}),
          ...(Array.isArray(body.overwriteTargets)
            ? { overwriteTargets: body.overwriteTargets.filter((t): t is string => typeof t === "string") }
            : {}),
          ...(typeof body.idempotencyKey === "string" ? { idempotencyKey: body.idempotencyKey } : {}),
          ...(body.exemption ? { exemption: body.exemption } : {})
        },
        { actor: actorIdFromRequest(request) }
      );
      return reply.send({ ok: true, data: result });
    } catch (error) {
      if (error instanceof SemanticAssetValidationError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message },
          data: {
            errors: error.errors,
            ...(error.release ? { release: error.release } : {})
          }
        });
      }
      throw error;
    }
  });

  function parseReleaseListQuery(q: {
    since?: string;
    until?: string;
    trigger?: string;
    reindexStatus?: string;
    actor?: string;
    limit?: string;
    offset?: string;
    businessChangesOnly?: string;
  }): SemanticAssetReleaseListQuery {
    const trigger =
      q.trigger === "webui_publish" ||
      q.trigger === "webui_manual_reindex" ||
      q.trigger === "webui_restore"
        ? (q.trigger as SemanticAssetReleaseTrigger)
        : undefined;
    const reindexStatus =
      q.reindexStatus === "success" ||
      q.reindexStatus === "failed" ||
      q.reindexStatus === "running" ||
      q.reindexStatus === "not_run"
        ? q.reindexStatus
        : undefined;
    const limitRaw = q.limit != null && q.limit !== "" ? Number(q.limit) : undefined;
    const offsetRaw = q.offset != null && q.offset !== "" ? Number(q.offset) : undefined;
    return {
      businessChangesOnly:
        q.businessChangesOnly === "true" || q.businessChangesOnly === "1" ? true : undefined,
      since: q.since || undefined,
      until: q.until || undefined,
      trigger,
      reindexStatus,
      actor: q.actor || undefined,
      limit: limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined,
      offset: offsetRaw != null && Number.isFinite(offsetRaw) ? offsetRaw : undefined
    };
  }

  app.get<{
    Querystring: {
      since?: string;
      until?: string;
      trigger?: string;
      reindexStatus?: string;
      actor?: string;
      limit?: string;
      offset?: string;
      /** Spec §6 — keep only the batches that carried a business change. */
      businessChangesOnly?: string;
    };
  }>("/api/semantic-assets/releases", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const query = parseReleaseListQuery(request.query);
    const listed = await readSemanticAssetReleases(projectRoot, query);
    return {
      ok: true,
      data: { ...listed, records: listed.records.map((record) => projectPublicRelease(record)) }
    };
  });

  app.get<{
    Querystring: {
      since?: string;
      until?: string;
      trigger?: string;
      reindexStatus?: string;
      actor?: string;
    };
  }>("/api/semantic-assets/releases/export.csv", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const query = parseReleaseListQuery(request.query);
    // Export ignores pagination — full filtered set.
    delete query.limit;
    delete query.offset;
    const listed = await readSemanticAssetReleases(projectRoot, query);
    const records = listed.records.map((record) => projectPublicRelease(record));
    const stamp = formatPublishHistoryExportFilenameStamp();
    const filename = `publish-history-${stamp}.csv`;
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(buildPublishHistoryCsvRows(records));
  });

  app.get<{
    Params: { id: string };
  }>("/api/semantic-assets/releases/:id/status", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const record = await readSemanticAssetRelease(projectRoot, request.params.id);
    if (!record) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: {
          code: "RELEASE_NOT_FOUND",
          message: `Release ${request.params.id} was not found`
        }
      });
    }
    return { ok: true, data: { release: projectPublicRelease(record) } };
  });

  app.post<{ Params: { id: string } }>(
    "/api/semantic-assets/releases/:id/restore/preview",
    async (request, reply) => {
      const projectRoot = await resolveProjectRoot();
      try {
        const preview = await previewSemanticRestore(
          projectRoot,
          request.params.id,
          actorIdFromRequest(request)
        );
        return { ok: true, data: preview };
      } catch (error) {
        if (error instanceof SemanticRestoreError) {
          reply.status(error.statusCode);
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        throw error;
      }
    }
  );

  app.post<{
    Params: { id: string };
    Body: { previewId?: string; planDigest?: string; idempotencyKey?: string };
  }>("/api/semantic-assets/releases/:id/restore", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    try {
      const result = await submitSemanticRestore(projectRoot, {
        sourceReleaseId: request.params.id,
        previewId: typeof body.previewId === "string" ? body.previewId : "",
        planDigest: typeof body.planDigest === "string" ? body.planDigest : "",
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        actor: actorIdFromRequest(request)
      });
      return { ok: true, data: { ...result, release: projectPublicRelease(result.release) } };
    } catch (error) {
      if (error instanceof SemanticRestoreError) {
        reply.status(error.statusCode);
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/semantic-assets/releases/:id/restore-package",
    async (request, reply) => {
      const projectRoot = await resolveProjectRoot();
      try {
        const packed = await buildSemanticRestorePackage(projectRoot, request.params.id);
        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename="${packed.filename}"`);
        return reply.send(packed.body);
      } catch (error) {
        if (error instanceof SemanticRestoreError) {
          reply.status(error.statusCode);
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        throw error;
      }
    }
  );

  /**
   * L25-15 §5.6 — the index range confirmation object of a restore batch.
   *
   * It confirms the index scope without recomputing a content restore plan.
   * A pre-check against the source batch would fail the CAS (the restore
   * already landed); a pre-check against the restore batch would build a
   * reverse restore.
   */
  app.get<{ Params: { id: string } }>(
    "/api/semantic-assets/releases/:id/restore-index-scope",
    async (request, reply) => {
      const projectRoot = await resolveProjectRoot();
      try {
        return { ok: true, data: await readRestoreIndexScope(projectRoot, request.params.id) };
      } catch (error) {
        if (error instanceof SemanticRestoreError) {
          reply.status(error.statusCode);
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        throw error;
      }
    }
  );

  /**
   * L25-15 §5.6 — the restore batch's own index retry.
   *
   * The restore write set is not written again. The retry re-runs the index
   * with the mode the release record persisted and keeps the original failed
   * attempt.
   */
  app.post<{
    Params: { id: string };
    Body: { scopeDigest?: string; idempotencyKey?: string };
  }>("/api/semantic-assets/releases/:id/restore-retry-index", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};
    try {
      const result = await retryRestoreIndex(projectRoot, {
        releaseId: request.params.id,
        scopeDigest: typeof body.scopeDigest === "string" ? body.scopeDigest : "",
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        actor: actorIdFromRequest(request)
      });
      return { ok: true, data: { ...result, release: projectPublicRelease(result.release) } };
    } catch (error) {
      if (error instanceof SemanticRestoreError) {
        reply.status(error.statusCode);
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      throw error;
    }
  });

  app.post<{
    Body: { force?: boolean; pendingDigest?: string };
  }>("/api/semantic-assets/reindex", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const force = request.body?.force === true;
    const confirmedPendingDigest =
      typeof request.body?.pendingDigest === "string" && request.body.pendingDigest.trim()
        ? request.body.pendingDigest.trim()
        : null;
    // Lucy v0.25 (L25-11 D4) — the manual reindex shares the publish window. A lock
    // left behind by a crashed process is reclaimed by the coordinator, so a stale
    // lock file must not block the reindex forever.
    const busy = await isPublishCoordinatorBusy(projectRoot);
    if (busy.busy) {
      reply.status(409);
      return reply.send({
        ok: false,
        error: {
          code: "REINDEX_IN_PROGRESS",
          message: "已有发布批次正在重建索引，请等待当前批次完成后再试"
        }
      });
    }
    const startedAt = new Date().toISOString();
    const consumedFiles = writtenFiles.slice();
    const consumedSourceEntries = [...changedSources.entries()];
    const attemptId = `att_manual_${randomUUID()}`;
    try {
      // The history record is part of the same critical section as the index
      // (L25-11 §7.2). Writing it after the coordinator returns would let
      // another writer in before the terminal record exists.
      const outcome = await withPublishCoordinator(
        "manual_reindex",
        async () => {
          // Spec §6 — the confirmation is bound to a content version. The
          // version is re-checked INSIDE the publish window, because the
          // content can change between the confirmation and the submission.
          if (confirmedPendingDigest) {
            const current = await readPublishPendingSnapshot(projectRoot);
            if (current.pendingDigest !== confirmedPendingDigest) {
              throw new SemanticAssetValidationError(
                "PUBLISH_CONTENT_VERSION_CHANGED",
                "待发布内容已变化，本次确认已失效，请重新核对后再提交。",
                [],
                409
              );
            }
          }
          // Lucy v0.25 / L25-11 §7.1–§7.2 (D3): the recovery check must run
          // BEFORE the index is rebuilt. Reindexing while a semantic write is
          // unresolved would derive an index state from targets whose write
          // outcome is still unknown.
          if (await isRecoveryRequired(projectRoot)) {
            throw new SemanticAssetValidationError(
              "semantic_recovery_required",
              "上一笔语义写入存在未决恢复日志，恢复核验完成前不允许手动索引。",
              [],
              409
            );
          }
          // Spec §5.3 — capture the content version that is about to be
          // consumed BEFORE the index reads the content root. The baseline is
          // advanced from THIS capture, never from a disk read after the
          // index returned.
          const consumption = await beginPublishConsumptionEvidence(
            projectRoot,
            attemptId,
            "pending"
          );
          const reindex = await reindexProject(projectRoot, { force });
          const finishedAt = new Date().toISOString();
          const reindexRecord = {
            ok: reindex.exitCode === 0,
            exitCode: reindex.exitCode,
            stdout: reindex.stdout,
            stderr: reindex.stderr
          };
          // M32: write a lightweight history record so /publish/history can show
          // the reindex result alongside normal publish batches. The snapshot is
          // the pending set at sync start, so a write that lands during reindex
          // stays on the workbench for the next sync.
          const pending = await describePendingReleaseAssets(projectRoot, {
            filePaths: consumedFiles.map((file) => file.filePath),
            sources: consumedSourceEntries.map(([, source]) => source)
          });
          const historyRecord = await recordManualReindex(projectRoot, {
            actor: actorIdFromRequest(request),
            force,
            startedAt,
            reindex: reindexRecord,
            files: pending.files,
            changedSources: pending.changedSources,
            connectionIds: pending.connectionIds
          });
          if (reindexRecord.ok) {
            const consumed = new Set(consumedFiles);
            for (let index = writtenFiles.length - 1; index >= 0; index -= 1) {
              if (consumed.has(writtenFiles[index])) writtenFiles.splice(index, 1);
            }
            for (const [key, value] of consumedSourceEntries) {
              if (changedSources.get(key) === value) changedSources.delete(key);
            }
            // The terminal evidence is durable. Advance the baseline in the
            // SAME serial window: index success → terminal audit → baseline
            // CAS → attempt finalized → window released. A drift between the
            // capture and this point keeps the baseline unchanged, so the
            // content stays pending and must be re-checked.
            await commitPublishConsumptionEvidence(
              projectRoot,
              attemptId,
              historyRecord.id,
              consumption
            );
          }
          return { historyRecord, finishedAt, reindexRecord };
        },
        { projectRoot }
      );
      const after = await readPublishPendingSnapshot(projectRoot);
      return {
        ok: true,
        data: {
          id: outcome.historyRecord.id,
          force,
          startedAt,
          finishedAt: outcome.finishedAt,
          reindex: outcome.reindexRecord,
          pendingDigest: after.pendingDigest,
          baselineState: after.baselineState,
          baselineGeneration: after.baselineGeneration
        }
      };
    } catch (error) {
      if (error instanceof SemanticAssetValidationError) {
        reply.status(error.statusCode);
        return reply.send({
          ok: false,
          error: { code: error.code, message: error.message }
        });
      }
      throw error;
    }
  });

  app.post<{
    Body: {
      scope?: { connectionId?: string; schema?: string };
      includeWiki?: boolean;
      includeEvals?: boolean;
      includeSkills?: boolean;
      includeSanitizedKtxYaml?: boolean;
      /** Lucy v0.25 / L25-11 §8 — the explicit maintenance-package mode. */
      packageKind?: string;
      scopeId?: string;
    };
  }>("/api/semantic-assets/export", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const body = request.body ?? {};

    // ★ Lucy v0.25 / L25-11 §5 / §8 (D4/D7/D11): the maintenance package is a
    // DIFFERENT format with its own explicit kind. It is built from a scope
    // snapshot and carries a server-side export baseline; the generic export
    // keeps its existing meaning.
    if (body.packageKind === "semantic-maintenance-package/v1") {
      try {
        const scopeId = typeof body.scopeId === "string" ? body.scopeId : "";
        const instanceId = await resolveSemanticInstanceId(projectRoot);
        const actor = actorIdFromRequest(request);
        const result = await exportSemanticMaintenancePackage(projectRoot, {
          actor,
          instanceId,
          scopeId,
          // ★ L25-11 §7.3 (D22): the export audit is persisted BEFORE the
          // package is handed out. A failed audit fails the export closed.
          beforeDeliver: async (info) => {
            const payload = buildSemanticBatchAuditPayload({
              actor,
              actorType: "ui_admin",
              operationId: `export_${info.exportId}`,
              outcome: "exported",
              scopeId,
              baselineDigest: undefined,
              objectCount: info.selectedCount,
              recovery: { recoveryRequired: false, activationStatus: "unknown" },
              details: {
                exportId: info.exportId,
                packageDigest: info.packageDigest,
                entryCount: info.entryCount,
                dependencyCount: info.dependencyCount
              }
            });
            await recordConfigChange(buildSemanticBatchAuditRecord(payload));
          }
        });
        return reply.send({ ok: true, data: result });
      } catch (error) {
        if (error instanceof SemanticBatchError) {
          reply.status(error.statusCode);
          return reply.send({
            ok: false,
            error: { code: error.code, message: error.message },
            data: { errors: error.errors }
          });
        }
        throw error;
      }
    }

    const scope =
      body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
        ? {
            connectionId:
              typeof body.scope.connectionId === "string" ? body.scope.connectionId : undefined,
            schema: typeof body.scope.schema === "string" ? body.scope.schema : undefined
          }
        : undefined;
    const exportRequest = {
      ...(scope ? { scope } : {}),
      includeWiki: body.includeWiki === true,
      includeEvals: body.includeEvals === true,
      includeSkills: body.includeSkills === true,
      includeSanitizedKtxYaml: body.includeSanitizedKtxYaml !== false
    };
    const result = await exportSemanticAssetPackage(projectRoot, exportRequest);
    await recordSemanticAssetExport(actorIdFromRequest(request), exportRequest, result);
    return { ok: true, data: result };
  });

  app.get<{
    Params: { exportId: string };
  }>("/api/semantic-assets/exports/:exportId/download", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const exportId = request.params.exportId;
    if (!/^exp_\d{8}_\d{6}_\d{3}_[0-9a-f]{8}$/.test(exportId)) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: {
          code: "EXPORT_NOT_FOUND",
          message: `Export ${exportId} 不存在或已过期`
        }
      });
    }
    // ★ Lucy v0.25 / L25-11 §4.5: a maintenance package download re-checks the
    // operator that produced it. An export id is not a bearer token.
    const baseline = await readMaintenanceExportBaseline(projectRoot, exportId);
    if (baseline?.actor && baseline.actor !== actorIdFromRequest(request)) {
      reply.status(403);
      return reply.send({
        ok: false,
        error: {
          code: "EXPORT_FORBIDDEN",
          message: "该导出记录属于其他操作者，不能直接下载。"
        }
      });
    }
    const exportsDir = path.resolve(projectRoot, ".ktx-ui", "exports");
    const zipPath = path.join(exportsDir, `${exportId}.zip`);
    let exists = false;
    try {
      const info = await lstat(zipPath);
      exists = info.isFile() && !info.isSymbolicLink();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (!exists) {
      reply.status(404);
      return reply.send({
        ok: false,
        error: {
          code: "EXPORT_NOT_FOUND",
          message: `Export ${exportId} 不存在或已过期`
        }
      });
    }
    reply.type("application/zip");
    reply.header(
      "Content-Disposition",
      `attachment; filename="lucy-semantic-asset-${exportId}.zip"`
    );
    return reply.send(createReadStream(zipPath));
  });

  // ★ Lucy v0.25 / L25-11 §8 (D11/D10): the batch loop routes — scope
  // creation, the independent batch check, and the operation polling/cancel.
  registerSemanticBatchRoutes(app);

  registerAuthRoutes(app);
  registerAdminAccountRoutes(app);
  registerOidcRoutes(app);
  registerBrandingRoutes(app);
  registerAgentRoutes(app);
  registerRoleRoutes(app);
  registerTokenRoutes(app);
  registerPolicyRuntimeRoutes(app);
  registerAuditRoutes(app);
  registerAgentAuditRoutes(app);
  // Lucy v0.25 / P0-4 E1 — the reconciliation view reuses L25-09's own
  // derivation and coverage sources instead of owning a second set of rules.
  configureReconciliationPorts({
    primaryStatus: productionPrimaryStatusPort,
    auditCoverage: createProductionAuditCoveragePort()
  });
  // Lucy v0.25 / L25-14 R2 — 行级策略预览（只读，不进入发布协调器）。
  registerRowPolicyRoutes(app);
  // Lucy v0.25 / L25-14 R1 — 行策略模板管理 + 按表反查（模板写入口走共享协调器）。
  registerRowPolicyTemplateRoutes(app);
  // Lucy v0.25 / L25-01 — Agent 与角色授权摘要（只读）。
  registerAuthorizationSummaryRoutes(app);
  // Lucy v0.25 / L25-08 — 访问关系图（只读）。
  registerAccessMapRoutes(app);
  // Lucy v0.25 / L25-10 — Hive 连接配置面（凭据只存引用；本轮不含 JDBC 执行）。
  registerHiveConnectionRoutes(app);
  // Lucy v0.25 / L25-02、L25-03 — 审计只读对账视图（三端点）。
  registerAuditReconciliationRoutes(app);
  registerMcpToolsRoutes(app);
  registerMcpPlaygroundRoutes(app);
  registerMcpRuntimeRoutes(app);
  registerGovernanceObservabilityRoutes(app);
  registerUiUsageRoutes(app);
  registerCaseRoutes(app);
  registerSecurityCandidateRoutes(app);
  registerSuiteImportRoutes(app);
  registerRunnerRoutes(app);
  registerMonitorRoutes(app);
  registerFieldQuestionRoutes(app);
  registerR1ObservabilityRoutes(app);
  registerCallMonitorRoutes(app);
  registerRiskReviewRoutes(app);
  registerReleaseReadinessRoutes(app);
  registerImportScopeRoutes(app);
  // Spec 190 §7 — live table list, reconciliation, structure diff, discovery config.
  registerLiveDiscoveryRoutes(app);
  registerSkillsRoutes(app);
  // Lucy v0.25 / L25-05 — 可选 SMTP 通知：只读状态端点（owner-only）。
  registerNotificationRoutes(app);

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Route ${request.method} ${request.url} not found`
        }
      } satisfies ErrorEnvelope);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply.status(404).send({
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `Route ${request.method} ${request.url} not found`
        }
      } satisfies ErrorEnvelope);
    }
    return serveStaticAsset(request, reply, distDir());
  });

  return app;
}

export type StartupTimings = {
  policyMs: number;
  catalogScanMs: number;
  listenMs: number;
  displayReadyMs: number | null;
};

/** Spec 174 T0 — shared startup sequence (also used by the performance fixture server). */
export async function startServer(options: { displayPrewarm?: boolean } = {}): Promise<{
  app: ReturnType<typeof buildServer>;
  proxy: ReturnType<typeof buildProxy>["server"];
  host: string;
  port: number;
  timings: StartupTimings;
}> {
  const t0 = performance.now();
  // Spec §14.3.1 — the access-configuration recovery is verified BEFORE the
  // affected data plane and the access writes are opened. The durable marker
  // AND the unterminated row-policy intents are both checked; a source that
  // cannot be read, is corrupt or cannot be decided closes the gate
  // conservatively. A corrupt marker is never overwritten automatically.
  try {
    const recoveryRoot = await resolveProjectRoot();
    const verification = await verifyAccessRecoveryOnStartup(recoveryRoot);
    if (!verification.ok) {
      console.error(
        `[access-recovery] access configuration recovery is required (${verification.reason ?? "unknown"}); the affected data plane and the access writes stay closed until an administrator verifies the recovery`
      );
    }
  } catch (error) {
    console.error("[access-recovery] the recovery state could not be established:", error);
  }
  // Spec 149 §8 — 运维问数连接的确保在**策略编译之前**：
  // 视图、连接块、内容根资产与项目根镜像都要在 EffectivePolicy 提交前就位，
  // 否则目录能看见连接而执行层不认。失败只关闭这一个连接，不影响其它数据面。
  try {
    const { ensureOpsEvidence } = await import("./ops-evidence/ensure.js");
    const opsEvidence = await ensureOpsEvidence();
    if (opsEvidence.readiness !== "current") {
      console.warn(
        `[ops-evidence] readiness=${opsEvidence.readiness}` +
          `${opsEvidence.detail ? ` (${opsEvidence.detail})` : ""}; the ops evidence connection is not queryable`
      );
    }
  } catch (error) {
    console.error(
      "[ops-evidence] ensure failed; the ops evidence connection stays unavailable:",
      error
    );
  }
  // Spec 98 §8.3 — compile verified EffectivePolicy before accepting traffic.
  // Empty policyVersion must not be the steady-state after a clean start.
  const { commitEffectivePolicy } = await import("./proxy/acl.js");
  await commitEffectivePolicy();
  const t1 = performance.now();

  // Perform initial catalog scan so local YAML assets are ready on cold boot
  try {
    const projectRoot = await resolveProjectRoot();
    await reloadCatalog(projectRoot);
  } catch (error) {
    console.warn("[catalog-reload] initial scan failed on startup:", error);
  }
  const t2 = performance.now();

  // Lucy v0.25 / L25-05 — 通知在监听端口前初始化；失败只关闭通知本身。
  await initNotifications();

  // ★ Lucy v0.25 / L25-11 §7.2 (D18): the semantic recovery journals are
  // resolved BEFORE the WebUI starts listening. A journal that cannot be
  // decided must not be reachable through the API: the listener, the asset
  // writes, the publish and the manual reindex all have to be gated by the
  // recovery admission. Running this after `app.listen()` would leave a
  // window in which the API accepted writes on an unverified target.
  await recoverSemanticJournals();

  // ★ Lucy v0.25 / L25-16 §6.2 (F6-01 / G33): the control plane's non-terminal
  // convergence entry. The operations that the previous process left in a
  // non-terminal state are scanned and converged BEFORE the listener accepts
  // traffic, so no operation can be "in flight" at that moment. Without this,
  // the two non-terminal states would only ever refuse a new attempt and never
  // converge (Spec §6.2 / G33).
  await recoverOpsControlPlane();

  const app = buildServer();
  const host = process.env.LUCY_WEBUI_HOST ?? "127.0.0.1";
  const port = Number(process.env.LUCY_WEBUI_PORT ?? DEFAULT_WEBUI_PORT);
  await app.listen({ host, port });
  const t3 = performance.now();
  let displayReadyMs: number | null = null;
  if (options.displayPrewarm !== false) {
    await prewarmDisplaySnapshots();
    displayReadyMs = performance.now() - t3;
  }

  await recoverResponseLedger();
  const projection = createProjectionScheduler({
    getStore: getSecurityStore,
    getTarget: getAuditDb,
    onStatus: recordProjectionStatus
  });
  const { server: proxy, host: proxyHost, port: proxyPort } = buildProxy({
    onOperationSettled: () => projection.trigger()
  });
  proxy.on("close", () => projection.stop());
  projection.start();
  await new Promise<void>((resolve, reject) => {
    proxy.listen(proxyPort, proxyHost, resolve);
    proxy.on("error", reject);
  });
  console.log(`Lucy WebUI listening on http://${host}:${port}`);
  console.log(`MCP proxy listening on http://${proxyHost}:${proxyPort}/mcp`);
  return {
    app,
    proxy,
    host,
    port,
    timings: { policyMs: t1 - t0, catalogScanMs: t2 - t1, listenMs: t3 - t2, displayReadyMs }
  };
}

/**
 * T07 boot recovery, before the proxy listens: close operations the previous
 * process left open as `interrupted` (never `delivered`), and re-sync the ledger's
 * projection cursor with what the audit database proves. A failure is logged and
 * leaves the stricter state: the proxy still fails closed per request.
 */
async function recoverResponseLedger(): Promise<void> {
  const store = await getSecurityStore();
  if (!store.ok) {
    console.error(`[lucy-audit] ledger recovery skipped: ${store.code}/${store.reason}`);
    return;
  }
  const interrupted = await recoverInterruptedOperations(store.value);
  if (!interrupted.ok) console.error(`[lucy-audit] interrupted-operation recovery failed: ${interrupted.code}`);
  else if (interrupted.value.interrupted.length > 0) {
    console.warn(
      `[lucy-audit] closed ${interrupted.value.interrupted.length} operation(s) as interrupted ` +
        `(${interrupted.value.preparedUnconfirmed.length} had a durable response_prepared)`
    );
  }
  try {
    const target = await getAuditDb();
    const cursor = await recoverProjectionCursor(store.value, AUDIT_PROJECTOR_NAME, () => readTargetCursor(target));
    if (!cursor.ok) console.error(`[lucy-audit] projection cursor recovery failed: ${cursor.code}`);
  } catch (error) {
    console.error("[lucy-audit] projection cursor recovery failed", error instanceof Error ? error.message : "unknown");
  }
}

/**
 * Lucy v0.25 / L25-11 §7.1–§7.2 (D3/D18) — semantic recovery journal recovery.
 *
 * Runs at boot, BEFORE the WebUI listens and before publishing or a manual
 * reindex is allowed. A journal whose target bytes match neither the recorded
 * old nor the recorded new digest is not guessed: it is left for a human, and
 * `isRecoveryRequired()` then keeps publishing and manual reindexing closed.
 */
async function recoverSemanticJournals(): Promise<void> {
  const projectRoot = await resolveProjectRoot();
  const result = await recoverSemanticJournalsAtStartup(projectRoot);
  await reconcileSemanticReleaseStartup(projectRoot).catch((error: unknown) => {
    console.error(
      "[lucy-semantic] release startup reconciliation failed",
      error instanceof Error ? error.message : "unknown"
    );
  });
  // Spec §5.3 — a crash between "the terminal record is durable" and "the
  // baseline advanced" is closed here, idempotently. An attempt without
  // proven terminal evidence keeps the old baseline and is marked uncertain:
  // the reconciliation never rebuilds the index, never rolls content back and
  // never writes a success that was not proven.
  await reconcilePublishWorkbenchAttempts(projectRoot).catch((error: unknown) => {
    console.error(
      "[lucy-publish-workbench] pending baseline reconciliation failed",
      error instanceof Error ? error.message : "unknown"
    );
  });
  if (!result) return;
  if (result.recovered.length > 0) {
    console.warn(`[lucy-semantic] recovered ${result.recovered.length} unfinished semantic journal(s)`);
  }
  if (result.needsRepair.length > 0) {
    console.error(
      `[lucy-semantic] ${result.needsRepair.length} semantic journal(s) need manual repair; ` +
        "publishing and manual reindex stay closed until they are resolved"
    );
  }
  if (result.activationPending.length > 0) {
    // The files are saved and verified, but the activation was never proven.
    // The release keeps `activationStatus = unconfirmed`; the index can be
    // retried from the publish workbench.
    console.warn(
      `[lucy-semantic] ${result.activationPending.length} semantic journal(s) have saved files with an unconfirmed activation`
    );
  }
}

/**
 * Lucy v0.25 / L25-16 §6.2 (F6-01 / G33) — the control plane's convergence
 * entry at boot.
 *
 * Two entries are required by the contract, and neither may be delegated to
 * the existing release-status endpoint (that endpoint only returns records and
 * never writes the control-plane state back):
 *
 * 1. **Recovery scan** — scan the non-terminal operations by operation record
 *    and walk each of them through the §6.2 convergence order.
 * 2. **Release convergence** — write the release terminal state back onto the
 *    targets and the operation.
 *
 * The exclusive ownership of the convergence is held by `recoverPending`
 * (the `recovering` set in `ops-recovery.ts`), so a concurrent recovery of the
 * same operation key is refused rather than entered twice.
 *
 * A failure here is logged and leaves the stricter state: the operation keeps
 * its non-terminal state, and the proxy still fails closed per request.
 */
async function recoverOpsControlPlane(): Promise<void> {
  try {
    const { getOpsDatabase } = await import("./ops/ops-idempotency.js");
    const { recoverNonTerminalOperations, convergePendingActivation } = await import(
      "./ops/ops-recovery.js"
    );
    const { opsAdapterFor } = await import("./ops/ops-tools.js");
    const projectRoot = await resolveProjectRoot();
    const database = await getOpsDatabase();

    const recovery = await recoverNonTerminalOperations({
      adapterFor: opsAdapterFor,
      projectRoot,
      actor: "system",
      delegatedFrom: null,
      database
    });
    const scanned =
      (recovery.ok ? (recovery.data as { scanned?: number }).scanned : undefined) ?? 0;
    if (scanned > 0) {
      console.warn(`[lucy-ops] converged ${scanned} non-terminal control-plane operation(s)`);
    }

    const activation = await convergePendingActivation({ adapterFor: opsAdapterFor, database });
    const converged = (
      activation.ok ? (activation.data as { converged?: unknown[] }).converged : undefined
    ) ?? [];
    if (converged.length > 0) {
      console.warn(`[lucy-ops] wrote back ${converged.length} pending_activation target(s)`);
    }
  } catch (error) {
    console.error(
      "[lucy-ops] control-plane convergence failed",
      error instanceof Error ? error.message : "unknown"
    );
  }
}

async function start() {
  await startServer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
