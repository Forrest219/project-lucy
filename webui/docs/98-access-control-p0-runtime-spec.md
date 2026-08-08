# AC-P0 Runtime Spec — 访问权限升级（Capability / Tool Class / Policy Compile）

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P0 Runtime Spec |
| 文档类型 | Spec |
| 版本 | v0.1（Gate B 评审稿） |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `docs/access-control/design-upgrade.md` **v1.1.2**（六项 ADR）；`docs/access-control/plans/wo-202608-59-access-control-p0.md` WP-S0；现网 `webui/server/proxy/{acl,mcp-proxy,identity,audit}.ts`；`webui/docs/07-mcp-auth-proxy-spec.md` |
| 适用范围 | AC-P0 **运行时与编译语义**的实现事实源（Gate B 通过后）；不含 AC-P1 Row Policy 注入；**本版不改 runtime 代码** |
| 输出位置 | `webui/docs/98-access-control-p0-runtime-spec.md` |
| 冲突裁决 | 与 `design-upgrade.md` 冲突 → **design-upgrade**，并回修本文；实现与本文冲突 → 本文 |
| 关联 WO | WO-202608-59；Gate A DONE；**Gate B 待勾选** |
| 契约补丁 | Spec 07 **v1.4.1**（Gate B P0 正文对齐）/ 14 v0.2 / 15 v0.2；本文 §12 跟踪状态 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（已登记于术语标准 §3 全局表与 §4.8）：

| Canonical Term | UI 主术语 | 禁止混淆 |
|---|---|---|
| Access Control Upgrade | 访问权限升级 | Dynamic RLS |
| Data Capability | 数据能力元组 | tools 并集、sources 并集 |
| Effective Data Capabilities | 有效数据能力集 | `(∪tools)×(∪sources)` |
| Row Grant | 行授予 | Agent Constraints |
| Agent Constraints | Agent 强制约束 | Role 间 AND |
| Permission Model Version | 权限模型版本 | 用户字段 `role`/`roles`、修改历史推断 |
| Row Policy | 行级策略 | Segment、查询 filters |
| Canonical Source Key | 规范源键 | 裸 sourceName、裸 physicalTable |
| Tool Class | 工具分级 | `known_tools`、`table_touching_tools`（现网字段名） |
| Effective Policy | 有效策略包 | 热路径临时拼装 |
| Policy Compilation Input | 策略编译输入 | 仅 access.yaml |
| Policy Version | 策略版本 | source map TTL、配置 mtime 裸展示 |
| Runtime Ack | 运行时确认 | 仅写盘成功、dryRun 通过 |
| Capability Forbidden | 能力未授权 | table_forbidden（旧表级口径混用为主文案） |
| Policy Scope Expanded | 授权范围扩大 | 静默扩权、无审计扩权 |
| Policy Degraded | 策略降级 | 服务不可用、完全健康 |

Forbidden terms / 文案：

- 不得将 AC-P0 宣称为「Dynamic RLS / 多租户隔离 / 行级权限已交付」
- Admin 不得只展示「工具并集 + 表并集」两列作为权限摘要（必须 capability 列表）
- 不得用「白名单表 / 启用表」指代 Effective Data Capabilities

Protected DOM terms（`translate="no"` + `notranslate`）：`Role`、`Agent`、`Token`、`MCP`、`YAML`、`policyVersion`、`permission_model_version`、`capability`、tool name、`sourceName`、`connectionId`、physical table、Canonical Source Key 四元组展示。

---

## 1. 背景与定位

### 1.1 问题

现网 ACL 将 Role 的 tools 与 sources **独立并集**后再做表检查，多 Role 时会产生 `(∪tools)×(∪sources)` 笛卡尔放大。另有：全局裸 `sourceName` / `physicalTable` 键；工具分类不闭集；`prefix` + source map TTL 可构成静默扩权；收窄失败语义未钉死。

### 1.2 本文范围（AC-P0）

在 **不引入 Row Policy 运行时注入** 的前提下，规定：

1. Capability 合成代数与闸门
2. 工具三分级全表 + 未分类 AbsoluteDeny
3. Canonical Source Key（正反向）
4. `permission_model_version` 与 v2 禁 `prefix` / 禁 `scoped`
5. 策略编译输入、`policyVersion`、Admin 提交与外部 YAML 失败语义
6. Deny reason、审计字段、验收映射

### 1.3 成功标准（对齐 WO SC-\*）

