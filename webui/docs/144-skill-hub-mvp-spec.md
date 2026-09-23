# 业务 Skill MVP Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 业务 Skill MVP Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-09-23 |
| 撰写人 | Grok |
| 委托人 | xingchen |
| 基于材料 | 2026-09-23 用户反馈（「行权限 + Skill」为最高优先级）；生产只读核查 `http://10.69.95.109:8276`（v0.16 侧栏无 Skill 入口）；Spec 131；`webui/server/skills/`、`webui/server/proxy/skill-acl.ts`、`webui/server/proxy/mcp-proxy.ts`、`webui/server/admin/skills.ts` |
| 适用范围 | 本周交付：只读「业务 Skill」页，以及 Agent 经 Lucy MCP 发现并读取已发布 Skill |
| 输出位置 | `webui/docs/144-skill-hub-mvp-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 144 |
| 关联工单 | `webui/docs/plans/wo-202609-23-skill-hub-and-publish-clarity.md` |
| 关联页面 | `/skills`（业务上下文 / 业务 Skill） |
| 上游 Spec | Spec 131（协议与资产格式仍权威）；本 Spec 只冻结其 MVP 切片 |
| 状态 | Draft |
| 日期 | 2026-09-23 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：只读 Hub + Agent 读取已发布 Skill；明确相对 Spec 131 的 Non-Goals |
| v1.1 | 导航组名决策（委托人确认）：「业务 Skill」留同组第三项；组名「语义建模」更名「业务上下文」，三入口名不变；明确 Skill 发布不走「语义发布」流水线 |

## 1. 背景

用户要的「Skill」是：Lucy 提供基本 Skill 汇聚，外部 Agent 经 Lucy 调用 Skill，而不是各人在本地目录各自维护一份。

生产 v0.16 侧栏没有 Skill 入口。仓库里 Spec 131 与运行时已经具备资产扫描、`roles_allowed` 过滤、`resources/list`、`resources/read`、`lucy_skill_read` 和 `GET /api/skills`。缺的是产品入口，以及「Agent 只能看见已发布 Skill」这条边界。

Spec 131 还包含 Prompts 通道、在线编辑器、Eval 门禁、客户端导出和调用仪表盘。那些不在本周范围。

## 2. 目标

1. 侧栏「业务上下文」下新增「业务 Skill」，打开 `/skills` 可只读查看 `skills/` 中的 Skill。
2. 持有授权 Token 的 Agent，在 Lucy MCP 上能列出并读到 `status=published` 且角色匹配的 Skill 正文。
3. 未授权、已停用、草稿对 Agent 不可读，并留下稳定拒绝原因。
4. 复用现有 loader、校验器和 Admin API，不新造资产格式。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| Web 编辑器、上传、删除、导出 | Spec 131 Phase 4；本周资产仍由文件入库 |
| `prompts/list` / `prompts/get` | Spec 131 通道 C |
| Skill Eval 门禁、A/B、调用仪表盘 | Spec 132 / 134 |
| 在 Role 页新增 Skill 勾选 | 授权继续用 Skill frontmatter 的 `roles_allowed` |
| 把配置作者 Skills（`.cursor/skills/lucy-*-author`）放进 Hub | 那是编码代理产物生成器，不是问答运行时 Skill |
| 在生产 `10.69.95.109:8276` 上改配置或发布 | 验收在 demo / 本地；生产升级另开窗口 |

## 4. 产品行为

### 4.1 导航与页面

- 分组：业务上下文（原「语义建模」组更名；下辖 语义资产 / 业务 Wiki / 业务 Skill 三项，既有入口名与路由不变）。
- 标签：业务 Skill。
- 路由：`/skills`。
- 页面是列表页：名称、域、状态、`roles_allowed` 摘要、校验结果。
- 点击一行打开只读详情：标题、`Skill URI`、触发词、前置依赖、Markdown 正文。
- 不提供新建、保存、删除、导出按钮。
- 空目录时说明：尚无 Skill 文件；资产放在 `skills/`。

状态 Tag：

| `status` | UI |
|---|---|
| `draft` | 草稿 |
| `published` | 已发布 |
| `deprecated` | 已停用 |
| 缺省 | 按 `draft` 展示，且不对 Agent 可见 |

「语义发布」流水线不含 Skill：发布工作台同步的是语义与 Wiki 索引；Skill 的「已发布」是文件 frontmatter 的 `status` 字段，由 loader 直接读取生效，不经过发布工作台。

### 4.2 Agent 可见性

Agent 通道（`initialize` 注入的目录、`resources/list`、`resources/read`、`lucy_skill_read`）只返回同时满足以下条件的 Skill：

1. `status` 为 `published`。
2. `canAccessSkill` 允许：未停用，且 `roles_allowed` 含 `*` 或与 Token 的 Role 有交集。

WebUI 列表展示全部状态，供管理员核对草稿与已停用项。WebUI 不是 Agent 调用面。

### 4.3 调用面

本周只保留两条等价读取路径，行为必须一致：

- `resources/read`，URI 为 `lucy-skill://<domain>/<name>`。
- 工具 `lucy_skill_read`。

