# 问询预算主路径逃生 · Spec／Plan／UAT 终稿审阅

| 元数据 | 内容 |
|---|---|
| 文档类型 | 终稿闭环审阅（不是实现 CR／UAT 跑次） |
| 日期 | 2026-11-22 |
| 评审人 | Kimi Code |
| 工作项 | P1-74／REQ-030-095 |
| 评审对象 | [Spec v1.1](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md)；[Plan v1.1](../plans/lucy-20261122-question-budget-mainpath-escape-plan.md)；[UAT-SUITE-BUDGET-ESCAPE v1.0](../qa/uat/suites/budget-escape/suite.md) |
| 事故输入 | [PM 场景报告](../../inbox/2026-11-22-question-budget-pm-scenario-report.md)；[前次对抗审阅](2026-11-22-question-budget-mainpath-escape-adversarial-review.md) |
| 审阅／修订边界 | 仅审阅与文档修订；未改运行代码、常量、指导、compat 或判定器；未执行实现／UAT |
| 终审结论 | **文档设计闭环通过；可进入开发授权决策。事故尚不能声称已解决，持续验证尚未发生；开发未授权，UAT＝NOT RUN** |

## 1. 对“是否形成闭环”的回答

### 设计层：是

修订后的文档已经覆盖原事故的完整因果链，而非只增加额度或修改报告文案：

```text
同 Token／无 session 旧桶持久触顶
  → 单窗仍停止，禁止 query 自动换窗
  → 同一问询可显式 continue，多窗真实成交
  → 续查耗尽后 inactive 可显式 mode=new_question
  → 下一数据工具与换窗原子准入，同 Token 真实成交
  → compat 管理 session／N 路径／continue／new_question
  → 同 Token 第二跑仍成交
  → budget／ACL／并发／存储错误分列
```

### 实施与运行层：尚未证明

当前没有实现、改后 compat、真实 Agent 或 UAT 跑次证据。因此只能说“方案能够针对事故根因并设计了持续验证”，不能说“异常已修复”或“未来版本已不会回归”。

## 2. 事故根因到验证的闭环矩阵

| PM 报告中的异常 | Spec 合同 | Plan 落点 | 持续验证 |
|---|---|---|---|
| 同 Token 跨跑次继承耗尽桶，后续合法 query 失败 | D7：`mode=new_question`；inactive／无 session 可重开 | Task 2：声明—消费、换窗与准入原子提交 | BESC-09A；BESC-12 两跑 |
| begin inactive 无法重置预算 | D6 保持 begin 无副作用；新开走 continue 工具的新 mode | Task 2 不写 turn／BindingSession，清除旧预算归属 | BESC-08；BESC-09 |
| 续查仅一次，长问询“一续即死” | D2：active=1、inactive=5；策略随生命周期快照 | Task 1／1b | BESC-02／03 |
| 续查全部耗尽后仍无出口 | D4：inactive 硬停指向 new_question；active 硬停走 begin | Task 2 校验硬停、凭证、pending 互斥 | BESC-03／04／07／09 |
| compat 缺 session、begin 失败仍带旧 turn、不 continue | D9：必须修成交链 | Task 4b | BESC-12；BESC-11 真实 Agent |
| budget 被聚合为 `new deny` | D5＋SC-E5／E5b 按具体 reason 分列 | Task 4 | BESC-05／12 |
| 健康与 RTT 绿掩盖问数触顶 | SC-E6 | 跑次双证据 | BESC-06 |
| 次数之外，busy／idle 语义可能回归 | 保持 settled busy，idle 不作门禁 | Task 5＋既有窗口回归 | BESC-10 |
| 多窗状态在重启／重试后失真 | SC-E9b：持久化策略、代次、pending 与幂等 | Task 1c；audit.ts 迁移与真实代理恢复 | 组件／真实代理证据；BESC-09 跨 runner 不替代 |
| 真实 Agent 只看工具成功，最终答案仍错误 | 第一性原理要求真实成交 | Task 4b／5 | BESC-11 最终答案逐项匹配数据库 oracle |

## 3. 本次终审修订闭合的剩余断点

