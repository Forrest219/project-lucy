# Lucy v0.25 Agent 与角色授权摘要 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-requirements-review |
| 日期 / 目标版本 | 2026-10-25 / v0.25 |
| 功能编号 / 优先级 | L25-01 / P1-2 |
| 状态 | **设计完成、需求审查通过（2026-10-25）；暂不开发，不代表实现或验收通过** |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；本轮只做设计与需求审查材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2 L25-01；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 |
| 审查入口 | [P1 需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 通过；附带 F-01–F-04 实施前待办） |
| 权威上游 | Spec 14、15、98–100、131、150；`permission-display.ts`；[行策略模板与按表反查 Spec](lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) |
| 实施边界 | 只读解释与深链；不改变授权、配置写入、运行时裁决、预算或 KTX |

本文件把“无需打开 YAML，能说清 Agent／Role 可以访问哪些表、使用哪些工具、行边界是什么”收口为可实施合同。现有 `effectivePermissions` 与 Data Capability Preview 是事实基础，不以静态源码阅读冒充运行验证。ASV-01–14 全部未执行。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **授权摘要（Authorization Summary）**：由同一有效权限快照派生的一句话、资源卡片、工具分组与行边界说明；它是 Data Capability Preview 的可读视图，不是新授权对象。
- **资源卡片（Authorization Resource Card）**：按连接 → Schema → 表展示有效数据能力的只读卡片；不得把工具并集与表并集拼成权限笛卡尔积。

沿用「数据能力」「有效数据能力集」「规范源键」「行授予」「有效行授予」「最终行约束」「个人行限制」「ACL 裁决预览」「MCP 调试台」。禁止将授权摘要称为运行时凭据、权限模拟结果或已执行查询证明。

Protected DOM：`Agent`、`Role`、`Token`、`MCP`、`Schema`、`YAML`、`capability`、`sourceKey`、`policyVersion`、`sourceMapVersion`、`capabilityDigest`、工具名及完整数据库对象标识，均须 `translate="no"` + `notranslate`。

## 1. 现状与目标

现有 Agent／Role API 已返回 `effectivePermissions`，Agent 预览还包含 `finalRows`；但页面主任务仍需管理员在技术列表中自行归纳。L25-01 只增加同源可读投影，不重写权限编辑器或另建权限计算。

### 1.1 成功目标

1. 首屏一句话说明可访问连接数、去重表数、可知的启用表分母与行约束概况。
2. 资源卡片完整列出连接 → Schema → 表，并能说明角色来源与每个工具×表×行边界。
3. 工具按查询、读取语义、读取 Wiki、写入分组；Meta 与数据面工具分开，AbsoluteDeny 不作为可授予能力展示。
4. Agent 与 Role 使用同一派生合同，但明确 Agent 的 `FinalRows` 与 Role 的 `EffectiveRowGrant` 不同。
5. 从 Agent 资源卡片进入 MCP 调试台时预填 Agent、表和 ACL 裁决预览；预览仍不落盘、不执行数据查询。
6. 配置缺失、路径不一致、角色失败、目录未知时显式降级，不以空摘要或零值冒充无权限。

### 1.2 非目标

- 不新增 Agent 个人 `allow`、直接表授权、Token 授权或新权限层级。
- 不把摘要用于运行时裁决，不新增 deny 码，不改变 MCP 工具行为。
- 不把“编译允许”写成“真实取数成功”或“行级取数已生效”。
- 不重做 Role 三编辑面、保存 Drawer、Token 首秀、访问关系图或行权限视图。
- 不默认新增浏览器／移动窄屏测试；相关验证须另行批准。

## 2. 权威数据与不变量

### 2.1 快照与状态

```yaml
summaryContext:
  subject: {kind: agent | role, id}
  basis: committed | draft
  configVersion: string
  policyVersion: string
  sourceMapVersion: string
  capabilityDigest: string
  snapshotHash: string | null
  state: ok | partial | unavailable
  problem: access_unreadable | access_invalid | access_config_path_mismatch | null
  failures: [{subjectId, reason}]
```

同一响应的一句话、资源卡片、工具分组、行摘要与深链必须来自同一快照。`basis=draft` 只能来自 dry-run 内存候选，页面须标“候选预览，尚未生效”；不得与已提交配置混合。

状态沿用 `CountState`：全部必要主体解析成功为 `ok`，部分失败为 `partial`，配置不可用或全部失败为 `unavailable`。零个确定能力可以是 `ok` 的空集合，但必须与失败空集合区分。

### 2.2 计数口径

| 指标 | 定义 | 禁止 |
|---|---|---|
| 可读连接数 | 至少含一个有效 Data Capability 的去重 `connectionId` 数 | 不使用配置声明但未命中的连接凑数 |
| 可读表数 | 至少含一个有效 Data Capability 的规范源键去重数 | 不把 Role 授权路径数、工具×表元组数当表数 |
| 启用表分母 | 同一目录快照内、这些连接中已启用且可证明的去重表数 | 目录不全时不填 0，不把全库未启用表混入 |
| 工具数 | 有效工具 ID 去重数；Meta 与数据面分列 | 不做工具并集×表并集 |
| 受限表数 | Agent 视图按 `FinalRows.kind=scoped`；Role 视图按 `EffectiveRowGrant.kind=scoped` | 两种口径不得互换 |
| 角色来源 | 经 per-role 编译得到的角色→表贡献；多角色共同覆盖全部列出 | 不从合并后的 sources 反推角色 |

“可读 2 个连接、13 张表中的 6 张”只有在分母可证明时显示；否则写“可读 2 个连接、6 张表；启用表总数暂不可用”。

### 2.3 Agent 与 Role 的差异

- **Agent**：展示多 Role 合成后的有效能力；行摘要使用 `EffectiveRowGrant AND AgentConstraints` 的 `FinalRows`。
- **Role**：展示该 Role 自身能力；行摘要只表示该 Role 的 `rowGrant`，不得伪装成其他 Role 合并或某 Agent 的最终结果。通用 `__role_preview__` 不携带 Agent 个人行限制，不能用于 Agent 最终行约束证明。
- **多 Role**：表集合取并集，角色来源保留全部贡献；最终行约束继续 Role 间 OR，不把多 Role 自动收紧为 AND。
- **legacy allow**：只读标记“旧 ACL”，按现行编译结果展示可确定内容；不得虚构角色来源或引导新增 legacy 配置。

## 3. 授权摘要读取模型

```yaml
headline:
  connectionCount: integer
  tableCount: integer
  enabledTableCount: integer | null
  scopedTableCount: integer
  state: ok | partial | unavailable
resources:
  - connectionId: string
    schemas:
      - schema: string
        tables:
          - sourceKey: string
            sourceName: string
            physicalTable: string
            roleIds: [string]
            capabilities: [{tool, rowGrant, finalRows?}]
            rowSummary: {kind, templateRefs, constraintSummary}
tools:
  query: [toolId]
  semanticRead: [toolId]
  wikiRead: [toolId]
  write: [toolId]
  meta: [toolId]
actions:
  playgroundUrl: string | null
  accessMapUrl: string | null
  rowPolicyViewUrl: string | null
```

工具分组是展示分类，不改变工具分级或授权。未分类工具不得因分组而变为允许；写入组只展示现行模型实际可授予的工具，不暗示数据库 DML／DDL 开放。

行摘要中的模板名只是配置溯源辅助，权威行边界始终来自展开后的编译产物。`finalRows_unsatisfiable` 等编译失败显示诊断，不显示“全部行”“零行授权”或正常空摘要。

## 4. 页面与 API 合同

### 4.1 Agent 详情与编辑

- “权限预览”首屏依次展示授权摘要、资源卡片、工具分组、行边界说明和技术详情；技术 YAML 默认折叠。
- 新建／编辑角色的 dry-run 区域复用同一摘要组件，明确“候选预览，尚未生效”；正式保存仍以现有 diff、`runtimeAck` 与版本冲突合同为准。
- 资源卡片行提供“在 MCP 调试台预览”，链接为 `/admin/mcp-playground?agentId=<userId>&mode=dry-run&tool=lucy_query&args=<url-encoded-json>`；`args` 至少含 `connectionId` 与 `sourceName`。
- 调试台只预填并执行既有 ACL 裁决预览，不自动发起受控试调，不需要或回显 Token 明文。
- 另提供访问关系图深链 `/admin/access-map?agent=<userId>`；若表有行约束，提供行权限视图深链。目标页未实施前不得显示可用链接。

### 4.2 Role 详情与编辑

- “概览”显示当前 Role 授权摘要；三个编辑面共享草稿摘要，但只有 dry-run 结果可标为服务器候选编译。
- 资源卡片显示 Role 的表与工具×表关系，不显示 Agent 个人行限制；使用情况区另列受影响 Agent 并链接各自摘要。
- 保存前确认继续使用 Spec 150 的结构化影响与完整 YAML diff；摘要不能替代 dry-run 或确认 Drawer。
- Role 不提供 MCP 调试台 Agent 预填，因为 Role 不是可认证 Agent；可链接到引用它的 Agent 列表。

### 4.3 API 复用

优先复用：

- `GET /api/admin/agents/:userId` 与 `GET /api/admin/agents/:userId/effective-permissions`；
- `GET /api/admin/roles/:roleId` 及既有 create／patch dry-run 响应；
- `readAccessSnapshot`、`resolvePermissionBatch`、现有 `effectivePermissionsToPreview` 与 per-role 编译入口。

`AuthorizationSummary` 是服务端共享派生模型，可随上述响应增加版本化字段，不要求新写 API。若实施选择独立只读端点，必须携带相同 `summaryContext`，不得在浏览器用另一套算法拼接。任何摘要读取失败不改变既有详情页的基本身份与保存错误表达。

## 5. 核心流程（伪代码）

```text
buildAuthorizationSummary(subject, basis, draft?):
  snapshot = readAccessSnapshotAndPublishedCatalog()
  if snapshot.problem:
    return unavailable(summaryContext(snapshot), snapshot.problem)

  if basis == draft:
    candidate = overlayDraftInMemory(snapshot.committedConfig, draft)
    resolved = resolveCandidateThroughExistingDryRun(candidate, subject)
  else:
    resolved = resolveCommittedSubjectThroughExistingAdminPath(snapshot, subject)

  if resolved failed:
    return unavailable or partial with stable reason; never zero-fill
  capabilities = resolved.permissions.capabilities
  resources = groupByCanonicalSourceKey(capabilities)  # 去重表，不做笛卡尔积
  roleContributions = compileEachDeclaredRoleSeparately(snapshot, subject)
  attachAllRoleIdsWithoutInferringFromMergedUnion(resources, roleContributions)

  if subject.kind == agent:
    rows = FinalRows(capabilities, resolved.permissions.finalRowsBySource)
  else:
    rows = EffectiveRowGrantOnly(capabilities)

  headline = deriveCounts(resources, rows, snapshot.enabledCatalog)
  tools = partitionExistingGrantedTools(resolved.permissions.tools)
  return summary + oneSnapshotIdentity + explicitBasis + degradation
```

失败顺序固定为：配置／路径一致性 → 候选构造 → 运行时同源编译 → 目录分母与角色贡献补充 → 展示派生。补充信息失败可按 `partial` 降级，但核心有效权限失败不得展示确定授权结论。草稿变化、配置版本变化或目录世代变化必须作废旧摘要并重新 dry-run。

## 6. 一致性与降级

| 场景 | 展示 | 不得 |
|---|---|---|
| 配置缺失／非法／路径不一致 | `unavailable` 与对应问题，保留配置审计入口 | 空资源卡或“0 张表” |
| 部分角色失败 | 已解析集合 + `partial` + 失败角色清单 | 把部分集合称为完整授权 |
| 启用目录分母未知 | 显示确定分子，分母为空值原因 | 分母填 0 或 100% |
| 多角色覆盖同表 | 表数 1，角色来源 N，授权路径另按 N 计 | 表数随角色重复增加 |
| 两个受限 Role | 有效行授予保留 OR 分支 | 显示成 AND 或全部行 |
| Agent 个人行限制 | Agent 最终行约束显示交集结果 | Role 摘要冒充 Agent 最终行约束 |
| 行编译不可满足 | 显示 `final_rows_unsatisfiable` 诊断 | 显示全部行、正常空集或成功 |
| 草稿变化 | 旧候选摘要失效 | 用旧摘要确认新草稿 |

与 L25-08 对账时，同一 Agent 的摘要表集合应等于其访问关系图授权路径的表集合并集；与 R3 对账时，同表同快照的 `rowGrant/finalRows` 一致。三者不共享“路径数＝表数”的错误等式。

## 7. Design System Compliance

沿用 `design-system/00-principles.md`、`11-components-data-grid.md`、`12-components-metric-card.md`、`20-patterns-page-layout.md` 与 Spec 150：首屏只有授权理解这一主任务；资源树为主区，工具与技术详情渐进披露；摘要不堆叠新 KPI 卡样式。完整标识支持键盘、复制和文本状态，不只依赖颜色；长列表可折叠但必须能展开全部。桌面最小宽度下横向滚动，不做移动布局。

## 8. 验收矩阵

**ASV-01–14 全部未执行。** 以下验证在未来明确授权后实施；设计完成不计任何一项通过。

| ID | 场景 | 通过标准 |
|---|---|---|
| ASV-01 | 单 Role、单连接、多表 | 一句话、资源卡片与 capability 集合一致；表数按规范源键去重 |
| ASV-02 | 多 Role 重复授权同表 | 表数不重复，全部角色来源可见；OR 语义不变成 AND |
| ASV-03 | 多工具覆盖同表 | 表数不因工具数放大；每个工具×表×行边界仍可查 |
| ASV-04 | 启用表目录完整／不完整 | 分母只在可证明时展示；未知不填 0，不保留陈旧数字 |
| ASV-05 | Agent 行策略与个人行限制 | 最终行约束与运行时同一编译结果一致；保留 OR-of-AND |
| ASV-06 | Role 与 Agent 对照 | Role 不含 Agent 个人行限制；通用 Role 预览不冒充 Agent FinalRows |
| ASV-07 | 模板与内联行策略 | 摘要来自展开后编译产物；模板名仅作溯源，不改变摘要语义 |
| ASV-08 | 配置三类问题与角色失败 | `unavailable/partial` 正确，失败集合可见，无零值冒充 |
| ASV-09 | 新建／编辑 dry-run | 候选摘要明确未生效；草稿或基线变化使旧预览失效；不落盘 |
| ASV-10 | 调试台深链 | `agentId/mode/tool/args` 预填正确；只触发既有 ACL 预览，不自动执行查询 |
| ASV-11 | 与 L25-08／R3 对账 | 同快照表集合与行边界一致；路径数、调用数、表数分别表达 |
| ASV-12 | legacy、空能力与系统禁止工具 | legacy 明确标识；空能力与失败可分；AbsoluteDeny 不变成可授予 |
| ASV-13 | 只读与秘密保护 | 无新写入口；响应和页面不含 Token 明文、数据库密码或超授权内容 |
| ASV-14 | 术语与可达性 | 术语 lint、完整标识翻译防御、键盘与文本降级符合规范；既有页面行为无回归 |

## 9. 依赖与完成边界

- 依赖现行有效权限编译、Spec 150 dry-run、P0-2 最终行约束预览与目录诊断；不得在摘要层复制权限算法。
- 与 P1-1、P1-3 可并行设计；实施时共享只读模型与快照合同，写入仍由各自权威入口负责。
- 需求审查只确认范围、口径与验收设计；不授权开发、测试开发、浏览器验证、部署、发布或客户交付声明。
