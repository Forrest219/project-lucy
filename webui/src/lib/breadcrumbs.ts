/**
 * Compute the breadcrumb trail for a given pathname.
 *
 * Lives outside `App.tsx` so individual pages can render the same trail inside
 * their per-page `PageHeader` without duplicating the routing logic.
 */
export function breadcrumbItems(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    return ["语义建模", "语义资产"];
  }
  if (parts[0] === "onboarding") {
    return ["系统概览"];
  }
  if (parts[0] === "sources") {
    return ["语义建模", parts[2] ?? "表语义", parts[3] ?? "表语义"];
  }
  if (parts[0] === "catalog") {
    if (parts.length === 1) {
      return ["语义建模", "语义资产"];
    }
    return ["语义建模", "语义资产", parts[1], parts[2], parts[3]].filter((item): item is string => Boolean(item));
  }
  if (parts[0] === "joins") {
    return ["语义建模", "关联关系", parts[3] ?? "当前表"];
  }
  if (parts[0] === "wiki") {
    return ["语义建模", "业务 Wiki"];
  }
  if (parts[0] === "review") {
    return ["审阅与校验", "变更审阅"];
  }
  if (parts[0] === "help") {
    return ["系统帮助", "系统手册"];
  }
  if (parts[0] === "eval") {
    if (parts[1] === "cases" && parts[2] && parts[3]) {
      return ["质量评测", "评测用例", parts[2], parts[3]];
    }
    if (parts[1] === "cases" && parts[2]) {
      return ["质量评测", "评测用例", parts[2]];
    }
    if (parts[1] === "cases") {
      return ["质量评测", "评测用例"];
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
      return ["数据接入", "启用表范围"];
    }
    if (parts[1] === "test") {
      return ["数据接入", "连通测试"];
    }
    return ["数据接入", "连接概览"];
  }
  if (parts[0] === "admin") {
    if (parts[1] === "agents" && parts[2] && parts[3] === "tokens") {
      return ["访问治理", "Agent", parts[2], "新建 Token"];
    }
    if (parts[1] === "agents" && parts[2]) {
      return ["访问治理", "Agent", parts[2]];
    }
    if (parts[1] === "agents") {
      return ["访问治理", "Agent"];
    }
    if (parts[1] === "roles" && parts[2] === "new") {
      return ["访问治理", "角色权限", "新建 Role"];
    }
    if (parts[1] === "roles" && parts[2]) {
      return ["访问治理", "角色权限", parts[2]];
    }
    if (parts[1] === "roles") {
      return ["访问治理", "角色权限"];
    }
    if (parts[1] === "audit") {
      return ["访问治理", "访问日志"];
    }
    if (parts[1] === "config-audit") {
      return ["访问治理", "配置审计"];
    }
    if (parts[1] === "branding") {
      return ["访问治理", "品牌外观"];
    }
    if (parts[1] === "admins") {
      return ["访问治理", "登录账户"];
    }
    if (parts[1] === "audit-sources") {
      return ["访问治理", "数据热力"];
    }
    return ["访问治理"];
  }
  return ["Lucy WebUI"];
}
