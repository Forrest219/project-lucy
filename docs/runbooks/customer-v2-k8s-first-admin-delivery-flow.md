# Lucy v2.0 K8s 与 K3s 客户交付及首次管理员流程

| 元数据 | 内容 |
|---|---|
| 文档类型 | v2.0 客户流程与交付包要求 |
| 版本 | v0.3 |
| 日期 | 2026-10-19，Asia/Shanghai |
| 客户范围 | K8s / K3s 新安装，及原来无管理员、以开放模式使用的客户升级 |
| 当前状态 | **脚本已实现、本地检查通过；实际集群与客户升级待交付人验证** |
| 关联构建入口 | [客户 amd64 镜像构建清单](customer-amd64-image-build-checklist.md) |
| 脚本计划 | [引导密钥生成与部署配置脚本计划](../plans/2026-10-19-v2-bootstrap-delivery-scripts-plan.md)，含验证结果与现场待测矩阵 |

## 1 客户只需完成两步

供应方提供与客户环境匹配的安装或升级包，以及该客户实例专用的**一次性引导密钥**。安装包负责配置密钥，客户在页面上使用密钥确认自己有权创建首个管理员。

1. **执行包内的部署入口。** 按交付说明选择 K8s 或 K3s 安装或升级，完成后取得 WebUI 的 HTTPS 地址。正常路径不要求客户手工创建 Secret、填写环境变量或修改管理员 YAML。
2. **打开页面创建管理员。** 访问 WebUI 的 `/login`，在“创建首个所有者”页面输入供应方提供的引导密钥，设置账户名和密码。成功后进入系统，后续使用账户和密码登录。

账户名为 2–32 位，以小写字母开头，允许小写字母、数字、下划线和连字符；密码至少 10 个字符，显示名可选。客户自行设置密码，供应方不提供全客户共用的初始管理员密码。

本流程中的密钥仅用于首次初始化，**不是 License、管理员密码或 Agent Token**。当前版本无需部署许可。已有管理员的实例升级后直接登录，不再次创建首个所有者。

## 2 当前能力与验证边界

| 部分 | 当前实现 | 交付动作 |
|---|---|---|
| 首次管理员页面 | 已有“创建首个所有者”和引导密钥输入框 | 使用该页面完成初始化，无需新增管理页面 |
| 后端创建 | 已有密钥校验、密码哈希、账号写入和引导消费状态 | 保留现有安全流程，不通过开放模式绕过 |
| Helm 挂载 | 已支持 `bootstrap.existingSecret` | 出包时为客户准备对应 Secret 引用 |
| 客户一键配置 | 已实现供应方准备入口、实例凭据记录、Secret 创建核对与部署入口，已接入通用封包 | 本地检查通过；实际 amd64 K8s / K3s 两步流程仍待交付人演练 |

仅构建镜像或填写本文件，不能视为安装包已经具备上述两步体验。当前 Chart 的 `bootstrap.existingSecret` 默认为空；不配置时服务可以启动，但首次创建管理员返回 `503 BOOTSTRAP_NOT_PROVISIONED`。

脚本实现沿用既有镜像与部署检查，不新增 CI 或发布门禁。用户已选择自行执行实际集群和客户升级测试，下文未勾选项目保留为待验证。

## 3 供应方准备镜像与客户专属包

### 3.1 构建通用镜像

按[镜像构建清单](customer-amd64-image-build-checklist.md)构建并验证最终 `linux/amd64` 镜像，再按现有路径组装 K8s / K3s 安装包。引导密钥不写入镜像、Dockerfile、通用模板或公共发布资产。同一个已验证镜像可服务多个客户，各实例密钥独立。

本文件的 v2.0 表示交付迭代；镜像产品版本仍从仓库 `VERSION` 和实际构建元数据获取，不因文档名称手工改写为 `2.0.0`。自 2026-10-19 批准起，仓库 `VERSION` 为 `2.0.0`。

### 3.2 准备实例身份与引导密钥

由供应方客户专属包准备脚本，为首次初始化的每个新实例自动生成至少 32 字节随机材料，并编码为便于交付的文本。保存到稳定的实例凭据记录和客户专属交付目录的受限文件，由部署入口读取；同一个值通过受控渠道提供给指定所有者，用于页面输入。同一实例重打包或重试复用原密钥，已有管理员升级不生成新密钥。不要复用其他客户、测试或 demo 的密钥；正常流程无需人工生成。