| ID | 标准 | 本文锚点 | 测试锚点 |
|---|---|---|---|
| SC-01 | 无笛卡尔放大 | §5 | U-CAP-01 / S2 |
| SC-02 | 移除 YAML `deny_tools` 中 `sl_*` 后仍 deny | §4.2 | U-DENY-01 |
| SC-03 | 未分类工具不进 list 且 call deny | §4.3 | U-CLS-02 |
| SC-04 | 同 connection 重名 source 编译失败 | §6 | U-KEY-02 |
| SC-05 | Admin 收窄保存失败时盘与 runtime 均保持写前 | §8 | U-REL-01/02 / S10 |
| SC-06 | 单 Role legacy Agent 与升级前逐项等价 | §9 | U-COMPAT-01 |
| SC-07 | v2 + `prefix` / v2 + `scoped` 拒绝 | §7 | U-VER-02/03 |
| SC-08 | `sourceMapVersion` 变化触发 `policyVersion` 变化 | §8.1 | U-REL-04 / S12 |
| SC-09 | lint + 单测 + tsc 绿 | §11 | CI |
| SC-10 | Spec 07/14/15 + 术语已同步 §12 | §12 / 术语标准 | 文档 diff |

---

## 2. Non-Goals（本 Spec / AC-P0）

| 非目标 | 说明 |
|---|---|
| `row_access: scoped` / `row_policy` / 强制谓词 AST | AC-P1；本波次配置出现 `scoped` → 编译失败 |
| Agent Constraints | AC-P1.5 |
| Dynamic RLS / JWT ABAC / Active Role | AC-P2+ |
| 完整列级权限 / 动态掩码 | 另立 CLS |
| 改工具参数结构携带 schema | ADR-AC-01：AC-P0 不改；靠同 connection 内 sourceName 唯一 |
| 搬迁 Spec 07 出 webui | 仅契约更新（WP-S1） |
| 浏览器 E2E | 默认不做；除非后续任务明确要求 |
| 修改本 Spec 评审前的 `webui/server/proxy` / `access.yaml` 运行时行为 | Gate B 前禁止；属 WP-I\* |

---

## 3. 目标配置模型（AC-P0 合法形态）

```text
Role
  ├── permission_model_version: 1 | 2
  └── allow
        ├── tools          # 仅 DataPlane / Meta；含 AbsoluteDeny → lint fail
        ├── connections    # 含 selectors 时：声明校验；纯 Meta：事实源
        └── tableSelectors[]
              ├── connection / schema / names   # v2 禁用 prefix
              ├── row_access?: all | scoped     # v2 必填；AC-P0 仅 all
              └── row_policy?: …                # AC-P0 禁止出现

Agent
  ├── roles: [...]     # Role Set；legacy `role: x` ≡ `roles: [x]`
  ├── constraints?: …  # AC-P0 忽略配置存在性以外：不得出现生效语义
  └── tokens[]         # 仅鉴权
```

迁移规则（稳态）：

| 形态 | 行为 |
|---|---|
| 一次性迁移前存量 Role 无版本字段 | 发布脚本写入 `permission_model_version: 1` |
| 迁移后缺版本字段 | **编译失败** |
| Admin 新建 Role | 强制 `permission_model_version: 2` |
| Admin 编辑并保存 v1 Role | 升 v2；每 selector 补 `row_access: all`；`prefix` 必须展开为 `names`（无法展开 → 保存失败）；dryRun 展示 diff |
| Agent 仅 `role: x` | 视为 `roles: [x]` |
| `role` 与 `roles` 双写 | 保存拒绝 / reload fail-closed |
| tools 含 AbsoluteDeny 或未分类工具 | lint fail；runtime 仍 AbsoluteDeny |

合法示例见 `design-upgrade.md` §3.2（`finance_bp` + `public_reader`）。

---

## 4. Tool Class（工具分级）

### 4.1 三个分级

| 分级 | 定义 | 授权方式 |
|---|---|---|
| **AbsoluteDeny** | 任何 Agent 不可调用 | **代码基线硬编码**；Role allow 与 YAML 均无法解除 |
| **DataPlane** | 可返回或推断具体源数据 / 源结构 | 必须持有 `(tool, canonicalSourceKey)` ∈ Effective Data Capabilities |
| **Meta** | 不绑定单一源的元信息 | 仅需工具 ∈ EffectiveMetaTools；**不得**由此获得任何源数据 |

