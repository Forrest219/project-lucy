# Agent 管理台高权限警示与个人行限制呈现 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.2 功能合同已收口** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号。不升 Spec 100 / Spec 131 版本号 |
| 功能编号 / 优先级 | **无** / **P2**（Agent 详情与创建页局部文案／分层）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.2 功能合同已收口（2026-11-01）**。D1–D8 已冻结；SC-01–SC-12 全部关闭（组件测试 69/69；`npm run lint:terminology` exit 0）。实施记录见 [`docs/reviews/2026-11-01-agent-admin-high-priv-copy-ux-implementation-notes.md`](../reviews/2026-11-01-agent-admin-high-priv-copy-ux-implementation-notes.md)。本条收口不表示可上线 |
| 决策来源 | 2026-11-01 对 `http://127.0.0.1:55176/admin/agents/zhangxingchen`（已勾选 `lucy_admin`）的走查与讨论：高权限警示一句塞四层意思、突兀拗口；个人行限制在 `lucy_admin` 后价值未讲清，布局与文案无分层引导。委托人认可优化方向并要求按规范落盘 Spec / Plan |
| 需求来源 | Agent 基本信息页在绑定运维数据面角色时，警示与个人行限制应可读、可分层，且不削弱 Spec 131 的高权限意图与 Spec 100 的人级收窄能力 |
| 实施主体 | Lucy WebUI：`webui/src/pages/admin/AgentDetail.tsx`、`AgentList.tsx`（同文案警示）、相关组件测试。不修改 KTX、不改 ACL／constraints 编译语义、不改 Token API |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级呈现修订落 `docs/specs/` |
| 与既有 Spec 的关系 | **修订呈现，不改语义。** Spec 131（[`webui/docs/131-lucy-admin-catalog-bound-role-spec.md`](../../webui/docs/131-lucy-admin-catalog-bound-role-spec.md)）§5 高权限警示意图保留：须提示高权限运维数据面，且不得写成 WebUI「所有者／登录管理员」；**Agent 绑定可见文案以本 Spec 为准**（定稿已写入 Spec 131 注记）。Spec 100（[`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md)）个人行限制能力与 FinalRows AND **保留**，本条只改 Agent Admin 编辑面的文案与空态分层。与 [`lucy-20261101-new-token-expiry-preset-ux-spec.md`](lucy-20261101-new-token-expiry-preset-ux-spec.md) 对齐：**不得**在新建 Token 页恢复已删除的有效期政策提示句；过期由签发表单必填与快捷预设承担 |
| 实施计划 | [`docs/plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md`](../plans/lucy-20261101-agent-admin-high-priv-copy-ux-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：Agent 详情／创建在绑定 `lucy_admin` 或等价运维数据面角色时，高权限警示拆成短主句＋可选次句，且不再夹带 Token 过期建议；个人行限制区块按是否含目录绑定角色切换情境说明，空态弱展示且不删除配置能力，「编译≠取数生效」不常驻大段。
- 本条出口：SC-01–SC-12。组件测试打假可见文案、test id、空态／展开分层、情境分支；`npm run lint:terminology` 退出码 0。
- 不在本条出口：浏览器走查、Playwright、窄屏、镜像构建、部署、ACL／constraints 运行时语义、Role 详情行级策略面板、Token 签发页政策句回潮、Spec 100／131 既有 SC。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用：Lucy Admin Role、运维数据面、启用目录绑定（Catalog Bound Scope）、个人行限制、行级策略、最终行约束、Agent、Role、Token、MCP。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 高权限警示主句 | 此角色可访问已声明连接下的全部启用表，权限很大。 | Agent 详情用「当前」语义时允许「此角色」；创建页用同一主句。禁止再写「绑定启用表目录」机制句作主文 |
| 高权限警示次句 | 属 MCP 数据访问权限，与 WebUI 登录无关。 | 次要色／较弱字重；不得写成 WebUI 所有者或登录管理员 |
| 个人行限制标题 | 个人行限制 | 主标题仅此四字；`constraints` 仅作次级 mono 补充（术语标准允许的补充形态），不得与主标题同级并排抢读 |
| 空态摘要 | 未设置 | 替代常驻「未添加个人行限制。」复读句 |
| 添加按钮 | 添加行限制 | 不变 |
| 默认情境说明 | 在已绑定角色的行级策略之上再收窄；未设置则不追加。 | 所选角色均非目录绑定时 |
| 目录绑定情境说明 | 当前绑定含目录全表角色，角色侧无行级策略；个人行限制是此人唯一的行级收窄。未设置则不追加。 | 所选角色含 `catalog_bound` 或 `lucy_admin` 时 |
| 编译≠取数 | 配置成功只表示编译通过，不表示行级取数已生效。 | 仅 ⓘ tooltip 或保存确认区；禁止常驻段落 |

Forbidden:

- 警示主文再打包「已声明连接内绑定启用表目录」「签发 Token 时建议设置过期时间」。
- 把个人行限制写成「行级策略」「Agent 强制约束」「Token 行收紧」「Dynamic RLS」。
- 在绑定 `lucy_admin` 时禁用或隐藏个人行限制编辑能力（能力保留）。
- 在新建 Token 页恢复「默认 90／最长 365／Proxy 拒绝」类政策提示句（与当日 Token UX Spec 冲突）。

`MCP`、`Token`、`Agent`、`Role`、`constraints`（若作次级标签）、角色 id 使用既有 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 视觉层级：警示主句强于次句；个人行限制空态弱于角色区
- [ ] 警示继续用既有 warning soft 容器；不新增硬编码色值
- [ ] 选中态未误用 `primary`／`danger`（本条无筛选选中控件）
- [ ] PageHeader 可见动作不变
- [ ] 文案符合术语标准；专业英文节点保留 `notranslate`
- [ ] 网格／间距沿用 `pl-card` 与现有 Agent 详情节奏，无随机 spacing 漂移
- [ ] disabled「添加行限制」若有前置条件，保留既有原因文案（`constraintAddBlockReason`）

### Exceptions (If Any)

- None。不新增 Design System 章节；不引入新组件族。

### Follow-up Needed

- **已完成（2026-11-01 定稿）**：Spec 131 §5「高权限警示」已加注记——Agent 绑定可见文案以本 Spec 为准；安全意图保留在 Spec 131。无其它 Design System follow-up。

---

## 1. 背景

2026-11-01 在 Agent 详情「基本信息」取证（`lucy_admin` 已勾选）：

1. **高权限警示**（`data-testid="agent-lucy-admin-role-warning"`）原文：

   > 高权限运维数据面：当前 Role 在已声明连接内绑定启用表目录。这是 MCP 数据面权限，不是 WebUI 登录账户；签发 Token 时建议设置过期时间。

   一句混入四层信息：权限很大、catalog_bound 机制、MCP≠WebUI、Token 过期。角色选项旁已有「运维数据面」标签，机制句与标签重叠且拗口。

2. **个人行限制**区块标题并排 `constraints`，常驻长说明含 AND 语义与「编译≠取数」；空态再写「未添加个人行限制。」。在 `lucy_admin`（目录绑定、Role 行级策略不可配）下，说明仍写「在已绑定角色的行级策略之上」，与事实不符，也未点明「人级限制几乎是唯一行闸门」。

3. 产品事实（本条不改）：

   - `catalog_bound`／`lucy_admin`：Role 侧不配行级策略；多 Role 并集下 `lucy_admin` 的全表可见会放宽有效行授予。
   - 个人行限制仍 AND 收窄 FinalRows，混绑时尤其是安全网；纯运维空态常见，应弱展示而非删除。

## 2. 目标

1. 高权限警示可读：短主句传达「权限很大」，次句澄清 MCP≠WebUI；去掉机制黑话与 Token 过期夹带。
2. AgentDetail 与 AgentList 共用同一套警示文案常量，避免两处漂移。
3. 个人行限制保留能力；按是否含目录绑定角色切换情境说明；空态弱展示；「编译≠取数」离开常驻段落。
4. 测试与术语门禁可打假上述可见合同。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 constraints 编译、FinalRows、digest、deny 码 | Spec 100 权威 |
| 改 catalog_bound／lucy_admin 授权代数或 AbsoluteDeny | Spec 131／98 权威 |
| 在 Role 行级策略面板或行权限视图改文案 | 本条仅 Agent Admin 编辑面 |
| 回潮新建 Token 页有效期政策句 | 已由 Token UX Spec 收口删除；签发必填过期即可满足 Spec 131「建议设过期」的产品意图 |
| 强制空态折叠为 `<details>` 或新抽屉组件 | 允许用标题行＋弱摘要实现；不强制新交互范式 |
| 浏览器走查／窄屏／docker 重建 | 不在本条出口 |

## 4. 拍板记录

**2026-11-01**：委托人认可讨论意见并要求落盘；下列 D1–D8 按「提议」列冻结，否决退路关闭。

| ID | 提议 | 拍板前现行口径 |
|---|---|---|
| D1 | 只改呈现与文案分层；不改 ACL／constraints 语义 | Spec 100／131 语义不变 |
| D2 | 警示拆主句＋次句；删除「绑定启用表目录」机制主文与 Token 过期夹带 | 单段四层混写 |
| D3 | Token 过期不在 Agent 角色旁提示；不恢复 NewToken 政策句 | Agent 警示夹带过期建议 |
| D4 | 个人行限制能力始终可配（受既有 `addBlockReason` 约束）；不得因 `lucy_admin` 禁用 | 能力存在但文案误导 |
| D5 | 含目录绑定／`lucy_admin` 时用目录情境说明；否则用默认说明 | 单一「在角色行级策略之上」长段 |
| D6 | 空态：不展开长说明与「未添加…」复读；标题＋「未设置」＋「添加行限制」；添加后显示一句情境说明 | 空态也铺满长段 |
| D7 | 「编译≠取数」仅 ⓘ 或保存确认；不常驻 | 常驻加粗句 |
| D8 | 主标题仅「个人行限制」；`constraints` 降为次级 mono 或不进标题行主读区 | 中英同级并排 |

## 5. 呈现规格

### 5.1 高权限警示

触发条件不变：所选角色命中 `isLucyAdminDataPlaneRole` 或 `roleId === "lucy_admin"`（AgentDetail／AgentList 既有逻辑）。

可见结构：

```text
[warning soft box] data-testid="agent-lucy-admin-role-warning"
  主句（text-sm，warning-strong）：此角色可访问已声明连接下的全部启用表，权限很大。
  次句（text-xs，较弱）：属 MCP 数据访问权限，与 WebUI 登录无关。
```

- `MCP` 节点 `notranslate`／`translate="no"`。
- 禁止出现：`签发`＋`Token`＋`过期` 的建议句；禁止「启用表目录」作主文。
- 文案抽到共享模块（例如 `webui/src/lib/lucyAdminRole.ts` 旁或同文件导出常量），AgentDetail 与 AgentList 引用同一常量。

### 5.2 个人行限制区块

`data-testid="agent-constraints-editor"` 保留。

#### 5.2.1 标题行

- 主标题：`个人行限制`
- 可选次级：`constraints` 以 `text-xs text-fg-muted font-mono` 出现在标题旁，但视觉权重低于主标题（不得与主标题同字号同色）。
- ⓘ（若实现）：`aria-label` 说明「编译与取数」；内容为规范句「配置成功只表示编译通过，不表示行级取数已生效。」

#### 5.2.2 情境说明

仅在**非空编辑态**（已有至少一条行限制，或用户刚点「添加行限制」进入草稿）显示一句：

| 条件 | 可见句 |
|---|---|
| `selectedRoleIds` 含 `lucy_admin` 或任一正式角色 `source_scope === "catalog_bound"`（以页面已有角色元数据为准；若列表项无该字段，则至少对 `lucy_admin`／`isLucyAdminDataPlaneRole` 走目录句） | 目录绑定情境说明（§Terminology 表） |
| 否则 | 默认情境说明 |

空态不显示这两句长说明。

#### 5.2.3 空态

```text
标题行（个人行限制 [+ 次级 constraints] [+ ⓘ]）
右侧：添加行限制（disabled 条件不变）
正文弱文案：未设置
```

禁止同时再渲染「未添加个人行限制。」。

#### 5.2.4 非空／编辑态

保持现有表单控件（来源、表、谓词、删除、清除全部）；在表单上方显示 §5.2.2 的一句情境说明。

### 5.3 Spec 131 对齐说明

Spec 131 §5.2「高权限警示」与「Token：不建议无过期长期 Token」仍然有效：

- 警示：由本 Spec §5.1 承担可见呈现。
- Token：由签发页**必填过期**＋快捷预设承担；本条明确不在 Agent 角色区与 NewToken 政策句重复说教。

## 6. 核心流程（伪代码）

本条含情境分支与空态分层，故不走伪代码豁免。

```text
function showLucyAdminWarning(selectedRoleIds, formalRoles):
  return selectedRoleIds.some(id =>
    id === "lucy_admin" || isLucyAdminDataPlaneRole(formalRoles.find(r => r.id === id))
  )

function renderLucyAdminWarning():
  if not showLucyAdminWarning(...): return null
  return WarningBox(
    primary = LUCY_ADMIN_WARNING_PRIMARY,   // 主句常量
    secondary = LUCY_ADMIN_WARNING_SECONDARY // 次句常量；无 Token 过期句
  )

function usesCatalogBoundContext(selectedRoleIds, formalRoles):
  return selectedRoleIds.some(id =>
    id === "lucy_admin"
    || isLucyAdminDataPlaneRole(formalRoles.find(r => r.id === id))
    || formalRoles.find(r => r.id === id)?.source_scope === "catalog_bound"
  )

function constraintHelperText(...):
  if usesCatalogBoundContext(...):
    return CATALOG_BOUND_CONSTRAINT_HELP
  return DEFAULT_CONSTRAINT_HELP

function renderConstraintsEditor(constraintRows, ...):
  render title "个人行限制" (+ optional muted "constraints") (+ optional info tooltip with PROVEN_CAVEAT)
  if constraintRows.length === 0:
    render muted "未设置"
    render "添加行限制" button (respect addBlockReason)
    do NOT render long helper
    do NOT render "未添加个人行限制。"
    return
  render one-line constraintHelperText(...)
  render existing constraint form rows / clear-all
```

## 7. 验收

| 编号 | 断言 |
|---|---|
| SC-01 | 勾选 `lucy_admin` 时，`agent-lucy-admin-role-warning` 可见，且包含主句「全部启用表」与「权限很大」 |
| SC-02 | 同一警示包含次句「MCP」与「WebUI 登录无关」（或等价规范次句），DOM 中 `MCP` 带 `notranslate` |
| SC-03 | 同一警示**不含**「启用表目录」「签发」与「过期」组合建议（不得匹配旧四层长句） |
| SC-04 | AgentDetail 与 AgentList 警示主句／次句来自同一导出常量（单测可对常量或两处渲染结果做相等断言） |
| SC-05 | 空态 `agent-constraints-editor` 含「个人行限制」与「未设置」，**不含**常驻长说明中的「编译通过」或「未添加个人行限制」 |
| SC-06 | 空态主标题可读名为「个人行限制」；若仍渲染 `constraints`，其计算样式字号或颜色弱于主标题（组件测试至少断言主标题节点与次级节点分离） |
| SC-07 | 在仅业务角色（非目录绑定）且已有一条行限制时，情境说明为默认句（含「行级策略之上」或规范默认句） |
| SC-08 | 在含 `lucy_admin` 且已有一条行限制（或点添加进入草稿）时，情境说明为目录句（含「唯一的行级收窄」或规范目录句） |
| SC-09 | 勾选 `lucy_admin` 时「添加行限制」不因该角色本身被额外禁用（仍仅受既有 `addBlockReason` 约束） |
| SC-10 | 「编译通过」／「行级取数已生效」类 caveat **不**作为空态或警示条常驻段落；若存在，仅在 tooltip／确认区 test id 下 |
| SC-11 | 既有 constraints 保存确认流与 `data-testid`（`agent-constraints-editor`、`agent-lucy-admin-role-warning`）仍可找到 |
| SC-12 | `npm run lint:terminology` 退出码 0 |

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 缩短警示后管理员低估权限 | 主句保留「权限很大」＋ warning 容器；角色标签「运维数据面」仍在 |
| 空态弱化后找不到个人行限制 | 标题与「添加行限制」仍在基本信息主列；test id 保留 |
| 与 Spec 131 文档字面不一致 | 定稿已在 Spec 131 §5「高权限警示」加指向本 Spec 的呈现注记；安全意图保留 |

回滚：恢复旧字符串与旧空态段落即可；无数据迁移。
