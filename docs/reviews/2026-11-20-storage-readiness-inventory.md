# SQLite 风险与 PostgreSQL 迁移准备：源码盘点

日期：2026-11-20。关联：P1-71／REQ-030-092；[Spec](../specs/lucy-20261120-storage-readiness-spec.md)／[Plan](../plans/lucy-20261120-storage-readiness-plan.md)。

证据范围：当前共享工作树源码及已有 Spec／测试设计，含其他任务未提交实现。未打开任何运行数据库、客户数据、凭据或真实连接配置；未采样服务、未运行 Docker、备份或迁移。下列是源码入口盘点，不是线上版本认证、完整表清单或容量实测。

## 1. 存储与恢复边界

| 资产 | 源码入口／落点 | 数据意义与恢复要求 | PostgreSQL 准备边界 |
|---|---|---|---|
| 审计应用库 | `webui/server/proxy/audit.ts`、`webui/server/admin/audit.ts`；默认 `.ktx-ui/audit.sqlite`，可用 `LUCY_AUDIT_DB` 覆盖 | 原始调用、问询及关联、trace／evidence、预算及其他治理状态混合；派生数据逐表判定，不能整库视为缓存 | 迁移前生成完整 schema／索引／触发器／版本及写入者清单；保留同库事务 |
| 审计维护连接 | `webui/server/proxy/audit-rebuild-write-worker.mjs`、`webui/server/admin/agent-statistics-worker.mjs` | 重建写连接与统计读连接；worker 保护主线程，但仍共享数据库锁与磁盘 | 统一连接、事务及截止语义；不能只替换路由层连接 |
| 安全事实库 | `webui/server/security/store.ts`、`schema.ts`、`ledger.ts`；`.ktx-ui/security.sqlite` | 管理员／会话／引导状态、安全事件、待办及投影；不能丢失后当空库重建 | WAL＋显式 FULL；先持久化再释放响应；安全状态不能因回退被复活 |
| 评测应用库 | `webui/server/eval/db.ts`；默认 `.ktx-ui/eval/runs.sqlite`，可用 `LUCY_EVAL_DB` 覆盖 | 评测历史与用例结果；其业务输入可能另存在文件 | schema 与历史结果纳入兼容核对，不能只迁审计后宣称全库可迁 |
| 配置及治理文件 | `webui/server/project.ts`、`publish-coordinator.ts`、`semantic-recovery-journal.ts`、`semantic-release-restore.ts` | 项目／访问配置、语义资产及发布恢复事实；Git 文件不等于运行实例完整状态 | 与数据库的一致性点、版本和敏感附件分别登记；换数据库不能覆盖文件事务 |
| 运维步骤账 | 当前未提交 `webui/server/runtime/ops-step-journal.ts`；合同见 P1-68 | 独立运维过程记录；不替代安全／审计事实 | 按最终合同判断保留策略，不将工作树实现视为客户已部署 |
| KTX 本地状态／索引 | DEVELOPMENT「语义层分层」与 `ktxLocalStateDbPath` 约定 | 上游依赖；逐类确认哪些能从资产重建，不假设全部可丢 | 不修改 KTX，不承诺随 Lucy 自管库迁 PostgreSQL |
| 业务数据源 | 数据问答经上游访问 | 非 Lucy 应用库，不能以本项目准备为由复制或变更 | 不在本次迁移范围 |

## 2. 已有覆盖与新增差集

| 主题 | 已有入口／合同 | 本次准备识别的差集 |
|---|---|---|
| 大查询／同步阻塞 | P1-21／32／33、P1-39 冷启动、P1-47 重建；[P1-47 Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md) | 复用原合同与测试台现值；未测量未来增长工况，需同时验合法 MCP 与维护负载 |
| 写争用 | `webui/server/__tests__/budget-state-sqlite-contention.test.ts`；P1-60 | 单项回归不等于全写入者争用预算；需写入者图、等待时间和尾延迟 |
| 审计持久健康 | `webui/server/proxy/audit-write-health.ts` | 不是完整数据库观测：增长、WAL、锁等待、提交延迟与磁盘余量需单独设计；只读观测也有开销 |
| WAL 参数 | `webui/server/trace/evidence.ts`、重建 worker | 审计连接设置 WAL／busy timeout／checkpoint；安全库显式 FULL；尚未逐连接核对实际 synchronous 与构建默认值，不据此宣称持久性缺陷 |
| 备份一致性 | `scripts/e2e/run-upgrade.mjs` 的 `evaluateBackup` | 已有门禁规定包含 security store 时须 quiesced；需验证实际执行、完整资产清单、恢复后可用性和安全状态 |
| 单库快照先例 | `scripts/audit-trust/2026-10-19-r1-backfill.mjs` | 单库 backup API 是历史回填工具，不证明多库和文件在同一恢复点 |
| 容量／保留 | trace 合同有每 trace 容量约束；问句预览有独立保留逻辑 | 预览脱敏／清除不等于整库生命周期；需逐表与证据关联、法律／业务保留要求对齐，不执行删除 |
| 可迁移性 | 当前模块直接使用 `better-sqlite3` 与同步事务 | 未发现足以证明整套 PostgreSQL 应用后端可用的合同与演练证据；不能将外部 PostgreSQL 数据源支持当成应用库支持 |

## 3. 风险登记与候选处置

| ID | 风险／触发证据 | 准备输出 | 后续验证 |
|---|---|---|---|
| SR-01 | 主线程慢 SQL、磁盘同步或锁等待牵连主路径 | 写入者／同步段图、关键操作延迟预算 | UAT-STOR-01／02／03 |
| SR-02 | 多连接竞争写锁，worker 无法消除单文件写串行 | 每库读写者及等待／重试策略表 | UAT-STOR-02 |
| SR-03 | 长读阻碍 checkpoint、WAL 与磁盘持续增长 | WAL／空间／最老读事务观测设计与处置入口 | UAT-STOR-03 |
| SR-04 | 各库持久化承诺不同；文件与数据库恢复点错位 | 持久化矩阵及一致备份清单 | UAT-STOR-04／05 |
| SR-05 | 留存与归档破坏证据、幂等或关联事实 | 逐表生命周期及禁止删除项 | UAT-STOR-06 |
| SR-06 | SQLite 特有 SQL、同步事务与 ID 序列妨碍迁移 | 存储接口与 SQL 差异清单 | UAT-STOR-07／08 |
| SR-07 | 切换后直接回旧库导致新写入丢失或安全撤销失效 | 分阶段切换与回退决策表 | UAT-STOR-09／10 |

## 4. 待决策与局限

- 待采样：真实调用峰值、写放大、每库日增长、锁／提交分位延迟、磁盘能力。不能用用户数或当前单次实验推导一年容量。
- 待冻结：可接受丢失窗口（RPO）、恢复时间（RTO）、维护窗口、保留要求、容量余量、观测采样开销。当前不承诺数值。
- 待冻结：未来可迁移的完整表范围、存储接口是否异步、跨库／文件恢复协议、已写入 PostgreSQL 后的数据回退方式。
- 不新增通用 ORM、双写链路或多副本合同。准备期的完成只证明设计可审阅，不证明运行风险已降低或 PostgreSQL 已受支持。
