# ADR — 安全账本存储与上下文对象授权恢复

| 元数据 | 内容 |
|---|---|
| 文档名称 | 安全账本存储与上下文对象授权恢复决策 |
| 文档类型 | ADR |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude |
| 委托人 | xingchen |
| 基于材料 | [企业安全整改 Spec v0.2](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) §2、§4、§5；2026-10-17 评估 v1.1（V-02/V-03/V-04、D-01/D-02）；[路线图冻结 ADR](adr-post-p15-roadmap-freeze.md) |
| 适用范围 | 批准企业安全整改 Spec 时同批裁决的存储选型、一致性模型与公共授权契约变更 |
| 输出位置 | `docs/access-control/adr-20261018-security-ledger-and-context-acl.md` |
| 状态 | **已批准（2026-10-18，xingchen）— 已实施（T00～T15 代码已合入；本地安全集成 / 桌面浏览器证据已执行）；目标 amd64 K8s 验证未完成（BLOCKED），不构成客户发布授权** |

## 1. 背景与约束

- 管理会话无服务端状态，退出、改密后旧 Cookie 仍有效（V-03）；审计在响应发出后异步写入，写失败时内容已释放（D-02）；Spec 170 让全部 Wiki / 已发布 Skill 对所有启用 Agent 开放（D-01）。
- 部署边界：单实例 / 单副本、本地持久卷、已有 better-sqlite3；不得引入队列服务、多副本或 KTX 改动；遵守路线图冻结 ADR（不开 TokenScope / Dynamic RLS / 多租户）。

## 2. 决策

**D1 存储：** 新建 `.ktx-ui/security.sqlite`（WAL + `synchronous=FULL`）作为会话、账户代次、引导状态、限速桶、安全事件的事实源；现有 `.ktx-ui/audit.sqlite` 保持查询模型，改为由幂等 projector 从安全事件投影。

**D2 一致性：** 不做跨库事务。规则是“先在安全库耐久记录，再释放内容或确认成功”；审计库允许延迟，延迟以 `complete=false` 显式暴露。安全收窄（吊销、停用、改密）先写安全库再改配置文件，失败时停在更严格状态。

**D3 授权契约：** 撤回 Spec 170 的上下文全开放，恢复 Spec 151 的对象 ACL（Skill `roles_allowed`、Wiki `allowed_roles`），默认拒绝，同一角色须同时具备对象授权与动作通道。不新增第二套授权字段。

## 3. 备选方案

| 方案 | 不采用原因 |
|---|---|
| 会话 / 安全事件直接写入现有 `audit.sqlite` | 审计库可被管理导出、备份并在运维中读取，混入会话状态扩大泄漏面；两类数据保留策略不同 |
| 外部 Redis / 队列做耐久缓冲 | 违反单实例无新服务约束，客户 K8s 交付复杂度上升 |
| 继续异步审计，只加告警 | 无法满足“敏感内容释放前必有耐久记录” |
| 由 `sl_refs` 推导 Wiki 授权 | 引用变化会静默改变授权，跨域公共文档难表达 |
| 维持 Spec 170，靠多实例隔离保密域 | 单实例客户无法满足对象级保密要求 |

## 4. 主要权衡

- 每个敏感响应多一次同步 fsync：Spec §5.1 设 p95 ≤ 20 ms 预算，超出须回到 R2 决策。
- 安全库不可用时敏感读取返回 503，以可用性换可追溯性。
- 升级后无 ACL 的历史 Wiki / Skill 立即不可见，需管理员迁移确认。

## 5. 失败模式

| 失败 | 行为 |
|---|---|
| 安全库损坏 / 不可写 | 管理登录与敏感读取 503；health 标红；不回退到无状态会话或无审计 |
| 投影失败 | 安全事件不丢失；审计 UI 标 `complete=false`，恢复后幂等补投影 |
| 安全库丢失后从旧备份恢复 | 轮换会话密钥并要求全部管理员重新登录；Token 吊销表从最新受控记录恢复，未恢复前保持维护态 |
| ACL 字段损坏 | 对象拒绝访问，管理端提示修复，不解释为共享 |

## 6. 迁移与回滚

