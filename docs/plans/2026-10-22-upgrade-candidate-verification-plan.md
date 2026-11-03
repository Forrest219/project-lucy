# Lucy v0.25 升级候选验证环境实施方案

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy v0.25 升级候选验证环境实施方案 |
| 文档类型 | Implementation Plan（v0.25 需求备忘落地） |
| 版本 | v0.2-spec-baseline |
| 撰写日期 | 2026-10-22；2026-10-25 收口 |
| 状态 | **已收口为 P1-6 Spec，需求审查已签核通过；暂不开发，非门禁** |
| 设计基线 | [Lucy v0.25 升级候选验证 Spec](../specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md) |
| 适用范围 | 用现役实例的一致性备份，在隔离环境验证候选镜像的迁移正确性、业务连续性与审计连续性 |
| 关联 | L25-07 [客户升级 E2E 自动化](2026-10-19-upgrade-e2e-implementation-plan.md)；[全新部署包生成计划](2026-10-21-customer-v2-fresh-install-package-plan.md)；[v1→2.0 客户升级计划](2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md)；[客户交付预检清单](../runbooks/customer-delivery-preflight-checklist.md) |
| 发布属性 | 非门禁。不改当前 CI、冻结分母、发布聚合器、客户放行条件或已有 gate 判定 |

---

## 0. 结论

1. **原地升级仍是客户现场主线，本方案不替代它。** 本方案落地的是 L25-07 里「独立恢复验证」这一条——它在[升级 E2E 方案](2026-10-19-upgrade-e2e-implementation-plan.md) §6 目前只有一句「备份先恢复到独立卷和独立实例」。

2. **通道定位是验证通道，不是交付通道。** v0.25 阶段只做「用备份在隔离环境跑候选镜像并出报告」。**不切流、不承接客户流量、不作为客户部署形态、不替代原地升级。**

3. **最关键的一条实现约束：验证环境必须以空卷起步，先整卷覆盖再启动候选镜像。** 顺序反了会得到「新模板 + 旧文件」的混合态——看起来启动成功，实际结构是错的（§4 D2）。

4. **安全状态是独立的一层，不随旧快照回退。** `.ktx-ui/security.sqlite` 承载吊销与会话，它是 WAL 库；热备份会丢已提交事务，直接后果是**已吊销 Token 复活**（§4 D3）。

5. **能证明什么、不能证明什么必须写死。** 本通道证明「迁移正确」，**不**证明「安全状态不回退」——后者只有原地升级能证明，因为只有原地升级的卷不会回退（§3）。

---

## 1. 目标与边界

### 1.1 目标

在不触碰客户生产实例的前提下，用现役实例的**一致性备份**，在隔离环境中启动候选镜像，并对以下三件事给出可复查结论：

- 候选版本对**完整旧卷**的迁移是干净的（没有混合态、没有半写配置）。
- 业务连续：有效凭据仍能通过公共 MCP 取数，结果与独立答案一致。
- 审计连续：历史记录按 ID 与关键字段可读，新调用产生新记录。

产物是一份脱敏结构化报告 + 人工可读小结，**不产生发布放行证据**。

### 1.2 明确不做

- 不切流、不改客户拓扑、不改客户 Service / Ingress / DNS。
- 不做字段级资产迁移。那是跨大版本断代升级的数据迁移项目，不是本方案。
- 不引入多副本、共享可写卷或跨副本一致性（[`DEVELOPMENT.md` 部署拓扑边界](../governance/DEVELOPMENT.md)）。
- 不修改 KTX 源码。
- 不新增或修改任何发布门禁、冻结分母、发布聚合器。
- 不复用、不打印、不轮换客户实例的引导密钥。
- 不在 Mac 上把任何 `productionReady` 类字段改成 true。

---

## 2. 现状依据

以下为 2026-10-22 的代码与文档依据。实施前须重新核对，不能把本文的代码快照当永久事实。

