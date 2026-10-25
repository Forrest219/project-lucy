# Lucy v0.25 行策略模板与按表反查 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-requirements-review |
| 日期 / 目标版本 | 2026-10-25 / v0.25 |
| 功能编号 / 优先级 | L25-14 R1、R3 / P1-1 |
| 状态 | **设计完成、需求审查已签核通过（2026-10-25）；暂不开发，不代表实现或验收通过** |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；本轮只做设计与需求审查材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.8；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 |
| 审查入口 | [P1 需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 审查执行通过、PM 已签核；附带 F-01–F-04 实施前待办） |
| 权威上游 | [行权限管理 Spec](lucy-20261022-v2p5-row-permission-management-spec.md) §3.1、§3.3、§4、§5.1–§5.5、§11、§13；Spec 99／100 |
| 实施边界 | 单实例／单副本；只改 Lucy，不改 KTX；不改变权限代数、运行时合并或强制谓词语义 |

本文件承接 P0-2 已锁定的 R1／R3 范围，不重开 D1–D7，也不复制或取代 P0-2 的 R2／R4／R5 合同。本文所有接口、页面与验证均为拟议设计；本轮未修改程序、配置、测试、镜像或客户资产，RTP-01–10、RTV-01–08 全部未执行。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **行策略模板（Row Policy Template）**：`access.yaml` 顶层 `row_policy_templates` 中的具名静态谓词集合；只复用谓词，不形成策略继承。
- **行权限视图（Row Policy View）**：按表反查角色行授予、Agent 个人行限制与最终行约束的独立只读页面；不并入访问关系图。

沿用「行级策略」「行访问」「行授予」「有效行授予」「最终行约束」「个人行限制」「行权限：全部行」「等于／属于」。禁止把本功能写成 Dynamic RLS、多租户隔离、按人／按 Token 动态收紧或第二套权限模型。

Protected DOM：`row_policy_templates`、`row_policy`、`row_access`、`template`、`predicates`、`forced_filters`、`constraints`、`RowGrant`、`FinalRows`、`policyVersion`、`sourceMapVersion`、角色／Agent／连接／Schema／表／字段标识，均须 `translate="no"` + `notranslate`。

## 1. 需求判断与范围

R1 解决同一静态条件在多表重复维护造成的口径漂移；R3 解决只能逐角色翻查、无法回答“这张表实际受什么行约束”的核查缺口。两者都复用 P0-2 的编译、预览、目录诊断、发布协调与配置审计，不另造运行时语义。

### 1.1 P1 范围

| 编号 | 能力 | 设计结果 |
|---|---|---|
| R1 | 静态模板管理与引用 | 模板增删改、保存前验证、角色表选择器引用、模板与内联条件 AND、引用影响面、配置审计与版本生效 |
| R3 | 按表反查 | 独立只读页，按完整表身份展示角色分支、Agent 个人行限制、有效行授予与各 Agent 最终行约束 |
| X1 | 同源对账 | 角色详情、行权限视图、L25-01 授权摘要和 L25-08 访问关系图使用一致的配置／目录快照与编译产物 |
| X2 | 失败可诊断 | 缺失引用、非法谓词、字段／目录失败、不可满足、基线冲突与审计失败均显式呈现，不降级为全部行 |

### 1.2 非目标

- 不引入宏、claim、segment、度量、环境变量、请求期表达式或 TokenScope。
- 不增加 per-source 字段映射、跨源字段绑定、数据库原生 RLS／CLS 或新 `RowGrant` 变体。
- 不改变 Role 内 AND、Role 间 OR、Agent 个人行限制 AND、`all` 吸收规则与失败关闭。
- 不在 R3 提供写入、批量替换、模板导入导出或第二套配置存储。
- 不重做 P0-2 的 R2 保存前预览、R4 审计闭环、R5 目录诊断，也不在本文重记其验收为通过。

## 2. 已锁定设计裁决

| 编号 | 裁决 | 实现约束 |
|---|---|---|
| P1-D1 | 模板只存 `access.yaml` 顶层 `row_policy_templates` | 与角色、Agent 同快照版本化，进入现有策略摘要；禁止 sidecar 或数据库第二事实源 |
| P1-D2 | 引用在进入现有行策略编译器前展开 | 展开后与内联谓词进入同一 `predicates`；运行时只看到同一 `RowGrant` |
| P1-D3 | 所有模板写入口复用共享单实例发布协调器和 durable intent／terminal | dryRun 不落盘；正式保存要求基线、候选摘要、`runtimeAck` 与终结审计一致 |
| P1-D4 | 被引用模板不可通过正常写入删除或改名 | 在整个候选配置内检查引用；外部异常造成的缺失引用失败关闭 |
| P1-D5 | R3 是独立只读视图 | 不并入 L25-08，不提供编辑按钮；写操作只从既有角色／模板入口进入 |
| P1-D6 | 不可满足不是“空集授权值” | 沿用 `final_rows_unsatisfiable` 失败；R3 只展示该诊断，不新增第三种 `RowGrant`，不显示“全部行”或“无限制” |
| P1-D7 | 同源不等于同数 | 表集合按规范源键去重；授权路径按 `(Agent, Role, Table)` 计数；二者可对账但不得互相冒充 |

P1-D6 收口 P0-2 §13.4 的 T-01：本期只定义只读诊断表达，不扩展运行时行授权代数。

## 3. 配置与读取模型

### 3.1 模板与引用

```yaml
row_policy_templates:
  by_region:
    description: 按大区限定行
    predicates:
      - { field: region_code, op: eq, value: CN-EAST }

roles:
  finance_reader:
    permission_model_version: 2
    allow:
      tableSelectors:
        - connection: warehouse
          schema: finance
          names: [orders]
          row_access: scoped
          row_policy:
            template: by_region
            predicates:
              - { field: status, op: eq, value: SETTLED }
```

约束沿用 P0-2 §4：模板名匹配 `[A-Za-z_][A-Za-z0-9_-]*`；谓词非空，`op` 仅 `eq/in`，值仅为标量字面量；`in` 值去空、去重且类型保持。模板不带连接、Schema 或表身份，字段在引用目标表绑定。`row_access: all` 不得携带 `row_policy`；`permission_model_version: 1` 禁止引用。

`in.values` 的顺序不影响语义或摘要。谓词展示顺序保留“模板谓词在前、内联谓词在后”，不得为了排序改变用户可审阅的结构。

### 3.2 模板读取模型

| 字段 | 含义 |
|---|---|
| `name / description / predicates` | 规范模板内容 |
| `references[]` | 引用它的角色、连接、Schema、表与选择器身份 |
| `usabilityByTable[]` | 可绑定、字段不存在、清单不可用、目录能力未知；不能只靠模板自身判断 |
| `configVersion / policyVersion / sourceMapVersion` | 当前已提交快照身份 |
| `state` | `ok / partial / unavailable`；局部表诊断失败不得伪装整份模板不可用 |

### 3.3 R3 按表读取模型

```yaml
snapshot: {configVersion, policyVersion, sourceMapVersion, capabilityDigest}
table: {connectionId, schema, sourceName, physicalTable}
state: ok | partial | unavailable
roles:
  - {roleId, rowAccess, templateRefs, inlinePredicates, rowGrant, error?}
effectiveRowGrant: {kind, digest, orArms} | null
agents:
  - {agentId, enabled, constraints, finalRows, error?}
catalog: {status, catalogLoaded, stage?, reason?}
```

`effectiveRowGrant` 是 Role 间并集；`finalRows` 是该 Agent 的运行时交集结果。无角色授权、编译失败与全部行是三个不同状态。R3 不返回明文 Token、数据库凭据或未经脱敏的配置秘密。

## 4. 管理 API 与写入合同

以下为逻辑合同；实施可复用现有角色／访问配置路由，但不得降低字段、顺序或失败语义。

| 接口 | 合同 |
|---|---|
| `GET /api/admin/row-policy/templates` | 返回模板、引用、按表可用性与快照身份；只读 |
| `POST /api/admin/row-policy/templates/validate` | 对完整内存候选做形状、引用、目录与影响面 dry-run；不写盘、不换入策略 |
| `POST /api/admin/row-policy/templates` | 新建；`dryRun` 默认 true，正式保存携带 `version + candidateDigest` |
| `PATCH /api/admin/row-policy/templates/:name` | 修改；改名按“删除旧名 + 新建新名”处理，有引用即拒绝 |
| `DELETE /api/admin/row-policy/templates/:name` | 删除；先 dry-run 全量引用检查，正式保存同样复核 |
| `GET /api/admin/row-policy/views/tables` | 按连接、Schema、表、角色、Agent、受限状态筛选；返回完整集合或明确游标 |
| `GET /api/admin/row-policy/views/table` | 以 `connectionId + schema + sourceName` 返回 §3.3 单表模型 |

模板和角色行策略的正式写入都必须在同一协调器内重读基线、重建候选、重跑预览、持久化 intent、写配置并 `commitEffectivePolicy`、持久化 terminal。任何 API 形状调整不得产生绕过该顺序的写入口。

## 5. 核心流程（伪代码）

### 5.1 展开与编译

```text
expandAndCompile(selector, templates, sourceCatalog):
  inline = selector.row_policy.predicates OR []
  expanded = []
  if selector.row_policy.template exists:
    template = templates[selector.row_policy.template]
    if template missing: FAIL row_policy_template_unresolved
    parsed = parseRowPolicyShape({predicates: template.predicates})
    if parsed failed: FAIL parsed.reason
    expanded.append(parsed.predicates)
  expanded.append(parseRowPolicyShape({predicates: inline}).predicates)
  if expanded empty: FAIL row_policy_predicates_required
  # 同一选择器 AND；后续 Role 合并、Agent 交集和强制注入完全复用现状
  return compileScopedRowGrant({predicates: expanded}, sourceCatalog)
```

任一目录、字段或编译失败直接返回 P0-2 R5 诊断；不得删除失败分支、退化为 `all` 或只记录警告后放行。

### 5.2 模板保存

```text
saveTemplate(actor, operation, expectedVersion, confirmedCandidateDigest):
  with sharedSingleInstancePublishCoordinator:
    current = rereadCommittedAccessConfig()
    if current.version != expectedVersion: REJECT VERSION_CONFLICT
    candidate = applyOperationInMemory(current, operation)
    references = scanAllRoleSelectors(candidate)
    if operation deletes or renames a still-referenced template:
      REJECT ROW_POLICY_TEMPLATE_IN_USE; zero writes
    preview = validateWholeCandidateWithRuntimeCompiler(candidate, references)
    if preview failed: REJECT preview.error; zero intent and zero writes
    if digest(candidate) != confirmedCandidateDigest: REJECT NEW_PREVIEW_REQUIRED
    if not durableIntent(actor, operation, beforeAfterImpact): REJECT; zero writes
    recovery = captureConfigAndEffectivePolicy()
    try:
      atomicWrite(candidate, expectedVersion)
      committed = commitEffectivePolicy()
      durableTerminal(committed, runtimeAck=true)
      return success only with committed.policyVersion and durable terminal
    catch write, commit or terminal failure:
      restore recovery and recommit old effective policy
      if rollback not verified:
        blockAffectedReadsAndAllWrites(recoveryRequired=true)
      return failure with recovery state; never report saved
```

### 5.3 R3 读取与降级

```text
readTableRowPolicy(actor, tableKey, filters):
  requireAdminAccessRead(actor)
  snapshot = readConsistentAccessAndPublishedSourceSnapshot()
  if snapshot invalid or path mismatched: return unavailable with problem
  roles = compileEachRoleContribution(tableKey, snapshot)  # 不从合并权限反推
  agents = compileReachableAgents(tableKey, snapshot)
  if every required compile failed: return unavailable; not an empty table
  result = computeFinalRowsForTable(tableKey, roles, agents)
  if result failed: return partial or unavailable with stable reason
  return result + snapshot identity + catalog provenance
```

## 6. 页面与交互

### 6.1 模板管理与角色引用

- 角色详情保留 P0-2 最终行约束预览；增加“引用模板／直接写条件／两者并用”。模板下拉展示全部候选，不可绑定项禁用并给原因。
- 模板列表显示名称、说明、谓词、引用数和当前快照；详情显示逐表可用性与引用清单。
- 新建、修改、删除都先 dry-run，再展示影响表、Agent、策略摘要变化与审计状态；正式保存只在 `runtimeAck=true` 后显示成功。
- 删除确认列出全部引用；有引用时主操作禁用。外部异常导致引用缺失时显示“引用缺失”，不得自动改为内联或全部行。

### 6.2 独立行权限视图

- 规划路由 `/admin/row-policies`，导航位于“角色权限”之后、“访问关系图”之前；实施时同步导航与帮助地图，当前不代表路由已存在。
- 列表列为完整表身份、角色策略数、涉及 Agent 数、有效行授予、目录／编译状态；支持角色、Agent、连接、Schema、是否受限筛选。
- 单表详情按 Role 分支展示模板与内联条件，再按 Agent 展示个人行限制与最终行约束；OR-of-AND 不得拍平。
- “全部行”只在编译结果确为 `all` 时显示。无授权、不可满足、目录失败、部分失败和空筛选结果分别显示，不共用空态。
- 提供到角色详情和 L25-01 摘要的只读深链；不提供行内编辑。

## 7. Design System Compliance

沿用 `design-system/00-principles.md`、`10-components-button.md`、`11-components-data-grid.md`、`20-patterns-page-layout.md`：单一主任务区、既有 Drawer／确认层、数据网格 Base Contract、状态不只用颜色表达。长谓词与完整表身份可复制；专业标识加翻译防御。桌面最小宽度下允许横向滚动，不做移动窄屏适配。本设计不新增颜色或组件原语。

## 8. 验收矩阵

**全部未执行。** RTP 对应模板，RTV 对应反查；以下是 P1 独立证据，不把 P0-2 的实现或测试记录转记为 P1 通过。

| ID | 场景 | 通过标准 | 上游映射 |
|---|---|---|---|
| RTP-01 | `eq/in` 模板与等价内联条件 | 展开后编译产物与语义摘要一致；`in` 值顺序不影响摘要 | P0 V01／V02 |
| RTP-02 | 模板 + 内联、多 Role、Agent 限制 | 选择器内 AND、Role 间 OR、Agent AND；DNF 结构保留 | P0 V03、V08–V10 |
| RTP-03 | 缺失引用、非法 op、空谓词、度量或字段不存在 | 全部失败关闭；原因与目录状态可区分 | P0 V04–V07 |
| RTP-04 | 删除／改名有引用与无引用模板 | 有引用拒绝且零写入；无引用可经 dry-run 保存；外部缺失引用失败关闭 | P0 V14 |
| RTP-05 | 模板或引用变化 | `policyVersion` 变化、运行时确认、无需重启；受保护工具闸门不变 | P0 V16／V17 |
| RTP-06 | 基线／候选摘要变化 | 旧预览不可提交；重新 dry-run 后才可保存 | P0 V13 |
| RTP-07 | intent、写入、生效、terminal 与回滚故障 | 顺序满足 P1-D3；恢复失败阻断受影响读取与后续写入 | P0 V15 |
| RTP-08 | 模板下拉与目录异常 | 不可绑定项可见且禁用；原因在选择时已披露，不等到保存 | R5 |
| RTP-09 | 配置审计 | 模板增删改、引用／解引用含 actor、operationId、前后摘要与影响面；不含秘密 | R4 |
| RTP-10 | 既有配置兼容 | 无模板配置行为不变；v1、legacy、非法组合仍按现行规则拒绝 | Spec 98／99 |
| RTV-01 | 单表多 Role、多 Agent | 角色贡献、有效行授予与逐 Agent 最终行约束齐全且同源 | R3 |
| RTV-02 | 两受限 Role 与一个 `all` Role 反例 | 前者不显示全部行；后者只在真实 `all` 分支存在时显示全部行 | P0 V08／V09 |
| RTV-03 | 无授权、不可满足、编译失败、空筛选 | 四种状态可区分；无空表冒充无限制，无新空集授权值 | P1-D6 |
| RTV-04 | 筛选、完整身份与深链 | 同名不同连接／Schema 不合并；筛选可分享；只读深链正确 | R3 |
| RTV-05 | 部分 Agent／Role 失败 | `partial` 明示失败集合；全部失败为 `unavailable`，不显示零授权 | R3 |
| RTV-06 | 与 L25-01／L25-08 对账 | 同快照下表集合一致；授权路径数与去重表数不混用 | P1-D7 |
| RTV-07 | 只读与可达性 | 页面无写 API；键盘、表格、焦点和翻译防御满足设计规范 | SC 设计 |
| RTV-08 | 快照切换 | 同次响应不混用配置、目录或策略世代；刷新后明确更新快照身份 | X1 |

## 9. 依赖与完成边界

- 依赖 P0-2 R2／R4／R5 的实际可用合同；若其设计与实现有偏差，先回到权威 Spec 裁决，不在 P1 另开宽松路径。
- D-03 仍属 0.20.Z 维护线；本 Spec 不把大写 Schema 缺陷修复纳入 P1，也不以其作为模板／反查开工依赖。
- 未来浏览器／E2E 验证须另行明确批准；默认只做获授权的单元、组件和接口验证，不做移动窄屏测试。
- 需求审查通过只授权后续另行安排实施，不自动授权开发、构建、部署、发布或客户支持声明。
