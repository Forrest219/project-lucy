# Lucy 2.0 旧开放模式客户升级交付优化计划

| 项目 | 内容 |
|---|---|
| 日期 | 2026-10-20，Asia/Shanghai |
| 状态 | 用户已授权两轮复盘清单、r4 修正及验收；本机回归/重新出包，最终原生验收仍由部署人员执行 |
| 目标 | 旧开放模式、从未配置管理员的 Lucy，在保留客户资产的前提下升级到 2.0，通过实例专属引导密钥创建首个所有者，后续正常登录 |
| 已有基础 | 提交 `a2f5641` 的 HTTP/HTTPS 显式访问方式；现有首次认领、持久化安全库、客户实例准备及 K8s 部署脚本 |
| 用户选择 | 先生成通用客户离线包；实例信息由部署人员补充；最终原生 amd64 升级与恢复验收由部署人员在现有测试服务器执行并回传 |
| 部署范围 | linux/amd64，Kubernetes/K3s，单副本、Recreate、原 RWO PVC；保留 KTX 0.16.0 |
| 放行边界 | 本机完成实现、回归、镜像和封包；现场结果通过后才标注“客户原地升级已验收” |

## 1 已确认的问题与处理决策

1. `a2f5641` 已支持 `access: http/https`，本次在该提交上补齐残留检查和说明，不另建 HTTP 绕行机制。当前部署辅助程序的渲染阶段仍无条件要求 Ingress TLS 或 `externalTlsReviewed`，需按访问方式分支。
2. 包内认证探针只接受安全库 schema 1，实际 2.0 镜像使用 schema 2。已使用交付镜像真实建库接口在隔离临时目录复现：旧状态探测成功，建库后探测报 `SECURITY_SCHEMA_UNSUPPORTED`。
3. 通用包包含部署 helper，但缺少完整、可在包外独立实例化的工具链；现有私有 `customer-prod-a` 是占位符新安装样例，不属于本次客户，不复用其身份或密钥。
4. README 的直接 Helm 命令未配置 Bootstrap Secret，可能产生服务健康但不能创建管理员的安装。
5. Helm 成功后的认证验证失败没有完整恢复指引；Helm 回滚不恢复 PVC。现有通用回滚说明未覆盖 2.0 首次认领前后及安全状态恢复。
6. 既有单测、健康检查与 H3/H4 不能替代“实际旧镜像、包内入口、认领、登录、重启、重试、恢复”的完整验证。

## 2 交付物与客户操作

### 2.1 通用离线包

提供新批次 tar.gz 及外层 SHA256，包含：

- 新构建的 Lucy 2.0.0 linux/amd64 镜像 tar、镜像身份与镜像 tar 哈希。
- 新唯一 Chart 版本 `0.2.6`；appVersion 保持 `2.0.0`，KTX 保持 `0.16.0`。
- 独立可用的现场信息采集、实例准备、部署和验收入口及其全部依赖文件。
- HTTP、HTTPS 两种访问方式的配置示例；升级示例与新安装示例分开。
- 首次管理员说明、升级操作说明、版本对应恢复步骤和验收回传模板。
- `BUILD-INFO.json`、包内 `SHA256SUMS`、已有验证结果及现场待验项目。

通用包不含客户 Token、管理员密码、数据源密码、实例引导密钥、私有 kubeconfig 或真实客户 values。不得带入历史测试生成的 SQLite/WAL/SHM 状态文件。

### 2.2 部署人员在现场生成实例目录

正常操作分为：

1. 解压并校验通用包。
2. 显式选择 context、namespace、release、Deployment、Service、PVC 和实际 WebUI/MCP URL；运行只读采集，核对采集结果。
3. 从包内入口准备客户实例目录，配置 `intent: upgrade`，核对原管理员状态与恢复契约；需要首次认领时生成或复用实例密钥。
4. 在实例目录 dry-run，通过后执行同一部署入口。
5. 打开实际 `/login`，由指定所有者输入引导密钥并自行设置账号密码。
6. 完成管理员及业务验收，按模板回传脱敏证据。

实例目录包含 `package/`、`instance.json`、`customer-values.yaml`、`RECOVERY.md`、`scripts/deploy.sh`，需要首次认领时包含 `credentials/webui-bootstrap-token`。可引用本机已校验的公共镜像文件以避免无意义复制，但导出的可搬运目录必须自包含、重新校验，不能依赖供应方绝对路径。

现场入口使用已有 Bash/Python 3/kubectl/Helm 依赖，不能要求现场下载 Node、PyYAML、jq 或访问源码仓库。复用已有供应方 Node 准备流程的凭据和实例格式；如新增 Python 准备入口，做双向兼容测试，不建立另一套签发语义。