| 已有件 | 位置 | 可复用方式 | 缺口 |
|---|---|---|---|
| K8s 一致性备份产物 | `scripts/deploy/customer-deployment-helper.py:506` 先 `scale --replicas=0`，`:518` 再整 PVC tar；方法名 `quiesced-pvc-tar`（`:280` 校验） | 直接作为本通道的备份输入 | 无 |
| Compose 侧备份 | `scripts/upgrade/upgrade-lucy.sh:135-149` | 可作开发期输入 | **运行中热拷**（容器未停），与 K8s 侧不一致（§9 附带修复） |
| 恢复手册 | `deploy/k8s/examples/RECOVERY.open-mode.md:86-100` | 替换 + 解压 + 校验的现成动作 | 面向回滚，未定义「验证环境」语义 |
| 升级前快照 / 升级后校验 | `scripts/upgrade/upgrade-uat-snapshot.mjs`、`scripts/upgrade/upgrade-uat-verify.mjs` | 校验逻辑（access.yaml 指纹、audit 行数、抽查 turn、MCP 确定性查询、KTX 版本）可直接复用 | 目前面向「同一卷前后」，需参数化到「两实例之间」 |
| 安装意图 | `scripts/deploy/customer-deployment-helper.py` 的 `intent=install` 分支；见[全新部署包计划](2026-10-21-customer-v2-fresh-install-package-plan.md) §1.3 | 验证环境的环境构造入口 | 失败关闭与安装样例**尚未实现**（该计划 §3.1–3.3） |
| 空集群基线 | `deploy/k8s/gate/values.gate-fresh.yaml` | 渲染与安装基线 | — |
| 认证状态探测 | `scripts/deploy/probe-customer-auth-state.mjs` | 判定基线是否已有管理员 / 安全库 | — |
| OPS-01 用例 | `scripts/e2e/contracts/case-catalog.yaml:539-555`（V01–V07） | 升级语义的事实源 | 断言面向原地升级，未覆盖「跨实例恢复」 |
| 升级 E2E 方案 | `docs/plans/2026-10-19-upgrade-e2e-implementation-plan.md` §6、UPG-02 | 本方案的上位方案 | §6 只有一句话 |

### 2.1 关键事实：安全状态库的位置与性质

- 路径：`<projectRoot>/.ktx-ui/security.sqlite`（`webui/server/security/schema.ts:6`、`webui/server/security/store.ts:132`）。
- 内容：`revoked_tokens`（`webui/server/proxy/audit.ts:331`）、`admin_sessions`（`webui/server/security/store.ts:354`）等。
- 性质：WAL + `synchronous=FULL`，目录 0700，db/WAL/SHM 0600，schema 带版本号，重复初始化幂等。
- 版本护栏：`webui/server/security/schema.ts:141-146` **拒绝比当前二进制更新的 security 库**，不做降级。
- 2.0 升级会**新建**该库；`helm rollback` 不恢复 `admins.yaml` 与 `security.sqlite`（`deploy/k8s/helm/lucy/ROLLBACK.md:89`）。
- 旧版本（v1 线）卷内**没有**该库（`deploy/k8s/examples/RECOVERY.open-mode.md:96` 断言其不存在）。

由此得出两条硬结论：

- **v1→v2 场景**：旧卷无安全库，恢复旧备份**不存在**吊销复活面。
- **v2→v2.x 场景**：旧卷内有安全库，恢复旧备份**会**让备份时点之后吊销的 Token 与会话重新可用。因此本通道**不**把「安全状态不回退」列为可验证项（§3）。

---

## 3. 通道的能力边界

这张表是本方案的核心约束。**不得把本通道的通过结论当成原地升级的通过结论。**

| 问题 | 原地升级 | 本通道 | 说明 |
|---|---|---|---|
| 候选镜像能否对旧卷完成迁移 | ✅ 直接证明 | ✅ **等价**证明 | 两者走同一条迁移路径（§4 D2） |
| 业务查询结果一致 | ✅ | ✅ | |
| 授权裁决一致（允许 / 越权拒绝） | ✅ | ✅ | |
| 审计历史可读 | ✅ | ✅ | |
| **安全状态不回退（吊销不回滚）** | ✅ **唯一** | ❌ **不能证明** | 恢复的是备份时点状态；只有不换卷的原地升级才不会回退 |
| 客户接入零改动 | ✅ | ❌ 不适用 | 本通道不承接流量 |
| 真实客户拓扑与真实维护窗口 | ✅ | ❌ | 本通道为隔离环境 |
| 断代升级（迁移链断裂） | ❌ 做不到 | ⚠️ 需字段级迁移 | 超出本方案范围 |