1. **修正 UAT 映射**：SC-E9 → BESC-09；SC-E10 → BESC-12；BESC-11 专责真实 Agent，不再错配。
2. **统一 D7 与 legacy 用例**：旧身份未显式授予 continue 时，平滑升级后必须因既有计费问数能力获得逃生工具；不再要求“工具不可见却能调用其 new_question”。
3. **补齐持久化落点**：Plan 纳入 `audit.ts` 既有迁移、恢复字段、幂等键与真实代理重启证据。
4. **分开 active／inactive 硬停**：active 必须走 begin，inactive 才走 `mode=new_question`，避免绕过绑定合同。
5. **明确 new_question 前置**：只在 inactive 已硬停时接受，校验硬停凭证；非法 mode、错配 token、不同 pending 均拒绝。
6. **保持两段式与原子性**：工具调用只声明；下一数据工具在同一事务中完成换窗和准入；审计在提交后写入。
7. **处理旧归属与在途票据**：重开不新建上报 turn；提交后仅清理仍为旧值的 reported-turn 指针；旧在途调用按原窗归档。
8. **补齐重试幂等**：同 token 同代声明重试幂等成功；不同 pending 拒绝；begin 同时清两类 pending。
9. **强化成交定义**：不再接受“未 exhausted／非 ACL／进入下一窗”作为 PASS；必须真实出数并匹配独立 oracle。
10. **加入完整持续验证**：无 session、稳定 session、legacy 可达、busy／idle、真实 Agent、同 Token 两次 compat 全部纳入必做。

## 4. 为什么能守住 runaway 与主路径两边

- 单窗 60／300、settled busy、稳定作用域和并发边界不变。
- 第 61 次及不执行逃生动作的第 62 次均须停止且未执行，防止“下一次 query 自动换窗”。
- continue 有明确档数、代次和持久状态；inactive 同一问询最多 6 窗，资源放大已披露。
- new_question 是新生命周期的显式动作，不是 idle 自动重置；active 仍须 begin。
- 逃生工具可达不增加 connection／source／行权限；ACL 仍先裁决。
- 合法用户在同 Token、无 session、零绑定下也有实际可达的恢复与成交路径。

“显式调用”不等于人工确认；runaway Agent 仍可能自动调用。本方案提供的是有界窗口、停机信号和可审计生命周期，不声称建立身份终身配额。

## 5. 持续验证是否足够

设计上足够，因为 UAT 同时具有：

- **正例**：触顶后 continue／new_question 真实成交；
- **负例**：无显式动作仍停止，active／inactive 不错用通道；
- **事故回放**：同 Token 两次 compat，覆盖原预算命中的目标 allow 案；
- **跨版本证据槽**：版本、配置指纹、身份授予、session 模式、预算快照、requestId、工具轨迹和最终答案；
- **防误诊**：budget／ACL／concurrency／unavailable 分列，expected deny 不得被 budget 假绿；
- **防假修复**：禁止重签 Token、重启、清库、关预算、临时补授、mock、手记冒充成交。

但 INDEX＝NOT RUN 时必须保持缺口 `GAP-UAT-P1-74`。只有修复后 BESC-R0／01–12 全绿，且 SC-E9b 的真实代理恢复证据通过，才可主张本功能合同收口；仍不等于可上线。

## 6. 残余边界与不得混同项

- 原报告的 JOIN chasm、ACL-03b 和 Agent 墙钟属于另案；本项不得借预算修复把它们改绿。
- 方案尚未实现，多窗幂等、锁、恢复与兼容性均需实际测试证明。
- 真实 Agent／慢源／active 环境无法构造时记 BLOCKED，不得降级为书面 PASS。
- 新工具可见性只增加预算生命周期能力，不得扩大数据授权。
- 本报告不构成开发授权、镜像构建、客户交付或上线批准。

## 7. 最终裁决

**文档闭环成立，且验证设计直接覆盖 PM 报告中的预算粘连、合法 allow 假红和逃生不可达。可以将当前 Spec／Plan／UAT 作为开发授权评审输入。**

下一步顺序必须是：

```text
委托人另发开发授权
  → 按 Plan 实现与组件／恢复测试
  → 改前基线保留
  → 修复后真实 MCP／compat／Agent 复跑
  → BESC-R0／01–12 全绿＋SC-E9b 通过
  → 功能合同收口（仍≠可上线）
```

在此之前，不得声称异常已正确解决或持续验证已经生效。

---

## 8. 文档验证记录

- `node scripts/uat/check-e2e-ledger.mjs`：**PASSED**，P1-74 的 suite／cases／fixtures、INDEX 与 e2e-ledger 勾连有效。
- 定向结构检查：**PASS**；BESC-R0／01–12 共 13 项均有摘要与正文，6 份核心审阅文档的本地相对链接均可解析。
- `git diff --check`：**PASS**。
- 全量 `npm run lint:spec-docs`：**FAIL（非本项文件）**。输出为其他既有 Spec 的 `status-funnel` 与 prepack Plan 的 `plan-parts`／`metadata` 问题；未包含本次 P1-74 Spec／Plan／UAT 文件。本报告不据此主张全仓文档门禁通过，也不修改无关项。
