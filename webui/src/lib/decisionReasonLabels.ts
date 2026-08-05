/** Spec 99 — client fallback when API does not return decisionReasonLabel. */

export function decisionReasonLabel(code: string | null | undefined): string {
  if (!code) return "未识别裁决原因";
  if (code === "allowed") return "允许执行";
  if (code === "tool_forbidden") return "Role 未授权该工具";
  if (code === "tool_forbidden_global") return "命中全局拒绝工具列表";
  if (code.startsWith("table_forbidden:")) return "表不在生效权限范围内";
  if (code.startsWith("unknown_or_forbidden_connection:")) return "连接未知或未授权";
  if (code.startsWith("explicit_table_required:")) return "需要明确表引用";
  if (code.startsWith("role_not_found:") || code.startsWith("role_resolution_failed:")) return "Role 配置异常";
  if (code === "user_disabled" || code === "agent_disabled") return "Agent 已禁用";
  if (code === "token_revoked" || code === "token_expired") return "Token 不可用";
  if (code.startsWith("sensitive_metadata_forbidden:")) return "敏感元数据工具未授权";
  if (code === "raw_query_forbidden") return "禁止原始 SQL 查询";
  if (code === "query_concurrency_exceeded") return "查询并发超限";
  return "未识别裁决原因";
}

export function decisionReasonDetail(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  if (code.startsWith("table_forbidden:")) {
    const rest = code.slice("table_forbidden:".length);
    return rest ? `首个未授权表：${rest.split(";")[0]}` : undefined;
  }
  if (code.startsWith("unknown_or_forbidden_connection:")) {
    return `连接：${code.slice("unknown_or_forbidden_connection:".length)}`;
  }
  return undefined;
}