**推论**：本通道与原地升级**互补**，不替代。原地升级仍是客户现场放行的依据；本通道的价值是**在动手改客户生产卷之前，先拿到候选版本的迁移正确性证据**。

---

## 4. 关键设计决策

### D1 通道定位：验证通道，不是交付通道

- v0.25 阶段只产出**报告**，不产出可交付包、不改客户部署形态。
- 验证环境是一次性的：每次运行独立创建、独立销毁（§4 D5）。
- 报告**不写入** `release-readiness.json`、`ops.json` 或签名发布包，避免被现有 collector 误认为发布证据（与[升级 E2E 方案](2026-10-19-upgrade-e2e-implementation-plan.md) §8 同一原则）。

### D2 导入顺序：空卷起步，先整卷覆盖，再启动候选镜像

**这是本方案最容易被做错、且做错后最难发现的一条。**

候选镜像的迁移契约是「旧文件已在原地 → 只补缺失、绝不覆盖客户资产」（`scripts/runtime/docker-entrypoint.sh:99-144` 的 missing-only 复制；`:199-288` 的幂等补丁）。因此：

- ✅ **正确顺序**：建**空卷** → 整卷覆盖旧备份 → 启动候选镜像。此时镜像对「一份完整的旧卷」执行它本就设计要执行的增量迁移，**与生产现场走同一条路径**，验证结论才成立。
- ❌ **错误顺序**：先让新镜像 seed 出新模板（`LUCY_ENTRYPOINT_SEED_ONLY=1`，`docker-entrypoint.sh:411`）→ 再整卷覆盖旧备份。旧文件会顶掉新模板，随后 missing-only 补齐只把**路径不同**的新文件补回来 → 得到「新文件 + 旧文件」混合体，**没有明确版本基线**，且容器健康检查通过、看起来一切正常。

因此：**验证环境的卷在导入前必须为空**，且验证通道**不启用** `LUCY_ENTRYPOINT_SEED_ONLY`。同时必须增加一条结构基线断言（§7 RVC-05）专门拦截混合态。

### D3 安全状态分层与备份一致性

- **备份必须 quiesced。** `security.sqlite` 是 WAL 库；运行中整卷 tar 可能丢失已提交事务（WAL 未 checkpoint），后果是**已吊销 Token 与会话复活**——这是安全问题，不只是数据一致性问题。验证通道对含安全库的基线**只接受**停服后取的备份，否则 `BLOCKED`。
- **业务数据与安全状态分开处理。** 恢复分两步：① 整卷恢复业务数据与旧授权配置；② **单独注入**「经核对的最新安全状态」，再轮换会话密钥并要求重新登录。只轮换 Cookie 签名密钥**不能**代替 Token 吊销恢复（[升级 E2E 方案](2026-10-19-upgrade-e2e-implementation-plan.md) §6、[RECOVERY.open-mode.md](../../deploy/k8s/examples/RECOVERY.open-mode.md) §1）。
- **注入源必须声明来源与新鲜度。** 报告需记录安全状态的取自哪个时间点、由谁确认；无法确认时该验证环境**只能**用于迁移正确性验证，安全相关断言标 `SKIPPED` 并写明原因，**不得**标 `PASSED`。

### D4 身份与密钥策略

- 验证环境是**新实例**：新引导密钥、新 `instanceId`、新 namespace / PVC / release。
- **不复用**客户实例的引导密钥。安全库按 D3 注入。
- 会话密钥在验证环境内**轮换**，不复制生产的 `webui-session-secret`；旧会话在验证环境里一律失效。
- `ktx-internal-token` 由验证环境自行生成，不与生产共用，避免验证环境的代理流量影响生产客户端的凭据预期。

