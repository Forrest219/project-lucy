# MCP 客户端 Skill 入口修正 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.1** |
| 日期 / 目标版本 | 2026-11-11 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P0**（Agent 接入可用性） |
| 状态 | **v0.1 功能合同已收口（2026-11-11）**。SC-01–SC-11 通过（SC-10 于 Docker 重建后 CC 全真复测闭合：`lucy_skill_read` 2050 字符）。证据见收口记录。本条收口不表示可上线 |
| 决策来源 | 用户反馈：Claude Code 侧 Skill「假调用」；本机 CC 取证 `inbox/cc-skill-probe/` |
| 需求来源 | 仓库根 `.mcp.json` 指向已关闭的 legacy `/mcp/skills`，导致 CC 无法加载 `lucy_skill_*` |
| 实施主体 | 仓库根 `.mcp.json`；`scripts/smoke` 静态门禁与可选 CC 探针；接入文档口径 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | **不替代** [`lucy-skills-mcp-spec.md`](lucy-skills-mcp-spec.md) 规划；**不削弱** [`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.5（`/mcp/skills` passthrough 默认关闭）。业务 Skill 读取仍以主面 `/mcp` 的 `lucy_skill_search` / `lucy_skill_read` 为准（见 Spec 171／151） |
| 实施计划 | [`docs/plans/lucy-20261111-mcp-client-skill-endpoint-fix-plan.md`](../plans/lucy-20261111-mcp-client-skill-endpoint-fix-plan.md) |
| 收口记录 | [`docs/reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md`](../reviews/2026-11-11-mcp-client-skill-endpoint-fix-closure.md) |
| 取证预研 | [`inbox/cc-skill-probe/FINDINGS.md`](../../inbox/cc-skill-probe/FINDINGS.md)（工作区证据，可删） |

## 闭口层级

- 层级：功能合同
- 本条承诺：仓库默认 MCP 客户端配置指向现行可用的 Lucy 主面 `/mcp`，使已授予 Skill 通道的 Agent 能经 `lucy_skill_search`／`lucy_skill_read` 真实读取业务 Skill；静态门禁阻止再把仓库配置指回 legacy `/mcp/skills`；接入文档不再把该 legacy 路径写成当前默认。
- 本条出口：SC-01–SC-11。
- 不在本条出口：实现独立 `lucy-skills/` MCP server；重开 `LUCY_PROXY_SKILLS_PASSTHROUGH`；把业务 Skill 注册进 Claude Code 内置 `Skill`／`~/.claude/skills`；云端角色补授；客户镜像／Docker 重建；浏览器 E2E；修改 Proxy 内 `lucy_skill_read` 实现。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| （无新增产品术语） | — | — | 把 legacy `/mcp/skills` 称作「当前默认 Skill 入口」 | 沿用既有「业务 Skill」「Lucy MCP Proxy」 |

Forbidden: 宣称 CC 内置 `Skill` 工具等于已修复 Lucy 业务 Skill 通道。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 本条**无 WebUI 页面改动**
- [x] 不引入新的用户可见 UI 文案组件

### Exceptions (If Any)

- None. Config／docs／smoke only.

### Follow-up Needed

- None for UI.

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条只改仓库 `.mcp.json`、smoke 门禁与接入文档口径。
- 不改变：页面、路由、页头动作、空态、错误态、确认面、用户可见 WebUI 文案。

## 1. 产品合同摘要

| 决策 | 合同 |
|---|---|
| D1 单一入口 | 仓库根 `.mcp.json` **必须**定义 `mcpServers.lucy`，`type` 为 `http`，`url` 的 pathname（去尾斜杠后）**必须**为 `/mcp` |
| D2 禁止 legacy | `.mcp.json` **不得**出现 server 名 `lucy-skills`，**不得**出现 pathname `/mcp/skills` 或其子路径 |
| D3 Token 插值 | `Authorization` 使用环境变量插值（本机 `${LUCY_LOCAL_TOKEN}`）；**禁止**把明文 token 写入仓库 |
| D4 Demo URL 默认 | 仓库默认 `url` 为 `http://127.0.0.1:57881/mcp`（Docker demo 宿主机映射）。宿主直跑 WebUI 时可本地改为 `http://127.0.0.1:7879/mcp`；门禁**不**把端口写死为唯一合法值，只强制 pathname |
| D5 静态门禁 | `scripts/smoke/mcp-client-config-guard.mjs` 对仓库 `.mcp.json` 与合成负例可断言；`node --test` 覆盖；`npm run smoke:p1:mcp-client-config:test` 登记 |
| D6 文档口径 | `DEVELOPMENT.md` Skills 现状、`data-qa-instructions.md`、`lucy-skills-mcp-spec.md` 头部脚注：现行客户端默认＝主面 `/mcp`；`/mcp/skills` 仅作已关闭／规划语境 |
| D7 安全不回退 | 本条**不得**开启 passthrough；默认部署下 `/mcp/skills` 保持不可用（404 或等价不可达） |
| D8 CC 取证 | 可选探针 `scripts/smoke/cc-lucy-skill-probe.mjs`：在 `claude` 二进制 + `LUCY_LOCAL_TOKEN` + 可达 `/mcp` 齐备时，`--strict-mcp-config` 会话须成功 `lucy_skill_read` 且正文长度 ≥ 100；缺依赖记 `blocked`（exit 2）不冒充通过。CC 内置 `Skill(skill=dupont)` 失败**不**构成本条失败 |

## 2. 核心流程（伪代码）

```text
assert_repo_mcp_json(cfg):
  require cfg.mcpServers.lucy
  for name, server in cfg.mcpServers:
    if name == "lucy-skills": deny "legacy server name"
    path = URL(server.url).pathname.rstrip("/") or "/"
    if path == "/mcp/skills" or path.startswith("/mcp/skills/"):
      deny "legacy skills path"
    if name == "lucy" and path != "/mcp":
      deny "lucy must target /mcp"
  accept

on_client_session(strict_mcp = repo_.mcp.json):
  connect lucy -> /mcp with Bearer ${LUCY_LOCAL_TOKEN}
  if connect fails: session has no lucy_skill_*  # bug class under fix
  else:
    tools include lucy_skill_search, lucy_skill_read when Role grants channel
    lucy_skill_read(skill_name) -> full markdown body (len >= 100 for published fixtures)

cc_probe(env):
  if missing claude|token|reachable_mcp: return blocked
  run claude --strict-mcp-config --mcp-config temp_from_repo_shape
  require tool_result(lucy_skill_read).text.length >= 100
  ignore native Skill(unknown) outcomes
```

## 3. 验收矩阵

| ID | 验收项 | 证据 |
|---|---|---|
| SC-01 | 仓库 `.mcp.json` 含 `lucy`，url pathname=`/mcp` | 文件内容 + 守卫 |
| SC-02 | 仓库 `.mcp.json` 无 `lucy-skills`、无 `/mcp/skills` | `rg` + 守卫 |
| SC-03 | 合成 legacy 配置被守卫拒绝 | `mcp-client-config-guard.test.mjs` |
| SC-04 | 合成合法 `/mcp` 配置被守卫接受 | 同上 |
| SC-05 | 仓库实文件通过守卫 | 同上 `repo .mcp.json passes` |
| SC-06 | `data-qa-instructions.md` 不再写「等待 lucy-skills MCP」为现行路由 | 文件 diff |
| SC-07 | `DEVELOPMENT.md` Skills 现状写明现行通道＝主面工具 | 文件 diff |
| SC-08 | `lucy-skills-mcp-spec.md` 头部脚注标明 `/mcp/skills` 非当前默认客户端入口 | 文件 diff |
| SC-09 | `npm run smoke:p1:mcp-client-config:test` 与测试门禁文档已登记 | `package.json` + `test-layers-and-release-gates.md` |
| SC-10 | 依赖齐备时 CC 探针：`lucy_skill_read` 正文 ≥ 100；缺依赖 exit 2 `blocked` | 探针脚本 + 本机跑次 |
| SC-11 | 本条改动未引入开启 passthrough 的配置；不修改 Proxy 使 `/mcp/skills` 默认可用 | diff 审查（无 `LUCY_PROXY_SKILLS_PASSTHROUGH=1` 写入默认 compose／`.mcp.json`） |

## 4. 落盘清单自检

| # | 项 | 本条 |
|---|---|---|
| 1 | 文件名编号 | `lucy-20261111-mcp-client-skill-endpoint-fix-{spec,plan}.md` |
| 2 | 伪代码 | §2 |
| 3 | 元数据状态 | 头部 |
| 4 | Plan 五类章节 | 见配对 Plan |
| 5–6 | Terminology / Design System | 上文 |
| 7 | 索引 | `docs/README.md`、`docs/plans/README.md` |
| 8 | 新命令登记 | SC-09 |
| 11 | 闭口层级 | 上文 |
