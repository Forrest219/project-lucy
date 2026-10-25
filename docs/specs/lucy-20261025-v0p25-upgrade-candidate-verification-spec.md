# Lucy v0.25 升级候选验证 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-requirements-review |
| 日期 / 目标版本 | 2026-10-25 / v0.25 |
| 功能编号 / 优先级 | L25-13 / P1-6 |
| 状态 | **设计完成、需求审查已签核通过（2026-10-25）；暂不开发；非门禁** |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；本轮只做设计与需求审查材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) L25-13；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 |
| 审查入口 | [P1 需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 审查执行通过、PM 已签核；附带 F-01–F-04 实施前待办） |
| 权威上游 | [升级候选验证环境实施方案](../plans/2026-10-22-upgrade-candidate-verification-plan.md)；[客户升级 E2E Spec](lucy-20261025-v0p25-upgrade-e2e-automation-spec.md)；全新部署与现行恢复合同 |
| 发布属性 | **非门禁**；验证通道不是交付通道，不改 CI、冻结分母、发布聚合器或客户放行条件 |
| 实施边界 | 单实例／单副本；只改 Lucy，不改 KTX；一次性隔离实例，不切流、不承接客户流量 |

本文件将“现役实例一致性备份 → 空卷 → 整卷恢复 → 最新安全状态 → 候选启动 → 结构与连续性断言 → 清理”收口为需求审查基线。本轮未新增执行器、测试、备份、镜像或环境；RVC-01–13 全部未执行，所有实施工作包未开始。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None。`RVC-*`、`STRUCTURE_BASELINE_PATHS` 为内部工程标识，不是产品术语，不进入已注册测试分母。“验证环境”仅在本文工程语境使用；未来若进入 WebUI，须先登记术语。

沿用一次性引导密钥、管理员会话、Agent Token、配置审计、Schema、Manifest、overlay、Wiki、Skill 的既有表述。`security.sqlite`、`admins.yaml`、`access.yaml`、`ktx.yaml`、文件路径与 URL 的 DOM 均须 `translate="no"` + `notranslate`。

## 1. 通道定位与可证明边界

### 1.1 目标

在不触碰现役实例的前提下，用一致性备份在隔离环境启动固定候选镜像，证明：

- 候选对完整旧卷的迁移干净，无“新模板＋旧文件”混合态或半写配置。
- 有效业务与授权行为连续，查询结果与独立答案一致，越权探针仍被拒绝。
- 历史审计按 ID 与关键字段可读，新调用追加新记录。
- 结构、业务、授权、审计、会话与清理结论可复查，报告不产生发布放行证据。

### 1.2 与原地升级的关系

| 问题 | 原地升级 | 本验证通道 |
|---|---|---|
| 候选对旧卷的迁移正确性 | 直接证明 | 在相同迁移路径下提供隔离证据 |
| 业务、授权与审计连续 | 可证明 | 可证明 |
| **安全状态不回滚（吊销不回滚）** | **唯一可证明路径** | **不能证明**；恢复的是备份时点卷 |
| 客户接入零改动 | 可证明 | 不适用，不承接流量 |
| 真实拓扑与维护窗口 | 可证明 | 不适用，隔离环境 |

本通道不能替代客户现场原地升级，也不能把“注入最新安全状态后断言通过”写成“吊销不回滚已证明”。后者只能由不换卷的原地升级证明。

### 1.3 非目标

- 不切流，不改客户 Service／Ingress／DNS，不作为交付包或客户部署形态。
- 不做断代升级的字段级资产迁移，不引入多副本或共享可写卷。
- 不复用、打印或轮换客户实例的一次性引导密钥，不复制生产会话密钥或 `ktx-internal-token`。
- 不写 `release-readiness.json`、`ops.json` 或签名发布包，不改变任何 gate。
- 不在 Mac 上把 `productionReady` 类字段设为 true，不默认新增浏览器／移动窄屏测试。

## 2. 已锁定设计裁决

| 编号 | 裁决 | 失败处理 |
|---|---|---|
| R-D1 | 验证通道只产报告，不是交付通道 | 不写发布证据，不切流 |
| R-D2 | 必须空卷起步，先整卷覆盖，再启动候选 | 非空卷或先 seed 为 `FAILED`，停止启动 |
| R-D3 | 含 `.ktx-ui/security.sqlite` 时只接受 quiesced 备份 | 热备或方法不明为 `BLOCKED`，不得继续安全断言 |
| R-D4 | 业务整卷与最新安全状态分层恢复 | 来源／新鲜度不明时安全断言 `SKIPPED`，不得 `PASSED` |
| R-D5 | 验证环境使用新实例身份与密钥 | 不复用生产引导、会话或内部 Token |
| R-D6 | 资源独立、客户网络不可达、数据源只读 | 隔离或归属不满足即 `BLOCKED`，变更前停止 |
| R-D7 | 结构基线是硬断言 | 混合态为 `FAILED`，不得降级为警告 |
| R-D8 | 每次重放使用新的空卷与一次性环境 | 不在已启动卷上重跑恢复冒充幂等 |

## 3. 备份、安全状态与实例身份

### 3.1 一致性备份

备份须校验 SHA256、文件清单、恢复点与方法。含安全库时，`security.sqlite` 为 WAL 数据库，只接受停写／停服后的 quiesced 整卷备份或经验证的一致性方法；运行中热拷可能丢已提交吊销事务，直接构成安全拒绝条件。

无安全库的旧版本只表示该基线不存在对应吊销回退面，不表示候选升级后的安全状态已经验证。含安全库但备份方法不满足时，不得通过“跳过安全用例”继续宣称整体验证通过。

### 3.2 最新安全状态注入

恢复分两层：

1. 整卷恢复业务数据、旧授权配置与备份时点安全库。
2. 从独立受控来源注入经核对的最新吊销／会话安全状态，再轮换验证环境会话密钥并要求重新登录。

报告记录安全状态来源标识、恢复点、新鲜度与确认者，不记录可利用内容。只轮换 Cookie 签名密钥不等于恢复 Agent Token 吊销。无法确认最新来源时，可继续明确的迁移正确性检查，但安全相关断言必须 `SKIPPED` 并说明，报告不得给全局安全通过结论。

### 3.3 新实例身份

验证环境使用新 `instanceId`、namespace／compose project、PVC、release、Service、一次性引导密钥、会话密钥与内部 Token。入口不得暴露到客户可达网络；外部数据源只读，所有写入只落本次环境卷。

`intent=install` 是环境构造依赖：其失败关闭、安装样例与说明必须在实施前按当时代码重新核验。历史 Plan 中的“待做”只是当时快照，不作为当前事实；若实际合同不满足空卷、独立资源与失败关闭要求，本通道 `BLOCKED`，不得自造宽松安装路径。

## 4. 执行顺序与结构基线

### 4.1 唯一合法导入顺序

```text
创建空卷
  → 断言文件数为 0 且未启用 LUCY_ENTRYPOINT_SEED_ONLY
  → 整卷覆盖备份并核对清单
  → 注入最新安全状态、轮换验证环境会话密钥
  → 启动固定候选镜像
  → 结构基线断言
  → 业务／授权／审计／会话断言
  → 脱敏报告与资源清理
```

禁止先让候选 seed 再覆盖旧备份。候选的 missing-only 迁移只有面对完整旧卷才与生产路径等价；先 seed 会形成无明确版本基线的混合态，即使健康检查通过也不算成功。

### 4.2 结构基线

`STRUCTURE_BASELINE_PATHS` 与候选声明的 `structuralChangePaths` 必须版本化并随候选身份固定。逐项比较路径存在性、类型与语义指纹：

- 不应变化的客户资产保持备份语义与预期指纹。
- 候选声明新增的结构确实存在，旧版不应存在的残留不得冒充迁移完成。
- 允许迁移的路径按明确预期差异断言，不用“文件有变化”替代正确性。
- 任一混合态、半写配置或未知结构均为 `FAILED`，保留现场证据后进入清理，不继续普通业务写入。

## 5. 核心流程（伪代码）

```text
runCandidateVerification(baseline, candidate, deployment, backup, securitySource):
  require candidate.imageIdentity.verified
  require baseline.instanceId and deployment.isolated and deployment.ownedByThisRun
  require not deployment.ingressReachableFromCustomerNetwork
  if any missing: record BLOCKED; stop before mutation

  require backup.sha256Verified and backup.fileManifestVerified
  hasSecurityStore = backup.contains(".ktx-ui/security.sqlite")
  if hasSecurityStore and backup.method != "quiesced":
    record BLOCKED("SECURITY_STORE_REQUIRES_QUIESCED_BACKUP"); stop

  env = createIsolatedEnvironmentWithEmptyVolume()
  require fileCount(env.volume) == 0
  require env.seedOnly != true
  restoreWholeVolume(backup, env.volume)
  assert restored manifest and key paths match backup

  if securitySource is verified and fresh:
    applyLatestSecurityState(env, securitySource)
    securityAssertionsEnabled = true
  else:
    record reason; securityAssertionsEnabled = false
  rotateSessionSecret(env)
  startCandidate(env, candidate)
  waitHealthy(env, deadline)

  assertStructureBaselineOrFail(env, candidate)
  if failed: retain evidence; goto teardown
  run business, authorization, audit and cross-domain assertions
  if securityAssertionsEnabled: run latest-security and session assertions
  else: mark security assertions SKIPPED; never claim revocation non-rollback

  replay = createSecondIsolatedEnvironmentWithEmptyVolume()
  repeat same restore and assertions on replay
  assert equivalent conclusions and no duplicate identity or half-written config

teardown:
  destroy only run-owned volumes, namespaces, Secrets and temporary copies
  if cleanup incomplete: record BLOCKED with residual inventory
  write redacted report; do not write release-readiness, ops or signed bundle
```

健康检查失败、结构失败、业务失败与安全断言缺失分别记录，不合并为一个“启动失败”。任一失败不得被后续重跑或清理成功覆盖。

## 6. 验收矩阵

**RVC-01–13 全部未执行。** 编号不进入 `case-catalog.yaml`，不改分母或冻结 profile。状态使用 `PASSED / FAILED / BLOCKED / UNIMPLEMENTED / SKIPPED`；缺能力与缺实现不等于通过。

| ID | 场景 | 通过标准 |
|---|---|---|
| RVC-01 | 备份一致性 | SHA256 与清单通过；含安全库时为 quiesced，否则 `BLOCKED` |
| RVC-02 | 隔离与归属 | namespace／PVC／Service 独立，客户网络不可达，资源归本次运行 |
| RVC-03 | 空卷起步 | 覆盖前文件数 0，未启用 seed-only；任一不满足 `FAILED` |
| RVC-04 | 整卷覆盖完整 | 文件清单与备份一致；配置、秘密引用与 `.ktx-ui/` 关键路径符合版本清单 |
| RVC-05 | 结构无混合态 | 基线逐项符合候选预期，结构变更确实生效；失败不得降级警告 |
| RVC-06 | 业务查询一致 | 有效凭据经公共 MCP 查询，结果与独立答案一致，不只断言非空 |
| RVC-07 | 授权允许路径 | 授权范围内调用按预期允许，工具与内容可见性一致 |
| RVC-08 | 授权拒绝路径 | 越权探针为预期认证／授权拒绝，不用 500 代替 |
| RVC-09 | 审计连续 | 历史 ID／关键字段可读，新调用追加；行数不下降仅辅助 |
| RVC-10 | 会话与最新安全状态 | 轮换后旧会话失效、新登录可用；已核对最新吊销状态生效；不声称证明原地不回滚 |
| RVC-11 | 跨域探针 | 跨域与未授权对象不可访问 |
| RVC-12 | 独立重放 | 同一备份在两个新空卷环境重放，结论一致，无重复身份或半写配置 |
| RVC-13 | 清理完整 | 卷、namespace、Secret、临时副本销毁；残留与清理失败如实记录 |

管理 API `401`、页面可打开、健康检查通过或查询仅非空均不能独立证明业务或安全通过。

## 7. 产物与证据

产物拟落 `inbox/upgrade-candidate/<runId>/`，正式证据须按保留规则受控封存。

| 产物 | 内容 |
|---|---|
| `run.json` | 基线与候选身份、部署形态、实例身份、安全库存在性、适用 RVC |
| `backup.json` | 方法、SHA256、quiesced、文件数、恢复点、安全状态来源与新鲜度 |
| `restore.json` | 覆盖前后清单、结构基线、结构变更、独立重放结论 |
| `assertions.json` | 逐项期望、实际、状态与失败原因 |
| `report.md` | 结果、未覆盖项、耗时、清理结论与现场建议 |

不得输出完整 Token、Cookie、密码、密钥、keytab 或可离线利用的凭据。安全状态注入源只记录标识与新鲜度。证据不得拼接不同候选、备份或环境，不写发布聚合文件。

## 8. 工作包与依赖

| 工作包 | 内容 | 完成边界 |
|---|---|---|
| RV-W0 合同 | 备份／quiesced 判定、结构基线、安全来源、隔离与现有断言映射 | 输入可复现，拒绝路径明确 |
| RV-W1 最小旅程 | 恢复执行器、两实例断言参数化、非空卷／热备／非归属拒绝 | 一次运行证明完整过程并产出全部脱敏产物 |
| RV-W2 部署矩阵 | linux/amd64 K8s／K3s／Docker、UID／内容布局／有无安全库变体 | 每形态独立报告，不互相替代 |
| RV-W3 真实产物 | 接入受控真实备份与 v2→v2.x 安全库分支 | 复现行为差异，秘密不进入报告 |

依赖：合格的 `intent=install`、固定候选与真实备份、隔离只读数据源、最新安全状态的受控提供者、结构基线维护责任。`existingClaim` 是否允许仅可按实际安装合同裁决，不得为省事绕过干净环境定义。

Compose 备份一致性与安全库保留检查的既有缺口，在实施前按当时代码重新核验；如仍存在，应先修复或在适用场景 `BLOCKED`，不得用未观测冒充已保留。

需求审查通过只确认设计，不授权开发、测试开发、真实备份读取、镜像构建、部署、发布或门禁变更。
