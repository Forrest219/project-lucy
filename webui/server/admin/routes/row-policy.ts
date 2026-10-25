/**
 * Lucy v0.25 P1 — L25-14 R1 / R3: 行策略模板与按表反查的管理接口.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §4 (管理 API 与写入合同), §5.2 (模板保存), §5.3 (R3 读取与降级), §6.1 / §6.2;
 *   P1-D3（共享单实例发布协调器 + durable intent / terminal）.
 * Upstream: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §5.3（保存前校验、预览与审计闭环）, §9（V13–V17）.
 *
 * Endpoints (mounted by the host session in `webui/server/index.ts`):
 *
 *   GET    /api/admin/row-policy/templates          模板读取模型（只读）
 *   POST   /api/admin/row-policy/templates/validate 候选校验（不落盘、不换入策略）
 *   POST   /api/admin/row-policy/templates           新建
 *   PATCH  /api/admin/row-policy/templates/:name     修改 / 改名
 *   DELETE /api/admin/row-policy/templates/:name     删除
 *   GET    /api/admin/row-policy/views/tables        按表反查列表
 *   GET    /api/admin/row-policy/views/table         按表反查单表详情
 *
 * The write contract is the P0-2 contract, not a new one:
 *
 *   重读基线 → 重建候选 → 重跑预览 → 持久化 intent → 写配置 →
 *   commitEffectivePolicy → 持久化 terminal
 *
 * All of it runs inside the SHARED publish window (`withPublishCoordinator`,
 * re-entrant), so a template save can never interleave with a Role save, an
 * Agent save or a semantic publish. `dryRun` defaults to true: a formal save
 * additionally needs `version` + `candidateDigest`, so a stale preview can
 * never be submitted.
 *
 * The audit carries the actor, the operation id, the before / after digests and
 * the impact surface — and NOTHING else. The diff is scoped to the
 * `row_policy_templates` block, so the Agent token hashes in the same file can
 * never leak into the template audit record.
 */
import { randomUUID } from "node:crypto";
import { stringify } from "yaml";
import type { FastifyInstance } from "fastify";
import { computeCandidateDigest } from "../../config-digest.js";
import { withPublishCoordinator, PublishCoordinatorBusyError } from "../../publish-coordinator.js";
import { resolveProjectRoot } from "../../project.js";
import { auditActorFields, trustedActorFromRequest } from "../../security/request-actor.js";
import {
  ACCESS_YAML_REL,
  makeDiff,
  readAccessYaml,
  writeAccessYaml,
  type YamlAccessConfig
} from "../access-config.js";
import { buildAdminPermissionContext, compileRoleForAdmin } from "../../proxy/acl.js";
import { computeFinalRowsForTable } from "../../proxy/row-policy-preview.js";
import type { RowGrant } from "../../proxy/row-policy.js";
import {
  applyRowPolicyTemplateOperation,
  collectRowPolicyTemplateReferences,
  expandRowPolicyTemplatesInConfig,
  roleIdsOf,
  rowPolicyTemplateUsabilityForTable,
  selectorsOfRole,
  validateRowPolicyTemplateCatalog,
  type AccessConfigWithTemplates,
  type RowPolicyTemplateCatalog,
  type RowPolicyTemplateOperation
} from "../row-policy-templates.js";
import {
  listRowPolicyTables,
  readRowPolicyTableView,
  type RowPolicyTableListFilters
} from "../row-policy-views.js";

/** access.yaml plus the P1 top-level template block. */
type TemplateConfig = YamlAccessConfig & { row_policy_templates?: Record<string, unknown> };

const TEMPLATE_SOURCE = "admin_row_policy_template_api";

function asTemplateConfig(config: YamlAccessConfig): TemplateConfig {
  return config as TemplateConfig;
}

/** The template-scoped diff. Never the whole access.yaml — it holds token hashes. */
function templateBlockDiff(before: TemplateConfig, after: TemplateConfig): string {
  const beforeText = stringify({ row_policy_templates: before.row_policy_templates ?? {} }, { lineWidth: 0 });
  const afterText = stringify({ row_policy_templates: after.row_policy_templates ?? {} }, { lineWidth: 0 });
  return makeDiff(beforeText, afterText);
}