### 4.2 全量分类表（覆盖现网 `defaults.known_tools` / `DEFAULT_KNOWN_TOOLS`）

| 工具 | 分级 | 说明 |
|---|---|---|
| `sl_query` | **AbsoluteDeny** | 未经闸门的原生查询面；代码基线不可移除 |
| `sl_read_source` | **AbsoluteDeny** | 同上 |
| `sql_execution` | **AbsoluteDeny** | 现网已 deny |
| `sql_dialect_notes` | **AbsoluteDeny** | 现网已 deny |
| `memory_ingest` | **AbsoluteDeny** | 现网已 deny |
| `memory_ingest_status` | **AbsoluteDeny** | 现网已 deny |
| `lucy_query` | **DataPlane** | 主查询面；改写为上游后转发 |
| `lucy_read_source` | **DataPlane** | 整源读取 |
| `lucy_explain_query` | **DataPlane** | 不返回行，但泄漏源结构与可达性 |
| `lucy_freshness` | **DataPlane** | 今天即受表检查，不得降为 Meta |
| `entity_details` | **DataPlane（未包装）** | 受 `(tool, sourceKey)` 检查；不经 Lucy wrapper |
| `sl_validate` | **DataPlane（未包装）** | 同上 |
| `dictionary_search` | **Meta（敏感）** | 见 §4.4 |
| `discover_data` | **Meta（敏感）** | 见 §4.4 |
| `lucy_catalog` | **Meta** | 输出按 capability 过滤 |
| `kx_catalog` | **Meta** | 同上 |
| `connection_list` | **Meta** | 同上 |
| `wiki_search` | **Meta** | 另受 wiki ACL |
| `wiki_read` | **Meta** | 另受 wiki ACL |
| `lucy_begin_question` | **Meta** | 审计埋点 |

`defaults.deny_tools` 中的 AbsoluteDeny 工具名可保留作**文档可见性与双保险**；真正不可配置解除的边界在 Proxy **代码基线**（U-DENY-01）。

### 4.3 未分类默认 AbsoluteDeny（fail-closed）

任何未出现在 §4.2 表中的工具名（上游新增、别名、实验性工具）：

1. Runtime：按 AbsoluteDeny — **不进入** `tools/list`；`tools/call` deny
2. 编译：告警并按 AbsoluteDeny 生效
3. Role 显式 allow 未分类工具 → **lint fail**
4. 分类表版本进入 `toolClassificationVersion`，参与 `policyVersion` 哈希（§8.1）

### 4.4 敏感 Meta

`dictionary_search` / `discover_data`：保留现网 `sensitive_table_prefixes` 语义。

AC-P0 口径平移：仅当 Agent 对该前缀下**全部**源均具备 **任意 DataPlane** capability 时才可调用。不放宽、不收紧相对今天。

### 4.5 未包装 DataPlane（AC-P0）

`entity_details` / `sl_validate`：按 `(tool, sourceKey)` 校验，**行为与今天等价**（U-CLS-03 / D13）。AC-P1 另定「scoped 源 deny 或先包装」——不在本文。

### 4.6 唯一数据闸门

1. 全部发往 KTX 的上游**数据**调用必须且只能由 `authorizeAndRewrite(identity, tool, args)` 产生（P-GATE-01）
2. `tools/list` 过滤与 `tools/call` 拒绝**双重生效**（P-GATE-02）
3. DataPlane 工具可见性：该 tool 在 Effective Data Capabilities 中至少一条 capability 才可见；否则隐藏且调用拒绝（P-GATE-03）

---

## 5. Capability 代数

### 5.1 定义

```text
RoleCapabilities(r) =
  { (tool, sourceKey, rowGrant(r, sourceKey))
    | tool ∈ (r.allow.tools ∩ DataPlaneTools) \ AbsoluteDenyTools
    , sourceKey ∈ SourcesGrantedBy(r) }

RoleMetaTools(r) = (r.allow.tools ∩ MetaTools) \ AbsoluteDenyTools

EffectiveDataCapabilities(agent) = ∪_{r ∈ RoleSet} RoleCapabilities(r)
EffectiveMetaTools(agent)        = ∪_{r ∈ RoleSet} RoleMetaTools(r)

# AC-P0：rowGrant 恒为 TRUE
rowGrant(r, sourceKey) =
  permission_model_version = 1  → TRUE
  row_access = all              → TRUE
  row_access = scoped           → 非法（编译失败）

FinalRows(sourceKey) = TRUE   # AC-P0 占位；无 Agent Constraints / TokenScope 收紧
```

