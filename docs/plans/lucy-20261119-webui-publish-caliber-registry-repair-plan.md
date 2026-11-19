# 零绑定 MCP 问数不受 begin 影响实施计划

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.5-draft / 2026-11-20 |
| 状态 | v0.5-draft。复审闭合 OQ-1／OQ-2 文档方案；OQ-3 数值容差待采样前冻结；终稿未确权；开发未授权；测试台 NOT RUN；不入新增核心分母；≠ 可上线。 |
| 授权边界 | 本轮仅复审并闭合 Spec／Plan／UAT 的参与载体、原子事务与恢复合同，同步台账；不含运行代码、配置、测试执行器开发或 F／R 执行；不发布、不 reindex、不重启、不构建 |
| 验收 | 本轮仅文档检查；未来 F 对应 SC-01–12，R 为 R0＋01–12 全部必做，当前均 NOT RUN |
| 总账 / 需求 | P1-60／REQ-030-081，P0 主路径修复；沿用 P0-1，不重复核心分母 |
| 配对合同 | [Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md) |
| 评审依据 | [评审决议](../reviews/2026-11-19-begin-zero-binding-review-decisions.md)，F-01–07 落点见 Spec §9 |
| 测试台 | [UAT suite](../qa/uat/suites/begin-zero-binding/suite.md)；判定见 [INDEX](../qa/uat/INDEX.md) |
| 复盘 | [漏检与跟进缺口](../lessons/2026-11-19-begin-zero-binding-test-gap.md) |

## 1. 目标与修订取舍

零绑定纯 MCP 的 N（不 begin）、B（正常 begin）、D（可选上报降级）均不新增绑定门禁、人工确认或数据查询障碍。保留既有身份／ACL／字段／行权限／预算安全边界及真实强制快照。先恢复此主路径，再另段处理完整有绑定普通发布一致性。

使用 brainstorming／writing-plans 的需求、失败模式和任务拆分方法；本仓库配对文件名／元数据／授权规则优先。本轮按用户明确决议直接修订文档，不开启开发、工作树或提交流水线。

v0.4 修正：保留冻结预算 D6，不再笼统要求重复 begin 不清零；G1 未记录与 G2／G5 已记录但未生效分别返回；补四画像及真实任务补偿；固定 RC1 既有客户端；Plan／cases 统一引用 fixtures 覆盖矩阵；首次启用／撤销使用明确正式控制入口。

v0.5 复审闭合：参与事实复用 committed `active-generation.json`，参与代次等于 registry generation；有效归属使用审计 SQLite 耐久指针，记录阶段与有效事务分离，预算／指针／turn active／握手关联／提交回执同一物理事务；补提交结果不确定读回及 C1／C2 崩溃恢复。方案闭合不冒充实现可行性与兼容已验证。

## 2. 开工前置