### D5 隔离与销毁

- 验证环境必须满足：独立 namespace（或独立 compose project）、独立 PVC、独立 Service 名、**入口不暴露到客户可达网络**。
- 验证环境的**外部数据源连接**指向与生产相同的只读数据源，但**只读**；验证环境的写入只落自己的卷。
- 运行结束必须销毁卷、namespace、Secret、临时工作副本。清理失败要记进报告，**不得**为了清理方便删除不属于本次运行的资源。
- 产物目录 `inbox/upgrade-candidate/<runId>/`，与 `inbox/` 的一次性定位一致。

### D6 与 `intent=install` 的关系

验证环境复用安装意图（`intent=install`）作为环境构造入口，因为它的失败关闭语义（目标 namespace 无同名 Deployment / PVC / Helm release，PVC 名必须为 `<deployment>-data`，不得填 `existingClaim`）正好就是「干净环境」的定义。

**依赖**：安装意图的失败关闭、安装样例与安装说明，在[全新部署包生成计划](2026-10-21-customer-v2-fresh-install-package-plan.md) §3.1–3.3 中仍是**待做**项。本方案不重复实现它们，但**依赖它们先完成**（§10 依赖 D-1）。

---

## 5. 架构

```text
┌─ 现役实例（客户生产，单副本）────────────────────────────┐
│  ① quiesced 备份：停写 → 整卷 tar → 校验 sha256          │
│      └─ 产物：backup-<ts>.tgz + backup-<ts>.json          │
│      └─ 附带：安全状态注入源（独立通道，不含在 tar 内）    │
└──────────────────────────┬───────────────────────────────┘
                           │  只读搬运，不改现役
                           ▼
┌─ 验证环境（隔离，一次性）────────────────────────────────┐
│  ② 建空卷（断言为空）                                    │
│  ③ 整卷覆盖（不做 seed）                                  │
│  ④ 注入最新安全状态 + 轮换会话密钥                       │
│  ⑤ 启动候选镜像（与生产同一条迁移路径）                    │
│  ⑥ 结构基线断言（拦截混合态）                             │
│  ⑦ 连续性断言（业务 / 授权 / 审计 / 会话）                │
│  ⑧ 销毁卷与 namespace                                     │
└──────────────────────────┬───────────────────────────────┘
                           ▼
              脱敏报告（不产生放行证据）
```

---

## 6. 核心流程（伪代码）

```text
runCandidateVerification(baseline, candidate, deployment, backup, options):
  # ── 阶段 0：身份与归属 ────────────────────────────────
  require candidate.imageIdentity.verified == true
  require baseline.instanceId != null
  require deployment.isolated == true
  require deployment.ownedByThisRun == true
  require deployment.ingressReachableFromCustomerNetwork == false
  if not all of the above:
      record BLOCKED; stop before any mutation

  # ── 阶段 1：备份一致性判定 ────────────────────────────
  require backup.sha256Verified == true
  hasSecurityStore = backup.contains(".ktx-ui/security.sqlite")
  if hasSecurityStore:
      # security.sqlite 是 WAL 库：热备会丢已提交事务 = 已吊销 Token 复活
      if backup.method != "quiesced":
          record BLOCKED("SECURITY_STORE_REQUIRES_QUIESCED_BACKUP"); stop
  else:
      # v1 线旧卷无安全库，不存在吊销回退面
      record NOTE("baseline has no security store; revocation-regression checks not applicable")

  # ── 阶段 2：构造验证环境（顺序即语义）─────────────────
  createEmptyVolume(env)
  require fileCount(env) == 0            # 硬断言：绝不允许先 seed
  require options.seedOnly != true       # 硬断言：禁用 LUCY_ENTRYPOINT_SEED_ONLY
  restoreWholeVolume(backup, env)        # 整卷覆盖
  require restoredFileCount(env) == backup.fileCount
  applyLatestSecurityState(env, securityStateSource)   # 独立注入，不依赖旧快照
  rotateSessionSecret(env)               # 旧会话在验证环境一律失效
  startCandidate(env, candidate)
  waitHealthy(env, deadline)

  # ── 阶段 3：结构基线断言（拦截混合态）─────────────────
  for path in STRUCTURE_BASELINE_PATHS:
      expected = candidate.expectedStructure(path)
      actual   = fingerprint(env, path)
      if expected != actual:
          record FAILED("STRUCTURE_MIXED_STATE", path, expected, actual)
          goto teardown
  if candidate.structuralChangePaths != []:
      for path in candidate.structuralChangePaths:
          assert env[path] reflects candidate version   # 新版结构确实生效

  # ── 阶段 4：连续性断言 ────────────────────────────────
  run RVC-06..RVC-11 against env
  # 业务连续：有效凭据 + 确定性查询，结果与独立答案一致
  # 授权连续：允许路径允许，越权探针被拒（拒绝是预期，不是 500）
  # 审计连续：历史记录按 ID 可读，新调用追加新记录
  # 会话：轮换后旧会话失效，新登录可用

  # ── 阶段 5：幂等与清理 ────────────────────────────────
  rerun restoreAndAssert(env)            # RVC-12：同备份重放两次，结果一致
  teardown(env)                          # 销毁卷 / namespace / Secret / 临时副本
  if teardown incomplete:
      record BLOCKED("RESOURCE_CLEANUP_INCOMPLETE", details)

  write report(runId, statuses, timings, redacted evidence)
  # 不写 release-readiness.json / ops.json / 签名发布包
```