### 2.3 实例与密钥规则

- 引导密钥在实例化阶段生成，不能提前给通用包附一把全客户共用密钥。
- 每个逻辑实例绑定稳定 `instanceId` 与实际集群、namespace、Deployment/PVC 身份。交付批次 `deliveryId` 与实例身份分离。
- 使用至少 32 字节密码学随机材料；密钥文件格式沿用 64 位小写十六进制及末尾换行。
- 同一实例重打包、部署重试复用密钥；已有签发记录损坏或缺失时停止恢复，不重新签发掩盖问题。
- 已有管理员用 `configured/none`，不签发新密钥；从未初始化的旧实例才允许进入认领流程。
- 敏感目录 0700、文件 0600；Token 不进入输出、命令参数、说明书、values、Git 或公共制品。
- 一次性由 PVC 的持久化消费状态保证，不能依靠删 Secret 实现；清理挂载和 Secret 的顺序写入说明。

## 3 分阶段实施

| 阶段 | 改动与产物 | 完成条件 |
|---|---|---|
| A：修复状态探针 | 修复 schema 兼容契约，区分真实旧无库、受支持旧/当前库、损坏、未知版本和已消费状态 | 用实际运行时初始化的安全库回归通过；探测不创建或迁移安全库 |
| B：补齐 HTTP/HTTPS | 按 `access` 处理 URL、Cookie、TLS 检查、输出地址、示例和生成的 README | HTTP 无 TLS 配置可正常渲染；HTTPS 保留 TLS/证书检查；不通过 development 或实验室模式绕过认证 |
| C：补齐现场实例化 | 包内只读采集与准备入口；保留旧 values 和 PVC 管理方式；实例、密钥、恢复文件自包含 | 在仅有解压包和约定现场依赖的环境完成实例化，不依赖源码路径 |
| D：明确失败与恢复 | 原始 baseline、Helm revision、备份身份、阶段结果持久化；分阶段恢复与重试说明 | 升级前失败恢复旧副本；升级后失败准确记录现场状态，不误报已回滚或自动重置安全状态 |
| E：补齐验收与说明 | 首次认领、登录持久性、MCP/ACL、资产和恢复验收；包生成模板同步 | 不再提供缺少 Bootstrap 的主升级路径；所有验证标明运行环境、镜像身份及通过/待验状态 |
| F：重新构建与封包 | 干净提交、唯一 Chart、新不可变镜像 tag、通用离线包、校验和与证据 | 通过本地适用检查；最终包解压复核；未通过的现场项明确保留待验 |
| G：现场验收放行 | 部署人员在实际 amd64 K3s 执行最终候选包的升级及恢复 | 收到与最终制品身份一致的完整记录后，才标注客户升级已验收 |

### A 的实现边界

将只读探针的兼容信息与发布支持的安全库版本保持一致，可采用共享或构建生成的兼容契约。探针在旧镜像中执行时不依赖旧镜像没有的新模块。不以“任意数字版本都放行”修复问题；核验所需表、状态、完整性和版本记录一致性。保留历史无库路径，但必须显式确认旧基线。

### C 的现场预检

采集与 dry-run 检查至少覆盖：

- 集群/context、namespace UID、Deployment UID、PVC UID、Helm release/revision、真实 baseline 镜像。
- 单实例拓扑、Deployment selector、PVC 绑定与管理方式、存储规格、容器名和启动入口。
- 原 Service 端口、内容根、数据库 Secret、额外 envFrom、必要镜像拉取 Secret、访问方式与 CA。
- 管理员文件和安全库只读状态；历史不一致或损坏停止，不自动清空。
- 所有可调度节点的离线导入路径、目标架构与必要 RBAC/sudo 权限。
- 停机备份的存储位置、可用空间、恢复镜像可取得性及对应恢复步骤。

不在报告输出 Secret 内容、密码哈希或完整客户连接配置。需要保存的旧 values 和 Helm 资料作为受限恢复附件。采集本身不创建 namespace、Secret，不缩容，不升级。

### D 的恢复边界

- 升级前完成停机一致性备份，覆盖整个原 PVC，包括安全库及 SQLite sidecar、业务配置、审计和密码文件；同时保存受限的 Helm 恢复资料及所需 Secret 的安全恢复安排。
- 保存原始 baseline 与备份，不在失败重试时把候选版本误记为新的原始版本。
- 备份或预检失败且尚未开始 Helm 时，恢复原副本并报告结果。
- Helm 失败、Helm 成功但后验失败、首次认领中断、已认领后失败分别给出处理路径。先确认当前版本及实际状态，再决定重试或恢复。
- `--atomic` 只按其实际行为记录，不能表示 PVC 已回退；禁止认证失败时盲目自动覆盖数据或切回开放模式。
- 恢复采用明确的停机步骤、备份身份校验、卷内容和属主恢复、旧镜像/Helm 配置恢复及业务验证，不止提供一条 Helm rollback 命令。
- 已认领或有安全变更时，记录恢复旧快照会撤回哪些账号、撤销及业务变更；保存失败现场，核对升级后撤销状态，未完成安全状态处理前不重新开放访问。旧开放模式的回退需要明确访问边界。

