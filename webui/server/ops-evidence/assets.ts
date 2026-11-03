/**
 * Spec 149 §5.5 — 内容根资产的**复制**规则。
 *
 * 复制规则对语义、Skill、Wiki 完全相同：
 *
 * ```text
 * placeAsset(template, dest):
 *   if dest is absent:      copy template; return copied
 *   if dest bytes equal:    return unchanged
 *   else:                   do not write; record OPS_EVIDENCE_ASSET_CONFLICT; return conflict
 * ```
 *
 * 事实源是**解析后的内容根**（`resolveContentPaths`），不是写死的
 * `<projectRoot>/semantic-layer`。复制之后再由 `syncContentToProjectRoot`
 * 镜像到 KTX 读取的项目根同级目录。
 */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentPaths } from "../paths.js";
import {
  OPS_EVIDENCE_ASSET_DIR,
  OPS_EVIDENCE_FROZEN,
  OPS_EVIDENCE_SKILL_NAME,
  OPS_EVIDENCE_SOURCE_NAMES
} from "./contract.js";

/** `webui/` 根目录（`webui/server/ops-evidence/` → 上两级）。 */
const WEBUI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 仓库内的模板根：`webui/config/ops-evidence/`。 */
export const OPS_EVIDENCE_TEMPLATE_ROOT = path.join(WEBUI_ROOT, "config", "ops-evidence");

export type OpsEvidenceContentDir = "semanticLayer" | "skills" | "wiki";

export interface OpsEvidenceAssetSpec {
  /** 稳定标识（用于冲突记录与测试断言）。 */
  id: string;
  /** 内容根下的哪个目录。 */
  contentDir: OpsEvidenceContentDir;
  /** 相对模板根的路径。 */
  templateRelPath: string;
  /** 相对内容根的路径。 */
  contentRelPath: string;
}

export type OpsEvidenceAssetOutcome = "copied" | "unchanged" | "conflict";

export interface OpsEvidenceAssetResult {
  spec: OpsEvidenceAssetSpec;
  outcome: OpsEvidenceAssetOutcome;
  templatePath: string;
  destPath: string;
}

/**
 * 全部模板资产。
 *
 * 语义层的文件名跟着 T0 的冻结值走：Manifest 是 `_schema/<schema>.yaml`，
 * overlay 是 `<sourceName>.yaml`。
 */
export function opsEvidenceAssetSpecs(): OpsEvidenceAssetSpec[] {
  const specs: OpsEvidenceAssetSpec[] = [];

  specs.push({
    id: "semantic-layer/_schema",
    contentDir: "semanticLayer",
    templateRelPath: `semantic-layer/${OPS_EVIDENCE_ASSET_DIR}/_schema/${OPS_EVIDENCE_FROZEN.schema}.yaml`,
    contentRelPath: `${OPS_EVIDENCE_ASSET_DIR}/_schema/${OPS_EVIDENCE_FROZEN.schema}.yaml`
  });

  for (const source of OPS_EVIDENCE_SOURCE_NAMES) {
    const sourceName = OPS_EVIDENCE_FROZEN.sourceName[source];
    specs.push({
      id: `semantic-layer/${sourceName}`,
      contentDir: "semanticLayer",
      templateRelPath: `semantic-layer/${OPS_EVIDENCE_ASSET_DIR}/${sourceName}.yaml`,
      contentRelPath: `${OPS_EVIDENCE_ASSET_DIR}/${sourceName}.yaml`
    });
  }

  specs.push({
    id: "skills/ops-questioning",
    contentDir: "skills",
    templateRelPath: `skills/${OPS_EVIDENCE_ASSET_DIR}/${OPS_EVIDENCE_SKILL_NAME}.md`,
    contentRelPath: `${OPS_EVIDENCE_ASSET_DIR}/${OPS_EVIDENCE_SKILL_NAME}.md`
  });

  specs.push({
    id: "wiki/ops-questioning",
    contentDir: "wiki",
    templateRelPath: `wiki/${OPS_EVIDENCE_ASSET_DIR}/${OPS_EVIDENCE_SKILL_NAME}.md`,
    contentRelPath: `${OPS_EVIDENCE_ASSET_DIR}/${OPS_EVIDENCE_SKILL_NAME}.md`
  });

  return specs;
}

/**
 * 复制一个模板资产到内容根。
 *
 * 目标已存在且字节不同 → **不写**，返回 `conflict`（调用方记
 * `OPS_EVIDENCE_ASSET_CONFLICT`）。草稿、`roles_allowed: ["*"]`、损坏的
 * frontmatter 都属于这一类：它们不是覆盖理由。
 */
export async function placeOpsEvidenceAsset(
  spec: OpsEvidenceAssetSpec,
  contentPaths: ContentPaths
): Promise<OpsEvidenceAssetResult> {
  const templatePath = path.join(OPS_EVIDENCE_TEMPLATE_ROOT, spec.templateRelPath);
  const destPath = path.join(contentPaths[spec.contentDir], spec.contentRelPath);
  const template = await readFile(templatePath);

  let existing: Buffer | null = null;
  try {
    existing = await readFile(destPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      // 存在但读不了：按冲突处理，绝不覆盖。
      return { spec, outcome: "conflict", templatePath, destPath };
    }
    existing = null;
  }

  if (existing === null) {
    await mkdir(path.dirname(destPath), { recursive: true });
    await copyFile(templatePath, destPath);
    return { spec, outcome: "copied", templatePath, destPath };
  }

  if (existing.equals(template)) {
    return { spec, outcome: "unchanged", templatePath, destPath };
  }

  return { spec, outcome: "conflict", templatePath, destPath };
}