### 5.2 闸门硬检查

```text
对调用工具 tool 与 args 解析出的每个 canonicalSourceKey:
  要求 ∃ rowGrant: (tool, sourceKey, rowGrant) ∈ EffectiveDataCapabilities
  否则 deny，理由码 capability_forbidden:<tool>:<canonicalSourceKeyDisplay>
跨 Role join：允许，当且仅当每个 source 各自具备该 tool 的 capability
```

`canonicalSourceKeyDisplay` 建议稳定串：`connectionId|schema|sourceName|physicalTable`（与键一致），便于审计去重。

### 5.3 禁止的错误代数

| Role A | Role B | 禁止结果 | 正确结果 |
|---|---|---|---|
| `lucy_query` × 财务源 | `lucy_read_source` × 公共源 | `lucy_read_source` × 财务源 | **不存在**该元组 |

### 5.4 `connections` 归属

| 情形 | 规则 |
|---|---|
| Role 含 tableSelectors | 有效连接集由 capability 派生：`{ sourceKey.connectionId }`。`allow.connections` 为声明校验：声明的连接未出现在派生集 → **编译告警**；capability 出现未声明连接 → **编译失败** |
| 纯 Meta Role（无 tableSelectors） | `allow.connections` 为事实源；用于 `connection_list` 等 Meta 输出 |
| 请求携带未授权 `connectionId` | 维持现网 `unknown_or_forbidden_connection:<id>`，**先于** capability 检查 |

### 5.5 Meta 输出过滤

`lucy_catalog` / `kx_catalog` / `connection_list` 可见范围 = Effective Data Capabilities 中出现过的源与连接的并集。不得展示无任何 DataPlane capability 的源（P-META-01）。纯 Meta Role 无 DataPlane capability 时：catalog 源列表为空；`connection_list` 仅展示该 Role 显式 `allow.connections`。

### 5.6 同 Role 多 selector 命中同一 source

- 两次解析的 **rowGrant digest 完全相同** → 合并为一条
- 否则 → **Role 编译失败**（整 Agent fail-closed）
- AC-P0 下 digest 恒为 TRUE 的固定摘要，故同 Role 重叠通常可合并；若未来引入非 TRUE 值，本条仍成立

---

## 6. Canonical Source Key

```text
canonicalSourceKey = connectionId | schema | sourceName | physicalTable
```

| 规则 | 要求 |
|---|---|
| 禁止裸键 | 解析 / 合成 / 注入 / 审计 / Admin preview **禁止**以裸 `sourceName` 或裸 `physicalTable` 作唯一身份 |
| 正向 map | 键至少为 `(connectionId, sourceName)` |
| 同 connection 唯一 | 同一 `connectionId` 内 `sourceName` 必须唯一（跨 schema 亦不可撞名）；冲突 → **编译失败** |
| 反向 map | 键为 `(connectionId, physicalTable)`；同步 `access_log_sources` 写入口径 |
| 工具参数 | AC-P0 **不改**参数结构（仍 `connectionId` + `sourceName`） |

必测：U-KEY-01 / U-KEY-02 / U-KEY-03；场景 S8。

---

## 7. Permission Model Version

| 版本 | Selector | AC-P0 |
|---|---|---|
| **1** legacy | 可无 `row_access`（缺省 all）；允许 `prefix` | rowGrant = TRUE；`prefix` 扩权须记 `policy_scope_expanded` |
| **2** | 每 tableSelector **必须** `row_access: all \| scoped`；**仅允许 `names`，禁用 `prefix`** | 仅 `all`；`scoped` / `prefix` → 配置拒绝 / 编译失败 |

缺字段唯一口径：一次性迁移标 `1`；之后缺字段 → 编译失败。lint：迁移窗口 warn，完成后 fail。

---

## 8. Effective Policy 编译与提交

### 8.1 编译输入与 `policyVersion`

```text
PolicyCompilationInput = {
  accessConfigDigest   : sha256(access.yaml 规范化内容)
  sourceMapVersion     : 现有 acl.ts sourceMapVersion（钉住快照）
  toolClassificationVersion : §4.2 分类表版本常量
}
policyVersion = sha256(accessConfigDigest || sourceMapVersion || toolClassificationVersion)
```

规则：