---

## 7. 断言设计

编号 `RVC-*` 为本方案**内部编号**，不进入 `case-catalog.yaml`，不改任何分母或冻结 profile。

| 编号 | 场景 | 通过标准 |
|---|---|---|
| RVC-01 | 备份一致性 | sha256 校验通过；含安全库时备份方法为 `quiesced`；否则 `BLOCKED` |
| RVC-02 | 隔离与归属 | namespace / PVC / Service 独立；入口不可从客户网络到达；资源归属本次运行 |
| RVC-03 | 空卷起步 | 覆盖前目标卷文件数为 0；`LUCY_ENTRYPOINT_SEED_ONLY` 未启用。**任一不满足即 `FAILED`** |
| RVC-04 | 整卷覆盖完整 | 恢复后文件数与清单与备份一致；关键路径存在（`ktx.yaml`、`access.yaml`、`.ktx-ui/`、`.ktx/secrets/`） |
| RVC-05 | 结构基线无混合态 | 结构基线清单逐项符合候选版本预期；候选声明的结构性变更路径确实生效。**不通过即 `FAILED`，不得降级为警告** |
| RVC-06 | 业务查询一致 | 有效凭据经公共 MCP `lucy_query` 返回非空且与独立答案一致 |
| RVC-07 | 授权允许路径 | 授权范围内的查询被允许，裁决与旧版本一致 |
| RVC-08 | 授权拒绝路径 | 越权探针被拒绝；错误是预期认证 / 授权拒绝，**不得用 500 代替** |
| RVC-09 | 审计连续 | 历史记录按 ID 与关键字段可读；新调用追加新记录；行数不下降只作辅助 |
| RVC-10 | 会话失效 | 轮换会话密钥后旧会话不可用；新登录可用 |
| RVC-11 | 跨域探针 | 跨域 / 未授权对象不可访问 |
| RVC-12 | 幂等重放 | 同一备份重放两次，断言结论一致，无重复身份或半写配置 |
| RVC-13 | 清理完整 | 卷、namespace、Secret、临时副本已销毁；残留如实记录 |

**报告状态**：`PASSED` / `FAILED` / `BLOCKED` / `UNIMPLEMENTED` / `SKIPPED`。缺能力与缺实现**不等于**通过。管理 API 返回 401、查询仅返回非空、页面能打开，均不能单独证明业务可用。

---

## 8. 产物与证据

产物目录 `inbox/upgrade-candidate/<runId>/`：