function roleIdsOfUsers(config: TemplateConfig): Map<string, string[]> {
  const byRole = new Map<string, string[]>();
  // `YamlUser` declares the legacy single `role`; the runtime also accepts a
  // `roles` list, so both are read here.
  const users = (config.users ?? []) as Array<{ id: string; role?: string; roles?: string[] }>;
  for (const user of users) {
    const roleIds = Array.isArray(user.roles)
      ? user.roles.filter((value): value is string => typeof value === "string")
      : typeof user.role === "string" && user.role.trim()
        ? [user.role.trim()]
        : [];
    for (const roleId of roleIds) {
      const list = byRole.get(roleId) ?? [];
      list.push(user.id);
      byRole.set(roleId, list);
    }
  }
  return byRole;
}

/** Per Role, the grant this Role holds per table. */
async function roleGrantsByTable(
  config: AccessConfigWithTemplates,
  roleIds: string[]
): Promise<Map<string, Array<{ roleId: string; grant: RowGrant }>>> {
  const byTable = new Map<string, Array<{ roleId: string; grant: RowGrant }>>();
  if (roleIds.length === 0) return byTable;
  const context = await buildAdminPermissionContext(config);
  for (const roleId of roleIds) {
    const compiled = await compileRoleForAdmin(roleId, context);
    if (!compiled.ok) continue;
    for (const capability of compiled.capabilities ?? []) {
      const key = `${capability.connectionId}|${capability.schema}|${capability.sourceName}`;
      const list = byTable.get(key) ?? [];
      list.push({ roleId, grant: capability.rowGrant });
      byTable.set(key, list);
    }
  }
  return byTable;
}

/** The union digest of a table, computed by the ONE union implementation. */
function unionDigest(
  table: { connectionId: string; schema: string; sourceName: string },
  grants: Array<{ roleId: string; grant: RowGrant }>
): string {
  const computed = computeFinalRowsForTable(table, grants, []);
  if (!computed.ok) return "unavailable";
  return computed.preview.effectiveRowGrant.kind === "all"
    ? "all"
    : computed.preview.effectiveRowGrant.digest;
}

export type RowPolicyTemplateImpact = {
  /** The tables whose effective row grant changes. */
  tables: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    beforeDigest: string;
    afterDigest: string;
    changed: boolean;
  }>;
  /** The Agents that reach the affected Roles. */
  agents: Array<{ agentId: string; roleIds: string[] }>;
  /** The policy summary before / after the change. */
  policyDigestBefore: string;
  policyDigestAfter: string;
  /** The Roles whose row policy is affected. */
  affectedRoleIds: string[];
};

/**
 * The impact surface of a template change.
 *
 * The affected Roles are the ones that REFERENCE the template — plus the Roles
 * the template is added to. The table set is the canonical source key set, so
 * two same-named tables of different Schemas stay two entries (P1-D7).
 */
async function computeTemplateImpact(
  before: TemplateConfig,
  after: TemplateConfig,
  affectedRoleIds: string[]
): Promise<RowPolicyTemplateImpact> {
  const beforeExpanded = expandRowPolicyTemplatesInConfig(before as AccessConfigWithTemplates);
  const afterExpanded = expandRowPolicyTemplatesInConfig(after as AccessConfigWithTemplates);
  const beforeGrants = await roleGrantsByTable(beforeExpanded.config, affectedRoleIds);
  const afterGrants = await roleGrantsByTable(afterExpanded.config, affectedRoleIds);

  const keys = new Set<string>([...beforeGrants.keys(), ...afterGrants.keys()]);
  const tables: RowPolicyTemplateImpact["tables"] = [];
  for (const key of [...keys].sort()) {
    const [connectionId, schema, sourceName] = key.split("|");
    const table = { connectionId, schema, sourceName };
    const beforeDigest = unionDigest(table, beforeGrants.get(key) ?? []);
    const afterDigest = unionDigest(table, afterGrants.get(key) ?? []);
    tables.push({ connectionId, schema, sourceName, beforeDigest, afterDigest, changed: beforeDigest !== afterDigest });
  }

  const usersByRole = roleIdsOfUsers(after);
  const agents: RowPolicyTemplateImpact["agents"] = [];
  for (const roleId of affectedRoleIds) {
    for (const agentId of usersByRole.get(roleId) ?? []) {
      const existing = agents.find((agent) => agent.agentId === agentId);
      if (existing) {
        if (!existing.roleIds.includes(roleId)) existing.roleIds.push(roleId);
        continue;
      }
      agents.push({ agentId, roleIds: [roleId] });
    }
  }

  return {
    tables,
    agents,
    policyDigestBefore: computeCandidateDigest(beforeExpanded.config),
    policyDigestAfter: computeCandidateDigest(afterExpanded.config),
    affectedRoleIds: [...affectedRoleIds].sort()
  };
}

