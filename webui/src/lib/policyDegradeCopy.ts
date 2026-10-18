/**
 * User-facing repair copy for a policy compile failure.
 * `{{role}}` is replaced by the caller with a notranslate role id.
 */
export type PolicyDegradeCopy = {
  roleId?: string;
  text: string;
};

const ROLE_DETAIL_COPY: Record<string, string> = {
  catalog_bound_wildcard_forbidden: "角色 {{role}} 不能授权全部连接。请改成明确的连接后保存。",
  catalog_bound_selectors_forbidden: "角色 {{role}} 不能同时「跟随已发布表」又手写表清单。请只保留一种后保存。",
  catalog_bound_requires_v2: "角色 {{role}} 使用了「跟随已发布表」，但权限模型还是旧版本。请打开该角色重新保存一次。",
  invalid_source_scope: "角色 {{role}} 的数据范围无法识别。请重新选择可访问的表后保存。",
  v2_prefix_forbidden: "角色 {{role}} 还在用前缀匹配表。请改成明确的表名后保存。",
  v2_row_access_required: "角色 {{role}} 里有的表还没有选择行权限。请为每张表选择全部行，或写好行级策略后保存。",
  v1_scoped_forbidden: "角色 {{role}} 使用了当前模型不支持的行级限制。请改为全部行，或更新角色后再配置。",
  invalid_row_access: "角色 {{role}} 的行权限取值无法识别。请改为全部行，或重新配置行级策略后保存。",
  row_policy_on_all_forbidden: "角色 {{role}} 在「全部行」上又写了行级策略。请删掉多余条件，或改成限定行后再保存。",
  row_grant_conflict: "角色 {{role}} 里同一张表的行权限互相冲突。请统一成一种后再保存。",
  row_policy_invalid: "角色 {{role}} 的行级策略无法生效。请检查条件后保存。"
};

export function policyDegradeCopy(reason: string): PolicyDegradeCopy {
  if (reason === "access_config_unreadable") {
    return {
      text: "权限配置目前读不出来，查数已全部暂停。请恢复上一份可用的权限配置；如果是在角色页改坏的，改回能通过检查的状态后再保存一次。"
    };
  }
  if (reason.startsWith("source_map_compile_failed")) {
    return {
      text: "语义资产无法汇总，查数已暂停。请到语义资产去掉重复的来源名称，发布后再打开对应 Agent 保存一次。"
    };
  }
  if (reason === "role_resolution_failed:role_and_roles") {
    return {
      text: "这个 Agent 同时保留了旧的单个角色和新的角色列表。请只保留一组角色后保存。"
    };
  }
  if (reason === "role_resolution_failed:no_role_or_direct_allow") {
    return {
      text: "这个 Agent 还没有可用角色。请指定一个角色后保存。"
    };
  }
  if (reason.startsWith("role_resolution_failed:")) {
    const rest = reason.slice("role_resolution_failed:".length);
    const splitAt = rest.indexOf(":");
    const roleId = (splitAt === -1 ? rest : rest.slice(0, splitAt)).trim();
    const detail = splitAt === -1 ? "" : rest.slice(splitAt + 1);
    if (!roleId) {
      return { text: "这个 Agent 绑定的角色无法生效。请打开角色，检查连接、表和工具后保存。" };
    }
    if (detail.startsWith("row_policy") && !ROLE_DETAIL_COPY[detail]) {
      return {
        roleId,
        text: "角色 {{role}} 的行级策略无法生效。请检查条件后保存。"
      };
    }
    return {
      roleId,
      text: ROLE_DETAIL_COPY[detail]
        ?? (detail
          ? "角色 {{role}} 无法生效。请打开该角色，检查连接、表和工具后保存。"
          : "角色 {{role}} 没有对应到已发布的数据表。打开该角色，把连接和表改成语义资产里仍然存在的对象，然后保存。")
    };
  }
  return {
    text: "这个 Agent 的查数已暂停。请打开它绑定的角色，确认连接和表仍在已发布的语义资产里，改好后保存。"
  };
}