客户专属凭据附件与公共软件包分开管理，交付人员负责在发送前配齐并校验二者属于同一实例。客户正常操作无需重新生成、手工粘贴到 values 或临时执行 `kubectl create secret`。凭据不进入 Git、公共 Release、日志、截图或构建产物缓存；本地文件权限限制为 `0600`，不打印内容。

已有管理员的升级不要求重新签发引导密钥。若旧部署仍引用引导 Secret，应保留该资源或先受控更新挂载配置，不能只删除 Secret 使 Pod 无法重启。

### 3.3 自动配置安装包

已实现的交付入口承担以下职责，执行方法见第 8 节：

- 记录客户 namespace、Helm release、Deployment、PVC 与 Secret 名称，避免名称漂移新建第二套实例。
- 识别新安装、旧开放模式升级、已有管理员升级及异常恢复状态。
- 对需要首次初始化的实例，从受限文件创建或核对客户 namespace 内的引导 Secret，键名为 `token`。
- 在客户部署 values 中写入 `bootstrap.existingSecret` 的资源名，不写入密钥值。此配置不同于数据库密码使用的顶层 `existingSecret`。
- 通过现有 Chart 只读挂载至 `/run/secrets/lucy-bootstrap/token`，并设置 `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE`；运行用户 UID `10001` 应可读取该文件。
- 按客户类型加载或拉取指定镜像。K3s 离线包导入实际 containerd 运行时；多节点环境处理全部可调度节点。
- 在实例配置里显式选择访问方式：`access: https` 使用 Secure Cookie；`access: http` 是内网 HTTP 客户访问方式，会话 Cookie 不带 Secure。两条地址的协议必须和 `access` 一致。实验室的 `insecureHttpTestProfile` 不能当作客户访问方式。

values 中的配置形态如下，示例仅含资源名：

```yaml
bootstrap:
  existingSecret: lucy-bootstrap
```

密钥文件缺失、不可读、配置不匹配或 Secret 资源归属冲突时，部署入口应明确报告，避免升级后让客户在页面上反复输入无效密钥。重试使用原实例配置，不静默轮换密钥或覆盖其他实例的 Secret。

实际入口为客户专属包根目录下的 `scripts/deploy.sh`。通用包中的同名文件需要专属包提供实例描述和凭据，不能直接当作无配置安装命令。

## 4 旧开放模式客户的升级安排

供应方在交付前确认客户实际旧镜像及配置，验证“没有管理员、从未完成首次引导”这一状态。无管理员不等于可以任意重新认领：配置损坏、管理员全部停用、首次引导已消费但账号丢失等情况按维护恢复流程处理，不自动重置。

升级前备份并保留原 PVC、配置目录、连接密码、访问配置、Agent Token、审计、安全状态和业务内容。针对旧内容布局保留有效的内容根设置，不以新模板覆盖客户资产，也不清空数据卷。

在升级切换时一并配置引导 Secret。服务启动后，客户执行第 1 节的页面步骤。创建管理员只建立 WebUI 登录身份，不替客户重新签发所有 Agent Token，也不代表数据权限已验收；已有 Agent 的认证、权限和业务查询仍需单独验证。

单副本 `Recreate` 存在维护窗口，应在交付前说明预计中断。出现无法登录或业务不兼容时，按与版本匹配的恢复方法处理，不用清空 `admins.yaml`、删除 `security.sqlite` 或切回开放模式作为正常升级步骤。

## 核心流程（伪代码）

```text
prepareCustomerDelivery(target):
  verify tested image identity, deployment names, persistence and HTTPS
  classify administrator and bootstrap state without exposing credentials
  if configuration is unreadable or recovery state is inconsistent:
    stop with maintenance instructions; do not reset ownership
  backup old installation when upgrading
  if target has never been initialized:
    provision or verify its dedicated bootstrap Secret from the protected file
    reference the Secret through bootstrap.existingSecret
  else:
    preserve existing administrators, security state and required Secret references
  install or upgrade using the existing PVC when applicable
  wait for readiness and return HTTPS WebUI address

firstOwnerCreation():
  customer opens /login
  if an administrator is already configured: show normal login
  otherwise:
    customer submits bootstrap key, account and password
    backend verifies security state and bootstrap key
    backend persists owner with password hash and consumes bootstrap state
    backend establishes a login session
  subsequent logins and upgrades use the existing account and durable state
```

## 5 交付前人工验证清单

