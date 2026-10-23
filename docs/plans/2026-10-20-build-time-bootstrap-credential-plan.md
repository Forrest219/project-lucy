# 出包时自动配套生成引导密钥

状态：已实施。标准客户出包入口在最终归档回归通过后自动生成或复用私有引导附件并跑 C20 成套门禁；`--public-release` 显式跳过（公共发布不签发）。实施：供应方附件生成入口 `scripts/release/build-bootstrap-attachment.mjs`、附件内准备入口 `scripts/prepare.sh`（生成物）、C20 门禁 `scripts/gates/verify-bootstrap-attachment.py`、出包流程接入 `scripts/gates/build-k8s-delivery-package.sh`。依据：用户要求每次生成镜像包时同步提供 bootstrap-token，部署人员不再补充或另行签发。

## 已确认的强制原则

每次客户部署出包，供应方同步生成或复用 `webui-bootstrap-token`，配齐私有签发状态、元数据和说明；同一实例复用、不同实例独立、已有管理员不新发。不得交给部署人员另行补密钥。缺少配套附件或无法验证与部署取值一致时，客户部署交付未完成，禁止发出声称可部署的客户包。

规则已进入[仓库 Agent 入口](../../AGENTS.md)和[交付 Checklist C01/C05/C20](../runbooks/customer-v2-upgrade-release-checklist.md)。标准封包尚未自动完成的动作，由供应方在同次出包用现有签发/准备工具完成并留存验证，不能以脚本待实施为由跳过。

## 目标与交付行为

标准客户出包入口一次执行后同时提供：

1. 通用软件包及校验、验证记录，仍可用于多客户且不含凭据。
2. 本客户实例的私有交付附件：`webui-bootstrap-token`、配套签发状态、预填的凭据元数据、实例准备入口和使用说明。
3. 自动打印软件包和私有附件的路径，不输出密钥内容。供应方可直接将私有附件与软件包交给该实例部署人员。

部署人员只填写 context、UID、访问地址、旧镜像和恢复说明等现场参数。私有附件入口自动读取预分配的实例 ID 和签发状态并调用现有 prepare 工具，无需手工复制密钥、填写 credentialState 或寻找 state-dir。

“每次同步生成”指每次确保交付物齐备；同一实例再次出包复用原密钥。已有管理员路径不签发新密钥，不重开认领。通用镜像不得烘焙共享密钥；面向多个客户交付时分别生成私有附件。

## 来源与差距（已全部补齐）

- 已有 `customer-bootstrap-state.mjs` 支持 32 字节随机材料、每实例永久签发记录、重复签发复用、并发锁、私有文件权限和 Python 互操作，可直接复用。→ 已由 `build-bootstrap-attachment.mjs` 复用。
- 标准 `build-k8s-delivery-package.sh` 仅生成通用软件包；签发发生在后续 prepare 阶段，导致软件交付后还需人工补密钥。→ 出包入口现已在最终归档回归后自动调用附件生成并执行 C20 门禁；公共发布用 `--public-release` 显式跳过。
- 上次手工生成的 r4 凭据附件已具备密钥和签发记录，但需要部署人员手工设置实例 ID 和状态路径；应成为受测的自动流程。→ 附件生成物自带实例准备入口 `scripts/prepare.sh`，自动注入实例 ID、签发状态和 state-dir，部署人员只填写现场参数。
- CI 会上传 release/ 和证据目录，私有附件必须在这些公开上传路径、Git、inbox、镜像构建上下文之外；CI 公共制品路径不签发客户凭据。→ 附件默认落在供应方私有目录（`~/.lucy/customer-deliveries/`，可用 `LUCY_ATTACHMENT_ROOT`/`--attachment-output` 覆盖），签发状态根默认 `~/.lucy/customer-credentials/`（可用 `LUCY_CREDENTIAL_STATE_DIR` 覆盖）。
- 此方案修改原计划“实例化时才签发”的时点；保留按实例隔离、复用、不进入镜像和公共软件包的契约。

## 实施步骤（已完成）

1. 增加供应方私有附件生成入口，复用现有签发模块。为明确客户指定稳定实例 ID；尚无现场参数时自动预分配并保存，不依赖 Kubernetes UID 才能签发。既有实例须使用其原 ID 与签发状态，不因构建新版本另建身份。→ `scripts/release/build-bootstrap-attachment.mjs`（`resolveInstanceId` 客户注册表）。
2. 接入标准客户出包流程：软件验证通过后自动生成/复用私有附件。默认落入供应方持久化私有目录；公开 CI 制品与实例私有交付模式显式分开，不将 Token 上传公共 Release。已有管理员不签发。→ `build-k8s-delivery-package.sh` 末尾附件步骤 + `--public-release`/`--existing-admin`。
3. 私有附件提供可从任意 cwd 运行的实例准备入口，自动注入凭据元数据及状态目录，真实现场配置继续由部署人员填写；与不同实例或包身份冲突时明确拒绝。包身份和凭据复用分别记录，不能把已有密钥改绑至其他实例。→ 附件内 `scripts/prepare.sh`（`PACKAGE_BINDING_MISMATCH`/`INSTANCE_BINDING_MISMATCH`）。
4. 更新 README、交付流程、出包 Checklist 和验证入口，增加“软件包+凭据附件同时齐备”的门禁；保留原生 amd64 升级/恢复验收边界。→ `scripts/gates/verify-bootstrap-attachment.py`（C20 门禁）+ 文档更新。

## 核心流程（伪代码）

```text
客户出包请求：
  明确公共软件发布或指定客户交付
  构建/验证软件制品；失败则不宣布交付完成
  公共软件发布 → 仅软件和脱敏证据，不签发客户凭据
  客户交付：
    已有管理员 → 标记无需引导，不新发密钥
    无管理员：
      找到稳定实例 ID / 首次自动预分配并持久化
      读取签发状态：已有完整记录则复用；不完整则停止恢复；首次才签发
      原子组装 0700/0600 私有附件（密钥、签发状态、元数据、准备入口、说明）
      验证附件可被 Python prepare 复用，密钥与最终部署目录完全一致
  输出制品路径和脱敏结果，不打印密钥

部署人员准备实例：
  填现场参数 → 运行附件内准备入口
  入口自动读取实例 ID / credentialState / state-dir
  若与现场既有实例绑定冲突则停止，不静默覆盖
  调用现有 prepare → 检查交付密钥与部署密钥相同 → 原有 dry-run/部署流程
```

## 验收清单

- 首次客户出包自动生成密钥和可搬运附件，无单独签发命令；目录 0700、文件 0600，格式为 64 位小写十六进制加换行。
- 同实例重试、重打包、不同软件批次复用密钥；不同实例密钥独立；损坏、遗失签发状态及并发流程遵循现有恢复/锁约束。
- 已有管理员不生成密钥，不影响已消费的 PVC 状态。
- 从最终软件归档和最终私有附件重新解压，其他 cwd 执行附件内准备入口；部署人员只提供现场参数，Python prepare 实际复用同一密钥。
- 软件 SHA、附件的包身份、实例绑定和密钥匹配；混用不同客户附件明确失败；日志、镜像层、通用包和公共上传文件集合均不含密钥。
- 不将新回归中的合成集群检查声称为原生 K3s 升级验收。

## 当前 r4 附件

已生成的 r4 密钥保持原值和签发状态，不因本次改进旋转。此次不修改 r4 软件包及其 SHA；新流程实现后使用新的交付批次验证。

## Terminology Compliance

This plan follows `webui/docs/00-product-terminology-standard.md`.

New terms: None. 沿用“引导密钥”“实例”“首次创建所有者”和“私有交付附件”。
