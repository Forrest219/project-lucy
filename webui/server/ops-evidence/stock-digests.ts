/**
 * Spec 20261104 §4.1 — 官方历史模板的 SHA-256 白名单。
 *
 * 旧实例上的官方资产（W0 Manifest／旧 Skill／旧 Wiki）与当前模板**字节不同**，
 * 但它们不是用户定制：升级时应自动覆盖到当前模板，而不是记冲突、也不改写
 * 用户真正改过的文件。
 *
 * 判定只看内容摘要：磁盘文件的 sha256 落在某资产的 stock 列表里 → 认定它是
 * 「曾随版本发布过的标准模板」→ 允许覆盖为当前模板。
 *
 * **维护规则**：此后每次改 `webui/config/ops-evidence/` 下对应模板，合入前必须把
 * **改前**当前模板 digest 追加进该资产的 stock 列表；单测断言「当前模板 digest
 * ∉ stock」（Spec 20261104 H5）。当前模板自己的 digest 永远不在 stock 里。
 *
 * 摘要只在本地算（Node 内置 crypto），不引入新依赖、不出网。
 */

import { createHash } from "node:crypto";

/**
 * 资产 id → 历史上曾随版本发布的标准模板内容 SHA-256。
 *
 * 首批登记的是本机现场复现到的旧版本：W0 Manifest（2 表）、旧 Skill、旧 Wiki。
 */
export const OPS_EVIDENCE_STOCK_DIGESTS: Readonly<Record<string, readonly string[]>> = {
  // W0 Manifest：仅 ops_calls / ops_call_tables。
  "semantic-layer/_schema": [
    "ed5f9f8b952950366fe563982e5c1ef98b127992195483a82552880cbac43ec4"
  ],
  "skills/ops-questioning": [
    "03c43e7b258a9116cc48e73a60fa3d37d0bf41bff998fd9f5a9c4317d5fbd4a4"
  ],
  "wiki/ops-questioning": [
    "a286bcda4a18f0f4af28691b7e4d75f4d9973d7bb22a86d9001235ecc3fff2fe"
  ]
};

/** 本地 sha256 十六进制摘要。 */
export function sha256Hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 某资产登记过的官方历史模板摘要（未登记时返回空列表）。 */
export function opsEvidenceStockDigests(assetId: string): readonly string[] {
  return OPS_EVIDENCE_STOCK_DIGESTS[assetId] ?? [];
}

/**
 * 磁盘内容的摘要是否命中该资产的官方历史模板白名单。
 *
 * 未登记的资产（overlay 等）永远返回 false —— 它们的旧版本没有被登记，
 * 只能按「字节不同即冲突」处理。
 */
export function isOpsEvidenceStockDigest(assetId: string, digestHex: string): boolean {
  return opsEvidenceStockDigests(assetId).includes(digestHex);
}
