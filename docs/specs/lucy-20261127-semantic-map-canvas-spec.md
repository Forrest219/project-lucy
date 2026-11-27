# 语义地图（只读 Canvas）Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 语义地图（只读 Canvas）Spec |
| 文档类型 / 版本 | Spec（语义层治理可视化）／**v1.0** |
| 日期 / 目标版本 | 2026-11-27／产品线 `0.35.0`（`lucy-v0.35`）；目标版本可调，池内现为 `—` |
| 功能编号 / 优先级 | **REQ-0121**／**P1**。**不入核心分母** |
| 台账号 | 无 |
| 阶段 | S2 |
| 状态 | S2｜**v1.0；终稿已确权**（委托人 2026-11-27 明示「授权 spec定稿」；设计稿 §0.1 OQ 同批确认）。设计对抗 [Claude Code 三轮 ACCEPT WITH GAPS](../reviews/2026-11-27-semantic-map-canvas-adversarial-review.md)。配对 [Plan](../plans/lucy-20261127-semantic-map-canvas-plan.md)／[`UAT-SUITE-SEMANTIC-MAP`](../qa/uat/suites/semantic-map/suite.md)。**未获开发授权**；测试台 NOT RUN。≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | **终稿已确权 ≠ 开发授权**。未获委托人另发开发授权前禁止改运行代码。正式挂主导航另须 **IA 独立确认**（本 Spec 可深链／临时入口验收，不得未确认改 `navigation.ts`） |
| 需求 / 验收 | [REQ-0121](../backlog/entries/REQ-0121-semantic-map-canvas.md) · SC-01–SC-16 · `UAT-SUITE-SEMANTIC-MAP` |
| 配对计划 | [Plan](../plans/lucy-20261127-semantic-map-canvas-plan.md) |
| 设计稿 | [design v1.2](../design/design-2026-11-27-semantic-map-canvas.md) |
| 评审 | [设计对抗](../reviews/2026-11-27-semantic-map-canvas-adversarial-review.md) · [Plan／UAT 对抗](../reviews/2026-11-27-semantic-map-plan-uat-adversarial-review.md) |
| 实施主体 | Lucy WebUI＋只读投影 API；不改 KTX；**无写盘 API** |
| 输出位置 | `docs/specs/lucy-20261127-semantic-map-canvas-spec.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 2026-11-27 终稿：吸收设计 v1.2 与设计对抗 GAP G2–G6；委托人授权 Spec 定稿 |

## 闭口层级

- 层级：功能合同
- 本条承诺：为治理方提供**独立只读「语义地图」**，在多连接／多 Schema／近三千～三千五百表尺度下，按 Schema 岛 → formal-join 连通团 → 表侧栏完成宏观定位与筛选，并钻取到既有表工作台；YAML 仍为配置权威；地图不写盘。
- 本条出口：SC-01–SC-16 全部有证据（含真实前台浏览器必做项）；现网 joins 分层抽样（G1）为取证任务，不挡本条功能合同收口，但 Spec／对外不得宣称「formal 并集已在现网验证」直至抽样产出。
- 不在本条出口：知识图谱／本体引擎；画布编辑；访问关系图改写；Catalog `joinCount` 对齐专项；主导航 IA 未确认前的菜单挂载；客户发版取证。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:（登记时点＝实现 PR 同批，门禁 N1）

| 术语 | UI 主术语 | 禁止混称 |
|---|---|---|
| Semantic Map | 语义地图 | 拓扑图、ER 图、知识图谱、访问关系图 |
| Schema Island | Schema 岛 | — |
| Join Cluster | 连通团 | 力导向图（作风俗名） |
| Isolated Tables Zone | 孤立表区 | 「无任何依赖」（见 SC-12） |
| Broken Reference | 断引用 | 在索引未就绪时冒用（须用「外部或断引用·未判定」） |
| External Reference | 外部引用 | — |
| Source Conflict (join) | Manifest／overlay 来源冲突 | — |

既有沿用：Schema Manifest、overlay、关联、启用表范围、语义资产、访问关系图。连接 ID／`schema`／`sourceName`／路径 DOM 须 `translate="no"`／`notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- 降级文案：`webui/docs/00-product-terminology-standard.md` §4.6.1；组件 `DisplayDegradedNotice`

### What This Change Follows

- [x] 只读页：无写 primary；钻取「打开工作台」为离开地图的主路径动作。
- [x] 空／错误／部分可见／陈旧态在面板内写明，禁止用 0 边冒充真空。
- [x] 搜索／筛选遵循 filter-input 本地 state＋URL 跟随（深链参数）。

### Exceptions

- 设计系统尚无「分层图画布」章节；本 Spec 定产品合同。可参考访问关系图只读绘制经验，**术语与入口不得合并**。

### Follow-up Needed

