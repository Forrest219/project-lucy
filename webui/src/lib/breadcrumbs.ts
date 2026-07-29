/**
 * Compute the breadcrumb trail for a given pathname.
 *
 * Lives outside `App.tsx` so individual pages can render the same trail inside
 * their per-page `PageHeader` without duplicating the routing logic.
 */
export function breadcrumbItems(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    return ["语义层维护", "表目录"];
  }
  if (parts[0] === "onboarding") {
    return ["部署向导", "上线检查"];
  }
  if (parts[0] === "sources") {
    return ["语义层维护", parts[2] ?? "表语义", parts[3] ?? "表语义"];
  }
  if (parts[0] === "joins") {
    return ["语义层维护", "关联关系", parts[3] ?? "当前表"];
  }
  if (parts[0] === "wiki") {
    return ["业务文档", "Wiki 文档"];
  }
  if (parts[0] === "review") {
    return ["审阅与校验", "变更审阅"];
  }
  if (parts[0] === "help") {
    return ["系统帮助", "系统手册"];
  }
  if (parts[0] === "eval") {
    if (parts[1] === "cases" && parts[2] && parts[3]) {
      return ["质量评测", "Case 管理", parts[2], parts[3]];
    }
    if (parts[1] === "cases" && parts[2]) {
      return ["质量评测", "Case 管理", parts[2]];
    }
    if (parts[1] === "cases") {
      return ["质量评测", "Case 管理"];
    }
    if (parts[1] === "runs" && parts[2]) {
      return ["质量评测", "运行历史", `Run #${parts[2]}`];
    }
    if (parts[1] === "runs") {
      return ["质量评测", "运行历史"];
    }
    if (parts[1] === "monitor") {
      return ["质量评测", "趋势监控"];
    }
    return ["质量评测"];
  }
  if (parts[0] === "connections") {
    if (parts[1] === "whitelist") {
      return ["数据库接入", "表白名单"];
    }
    if (parts[1] === "test") {
      return ["数据库接入", "连通测试"];
    }
    return ["数据库接入", "连接概览"];
  }
  if (parts[0] === "admin") {
    if (parts[1] === "agents" && parts[2] && parts[3] === "tokens") {
      return ["访问治理", "Agent 实例", parts[2], "新建 Token"];
    }
    if (parts[1] === "agents" && parts[2]) {
      return ["访问治理", "Agent 实例", parts[2]];
    }
    if (parts[1] === "agents") {
      return ["访问治理", "Agent 实例"];
    }
    if (parts[1] === "roles" && parts[2] === "new") {
      return ["访问治理", "角色配置", "新建 Role"];
    }
    if (parts[1] === "roles" && parts[2]) {
      return ["访问治理", "角色配置", parts[2]];
    }
    if (parts[1] === "roles") {
      return ["访问治理", "角色配置"];
    }
    if (parts[1] === "audit") {
      return ["访问治理", "访问日志"];
    }
    if (parts[1] === "config-audit") {
      return ["访问治理", "配置变更日志"];
    }
    if (parts[1] === "audit-sources") {
      return ["访问治理", "数据源热力视图"];
    }
    return ["访问治理"];
  }
  return ["KTX WebUI"];
}