type TemplateWriteResponse = {
  dryRun: boolean;
  written: boolean;
  operationId: string;
  /** The digest the client must echo to commit. */
  candidateDigest: string;
  /** The access.yaml version the candidate was built on. */
  version: string;
  impact: RowPolicyTemplateImpact;
  /** The validation issues of the whole candidate. Empty when the candidate is sound. */
  issues: Array<{ code: string; templateName?: string; roleId?: string; detail?: string }>;
  /** The references that made the operation illegal. */
  blockingReferences: Array<{
    roleId: string;
    connectionId?: string;
    schema?: string;
    sourceNames?: string[];
    prefixSelector?: boolean;
  }>;
  /** The candidate YAML — dry-run only. */
  proposedYaml?: string;
  /** The runtime confirmation. A formal save is only successful when it is true. */
  policyVersion?: string;
  runtimeAck?: boolean;
};

function errorBody(code: string, message: string, detail?: unknown) {
  return { ok: false as const, error: { code, message, ...(detail === undefined ? {} : { detail }) } };
}

/**
 * The template write entry point.
 *
 * The formal save runs INSIDE the shared publish window: the baseline is
 * re-read, the candidate is rebuilt and the preview is re-run there, so a
 * preview that was computed against a stale baseline can never be committed.
 */
async function runTemplateOperation(input: {
  projectRoot: string;
  operation: RowPolicyTemplateOperation;
  dryRun: boolean;
  confirmedVersion?: string;
  confirmedCandidateDigest?: string;
  changeType: string;
  targetId: string;
  actor: ReturnType<typeof trustedActorFromRequest>;
}): Promise<
  | { ok: true; status: number; data: TemplateWriteResponse }
  | { ok: false; status: number; body: unknown }
