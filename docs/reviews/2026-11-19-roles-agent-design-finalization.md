# 角色权限与 Agent 文档优化及终稿确权记录

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 设计评审处理记录 / v1.0 |
| 日期 | 2026-11-19 |
| 关联功能 | P1-58／REQ-030-079；P1-59／REQ-030-080 |
| 审阅材料 | [Cursor意见](../../inbox/20261119-2220-roles-agent-spec-plan-uat-review.md)，v1.0；本记录保存处理结论，不依赖临时文件作为唯一结论 |
| 读取合同 | [Spec](../specs/lucy-20261119-roles-agent-read-responsiveness-spec.md) · [Plan](../plans/lucy-20261119-roles-agent-read-responsiveness-plan.md) |
| 并发合同 | [Spec](../specs/lucy-20261119-roles-agent-concurrent-edit-spec.md) · [Plan](../plans/lucy-20261119-roles-agent-concurrent-edit-plan.md) |
| 测试台 | [suite](../qa/uat/suites/roles-agent-concurrency-scale/suite.md)；判定以 [INDEX](../qa/uat/INDEX.md) 为准，当前NOT RUN |
| 确权方式 | 委托人明示：“你修改完就是终稿，不用再交付 codex cli”。本次修订完成后按明示终稿确权登记；未运行Codex CLI终审，不伪称CLI通过 |
| 授权边界 | 仅文档优化与定稿；开发未授权；不改运行代码、配置、schema、脚本、CI，不构建／部署／造数／执行UAT |

## 1. 逐项处理

| Cursor意见 | 处理 | 终稿内容与理由 |
|---|---|---|
| 两功能切分、算法优先、主路径、对象版本和真实测试方向正确 | 保留 | 两个功能合同独立，展示缓存不进入授权；错误不造假成功；2×／5×、开放式发压与纯MCP保留 |
| UAT过重且全部倒挂功能收口 | 部分采纳 | 测程确实重；原稿已有组合发布边界，不接受将“共享必做”等同“功能前置”。补F58／F59／R矩阵，R保留慢盘、60分钟、系统故障及全部联合档；R未跑不倒挂模块SC，模块通过也不倒推R |
| 5×预算可能不可达 | 采纳基线要求，不据推测降线 | 绝对线保留为可证伪目标，不冒称已测能力；开发前冻结有效改前基线，候选同时过绝对与同档相对不回退；无有效基线不算改善百分比；达不到FAIL回设计，不事后抬线 |
| 全局窗口限制吞吐 | 采纳 | 明确无关对象不假冲突，正式写仍串行；记录持窗时间、占用、成交和饥饿。窗外预计算不替代窗内最终重检；不给并行写吞吐承诺 |
| 依赖集合缺可打假矩阵 | 采纳 | 并发Spec DEP-01–11与对象摘要金样本；相关变化必须确认／拒绝、无关变化不得假冲突；previewEffectDigest与整配置candidateDigest分开；UAT 11-D01–11逐项对应 |
| operationId应先核查审计可关联性 | 采纳并完成只读核查 | 已有config_change_log行、intent／terminal、idempotency_key唯一索引与可信requestId；确定复用，不新建表。新协议还未实现，不能把底座存在当行为通过；精确接法见Spec §4.1 |
| 分区API扩大第一批范围 | 部分采纳 | W1先算法／展示／错误，W2分区与新鲜度；完整SC仍必须全做才能收口。不以“阶段完成”把剩余工作从总账抹掉；后续拆项须正式修订与登记 |
| 六问未评、元素过早细化 | 采纳设计评审，不放松证据 | 六问按合同设计逐项评为通过，不冒称浏览器实测；保留E编号与真实浏览器要求，调整期望须留版本，不能回写旧证据 |
| UI应写统计不是授权依据 | 采纳机制而非机械免责声明 | 指标统计与当前权限分区、时间各有范围；操作由fresh校验决定，统计不为授权背书 |
| 263总表会显著放大启用表成本 | 纠正事实与分母 | 历史回传263总表、259已选，差约1.5%；没有“远小于总数”的证据。改为Manifest总来源263／526／1315与启用259／518／1295两个轴，不混用编译与授权范围成本 |
| 本轮补查：缓存TTL可能挡住慢但正确的统计查询 | 修正主路径风险 | 5秒只限制缓存复用，查询5–10秒可返回真实asOf且不缓存，禁止反复丢弃重算；新增08步骤5独立验逃生，不将其混入正常性能组降线 |