- New terms 登记进 `webui/docs/00-product-terminology-standard.md`（N1：实现 PR 同批）。
- G1 现网 joins 抽样取证产出后，方可对外使用「已验证」措辞（见 §5）。

## 交互合同

- 路由：/semantic-map（提案；IA 未确认前允许深链／临时入口验收，不得默认真路径挂主导航）
- 基准页：/catalog
- 一件事：治理方在只读语义地图上按连接／Schema／连通团定位表级配置结构，筛选孤立／断引用／未完成等，再钻取到表工作台修改。
- 状态：首访：选连接后见 Schema 岛总览；空：真无表时说明空因；加载：投影未就绪可感知；错误：读失败可归因且不画假空图；0 条：筛选无命中引导改条件；成功：岛／团／侧栏与徽章诚实；部分：单岛失败标不完整；陈旧：数据可能不是最新＋刷新
- 主动作：页内无写盘 primary；「打开工作台」为钻取主路径；「查看合成表 YAML」为次要
- 决定信息：岛／团计数（标作用域）、边来源冲突、外部引用、完成度／启用标记、合成 YAML joins 缺口旁注
- 术语：本条 New terms；与访问关系图区分语强制
- 台账：无新台账
- 状态维度：作用域（全量／仅启用）、索引就绪、快照代次标明，不得互相否定

## 元素清单

- E1｜/semantic-map｜首访｜连接选择＋岛总览｜选连接后渲染 Schema 岛卡（含比较指标）
- E2｜/semantic-map｜加载｜画布区｜投影加载占位；不伪装 0 边真空
- E3｜/semantic-map｜错误｜画布区｜读取失败可归因＋可重试
- E4｜/semantic-map｜陈旧｜画布区｜「数据可能不是最新」＋刷新（复用降级组件）
- E5｜/semantic-map｜成功｜岛卡｜表数／团数／孤立数／启用占比（标作用域）
- E6｜/semantic-map｜成功｜岛内｜连通团＋孤立表区；表点默认折叠进团
- E7｜/semantic-map｜筛选｜工具条｜关键字／孤立／未完成／断引用／作用域切换
- E8｜/semantic-map｜部分｜单岛｜岛失败态；汇总数标不完整
- E9｜/semantic-map｜成功｜侧栏｜摘要＋打开工作台＋合成 YAML（含 joins 旁注）
- E10｜/semantic-map｜决定信息｜边／角标｜来源冲突、外部引用、共享 overlay、未判定态可区分
- E11｜/semantic-map｜主动作｜侧栏｜打开工作台为钻取主路径；无写盘按钮
- E12｜/semantic-map｜0 条｜筛选｜无命中引导改条件

## 交互评审

- Q1–Q6：未评（设计阶段；实现前可补交互评审）

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向补偿 |
|---|---|---|---|---|---|
| P1 问数方 | MCP 问数主路径 | 不变 | ＝ | 本条无 MCP／ACL 写变更；SC-16 | — |
| P2 治理方 | 近三千表靠 Catalog／YAML 难见拓扑 | 按岛／团／筛选定位后钻工作台 | ↑ | SC-01–SC-08、SC-13；UAT-SM-01–08 | — |
| P3 运维方 | 部署／健康 | 不变 | ＝ | 无 Helm／探针合同；SC-16 | — |
| P4 管理层 | 不直接操作 | 地图汇总数须标作用域，不得冒充已启用覆盖率 | ＝ | SC-09；文案禁令 | — |

## 第一性原理检查

| # | 问题 | 回答 |
|---|---|---|
| 1 | 问数主路径是否仍可用？ | 是。只读投影，无写、无 MCP 变更 |
| 2 | 拒绝／门禁是否有逃生？ | 读失败／未判定有明示态；钻取回工作台始终可用 |
| 3 | 验收是否覆盖约束＋合法成交？ | 是。假绿（只读 Manifest）负向＋正式 join 并集正向；钻取成交 |
| 4 | 是否避免宿主缺席 BLOCKED？ | 是。WebUI＋demo／scale 夹具即可；规模项用 customer-stability 档 |

## 1. 需求摘要

> 伪代码豁免：本条为只读可视化与边集／解析合同，无算法主流程；渲染与筛选的步骤分解由配对 Plan 承载。

1. **只读语义地图页**：连接 → Schema 岛 → formal-join 连通团／孤立区 → 表侧栏 → 打开工作台／查看合成表 YAML。
2. **边集合同**：Manifest∪overlay formal joins 并集；candidate 不入边；冲突并列标注；共享 overlay 出边归属全部共享节点。
3. **解析合同（G2）**：裸名仅本连接；限定名先本连接后跨连接；多候选＝歧义；物理 `table:` 前缀不改岛；全站索引分类；索引未就绪／陈旧禁用「断引用」字样（G3）。
4. **读面**：按连接 payload＋全站解析索引；展示快照／代次；跳过授权计数；无写 API。
5. **性能**：单连接岛卡 ≤40；岛内表点 ≤150；筛选仍受预算；per-conn payload ≤2MiB；2C／2Gi 下总览可交互 p95≤3s（测法 Plan 冻结）。