下面是 v2.0 本次交付流程的核对项，不表示新增升级 E2E 自动化已经实现或已经纳入门禁。由供应方在隔离的同类部署环境执行并保存结果。

- [ ] 使用最终交付镜像、客户匹配的 Chart / values 和包内实际部署入口完成演练。
- [ ] K8s / K3s 按本次实际交付形态分别验证；部署能自动配置引导 Secret，客户无需手工改配置。
- [ ] 原开放模式夹具升级后显示“创建首个所有者”；原数据和有效 Agent Token 保留。
- [ ] 无密钥、错误密钥不能创建管理员；指定密钥与合法账户密码能成功创建且进入系统。
- [ ] 退出后能使用账户密码重新登录；重启服务后仍能登录，不重新出现首次认领窗口。
- [ ] 初始化完成后，重复创建首个所有者被拒绝；直接无认证访问受保护管理 API 被拒绝。
- [ ] 原核心查询、权限拒绝、Wiki/Skill 访问和历史审计按迁移预期工作。
- [ ] 包内说明包含访问地址、指定密钥的领取方式、错误联系入口和已验证的恢复办法，报告不含凭据。

脚本接线与本地检查已完成，上述现场项全部保留待验证。交付人应保存最终镜像对应的实际结果，不能把模块测试计为客户验收。

## 6 日常使用与异常处理

创建成功后，管理员账号及初始化状态保存在持久化数据中。后续重启或升级保留原卷后直接登录，不再次输入引导密钥。一次性指引导被消费，不表示 Secret 文件自动删除。

| 现象 | 处理 |
|---|---|
| `BOOTSTRAP_NOT_PROVISIONED` | 供应方检查包内 Secret 配置、挂载路径及文件可读性，客户不需要自行生成另一把密钥 |
| `BOOTSTRAP_TOKEN_INVALID` | 核对是否使用该客户实例的密钥，以及交付配置和页面输入是否对应 |
| `ADMINS_ALREADY_CONFIGURED` | 已有管理员，使用正常登录 |
| `BOOTSTRAP_CONSUMED`，但无法找到可用管理员 | 按受控恢复流程处理，不清空安全状态重开认领 |
| 管理员配置或认证状态不可用 | 检查持久卷、配置与安全存储；服务健康不等于认证可用 |
| 创建后无法保持登录 | 检查 HTTPS 与 Cookie 配置，再检查会话存储；账号可能已创建，不重复执行认领 |

默认保留引导 Secret 及现有挂载引用。以后若清理，应先更新部署配置解除引用，再删除 Secret；不改变已消费的引导状态。重置管理员密码走正式账户管理或受控恢复流程，不重新发引导密钥代替恢复。

## 7 与 v2.5 的分工

v2.0 完成客户两步流程的交付脚本和配置接线，并用现有工具配合人工验证。后端若无兼容性缺陷，不为此改写认证逻辑。