1. Spec 复审并按仓库规则终稿确权，再取得独立开发授权。OQ-1 可信参与载体／代次／legacy 格式和 OQ-2 预算＋有效归属事务已在 Spec §3.1／§3.4 闭合为文档合同；实施须严格按该载体与故障边界取证，文档闭合不当作实现或恢复已验证。
2. 冲突清单必须含 P0-1 D11／O1、Spec 173／162，以及 [冻结预算优化 Spec D6／§6.1／§6.5](../specs/lucy-20261029-question-budget-window-optimization-spec.md)。本稿保留新问询轮次切换；父合同正文及历史结论本轮不改。
3. 测试范围以 [fixtures 统一路径与覆盖矩阵 M01–M10](../qa/uat/suites/begin-zero-binding/fixtures.md#统一路径与覆盖矩阵)为唯一真源；N／B／D 不再多处各写不同全排列。每例独立故障前置与清理。
4. 在隔离 Docker 单实例单副本实施和验证，真实 KTX／数据库、普通 MCP Token，无 WebUI 宿主身份。候选 RC1＝既有 Codex CLI 0.165.0，版本及文件指纹已只读核对，实际 MCP／模型条件执行前核验；不声称本轮通过兼容。
5. OQ-3 的采样方法已写入 fixtures；实际基线、A_ms／R 双容差、资源指纹和随机顺序必须性能采样前冻结，不要求开发前已有候选实测结果。

## 3. 实施任务（未来授权后）

| 任务 | 预计文件／影响面 | 小步输出及验证 |
|---|---|---|
| T1 合同与改前证伪 | 配对 Spec、P0-1／162／173／冻结预算优化合同的差异清单；新增本条功能测试 | 先为 N／B／D 及 G1–G6 写可证伪断言，执行改前记录；按已闭合 OQ-1／02 固定载体和事务断言；不把静态源码序锁当生产接线证据 |
| T2 可信参与与迁移 | `webui/server/proxy/caliber-binding-registry.ts`、`caliber-binding-session.ts`、现有发布协调／启动恢复模块 | `active-generation.json` 升 v2，generation 即参与代次，写 participation／publishedBindingCount；按 Spec 表兼容无凭据／旧空／异常。I0–I4／L0／L1 分类读回；首次启用和最后撤销与正式提交同窗；最多 2 次路由，不制造用户开关 |
| T3 可选上报及原子有效归属 | `webui/server/proxy/mcp-proxy.ts`、`question-experience.ts`、`audit.ts`、`turn-correlation.ts`、现有 BindingSession 适配 | inactive 不进强制准备／提交；记录前先查 operation 回执，无回执才幂等持久 record_only，再以同一审计 SQLite 事务写预算、`question_scope_attribution`、turn active、握手／mutation 与 `question_begin_commit`。G1／G2／G5 分别注入并读回；提交不确定先查回执；内存只作缓存，optional 恢复不作 query 门禁 |
| T4 本地授权与指导 | `webui/server/proxy/acl.ts`、工具描述、initialize 装配及其指导来源 | begin 只依赖本地可信 Token／工具授权，不编译无关全库；query／read_source／explain 保持适用权限。N 默认无额外工具；disabled／global deny 单测与实际负控 |
| T5 响应及审计补偿 | MCP 结果与现有审计／健康记录模块 | 真实 recorded／questionState／budgetStatus；G4 普通日志故障不新增全局拒绝。补运维定位恢复和管理独立复算任务，未证成的画像下降不取消 |
| T6 F 回归 | 现有 `caliber-binding*.test.ts`、`api.semantic-assets.publish.test.ts`、预算／ACL／其他工具回归及本条实存储用例 | SC-01–12；全部故障格、有效事务逐语句回滚、提交不确定读回、C1 仅 record_only 崩溃／C2 已提交未响应崩溃、缓存重建、合法第二问题及解除后成交。先红再实现最小改动，再跑相关绿；不顺带新增客户端幂等协议 |
| T7 R 组合 UAT | [suite](../qa/uat/suites/begin-zero-binding/suite.md)、[cases](../qa/uat/suites/begin-zero-binding/cases.md)、[fixtures](../qa/uat/suites/begin-zero-binding/fixtures.md)及未来 runner | R0＋01–12 全部必做，M01–M10 同范围改前／候选；普通 HTTP 发布与 YAML→HTTP reindex 控制明确区分；RC1 未修改真实 Agent 轨迹与 PC1 模块消费者分开；判定进入 runs／INDEX |

T2／T3 的 additive schema 与迁移载体已在合同层冻结，但本轮不预授权实施；未来触及指导配置也须在开发授权范围内。T6 不要求复制所有父合同测试，但 G6 inactive 零提交、有绑定允许／偏离及未知不当空是本条必验。

## 4. 功能与组合验收分层

- **F（功能合同）**：SC-01–12；真实协议／局部文件和数据库持久化／确定性交错／内部调用计数，覆盖全部 G1–G6。模块上游计数替身不当真实查数 UAT。
- **R（组合 UAT）**：Docker 真实数据库与普通 Token、真实普通发布、完整 N／B／D、系统重启及 RC1 最终答案，按 fixtures M01–M10 执行；不以 F 绿替代。
- 细粒度字段、参数、read_source／explain 和故障提交边界优先放 F；R 保留代表性跨模块旅程。模块出口不倒挂整库系统演练；R 未跑不能宣称用户已恢复。

## 5. 验收步骤与关键判据

1. R0 固定改前／候选 SHA、镜像／资源／内容／身份、预算 round／window、数据 oracle、RC1 版本摘要及真实入口；参与证据记录凭据 phase／generation／participation／publishedBindingCount，操作证据记录 operationId／提交回执／有效指针。
2. 按 M01／M02 做 I0–I4 的 N／B／D(G1) 和普通内容发布生命周期，每格独立清故障；不补注册表、reindex 或重启修绿。inactive 普通发布不得推进参与代次。
3. M03 的 G1／G2／G5 逐一实际持久化失败，并在 F 对有效事务逐语句打断。已保存 turn 不写 recorded=false；未成功物理事务不得发布新轮次或有效归属；提交结果不确定先按 operationId 读回执；后续合法查询正常消费原预算并成交。
4. M04 区分不 begin／降级／重连、真正第二问题、外部独立再次调用、同一服务端操作内部恢复重放。G3 预算整体故障保留基线安全拒绝，恢复后成交；逐一验证 Token／Agent／全局工具拒绝及 A／B 行隔离。
5. M05 使用 YAML 作者内容＋`POST /api/semantic-assets/reindex` 正式入口，验证首次启用／最后撤销代次，旧 committed 快照允许／偏离与新问询零状态；不依赖另段普通绑定发布修复。
6. M06 验 G4 与覆盖分母，再让运维用现有只读事实实际定位恢复、管理层复算成功／失败及显式／推断／缺失。仅披露不当补偿已证成；失败保留下降并回合同。
7. M07／M09 补无效参数拒绝后合法成交、U0／L1 不清、L0 可恢复、T0 重启后的新旧会话；C1 仅 record_only 崩溃后旧预算／归属不变，C2 回执已提交但未响应崩溃后同一操作至多生效一次且缓存重建不阻断 query。细粒度其他工具负控对应 F。
8. M10 让 RC1 未修改客户端分别处理 B、G1 null、G2／G5 record_only 并最终回答真实事实。PC1 脚本不能补绿；版本缺失 BLOCKED、真实产品不兼容 FAIL。
9. M08 按固定方法每组每轮 100 问×三轮，各轮单算 p95，失败不删分母、容差不后调。硬判据 N 默认额外工具 0、begin 增量拒绝 0、inactive 全量绑定构建 0。

详细逐例步骤及清理责任见 cases；本表不再另立不同的组合矩阵。

## 6. 文档与测试检查入口

未来授权后在 `webui/` 跑对应 vitest 文件：`server/__tests__/caliber-binding.test.ts`、`caliber-binding-proxy.test.ts`、`api.semantic-assets.publish.test.ts`；新 SC 自动化及预算／ACL／source-ambiguity／read_source／explain 回归按实际变更面登记，不虚构当前已有完整本条测试。

本轮仅运行文档 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、e2e-ledger 指针检查，及链接／现值／编号／矩阵映射自查。旧 e2e 检查器有硬编码 suite 清单，不能用其通过冒充新增套件已覆盖；额外定向核对。不新增命令、CI job 或 runner。

## 浏览器验证

不适用：不改变用户可见 WebUI 表面，属于 MCP／HTTP 服务行为；本轮不做浏览器或移动窄屏测试。未来 RC1 组合验证是真实 Agent 轨迹，不是浏览器测试。

## 7. 漏检整改与评审处置

F-01–07 修订落点见 Spec §9 和评审决议，文档回应不自称复审通过。真实调用各自保存响应，不由 query 成功倒推 begin 成功；正式证据不能只放可删除 inbox。跨业务 UAT 发现系统性 begin 阻断时，独立 P0 跟进，不只留在业务前置 BLOCKED。

## 8. 完成定义

Spec 确权及授权之后：SC-01–12 有匹配证据，所有 R 必做及矩阵组合达到期望；普通用户无需人工补注册表／reindex／删凭据／重启／WebUI 确认；RC1 仍调 begin 也能完成答案；权限和预算保持；P3／P4 补偿任务实际完成，未补偿损失如实回到治理裁决。

F 收口、R 判定、可上线各自登记。历史 P0-1、行权限 UAT 不改成新结果。状态镜像同次对齐。

## 9. 风险与未决项

- OQ-1／02 的文档载体与事务方案已闭合，但实现尚未存在；若真实事务、恢复或兼容证据证伪方案，须回合同设计，不能靠错误响应隐藏部分写入。
- 参与代次必须复用注册表 committed generation，不能变成另一份脱离发布的配置；无凭据的可信零兼容也不能把读取损坏或已有强制快照当成 inactive。
- RC1 仅版本／摘要只读核实，模型／MCP 启动及降级兼容未证成；不扩大到所有历史客户端。
- P3／P4 显式覆盖下降有候选补偿，尚无运行证据；本稿不接受无补偿损失，也不恢复每题强制 begin。
- G4 不扩大成新增全局审计门禁，G3 等既有安全拒绝不被降级吞掉。性能数值执行前冻结，实际结果不能反向改变验收。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 无新增产品名；协议增量字段以配对 Spec 为准，N／B／D、G1–G6、M01–M10、RC1／PC1 仅为合同／测试标识，无 UI／DOM 变更。

## 10. 本轮文档交付检查

- [x] Spec／Plan v0.5-draft；F-01–07 对照、OQ-1／02 载体与事务、核心流程、故障格、四画像、兼容范围、授权与闭口层级齐备；OQ-3 数值仍待采样前冻结。
- [x] UAT v0.3-draft，13 项全部必做；fixtures 单一矩阵，cases 映射、C1／C2 与每例清理齐备，无新增跑次。
- [x] 2026-11-20 同步 Spec／Plan 头部、两份索引、总账／需求池／概览现值及测试台／GAP；`lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、e2e-ledger 均通过。定向检查通过：5 份主文档本地链接与空白、5 处现值镜像、13 个必做用例、10 行矩阵、OQ-1／02 闭合标记及 C1／C2 证据槽。既有 metadata 基线清理、paired_quiz／demo_readonly 迁移提示仍在，不作为本修复证据；本项不代表 F／R 已执行。
