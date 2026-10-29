/**
 * Spec 149 — 运维问数连接的前后端共享常量。
 *
 * 事实源放在 `webui/src/lib/`：前端页面与后端契约模块都能引用同一份值，
 * 不会因为「前端不能 import 后端」而出现第二份常量。
 * 后端的完整契约见 `webui/server/ops-evidence/contract.ts`。
 *
 * 术语（`webui/docs/00-product-terminology-standard.md` §4.7）：
 * - 运维问数连接 = 连接 ID `lucy-ops`
 * - 运维问数角色 = Role ID `lucy_ops_reader`
 * - 运维问数 Skill = Skill 名 `ops-questioning`
 * - 演示运维问数 Agent = 用户 ID `demo_ops`
 */

/** 运维问数连接 ID。 */
export const OPS_EVIDENCE_CONNECTION_ID = "lucy-ops";

/** 运维问数角色 ID（参考模板 + Docker demo 的正式 Role）。 */
export const OPS_EVIDENCE_ROLE_ID = "lucy_ops_reader";

/** 运维问数 Skill 名。 */
export const OPS_EVIDENCE_SKILL_NAME = "ops-questioning";

/** 演示运维问数 Agent（用户 ID）。 */
export const OPS_EVIDENCE_DEMO_USER_ID = "demo_ops";

/** 连接概览卡片主称。 */
export const OPS_EVIDENCE_CONNECTION_DISPLAY_NAME = "运维问数连接";

/**
 * 运维问数角色的高权限警示文案。
 *
 * 沿用 Spec 131 的高权限警示位置；**不得**写成所有者、登录管理员或超管。
 */
export const OPS_EVIDENCE_ROLE_WARNING = "运维问数角色可查看生成 SQL";

/** 该 Role 是否是运维问数角色。 */
export function isOpsEvidenceRole(role: { id?: string } | null | undefined): boolean {
  return Boolean(role?.id) && role?.id === OPS_EVIDENCE_ROLE_ID;
}