## 2. 审计链路只读核查摘要

- `webui/server/admin/config-audit-write.ts`：pending intent与终态写在同一config_change_log行；终态在配置写入及必要运行时确认后更新。
- `webui/server/admin/audit.ts`：现有request_id、idempotency_key、write_status、new_summary及唯一幂等索引；终态更新按auditId，可保留并合并最小回执，无需新列或新表。
- `webui/server/security/request-actor.ts`：可信请求上下文含不可变账户UID、会话摘要、服务端requestId。显示ID不是永久账户身份；客户端operationId不能覆盖可信requestId。
- `webui/server/security/redaction.ts`：普通配置事件使用深度脱敏JSON summary；回执只存必要身份绑定、目标及摘要，不存完整配置或凭据。
- `webui/server/admin/access-config.ts`：先确认runtime digest，再写committed terminal。现有响应携带candidate／effective摘要，但尚未形成客户端operationId查询协议；终稿明确新增协议接线，不声称原功能已经具备。

确定方案：operationId经专用唯一键认领，intent绑定原UID／请求摘要，terminal合并持久回执；重复认领不得继续落盘。同号异内容／异账号拒绝；状态接口只向原UID或既有owner权限开放，返回历史提交而非冒充当前状态。缺终态／旧记录缺回执／审计不可达均unknown，不用当前值相同认领自己的提交。审计连续性丢失属于恢复边界，不承诺无证据的去重。

这是源码与schema的设计核查，不是执行新协议的spike或UAT；真实序列化、幂等、失败、恢复和权限隔离仍由后续SC与14-B／C验收。

## 3. 分层与状态

功能SC只由F58／F59对应模块证据证明；组合R保留完整压力并在同一候选准备主张组合通过时执行，负责人为候选测试执行者。当前F58、F59、R、当前倍率校准均未执行，测试台NOT RUN。当前流量缺测维度保留设计下限，不宣称已经满足客户现网2～5倍。

终稿确权不等于开发授权、功能合同收口、UAT PASS或可上线。六问为设计通过，浏览器证据继续“未执行”。本记录不产生新的运行时／测试执行权限，也不改变其他条目状态。

## 4. 文档检查

本次执行文档形态、Spec、术语、IA、三台链接及新增文档状态镜像／相对链接检查；检查结果仅为文档证据。既有非阻塞基线／示例警告单列，不修改豁免基线，不运行产品测试冒充UAT。

| 检查 | 2026-11-19结果 |
|---|---|
| lint:spec-docs | exit 0；另对本次两份Spec／Plan直接调用形态与交互合同检查，零违规，不依赖未跟踪草稿仅WARN的口径 |
| lint:spec | exit 0；既有eval paired_quiz与demo_readonly权限版本警告保留，未扩修 |
| lint:terminology／lint:ia-boundary | 均exit 0 |
| e2e-ledger链接检查 | exit 0；现有脚本未枚举新行，另单独验证本次suite、Spec／Plan、INDEX／e2e回链与文件存在性 |
| 状态镜像／本次相对链接 | 两份Spec／Plan与总账、需求池、两个README、概览现值同句；本次新增链接均存在 |
| 变更边界 | 只有文档；未修改代码／配置／schema／测试脚本，未执行UAT、浏览器、构建或发布；未做Codex CLI终审 |

形态基线仍有总账metadata一条STALE提示，这是非阻塞存量提示，未借此扩大或修改豁免基线。共享工作区出现的P1-60另案文档未纳入本次修订与确权。