| 产物 | 记录内容 |
|---|---|
| `run.json` | 基线与候选镜像身份、部署形态与版本、实例身份、基线是否含安全库、适用的 `RVC-*` |
| `backup.json` | 备份方法、sha256、是否 quiesced、文件数、恢复点时间、注入的安全状态来源与新鲜度 |
| `restore.json` | 覆盖前后文件数、结构基线断言、候选声明的结构性变更、幂等重放结论 |
| `assertions.json` | 逐条 `RVC-*` 的期望值、实际值、判定 |
| `report.md` | 结果、失败与未覆盖项、停机与恢复耗时、清理结论、现场建议 |

**不得**输出完整 Token、Cookie、密码、密钥或可离线利用的凭据材料。需要比较时用检查器内部比对，公开报告只输出结果与非敏感标识。安全状态注入源不进入报告正文，只记录标识与新鲜度。

---

## 9. 分阶段任务

### P0 确认契约与环境

- [ ] 定义备份清单与 `quiesced` 判定规则；把 `security.sqlite` 纳入「含安全库则必须 quiesced」的判断。
- [ ] 定义结构基线清单（`STRUCTURE_BASELINE_PATHS`）与「候选声明的结构性变更路径」的表达方式。
- [ ] 定义安全状态注入源的取值方式与新鲜度字段；无法确认时的降级规则（标 `SKIPPED` 并写明原因）。
- [ ] 确认验证环境的隔离判据（入口不可达、资源归属、只读数据源）。
- [ ] 把 `RVC-*` 与 `upgrade-uat-verify.mjs` 的现有校验项做映射，避免重复造断言。

完成标准：输入足以复现，不依赖客户生产库、个人路径或移动分支名。

### P1 建立最小完整旅程

- [ ] 实现 `scripts/upgrade/restore-candidate-env.mjs`：备份校验 → 空卷 → 覆盖 → 安全状态注入 → 起候选 → 断言 → 清理。
- [ ] 参数化 `upgrade-uat-verify.mjs` 的校验项，使其可在「两实例之间」运行（当前是同实例前后）。
- [ ] 实现执行器自身的拒绝路径：非空目标卷、备份非 quiesced、隔离不满足、资源非本次运行 —— 各自必须报错停止。
- [ ] 产出 §8 全部产物，含脱敏检查。

完成标准：一次运行能证明完整过程，而不是单个脚本退出码。

### P2 覆盖部署形态

- [ ] 在 linux/amd64 的 K8s / K3s / Docker 分别复验同一候选镜像。
- [ ] 覆盖变体：UID 0 与 UID 10001 的旧数据卷；`LUCY_CONTENT_ROOT` 为 `.` 与 `config/` 两种布局；无安全库与有安全库两种基线。
- [ ] 记录各环境耗时与人工步骤，不用一个环境的结果替代另一个。

完成标准：每种形态有可复查报告，缺口明确标记而不是合并成全局通过。

### P3 接入真实升级产物

- [ ] 把[客户 v1→2.0 升级计划](2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md) P0-3 至 P0-6 产出的真实备份接入本通道。
- [ ] 覆盖 v2→v2.x 基线（存在安全库）的分支，验证 D3 的注入与 `BLOCKED` 判定。

完成标准：真实客户形态的备份能在隔离环境复现升级前后的行为差异。

---

## 10. 依赖与未决事项

### 依赖

| 编号 | 依赖 | 状态 |
|---|---|---|
| D-1 | `intent=install` 的失败关闭、安装样例与安装说明（[全新部署包计划](2026-10-21-customer-v2-fresh-install-package-plan.md) §3.1–3.3） | **待做**。本通道以其为环境构造入口，不重复实现 |
| D-2 | 客户 v1→2.0 升级计划 P0-3 至 P0-6 产出的真实备份产物 | 待做 |
| D-3 | [升级 E2E 方案](2026-10-19-upgrade-e2e-implementation-plan.md) 的 `UPG-02`（备份可恢复） | 方案态。本方案是它的细化，**不替代**它 |
| D-4 | 隔离环境的只读数据源与网络可达性 | 现场条件 |

### 附带修复（与 P0 一并处理）