## 4 核心流程（伪代码）

```text
prepareInstance(package, operatorInputs):
  verify package hashes and image/chart identity
  collect target metadata read-only using explicit context
  classify admin config and durable security state
  if corrupt, consumed-without-usable-admin, unknown schema, or identity mismatch:
    stop with recovery code; never reset ownership
  preserve old Helm values, content root, ports, Secret references and PVC ownership model
  record immutable baseline and reviewed recovery contract
  if never initialized:
    issue or reuse credential for this instance; configure bootstrap Secret reference
  else:
    preserve configured administrators; issue no credential
  emit protected instance bundle and actual HTTP/HTTPS instructions

deployInstance(bundle):
  preflight and render; dry-run ends without target mutations
  verify candidate is available on all eligible nodes
  quiesce old deployment; back up PVC and record baseline
  provision or verify instance bootstrap Secret without overwriting conflicts
  deploy candidate on the same PVC
  verify actual image, supported security schema, admin state and public access
  if post-deploy verification fails:
    record failed stage, actual runtime and recovery guidance; do not report success
  otherwise:
    report deployment ready and login/first-owner next step

acceptUpgrade():
  verify missing/wrong bootstrap key is refused
  create first owner using protected instance key and customer-chosen password
  verify logout, login, restart, repeat deployment and one-time consumption
  verify existing MCP credentials, allowed/denied queries and retained assets
  exercise the matching recovery procedure on isolated test state
  sign results against exact package hash and running image identity
```

## 5 验证矩阵

| 场景 | 必须证明 | 执行位置 |
|---|---|---|
| Schema 回归 | 历史无库、真实 schema 1/2、未知/损坏库；只读探测前后无业务状态改变 | 本机测试及候选镜像 |
| HTTP 升级 | 无管理员旧盘，显式 HTTP，无伪 TLS 标记；认领与登录会话成功 | 本地可验证部分 + 现场 amd64 K3s |
| HTTPS 升级 | TLS/CA 校验正确、Secure Cookie、登录持续有效；错误配置被拒绝 | 本地可验证部分 + 隔离 HTTPS 夹具/现场 |
| 认领负例 | 未挂载密钥、错误密钥、重复认领、已消费但无账号都按预期拒绝 | 合成夹具和候选镜像 |
| 账号持久性 | 创建、退出、重登、Pod 重建、重复部署后仍可登录，不重新认领 | 现场最终包 |
| 密钥稳定性 | 同实例重打包/重试一致，跨实例不同，冲突不覆盖，既有签发格式兼容 | 本机与实例化回归 |
| 资产保留 | ktx.yaml、内容、密码、原 MCP Token、权限配置及必要历史记录保留 | 旧盘升级前后对比 |
| 业务行为 | 实际允许查询通过、禁止查询仍拒绝，连接、索引及 MCP 正常 | 现场最终包 |
| 失败与恢复 | Secret/Helm 前后中断、后验失败、认领前后恢复、恢复后再升级 | 合成故障回归 + 现场隔离恢复演练 |
| 架构与离线 | amd64 ELF、UID 10001、完整 Python runtime、断公网 KTX 执行 | 本机适用项 + 原生 amd64 |
| 包完整性 | 仅从解压包实例化、部署与验收；导出再解压复核；无占位符假装真实绑定 | 本机包级回归 + 现场 |

内容保留比较应区分：原客户文件保持不变；新增管理员、安全库和运行日志按预期增加；派生索引允许重建。不可要求正在写入的整个 PVC 哈希完全不变。

复用现有测试、G/K/H 检查和测试报告。新增本次缺陷的必要回归及最小包级旅程，不扩大为 v2.5 全量升级 E2E 工程，不新增无关 CI required check。页面验收覆盖本次认领和登录旅程，不开展无关移动端或全站浏览器回归。

## 6 构建和发放安排

