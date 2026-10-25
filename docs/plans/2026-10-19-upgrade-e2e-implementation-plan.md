# Lucy 客户升级 E2E 实施方案

| 元数据 | 内容 |
|---|---|
| 版本 | v0.3-spec-baseline |
| 日期 | 2026-10-19；2026-10-25 收口，Asia/Shanghai |
| 状态 | **已收口为 P1-5 Spec，需求审查通过；暂不开发，非门禁** |
| 设计基线 | [Lucy v0.25 客户升级 E2E 自动化 Spec](../specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md) |
| 生效范围 | 方案与设计记录；尚未实现升级执行器、部署矩阵或新增测试 |
| 发布属性 | **非门禁**。不作为当前 PR 合并、CI 成功或客户发版的新增前置条件 |
| 目标版本 | v0.25 需求备忘，对应 [L25-07](2026-10-18-lucy-2.5-upgrade-proposal.md#l25-07-客户升级-e2e-自动化) |
| 实施安排 | 由 Forrest 在 v0.25 后续安排，尚未启动，无具体实施期限 |
| 首期目标 | 客户实际 main 镜像升级至选定候选版本，覆盖 Docker、K3s、K8s |

本方案把“固定版本 → 兼容性预检 → 数据备份 → 旧版升级演练 → 业务验收 → 回滚演练”扩展为可重复的升级 E2E。研发负责证明产品和升级方法可用；客户负责在自己的环境执行备份、部署与业务确认。

版本分工已于 2026-10-19 确认：**v2.0 执行交付验证，v0.25 建设本方案的自动化能力。** v2.0 使用已有脚本配合人工完成客户升级演练和现场手册，仅在发现兼容性缺陷时修改程序；不要求为当前交付实现本方案。实际演练结果可作为后续自动化夹具和回归用例的输入。

**当前仅保存方案。** 新增用例、命令和证据格式均为拟议设计，不改变现有测试分母、冻结 profile、CI workflow 或发布规则。现有 H3/H4、OPS-01 和客户发布检查继续按各自现行规则运行；本方案既不新增阻断，也不豁免已有检查。未来是否接入发布门禁另行决定，完成本方案不自动使其成为门禁。

## 1 目标与边界

升级成功应同时满足：客户资产按迁移契约保留，原本应允许的业务仍可用，原本应拒绝的访问仍被拒绝，并且发生故障时有经过验证的恢复路径。

“平滑升级”指保留数据和有效凭据、执行可预期的迁移并控制中断。Lucy 当前为单实例、单副本，K8s 使用 `Recreate`；本方案记录实际停机时间，不承诺零停机，也不引入多副本共享写入。

首期只使用隔离环境和合成测试数据。故障注入、历史备份恢复、卷属主变更及回滚不得作用于现有 demo、客户生产实例或其他会话使用的环境。客户现场只执行交付包中的预检、备份、升级与验收步骤。

以下工作不属于本次落盘：构建镜像、升级服务、读取真实密钥、执行迁移、运行浏览器或真实 Agent、修改 KTX 上游源码、恢复收费 License。

## 2 现有基础与缺口

下表为 2026-10-19 的代码依据；未来实施前应重新核对，不能把方案中的代码快照当作永久事实。

| 入口 | 已有能力 | 本方案拟补充 |
|---|---|---|
| [H3/H4 脚本](../../scripts/gates/k8s-upgrade-gate.sh) | 检查升级前后 Pod imageID、哨兵文件、属主、健康与镜像回滚 | 用真实旧版资产验证业务和安全语义；证明备份可恢复 |
| [哨兵夹具](../../scripts/gates/k8s-gate-lib.sh) | 检查指定路径是否保留 | 与真实业务夹具分离，避免覆盖运行配置 |
| [升级前快照](../../scripts/upgrade/upgrade-uat-snapshot.mjs)和[升级后验证](../../scripts/upgrade/upgrade-uat-verify.mjs) | access.yaml 指纹、审计抽查、MCP 查询 | 参数化数据源和预期结果，增加授权访问管理 API 的断言 |
| [OPS-01](../../scripts/e2e/contracts/case-catalog.yaml) | 已定义升级、吊销状态、ACL、审计、重新登录和恢复用例 | 实现实际执行及前后状态测量 |
| [OPS 证据采集](../../scripts/gates/measure-evidence.mjs) | `measureOpsCases` 为 V01 调用验收；V02～V07 默认返回 `unimplemented`，支持测试注入 | 接通隔离环境的真实测量，保留证据不足与断言失败的区别 |
| [客户发布 profile](../../scripts/e2e/profiles/customer-release.yaml) | 当前限定 linux/amd64、单副本 K8s | 另建非门禁升级 profile，明确三种部署形态 |

现有 `seed_upgrade_sentinels` 会覆盖 `ktx.yaml`、`access.yaml`、`admins.yaml`，并写入合成审计文件。它适用于专用夹具，不证明真实审计库可查询或登录可用，不能原样用于客户现场预检或承载业务的测试实例。

现有 UAT 验证把管理 API 的部分 `401` 配合 SQLite 抽查作为可接受结果，新旅程中的“管理员可读取历史审计”必须先登录并得到成功响应；数据库存在记录不能代替管理功能可用。查询返回非空也不能代替结果正确。

当前分支按 [Spec 175](../../webui/docs/175-suspend-deployment-license-spec.md) 已移除部署许可；无 License 是本期兼容场景。一次性引导密钥、会话签名密钥、Agent Token 和部署许可是不同概念。

## 3 责任与交付

| 工作 | 研发与交付团队 | 客户部署人员 |
|---|---|---|
| 版本识别 | 提供镜像身份、部署文件版本和兼容范围 | 提供现场实际版本与必要环境参数 |
| 兼容性预检 | 编写预检、解释问题并提供迁移方法 | 运行现场预检并反馈结果 |
| 备份恢复 | 提供可执行方法，在测试环境验证恢复 | 执行现场备份，保管数据与密钥 |
| 升级演练 | 维护旧版夹具，执行升级与故障演练 | 有条件时在预生产环境复验 |
| 业务验收 | 提供确定性测试数据、脚本与核对清单 | 确认本客户核心业务和授权范围 |
| 故障处理 | 提供版本对应的回滚或恢复方案 | 按手册执行，必要时由交付团队协助 |

未来交付物包括已验证的镜像与配置、兼容范围说明、现场操作手册、预检与验收工具、恢复说明及一份脱敏演练报告。客户不需要自行读源码判断兼容性。

## 4 版本与部署矩阵

### 4.1 固定升级两端

“客户当前为 main”不足以形成测试基线。实施时应记录客户实际镜像引用、registry manifest digest 或离线镜像 config ID、镜像包 SHA256、可追溯的源码 SHA、Chart 或 Compose 文件版本及 KTX 版本。不同类型的 digest 分字段存储，不把 config ID 当作 registry digest。

候选版本构建一次，各场景复用同一镜像身份。保存构建时的源码和配置来源；工作区有改动时，应先形成可复现的候选源码，不能仅以 HEAD SHA 代表全部构建输入。

首期选择一个实际客户旧版本到一个候选版本。以后增加仍在支持范围内的客户版本，不以每次移动的 main 或只测最近一个版本替代兼容范围声明。

### 4.2 覆盖实际交付形态

| 形态 | 拟用环境 | 专属断言 |
|---|---|---|
| Docker | linux/amd64 隔离主机；按客户实际 Docker run 或 Compose 方式建立夹具 | 原卷或绑定目录身份、容器 UID、端口与挂载路径保留，重建后仍可写 |
| K3s | linux/amd64 独立集群或专用节点 | 离线镜像导入实际容器运行时、可调度节点镜像可用、存储与对外入口符合交付配置 |
| K8s | linux/amd64 隔离集群和独立 namespace | Helm 资源身份、selector、PVC、Secret、Ingress/TLS 与 UID 迁移 |

kind 可用于开发反馈；K3s 专属行为须在 K3s 复验。Mac arm64 的 Compose 结果仅作为开发证据，不代替 amd64 交付环境结果。

用户已确认存在 Docker 客户。仓库现行文档主要把 Compose 作为开发与验证环境；未来实施 Docker profile 时，应单独确认客户支持范围并补齐交付契约，不能仅凭本方案把 demo Compose 当作正式客户模板。

### 4.3 控制组合数量

三种部署形态各执行一条完整主旅程，再按风险增加代表性变体：已有管理员与旧开放模式、有效 ACL 与待迁移 ACL、旧内容目录与新目录、UID 0 与 UID 10001 的旧数据卷。变体应记录适用范围，不要求首期枚举全部笛卡尔积。

## 5 真实旧版夹具

通过旧版本自身支持的 WebUI、API、MCP 或正式配置入口创建资产，不向旧版文件中直接植入新版字段。旧版缺少某项能力时，记录版本能力边界，并在候选版本另建安全恢复场景，不把缺失能力伪装成已通过。

夹具应至少包含：

- 一个所有者和一个运维账户，以及旧版可验证的登录会话。
- 有效、已过期、已吊销和已停用 Agent 的 Token，权限不同的两个角色。
- 两组有确定预期结果的数据域，包含可识别的越权探针数据；检查器答案与凭据不暴露给真实 Agent。
- 可用连接、Schema Manifest、overlay、可重建索引，及仅存在于旧卷、不在新镜像模板里的资产。
- 合法 ACL 和缺少 ACL 的 Wiki/Skill；Skill 按生命周期区分已发布、草稿或停用状态。
- 通过旧版真实调用产生的审计记录及可定位的记录 ID；有效数据库不使用伪 SQLite 文件代替。
- 如果旧版具备吊销能力，先创建一个早于吊销的备份，再执行吊销并保存最新安全状态，用于验证历史恢复不会复活凭据。

每条变体预先声明迁移后的预期权限。新版本修正旧版越权行为时，应验证修正后的授权契约，不能以“升级前能访问”为理由永久保留越权能力。

## 6 备份与恢复契约

备份覆盖有效内容根、`ktx.yaml`、管理员与访问配置、`.ktx/secrets/`、`.ktx-ui/` 中的审计和安全状态、会话密钥、内容与必要索引、`.git/`，以及项目目录外注入的 Secret 引用及受控恢复来源。实际清单按版本生成，不只沿用旧脚本的静态路径列表。

SQLite 备份采用停服后复制，或经验证的在线备份方法；正确处理 WAL，不能打包一个正在变化的目录就认定备份一致。敏感备份受访问控制，报告只记备份标识、完整性结果和恢复断言，不输出密钥或完整 Token。

备份先恢复到独立卷和独立实例，验证登录、连接、确定性查询及历史审计。恢复后的测试写入不影响原实例。记录恢复点、恢复用时、数据损失窗口及所需人工步骤，具体阈值在实施时按客户维护窗口确定。

恢复旧快照时，业务数据恢复和安全状态恢复分别处理：恢复经核对的最新吊销状态、轮换会话密钥并要求重新登录。只轮换 Cookie 签名密钥不能代替 Agent Token 吊销恢复。若回滚版本不能执行当前安全约束，则保持维护状态，改用修复后的向前升级或其他受控恢复方案；不能把健康检查通过算作安全回滚成功。

## 7 用例设计与通过标准

以下 `UPG-*` 是本方案内部编号，**未加入**现有 case catalog、清单分母或任何 gate。OPS 映射仅说明未来复用关系。

| 编号 | 场景 | 实施后的通过标准 | 关联 |
|---|---|---|---|
| UPG-01 | 固定身份与预检 | 识别真实旧版和候选镜像；缺 Secret、错误卷、资源名称漂移及不兼容配置被明确报告；预检不执行迁移或改配置 | H3 前置 |
| UPG-02 | 备份可恢复 | 备份校验成功，并在独立实例恢复登录、确定性查询和历史审计 | 恢复基础 |
| UPG-03 | 真实原地升级 | 运行镜像确实切换，继续使用原数据卷；模板不覆盖客户资产 | OPS-01-V02 |
| UPG-04 | 有效业务连续 | 原有效 Token 仍能通过公共 MCP 查询，结果与独立答案一致；记录工具与内容可见性 | OPS-01-V02 |
| UPG-05 | 安全状态连续 | 吊销、过期、停用与越权请求仍被拒绝；错误是预期认证或授权拒绝，不能用 500 代替 | OPS-01-V03 |
| UPG-06 | 权限与内容迁移 | 有效角色和 ACL 按预期保留；待确认内容有明确迁移决策；跨域探针不可访问 | OPS-01-V04 |
| UPG-07 | 审计连续 | 旧记录按 ID 与关键字段可查询，新调用产生新记录；所有者登录后可通过管理 API 读取 | OPS-01-V05 |
| UPG-08 | 管理员迁移 | 原账号仍可登录；旧 Cookie 按该版本迁移契约失效；角色职责保持 | OPS-01-V06 |
| UPG-09 | 无管理员旧环境 | 原开放模式升级后进入受控引导；无或错误引导密钥被拒绝，正确引导完成后不能重复认领 | 引导兼容 |
| UPG-10 | 无部署许可 | 无 `license.yaml` 仍可运行合法业务；遗留许可变量不引入许可拒绝；Bearer 和 ACL 仍生效 | Spec 175 |
| UPG-11 | 切换前失败 | 镜像不可用或启动失败时，旧版本能按部署契约恢复；配置及卷未被重置 | H4 |
| UPG-12 | 切换后业务失败 | 候选已启动但查询或迁移失败时，按声明的镜像回退或数据恢复方案恢复业务，并重验安全性 | H4 扩展 |
| UPG-13 | 旧快照安全恢复 | 恢复早于吊销的快照后，已撤销 Token 和会话仍不可用；缺最新安全状态则保持维护状态 | OPS-01-V07 |
| UPG-14 | 中断与重试 | 在已声明迁移检查点中断后可恢复或重试，无重复身份、半写配置或误开放窗口 | 后续故障覆盖 |
| UPG-15 | 运维与重启 | 内容路径正确、目录可写、连接测试与 reindex 成功；升级后再次重启仍保持业务与吊销状态 | 部署矩阵 |
| UPG-16 | 中断时间 | 用外部探针记录最后一次旧版成功、不可用区间及新版首次业务成功；报告恢复时间 | 运维测量 |

文件不应变化时比较指纹；允许迁移时比较语义与明确的预期差异。审计行数不下降只能作为辅助检查，关键旧记录和新行为必须能核对。管理 API 返回 `401`、查询仅返回非空、页面能打开，均不能独立证明业务可用。

回滚至少区分 UPG-11 和 UPG-12。不存在的镜像测试只能覆盖切换前失败，无法证明候选写入数据后仍能恢复。不可直接降级的版本，应验证停服恢复或向前修复路径，并记录升级后新增写入如何处理。

## 核心流程（伪代码）

```text
runUpgradeScenario(baseline, candidate, deployment, variant):
  verify immutable identities and explicit version capabilities
  verify target is disposable, owned by this run, and isolated
  if isolation or required capabilities are absent:
    record BLOCKED; stop before any mutation

  install baseline using its matching deployment configuration
  seed valid assets through baseline-supported interfaces
  verify baseline business and authorization expectations
  if baseline assertions fail: record FAILED; stop

  capture metadata and exact expected migration differences
  preflight candidate compatibility without applying migration
  if compatibility is unknown: record BLOCKED; stop
  if this is a negative preflight case:
    assert expected refusal and unchanged configuration; finish case
  if preflight unexpectedly refuses: record FAILED; stop

  backup consistently and restore into a separate instance
  assert restored business and security behavior
  if restore assertions fail: record FAILED; stop before upgrade

  start external availability probe
  upgrade in place using the same candidate image identity
  apply only the variant's explicit, reviewed migration decisions
  assert UPG-03 through UPG-10 and applicable UPG-15
  if an assertion fails:
    retain failure evidence; stop ordinary business writes
    execute declared recovery path; never erase the initial failure

  for each applicable fault case on its own disposable branch:
    inject failure with a bounded recovery deadline
    recover using the declared image/data/security procedure
    assert business recovery and no revoked credential resurrection
    if safe recovery cannot be established: keep instance in maintenance

  write identities, assertions, timings, and recovery evidence
  redact evidence and release only resources owned by this run
  publish a non-gating report; do not produce release approval
```

每个故障分支从明确的夹具或备份开始，不让前一个失败污染后续结论。清理失败也记录在报告中；不能为清理方便删除不属于本次运行的卷、namespace 或 Secret。

## 8 执行器与证据设计

未来可新增 `scripts/e2e/run-upgrade.mjs`，调用现有部署与验收能力，并由 Docker、K3s、K8s 适配器实现安装、停服、备份、恢复和身份读取。路径及命令名均为拟议，当前不存在可供本方案直接执行的新入口。版本能力差异集中在适配层，避免按单个客户复制整套断言。

首期使用单独的非门禁 profile 和产物目录，例如 `inbox/upgrade-e2e/<runId>/`。不把试跑结果直接写入现有 `release-readiness.json`、`ops.json` 或签名发布包，避免被当前 collector 误认为有效发布证据。

| 产物 | 拟记录内容 |
|---|---|
| `run.json` | 旧版与候选身份、部署形态和版本、profile 摘要、实例身份及适用用例 |
| `before.json`、`after.json` | 脱敏资产清单、关键记录标识、预期迁移差异和行为结果 |
| `backup.json` | 备份方法、完整性摘要、恢复实例及恢复断言 |
| `upgrade.json` | 实际运行镜像、阶段时间、公共入口测量和逐项断言 |
| `recovery.json` | 注入点、回退策略、恢复版本、安全状态核对及遗留问题 |
| `report.md` | 各形态结果、失败与未覆盖项、停机和恢复耗时、现场操作建议 |

不得输出完整 Token、Cookie、密码、密钥或可离线利用的凭据材料；需要比较时使用检查器内部比对，公开报告仅输出结果与非敏感标识。所有证据绑定本次运行和实际实例，不拼接不同镜像或不同环境的成功片段。

结果使用 `PASSED`、`FAILED`、`BLOCKED`、`UNIMPLEMENTED`、`SKIPPED` 等清晰状态，并在未来实现中与现有状态格式适配。缺能力和缺实现不等于通过。单次重跑保留前次结果；实现后的命令应真实反映失败退出码，但作为非必需的手动任务运行，不通过隐藏错误制造全绿。

## 9 分阶段实施清单

所有任务均为待办。阶段完成表示能力已实现并经过验证，不表示新增发版前置条件。

### P0 确认契约与环境

- [ ] 确认客户实际旧镜像、部署配置、CPU 架构和版本能力。
- [ ] 定义三种部署 profile、隔离资源归属、备份清单和安全恢复策略。
- [ ] 逐项确认版本迁移的预期差异，特别是管理员、上下文 ACL 和旧内容路径。
- [ ] 选定确定性合成数据集、结果答案、维护窗口与测量方法。

完成标准：输入足以复现，不依赖客户生产库、个人路径或移动分支名。

### P1 建立最小完整旅程

- [ ] 实现公共执行器、身份校验、旧版资产创建、前后断言和独立证据输出。
- [ ] 先在一个代表环境串通预检、备份恢复、升级、查询、吊销与审计。
- [ ] 对执行器自身测试错误目标拒绝、身份不匹配、漏证据、失败与清理行为。
- [ ] 整理预检、升级、验收和恢复手册草案。

完成标准：一次运行能证明完整过程，而不是单独的脚本退出码。

### P2 覆盖客户部署矩阵

- [ ] 在 amd64 Docker、K3s、K8s 分别复验同一候选镜像。
- [ ] 补充已有管理员与旧开放模式、有效与待迁移 ACL、旧布局与卷权限变体。
- [ ] 分离 UPG-11、UPG-12，完成旧快照安全恢复和重启后复验。
- [ ] 记录各环境停机、恢复时间与人工步骤，不用一个环境的结果替代另一个。

完成标准：每种客户形态都有可复查报告，缺口明确标记而不是合并成全局通过。

### P3 加强故障与历史版本覆盖

- [ ] 按迁移检查点补充 UPG-14 中断与幂等重试。
- [ ] 扩展仍在支持范围内的历史版本和较大规模资产。
- [ ] 将工具及现场手册收敛为可交付升级包，验证客户实际操作步骤。
- [ ] 如需接入 OPS-01，单独设计字段映射、真实性校验和非门禁运行入口。

完成标准：工具可重复运行，报告与现场步骤一致。任何 required check、冻结分母或发布聚合器的修改另行安排，不在本阶段默认启用。

## 10 未来执行频率

| 场景 | 非门禁运行建议 |
|---|---|
| 普通 PR | 按影响范围选择预检或迁移快速测试，不自动运行整条升级旅程 |
| 涉及部署、认证、权限或存储 | 由维护者按需启动真实旧版升级演练 |
| 计划交付客户的新版本 | 由研发主动执行最终候选镜像的部署矩阵，供交付决策参考 |
| 客户现场升级 | 客户执行版本匹配的预检、备份、部署和业务验收；交付团队协助首批升级 |

未来若添加 CI 入口，优先独立手动 workflow，仅上传报告，不成为其他 job 的必需依赖，不新增分支保护 required check。是否提升为门禁由后续明确决定，不因自动化完成而默认转换。

## 11 待实施时确认的事项

- 客户 main 对应的真实镜像身份与配套部署文件，不能只依赖本地 main SHA。
- Docker 客户使用 Compose 还是直接 Docker run，以及正式支持的操作路径。
- K3s、K8s 的版本、存储类、镜像获取方式、TLS 与可用测试资源。
- 备份恢复和回滚的数据损失边界，以及恢复最新吊销状态的受控来源。
- 旧版本无法表达或执行新安全约束时，采用向前修复还是其他恢复路径。
- 无门禁试运行积累到何种覆盖程度后，是否值得另行讨论发布规则。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None. `UPG-*` 仅为本方案内部用例编号，不是新增产品术语或已注册测试分母。

部署许可、一次性引导密钥、管理员会话和 Agent Token 分别表述；保留 Schema、Manifest、overlay、Wiki、Skill 的既有名称。

## 参考入口

- [E2E SOP](../qa/e2e-sop.md)与[测试分层](../governance/test-layers-and-release-gates.md)。
- [Helm 升级指南](../../deploy/k8s/helm/lucy/UPGRADE.md)与[回滚指南](../../deploy/k8s/helm/lucy/ROLLBACK.md)。
- [客户交付检查](../runbooks/customer-delivery-preflight-checklist.md)与[会话恢复手册](../runbooks/webui-session-recovery-runbook.md)。
- [企业安全及真实 E2E Spec](../specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md)。

这些入口说明现有契约；本方案不修改其当前效力。