`resources/list` 与 `initialize` instructions 中的目录使用同一可见集，不得列出草稿。

## 5. 核心流程（伪代码）

```text
agentVisible(identity, skill):
  if skill.status != "published":
    return deny("skill_not_published")
  decision = canAccessSkill(identity, skill)   # 既有：deprecated、roles_allowed
  if not decision.allowed:
    return deny(decision.reason)               # skill_deprecated | skill_role_mismatch | role_resolution_failed
  return allow

resources/list:
  return [summary(s) for s in loadAllSkills() if agentVisible(identity, s).allowed]

resources/read(uri) 与 lucy_skill_read(name):
  skill = lookup(uri 或 name)
  if skill is missing:
    return not_found                            # 不泄露其它域是否存在同名草稿
  decision = agentVisible(identity, skill)
  if not decision.allowed:
    audit(deny, decision.reason)
    return forbidden(-32003, decision.reason)
  audit(allow)
  return skill markdown

GET /api/skills（WebUI，沿用现有管理员会话）:
  return all skills，附 validation
  不按 published 过滤
```

关键分支与验收的对应关系见 §8。

## 6. 数据与接口

- 资产格式、目录和 URI 以 Spec 131 §3 为准。实现继续使用 `webui/server/skills/loader.ts` 的现有解析，不在本 Spec 改 frontmatter 字段。
- 列表与详情复用 `GET /api/skills`、`GET /api/skills/:domain/:name`。响应中的正文仅供已登录 WebUI 使用。
- MCP 拒绝码沿用 Spec 131：无权为 JSON-RPC `-32003`，`data` 或等价字段带 §5 的 `reason`。
- 读取成功与拒绝都写入现有访问审计；至少包含 identity、`skill_uri` 或 name、allow/deny、reason。不新造审计表。

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` §3 与 §4.10.

New terms:

- `Skill`：UI 保留英文；禁止「技能」「技巧」「Scale」。
- `业务 Skill`：导航与页面标题。
- 状态 Tag：草稿 / 已发布 / 已停用。
- `业务上下文`：导航组名（原「语义建模」组更名）；「语义建模」保留为建模活动概念词，不再作导航组名。

Protected DOM：`Skill`、`lucy-skill://`、`lucy_skill_read`、`domain`、`roles_allowed`、文件路径。

## 8. Design System Compliance

- 布局：`webui/docs/design-system/20-patterns-page-layout.md` 列表页。
- 表格：`11-components-data-grid.md`。
- 状态色：`01-foundations-color.md`（已发布为成功色，草稿为中性，已停用为警告或危险中的既有 Tag，不新造颜色）。
- 详情用既有 Drawer，不新造编辑器。
- 无新按钮层级。页内没有主 CTA。

## 9. 验收

| ID | 断言 |
|---|---|
| SC-144-01 | 侧栏「业务上下文 / 业务 Skill」进入 `/skills`，列表能看到仓库中的 Skill 文件 |
| SC-144-02 | 详情为只读；页面上没有保存、删除、导出 |
| SC-144-03 | 已发布且 `roles_allowed` 匹配的 Token：`resources/list` 含其 URI，`resources/read` 与 `lucy_skill_read` 返回同一份 Markdown |
| SC-144-04 | 草稿不出现在 `resources/list` 和 `initialize` 目录；按 URI 读取返回 `skill_not_published` |
| SC-144-05 | `roles_allowed` 不匹配返回 `skill_role_mismatch`；`deprecated` 返回 `skill_deprecated`；二者均为 `-32003` |
| SC-144-06 | 允许与拒绝各至少一条访问审计，且 reason 与 §5 一致 |
| SC-144-07 | `cd webui && npm run lint:terminology` 通过；导航测试随 `navigation.ts` 更新后通过 |

验收环境为本地或 demo。不在生产环境修改 Role、Skill 文件或发布索引。

## 10. 实现时必须同步的文档

- `webui/src/app/navigation.ts` 增加入口并将组名改为「业务上下文」后（组 `id` 保持 `semantic-modeling` 不变），同步 `webui/docs/06-navigation-ia.md` 的分组表、面包屑表与「6+1 结构」验收句；`webui/docs/00-product-terminology-standard.md` 的 §3、Sidebar Group 行与 §4.10 已随本 Spec v1.1 更新。
- 不改 Spec 131 的 Phase 路线；本 Spec 是其 MVP 切片。