1. source map 变化必须触发重编译，语义与 access.yaml 变化相同；**不得**依赖 60s TTL 静默生效
2. 同一 `policyVersion` 内所有请求使用同一份钉住的 source map 快照
3. `policyVersion` 与 capability digest 写入 `permission_snapshots` 与 `access_log`
4. v1 `prefix` 因 source map 变化导致授权集合扩大 → 必须产生 `policy_scope_expanded` 可观测记录（不得静默）

### 8.2 Admin 写入路径（唯一推荐变更路径）

WebUI 与 MCP Proxy **同进程**（`webui/server/index.ts`）。

```text
dryRun → 用户确认 → save:
  1. 内存编译候选 EffectivePolicy（全量或受影响闭包）
  2. 编译失败 → 不写盘、不切 runtime → 保存失败（含原因与受影响 Role/Agent）
  3. 编译成功 → 写盘 access.yaml → 原子替换 runtime 策略引用
  4. runtime 切换失败 → 回滚磁盘到写前 → runtime 保持写前 → 保存失败
  5. 成功 → 返回 policyVersion 与 runtimeAck: true
```

收窄 / 禁用 Agent / 删换 Role / 撤 Token 导致的权限下降均走此路径。**不存在**「盘已新、权仍旧」却返回成功。

热路径：只读当前原子引用的 EffectivePolicy；**禁止**热路径解析 YAML 或重建 source map。

### 8.3 外部手改 YAML / 非法热加载

| 情况 | 行为 |
|---|---|
| 编译成功且相对运行中为等价或放宽 | 可原子切换；切换失败可回退 last-known-good |
| 编译成功且为收窄 / 禁用 | 必须成功切换；失败则不承认新盘生效并告警；ack 前不得对调用方展示已收窄 |
| 编译失败，可定位受影响 Agent | 这些 Agent 的 **DataPlane 全部 deny**；Meta 的数据相关输出默认 deny（catalog 置空） |
| 编译失败，无法可靠定位（如 YAML 无法解析） | **数据面整体 deny**（全部 Agent 的 DataPlane），直至修复或回滚 |
| 启动期无任何已验证策略 | 拒绝进入可服务状态 |

last-known-good：**允许**等价/放宽切换失败回退、进程重启加载上一份已验证策略；**禁止**在「意图收窄但编译/切换失败」时继续提供更宽旧权并表现为健康。

### 8.4 降级可观测与恢复

| 要求 | 内容 |
|---|---|
| 告警 | 进入受影响 Agent deny 或整体 DataPlane deny 时：写 `config_change_log` + 结构化日志；Admin 顶部常驻 banner（原因 + 范围） |
| 健康信号 | 健康检查区分「服务进程可用」与「策略降级」；降级不得标为完全健康 |
| 恢复 | Runbook（Gate C 前交付）：① Admin 修复后保存；② 运维回滚 `access.yaml` 到上一可编译版本 |
| 紧急覆盖 | **默认不提供**（O6）。若未来提供：显式确认、限时、审计；本 Spec 不授权实现 |

### 8.5 「整体 DataPlane deny」影响面（发布检查项）

| 维度 | 评估（AC-P0） |
|---|---|
| 触发条件 | 外部手改导致 YAML 无法解析 / 无法定位受影响 Agent；或启动无已验证策略 |
| 影响 | 全部 Agent 的 DataPlane 工具拒绝；Meta catalog 置空；Wiki Meta 仍可按 wiki ACL（不授予源数据） |
| 相对现网 | 严于「沿用更宽旧权」；换取 fail-closed |
| 缓解 | Admin 路径不得进入该态（§8.2）；发布前演练 Runbook；监控 banner + 健康探针 |
| 发布门禁 | Release notes / Gate C 必须包含「整体 deny 演练或 Runbook 签字」 |

### 8.6 编译 / reload SLO（闭合 design O5）

| 指标 | 目标（本地单机、典型 access.yaml ≤ 50 Role、source map ≤ 5k 源） |
|---|---|
| Admin dryRun / save 编译 p95 | ≤ **2s** |
| source map 变化触发重编译 p95 | ≤ **3s** |
| 热路径 `authorizeAndRewrite`（已编译策略）p95 | 不劣于现网同路径（回归基准：升级前同 fixture） |

超限：记结构化日志；**不**因此放宽 fail-closed。数值可在 Gate B 按实测微调，但不得删除上限。

---

## 9. 兼容性不变量（U-COMPAT-01）

对 **单 Role、v1 legacy** 的 Agent：

