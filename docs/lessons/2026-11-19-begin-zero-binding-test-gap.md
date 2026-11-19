# 错题：begin 主路径错误曾被记录，但零绑定生命周期与普通发布接线没有被测试兜住

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-19 |
| 标签 | `gate-gap` `contract-stack` `ux-regression` `sev-high` |
| 环境 | 历史本机 demo UAT：11-14 `9d59337d`、11-15 `d64414d6`；11-19 线上审计与当前源码核对为 `6208ea57` |
| 状态 | open；漏检／跟进原因已核实，零绑定修复未实施，线上每次 unresolved 的内部原因仍未知 |
| 总账 / 需求 | P1-60／REQ-030-081；登记不构成开发授权 |
| 相关 | [修复 Spec](../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md)；[Plan](../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md)；[新增 UAT](../qa/uat/suites/begin-zero-binding/suite.md) |

## 1. 症状与影响

零绑定的普通 MCP 问数用户调用可选 `lucy_begin_question` 后被 `caliber_binding_unresolved` 阻断。11 月 19 日只读审计发现 225 次 begin 全 denied，其中 213 次 unresolved、11 次来源重名、1 次指定绑定不可见。来源重名有独立资产证据；不能据此解释全部 213 次注册表错误。

用户不认可“先把所有零绑定注册表事务修齐”的方案，要求零绑定不能因 begin 降低问答体验。begin 把可选上报、预算轮次及绑定激活耦合成同一强依赖链，违背“未命中不改变查数”“漏调不影响查数”的用户承诺。

## 2. 证据时间线与为何未拦住

| 时间 / 证据 | 实际验证或发现 | 漏检／汇报边界 |
|---|---|---|
| 11-13 [P0-1 证据审计](../reviews/2026-11-13-question-type-caliber-binding-sc-evidence-audit.md) | 报告两个测试文件、80 passed、SC-01–30 CLOSED | SC-22 采用注册表组件提交与 `index.ts` 源码序锁；没有证明普通 WebUI 发布接口结束后实际 MCP begin 可用 |
| 当前 `caliber-binding.test.ts` | `publishBindings()` 直接 load candidate＋commit；混合批次同样直接调用 commit；“生产装配序”读取 index.ts marker 后子串顺序 | 测试自己补齐生产普通发布缺少的接线，静态证据只覆盖手动 reindex。只能证明被调用的组件，不证明每个成功入口确实调用 |
| 当前 `api.semantic-assets.publish.test.ts` 首个成功例 | mock validate／reindex，等待 release.status=published 并检查 reindex.ok | 没有接着用普通 Token 调 begin／查数／核对注册表；发布元数据成功不代表下游可用 |
| 11-14 [CALIBER 跑次](../qa/uat/suites/question-type-caliber-binding/runs/2026-11-14-claude-macmini-p0-post-upgrade.md) | 无 caliber-bindings 目录的单一环境，query 返回 1000，绑定披露 none | 没覆盖首次提交创建内部目录、空凭据、普通发布／Manifest 变化后再 begin、可选记录失败等生命周期；没有未 begin 对照 |
| 同一 11-14 跑次 | 文档步骤包含 begin，但响应／判据主要展示 query；CALIBER-02 延期 | 不能用 query 成功倒推 begin 成功。所指 inbox JSON 当前不在仓库，无法再确认 begin 当时原响应。不能断言当次 begin 一定失败或成功 |
| 旧 [cases](../qa/uat/suites/question-type-caliber-binding/cases.md)／[suite](../qa/uat/suites/question-type-caliber-binding/suite.md) | 有绑定激活／偏离属于 Wave B，可选范围；“已提交注册表”设为前置 | 降低发布接线覆盖；前置若由产品自身失败导致，可能被归 BLOCKED，而不是作为被测产品 FAIL 独立跟进。不能据此声称 Wave B 当时实际跑过并发现同因 |
| 11-15 [行权限 retest](../qa/uat/suites/row-policy-finance-scenario/runs/2026-11-15-cursor-row-policy-retest.md) | ROW-02 明确记载同会话 begin 曾返回 unresolved，ROW-02／03／05 BLOCKED；总判定 FAIL | **并非此前从未发现。** INDEX／e2e-ledger 已记录，但附着在行权限 GAP 下；未形成独立的零绑定 begin P0 用例与修复跟进项。仓库不能证明当时是否另有口头／IM 通知 |
| 11-19 本次复核 | 普通发布未提交注册表；缺失目录的 sha256("[]")／空版本与空目录 sha256("")／实际版本不同 | 是已确认实现缺口；尚未全真复现其对该线上每次拒绝的因果，不能把源码推理写成 UAT PASS 或事故根因唯一确定 |

## 3. 根因分层

- **测试覆盖**：组件级手动提交与单一零绑定快照，替代了生产普通发布接线和状态转换验证；缺少“可选上报失败后合法查询仍可用”的反例。
- **断言与前置**：没有把 begin 与 query 各自判定；将注册表已提交当成测试前置，避开了应被检验的链路；Wave B 可选化令“约束生效＋合法激活”没有同时成为必做。
- **跟进与叙事**：系统性 begin 错误确实落在其他套件 FAIL／BLOCKED 里，但没有提升成独立主路径问题。功能合同 CLOSED、局部 UAT PASS WITH GAP 与真实用户可用不是同一个结论。
- **产品边界**：把问询可选上报与实际绑定治理故障捆绑，零绑定用户也承担注册表状态、全库依赖与持久化失败的体验成本。

## 4. 举一反三

1. 任一“可选”能力必须有不调用／正常调用／该能力自身失败的对照，且后两条验证原主任务仍可成交。
2. 发布成功入口逐一核对实际消费者与后续合法调用；只直接调被测 helper 或读源码顺序不能证明生产接线。
3. 主路径故障在其他业务 UAT 出现时独立登记影响面，不以“该场景前置 BLOCKED”结束跟进。产品错误与环境缺失分开判定。
4. 状态转换至少覆盖从未配置→首次发布→内部目录创建→再次问询，以及撤销最后配置→新问询／旧旅程。
5. 每个关键工具原响应与断言独立保存；正式结论不能只依赖可删除 inbox，更不能用下游成功推导上游成功。

## 5. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| P1-60／REQ-030-081 独立登记 | 已登记 | 本次 Spec／Plan／测试台指针齐备，不代表已修复 |
| 零绑定可选上报与绑定强制链去耦合同 | 草案 | OQ 闭合、终稿确权及开发授权后才能实施 |
| 全部必做的独立 UAT | 已起草，NOT RUN | UAT-ZB-R0／01–12；历史结果不改写 |
| 线上注册表内部具体失败分支 | 未取得 | 现有审计只保留统一码；只读接口无完整内部证据 |
| 新候选与旧行权限场景组合复跑 | 未执行 | 待修复及测试执行授权，不能由本次文档检查凑绿 |

## 6. 证据保存边界

本记录依据正式历史跑次、证据审计与当前测试源码；未执行新测试、未读取旧 inbox 缺失原文。线上计数来自本会话只读 API 取证，尚无正式 UAT 跑次，不作为本 suite 已执行记录。历史测试根因分析不推断个人意图，也不声称没有仓库外沟通。
