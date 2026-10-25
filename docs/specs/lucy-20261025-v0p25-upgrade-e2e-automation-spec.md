# Lucy v0.25 客户升级 E2E 自动化 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-requirements-review |
| 日期 / 目标版本 | 2026-10-25 / v0.25 |
| 功能编号 / 优先级 | L25-07 / P1-5 |
| 状态 | **设计完成、需求审查通过（2026-10-25）；暂不开发；非门禁** |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；本轮只做设计与需求审查材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) L25-07；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 |
| 审查入口 | [P1 需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 通过；附带 F-01–F-04 实施前待办） |
| 权威上游 | [客户升级 E2E 实施方案](../plans/2026-10-19-upgrade-e2e-implementation-plan.md)；[升级候选验证 Spec](lucy-20261025-v0p25-upgrade-candidate-verification-spec.md)；H3／H4、OPS-01 与现行客户升级手册 |
| 发布属性 | **非门禁**；不改 CI、required check、case catalog、冻结分母、release evidence 或客户放行条件 |
| 实施边界 | 单实例／单副本；只改 Lucy，不改 KTX；只在隔离 linux/amd64 环境执行真实升级验证 |

本文件将“固定旧版与候选 → 预检 → 可恢复备份 → 原地升级 → 业务／授权／审计连续 → 故障恢复”收口为可实施的自动化合同。本轮未新增执行器、profile、测试、镜像或部署；UPG-01–16 全部未执行，所有实施工作包未开始。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None。`UPG-*` 仅为本 Spec 内部用例编号，不进入现有 case catalog 或测试分母。

沿用「连接」「Schema」「Manifest」「semantic overlay」「业务 Wiki」「业务 Skill」「配置审计」「运行时确认」。一次性引导密钥、管理员会话、会话签名密钥、Agent Token 与部署许可分别表述，不得混为“密钥”或“ License 状态”。文件名、数据库对象、镜像 digest、路径与 URL 的 DOM 均须 `translate="no"` + `notranslate`。

## 1. 目标与通过语义

升级成功必须同时证明：

1. 运行镜像从固定旧版切换到固定候选，原数据卷与客户资产按迁移契约保留。
2. 原本允许的核心业务仍可用且结果正确，原本拒绝的认证／授权请求仍被拒绝。
3. 历史审计可按 ID 与关键字段读取，新调用追加新记录，管理员可通过管理 API 查证。
4. 备份已在独立实例恢复成功；切换前、切换后与旧快照恢复均有可验证的安全恢复路径。
5. 停机、恢复时间、人工步骤与未覆盖项可复查，不以脚本退出码或页面可打开代替业务结论。

“平滑升级”不表示零停机。K8s 保持单副本 `Recreate`，用外部探针记录真实中断，不引入多副本共享写入。

## 2. 范围与非目标

### 2.1 首期范围

- 一个真实客户旧版本到一个固定候选版本；Docker、K3s、K8s 三种 linux/amd64 隔离形态各一条完整主旅程。
- 真实旧版资产、确定性业务数据、有效／无效凭据、角色与 ACL、历史审计、配置与秘密引用。
- 一致性备份、独立恢复、原地升级、故障分支、安全恢复、重启复验和脱敏非门禁报告。
- 代表性变体：已有管理员／旧开放模式、有效／待迁移 ACL、旧／新内容布局、UID 0／UID 10001；不枚举全部笛卡尔积。

### 2.2 非目标

- 不对 demo、客户生产或其他会话环境做故障注入、卷属主变更、回滚或迁移。
- 不把 Mac arm64 Compose 结果作为 amd64 客户交付证据，不用 kind 代替 K3s 专属复验。
- 不把 Compose  demo 自动声明为正式 Docker 客户交付模板；Docker 操作路径须按真实客户合同确认。
- 不新增发布阻断，不豁免既有 H3／H4、OPS-01 或客户检查，不自动把自动化完成解释为可发版。
- 不修改 KTX、恢复部署许可、读取或输出真实秘密，不默认新增浏览器／移动窄屏测试。

## 3. 固定输入与部署矩阵

### 3.1 两端身份

“旧版为 main”不是有效基线。每次运行必须固定：

- 旧版与候选镜像引用、registry manifest digest 或离线 config ID（分字段记录）、镜像包 SHA256。
- 可追溯源码 SHA、工作区补丁／构建输入摘要、Chart／Compose／Docker run 配置版本、KTX 版本。
- 部署形态与版本、CPU 架构、存储、UID、内容根、网络入口、资源归属与版本能力。
- 每项迁移的预期差异、独立业务答案、维护窗口、恢复点与恢复时间目标。

候选构建一次，各场景复用同一镜像身份。身份不全、工作区输入不可复现或目标不属于本次运行时，在变更前 `BLOCKED`。

### 3.2 部署形态

| 形态 | 隔离环境 | 专属断言 |
|---|---|---|
| Docker | linux/amd64 隔离主机，按客户实际 run／Compose 方式 | 原卷或绑定目录、UID、端口、挂载路径与可写性保留 |
| K3s | linux/amd64 独立集群或专用节点 | 离线镜像导入实际 runtime、节点可调度、存储与入口符合交付配置 |
| K8s | linux/amd64 隔离集群与 namespace | Helm release／selector／PVC／Secret／Ingress／TLS／UID 迁移正确 |

## 4. 真实旧版夹具与备份合同

### 4.1 旧版资产

通过旧版自身支持的 WebUI、API、MCP 或正式配置入口创建资产，不向旧文件直接植入新版字段。至少包含：

- 所有者、运维账户与旧版可验证会话。
- 有效、过期、吊销、停用 Agent 的 Token，以及权限不同的两个 Role。
- 两组有独立确定答案的数据域和越权探针；答案与凭据不暴露给被测 Agent。
- 连接、Schema Manifest、overlay、可重建索引，以及只存在于旧卷、不在新模板中的资产。
- 合法与待迁移 ACL 的 Wiki／Skill，覆盖已发布、草稿、停用状态。
- 旧版真实调用产生的审计及可定位 ID；有效数据库不使用伪 SQLite 文件替代。
- 若旧版支持吊销，保留早于吊销的备份及经核对的最新安全状态，供安全恢复分支使用。

旧版缺失能力须记录版本边界，在候选另建安全恢复场景，不伪装为旧版验证通过。新版修复旧版越权时按新安全契约断言，不为了“业务不变”保留越权。

### 4.2 备份与独立恢复

备份按版本生成清单，覆盖有效内容根、配置、秘密引用、审计与安全状态、会话密钥、必要索引、`.git/` 及受控外部恢复来源。SQLite 采用停服复制或经验证的在线备份，正确处理 WAL；热打包变化中的目录不算一致备份。

备份必须先恢复到独立卷与实例，验证登录、连接、确定性查询、历史审计与安全行为，才能开始原地升级。报告记录恢复点、恢复用时、数据损失窗口和人工步骤；敏感备份受控，公开证据只含摘要与非敏感标识。

业务数据恢复与安全状态恢复分开：旧快照恢复后须注入经核对的最新吊销状态、轮换会话密钥并要求重新登录。无法确认最新安全状态时保持维护模式；健康检查通过不等于安全恢复成功。

## 5. 核心流程（伪代码）

```text
runUpgradeScenario(baseline, candidate, deployment, variant):
  verify immutable identities and explicit version capabilities
  verify target is disposable, ownedByThisRun and isolated
  if isolation or required capabilities are absent:
    record BLOCKED; stop before any mutation

  install baseline using matching deployment configuration
  seed valid assets through baseline-supported interfaces
  verify baseline business, authorization and audit expectations
  if baseline assertions fail: record FAILED; stop

  capture metadata and exact expected migration differences
  preflight candidate compatibility without applying migration
  if compatibility unknown: record BLOCKED; stop
  if negative preflight case:
    assert expected refusal and unchanged configuration; finish case
  if preflight unexpectedly refuses: record FAILED; stop

  backup consistently and restore into a separate instance
  assert restored business and security behavior
  if restore assertions fail: record FAILED; stop before upgrade

  start external availability probe
  upgrade in place using the same candidate image identity
  apply only explicit reviewed migration decisions
  assert UPG-03..UPG-10 and applicable UPG-15
  if assertion fails:
    retain failure evidence; stop ordinary business writes
    execute declared recovery path; never erase initial failure

  for each applicable fault case on its own disposable branch:
    inject failure with bounded recovery deadline
    recover using declared image, data and security procedure
    assert business recovery and no revoked credential resurrection
    if safe recovery cannot be established: keep instance in maintenance

  write identities, assertions, timings and recovery evidence
  redact evidence and release only resources owned by this run
  publish non-gating report; do not produce release approval
```

每个故障分支从独立夹具或备份开始，不让前一失败污染后续结论。清理失败如实记录，不删除非本次运行资源。

## 6. 验收矩阵

**UPG-01–16 全部未执行。** 这些编号不加入现有 case catalog、清单分母或 gate。结果使用 `PASSED / FAILED / BLOCKED / UNIMPLEMENTED / SKIPPED`；缺环境、缺实现与缺能力均不等于通过。

| ID | 场景 | 通过标准 |
|---|---|---|
| UPG-01 | 固定身份与预检 | 两端身份可复现；缺 Secret、错误卷、资源漂移与不兼容明确报告；预检零迁移 |
| UPG-02 | 备份可恢复 | 独立实例恢复登录、确定性查询、历史审计与安全行为 |
| UPG-03 | 真实原地升级 | 运行镜像确实切换，继续原卷；模板不覆盖客户资产 |
| UPG-04 | 有效业务连续 | 有效 Token 经公共 MCP 查询，结果等于独立答案；工具与内容可见性正确 |
| UPG-05 | 安全状态连续 | 吊销、过期、停用与越权仍按预期拒绝，不用 500 代替 |
| UPG-06 | 权限与内容迁移 | Role／ACL 按预期保留或迁移；跨域探针不可访问 |
| UPG-07 | 审计连续 | 旧记录按 ID／关键字段可查，新调用追加；所有者经管理 API 成功读取 |
| UPG-08 | 管理员迁移 | 原账号按合同登录；旧 Cookie 按版本契约失效；职责保持 |
| UPG-09 | 无管理员旧环境 | 进入受控引导；无／错误引导密钥拒绝；正确认领不可重复 |
| UPG-10 | 无部署许可 | 无 `license.yaml` 仍可运行合法业务；Bearer 与 ACL 不受遗留变量影响 |
| UPG-11 | 切换前失败 | 镜像不可用或启动失败时按合同恢复旧版；配置与卷未重置 |
| UPG-12 | 切换后业务失败 | 候选已写数据后按声明路径恢复业务并重验安全；不覆盖初始失败证据 |
| UPG-13 | 旧快照安全恢复 | 已吊销 Token 与会话仍不可用；缺最新安全状态则维护模式 |
| UPG-14 | 中断与重试 | 声明检查点后可恢复或幂等重试；无重复身份、半写配置或误开放 |
| UPG-15 | 运维与重启 | 内容路径、可写性、连接测试与 reindex 正常；重启后业务与吊销状态保持 |
| UPG-16 | 中断时间 | 外部探针记录旧版最后成功、不可用区间、新版首次业务成功与恢复耗时 |

管理 API `401`、查询仅非空、数据库有行、页面可打开或审计行数不下降，均不能独立证明对应通过标准。

## 7. 执行器、产物与状态隔离

拟新增 `scripts/e2e/run-upgrade.mjs` 与 Docker／K3s／K8s 适配器；路径为设计，不表示已存在。版本差异集中在适配层，避免按客户复制断言。独立非门禁 profile 与 `inbox/upgrade-e2e/<runId>/` 产物目录不得写入 `release-readiness.json`、`ops.json` 或签名发布包。

| 产物 | 内容 |
|---|---|
| `run.json` | 两端身份、部署形态、profile、实例归属、适用用例 |
| `before.json` / `after.json` | 脱敏资产清单、记录 ID、预期迁移差异、行为结果 |
| `backup.json` | 方法、完整性、恢复点、独立恢复断言 |
| `upgrade.json` | 实际镜像、阶段时间、公共入口测量与逐项断言 |
| `recovery.json` | 注入点、回退／恢复策略、安全状态与遗留问题 |
| `report.md` | 各形态结果、未覆盖项、停机与恢复耗时、现场建议 |

公开产物不得含完整 Token、Cookie、密码、密钥或可离线利用的凭据。所有证据绑定同一 run 和实际实例，不拼接不同镜像或环境的成功片段。重跑保留前次结果，失败退出码不得隐藏；报告不产出发版批准。

## 8. 工作包与依赖

| 工作包 | 内容 | 完成边界 |
|---|---|---|
| UE-W0 合同与环境 | 固定客户旧版、候选、三种 profile、迁移差异、数据与恢复策略 | 输入可复现，无个人路径或移动分支名 |
| UE-W1 最小旅程 | 执行器、旧版资产、前后断言、独立证据与自身拒绝路径 | 一个代表环境完成全旅程，不只看脚本退出码 |
| UE-W2 部署矩阵 | amd64 Docker／K3s／K8s、代表性变体、故障与安全恢复 | 每形态独立报告，缺口不合并成全局通过 |
| UE-W3 扩展 | 中断幂等、更多历史版本、资产规模与现场手册 | 工具与手册一致；是否接门禁另行决策 |

依赖真实旧镜像与部署文件、隔离 amd64 资源、确定性只读数据源、备份与最新安全状态的受控来源。若真实客户交付证据涉及受保护 runner 或 GHCR 命名空间，须先满足现有交付链合同；本 P1 的非门禁设计不自动解除该外部依赖，也不把其状态转记为 UPG 通过或失败。

需求审查通过只确认设计，不授权开发、测试开发、真实迁移、镜像构建、部署、发布或门禁变更。