> 升级后 Effective Data Capabilities 推导出的「(DataPlane tool × 授权源)」集合，须与升级前「role.tools（扣除全局 deny）× role 授权表」逐项等价：**不弱不宽**。

覆盖：工具可见性、`tools/call` allow/deny、敏感 Meta 前缀规则、未包装工具源检查。多 Role / v2 / capability 纠偏场景**不适用**本不变量（那些由 U-CAP-\* 覆盖）。

---

## 10. 裁决流水线与 Deny Reasons

### 10.1 流水线

```text
Bearer → Identity(userId)
  → EffectivePolicy[userId]（原子引用，含 policyVersion）
  → tools/call:
       if tool ∈ AbsoluteDenyTools 或 未分类 → deny (tool_absolute_deny / tool_unclassified)
       if tool ∈ DataPlaneTools:
            authorizeAndRewrite:
              connection 校验 (unknown_or_forbidden_connection)
              解析 canonical keys
              要求 (tool, sourceKey) ∈ EffectiveDataCapabilities
                否则 capability_forbidden
              （AC-P1 占位）FinalRows；未包装遇 scoped → 本波次不可达
              仅此处产生上游数据调用
       if tool ∈ EffectiveMetaTools:
            Meta 规则（catalog 过滤；敏感前缀；wiki ACL）
       else deny (tool_forbidden)
  → audit(policyVersion, capability digest, canonical keys, reason)
```

### 10.2 Deny / decision_reason（AC-P0）

保留现网仍适用的码；新增 / 收紧如下。

| Code | 语义 | 相对现网 |
|---|---|---|
| `allowed` | 允许 | 保留 |
| `tool_absolute_deny:<tool>` | 命中代码基线 AbsoluteDeny | **新增**（含 `sl_*` 等） |
| `tool_unclassified:<tool>` | 未分类工具按 AbsoluteDeny | **新增** |
| `tool_forbidden_global` | 命中 YAML `defaults.deny_tools` | 保留（双保险） |
| `tool_forbidden` | Role/EffectiveMeta 未授权该工具 | 保留 |
| `capability_forbidden:<tool>:<sourceKey>` | 缺少 `(tool, sourceKey)` capability | **新增**；DataPlane 源级拒绝主码 |
| `table_forbidden:<table>` | — | **AC-P0 实施后 DataPlane 路径停止作为主裁决码**；可短暂双写兼容审计筛选，UI 主文案改 capability |
| `unknown_or_forbidden_connection:<id>` | 连接缺失/未授权 | 保留；先于 capability |
| `raw_query_forbidden` | 禁止 raw query/sql | 保留 |
| `explicit_table_required:<…>` | 缺显式表引用 | 保留语义；实现可映射到 capability 检查失败 |
| `sensitive_metadata_forbidden:kx` | 敏感 Meta 未覆盖前缀全源 | 保留口径，判定改 capability |
| `agent_disabled` | Agent 禁用 | 保留（现网 acl；与旧文档 `user_disabled` 对齐时以代码为准） |
| `role_resolution_failed:<role>` | Role 解析/编译失败映射到该 Agent | 保留并扩展 |
| `policy_degraded_deny` | 处于 §8.3 降级态导致的 DataPlane deny | **新增** |
| `invalid_arguments:…` | 参数校验 | 保留 |

AC-P1 预留（本波次不得出现为成功路径）：`row_policy_requires_wrapped_tool`、`row_policy_upstream_unproven`。

### 10.3 审计字段（AC-P0 必须）

| 位置 | 字段 |
|---|---|
| `access_log` | `policy_version`；既有 `decision_reason`；canonical source keys（经 `access_log_sources`，键口径 §6） |
| `permission_snapshots` | capability digest；`toolClassificationVersion`；role set |
| `config_change_log` | `policy_scope_expanded`；策略降级进入/恢复事件 |

---

## 11. 验收与测试映射

### 11.1 场景 → 用例

| 场景 | L1/L2/L3 |
|---|---|
| S1 多 Token 同权 | 契约 + UAT |
| S2 / S2b capability | U-CAP-01..02；AC-SEC-CAP |
| S3 版本 / prefix | U-VER-01..04 |
| S4 行授予 | AC-P0 仅占位：rowGrant/FinalRows ≡ TRUE |
| S5 工具分级 | U-CLS-01..03；U-DENY-01；AC-SEC-SL/CLS |
| S6 legacy | U-COMPAT-01；S6 `policy_scope_expanded` |
| S7 / S10 编译提交 | U-REL-01..03 |
| S8 key | U-KEY-01..03；AC-SEC-KEY |
| S9 攻击面 | AC-SEC-\* |
| S11 VIEW | 迁 v2+names+all 行为不变（UAT） |
| S12 语义层变化 | U-REL-04；AC-SEC-SCOPE |

