/**
 * P1-11 D21／SC-21 — 概念写集半进位恢复围栏。
 *
 * 持久化于 `<projectRoot>/.ktx-ui/ops-concept-recovering.json`，
 * 进程崩溃后仍阻断 list／show／summary／scan／裁定，直至 clear。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const OPS_CONCEPT_RECOVERING = "ops_concept_recovering";

interface RecoveringFile {
  executions: Record<
    string,
    {
      conceptIds: string[];
      startedAt: string;
    }
  >;
}

function fencePath(projectRoot: string): string {
  return path.join(projectRoot, ".ktx-ui", "ops-concept-recovering.json");
}

async function readFence(projectRoot: string): Promise<RecoveringFile> {
  try {
    const raw = await readFile(fencePath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as RecoveringFile;
    if (!parsed || typeof parsed !== "object" || !parsed.executions) {
      return { executions: {} };
    }
    return parsed;
  } catch {
    return { executions: {} };
  }
}

async function writeFence(projectRoot: string, data: RecoveringFile): Promise<void> {
  const file = fencePath(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function markConceptsRecovering(
  projectRoot: string,
  executionId: string,
  conceptIds: string[]
): Promise<void> {
  const data = await readFence(projectRoot);
  data.executions[executionId] = {
    conceptIds: [...new Set(conceptIds.filter(Boolean))],
    startedAt: new Date().toISOString()
  };
  await writeFence(projectRoot, data);
}

export async function clearConceptsRecovering(
  projectRoot: string,
  executionId: string
): Promise<void> {
  const data = await readFence(projectRoot);
  if (!(executionId in data.executions)) return;
  delete data.executions[executionId];
  await writeFence(projectRoot, data);
}

export async function listRecoveringConceptIds(projectRoot: string): Promise<string[]> {
  const data = await readFence(projectRoot);
  const ids = new Set<string>();
  for (const entry of Object.values(data.executions)) {
    for (const id of entry.conceptIds) ids.add(id);
  }
  return [...ids].sort();
}

export async function isConceptRecovering(
  projectRoot: string,
  conceptId: string
): Promise<boolean> {
  const ids = await listRecoveringConceptIds(projectRoot);
  return ids.includes(conceptId);
}

export async function anyConceptRecovering(projectRoot: string): Promise<boolean> {
  const ids = await listRecoveringConceptIds(projectRoot);
  return ids.length > 0;
}

/**
 * @returns deny payload fields when blocked; otherwise null.
 */
export async function recoveringBlock(
  projectRoot: string,
  conceptIds?: string[] | null
): Promise<{ code: string; concept_ids: string[] } | null> {
  const recovering = await listRecoveringConceptIds(projectRoot);
  if (recovering.length === 0) return null;
  if (!conceptIds || conceptIds.length === 0) {
    return { code: OPS_CONCEPT_RECOVERING, concept_ids: recovering };
  }
  const hit = conceptIds.filter((id) => recovering.includes(id));
  if (hit.length === 0) return null;
  return { code: OPS_CONCEPT_RECOVERING, concept_ids: hit };
}