> {
  const operationId = randomUUID();

  const execute = async (): Promise<
    | { ok: true; status: number; data: TemplateWriteResponse }
    | { ok: false; status: number; body: unknown }
  > => {
    // ── 1) re-read the baseline ─────────────────────────────────────────────
    const { config, raw, version } = await readAccessYaml(input.projectRoot);
    const before = asTemplateConfig(config);
    if (input.confirmedVersion !== undefined && input.confirmedVersion !== version) {
      return {
        ok: false,
        status: 409,
        body: errorBody("VERSION_CONFLICT", "yaml has been modified by another source, please refresh")
      };
    }

    // ── 2) rebuild the candidate in memory ──────────────────────────────────
    const applied = applyRowPolicyTemplateOperation(before as AccessConfigWithTemplates, input.operation);
    if (!applied.ok) {
      const inUse = applied.issues.some((issue) => issue.code === "row_policy_template_in_use");
      return {
        ok: false,
        status: inUse ? 409 : 400,
        body: errorBody(
          applied.issues[0]?.code ?? "ROW_POLICY_TEMPLATE_REJECTED",
          applied.issues[0]?.detail ?? "template operation rejected",
          { issues: applied.issues, blockingReferences: applied.blockingReferences }
        )
      };
    }
    const after = applied.config as TemplateConfig;

    // ── 3) validate the WHOLE candidate, then re-run the preview ────────────
    // A candidate with an unresolvable REFERENCE fails closed: the Role would
    // deny at request time, so the write is refused (P1-1 §5.2 — zero writes).
    //
    // A CATALOG issue (an illegal template DEFINITION) is a DIAGNOSTIC, not a
    // blocker: the operation preserved that entry verbatim, so this write did
    // not cause it — and refusing here would make an illegal template block
    // every unrelated template save (P2-2). It is reported in `issues`.
    const expanded = expandRowPolicyTemplatesInConfig(after as AccessConfigWithTemplates);
    const unresolved = expanded.referenceIssues.filter((issue) => issue.code === "row_policy_template_unresolved");
    if (unresolved.length > 0) {
      return {
        ok: false,
        status: 400,
        body: errorBody("row_policy_template_unresolved", "candidate references a template that does not exist", {
          issues: unresolved
        })
      };
    }
    const referenceIssues = expanded.referenceIssues.filter(
      (issue) => issue.code !== "row_policy_template_unresolved"
    );
    if (referenceIssues.length > 0) {
      return {
        ok: false,
        status: 400,
        body: errorBody(referenceIssues[0]?.code ?? "ROW_POLICY_TEMPLATE_INVALID", "candidate has an invalid template reference", {
          issues: referenceIssues
        })
      };
    }
    /** The catalog-level issues of the candidate — diagnostics, never a blocker. */
    const catalogIssues = expanded.catalogIssues;

    const references = collectRowPolicyTemplateReferences(after as AccessConfigWithTemplates);
    const affectedRoleIds = new Set<string>();
    for (const [templateName, refs] of references) {
      if (!applied.added.includes(templateName) && !applied.changed.includes(templateName) && !applied.removed.includes(templateName)) {
        continue;
      }
      for (const ref of refs) affectedRoleIds.add(ref.roleId);
    }
    const impact = await computeTemplateImpact(before, after, [...affectedRoleIds]);
    const candidateDigest = computeCandidateDigest({ version, config: after });

    if (input.dryRun) {
      return {
        ok: true,
        status: 200,
        data: {
          dryRun: true,
          written: false,
          operationId,
          candidateDigest,
          version,
          impact,
          issues: catalogIssues,
          blockingReferences: [],
          proposedYaml: stringify(after, { lineWidth: 0 })
        }
      };
    }

    // ── 4) a formal save needs a fresh, confirmed preview ───────────────────
    if (!input.confirmedCandidateDigest) {
      return {
        ok: false,
        status: 400,
        body: errorBody("NEW_PREVIEW_REQUIRED", "a confirmed candidateDigest from a dry-run is required")
      };
    }
    if (input.confirmedCandidateDigest !== candidateDigest) {
      return {
        ok: false,
        status: 409,
        body: errorBody("NEW_PREVIEW_REQUIRED", "the candidate changed since the preview; run the dry-run again")
      };
    }

    // ── 5) durable intent → write → commit → terminal ───────────────────────
    const proposedYaml = stringify(after, { lineWidth: 0 });
    const writeResult = await writeAccessYaml(input.projectRoot, after as YamlAccessConfig, {
      enabled: true,
      expectedVersion: version,
      changeType: input.changeType,
      targetId: input.targetId,
      operation: input.operation.kind,
      oldSummary: {
        template: input.targetId,
        templates: summaryOfTemplates(before),
        affectedRoleIds: impact.affectedRoleIds
      },
      newSummary: {
        template: input.targetId,
        templates: summaryOfTemplates(after),
        affectedRoleIds: impact.affectedRoleIds,
        tables: impact.tables,
        agents: impact.agents
      },
      diff: templateBlockDiff(before, after),
      source: TEMPLATE_SOURCE,
      ...auditActorFields(input.actor),
      // The operation id IS the audit request id — it must survive the actor
      // fields, which carry the transport request id.
      requestId: operationId
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code === "VERSION_CONFLICT") return null;
      throw error;
    });
    if (writeResult === null) {
      return {
        ok: false,
        status: 409,
        body: errorBody("VERSION_CONFLICT", "yaml has been modified by another source, please refresh")
      };
    }

    // Spec §5.2 — a write that was reverted must NEVER be reported as saved.
    // `writeAccessYaml` rolls the disk back and re-commits the previous policy
    // when the runtime does not acknowledge this write (or when the terminal
    // audit could not be persisted). Reporting `written: true` there tells the
    // operator the template was saved when it was not, and the client would
    // then drop the preview state as if the change had landed.
    if (writeResult.rolledBack === true) {
      return {
        ok: false,
        status: 500,
        body: errorBody(
          "ROW_POLICY_TEMPLATE_WRITE_ROLLED_BACK",
          "the template write was rolled back; the previous configuration is still in effect",
          { operationId, runtimeAck: writeResult.runtimeAck }
        )
      };
    }

    return {
      ok: true,
      status: 200,
      data: {
        dryRun: false,
        written: true,
        operationId,
        candidateDigest,
        version,
        impact,
        issues: catalogIssues,
        blockingReferences: [],
        policyVersion: writeResult.policyVersion,
        runtimeAck: writeResult.runtimeAck
      }
    };
  };

  try {
    return await withPublishCoordinator("role_policy_save", execute, { projectRoot: input.projectRoot });
  } catch (error) {
    if (error instanceof PublishCoordinatorBusyError) {
      return {
        ok: false,
        status: 409,
        body: errorBody("PUBLISH_COORDINATOR_BUSY", "another write is in progress; retry shortly")
      };
    }
    throw error;
  }
}