### 11.2 命令（实施后）

```bash
cd webui
npm test -- acl capability canonical tool-classification mcp-proxy-acl admin-agents admin-roles
npm run lint:spec
npm run lint:terminology
./node_modules/.bin/tsc --noEmit
```

### 11.3 Gate C 摘录

- SC-01…SC-10 有证据
- U-COMPAT-01 绿
- AC-SEC-SL / CLS / CAP / KEY / SCOPE 绿
- 降级 banner + Runbook 已合并
- Release notes **未**声称 Dynamic RLS / 行级 scoped 已交付

---

## 12. 契约变更清单（WP-S1 / 实施同步）

| 契约 | 变更 | 状态 |
|---|---|---|
| 本文 Spec 98 | AC-P0 Runtime 语义 | **本 WP-S0** |
| `00-product-terminology-standard.md` | 登记 Terminology Compliance 全部条目 | **本 WP-S0** |
| `07-mcp-auth-proxy-spec.md` | `capability_forbidden`；工具分级；`policyVersion`；波次边界；§5.1.2 LKG；§5.1.3 prefix；§6 canonical map；Role 示例去 `sl_*` | **v1.4.1（Gate B P0 正文已对齐）** |
| `14-agent-admin-…` / `15-role-admin-spec.md` | `roles[]`；capability preview；版本迁移；`runtimeAck`；禁双并集摘要 | **WP-S1 草稿（v0.2 §0）** |
| 审计 schema / Admin 筛选项 | §10.3 已写入 Spec 07 §0.5；`capability_forbidden` 筛选契约已登记；UI 实现属 WP-I6 | WP-S1 契约 + Gate B 后 WP-I6 |
| Security Eval | AC-SEC-SL/CLS/CAP/KEY/SCOPE | WP-I7 |
| `docs/vision.md` / feature map | 「不做行级」口径 | AC-P0+P1 退出后 |

### 12.1 design-upgrade §9 逐条对照（WP-S1 验收）

| design-upgrade §9 | 落点 | WP-S1 状态 |
|---|---|---|
| Spec 07：`capability_forbidden`；工具分级；`policyVersion`；波次边界；LKG / prefix / map | `07` §0、§0.6、§3、§5.1.1–§5.1.3、§6、§6.1.1 | **v1.4.1 正文已对齐** |
| 审计 schema：`policy_version`；capability digest；`policy_scope_expanded`；降级事件 | `07` §0.5 / 快照 DDL；权威字段表 Spec 98 §10.3 | 草稿已写入 |
| Admin API：`roles[]`；`runtimeAck`；版本迁移与 `prefix` 展开 dryRun | `14` §0；`15` §0 / §7 | 草稿已写入 |
| Admin 审计 UI 筛选项补 `capability_forbidden` | `07` §0.2 契约登记；UI 实现 WP-I6 | 契约已登记 |
| Security Eval AC-SEC-\* | Spec 98 §11 / §12 | **非 WP-S1**（WP-I7） |
| 术语标准 | `00` + Spec 98 Terminology | **WP-S0 已做** |
| `vision.md` / feature map | Spec 98 §12 | **延后**（AC-P0+P1 退出后） |

口径单一性：安全代数 / Deny 全表 / 分类全表 **只以 Spec 98 为权威**；07/14/15 仅钉契约增量与交叉引用，不另立公式。

---

## 13. 实现锚点（Gate B 后 WP-I\*；本文不改代码）

| 区域 | 文件 |
|---|---|
| Source map / 合成 / 编译 | `webui/server/proxy/acl.ts` |
| 闸门 | `webui/server/proxy/mcp-proxy.ts` |
| 提交 | `webui/server/index.ts` + `admin/{agents,roles}.ts` |
| 审计 | `webui/server/proxy/audit.ts` |
| Lint | `scripts/lint-spec.mjs` |
| 类型 | `webui/src/lib/types.ts` |

---

## 14. ADR 对照表（Gate B 强制）