- **compose 侧备份是运行中热拷**：[`upgrade-lucy.sh:135-149`](../../scripts/upgrade/upgrade-lucy.sh) 在容器仍在运行时整卷 tar，与 K8s 侧的 `quiesced-pvc-tar` 不一致。应在开发期对齐为停服后取备份。
- **compose 侧保留检查漏了安全库**：[`upgrade-lucy-lib.mjs:8-16`](../../scripts/upgrade/upgrade-lucy-lib.mjs) 的 `PRESERVE_REL_PATHS` 含 `audit.sqlite` 但**不含** `.ktx-ui/security.sqlite`，因此升级后安全库是否保留无法被现有检查观测到，而 UPG-05 / UPG-13 依赖该结论。应为保留清单补上安全库相关路径。

### 未决事项

- 验证环境的安全状态注入源，在客户现场由谁提供、以什么形式交接、存放位置与权限。
- 验证环境的只读数据源如何保证不影响生产负载（同一 warehouse 上并行跑确定性查询）。
- 结构基线清单由谁定义、版本变更时如何维护，避免每次候选升级都要重写。
- 验证环境是否允许使用 `existingClaim` 指向专用 StorageClass 的卷（当前 `intent=install` 明确禁止）。
- 本通道的报告未来是否参与放行。当前**不**参与；提升为门禁另行决定。

---

## 11. 与其他条目的关系

| 条目 | 关系 |
|---|---|
| L25-07 客户升级 E2E 自动化 | **上位**。本方案是其中「独立恢复验证」一条的细化，不改变其范围、编号体系与发布属性 |
| L25-09 审计运行时增量 | 不冲突。本通道只读取审计做连续性断言，不改审计契约；安全账本与先持久后释放语义沿用现行实现 |
| L25-10 Hive 直连 | 不冲突。本通道不引入新数据源类型 |
| L25-11 语义资产批量维护 | 不冲突。本通道不改变语义资产的生命周期与发布语义 |
| 客户 v1→2.0 升级计划 | **被依赖**。本通道消费其产出的真实备份；两条路径的产物互不覆盖 |
| 全新部署包生成计划 | **依赖**。本通道复用其 `intent=install` 入口，不复用其交付包 |
| 客户交付预检清单 | 不冲突。本通道不进入客户放行条件 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None.

说明：本方案不引入 WebUI 用户可见术语。`RVC-*` 为本方案内部用例编号，`STRUCTURE_BASELINE_PATHS` 为内部清单名，均不是产品术语，也不进入已注册测试分母。文中「验证环境」是本文档范围内的工程描述，不作为产品概念对外使用；未来若需在管理台暴露该概念，必须先在 `webui/docs/00-product-terminology-standard.md` 登记并更新本小节。

沿用既有表述：部署许可、一次性引导密钥、管理员会话、Agent Token 分别表述；Schema、Manifest、overlay、Wiki、Skill 沿用既有名称。`security.sqlite`、`admins.yaml`、`access.yaml`、`ktx.yaml` 为数据库对象名与文件名，不译。

---

## 参考入口

- [Lucy v0.25 升级建议书](2026-10-18-lucy-2.5-upgrade-proposal.md) L25-07、L25-13
- [客户升级 E2E 实施方案](2026-10-19-upgrade-e2e-implementation-plan.md) §4、§6、§8；[P1-5 Spec](../specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md)
- [P1-6 升级候选验证 Spec](../specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md)
- [客户 2.0 全新部署包生成计划](2026-10-21-customer-v2-fresh-install-package-plan.md)
- [客户 20260828-v1 到 Lucy 2.0 升级计划](2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md)
- [客户交付预检清单](../runbooks/customer-delivery-preflight-checklist.md)
- [K8s 客户原地升级手册](../../deploy/k8s/CUSTOMER-UPGRADE.md)
- [K8s 升级恢复操作](../../deploy/k8s/examples/RECOVERY.open-mode.md)
- [开发治理规则](../governance/DEVELOPMENT.md)
- [系统术语标准](../../webui/docs/00-product-terminology-standard.md)