/** The audit summary of the template block. Names, digests and counts — no content. */
function summaryOfTemplates(config: TemplateConfig): Array<{ name: string; digest: string; predicateCount: number }> {
  const { templates, issues } = validateRowPolicyTemplateCatalog(config.row_policy_templates);
  const out = Object.keys(templates)
    .sort()
    .map((name) => ({
      name,
      digest: computeCandidateDigest(templates[name]),
      predicateCount: templates[name].predicates.length
    }));
  for (const issue of issues) {
    out.push({ name: issue.templateName ?? "(invalid)", digest: `invalid:${issue.code}`, predicateCount: 0 });
  }
  return out;
}

/**
 * Register the row-policy template and row-policy view Admin routes.
 *
 * Wiring (owned by the host session, `webui/server/index.ts`):
 *
 *   import { registerRowPolicyTemplateRoutes } from "./admin/routes/row-policy.js";
 *   registerRowPolicyTemplateRoutes(app);
 */
export function registerRowPolicyTemplateRoutes(app: FastifyInstance): void {
  // GET /api/admin/row-policy/templates — the template read model (P1-1 §3.2).
  app.get<{
    Querystring: { connectionId?: string; schema?: string; sourceName?: string };
  }>("/api/admin/row-policy/templates", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { config } = await readAccessYaml(projectRoot);
    const templates = asTemplateConfig(config);
    const { templates: catalog, issues } = validateRowPolicyTemplateCatalog(templates.row_policy_templates);
    const references = collectRowPolicyTemplateReferences(templates as AccessConfigWithTemplates);

    const requestedTable =
      request.query.connectionId && request.query.schema && request.query.sourceName
        ? {
            connectionId: request.query.connectionId,
            schema: request.query.schema,
            sourceName: request.query.sourceName
          }
        : null;

    const view = await readRowPolicyTemplateViewModel(projectRoot, catalog, references, requestedTable);
    return {
      ok: true,
      data: {
        ...view,
        templates: Object.keys(catalog)
          .sort()
          .map((name) => view.templates.find((item) => item.name === name) ?? { name, description: undefined, predicates: [], digest: "", references: [], usabilityByTable: [] }),
        issues
      }
    };
  });

  // POST /api/admin/row-policy/templates/validate — candidate validation only.
  app.post<{ Body: { operation?: unknown } }>("/api/admin/row-policy/templates/validate", async (request, reply) => {
    const operation = parseOperation(request.body?.operation);
    if (!operation.ok) return reply.status(400).send(errorBody("BAD_REQUEST", operation.reason));
    const projectRoot = await resolveProjectRoot();
    const outcome = await runTemplateOperation({
      projectRoot,
      operation: operation.value,
      dryRun: true,
      changeType: "row_policy_template_validate",
      targetId: operation.value.name,
      actor: trustedActorFromRequest(request)
    });
    if (!outcome.ok) return reply.status(outcome.status).send(outcome.body);
    return { ok: true, data: outcome.data };
  });

  // POST /api/admin/row-policy/templates — create.
  app.post<{
    Body: {
      dryRun?: boolean;
      version?: string;
      candidateDigest?: string;
      template?: unknown;
      name?: string;
      description?: string;
      predicates?: unknown;
    };
  }>("/api/admin/row-policy/templates", async (request, reply) => {
    const name = typeof request.body?.name === "string" ? request.body.name : "";
    if (!name) return reply.status(400).send(errorBody("BAD_REQUEST", "name is required"));
    const projectRoot = await resolveProjectRoot();
    const outcome = await runTemplateOperation({
      projectRoot,
      operation: {
        kind: "create",
        name,
        definition: {
          ...(request.body?.description === undefined ? {} : { description: request.body.description }),
          predicates: request.body?.predicates
        }
      },
      dryRun: request.body?.dryRun !== false,
      confirmedVersion: request.body?.version,
      confirmedCandidateDigest: request.body?.candidateDigest,
      changeType: "row_policy_template_create",
      targetId: name,
      actor: trustedActorFromRequest(request)
    });
    if (!outcome.ok) return reply.status(outcome.status).send(outcome.body);
    return { ok: true, data: outcome.data };
  });

  // PATCH /api/admin/row-policy/templates/:name — update or rename.
  app.patch<{
    Params: { name: string };
    Body: {
      dryRun?: boolean;
      version?: string;
      candidateDigest?: string;
      name?: string;
      description?: string;
      predicates?: unknown;
    };
  }>("/api/admin/row-policy/templates/:name", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const outcome = await runTemplateOperation({
      projectRoot,
      operation: {
        kind: "patch",
        name: request.params.name,
        newName: typeof request.body?.name === "string" ? request.body.name : undefined,
        definition: {
          ...(request.body?.description === undefined ? {} : { description: request.body.description }),
          predicates: request.body?.predicates
        }
      },
      dryRun: request.body?.dryRun !== false,
      confirmedVersion: request.body?.version,
      confirmedCandidateDigest: request.body?.candidateDigest,
      changeType: "row_policy_template_patch",
      targetId: request.params.name,
      actor: trustedActorFromRequest(request)
    });
    if (!outcome.ok) return reply.status(outcome.status).send(outcome.body);
    return { ok: true, data: outcome.data };
  });

  // DELETE /api/admin/row-policy/templates/:name — delete.
  app.delete<{
    Params: { name: string };
    Body?: { dryRun?: boolean; version?: string; candidateDigest?: string };
  }>("/api/admin/row-policy/templates/:name", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const outcome = await runTemplateOperation({
      projectRoot,
      operation: { kind: "delete", name: request.params.name },
      dryRun: request.body?.dryRun !== false,
      confirmedVersion: request.body?.version,
      confirmedCandidateDigest: request.body?.candidateDigest,
      changeType: "row_policy_template_delete",
      targetId: request.params.name,
      actor: trustedActorFromRequest(request)
    });
    if (!outcome.ok) return reply.status(outcome.status).send(outcome.body);
    return { ok: true, data: outcome.data };
  });

  // GET /api/admin/row-policy/views/tables — the table list of the R3 view.
  app.get<{
    Querystring: {
      connectionId?: string;
      schema?: string;
      sourceName?: string;
      roleId?: string;
      agentId?: string;
      restricted?: string;
    };
  }>("/api/admin/row-policy/views/tables", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const filters: RowPolicyTableListFilters = {
      connectionId: request.query.connectionId,
      schema: request.query.schema,
      sourceName: request.query.sourceName,
      roleId: request.query.roleId,
      agentId: request.query.agentId,
      restrictedOnly: request.query.restricted === "true" || request.query.restricted === "1"
    };
    const list = await listRowPolicyTables(projectRoot, filters);
    return { ok: true, data: list };
  });

  // GET /api/admin/row-policy/views/table — the single-table model (P1-1 §3.3).
  app.get<{
    Querystring: { connectionId?: string; schema?: string; sourceName?: string };
  }>("/api/admin/row-policy/views/table", async (request, reply) => {
    const connectionId = request.query.connectionId?.trim();
    const schema = request.query.schema?.trim();
    const sourceName = request.query.sourceName?.trim();
    if (!connectionId || !schema || !sourceName) {
      return reply.status(400).send(
        errorBody("BAD_REQUEST", "connectionId, schema and sourceName are required")
      );
    }
    const projectRoot = await resolveProjectRoot();
    const view = await readRowPolicyTableView(projectRoot, { connectionId, schema, sourceName });
    return { ok: true, data: view };
  });
}