| ADR | 决策摘要 | 本文章节 | 覆盖？ |
|---|---|---|---|
| ADR-AC-01 | Canonical key；正反向禁裸键；同 connection sourceName 唯一 | §6 | 是 |
| ADR-AC-02 | 三分级全表；未分类 AbsoluteDeny；未包装规则；唯一闸门 | §4 | 是 |
| ADR-AC-03 | Capability 代数；connections；Meta 过滤；重叠 selector | §5 | 是 |
| ADR-AC-04 | `permission_model_version`；v2 禁 prefix；缺字段口径 | §3 §7 | 是 |
| ADR-AC-05 | Row Policy 前置（AC-P1） | §2 Non-Goals；§4.5 占位 | 是（冻结，不实施） |
| ADR-AC-06 | 编译输入含 source map；原子提交；降级可观测 | §8 | 是 |
| D1–D13 | design §8.1 冻结决策 | 全文 | 是 |
| O5 SLO | Spec 给出数值 | §8.6 | 是（待 Gate B 确认数值） |
| O6 紧急覆盖 | 默认不提供 | §8.4 | 是 |
| §9 契约 | 07/14/15/术语/审计/Eval | §12 | 术语+98+07/14/15 草稿已做；Eval/vision 延后 |

---

## 15. Gate B 评审问题清单

请委托人在勾选 Gate B 前对下列问题给出明确批注（同意默认 / 改默认 / 搁置并写明）：

1. **§8.6 SLO 数值**：编译 p95 ≤2s / 重编译 ≤3s 是否接受？是否改为「仅告警不设硬门禁」？
2. **O1 `role` 单字段**：是否接受「两个次版本后 lint warn→fail」写入 AC-P0 实施范围，还是仅文档建议、本 WO 不排期？
3. **O4 Wiki `allowed_roles`**：多 Role 是否确认「Role 并集命中即允许」？须否在 WP-S1 改 wiki-acl 契约句？
4. **O7 legacy `prefix` 强制迁移截止**：是否与 O1 绑定设截止日期，还是 AC-P0 仅观测 `policy_scope_expanded`、不强制迁完？
5. **`table_forbidden` 退役节奏**：是否接受「实施后 DataPlane 主码改为 `capability_forbidden`，审计 UI 双读一个次版本」？
6. **整体 DataPlane deny 时 Wiki Meta**：§8.5 写「wiki 仍可按 wiki ACL」。是否改为降级态下 Meta 一并全 deny？
7. **纯 Meta Role + 空 catalog**：§5.5 是否接受「无 DataPlane capability 则 catalog 源列表为空」作为产品预期？
8. **`tool_absolute_deny` vs `tool_forbidden_global`**：`sl_*` 同时命中代码基线与 YAML 时，审计主码优先 `tool_absolute_deny` 是否确认？
9. **WP-S1 范围**：Gate B 是否要求 07/14/15 补丁草稿一并审过才勾选，还是先批 Spec 98 + 术语、契约补丁可紧随但同 Gate？
10. **U-COMPAT-01 fixture**：是否指定以现网某生产 Role（或 `access.yaml` 内具名 Role）为金样，还是允许测试自建最小 legacy fixture？

**建议默认（若无批注则按此理解推进 WP-S1，但仍须显式勾选 Gate B）：**

- Q1 接受数值，超限只告警不阻断请求  
- Q2 本 WO 只做迁移标 1 + 文档建议，不排 `role` 字段删除  
- Q3 并集命中；WP-S1 补一句  
- Q4 不设强制截止；强制迁完另立  
- Q5 双读一个次版本  
- Q6 维持 wiki 可按 wiki ACL（不授源数据）  
- Q7 接受空 catalog  
- Q8 优先 `tool_absolute_deny`  
- Q9 **推荐**：Spec 98 + 术语可先评；07/14/15 须在勾选 Gate B 前至少有对照草稿（WO 原文「B 前完成草稿」）  
- Q10 允许最小自建 fixture + 一条「对照升级前 acl.check 金样」测试

---

## 16. 审核清单（Gate B）

- [ ] 确认本文与 `design-upgrade.md` v1.1.2 无未解释冲突
- [ ] §14 ADR 对照表逐行勾选
- [ ] §15 问题清单已批注或接受建议默认
- [ ] 术语标准已登记且无 Forbidden 冲突
- [ ] 确认 AC-P1 / scoped / 强制谓词不在实施范围
- [ ] 确认 Gate B 通过前不改 `webui/server/proxy` / `access.yaml` 运行时行为
- [ ] 勾选后允许按 WO-59 拆 WP-I\* 并改代码

— 完
