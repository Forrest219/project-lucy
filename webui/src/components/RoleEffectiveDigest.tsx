/**
 * T7 — 生效边界自然语言摘要组件（WO-202609-23 §8）
 *
 * 摘要三句调用 buildEffectiveDigest，不在组件内重写文案。
 * 能力元组放入默认关闭的 <details>，摘要区域保留「Data Capability Preview」标签。
 * 不新增 Role API 字段，不改服务端。
 */
import type { EffectiveCapabilityPreview } from "../lib/types";
import {
  buildEffectiveDigest,
  type DigestInput,
  type RowPolicyDigestEntry,
  type ScopeMode,
} from "../lib/rolePermissionDraft";
import { formatRowGrantPreviewLabel } from "../lib/row-grant-preview";

export interface RoleEffectiveDigestProps {
  /** detail.effectivePermissions.tools.length — 调用方传入，不从表单勾选数推导。 */
  effectiveToolCount: number;
  connections: string[];
  tableCount: number;
  /**
   * 来自目录数据 measureCount 之和。
   * null 时省略「已发布指标」句（目录查询未成功时传入 null）。
   * 禁止传入 0 表示"无指标"，应传 null。
   */
  publishedMeasureCount: number | null;
  mode: ScopeMode;
  rowPolicies?: RowPolicyDigestEntry[];
  capabilities?: EffectiveCapabilityPreview[];
  capabilityDigest?: string;
}

export function RoleEffectiveDigest({
  effectiveToolCount,
  connections,
  tableCount,
  publishedMeasureCount,
  mode,
  rowPolicies = [],
  capabilities = [],
  capabilityDigest,
}: RoleEffectiveDigestProps) {
  const digestInput: DigestInput = {
    connections,
    tableCount,
    publishedMeasureCount,
    toolCount: effectiveToolCount,
    mode,
    rowPolicies,
  };

  const digestLines = buildEffectiveDigest(digestInput).split("\n");

  return (
    <div className="grid gap-4">
      <div data-testid="role-effective-digest-text" className="grid gap-2">
        {digestLines.map((line, i) => (
          <p key={i} className="text-sm">
            {line}
          </p>
        ))}
      </div>

      <details data-testid="capability-preview-details">
        <summary className="cursor-pointer text-sm font-medium">
          Data Capability Preview
          {capabilityDigest ? (
            <span
              className="ml-2 font-mono text-xs text-fg-muted notranslate"
              translate="no"
            >
              digest={capabilityDigest}
            </span>
          ) : null}
        </summary>
        <div className="mt-2" data-testid="capability-preview-body">
          {capabilities.length === 0 ? (
            <p className="text-sm text-fg-muted">无 DataPlane capability。</p>
          ) : (
            <ul className="grid gap-1 font-mono text-xs">
              {capabilities.map((cap) => (
                <li
                  key={`${cap.tool}:${cap.sourceKey}`}
                  className="notranslate"
                  translate="no"
                  data-testid="capability-row"
                >
                  {cap.tool} × {cap.sourceKey} · rowGrant=
                  {formatRowGrantPreviewLabel(cap.rowGrant)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