/** Parse the operation of the validate endpoint. */
function parseOperation(raw: unknown): { ok: true; value: RowPolicyTemplateOperation } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "operation must be an object" };
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  const name = typeof record.name === "string" ? record.name : "";
  if (!name) return { ok: false, reason: "operation.name is required" };
  if (kind === "create" || kind === "patch") {
    return {
      ok: true,
      value: {
        kind,
        name,
        definition: record.definition,
        ...(typeof record.newName === "string" ? { newName: record.newName } : {})
      }
    };
  }
  if (kind === "delete") return { ok: true, value: { kind: "delete", name } };
  return { ok: false, reason: "operation.kind must be create, patch or delete" };
}

/**
 * The template read model (P1-1 §3.2).
 *
 * `usabilityByTable` is decided against the CATALOG, never against the
 * template alone: a template carries no table identity, so 「可绑定」is a
 * per-table answer with four distinct outcomes (RTP-08).
 */
async function readRowPolicyTemplateViewModel(
  projectRoot: string,
  catalog: RowPolicyTemplateCatalog,
  references: Map<string, Array<{ roleId: string; connectionId?: string; schema?: string; sourceNames?: string[]; prefixSelector?: boolean }>>,
  requestedTable: { connectionId: string; schema: string; sourceName: string } | null
): Promise<{
  snapshot: Awaited<ReturnType<typeof listRowPolicyTables>>["snapshot"];
  state: Awaited<ReturnType<typeof listRowPolicyTables>>["state"];
  templates: Array<{
    name: string;
    description?: string;
    predicates: unknown[];
    digest: string;
    references: Array<{ roleId: string; connectionId?: string; schema?: string; sourceNames?: string[]; prefixSelector?: boolean }>;
    usabilityByTable: Array<{
      connectionId: string;
      schema: string;
      sourceName: string;
      usability: { status: string; fields?: string[]; reason?: string };
    }>;
  }>;
}> {
  const list = await listRowPolicyTables(projectRoot);
  const templates = [];
  for (const name of Object.keys(catalog).sort()) {
    const definition = catalog[name];
    const refs = references.get(name) ?? [];
    const usabilityByTable = [];
    const tables = requestedTable
      ? [requestedTable]
      : refs.flatMap((ref) =>
          (ref.sourceNames ?? []).map((sourceName) => ({
            connectionId: ref.connectionId ?? "",
            schema: ref.schema ?? "",
            sourceName
          }))
        );
    for (const table of tables) {
      if (!table.connectionId || !table.schema || !table.sourceName) continue;
      const usability = await rowPolicyTemplateUsabilityForTable(definition, table);
      usabilityByTable.push({
        connectionId: table.connectionId,
        schema: table.schema,
        sourceName: table.sourceName,
        usability: usability as { status: string; fields?: string[]; reason?: string }
      });
    }
    templates.push({
      name,
      description: definition.description,
      predicates: definition.predicates,
      digest: computeCandidateDigest(definition),
      references: refs,
      usabilityByTable
    });
  }
  return { snapshot: list.snapshot, state: list.state, templates };
}

export { ACCESS_YAML_REL, roleIdsOf, selectorsOfRole };