- 迁移：新 schema 幂等创建；旧 v1 会话一次性失效；上下文 ACL 按 Spec §4.3 迁移工具执行，模板内容随代码提交补 ACL。
- 回滚：不得回滚到会忽略 ACL 或无状态会话的旧镜像；只能回滚到通过同一安全回归的构建。安全库与审计库随持久卷备份，回滚时保持 `security.sqlite` 不删除。

## 7. 实施结果（T15，据实）

状态口径与 Spec 一致：**已实现 ✅｜本地通过 ✅（范围见下）｜目标 K8s 通过 ❌ BLOCKED｜可发布 ❌**。

### 7.1 D1/D2/D3 的落地

| 决策 | 落地 | 证据 |
|---|---|---|
| D1 安全库 | `.ktx-ui/security.sqlite`（WAL + `synchronous=FULL`，目录 0700 / 文件 0600，产品每次打开都会把权限收回 0600） | T01；`PRAGMA synchronous` 在压测中取值 2（FULL） |
| D2 先持久后释放 | 所有经准入的 MCP 响应先耐久写 `request_admitted`，授权复核后写 `response_prepared` 再发出；SSE 为有界缓冲；失败 503 `AUDIT_UNAVAILABLE` | T07；本地 SEC-19-V02（安全库无法打开）、V03（外部持有写锁）：503 且无内容释放，恢复后继续服务 |
| D3 对象授权 | `authorizeContext` 同角色闭合、默认拒绝、`*` 非匿名；模板 Wiki/Skill 同提交补 ACL | T05/T06；本地 SEC-14-V01～V10、SEC-10-V03 通过；UI 修改 ACL 后 Agent 通道立即一致（SEC-14-V11 真实浏览器通过） |

### 7.2 性能基准（Spec §5.1 预算：p95 ≤ 20 ms、p99 ≤ 50 ms、16 并发 5 分钟无 `SQLITE_BUSY` 导致的 503）

来源：`webui/scripts/audit-overhead-bench.mts`（T07-4，Apple M4 Pro / Node 24 / darwin arm64，上游为固定应答 stub，基线为前一提交构建）。**这是开发机基线，客户目标规格需在 K8s 上重测，未重测前不得宣称客户规格达标。**

| 场景 | 并发 | 额外 p95 (ms) | 额外 p99 (ms) | 结论 |
|---|---|---|---|---|
| `tools/call` | 1 | 3.507 | 2.910 | 达标 |
| `resources/read` | 1 | 5.705 | 7.458 | 达标 |
| `tools/call` | 16 | -6.830 | -13.234 | 达标（噪声内） |
| `resources/read` | 16 | 15.091 | 22.810 | 达标 |
| 持续压测 | 16 × 300 s | 总请求 238,174，全部 200；`SQLITE_BUSY` 503 = 0，账本追加失败 = 0，审计写失败 = 0 | | 达标 |

### 7.3 迁移结果（Spec §4.3，只在合成夹具上执行）

- `scripts/security/migrate-context-acl.mts --dry-run` 对 `examples/security-e2e` 渲染出的合成项目（2026-10-18，本次 T15）：保留 ACL **8**、显式全角色 **1**、待确认（缺失/损坏/旧 public）**2**、legacy Agent 待迁移 **1**，`inventoryDigest` 出现在报告中；无 ACL 的文档与 public 声明**没有**被自动改成 `*`；报告不含正文。
- `--apply`（owner、`--expected-digest`、逐文件 `expected_version`、加密备份与 journal、崩溃后保持 deny）由 `webui/server/__tests__/context-acl-migration.test.ts` 在合成夹具上覆盖。
- **未对任何客户真实配置执行 apply**：那属于部署授权范围，本 ADR 与计划的批准不能替代对目标私有配置的确认。客户上线门禁要求 `contextMigrationPending == 0`，当前该计数在 release 证据中未测量（BLOCKED，不是 0）。

### 7.4 仍然开放的风险（不被本 ADR 的"已实施"掩盖）

- 目标 amd64 单副本 K8s 上的真实用户 E2E、N-1 PVC 升级、恢复演练均未运行（R8 基础设施未提供）；因此 `security-findings.yaml` 中 G-01、G-03 保持 `open`。
- 真实自动 CLI（Claude Code / OpenClaw）与人工 GUI（WorkBuddy / Cursor）证据尚未齐备（R4 v5 / R10）。
- 故障注入控制面目前只有本地进程版本；K8s 版缺失，依赖 `fault-control` 的变体在 K8s 上将保持 BLOCKED。
