# 零绑定 MCP 问数隐藏 begin 实施计划

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / **v0.7** / 2026-11-20 |
| 状态 | **v0.7；终稿已确权；T1–T5 已实现并 commit**（vitest 109 PASS；demo 冒烟）。预算／ACL 待商议且本条不改；OQ-3 数值待采样前冻结；测试台 NOT RUN；T6／R 另授；不入新增核心分母；≠ 功能合同收口；≠ 可上线。 |
| 授权边界 | **T1–T5 已授权并已 commit**。**仍禁止未另授**：push；T6 Docker／R／INDEX PASS；改预算开关或 ACL；隐藏 continue；不发布／reindex／重启修绿 |
| 验收 | F＝SC-01–12（T5）；R＝R0＋01–12 须另授 T6；当前测试台 NOT RUN |
| 总账 / 需求 | P1-60／REQ-030-081，P0 主路径修复；沿用 P0-1，不重复核心分母 |
| 配对合同 | [Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md) |
| 评审依据 | [首轮决议](../reviews/2026-11-19-begin-zero-binding-review-decisions.md)、[隐藏决议](../reviews/2026-11-20-begin-hide-decision.md)、[新定位复审](../../inbox/20261120-kimi-begin-hidden-positioning-review.md) |
| 测试台 | [UAT suite](../qa/uat/suites/begin-zero-binding/suite.md)；判定见 [INDEX](../qa/uat/INDEX.md) |
| 复盘 | [漏检与跟进缺口](../lessons/2026-11-19-begin-zero-binding-test-gap.md) |

## 1. 目标与范围

可信 inactive 下隐藏 `lucy_begin_question`，零绑定纯 MCP 以 N（catalog／source→query）为主路径。合法身份的强制调用返回 `begin_not_available`，在生成 ID、业务参数处理、注册表加载和任何状态写入之前结束；后续合法 query 不受阻。

保留现行身份、ACL、字段、行权限、预算和真实强制快照。`lucy_continue_question` 及其指导不受影响。当前没有启用绑定，不在本条建设启用后 B／D、D6 新事务、有效归属表或 C1／C2 begin 崩溃恢复。

v0.7 将 v0.6 中仍残留的未来能力移出出口，统一 Spec、核心伪代码、SC、Plan 和 UAT 为 N＋隐藏面。

## 2. 开工前置

