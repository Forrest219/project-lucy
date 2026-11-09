/**
 * P1-11 — Concept Ops 只读路径（Spec D15）：授权后直接读，不 mkdir、不走计划机。
 */

import { access, constants } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { opsDeny, opsOk, type OpsEnvelope } from "./ops-envelope.js";
import { resolveOpsConceptContentRoot, type OpsConceptRoots } from "./concepts-adapter.js";
import { recoveringBlock, OPS_CONCEPT_RECOVERING } from "./concepts-recovery-fence.js";

export const OPS_CONCEPT_NOT_FOUND = "ops_concept_not_found";
export const OPS_CONCEPT_ROOT_OVERRIDE = "ops_concept_root_override_forbidden";
export { OPS_CONCEPT_RECOVERING };

const ROOT_OVERRIDE_KEYS = new Set([
  "project_root",
  "projectRoot",
  "content_root",
  "contentRoot",
  "project",
  "content"
]);

export function rejectConceptRootOverrides(args: Record<string, unknown>): OpsEnvelope | undefined {
  for (const key of Object.keys(args)) {
    if (ROOT_OVERRIDE_KEYS.has(key)) {
      return opsDeny(
        OPS_CONCEPT_ROOT_OVERRIDE,
        { field: key },
        "不得通过请求参数覆盖 project / content 根"
      );
    }
  }
  return undefined;
}

async function importFromProject<T>(projectRoot: string, rel: string): Promise<T> {
  const href = pathToFileURL(path.join(projectRoot, rel)).href;
  return import(href) as Promise<T>;
}

async function loadRoots(projectRoot: string): Promise<OpsConceptRoots> {
  return resolveOpsConceptContentRoot(projectRoot);
}

export async function opsConceptList(projectRoot: string): Promise<OpsEnvelope> {
  const blocked = await recoveringBlock(projectRoot);
  if (blocked) {
    return opsDeny(OPS_CONCEPT_RECOVERING, { concept_ids: blocked.concept_ids }, "概念写集处于恢复中");
  }
  const { contentRoot } = await loadRoots(projectRoot);
  const store = await importFromProject(projectRoot, "scripts/concepts/store.mjs");
  const scan = await importFromProject(projectRoot, "scripts/concepts/scan.mjs");
  const dir = store.resolveFencedConceptsDir(contentRoot, { create: false });
  const ids = store.listConceptIds(dir);
  const concepts = [];
  for (const id of ids) {
    const concept = store.readConcept(dir, id);
    if (!concept) continue;
    const row = scan.summarizeConcept(concept, contentRoot);
    concepts.push({
      id: row.id,
      canonical: row.canonical,
      conflicts_status: row.conflicts_status,
      counts: {
        candidates: row.candidates,
        rejected: row.rejected,
        conflicts: row.conflicts.length,
        stale: row.stale
      }
    });
  }
  return opsOk({ concepts });
}

export async function opsConceptShow(
  projectRoot: string,
  conceptId: string
): Promise<OpsEnvelope> {
  const trimmed = conceptId.trim();
  if (!trimmed) {
    return opsDeny("ops_concept_id_required", undefined, "concept_id 必填");
  }
  const blocked = await recoveringBlock(projectRoot, [trimmed]);
  if (blocked) {
    return opsDeny(OPS_CONCEPT_RECOVERING, { concept_ids: blocked.concept_ids }, "概念处于恢复中");
  }
  const { contentRoot } = await loadRoots(projectRoot);
  const store = await importFromProject(projectRoot, "scripts/concepts/store.mjs");
  const scan = await importFromProject(projectRoot, "scripts/concepts/scan.mjs");
  const dir = store.resolveFencedConceptsDir(contentRoot, { create: false });
  const concept = store.readConcept(dir, trimmed);
  if (!concept) {
    return opsDeny(OPS_CONCEPT_NOT_FOUND, { concept_id: trimmed });
  }
  const summary = scan.summarizeConcept(concept, contentRoot);
  return opsOk({
    concept,
    conflicts: summary.conflicts,
    conflicts_status: summary.conflicts_status
  });
}

export async function opsConceptSummary(
  projectRoot: string,
  conceptId?: string
): Promise<OpsEnvelope> {
  const { contentRoot } = await loadRoots(projectRoot);
  const store = await importFromProject(projectRoot, "scripts/concepts/store.mjs");
  const scan = await importFromProject(projectRoot, "scripts/concepts/scan.mjs");
  const dir = store.resolveFencedConceptsDir(contentRoot, { create: false });
  if (conceptId?.trim()) {
    const id = conceptId.trim();
    const blocked = await recoveringBlock(projectRoot, [id]);
    if (blocked) {
      return opsDeny(OPS_CONCEPT_RECOVERING, { concept_ids: blocked.concept_ids }, "概念处于恢复中");
    }
    const concept = store.readConcept(dir, id);
    if (!concept) {
      return opsDeny(OPS_CONCEPT_NOT_FOUND, { concept_id: id });
    }
    return opsOk({ summary: scan.summarizeConcept(concept, contentRoot) });
  }
  const blockedAll = await recoveringBlock(projectRoot);
  if (blockedAll) {
    return opsDeny(OPS_CONCEPT_RECOVERING, { concept_ids: blockedAll.concept_ids }, "概念写集处于恢复中");
  }

  const ids = store.listConceptIds(dir);
  let concepts = 0;
  let withCanonical = 0;
  let degraded = 0;
  let conflictRows = 0;
  for (const id of ids) {
    const concept = store.readConcept(dir, id);
    if (!concept) continue;
    concepts += 1;
    if (concept.canonical) withCanonical += 1;
    const row = scan.summarizeConcept(concept, contentRoot);
    if (row.conflicts_status === "degraded") degraded += 1;
    conflictRows += row.conflicts.length;
  }
  return opsOk({
    totals: {
      concepts,
      with_canonical: withCanonical,
      degraded,
      conflict_rows: conflictRows
    }
  });
}

export async function invokeConceptReadTool(
  toolName: string,
  projectRoot: string,
  args: Record<string, unknown>
): Promise<OpsEnvelope> {
  const blocked = rejectConceptRootOverrides(args);
  if (blocked) return blocked;

  switch (toolName) {
    case "lucy_ops_concept_list":
      return opsConceptList(projectRoot);
    case "lucy_ops_concept_show": {
      const conceptId = typeof args.concept_id === "string" ? args.concept_id : "";
      return opsConceptShow(projectRoot, conceptId);
    }
    case "lucy_ops_concept_summary": {
      const conceptId =
        typeof args.concept_id === "string" && args.concept_id.trim() ? args.concept_id : undefined;
      return opsConceptSummary(projectRoot, conceptId);
    }
    default:
      return opsDeny("tool_not_control_plane", undefined, `非概念只读工具：${toolName}`);
  }
}

/** @internal test hook — 只读路径不得创建 concepts/ */
export async function conceptsDirExists(projectRoot: string): Promise<boolean> {
  const { contentRoot } = await resolveOpsConceptContentRoot(projectRoot);
  const conceptsPath = path.join(contentRoot, "concepts");
  try {
    await access(conceptsPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