1. 保留当前用户未提交改动，不 reset、stash 或混入本次发布。必要时使用隔离工作目录，仅纳入本次批准的修复和文档。
2. 将本次发布相关变更形成可追溯提交，构建与封包使用同一干净提交，`git.dirty=false`。本地提交不等于推送或发布外部 Release。
3. 重新构建包含 `a2f5641` 的新镜像，使用新提交的不可变 tag；不覆盖旧 tag，不直接给旧镜像换标签。
4. 执行既有镜像门禁；提取 ELF 验证架构，不以元数据替代。Apple Silicon/QEMU 的失败如实记录，原生验收未完成不写成通过。
5. 从最终镜像封新批次候选包，重新导入/解压复验，生成内外校验和。离线 config ID 与 registry manifest digest 分开，后者没有则明确为空。
6. 给部署人员通用离线包及现场信息模板、实例化/部署/恢复说明、密钥领取路径、验收回传模板。密钥只存在于各实例的受控目录。
7. 部署人员在现有服务器使用最终包执行原生验收，返回包 SHA、运行镜像身份、旧/新 revision、脱敏阶段结果、持久性/业务/恢复结果。备份、密码、Cookie、Token 和客户私有配置不回传到普通报告。
8. 如代码、镜像或 Chart 再变化，生成新候选身份并重跑受影响验证；不把旧镜像结果沿用到新身份。

当前本机约有 14 GiB 可用空间。构建前评估 Docker 空间与导出/封包临时空间，优先复用缓存并减少重复镜像副本；不自动 prune、删除用户文件或现有 demo 数据。

## 7 预计改动位置

- `scripts/deploy/probe-customer-auth-state.mjs` 及必要的 schema 兼容契约和真实库回归。
- `scripts/deploy/customer-deployment-helper.py`、对应测试及现场只读采集/实例准备入口。
- `scripts/release/prepare-customer-delivery.mjs`、凭据模块及准备工具兼容性测试；根据现场 Python 入口需要整理共用格式。
- `scripts/gates/build-k8s-delivery-package.sh`、封包测试和必要验收入口。
- `deploy/k8s/helm/lucy/Chart.yaml`、HTTP/HTTPS 与 upgrade 示例及必要模板。
- 现有首次管理员 runbook、UPGRADE/ROLLBACK、包内生成 README/说明模板和验收回传模板。

本计划不改 KTX 源码，不重写现有认证架构，不改客户连接信息或业务权限配置，不操作现有客户生产服务。

## 8 当前待确认和完成定义

- 用户已在本会话明确授权修复四项审查问题、提交和重新出包，按本计划实施。
- 客户真实 context、UID、旧 values、访问地址和节点映射在部署人员实例化时补齐，不用占位符制作声称可直接升级的专属目录。
- 通用镜像可以先完成；实例密钥在真实实例信息补齐后才签发或复用。不能在实例未知时宣称已交付其专属密钥。
- 本机交接完成：实现和适用回归通过，生成可供现场完整验收的自包含候选包及说明。
- 最终目标完成：部署人员回传最终身份对应的原生升级、管理员登录持久性、业务兼容和恢复通过结果；之后才具备客户升级放行依据。若 HTTPS 分支未做实际验证，应明确适用范围，不能把 HTTP 结果当成 HTTPS 验收。
- 平滑升级指保留资产、维护窗口内可控切换、完成认证迁移且可以受控恢复；单副本 Recreate 与停机备份不承诺零停机，停机时长依实际数据量和备份速度记录。

## r4 补充：两轮事故后的修正和验收

用户在 r3 部署反馈后授权执行。固定清单见 `docs/runbooks/customer-v2-upgrade-release-checklist.md`，标准封包入口每次自动跑部署回归、身份/凭据/探测回归和最终归档实例入口回归；原生集群项目仍必须获得实测记录。

核心流程（伪代码）：

```text
解码 kubectl stdout：逐个 raw_decode，跳过文档间空白；单资源加入集合，List 展开
任意非法/空/尾部垃圾输出 → 明确错误码 → 停止，不修改集群
规范化全部资源后 → 原有名字、镜像、PVC、认证策略等契约验证
失败 → 保存阶段/类型/错误码/调用位置到实例 .diagnostics（0700/0600）
诊断不保存异常文本、源代码行、命令输出、values 或凭据
出包 → 干净提交和同提交镜像 → 镜像门禁 → 内外校验 → 最终归档解压
→ HTTP/HTTPS 重新准备 → 合成集群读取、真实 Helm/kubectl 渲染的完整入口 dry-run
→ 篡改/重算 sums/未登记文件必须拒绝 → 软件目录不变
→ 原生服务器真实 dry-run/升级/认领/业务/恢复/再升级 → 全部适用项通过才生产放行
```

Chart 模板未改变，保留 Chart 0.2.6，修复通过新的源码提交、镜像 tag、包后缀及摘要区分。原生验收待执行的包明确标记候选包，不宣称生产已放行。

## Terminology Compliance

This plan follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None. 沿用“引导密钥”“创建首个所有者”“登录账户”和“Agent Token”。