## 2. 核心合同（冻结）

### 2.1 Join 边集

- 入边：`source=formal` 或 `manual`（归一 formal）。
- 去重键：`(fromIdentity, toIdentity, on)`。
- 同 `(fromIdentity, toIdentity)` 两层 `on` 不同：并列保留＋侧栏双列＋「Manifest／overlay 来源冲突」（G4：关联边计数按去重键；与运行时按 `to` 去重的依赖数分列说明）。
- 共享 overlay（G5）：共同出边计入各节点连通／孤立；汇总数 Spec 实现按「边去重后计」并与标注一致。

### 2.2 孤立与外部引用（G6）

- 孤立＝formal 无向图入出度皆 0（含共享出边）。
- 仅有跨连接依赖的表可进孤立区，但**必须同屏可见「外部引用 N」**；禁止表述为「无任何依赖」。

### 2.3 断引用／未判定（G2／G3）

- 断引用：全站索引下本连接内无法唯一解析。
- 外部引用：跨连接可解析；不画跨连接边。
- 歧义：单独呈现。
- `payload 代次 > index 代次` 或索引未就绪：一律「外部或断引用·未判定」，禁用「断引用」。

### 2.4 作用域与完成度

- 默认全量 Manifest＋启用标记；可切仅启用。
- 未完成＝`completion != done`；≠「无 overlay 文件」。
- 全量未完成数 ≠ 概览「待补语义」（后者仅 enabled）。

### 2.5 钻取

- 打开工作台：主路径。
- 合成表 YAML：旁注「不含 overlay joins；地图关联数可能更大」。overlay 原文／整份 Manifest＝GAP。

## 3. 验收标准（SC）

| ID | 合同 | 验收要点 |
|---|---|---|
| SC-01 | 岛总览 | 选连接后 Schema 岛卡可见；计数标作用域；单连接岛卡≤40 或超限聚合提示 |
| SC-02 | 连通团 | 进岛见连通团＋孤立区；表点默认不散点铺满 |
| SC-03 | 并集边 | overlay-only formal join（如 demo `superstore_orders`）在地图出现；禁止只读 Manifest 导致 0 边 |
| SC-04 | 冲突标注 | 同 `(from,to)` 两层 `on` 冲突时并列／双列且标来源冲突；不静默丢层 |
| SC-05 | 孤立定义 | 仅被引用、自身未声明 join 的表不算孤立 |
| SC-06 | 断引用／未判定 | 索引未就绪不得出现「断引用」字样；就绪后断引用可筛 |
| SC-07 | 外部引用 | 跨连接可解析引用不画边，角标「外部引用 N」；孤立区若含此类表角标同屏 |
| SC-08 | 钻取 | 侧栏「打开工作台」到达既有表页；合成 YAML 旁注可见 |
| SC-09 | 作用域文案 | 汇总数标作用域；禁止把全量未完成表述为概览待补语义 |
| SC-10 | 降级态 | 失败／陈旧／部分可见五态之一可观察；不得用 0 边冒充真空 |
| SC-11 | 筛选预算 | 筛选命中仍受 ≤150 表点约束或强制团聚合／搜索，禁止静默上千散点 |
| SC-12 | 孤立文案 | UI 不得把孤立表数表述为「无任何依赖」 |
| SC-13 | 只读 | 地图无写盘控件；网络面无语义写 API 由本页触发 |
| SC-14 | 性能目标 | lean 或约定档：连接总览可交互有前台计时；scale／customer-stability 压力项见 UAT 可选／规模用例 |
| SC-15 | 浏览器＋计时 | 凡主张 WebUI PASS 的用例须真实前台浏览器＋计时，与 API 分列 |
| SC-16 | 主路径无损 | 地图功能启停不影响既有 Catalog／工作台／MCP 问数主路径 |

## 4. 非目标

- 画布编辑、KG、与访问关系图合并、未确认 IA 挂菜单、依赖 REQ-0118 入库、自动改 Catalog joinCount。

## 5. 开放与取证

| ID | 项 | 状态 |
|---|---|---|
| G1 | 现网 joins Manifest／overlay／冲突占比抽样 | Spec 前置取证；不挡定稿；挡「已验证」措辞 |
| OQ-8 | 主导航落位 | 须 IA 独立确认 |

## 关联

- 设计 v1.2 · 设计对抗 · Plan · UAT · REQ-0121 · REQ-0116 · scale-baseline §1.2 · semantic-identity.ts
