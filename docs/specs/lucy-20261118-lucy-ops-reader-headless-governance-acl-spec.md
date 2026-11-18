# `lucy_ops_reader` 无头可问治理面 ACL Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（不绑定发版号） |
| 功能编号 / 优先级 | **P1-49**／REQ-030-070／**P1**（优先级待委托人裁定）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | **v0.1-draft。仅登记与起草，不开发。** 目标：绑定 `lucy_ops_reader` 的无头 MCP Agent 在连接 `lucy-ops` 已启用 W0∪W1∪W2 时，角色表选择器对「规范 W0 指纹」实例可收敛到冻结 sourceName 全集，从而可问治理面 SOP（人口／MECE／近窗未访问等）可达；定制 Role 不被覆盖；W0 调用流水主路径仍可用。终稿未确权；未获开发授权；未授权不改运行代码；测试台 not_registered；不入核心分母；≠ 可上线 |
| 决策来源 | 2026-11-18 委托人：表权限页只放行 `ops_calls`／`ops_call_tables` 而连接已启用多表；确认未开放表对无头运维有用；授权「按仓库规范起草 Spec 和 Plan，暂不进行开发」 |
| 需求来源 | 同日对话；可问治理面已交付语义／Skill／Wiki，但正式 Role ACL 仍停在 SC-17c W0 两表；ensure 扩 `enabled_tables` 不扩 Role |
| 实施主体 | Lucy：`access.yaml` 种子／ensure 窄例外、`ops-evidence`／`ensure-system-formal-roles`、相关单测与文档指针。不改 ACL 编译代数、不改治理投影 builder、不改 `lucy_admin` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「第一性原理：主路径可用性优先」「Docker 对齐」「新增 Spec／Plan 的落盘清单」 |
| 与既有 Spec 的关系 | **修订** [`lucy-20261101-ops-evidence-askable-governance-spec.md`](lucy-20261101-ops-evidence-askable-governance-spec.md) **D22**（「ensure 永不改已存在 Role 表选择器」）与 Spec 149／[`lucy-20261105-customer-default-system-roles-spec.md`](lucy-20261105-customer-default-system-roles-spec.md) §3.2「已存在不扩 `names`」——本条仅增加**窄例外**：匹配「规范 W0 指纹」时允许把 `names` 升到冻结全集。参考模板已列全集的事实不变。不改概念控制面（P1-11）与 `lucy_ops_reader` 无概念写工具正交 |
| 实施计划 | [`docs/plans/lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md`](../plans/lucy-20261118-lucy-ops-reader-headless-governance-acl-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。问题、方案对比、指纹 heal 合同、伪代码、验收、开放项。终稿未确权；测试台 not_registered |

## 闭口层级

- 层级：功能合同
- 本条承诺：在约定 ensure 时机，若正式 Role `lucy_ops_reader` 的表选择器匹配「规范 W0 指纹」，则将其 `names` 幂等升为执行时 `OPS_EVIDENCE_FROZEN.sourceName` 全集（保序、去重）；不匹配指纹则整块不写；绑该 Role 的无头 MCP 对已启用的 W1／W2 source 不再因 Role ACL 被拒（连接未启用或投影未就绪仍可按既有合同 deny／空）；W0 两表与既有工具面主路径仍可用。
- 本条出口：SC-01–SC-14 的本机自动化（单元／组件；真实进程夹具覆盖 ensure 写盘与指纹判定）。可选 Docker demo MCP 冒烟列入 Plan，**不**作为功能合同收口必要条件。
- 不在本条出口：浏览器 E2E、移动窄屏、整库旅程、客户现场升级、镜像／Helm 发布取证、访问关系图页数字对等、强制覆盖客户已改 Role、把概念写工具并入 `lucy_ops_reader`、治理投影 builder 改口径。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| Normative W0 Fingerprint | 规范 W0 指纹 | SC-17c W0 指纹、旧正式 Role 指纹 | 「全部表」「*」 | 判定已落盘 `lucy_ops_reader` 是否可自动扩 `names` 的机器谓词；见 §4.1 |
| Headless Ops Questioning | 无头运维问数 | 无头 MCP 运维问数 | WebUI 登录运维 | 经 MCP Proxy Bearer Token、绑定 `lucy_ops_reader`、不依赖打开管理台图页 |

沿用：Ops Evidence Role（`lucy_ops_reader`）、运维问数连接（`lucy-ops`）、可问治理面、W0／W1／W2 sourceName、`ops-questioning`、`demo_ops`。

Forbidden：把连接 `enabled_tables` 说成 Role 已放行；把指纹 heal 说成覆盖任意已改 Role；把本条写成自动创建／改绑 Agent 或签发 Token。

## Design System Compliance

### Referenced Specs

- 无新增页面或控件。Role 详情「表权限」页沿用既有呈现；heal 后刷新可见更多勾选表。

### What This Change Follows

- [x] 不新增导航、Tab、向导
- [x] Role id／连接 id／表名／工具名继续 `notranslate`／`translate="no"`
- [x] 不把 `lucy_ops_reader` 写成 WebUI 所有者文案

### Exceptions (If Any)

- None.

### Follow-up Needed

- 无（若 WebUI 需「已自动扩权」提示横幅，另开呈现 Spec；本条不要求）。

## 1. 问题与证据

1. **连接侧已扩、角色侧未扩**：`ensureOpsEvidence` 将 `lucy-ops.enabled_tables` 收敛到 W0∪W1∪W2（约 12 张）；管理员在连接启用表页看到「很多表」。
2. **正式 Role 仍停 W0**：Docker demo 种子与 SC-17c 夹具故意只列 `ops_calls`／`ops_call_tables`；客户默认系统 Role Spec §3.2／可问治理面 D22：**已存在 Role 不扩 `names`**。平滑升级保留 `access.yaml` → 存量永远停在两表。
3. **无头能力缺口**：参考模板与 `ops-questioning` Skill／Wiki 已按 12 源写路由（配置人口、MECE 五档、近窗未访问、表活跃率、授权／访问路径等）。绑 `lucy_ops_reader` 的无头 Agent 查 W1／W2 时被 ACL deny，易被误判为「无能数据」。
4. **主路径仍在**：W0 调用流水（谁被拒、生成 SQL）在现 ACL 下仍可用——本条不得破坏该路径。

## 2. 目标与非目标

### 2.1 目标

1. 让「规范 W0 指纹」的正式 `lucy_ops_reader` 在 ensure 成功路径上**幂等**升到冻结 sourceName 全集，使无头可问治理面与 Skill 路由对齐。
2. 更新 demo／项目种子中的静态 `lucy_ops_reader` 块，使 **fresh** 实例开箱即全量（不再依赖「从模板新建」才带齐）。
3. 保留定制保护：connections／schema／`names`／tools／`row_access`／`source_scope` 任一偏离指纹 → **不写**该 Role。
4. 明确修订 D22／§3.2 的窄例外文案，避免文档仍写「ensure 永不扩表」绝对值。

### 2.2 非目标

- 不强制覆盖客户已缩小／扩大／改工具／加 `source_scope` 的同名 Role。
- 不把 `lucy_ops_reader` 并入 `lucy_admin`；不授予概念控制面写工具。
- 不改治理投影算法、access-map builder、图页 UI。
- 不自动创建／改绑 Agent 或 Token（含 `demo_ops`；demo 种子是否已有 `demo_ops` 沿用既有合同）。
- 不把「连接启用表」与「Role 放行」合并成单一概念。

## 3. 方案对比与推荐

| 方案 | 做法 | 优点 | 风险 | 裁定（草案） |
|---|---|---|---|---|
| A 仅文档／手动扩权 | 手册要求管理员勾表 | 零代码风险 | 无头默认仍不可用；与「提升能力」目标不符 | 否 |
| B 规范 W0 指纹 heal | ensure 仅当指纹匹配时扩 `names` | 修存量与 demo；定制安全；符合主路径优先 | 须精确定义指纹；工具集漂移要另判 | **推荐（D0＝B）** |
| C 整块强制收敛到模板 | 每次 ensure 覆写整 Role | 实现简单 | 覆盖客户刻意收紧／扩权；违反既有「已存在不覆盖」 | 否 |

**D0（草案）＝B。** 终稿前可由委托人改为 A（则本条降级为文档修订，删 heal SC）或坚持 C（须另写破坏性升级与回滚）。

## 4. 行为合同

### 4.1 规范 W0 指纹（机器谓词）

记正式 Role `R = roles.lucy_ops_reader`。指纹匹配当且仅当**全部**成立：

1. `R` 存在且为 map；**无** `source_scope`（含不得为 `catalog_bound`）。
2. `R.allow.connections` 经规范化后**恰好** `{lucy-ops}`（单元素；允许 YAML 写法差异，比较用集合）。
3. `R.allow.tableSelectors` **恰好**一个元素 `S`，且：
   - `S.connection === lucy-ops`
   - `S.schema === OPS_EVIDENCE_FROZEN.schema`（`main`）
   - `S.names` 经 trim／去重／排序后集合**恰好**等于 `{ops_calls, ops_call_tables}`
   - `S.row_access` 缺省或为 `all`
4. `R.allow.tools`：集合**等于**参考模板工具集，**或**为其真子集且至少包含 `{lucy_catalog, lucy_query, lucy_read_source}`（**OQ-1** 定稿时二选一；草案倾向＝**超集允许幂等补齐缺失工具名，但不删客户多出的工具**；若 tools 含模板外未知工具则仍匹配指纹但**只扩 names、不删工具**）。

不匹配 → `branch=D`（已存在不写）语义不变。

### 4.2 Heal 写盘规则

在 `ensureOpsEvidence` **即将成功返回前**（与缺则创建同一状态表门闸：`connectionWrite`／`readiness` 允许写 Role 的行），若 `R` 存在且指纹匹配且 `names` 尚未等于冻结全集：

1. 将唯一 selector 的 `names` 设为 `Object.values(OPS_EVIDENCE_FROZEN.sourceName)` 的当前执行时序（与 `expandTemplate(lucy_ops_reader)` 一致）。
2. 若 OQ-1 定稿为「补齐工具」：对模板工具集中缺失的名字**仅追加**到 `tools` 末尾，不改相对已有顺序、不删除。
3. 不改 `description`、不改其他 Role、不改 `users`／Token。
4. 原子写盘；写失败 → 保留原文件、记 warn，**不**阻断连接 ensure 成功返回（与现有 Role ensure 失败策略对齐；**OQ-2**）。
5. 二次 ensure：已是全集 → 不写盘（允许空白差约定为不写）。

缺 Role 时：仍按客户默认系统 Role Spec **缺则创建**全量模板（已含全集）——本条不削弱该路径。

### 4.3 种子与文档

| 制品 | 合同 |
|---|---|
| `examples/docker-demo/project-template/webui/config/access.yaml` 中 `lucy_ops_reader` | `names`＝冻结全集；注释删除「故意只列 W0」夹具句，改为「全量可问治理面；SC-17c 旧指纹仅作 heal 输入」 |
| 客户包 `customer-config.example` | **仍禁止**静态预置 `lucy_ops_reader`（权威＝ensure） |
| Skill／Wiki | 正文可删「须管理员显式扩权」作为**唯一**路径的绝对表述；改为「旧 W0 指纹由 ensure heal；定制 Role 仍须手扩」 |
| SYSTEM_HANDBOOK §运维问数授权 | 同步三步：连接 ensure／指纹 heal 或模板新建／Skill |

### 4.4 无头可观察行为（合同边界）

绑 `lucy_ops_reader` 的 MCP Token，在 heal 后且连接 `enabled_tables` 含目标物理表、治理投影就绪时：

- `lucy_catalog` 可见 W1／W2 sourceName（在 ACL 允许集内）。
- `lucy_query` 对 `ops_agents`（或任一 W1）带合法 `gov.calendar_days=30` **不得**因 `unknown_or_forbidden`／表选择器拒绝而失败（投影未就绪等既有码除外）。
- W0 源仍拒绝任何 `gov.*`（既有合同）。
- 概念写工具仍拒绝（P1-11 正交）。

## 5. 核心流程（伪代码）

```text
function maybeHealLucyOpsReader(accessDoc, frozenNames, templateTools, oq1):
  R = accessDoc.roles?.lucy_ops_reader
  if R is missing:
    return { action: "create_full_template" }  // 既有缺则创建；本条不改触发表
  if not matchesNormativeW0Fingerprint(R):
    return { action: "skip", branch: "D_custom_or_already_partial" }
  names = normalizeNames(R.allow.tableSelectors[0].names)
  target = frozenNames  // execution-time OPS_EVIDENCE_FROZEN.sourceName values
  toolsChanged = false
  if oq1 == "append_missing_tools":
    toolsChanged = appendMissing(R.allow.tools, templateTools)
  if set(names) == set(target) and not toolsChanged:
    return { action: "noop" }
  R.allow.tableSelectors[0].names = target  // preserve template order
  return { action: "heal_write" }

// 挂点（与既有 ensure 状态表同一门闸）
on ensureOpsEvidenceAboutToSucceed(gate):
  if not gate.allowsRoleWrite:
    return
  result = maybeHealLucyOpsReader(...)
  if result.action in {"create_full_template", "heal_write"}:
    atomicWriteAccessYaml(...)  // failure → warn; keep previous bytes
```

关键失败／降级序：指纹不匹配 → 跳过（不得部分改 names）；写盘失败 → 保留旧 ACL 且连接 ensure 仍可成功；连接未启用某表 → 查询层既有拒绝（非本条扩权失败）。

## 6. 对既有合同的修订要点（定稿时同步改指针文）

| 原文合同 | 本条修订 |
|---|---|
| 可问治理面 D22：ensure 永不改已存在 Role 表选择器 | 改为：除「规范 W0 指纹 → 升 `names`（±补工具）」外仍不改 |
| 客户默认系统 Role §3.2「已存在整块不覆盖、不扩 names」 | 增加窄例外指向本 Spec §4 |
| Spec 149／demo 注释「正式 Role 故意只列 W0」 | demo 种子改为全集；夹具另用测试 fixture 保留 W0 指纹样本 |
| SYSTEM_HANDBOOK「表范围必须管理员手动做」 | 改为：指纹实例由 ensure heal；定制仍手动 |

## 7. 验收（SC）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 指纹谓词：恰 W0 两名＋单连接 `lucy-ops`＋`main`＋无 `source_scope` → match | 单测真／假表 |
| SC-02 | `names` 含任一 W1／W2 或缺少 `ops_calls` → 不 match | 单测 |
| SC-03 | `connections` 含第二连接或 `*` → 不 match | 单测 |
| SC-04 | 设了 `source_scope` → 不 match | 单测 |
| SC-05 | match 且缺全集 → heal 后 `names` 深等模板顺序全集 | 单测写盘／内存 doc |
| SC-06 | 已是全集 → 二次 ensure 不写盘（或字节语义不变） | 单测 |
| SC-07 | 定制 Role（缩表或改 tools 越出 OQ-1 规则）→ 文件字节不变 | 单测 |
| SC-08 | 缺 Role＋门闸允许 → 仍创建全量模板（回归客户默认系统 Role） | 单测 |
| SC-09 | heal 写失败 → 原 `access.yaml` 保留；ensure 不因 Role 写失败抛成连接失败（按 OQ-2） | 故障注入 |
| SC-10 | demo 模板静态 `lucy_ops_reader.names` 含全部冻结 sourceName | 文件断言 |
| SC-11 | 客户 example **不含**静态 `lucy_ops_reader` | 文件断言 |
| SC-12 | 夹具 Agent 绑 heal 后 Role：`lucy_query` W1＋`gov.calendar_days=30` 不因表 ACL deny | 组件／代理层测 |
| SC-13 | 同夹具 W0＋任意 `gov.*` → 仍 `invalid_arguments` | 回归 |
| SC-14 | 同夹具概念写工具仍拒（P1-11 正交） | 回归或指针到既有测 |

## 8. 开放项（须终稿前闭合）

| ID | 问题 | 倾向 |
|---|---|---|
| OQ-1 | tools：指纹是否要求全等模板？heal 是否追加缺失工具？ | 追加缺失、不删多余；多余未知工具仍允许 heal names |
| OQ-2 | Role 写盘失败是否允许连接 ensure 仍成功？ | 是（与现 warn 策略一致） |
| OQ-3 | heal 挂点是否仅 ops-evidence ensure，还是启动 `lucy_ops_reader` CLI ensure 也跑？ | 两处同谓词，避免分叉 |
| OQ-4 | 测试台：本条是否建 `UAT-SUITE-OPS-READER-HEADLESS`？ | 授权开发后再建；起草阶段 not_registered |
| OQ-5 | D0 是否维持方案 B？ | 维持 B |

## 9. 授权边界（现值）

- **当前**：仅文档（本 Spec、Plan、总账、需求池、索引）。**禁止**改 `webui/server`、种子 YAML 运行副本、lint 以外的任何运行路径。
- **获终稿确权＋开发授权后**：允许 Plan 白名单路径；仍禁止改 ACL 编译内核代数、禁止改治理 builder、禁止并入概念写工具。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 误伤「故意只留 W0」的生产 Role | 指纹必须集合恰好两表；多表定制不写 |
| 误伤改过 tools 的 Role | OQ-1 明确；越出规则则 skip |
| 文档绝对值句残留 | 定稿 checklist 改 D22／§3.2／handbook／Skill |
| 把连接启用当成已授权 | SC 与术语 Forbidden 写明两层 |
| 无投影时空结果被当成 ACL 成功 | SC-12 只断言「非表 ACL deny」；投影未就绪沿用既有码 |
