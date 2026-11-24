# 零绑定 MCP 问数隐藏 begin 实施计划

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / **v0.9** / 2026-11-20 |
| 状态 | S5｜v0.9；功能合同已收口（SC-01–12通过，P1-60／P1-64同一冻结候选完整复验）；预算持久化锁竞争修复纳入；本轮增量已提交；未推送／发布；不入新增核心分母；本条收口不表示可上线。 |
| 授权边界 | 委托人 2026-11-20 明示授权修复最终评审 R-01–04、完整 UAT、制品取证、台账同步、Docker 重建与交付复审；不推送、不发布；不混入其他任务。 |
| 验收 | F＝SC-01–12（T5）；R＝R0＋01–12 已获 T6 执行授权；以测试台实际跑次判定 |
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
4. F 在 vitest／真实进程局部夹具完成；R／Docker 全真已由委托人 2026-11-20 授权 T6。
5. 测试范围以 [fixtures M01–M10](../qa/uat/suites/begin-zero-binding/fixtures.md#统一路径与覆盖矩阵)为唯一真源。RC1＝Codex CLI 0.165.0（T6）。
6. OQ-3 数值在性能采样前冻结；未冻不得让 ZB-10 PASS。

## 3. 实施任务（T1–T6 均已授权；不推送、不发布）

| 任务 | 预计文件／影响面 | 小步输出及验证 |
|---|---|---|
| T1 改前证伪与合同测试 | 本条新增功能测试；相关现有 Proxy／publish／预算回归 | 先记录 inactive 曝光、强制 call 和 N 的改前差异；为 D2 副作用 0、continue 不变和后续 query 成交写可证伪断言；静态源码顺序只作定位 |
| T2 现有参与分类适配 | `webui/server/proxy/caliber-binding-registry.ts`、`caliber-binding-session.ts` 及必要只读适配 | 复用现有凭据／bindings／会话状态；覆盖 I0–I4、旧空、无凭据 published／不可读、L0／L1、T0／U0。不新增文件格式、迁移或持久计数 |
| T3 隐藏与无副作用拒绝 | `webui/server/proxy/mcp-proxy.ts` 的 local tools、list／initialize 装配及指导来源 | inactive／unknown 不主动曝光 begin；inactive 合法强制 call 在任何 ID／状态／注册表副作用前返回 begin_not_available；active 保持现有路径。**不得原样使用联合隐藏 begin／continue 的 `LUCY_ENABLE_QUESTION_TOOL=false`** |
| T4 预算、权限与审计保持 | 现有预算／ACL／turn correlation／审计模块，仅作必要适配 | N／重连／D2 不切换预算；continue 与续查指导不变；Token／Agent／global deny 和行隔离保持；无 begin 时显式覆盖为 0，推断／缺失与调用审计诚实 |
| T5 F 回归 | 现有 `caliber-binding*.test.ts`、`api.semantic-assets.publish.test.ts`、预算／ACL／read_source／explain 回归及本条新用例 | SC-01–12；真实协议、文件／会话状态、发布交错、实际调用计数和局部进程恢复；先红再实现，不用 mock 响应冒充真实持久化 |
| T6 R 组合 UAT | [suite](../qa/uat/suites/begin-zero-binding/suite.md)、[cases](../qa/uat/suites/begin-zero-binding/cases.md)、[fixtures](../qa/uat/suites/begin-zero-binding/fixtures.md)及实际 runner | R0＋01–12 全部必做；M01–M10 同范围改前／候选；真实普通发布、正式 A0／T0 控制、RC1 最终答案；判定进入 runs／INDEX |

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

本次授权后在 `webui/` 已运行相关现有 vitest：`server/__tests__/caliber-binding.test.ts`、`caliber-binding-proxy.test.ts`、`api.semantic-assets.publish.test.ts`；新增 SC 自动化及预算／ACL／source-ambiguity／read_source／explain 回归按实际变更面登记，不虚构当前已有覆盖。

原文档阶段仅运行 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、e2e-ledger 指针检查及定向链接／现值／编号／矩阵检查。旧 e2e 检查器有硬编码套件清单，不能冒充新增 suite 已覆盖。本次执行授权新增隔离 runner `scripts/uat/verify-begin-zero-binding.py`，真实 Docker/MySQL/MCP；不新增 CI job。

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
- P3／P4补偿已通过ZB-08真实只读审计HTTP任务；原文覆盖仍为0，下降不抹平。
- 本次不改预算／ACL；OQ-3数值采样前冻结且未放宽；ZB-10已有实际预算拒绝，保留FAIL。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 无新增产品名；协议字段与 N／M01–M10／RC1 仅为合同／测试标识，无 UI／DOM 变更。

## 10. v0.7文档阶段检查留痕（历史）

- [x] Spec／Plan v0.7-draft：D1／D2、核心伪代码、SC、任务和验收全部收缩为 N＋隐藏面；OQ-2 未来事务移出本条。
- [x] UAT v0.5-draft：13 项全部必做；M01–M10 不含隐藏期 B／D、G1／G2／G5 或 C1／C2。
- [x] 2026-11-20 已同步 Spec／Plan 头部、两份索引、总账／需求池／概览现值及测试台／GAP；`lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、e2e-ledger 均通过。定向检查覆盖 5 份主文档本地链接与空白、5 处现值镜像、13 个必做用例、10 行矩阵及隐藏／continue 标记；`git diff --check` 通过。既有 metadata 基线与 paired_quiz／demo_readonly 提示保留，不代表 F／R 已执行。

## 11. 最终评审整改执行

R-01–04 对应 Spec v0.8 修订；隔离工作区实现提交 8411138d＋3b69470e，主分支等价提交 f61b7ddc＋90219073（Git tree 相同）。新增预算重启测试的 active 注册表前置条件，保留原轮次／归属断言。完整 R 与镜像摘要另入正式跑次；旧失败记录保留。

性能在采样前冻结 A_ms＝250ms、R＝50%、2 CPU／2 GiB、随机种子60120、每轮每组10问预热＋100问采样，共三轮。source map 作者编译与 serving ACL 失效分别构造，后者保留原有授权拒绝优先级。

## 并行合并候选任务记录（非本次77e2ad84出口）

本次委托人另明确只完成原四项、预算另行处理；以下另一任务记录保留，不覆盖本次制品边界。

委托人明确要求继续P1-60剩余问题、必要回归、完整Docker UAT，并将P1-60与P1-64合入同一候选，核对类型及浏览器计时，台账同步后整包终审。本轮不提交／推送／发布；已有f61b7ddc／90219073修复先复核，不重复覆盖他人提交。

1. 核对R-01–04实现、反例及runner与M01–M10矩阵差集，补完整控制和拒绝／恢复证据。
2. 从P1-64已过SC-09候选派生，合入已审P1-60运行代码和测试；固定摘要、来源、锁文件和源码hash；容器与宿主全库typecheck及受影响回归通过。
3. 同摘要完整执行两套Docker UAT；P1-60包括三轮N性能、真实RC1、所有状态与恢复；P1-64包括真实前台Chrome六反馈场景和计时。禁止partial selector或历史证据拼成完整PASS。
4. 原始失败保留；合法用户主路径与安全拒绝同时证明；同步三台账和所有现值镜像，再最终评审。

浏览器验证：本条无新UI；合并候选的P1-64沿用1440×1000 headed Chrome，visible／focus与视口内断言，导航／提交反馈／API耗时分列并存图。

完整 R 可按独立夹具分组执行：同一冻结镜像的 early（R0／01–05）与 late（R0／01／02／06–12）逐例合并登记，原始跑次各自保持 PARTIAL；只有13个必做 ID 在同一制品／合同下均取得实际结果后，测试台才作整套判定，失败不能从分母删除。性能必须使用双方全新 I0／Docker 原生数据卷，不能复用故障注入卷；容差不变。

### 并行合并候选的预算修复记录（本次排除）

独立无mock诊断在未改预算／ACL的P1-64旧候选上实际捕获SQLITE_BUSY；原改前镜像亦有同类N失败。归属本轮SC-05／10主路径验收：补真实双连接并发回归，最小调整预算保存事务的取写锁时机，不改额度、轮次、幂等键、故障拒绝或ACL。原失败跑次保留。若基线同样不可采样，必须先说明基线功能失败并前瞻冻结对照，禁止删失败样本修绿。

## 12. 本次原四项执行结果

最终运行提交77e2ad84；245项相关回归通过；镜像a794f7e0…为本机arm64增量重建，audit.ts实际hash与c1cd基线相同，预算WIP未纳入。完整13项R已执行，12 PASS／ZB-10 FAIL；RC1实际返回4／100且未调begin。原四项关闭不等于完整合同收口，见[最终跑次](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-77e2ad84-r.md)与[整改复审](../reviews/2026-11-20-begin-zero-binding-repair-delivery-review.md)。

### 合并候选补录（2026-11-20，完整 R 发现）

v3 在 R11 L0 重启后查询 FAIL：运行日志证明首层口径门禁 inactive 放行，但候选遗漏提交 `77e2ad84` 的表级歧义门禁适配。保留失败跑次；v4 仅叠入该提交的两份文件（运行代码及完整 HTTP 链路回归），重建 dirty 身份，按镜像源码清单核验后重跑两套完整 UAT，不拼接旧跑次为 PASS。

合并候选源码差集再核对：v4继承旧镜像的6份Wiki源码／测试落后于已提交77e2ad84基线（1604d931既有修复），不应随更新带回旧行为。v5仅将这6份文件对齐已提交基线；相关Wiki回归加入固定检出验证，重新执行两套完整UAT。v4短名PASS和中断的P1-60跑次保留，不拼接。

## 13. 本轮合并候选完整验收与终审

后续委托人授权的合并任务已完成：77e2ad84四项与P1-64／49条类型修复、SC-05／10预算持久化写锁修正同入30ec4ae0冻结候选。两套完整R各13项、三轮600正式问题及60预热零失败、真实RC1仅MCP返回4／100；782项Vitest与29项概念模块通过；容器及固定检出类型0错误。旧独立四项出口和预算另处置的裁决仅适用其历史镜像，不覆盖本次后续合并授权。

浏览器验证：同镜像前台Chrome六组导航关键内容82–840ms、提交反馈1557–2464ms，API独立分列，visible／focus和视口断言通过。见[完整R](../qa/uat/suites/begin-zero-binding/runs/2026-11-20-codex-combined-final.md)与[短名及浏览器](../qa/uat/suites/source-shortname-conflict/runs/2026-11-20-codex-combined-final.md)。三台账先同步待终审后，Codex批准P1-60／P1-64功能收口；整包因P1-58／59必做验收与P1-61／63修复版本差集未放行，见[最终评审](../reviews/2026-11-20-p160-p164-combined-final-review.md)。

## 本进程提交授权（2026-11-20）

委托人明确要求“commit 本进程”。本次只提交本进程的短名／类型／预算持久化修复、回归及Docker／浏览器证据和P1-60／P1-64台账；共享文件按变更片段拆分，其他任务的运行代码与状态不纳入。未推送、未发布；整包不放行结论保持。