1. **已满足**：终稿确权＋T1–T5 开发授权（委托人 2026-11-20）。编排见 `inbox/20261120-1037-p1-60-multi-agent-dev-pack.md`。
2. 复用现有注册表凭据、当前注册表和 BindingSession 做 inactive／active／unknown 分类，不新增参与 schema、配置开关或第二份计数。
3. 预算／ACL 待商议（OQ-4）不构成修改许可；本条不得关闭预算、改授予表或隐藏 continue。
4. F 在 vitest／真实进程局部夹具完成；R／Docker 全真须另授 T6。
5. 测试范围以 [fixtures M01–M10](../qa/uat/suites/begin-zero-binding/fixtures.md#统一路径与覆盖矩阵)为唯一真源。RC1＝Codex CLI 0.165.0（T6）。
6. OQ-3 数值在性能采样前冻结；未冻不得让 ZB-10 PASS。

## 3. 实施任务（T1–T5 已授权；T6 另授）

| 任务 | 预计文件／影响面 | 小步输出及验证 |
|---|---|---|
| T1 改前证伪与合同测试 | 本条新增功能测试；相关现有 Proxy／publish／预算回归 | 先记录 inactive 曝光、强制 call 和 N 的改前差异；为 D2 副作用 0、continue 不变和后续 query 成交写可证伪断言；静态源码顺序只作定位 |
| T2 现有参与分类适配 | `webui/server/proxy/caliber-binding-registry.ts`、`caliber-binding-session.ts` 及必要只读适配 | 复用现有凭据／bindings／会话状态；覆盖 I0–I4、旧空、无凭据 published／不可读、L0／L1、T0／U0。不新增文件格式、迁移或持久计数 |
| T3 隐藏与无副作用拒绝 | `webui/server/proxy/mcp-proxy.ts` 的 local tools、list／initialize 装配及指导来源 | inactive／unknown 不主动曝光 begin；inactive 合法强制 call 在任何 ID／状态／注册表副作用前返回 begin_not_available；active 保持现有路径。**不得原样使用联合隐藏 begin／continue 的 `LUCY_ENABLE_QUESTION_TOOL=false`** |
| T4 预算、权限与审计保持 | 现有预算／ACL／turn correlation／审计模块，仅作必要适配 | N／重连／D2 不切换预算；continue 与续查指导不变；Token／Agent／global deny 和行隔离保持；无 begin 时显式覆盖为 0，推断／缺失与调用审计诚实 |
| T5 F 回归 | 现有 `caliber-binding*.test.ts`、`api.semantic-assets.publish.test.ts`、预算／ACL／read_source／explain 回归及本条新用例 | SC-01–12；真实协议、文件／会话状态、发布交错、实际调用计数和局部进程恢复；先红再实现，不用 mock 响应冒充真实持久化 |
| T6 R 组合 UAT | [suite](../qa/uat/suites/begin-zero-binding/suite.md)、[cases](../qa/uat/suites/begin-zero-binding/cases.md)、[fixtures](../qa/uat/suites/begin-zero-binding/fixtures.md)及未来 runner | R0＋01–12 全部必做；M01–M10 同范围改前／候选；真实普通发布、正式 A0／T0 控制、RC1 最终答案；判定进入 runs／INDEX |

T2 不实施 v0.5 的 v2 凭据格式；T3 不实施 `question_scope_attribution`／`question_begin_commit`；本条没有 G1／G2／G5 或 C1／C2 begin 写入故障任务。未来露出 begin 时另立合同处理预算轮次、有效归属和工具列表刷新。

## 4. 功能与组合验收分层

- **F**：SC-01–12；真实协议、现有文件／会话状态、确定性发布交错、局部进程恢复和内部调用计数。上游计数替身不冒充真实查数 UAT。
- **R**：Docker 真实数据库、普通 Token、真实普通发布、系统重启和 RC1，按 M01–M10 执行；全部只验当前 N＋隐藏面及安全／预算回归。
- 细粒度参数、read_source／explain 和持久化边界优先放 F；R 保留代表组合。F 收口、R 判定与可上线分别登记。

## 5. 验收步骤与关键判据

1. R0 固定改前／候选 SHA、镜像／资源／内容／身份、预算 round／window、数据 oracle、RC1 版本摘要和真实入口；参与证据只读现有凭据／注册表／BindingSession。
2. M01／M02 在 I0–I4 和普通内容发布前／中／后验 list／指导无 begin、N 成交、强制 call 的 D2 及副作用 0；不补注册表、reindex 或重启修绿。
3. M03／M04 在预耗预算后执行 N、重连、重复强制 call；round／window／额度／续查不清零，query 正常消费。continue 可见且指导不变；G3 基线预算不可用保留真实拒绝。
4. M05 用正式 YAML＋HTTP reindex 建立 A0 并撤销到 T0，验 active 允许／偏离、旧 committed 快照和撤销后 N＋隐藏；不使用未来 B／D 改造凑证据。
5. M06 复算显式／推断／缺失和事实成败，完成运维定位恢复与管理判断任务；显式 begin 覆盖为 0 必须诚实披露。
6. M07 验无凭据 published／不可读候选、U0／L1 不当零，D2 后 query／read_source／explain 的适用权限不变。
7. M09 真实重启后核对 I0–I4／L0／L1／T0／U0 分类和 N 成交；本条无 C1／C2 begin 写入恢复。
8. M10 让未修改 RC1 默认 N 成交、list 无 begin；幻觉 call 得 D2 后不反复重试并完成正确答案。
9. M08 仅对 N 做每组每轮 100 问×三轮，逐轮 nearest-rank p95；硬判据 N 的 begin 调用数 0，D2 注册表加载／提交数 0。预期 D2 不计入 N 的增量拒绝。

## 6. 文档与测试检查入口

未来授权后在 `webui/` 运行相关现有 vitest：`server/__tests__/caliber-binding.test.ts`、`caliber-binding-proxy.test.ts`、`api.semantic-assets.publish.test.ts`；新增 SC 自动化及预算／ACL／source-ambiguity／read_source／explain 回归按实际变更面登记，不虚构当前已有覆盖。

本轮只运行 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、e2e-ledger 指针检查及定向链接／现值／编号／矩阵检查。旧 e2e 检查器有硬编码套件清单，不能冒充新增 suite 已覆盖。不新增命令、CI job 或 runner。

## 浏览器验证

不适用：不改变用户可见 WebUI 表面，属于 MCP／HTTP 服务行为；本轮不做浏览器或移动窄屏测试。未来 RC1 组合验证是真实 Agent 轨迹，不是浏览器测试。

## 7. 漏检整改与评审纪律

真实调用分别保存 begin／强制 call 与 query 响应，不用 query 成功倒推隐藏或拒绝正确。正式证据不得只放可删除 inbox。跨业务 UAT 发现系统性 begin 阻断时独立登记 P0，不只留在其他套件 BLOCKED。

本条不得为了保留显式原文指标恢复每题 begin，也不得通过关闭预算、隐藏 continue 或修改 ACL 获得绿灯。

## 8. 完成定义

确权及授权之后：SC-01–12 有匹配证据，R0＋01–12 与 M01–M10 全部达到期望；inactive 下 list／指导隐藏 begin，N 成交，强制 call 无副作用且不挡 query；普通用户无需管理员补注册表／reindex／删凭据／重启／WebUI 确认；continue、预算、权限、行隔离和真实强制快照保持；RC1 完成真实答案；P3／P4 补偿任务实际完成。

功能合同收口不表示 R 已执行或可上线；历史 P0-1／行权限结果不改写。

## 9. 风险与未决项

- 无凭据的 published／不可读候选和既有强制快照不得误分类为 inactive；unknown fail-hidden 但强制 call 走真实治理拒绝。
- 现有联合开关会误伤 continue，必须分离可见性；静态配置也不能冒充参与态分类。
- active 缓存刷新不在本条承诺；未来露出时另补通知／重列合同。
- P3／P4 补偿尚无运行证据；未证成的下降保持。
- OQ-4 预算／ACL 待商议，本条仅保持现状；OQ-3 数值未冻结不得让 ZB-10 PASS。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 无新增产品名；协议字段与 N／M01–M10／RC1 仅为合同／测试标识，无 UI／DOM 变更。

## 10. 本轮文档交付检查

- [x] Spec／Plan v0.7-draft：D1／D2、核心伪代码、SC、任务和验收全部收缩为 N＋隐藏面；OQ-2 未来事务移出本条。
- [x] UAT v0.5-draft：13 项全部必做；M01–M10 不含隐藏期 B／D、G1／G2／G5 或 C1／C2。
- [x] 2026-11-20 已同步 Spec／Plan 头部、两份索引、总账／需求池／概览现值及测试台／GAP；`lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、e2e-ledger 均通过。定向检查覆盖 5 份主文档本地链接与空白、5 处现值镜像、13 个必做用例、10 行矩阵及隐藏／continue 标记；`git diff --check` 通过。既有 metadata 基线与 paired_quiz／demo_readonly 提示保留，不代表 F／R 已执行。