v2.5 的完整升级 E2E 自动化另见 [L25-07](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md#l25-07-客户升级-e2e-自动化)及[实施方案](../plans/2026-10-19-upgrade-e2e-implementation-plan.md)，保持待落地、非门禁。首次管理员这条旅程未来可成为其回归场景。

## 8 执行入口与测试交接

### 8.1 供应方准备

先按[构建清单](customer-amd64-image-build-checklist.md)生成匹配的通用软件包，并解压。准备脚本接收**解压目录**，不直接接收 tar.gz。目录必须包含 `BUILD-INFO.json`、完整 `SHA256SUMS`、Chart、镜像及新增部署脚本；历史发布包缺少这些入口时，应重新使用当前封包脚本生成通用包，不能直接往旧包塞文件后沿用旧校验和。

供应方需要 Node.js 22+。实例配置可从[新安装样例](../../deploy/k8s/customer-delivery.instance.example.json)复制，填写真实资源名、context、HTTPS 地址及节点映射。凭据状态与专属输出放在 Git、构建 context 和缓存之外；以下路径仅为操作示例：

```bash
mkdir -p "$HOME/private-lucy-delivery/config" "$HOME/private-lucy-delivery/outputs"
chmod 700 "$HOME/private-lucy-delivery" "$HOME/private-lucy-delivery/config" "$HOME/private-lucy-delivery/outputs"
cp deploy/k8s/customer-delivery.instance.example.json "$HOME/private-lucy-delivery/config/customer-prod-a.json"
# 编辑该 JSON，填入已核对的现场信息，然后执行：
node scripts/release/prepare-customer-delivery.mjs \
  --base-package /absolute/path/to/extracted-base-package \
  --instance-config "$HOME/private-lucy-delivery/config/customer-prod-a.json" \
  --state-dir "$HOME/private-lucy-delivery/state" \
  --output "$HOME/private-lucy-delivery/outputs/customer-prod-a-v2" \
  --dry-run
```

核对 dry-run 后，用同一组参数去掉 `--dry-run` 执行。输出目录必须不存在；重打包换一个输出目录，保留原 `instanceId` 和 `state-dir`。程序只输出标识与路径，不输出密钥。密钥文件为输出目录中的 `credentials/webui-bootstrap-token`，由交付人通过受控渠道提供给指定所有者；客户执行部署时脚本自动读取同一附件。

首次签发配置为 `authState: uninitialized`、`credentialState: new`。签发后保存输出中的 `credentialState: issued`，后续重打包使用该状态；持久备份整个状态目录及实例登记，不能在状态丢失后改回 `new`。本期无集中签发服务，若连状态与实例登记都丢失，程序无法凭空识别历史签发，必须人工恢复记录。

### 8.2 旧客户升级配置

升级配置沿用原 `instanceId`、namespace、release、Deployment、Service、PVC 和引导 Secret。不要套用新装样例覆盖旧 values。配置至少增加以下字段，示例值必须替换为现场核对结果：

```json
{
  "intent": "upgrade",
  "authState": "uninitialized",
  "credentialState": "new",
  "namespaceUid": "ACTUAL_NAMESPACE_UID",
  "deploymentUid": "ACTUAL_DEPLOYMENT_UID",
  "pvcUid": "ACTUAL_PVC_UID",
  "baselineImage": "project-lucy:customer-amd64-0.17.0-20261008-e08de17",
  "legacyBaselineReviewed": true,
  "backup": { "method": "quiesced-pvc-tar" },
  "recovery": {
    "baselineImage": "project-lucy:customer-amd64-0.17.0-20261008-e08de17",
    "instructionsFile": "customer-prod-a-recovery.md"
  }
}
```

这是补充字段片段，仍需保留样例中的其余必填项。`credentialState: new` 仅适用于该实例从未签发引导密钥；已签发用 `issued`。已有管理员用 `authState: configured`、`credentialState: none`，不配新密钥附件。`legacyBaselineReviewed` 仅在确认该旧版允许无安全库的历史布局后设置，不能用来绕过损坏或未知状态。

上述旧镜像来自交付仓库发布说明，**不证明现场一定运行该版本**。可用显式 context 查询 namespace、Deployment、PVC 的 UID 与当前镜像，禁止用 `main` 代替固定基线。升级时程序读取完整旧 Helm values，仅更新约定字段，保留原 PVC 的 Helm 管理方式；发现资源或存储规格漂移会停止。

恢复说明路径相对实例配置文件，准备时复制为 `RECOVERY.md` 并校验哈希。该文件需由交付人写入已演练的旧镜像获取、停机、PVC 内容恢复、权限恢复、账号与撤销状态检查方法。脚本只实现停机只读打包备份和基础完整性检查，不提供通用数据恢复引擎；不能用一份未验证的空泛说明代表已具备恢复能力。

### 8.3 现场执行条件与入口

现场预装 Bash、Python 3、kubectl、Helm，配置可用 kubeconfig 且当前 context 与 `instance.json` 一致；不在脚本里切换全局 context。目标节点为 Ready 的 linux/amd64，持久卷和现有 Secret 已可用。首次初始化需读取、创建 Secret 权限；升级还需读取旧 Pod、缩放 Deployment、创建和删除备份 Pod 等权限。

离线包的 `offlineNodes` 覆盖所有可能调度到的节点：值为 `local` 或已配好免交互登录的 SSH 目标。K3s 使用 `sudo -n k3s ctr images import -`，普通 K8s 使用 `sudo -n ctr -n k8s.io images import -`；需预先满足 sudo 与 containerd 条件。其他 CRI 或导入方式需适配，不能假定自动支持。Registry 模式使用已发布 manifest digest 和现场拉取凭据。

WebUI 需通过实际 HTTPS 地址访问；Ingress TLS Secret 提前配置，或由交付人确认外部 TLS 网关后设置 `externalTlsReviewed: true`。该标记不会创建证书或网关。私有 CA 可通过 `tlsCaFile` 配套，程序仍校验 HTTPS 证书；现有数据库与拉取 Secret 等也不会由本脚本凭空生成。

在客户专属目录执行：

```bash
bash scripts/deploy.sh --dry-run
bash scripts/deploy.sh
```

dry-run 读取集群并渲染检查，不创建 Secret、不运行 Helm 升级、不写部署记录；Helm 渲染使用受限临时文件并在退出时清理。正常部署输出 HTTPS `/login` 地址，客户输入配套密钥并创建首个所有者。已有管理员直接登录。

部署成功只表示脚本的就绪检查通过，**不等于账号创建和业务验收完成**。部署阶段及备份哈希记录在专属目录 `.deployment/result-*.json`，升级备份为 `.deployment/backup-*.tgz`；备份包含客户数据，按敏感文件保存，不上传普通构建 artifact。目录中的 `.deployment-binding.json` 绑定集群与 namespace 身份，重试保留该文件，不把同一专属目录用于另一集群。

### 8.4 你后续执行的测试清单

以下全部标记**待测试**。新装与两类升级应分别使用隔离实例，保留原始夹具；K8s 与 K3s 分别记录，不能互相替代。

| 场景 | 执行动作 | 验收结果 |
|---|---|---|
| BS-11 / BS-19 新装 | 用最终包执行 dry-run、部署及再次执行；检查报告、Pod 实际镜像、挂载、HTTPS | 单副本 Recreate；镜像匹配；密钥可读；页面等待首次创建；重试不换 Secret |
| BS-12 / BS-13 首次所有者 | 无密钥、错误密钥、正确密钥分别提交；成功后退出、重启、重登、再次认领 | 前两者拒绝，正确值创建 owner；账号持久，重复认领被拒绝 |
| BS-14 旧开放模式 | 从实际固定旧镜像及脱敏数据夹具原地升级，随后创建 owner | 原 PVC、数据、有效 Token、权限拒绝及历史审计保留 |
| BS-15 已有管理员 | 使用 configured / none 的专属包升级，保留现有 Secret 引用 | 不生成新密钥、不重开认领；原账号能登录 |
| BS-16 中断重试 | 在测试实例的 Secret 创建后、Helm 前后中断；保留目录和现场后重试 | 同一密钥复用、无 PVC 删除；不覆盖冲突 Secret；无法安全继续则明确维护恢复 |
| BS-20 恢复 | 使用该版本 `RECOVERY.md` 和停机备份进行恢复演练，再检查业务和安全状态 | 业务恢复、账号可用，已撤销 Token 或安全状态不复活 |

首次安装不使用 Helm `--atomic`，避免失败自动卸载新 PVC；失败资源保留供检查。已建立实例升级使用 `--atomic`，但 Helm 回滚**不恢复卷内容**。失败安装若未留下可探测的运行 Pod、只留下部分资源，脚本会停止，需按报告核对和受控恢复，不承诺任何中断都能自动续跑。不要用 `helm uninstall`、删 PVC、清空管理员或重发密钥解决失败。

测试记录至少保存场景编号、环境版本、旧/新镜像身份、开始/结束时间、PASS/FAIL、脱敏错误、备份哈希、恢复结果和遗留项。程序日志不含密钥，浏览器测试也不要截图或录制密码、密钥、Cookie。全部现场结果当前仍为待验证；v2.5 完整升级 E2E 继续保持待落地、非门禁。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None. 沿用“引导密钥”“创建首个所有者”“登录账户”和“Agent Token”；不把首次引导称为 License 激活。

## 代码与交付参考

- [首次管理员页面](../../webui/src/pages/Login.tsx)、[密钥校验](../../webui/server/auth/bootstrap-token.ts)、[创建与消费状态](../../webui/server/auth/bootstrap.ts)。
- [Helm values](../../deploy/k8s/helm/lucy/values.yaml)、[Secret 挂载](../../deploy/k8s/helm/lucy/templates/deployment.yaml)。
- [镜像构建脚本](../../scripts/release/build-customer-amd64-image.sh)、[现有 K8s 封包脚本](../../scripts/gates/build-k8s-delivery-package.sh)。
- [部署 quickstart](customer-k8s-deployer-quickstart.md)、[升级指南](../../deploy/k8s/helm/lucy/UPGRADE.md)、[会话恢复手册](webui-session-recovery-runbook.md)。
