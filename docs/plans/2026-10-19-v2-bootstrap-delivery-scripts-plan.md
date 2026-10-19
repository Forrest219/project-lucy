# Lucy v2.0 引导密钥生成与部署配置脚本计划

| 元数据 | 内容 |
|---|---|
| 版本 | v0.3 |
| 日期 | 2026-10-19，Asia/Shanghai |
| 状态 | **脚本已实现、本地验证通过；实际 amd64 集群和客户升级由用户测试，待验收** |
| 目标版本 | v2.0 客户交付脚本与配置接线 |
| 客户流程 | 执行部署入口 → 输入配套引导密钥并创建首个所有者 |
| 当前范围 | 实现脚本并在隔离环境验证；不操作客户生产实例或现有 demo |
| 发布属性 | 不新增 CI required check、冻结用例分母或发布门禁；既有检查保持原效力 |
| 流程依据 | [v2.0 K8s / K3s 客户交付及首次管理员流程](../runbooks/customer-v2-k8s-first-admin-delivery-flow.md) |

## 当前实施入口

2026-10-19 已新增[供应方准备入口](../../scripts/release/prepare-customer-delivery.mjs)、[凭据状态模块](../../scripts/release/customer-bootstrap-state.mjs)、[客户部署入口](../../scripts/deploy/deploy-customer-k8s.sh)、[部署辅助程序](../../scripts/deploy/customer-deployment-helper.py)和[只读身份探测](../../scripts/deploy/probe-customer-auth-state.mjs)，并接入通用封包脚本。本地检查已通过，不能据此宣称客户两步旅程已验收。操作与测试交接见[客户流程第 8 节](../runbooks/customer-v2-k8s-first-admin-delivery-flow.md#8-执行入口与测试交接)。

基础验证命令：

```bash
node --test scripts/release/customer-bootstrap-state.test.mjs scripts/deploy/probe-customer-auth-state.test.mjs scripts/gates/build-k8s-delivery-package.test.mjs
python3 -m unittest discover -s scripts/deploy -p 'test_*.py' -v
```

实际客户候选基线来自 `Forrest219/lucy-customer-delivery` 的 `lucy-k8s-integration-20261009-v1` 发布说明：镜像 `project-lucy:customer-amd64-0.17.0-20261008-e08de17`。本机已对该 amd64 镜像执行只读无管理员探测；现场实际安装身份仍需核对。其余集成与恢复验证继续按下文 BS 矩阵执行，不能由上述基础测试替代。

## 1 交付目标

供应方用一个准备入口，把已验证的通用安装包和实例配置组装成客户专属交付目录。首次初始化所需的引导密钥自动生成、保存并配齐；客户执行包内部署入口，脚本自动配置 Secret 与 Helm values，然后客户通过 HTTPS 页面输入收到的密钥、设置账号和密码。

自动化处理密钥生成、保存与配置，人工负责确定客户实例、交付凭据和确认业务结果。客户不手工生成密钥、不运行临时 Secret 命令、不编辑管理员文件。

默认规则固定如下：

- 新实例首次准备交付包：自动生成一个独立密钥。
- 同一实例重打包、切换交付版本或重试部署：复用原密钥，不按镜像版本轮换。
- 已有管理员的常规升级：不要求生成、领取或输入新的引导密钥。
- 密钥丢失、状态损坏、资源归属冲突：明确停止，进入受控恢复；不把重新生成当作正常重试。

实例初始化凭据不具有 License、有效期或席位含义。后端继续使用现有引导消费状态限制首次认领，本计划不增加许可系统或修改认证策略。

## 2 实施依据与接入位置

| 已有入口 | 可复用能力 | 需要补充的部分 |
|---|---|---|
| [镜像构建](../../scripts/release/build-customer-amd64-image.sh) | 已验证镜像和身份元数据 | 保持不含实例密钥；客户准备阶段复用最终镜像，不重新构建 |
| [通用 K8s 封包](../../scripts/gates/build-k8s-delivery-package.sh) | Chart、镜像、预检与验收脚本、校验和 | 携带通用部署入口，提供供客户专属包引用的稳定元数据 |
| [demo 密钥生成](../../scripts/upgrade/ensure-bootstrap-token.sh) | 32 字节随机材料、0600 文件、只输出路径 | 当前只按文件非空复用，没有实例绑定、跨进程互斥和损坏恢复契约；不能原样当客户凭据管理器 |
| [Helm values](../../deploy/k8s/helm/lucy/values.yaml)及[挂载模板](../../deploy/k8s/helm/lucy/templates/deployment.yaml) | `bootstrap.existingSecret`、只读文件、环境变量 | 脚本自动创建或核对 Secret，生成与实际 release 匹配的 values |
| [首次认领](../../webui/server/auth/bootstrap.ts) | 校验密钥、写 owner、消费引导和恢复中断操作 | 使用现有实现；脚本不直接写账号或绕过消费状态 |
| [安全库结构](../../webui/server/security/schema.ts) | `bootstrap_state` 的 open / consumed | 只读判断旧实例状态；探测不能调用会建库或迁移 schema 的打开接口 |

以上为本次实施的接口依据；认证后端沿用现有行为。通用封包已有包结构校验，不把客户明文密钥塞进通用包。

## 3 已实现入口与范围

下列入口已实现。客户部署从专属包执行，并先在同类测试环境验收。

| 实现文件 | 执行位置 | 职责 |
|---|---|---|
| `scripts/release/prepare-customer-delivery.mjs` | 供应方构建或交付机 | 读取实例描述，锁定凭据状态，生成或复用密钥，组装客户交付目录 |
| `scripts/release/customer-bootstrap-state.mjs` | 供应方，由准备入口调用 | 实例记录、原子写入、文件权限、互斥、完整性检查和副作用隔离 |
| `scripts/deploy/deploy-customer-k8s.sh` | 客户部署机，打包为 `scripts/deploy.sh` | 预检目标、探测账号状态、配置 Secret、调用 Helm、验证挂载和输出访问地址 |
| `scripts/deploy/customer-deployment-helper.py` | 客户部署机，由部署入口调用 | 使用标准库处理 JSON、路径和受限临时文件；只输出脱敏结果 |
| `scripts/deploy/probe-customer-auth-state.mjs` | 通过既有 Pod 内 Node 运行 | 只读解析管理员配置与安全库，返回状态分类，不输出凭据或密码哈希 |
| 对应 `.test.mjs` 及隔离集群验证用例 | 研发测试环境 | 覆盖第 9 节的行为、失败分支和两步客户旅程 |

准备入口接收：`--base-package`（已解压目录）、`--instance-config`、`--state-dir`、`--output` 和 `--dry-run`。其中实例描述提供稳定的 `instanceId`、部署 profile 与新装或升级意图。参数均为文件路径或非秘密元数据，不接受命令行明文密钥。

已有环境的实例描述应来自供应方已核对的状态。无法确认是否已有管理员时，先完成只读探测，不预先猜测需要生成密钥。现场实测状态与准备意图不一致时，在修改 Secret 或工作负载前停止并重新核对交付配置。

客户正常执行仅需 `bash scripts/deploy.sh`，上下文、namespace、release、数据卷和访问地址由供应方配套的实例配置提供。部署入口可以提供只读 `--dry-run`，但不提供自动轮换、强制接管 Secret、清空管理员等常规开关。

准备端沿用仓库 Node.js 22 或更高版本。现场新增脚本以 Bash 3.2、kubectl、Helm 和 Python 3 标准库为基础，不要求现场 Node.js、PyYAML、jq 或联网安装依赖；需要复用现有 Node 预检时，先明确其依赖和替代方法，不隐藏依赖。Pod 内 Node 和依赖用于只读状态探测，必须以实际旧镜像验证其可用性。

## 4 实例身份与凭据存储

### 4.1 区分实例与交付批次

`instanceId` 表示客户的一套逻辑部署，首次建立后长期保留。`deliveryId` 表示某次版本交付，每次可以不同。namespace、release、Deployment、PVC、Secret 名称分别记录，不能假设全部同名。

旧客户首次接入时由交付人员确认实例对应关系，此后复用实例记录。打包日期、镜像 tag、临时目录或重新随机生成的 UUID 都不能用作“查不到就新建”的实例查找依据。

客户实例配置包含目标 kube context、namespace、profile、访问地址和已有资源身份。部署时核对实际 context、namespace UID 和已有 release / PVC；供应方未掌握的现场身份由首次受控部署记录，后续必须匹配。不能仅凭 namespace 名称判断目标集群。

### 4.2 稳定存储与客户专属附件

供应方状态目录位于 Git 工作区、镜像构建 context、通用封包 staging 和普通 CI 缓存之外。按 `instanceId` 保存受限凭据和元数据；重新执行使用同一 `--state-dir`。缺失已签发实例的状态不是自动生成第二把密钥的依据。

客户交付目录为：

```text
customer-delivery/
  package/                 已通过现有检查的通用软件包
  instance.json            非秘密目标描述与交付身份
  customer-values.yaml     非秘密客户部署配置
  credentials/
    webui-bootstrap-token  首次初始化时提供，0600
  scripts/deploy.sh         包装后的正常部署入口
  README.md                两步操作、HTTPS 地址和故障联系入口
```

上述目录为客户专属受限交付物；公开镜像、通用 tar 和公共 Release 均不含 `credentials/`。供应方自动配齐目录，再通过受控渠道把同一密钥告知指定所有者；客户无需把密钥再次复制到安装配置。

已有管理员的常规升级可以没有密钥附件。保留集群现有 Secret 引用即可，不把包中缺少凭据等同于“生成一个新值”。客户专属目录和附件不作为普通测试报告或公共构建 artifact 上传。

### 4.3 生成与复用规则

新实例使用 Node `crypto.randomBytes(32)`，编码为 64 位小写十六进制文本；文件以一个换行结束。密钥只写入受限文件，不输出到 stdout、stderr、argv、环境变量、README 或 values。

生成过程对实例加跨进程锁，在临时目录完成密钥与元数据写入并同步，再原子提交完整凭据记录。父目录 0700、文件 0600；拒绝符号链接和越界路径。已经签发的文件不能因损坏、空文件或权限问题被静默覆盖。

| 存储状态 | 准备入口行为 |
|---|---|
| 明确为新实例，且没有签发记录 | 自动生成并原子保存 |
| 同一实例有完整、有效记录 | 复用原密钥，新的交付目录引用或复制同一值 |
| 记录显示已签发，但文件丢失或格式损坏 | 停止并报告恢复要求，不重新生成 |
| 只有文件没有完整记录，或锁处于未知状态 | 停止，保留现场；不得猜测归属或自动清锁后重签 |
| 文件、记录、实例 ID 不匹配 | 停止，不合并、不覆盖 |
| 已有管理员升级，未要求首次认领 | 不生成、不更改已有签发记录 |
| `--dry-run` | 仅检查与说明预期动作，不生成密钥、不写状态、不部署 |

凭据状态目录需要受控备份。同一实例重打包只依赖稳定记录，不依赖“上次输出目录还在”。本期不增加自动轮换或密钥丢失后的在线重发功能。

## 5 部署状态识别与 Secret 配置

### 5.1 切换镜像前识别状态

`/api/auth/status` 只能辅助判断：旧版本可能在已有账号时通过配置强制开放，不能把 `mode=open` 当作“从未有管理员”的充分证明。

新安装必须确认目标无已有 release / PVC 归属冲突。旧实例通过只读探测器检查有效管理员、原始配置是否完整、是否存在安全库及 `bootstrap_state`。探测器通过 stdin 传入既有 Pod 的 Node 进程，使用经验证的旧镜像解析能力，不落盘到客户数据卷，不启动第二个应用实例。

SQLite 使用只读方式查询，缺文件和损坏分开处理；不调用 `getSecurityStore` 等可能创建库或迁移 schema 的生产接口。缺少旧版探测依赖、未知 schema 或无法确定数据来源时，停止该升级路径，不降级为只看页面状态。

| 状态 | 条件与处理 |
|---|---|
| 新安装 | 无既有部署与数据冲突；配置首次引导 |
| 旧开放模式待初始化 | 受支持旧版本，无管理员，且无与历史初始化相矛盾的状态；配置首次引导 |
| 已有有效管理员 | 保留账号、数据及现有 Secret 引用，正常升级后登录 |
| 全部账号停用、历史账号丢失、引导已消费却无可用管理员 | 维护恢复，不自动重开认领 |
| 配置损坏、安全库不可读或状态不明 | 明确停止；不得新建空库代替原状态 |

探测到管理员配置发生并发变化时重新核对；脚本不与客户管理操作并发修改身份配置。维护窗口内切换前完成最后一次状态检查。

### 5.2 Secret 创建与核对

首次引导的 Secret 位于客户 namespace，键名为 `token`，记录非秘密的实例归属标识。创建请求同时携带内容和归属标识，使用原子创建，不采用先删除再重建。

| 集群状态 | 行为 |
|---|---|
| 目标 Secret 不存在 | 从配套受限文件创建 |
| 已存在，实例归属与密钥均相同 | 视为幂等重试，复用，不改 resourceVersion |
| 已存在但归属或密钥不同 | 在 Helm 切换前停止，不覆盖，不自动接管 |
| 创建竞争返回 AlreadyExists | 重新读取并按同一规则核对；不能假定对方写入相同值 |
| 无 Secret 读写权限 | 明确报告，不能用“读不到”推断不存在 |
| 已有管理员，仍引用旧 Secret | 验证资源存在并保留原引用，不要求新包提供同一密钥，不自动给外部管理的 Secret 改标签 |

核对通过进程内或受限管道进行，只输出“匹配 / 不匹配”；不得把 `kubectl get secret -o yaml/json` 结果写到终端或报告。凭据通过文件或 stdin 传递，不使用 `--from-literal=<明文>`，不保留临时明文 Secret manifest，不打印失败请求体。

### 5.3 values 与部署步骤

生成的客户配置只保存资源名，例如 `bootstrap.existingSecret: lucy-bootstrap`。沿用当前 Chart 的 `/run/secrets/lucy-bootstrap/token`、`LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE`、0440 文件权限与运行组权限。不要误改数据库密码使用的顶层 `existingSecret`。

升级时读取并核对当前 release values，在完整旧配置上白名单更新镜像身份、必要的新版本字段与引导 Secret 引用，保留未知客户字段、`fullnameOverride`、`persistence.existingClaim`、内容根、数据库 Secret 和对外地址。不得直接用新装样例覆盖现场 values，或盲用 `--reuse-values` 掩盖差异。含客户敏感配置的中间文件按受限临时文件处理，不上传。

部署入口先完成配置渲染、RBAC、存储、HTTPS 与镜像可用性预检，再配置 Secret，最后执行版本匹配的 Helm 安装或升级。K3s 离线模式覆盖实际可调度节点的镜像导入；权限不足时输出明确结果，不等待隐式密码输入，也不在集群临时构建镜像。

等待就绪后，验证实际挂载可由 UID 10001 读取且内容非空，不输出内容。通过 HTTPS 查询认证状态，区分“服务已启动、等待创建首个所有者”与“已有管理员、请登录”；脚本不替客户创建账号或保存客户密码。

若已有管理员且旧挂载仍被引用，缺 Secret 也应在切换前报告；本期默认不主动清理引导 Secret。客户只需执行部署入口，供应方应预先配齐工具依赖、实例描述和访问条件。

## 核心流程（伪代码）

```text
prepareDelivery(basePackage, instance, stateDir, output, dryRun):
  verify base package identity and target descriptor
  reject output or state paths inside public build/cache locations
  if dryRun: report planned actions without credentials; return
  lock stable instance identity
  if initial claim is intended:
    if fully issued state exists: validate and reuse it
    else if explicitly new with no prior state: atomically issue random key
    else: fail without overwriting credential state
  else: preserve records; do not issue a key
  assemble private customer directory with the unchanged base package
  check private credential permissions and absence from public assets
  commit delivery metadata; unlock; report paths and identifiers only

deployDelivery(bundle, dryRun):
  verify package, context, namespace and resource identities
  probe supported baseline state read-only
  reject ambiguous state or ownership before changing the workload
  render and validate preserved customer values, TLS and image availability
  verify dependencies, permissions, backup for upgrade and recovery inputs
  if dryRun: report actions only; return
  if state requires first claim:
    require the matching protected credential attachment
    create-or-compare Secret atomically without replacing different data
    reference its name in bootstrap.existingSecret
  else: preserve admins, security store and existing Secret references
  recheck target and authentication state before workload switch
  install or upgrade using the original PVC when applicable
  verify actual image, mount readability, HTTPS and auth state
  report WebUI URL and either first-owner instructions or normal login
  never claim that first-owner creation succeeded before the customer does it
```

## 6 中断与失败处理

凭据生成已提交、客户包组装失败时，下次复用已保存密钥。签发记录不随构建临时目录清理；不为“重新打一次包”换密钥。

Secret 已创建、Helm 尚未执行或失败时保留该资源，标记本次阶段结果，下次核对后复用。清理不得删除可能已被其他成功部署引用的 Secret、PVC 或客户配置。安装失败不自动删除管理员和安全库。

Helm 超时或原子回滚后，检查实际镜像、PVC 与挂载引用，不只依赖退出码。候选已经写入数据时，按现有版本对应的恢复方法处理，不假定 Helm 回退能恢复数据。恢复涉及旧安全快照时，不允许撤销状态丢失导致凭据复活。

本期不做通用回滚引擎；交付人员为实际旧版到候选版的路径验证恢复步骤。失败报告包含阶段、非秘密资源标识和下一步动作，不包含凭据、密码哈希或完整请求体。

## 7 实施任务与依赖

P1～P3 已实现并通过本地检查。2026-10-19 用户明确“我自己测试”：P0 的实际环境核对以及 P4 的原生 amd64 部署、浏览器、客户升级和恢复验收由用户执行，保持待验证。

| 阶段 | 待办 | 完成依据 |
|---|---|---|
| P0 | 确认客户旧镜像、K8s/K3s 环境、实例记录位置、HTTPS 与备份恢复方法 | 能明确识别原开放模式及已有管理员，工具依赖齐全 |
| P1 | 实现实例状态模块与自动准备入口，覆盖生成、复用、并发和损坏分支 | 第 9 节生成与封包验证通过 |
| P2 | 实现只读探测、Secret 创建核对、values 合并和部署入口 | 预检、冲突和幂等测试通过；不改认证策略 |
| P3 | 将入口和依赖加入通用软件包，组装私有客户附件与说明 | 解压后独立运行，通用包不含凭据，包内脚本有执行权限 |
| P4 | 在实际交付形态执行新装、旧开放模式升级、已有管理员升级和失败恢复 | 保存最终镜像对应的脱敏报告，客户两步流程完成 |

实际改动位置：新增第 3 节文件；窄幅更新通用封包脚本、客户交付文档与包内 README。未修改认证后端、demo 配置、冻结 case catalog、customer-release profile 或现有 workflow。

新装与升级的实际环境条件按 P0 核对，不把本次实现扩展为 v2.5 的完整升级 E2E 平台。

## 8 验证分层与执行边界

验证由供应方负责，客户按交付说明执行两步；本次实际集群与升级验证移交用户。新增模块测试与部署契约测试不依赖真实客户凭据。K8s / K3s 集成验证只在一次性环境运行，保留过程结果，不操作现有 demo 或生产集群。

准备端同时验证 stock macOS Bash 3.2 兼容入口和 Node 依赖；客户现场入口在离线 amd64 Linux 上验证。测试数据全部为合成数据。真实客户升级前仍需要版本匹配的备份、试升级和业务核验，单元测试不能替代现场兼容性结论。

## 9 验证矩阵

以下 `BS-*` 为本计划内部编号，未注册为发布门禁。测试断言应验证外部行为与实际状态，不能只检查源码字符串或命令退出 0。

| 编号 | 层级 | 场景与措施 | 预期结果 |
|---|---|---|---|
| BS-01 | 模块 | 空的明确新实例准备交付 | 使用密码学随机源生成 32 字节材料；编码、权限、状态记录正确，日志无值 |
| BS-02 | 模块 | 同一实例连续准备、不同版本重打包 | 密钥字节保持不变，交付身份可变化；原注册记录不被覆盖 |
| BS-03 | 模块 | 两个新实例 | 独立存储和凭据，不能交叉复用；随机源失败时不产生可交付记录 |
| BS-04 | 进程 | 两个进程并发为同一实例准备 | 只有一个完整签发结果，后者复用或明确等待，无两把密钥、截断文件或部分成功 |
| BS-05 | 模块 | 丢文件、空文件、损坏记录、未知锁、错误权限或符号链接 | 明确停止，不覆盖、不重新生成、不跟随链接写出目标目录 |
| BS-06 | 封包 | 通用包和客户专属目录分别校验 | 真实测试密钥不进入镜像层、通用 tar、README、values、普通 artifact；私有附件权限正确 |
| BS-07 | 契约 | 新安装和旧开放模式的状态探测 | 仅受支持且明确未初始化时进入首次认领；不创建安全库、改 YAML 或迁移数据库 |
| BS-08 | 契约 | 有账号但旧状态为 open、全停用、已消费无账号、损坏或未知 schema | 已有有效账号保留；异常分支拒绝初始化，不把 open 直接等同于无管理员 |
| BS-09 | 集群 | Secret 不存在、同值同归属、冲突、并发创建、RBAC 拒绝 | 缺失时自动创建；重复保持 resourceVersion；冲突或权限错误在 Helm 切换前停止 |
| BS-10 | 契约 | 客户旧 values 含自定义字段与不同资源名 | 保留 PVC、内容根、数据库 Secret、release 名及未知字段；只更新约定范围内字段 |
| BS-11 | 集群 | 新装后用实际 UID 读取挂载、检查实际镜像与 HTTPS | 文件可读非空、环境路径正确、镜像匹配；纯 HTTP 或缺挂载不能报告初始化就绪 |
| BS-12 | API 与桌面浏览器 | 无密钥、错误密钥、正确密钥创建管理员并进入系统 | 前两者拒绝且账号未创建；正确值可创建 owner，Cookie 与登录会话正常 |
| BS-13 | API 与桌面浏览器 | 创建后退出登录、重复认领、重启再登录 | 原账号可登录；不能重复创建首个 owner；无需再次输入引导密钥 |
| BS-14 | 升级集成 | 实际旧版开放模式夹具原地升级，执行客户两步流程 | 原卷、有效 Token、业务查询、权限拒绝与审计保留；管理员创建只改变预期身份状态 |
| BS-15 | 升级集成 | 已有管理员升级，包内不含密钥附件 | 不生成新密钥、不替换已有 Secret、不要求首次认领，原账号正常登录 |
| BS-16 | 故障集成 | 在凭据提交后、Secret 创建后、Helm 切换前后中断并重试 | 同一密钥和实例可恢复执行；无数据卷删除、密钥隐式轮换或他人资源清理 |
| BS-17 | 工具安全 | 使用合成敏感探针，收集 stdout/stderr、错误输出、子进程 argv 和 artifacts | 所有普通输出无密钥、Cookie、密码及 Secret 请求体；报告只含非秘密标识 |
| BS-18 | 干运行 | 对准备和部署入口运行 `--dry-run` | 无密钥、文件状态、Secret、Helm 和工作负载变更；预期缺失项如实报告 |
| BS-19 | 离线部署 | 解压最终包，在 amd64 K8s 与 K3s 实际交付形态分别运行 | 不依赖源码目录、个人路径或实时下载工具；镜像导入及部署有效 |
| BS-20 | 恢复集成 | 备份恢复和版本匹配的失败回退 | 业务恢复、账号可用、已有撤销状态不复活；未知安全状态保持维护而非误报成功 |

BS-12～BS-13 的桌面浏览器步骤由用户后续在隔离环境执行，无需移动窄屏。若旧镜像依赖导致 BS-07 无法测量，标记能力不足并解决适配，不能伪造未初始化结果。

BS-01～BS-10、BS-17～BS-18 应优先做自动化；BS-11～BS-16、BS-19～BS-20 首期可使用已有脚本配合人工，但须保存实际断言结果。未来并入 v2.5 自动化时复用这些行为，不以测试 mock 成功替代真实集群成功。

## 9.1 本次验证快照（2026-10-19）

| 验证 | 结果与边界 |
|---|---|
| Node 自动化 | **15/15 通过**：实例签发、复用、并发、损坏、私有封包、只读探测及现有封包回归 |
| Python 自动化 | **11/11 通过**：Secret 幂等与冲突、values 保留、真实 Chart 渲染、PVC 管理方式保留、安装与升级参数、备份失败恢复副本、dry-run 及错误脱敏 |
| 发布旧镜像探测 | 指定旧 amd64 镜像配合合成只读夹具返回 `uninitialized`，仅证明探测依赖兼容，不代表读取客户实际数据 |
| 隔离 K3s Secret API | 原子创建、同值复用不变 resourceVersion、冲突拒绝、无权限读取拒绝通过；非工作负载验收 |
| 原生 amd64 Pod、HTTPS、浏览器、升级及恢复 | **待用户测试**。本机仿真 Pod 因 seccomp 不支持失败，未计为部署通过；一次性测试容器已清理 |

过程日志位于可随时清理的 `inbox/bootstrap-delivery-validation/`，不作为公共交付物或发布通过凭证。上述局部结果不等于 BS 矩阵全部通过。本次构建过本地候选镜像，它未完成既有镜像门禁与客户验收，不作为最终交付镜像；最终镜像按当前 `VERSION`、源码状态和原构建清单重新确认。

## 10 完成与交付判定

本次实现完成应具备：一个供应方准备入口、一个客户部署入口、可复用的实例凭据状态、独立私有附件、配套手册，以及适用验证项的实际结果。报告区分 `PASSED`、`FAILED`、`BLOCKED`、`UNIMPLEMENTED`，保留失败和重试历史。

报告同时记录未覆盖的部署形态、旧版和恢复能力。K8s 结果不替代 K3s，通用镜像构建成功不代表两步流程完成。本计划不创建新的全局发布聚合器，也不把报告自动转换成现有发布通过证据。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None. `instanceId`、`deliveryId` 和 `BS-*` 为内部交付与验证标识，不新增产品页面概念。

## 关联文档

- [镜像构建清单](../runbooks/customer-amd64-image-build-checklist.md)、[客户交付流程](../runbooks/customer-v2-k8s-first-admin-delivery-flow.md)。
- [v2.5 L25-07 备忘](2026-10-18-lucy-2.5-upgrade-proposal.md#l25-07-客户升级-e2e-自动化)、[完整升级 E2E 方案](2026-10-19-upgrade-e2e-implementation-plan.md)。
- [现有包验证](../../scripts/gates/verify-k8s-package.sh)、[现有 Helm 静态检查](../../scripts/gates/helm-lucy-gate.sh)、[首次管理员测试](../../webui/server/__tests__/webui-bootstrap-concurrency.test.ts)。
