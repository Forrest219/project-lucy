# WO-202608-27 客户 K8s 集成交付实现路径（Forrest219/lucy-customer-delivery 新一版 Release）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 客户 K8s 集成交付执行计划（更新 `Forrest219/lucy-customer-delivery` 手册 + 另送 tar.gz） |
| 文档类型 | Spec / Work Order |
| 版本 | v1.2（再修正：GitHub = 手册；tar.gz = 单独渠道交付，不依赖 GitHub Release Assets） |
| 撰写日期 | 2026-08-27 |
| 撰写人 | Thinker / Composer |
| 委托人 | xingchen（Data scientist / Researcher） |
| 基于材料 | 上次：`https://github.com/Forrest219/lucy-customer-delivery`（手册仓库）；历史上曾挂过 Release Asset `lucy-k8s-integration-delivery-20260727-v2.tar.gz`，但**客户侧实际用法是 tar.gz 单独给、GitHub 只当手册**；本仓库 `deploy/k8s/helm/lucy/`、`docs/customer-k8s-deployer-quickstart.md` 等；镜像：`project-lucy:customer-amd64-0.16.0`（`inbox/customer-amd64-offline-package/image/*.tar`） |
| 适用范围 | 客户已有 K8s + Helm；本轮更新手册仓库 + 另产一版可单独发送的 integration tar.gz |
| 输出位置 | 本 WO：`docs/plans/wo-202608-27-customer-k8s-delivery.md`；手册：`Forrest219/lucy-customer-delivery`；大包：`inbox/customer-k8s-integration-build/*.tar.gz`（另渠道发送，默认**不**上传 GitHub Release） |

> **v1.2 修订摘要**：用户澄清 —— **tar.gz 是单独给客户的**；**GitHub 仓库只是手册**。v1.1 仍把「发 GitHub Release + 上传 ~931MB Assets」当成主路径，现撤销。GitHub `main` 放/更新中文手册与参数示例；镜像大包在本地/inbox 打出后走飞书/网盘/邮件等另渠道。仓库里若仍留有旧 Release Assets，仅作历史痕迹，**不是**本轮必做步骤。

> **v1.1 修订摘要（保留）**：不做可 `helm install` 的 Chart 主交付；`deploy/k8s/helm/lucy/` 最多作参考快照。

---

## 1. 背景与目标

### 1.1 上次交付形态（不可推翻）——双渠道

| 渠道 | 放什么 | 客户怎么用 |
|---|---|---|
| **GitHub 手册** `Forrest219/lucy-customer-delivery` | 中文集成说明、部署契约、参数示例、验收命令、README / RELEASE_NOTES | IT 打开仓库读手册、抄 values、跑验收命令 |
| **单独发送的 tar.gz** | Lucy 镜像归档（~900MB 级）+ 包内配套文件（与手册一致的说明副本 / SHA256 等，以实包为准） | 飞书/网盘/邮件等另渠道到手；`sha256sum -c` → `tar -xzf` → 导入镜像 |

补充约定：

| 项目 | 值 |
|---|---|
| 面向对象 | 客户已有 Kubernetes / Helm，做**集成**（非从零装集群） |
| CPU | `linux/amd64` |
| **不包含** | 可直接 `helm install` 的 Chart；K3s 一键包；DB 密码 / MCP Token 明文 |
| `values-example.yaml` | **参数示例**，不是可直接 `helm install` 的 values |
| 历史 GitHub Release Assets | 仓库上曾挂过 `lucy-k8s-integration-20260727-v2` 大包，**不代表**本轮仍要以 Release 上传大包；手册仓库与大包渠道分离 |

### 1.2 缺口 / 触发本轮的原因

自 `lucy-k8s-integration-20260727-v2` 出包（2026-07-27）至今：

- Lucy chart 从 draft 晋升到正式 `deploy/k8s/helm/lucy/`（chart v0.1.0, appVersion 0.16.0），并通过 kind e2e。契约字段（端口 5174/7879、单副本、Recreate、RWO PVC、不暴露 7878）已固化。
- 若源码 / 镜像 / customer-config 有相关更新（需 Builder 第一步核对 diff 决定，见 §8 Step 1 与 §12 Q1），本轮需刷镜像 tar；否则仅刷说明 / 契约 / 验收脚本。
- 中文集成说明需要根据 chart 契约与最新 `docs/customer-k8s-deployer-quickstart.md` 内容做一次同步。

### 1.3 本轮目标

1. **更新 GitHub 手册**（`Forrest219/lucy-customer-delivery`）：把当前契约 / 端口 / 验收步骤 / values 示例写进仓库（可拆成多文件，或保持 README + 若干 md/yaml/sh）
2. **另产 tar.gz**（本地 `inbox/customer-k8s-integration-build/`）：含镜像 tar + 校验；需要时附手册副本；**默认不上传 GitHub Release**
3. 给委托人一份「手册链接 + 大包如何另送」的交接说明（邮件/飞书草稿即可）

### 1.4 Non-Goals（明确不做）

- **不做**把 ~900MB tar.gz 作为本轮 GitHub Release 必传 Assets（除非委托人另行要求）
- **不做**可直接 `helm install` 的 Chart 交付（客户继续用自己的 Chart / GitOps）
- **不做** K3s / K8s 一键安装脚本
- **不做** HA / 多副本 / HPA / VPA / PDB / Operator / CRD
- **不做** cert-manager / sealed-secrets / NetworkPolicy / ServiceMonitor 模板
- **不做**多架构镜像（保持 `linux/amd64`）
- **不做**数据库本体与任何明文密钥
- **不新建** `inbox/customer-k8s-offline-package/` 作为客户主交付路径（v1.0 已撤销）

---

## 2. 与历史资产的关系（v1.1 修订版）

| 资产 | 本次动作 | 原因 |
|---|---|---|
| `Forrest219/lucy-customer-delivery` | **更新手册**：中文说明、契约、`values-example.yaml`、`验收命令.sh`、README / RELEASE_NOTES | GitHub = 手册渠道 |
| 历史 GitHub Release `…20260727-v2` | **不动**；本轮**默认不**再 `gh release create` 上传大包 | 大包另渠道；旧 Release 仅历史痕迹 |
| 单独发送的 tar.gz | **新产**到 `inbox/customer-k8s-integration-build/`，命名沿用 `lucy-k8s-integration-delivery-YYYYMMDD-vN.tar.gz` | 飞书/网盘/邮件等另送 |
| `deploy/k8s/helm/lucy/` 正式 chart | **只读快照**放入 `reference/helm-chart/`；`请先阅读.md` 明示"**仅参考，客户仍用自有 Chart**" | 上次交付边界"不含可安装 Chart"不变；但快照能让客户对照契约 |
| `docs/customer-k8s-deployer-quickstart.md` | **压缩翻译**为中文的 `集成说明.md`（保留端口 / 契约 / 验收 / 排障 5 项） | 长文档不适合客户 IT；本次改为中文精简版 |
| `docs/customer-deployment-guide.md` / `admin-guide.md` / `security-guide.md` | **原样**放入 `reference/`（英文全文，供合作方 / 售前查阅） | 保留深度参考 |
| `docs/lucy-customer-amd64-offline-delivery-spec.md` | **不动** | Docker Compose 交付路径，与本轮无关 |
| `inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar` | **默认不复用**；2026-08-27 已证实该 tar 为 arm64 ELF 坏包。必须 `bash scripts/build-customer-amd64-image.sh` 重建并通过 G1–G4 后再入包 | 见 [`docs/customer-amd64-image-build-checklist.md`](../customer-amd64-image-build-checklist.md) |
| `customer-config.example/` | **复用**为 `customer-config-template/`（进包，去掉 secret 文件） | 上次交付已有类似模板，本次保持 |
| `inbox/k8s-helm-draft/validation/validation-notes.md` | **不动** | 内部验证证据；chart 已晋升，草稿保留为历史 |
| `docs/plans/wo-202608-07-customer-amd64-delivery.md`（Docker 包 WO） | **不动**；作为姊妹范式交叉引用 | 结构学习范例 |

**v1.1 降级项（v1.0 曾作为主交付，本轮改为可选/不做）：**

| 原假设 | v1.1 处理 |
|---|---|
| `chart/lucy-0.1.0.tgz` 作为客户主安装物 | **降级**为 `reference/helm-chart/` 只读快照；不出 tgz |
| `values.customer.example.yaml` 作为强制模板 | **合并**为 `values-example.yaml`（参数示例，非可安装 values） |
| `rendered/lucy-rendered.example.yaml` 预渲染 fallback | **不做**（客户有自己的 Chart / GitOps 渲染路径） |
| `scripts/customer-k8s/seed-context.sh` + `create-secret.sh` | **降级**为可选内部工具（本仓库 `scripts/customer-k8s/`），**不进**本次交付包 |
| `docs/lucy-customer-k8s-offline-delivery-spec.md` | **不新建**独立英文 Spec；集成说明与部署契约合并为交付包内中文文档 |
| `docs/customer-k8s-offline-onsite-runbook.md` | **不新建**；`集成说明.md` + `验收命令.sh` 已覆盖客户现场步骤 |
| Q1 "客户是否有私有 registry" 作为 blocking 未决 | **撤销**（说明见 §5.4） |
| Q2 "客户是否有 Ingress Controller" 作为 blocking 未决 | **撤销**（`values-example.yaml` 给示例，客户 IT 按自有 Ingress 现状调） |
| Q3 "是否加 sealed-secrets 变体" | **撤销**（Non-goal） |

---

## 3. 设计决策（本轮拍板）

### 3.1 双渠道命名（手册 vs 大包）

- **手册仓库**：`Forrest219/lucy-customer-delivery`（只提交文档/示例/脚本；无大镜像）
- **大包文件名**：`lucy-k8s-integration-delivery-20260827-v1.tar.gz` + `.sha256`（落在 `inbox/customer-k8s-integration-build/`）
- **GitHub Release 上传大包**：默认 **跳过**；仅当委托人明确要求「也挂到 Releases」时再执行旧 Step 13
- **解压根目录**：与 tar 文件名主体一致，便于客户核对

### 3.2 镜像

- **基线**：`project-lucy:customer-amd64-0.16.0`，`linux/amd64`，bundled `@kaelio/ktx@0.16.0`
- **是否需要重构建**：Builder 第一步跑 `git log --since=2026-07-27 -- <关键源码路径>`（见 §8 Step 1）判断
- **默认必须重构建**：按 [`docs/customer-amd64-image-build-checklist.md`](../customer-amd64-image-build-checklist.md) 跑 `scripts/build-customer-amd64-image.sh`（G1–G4）。历史 `inbox/…/customer-amd64-*.tar` **禁止盲复用**。
- **仅当**本地已有**本轮**刚通过 G2–G4 的同 digest 镜像时，才可跳过 rebuild，但仍须在出包前当场重跑 G2–G4。
- **镜像分发问题**：本包**只**放 image tar + digest，**不假设**客户镜像分发方式（客户 IT 会根据自有 registry / containerd 环境自己 `docker load` 或 `docker load && docker tag && docker push`）

### 3.3 私有 registry 说明（不作为开工前置）

**私有 registry**（客户内网镜像仓库）常见形态：Harbor、Nexus、JFrog Artifactory、云厂商容器镜像服务（阿里云 ACR / AWS ECR / Google GCR / 华为 SWR / 腾讯云 TCR 等）。K8s 集群启动 pod 时，通过 `image.repository`（配 `imagePullSecrets`）从这个仓库拉取镜像。

上次交付包**不假设**客户是否有私有 registry，本轮沿用：

- 包内给 image tar
- `请先阅读.md` 简单解释私有 registry 概念（不做建议）
- 客户 IT 自行选择：`docker load` 后推到自有 registry / 每节点 `docker load` + `imagePullPolicy: Never` / `ctr image import` for containerd
- **不在** WO 层面 block；如客户明确说"没有 registry，要求你们指导单节点 load"，作为交付后支持事项处理，不阻塞本包

### 3.4 客户配置注入

**不主张**任何具体注入方式（`kubectl cp` / initContainer / ConfigMap / GitOps 都合法）：

- 包内提供 `customer-config-template/`（去 secret 后的模板）
- `集成说明.md` 说明 `/data/lucy` 目录内容契约（`ktx.yaml` / `semantic-layer/` / `wiki/` / `evals/` / `skills/` / `webui/config/access.yaml` / `.ktx/secrets/`），由客户按其自有部署管线注入到 PVC
- **不进**包的两个工具（`scripts/customer-k8s/seed-context.sh` / `create-secret.sh`）：留作本仓库内部工具，用于我方在客户现场协助时手动跑；本次交付路径不依赖

### 3.5 文档分层（本次交付内）

| 文档 | 目标读者 | 位置 | 语言 |
|---|---|---|---|
| `请先阅读.md` | 客户 IT 首读 | 包根 | 中文 |
| `集成说明.md` | 客户 IT 主文档（部署 + 验收 + 排障） | 包根 | 中文 |
| `K8s部署契约.md` | 客户平台工程 / SRE | 包根 | 中文（关键字段英文） |
| `values-example.yaml` | 客户 IT / 平台工程（抄进自有 values） | 包根 | 英文注释 |
| `验收命令.sh` | 客户 IT 现场执行 | 包根 | Bash + 中文注释 |
| `RELEASE_NOTES.md` | 客户 IT + 项目管理 | 包根 | 中文 |
| `reference/helm-chart/` | 客户平台工程审阅契约 | 包内 | 英文（chart 原样） |
| `reference/深度参考-K8s部署指南.md` | 合作方 / 售前 | 包内 | 中文（`docs/customer-k8s-deployer-quickstart.md` 翻译精简） |
| `reference/管理指南.md` / `reference/安全指南.md` | 客户运维 | 包内 | 中文（`docs/admin-guide.md` / `docs/security-guide.md` 翻译精简） |

---

## 4. 交付包目录结构（精确到文件）

```
lucy-k8s-integration-delivery-20260827-v1/
├── 请先阅读.md                                   # 客户首读；导航 + 私有 registry 名词解释
├── 集成说明.md                                    # 主文档：契约概述、image 使用、customer-config 注入、验收、排障
├── K8s部署契约.md                                 # 端口 / 单副本 / Recreate / RWO PVC / 不暴露 7878 / SecurityContext 硬约束
├── values-example.yaml                            # 参数示例（客户抄进自有 values；非可直接 helm install）
├── 验收命令.sh                                    # 客户现场执行：sha256 校验、docker load 检查、kubectl 连通性、/api/health、MCP handshake
├── RELEASE_NOTES.md                               # 本版变更（与仓库 RELEASE_NOTES.md 内容一致或摘要）
├── SHA256SUMS                                     # 包内所有文件 sha256（相对包根）
├── image/
│   ├── project-lucy-customer-amd64-<version>-image.tar
│   ├── image-digest.txt                           # docker image inspect --format '{{.Id}}' 输出
│   └── image-inspect.json                         # docker image inspect 全量元数据（含 Os/Architecture）
├── customer-config-template/                      # 客户上下文包模板（对齐 /data/lucy 内容契约）
│   ├── README.md                                  # 中文，说明每个子目录用途 + secret 不进包
│   ├── ktx.yaml                                   # CHANGE-ME 占位
│   ├── semantic-layer/                            # 示例语义层
│   ├── wiki/                                      # 示例 wiki
│   ├── evals/                                     # 示例 evals
│   ├── skills/                                    # 示例 skills
│   ├── webui/config/access.yaml                   # 示例 ACL
│   └── .ktx/secrets/README                        # 空目录说明；客户现场填 secret
├── reference/                                     # 参考资料，非交付主路径
│   ├── helm-chart/                                # deploy/k8s/helm/lucy/ 的只读快照
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   ├── README.md
│   │   ├── examples/
│   │   │   └── values.local-test.yaml            # kind-only，明确标注
│   │   └── templates/                             # 与仓库一致
│   ├── 深度参考-K8s部署指南.md                    # docs/customer-k8s-deployer-quickstart.md 中文精简
│   ├── 管理指南.md                                # docs/admin-guide.md 中文精简
│   └── 安全指南.md                                # docs/security-guide.md 中文精简
```

### 4.1 排除清单

- 任何真实密码 / DB DSN / MCP Token / 私钥 / TLS 证书
- `.git/` / `.claude/` / `.codex/` / `node_modules/` / `webui/node_modules/` / `webui/dist/` / `.ktx/` / `.ktx-ui/` / `coverage/` / `tests/`
- `customer-config.example/` 里任何真实 secret 文件（若有）
- macOS `.DS_Store`
- Docker 构建中间产物 / 空 image tag（`<none>:<none>`）

### 4.2 大小估算

- image tar：~910 MB（与上次同量级；linux/amd64 单架构）
- customer-config-template：<300 KB
- 中文说明 + K8s 契约 + values-example + 验收脚本：<200 KB
- reference/：<2 MB（含 chart 快照 + 3 份翻译文档）
- 整包：~915 MB，与 `lucy-k8s-integration-20260727-v2`（~931 MB）同量级

---

## 5. Spec 要点（Builder 直接用）

### 5.1 镜像

| 项目 | 取值 | 来源 |
|---|---|---|
| Image tag | `project-lucy:customer-amd64-<version>-<yyyymmdd>` 或沿用 `project-lucy:customer-amd64-0.16.0` | 视 §3.2 判断 |
| Platform | `linux/amd64` | 与上次一致 |
| Bundled KTX | `@kaelio/ktx@0.16.0` | Dockerfile ARG |
| 平台断言 | `docker image inspect --format '{{.Os}}/{{.Architecture}}'` = `linux/amd64` | 硬门禁 |
| ELF 断言 | `bash scripts/assert-image-elf-arch.sh <image-tag> amd64` + runtime smoke | **出包前必跑**；见 [`docs/customer-amd64-image-build-checklist.md`](../customer-amd64-image-build-checklist.md) |
| 元数据落包 | `image/image-inspect.json` + `image/image-digest.txt` | 客户可复核 |

### 5.2 K8s 部署契约（`K8s部署契约.md` 必须覆盖字段）

| 字段 | 约定 | 来源 |
|---|---|---|
| replicas | `1`（严格）| `deploy/k8s/helm/lucy/templates/deployment.yaml` `{{- fail ... }}` |
| Deployment strategy | `Recreate` | 同上；RWO PVC 前提 |
| Container ports | `webui: 5174/tcp`、`mcp: 7879/tcp`；**不含** `7878` | `deploy/k8s/helm/lucy/templates/deployment.yaml` `ports:` |
| Service ports | 只暴露 `5174` 与 `7879` | `deploy/k8s/helm/lucy/templates/service.yaml` |
| Pod-internal port | `7878/tcp`（KTX MCP upstream，`127.0.0.1` bind），**严禁**放进 Service | 安全红线 |
| PVC | `ReadWriteOnce`；挂 `/data/lucy` | `deploy/k8s/helm/lucy/templates/pvc.yaml` |
| Volume mounts | `/data/lucy`（PVC）；`/data/lucy/.ktx/secrets`（可选 Secret 映射） | 同上 |
| Startup probe | `exec /app/scripts/docker-healthcheck.sh`；`failureThreshold ≥ 60`（覆盖首次 seed + reindex） | `values.yaml` |
| Readiness probe | 同 startup（exec healthcheck） | 同上 |
| Liveness probe | `httpGet /api/health` on port `webui` | 同上 |
| Env（必须） | `KTX_PROJECT_ROOT=/data/lucy`、`POSTHOG_DISABLED=1`、`LUCY_PUBLIC_MCP_URL=<客户外部可达 URL>` | 客户填 `LUCY_PUBLIC_MCP_URL` |
| Env（可选） | `LUCY_ALLOW_PLACEHOLDER_KTX=""`；仅首次 seed 时临时设 `"1"` | `请先阅读.md` 明示 |
| Secret 挂载 | 客户自选：K8s Secret / SealedSecret / ExternalSecret / CSI；文件落 `/data/lucy/.ktx/secrets/<key>` | `ktx.yaml` 用 `password: file:/data/lucy/.ktx/secrets/<key>` |
| SecurityContext | `runAsUser: 0`、`allowPrivilegeEscalation: false`、`capabilities.drop: [ALL]` | 当前 image entrypoint 需 root；PSA `restricted` 场景需协商 |
| ServiceAccount | 无额外 RBAC 需求（Lucy 不调用 K8s API） | 客户可 `serviceAccount.create=false` |

### 5.3 `values-example.yaml`（参数示例，非可安装 values）

**用途**：给客户 IT 一份"如果你要往自己的 Chart / values 里塞 Lucy 的字段"参考。文件顶部注释明确：

```yaml
# 这是参数示例（NOT installable values）
# 客户 IT 请按自有 Helm Chart / GitOps 管线抄用相关字段；
# 本文件不能直接 `helm install`。
# 变量名与本仓库 deploy/k8s/helm/lucy/values.yaml 保持一致，方便对照。
```

必须包含的字段（占位用 `REPLACE-ME-*`，客户 IT 抄用时自行替换）：

```yaml
image:
  repository: REPLACE-ME-registry.example.com/data-team/project-lucy
  tag: "0.16.0"
  pullPolicy: IfNotPresent           # 无 registry 场景可用 Never（前提：每节点已 docker load）
imagePullSecrets: []                  # 私有 registry 场景填客户 dockerconfig secret

replicaCount: 1                       # 硬约束：不得改
# strategy: Recreate                  # 由 chart / 客户 GitOps 保证；此处仅注释提醒

service:
  type: ClusterIP
  webuiPort: 5174
  mcpPort: 7879
  # 严禁把 7878 加进 Service ports

persistence:
  enabled: true
  accessModes: [ReadWriteOnce]
  size: 20Gi
  storageClass: REPLACE-ME-storage-class

env:
  LUCY_PUBLIC_MCP_URL: REPLACE-ME-https://lucy.example.com/mcp
  LUCY_ALLOW_PLACEHOLDER_KTX: ""     # 生产必须空；首次 seed 时临时设 "1"
  KTX_PROJECT_ROOT: /data/lucy
  POSTHOG_DISABLED: "1"

existingSecret: REPLACE-ME-lucy-db-secrets   # 客户已有的 Secret 名
extraSecretData: {}                          # 生产必须空

ingress:
  enabled: false                              # 客户按自有 Ingress 现状决定；如已有 nginx-ingress / traefik，把 enabled=true + className + hosts + tls 补齐

startupProbe:
  exec:
    command: [/app/scripts/docker-healthcheck.sh]
  failureThreshold: 60

livenessProbe:
  httpGet:
    path: /api/health
    port: webui

resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits:   { cpu: "2",  memory: 2Gi }
```

**明确不含**：`extraSecretData.demo-password`、`env.LUCY_ALLOW_PLACEHOLDER_KTX: "1"`（这两个只在 `reference/helm-chart/examples/values.local-test.yaml` 里，kind-only）。

### 5.4 `请先阅读.md` 必须覆盖章节

1. 本包定位（K8s 集成交付；**不含**可 `helm install` 的 Chart）
2. 首读顺序：`请先阅读.md` → `集成说明.md` → `K8s部署契约.md` → `values-example.yaml` → `验收命令.sh`
3. 私有 registry 通俗解释（1 段）：
   > 私有 registry = 客户内网的容器镜像仓库（Harbor / Nexus / 云厂商容器镜像服务等）。K8s 集群启动 pod 时从它拉镜像。本包直接给 `image/project-lucy-*.tar`；客户 IT 按自有习惯 `docker load` 后推到自有仓库，或每节点 `docker load` 后 `imagePullPolicy: Never`，两种方式本包都支持。
4. `reference/helm-chart/` 定位：**仅参考，客户仍用自有 Chart**
5. 安全提示：包内**零** secret；DB 密码 / MCP Token 由客户 IT 现场创建 K8s Secret
6. 反馈渠道：`Forrest219/lucy-customer-delivery` issue / 联系人

### 5.5 `验收命令.sh` 必须覆盖步骤

```
Usage: bash 验收命令.sh [--namespace <ns>] [--release <name>] [--public-mcp-url <url>] [--token <bearer>]
```

流程（每步 exit 非 0 打印中文错误 + 建议动作）：

1. 校验包完整性：`sha256sum -c SHA256SUMS`
2. 校验 image tar 存在 + 大小合理（>500 MB）
3. 若 `docker` 可用：`docker load -i image/*.tar` + `docker image inspect --format '{{.Os}}/{{.Architecture}}'` == `linux/amd64`
4. 若 `kubectl` 可用 + 传了 `--namespace` + `--release`：`kubectl -n <ns> get pods -l app.kubernetes.io/instance=<release>`；Pod `Ready 1/1` + `RESTARTS <= 3`
5. `kubectl exec deploy/<release> -- ktx --version` 期望 `@kaelio/ktx 0.16.0`
6. `kubectl port-forward svc/<release> 5174:5174 7879:7879` + `curl -fsS http://127.0.0.1:5174/api/health` 期望 200 + `bundledKtxVersion=="0.16.0"`
7. 若传了 `--public-mcp-url` + `--token`：`curl -X POST <url> -H "Authorization: Bearer <token>" ... {"method":"initialize"}` 期望 200 + `serverInfo.name=="lucy-mcp-proxy"`
8. 打印 `✅ 验收通过`

### 5.6 `集成说明.md` 必须覆盖章节

1. 集成拓扑（Lucy Pod / Service / Ingress / 客户 DB 关系图，可 ASCII）
2. 镜像使用（`docker load` → 推 registry / 每节点 load 两种路径）
3. `customer-config-template/` 使用（对齐 `/data/lucy` 目录契约）
4. Secret 交付（客户自选 K8s Secret / SealedSecret / ExternalSecret / CSI）
5. `values-example.yaml` 字段导览（哪些必须客户 IT 抄；哪些可选）
6. 首次安装流程摘要（客户按自有 Chart / GitOps 执行，本文档只列必须涵盖的动作序列）
7. 验证（引用 `验收命令.sh`）
8. 升级 / 回滚 / 卸载（Helm Recreate 会有 downtime；PVC 默认不删）
9. 排障 5 项：`ImagePullBackOff` / `PVC Pending`（无默认 StorageClass）/ `CrashLoopBackOff w/ CHANGE-ME ktx.yaml` / MCP handshake 401 / 手工加 `7878` 到 Service（安全红线）
10. 回滚数据的路径（PVC 备份建议）
11. Non-Goals（对齐本 WO §1.4）

### 5.7 仓库 `main` 侧改动

| 文件 | 动作 |
|---|---|
| `README.md` | 顶部"最新交付"更新为 `lucy-k8s-integration-20260827-v1`；旧版链接下移到"历史交付"；边界说明不动（仍强调"不含可安装 Chart"） |
| `RELEASE_NOTES.md` | 顶部追加 `## 20260827-v1` 段落：新版包内变更（镜像哈希 / KTX 版本 / customer-config-template 变更 / 集成说明修订点） |

---

## 6. 分步执行计划

每一步：**动作 → 产出 → 验证方式**。

### Step 1 — 判定是否需要重构建镜像

- **动作**：
  ```bash
  cd project-lucy
  git log --since=2026-07-27 --oneline -- \
    Dockerfile package.json \
    webui/server/ webui/webui/src/ \
    customer-config.example/ webui/config/access.yaml
  ```
- **产出**：`inbox/customer-k8s-integration-build/git-since-last-delivery.log`
- **验证 / 分支**：
  - **默认走重构建**：`bash scripts/build-customer-amd64-image.sh`（G1–G4）。历史 `inbox/customer-amd64-offline-package/image/*.tar` **禁止盲复用**（2026-08-27 坏包事故）。
  - 仅当本地镜像 **本轮** 已当场通过 G2–G4（同 digest）时，才可跳过 rebuild；出包前仍须再跑一遍 G2–G4。
  - 构建失败（Hub 超时等）→ 停工，**不得**用旧坏包顶替。

### Step 2 — 生成中文文档（`请先阅读.md` / `集成说明.md` / `K8s部署契约.md`）

- **动作**：新写三个中文文档；结构与内容按 §5.4 / §5.6 / §5.2 骨架
- **产出**：`inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1/请先阅读.md`、`集成说明.md`、`K8s部署契约.md`
- **验证**：人工 review；引用的字段与 `deploy/k8s/helm/lucy/values.yaml` / `templates/deployment.yaml` 严格一致（`grep` 交叉核对端口 / env / probe / securityContext 字段）

### Step 3 — 生成 `values-example.yaml`

- **动作**：按 §5.3 字段清单落盘；文件顶部大段注释明确"非可安装 values"
- **产出**：同目录 `values-example.yaml`
- **验证**：
  ```bash
  # 语法（YAML 可解析）
  python3 -c "import yaml; yaml.safe_load(open('.../values-example.yaml'))"
  # 关键字段一致：与 chart values.yaml 字段名匹配
  diff <(grep -oE '^[a-zA-Z]+:' deploy/k8s/helm/lucy/values.yaml | sort -u) \
       <(grep -oE '^[a-zA-Z]+:' .../values-example.yaml | sort -u)
  ```

### Step 4 — 写 `验收命令.sh`

- **动作**：按 §5.5 流程；`set -eo pipefail`；中文错误消息；`--help` 输出中文
- **产出**：同目录 `验收命令.sh`（`chmod +x`）
- **验证**：
  ```bash
  bash -n .../验收命令.sh          # 语法
  shellcheck .../验收命令.sh        # 无 error
  bash .../验收命令.sh --help       # 中文 usage
  ```

### Step 5 — 准备 `image/`

- **动作**：
  ```bash
  PKG=inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1
  mkdir -p $PKG/image

  # Step 1 判定分支：
  # (a) 复用：
  cp inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar \
     $PKG/image/
  # (b) 重构建：从 release/ 或 inbox/customer-k8s-integration-build/ 拷贝新 tar

  # 元数据
  docker image inspect project-lucy:customer-amd64-0.16.0 --format '{{.Id}}' \
    > $PKG/image/image-digest.txt
  docker image inspect project-lucy:customer-amd64-0.16.0 \
    > $PKG/image/image-inspect.json
  ```
- **产出**：`image/*.tar`、`image-digest.txt`、`image-inspect.json`
- **验证**：
  ```bash
  test "$(jq -r '.[0].Os + "/" + .[0].Architecture' $PKG/image/image-inspect.json)" = "linux/amd64"
  bash scripts/assert-image-elf-arch.sh project-lucy:customer-amd64-0.16.0 amd64
  ```

### Step 6 — 准备 `customer-config-template/`

- **动作**：
  ```bash
  cp -R customer-config.example $PKG/customer-config-template
  # 清理任何残余 secret 文件
  rm -rf $PKG/customer-config-template/.ktx/secrets/*
  # 保留空 README 说明
  mkdir -p $PKG/customer-config-template/.ktx/secrets
  cat > $PKG/customer-config-template/.ktx/secrets/README <<'EOF'
  # 客户现场把 secret 落到这里，例如：
  #   /data/lucy/.ktx/secrets/mysql-password
  #   /data/lucy/.ktx/secrets/customer-db-password
  # 建议通过 K8s Secret 挂载，本包不包含真实密码。
  EOF
  # 顶层 README 中文
  # ... 写 customer-config-template/README.md ...
  ```
- **产出**：`customer-config-template/` 子树
- **验证**：
  ```bash
  npm run smoke:p0:headless-config -- --root $PKG/customer-config-template --require-secret-files
  # 8/8 PASS 或明确列出的 secret-files 缺失（本包故意不带 secret）
  ```

### Step 7 — 准备 `reference/`

- **动作**：
  ```bash
  mkdir -p $PKG/reference/helm-chart
  cp -R deploy/k8s/helm/lucy/. $PKG/reference/helm-chart/

  # 中文精简版（Builder 翻译）
  # $PKG/reference/深度参考-K8s部署指南.md  ← docs/customer-k8s-deployer-quickstart.md
  # $PKG/reference/管理指南.md              ← docs/admin-guide.md
  # $PKG/reference/安全指南.md              ← docs/security-guide.md
  ```
- **产出**：`reference/` 子树
- **验证**：`ls $PKG/reference/helm-chart/templates/*.yaml` 与 `deploy/k8s/helm/lucy/templates/` 完全一致；三个翻译文档存在且包含元数据表

### Step 8 — `RELEASE_NOTES.md` + `SHA256SUMS`

- **动作**：
  ```bash
  # RELEASE_NOTES.md：Chart 版本、KTX 版本、image digest、相对上版的变更、已知风险
  # SHA256SUMS：包内所有文件（相对包根）
  cd $PKG
  (find . -type f ! -name 'SHA256SUMS' ! -name '.DS_Store' \
    -print0 | sort -z | xargs -0 sha256sum) > SHA256SUMS
  ```
- **产出**：`RELEASE_NOTES.md`、`SHA256SUMS`
- **验证**：`sha256sum -c SHA256SUMS`（在包根执行）全绿

### Step 9 — 打包 tar.gz + 外层 sha256

- **动作**：
  ```bash
  cd inbox/customer-k8s-integration-build
  tar -czf lucy-k8s-integration-delivery-20260827-v1.tar.gz \
    lucy-k8s-integration-delivery-20260827-v1/
  sha256sum lucy-k8s-integration-delivery-20260827-v1.tar.gz \
    > lucy-k8s-integration-delivery-20260827-v1.tar.gz.sha256
  ls -lh lucy-k8s-integration-delivery-20260827-v1.tar.gz*
  ```
- **产出**：`lucy-k8s-integration-delivery-20260827-v1.tar.gz` + `.sha256`
- **验证**：
  ```bash
  # 大小合理（~900 MB ± 50 MB）
  # 完整性
  sha256sum -c lucy-k8s-integration-delivery-20260827-v1.tar.gz.sha256
  # 内容清单
  tar -tzf lucy-k8s-integration-delivery-20260827-v1.tar.gz | head -40
  tar -tzf lucy-k8s-integration-delivery-20260827-v1.tar.gz | wc -l
  ```

### Step 10 — 自检解压 + 跑 `验收命令.sh` 前半段（离线部分）

- **动作**：
  ```bash
  VERIFY=/tmp/lucy-integration-verify-20260827
  rm -rf $VERIFY; mkdir -p $VERIFY
  tar -xzf inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1.tar.gz \
    -C $VERIFY
  cd $VERIFY/lucy-k8s-integration-delivery-20260827-v1
  bash 验收命令.sh            # 无 --namespace 参数时只跑离线校验（sha256、image tar、docker load）
  ```
- **产出**：`inbox/customer-k8s-integration-build/verification/onsite-offline-check.log`
- **验证**：`验收命令.sh` 前 3 步全绿；`docker image inspect` `linux/amd64`

### Step 11 — kind 端到端自检（用 `values-example.yaml` 抄进 chart 反推验证契约）

> 目的：**不是**给客户跑；只是我方出包前的最后一道 gate，确保 `values-example.yaml` 的字段与 chart 契约 100% 一致。

- **动作**（复现 `inbox/k8s-helm-draft/validation/validation-notes.md` §7，用 `values-example.yaml` + 必要的 `--set` 覆盖占位）：
  ```bash
  kind create cluster --name lucy-integration-verify --wait 180s
  kind load docker-image project-lucy:customer-amd64-0.16.0 --name lucy-integration-verify

  helm upgrade --install lucy deploy/k8s/helm/lucy \
    -n lucy --create-namespace \
    -f $VERIFY/lucy-k8s-integration-delivery-20260827-v1/values-example.yaml \
    --set image.repository=project-lucy \
    --set image.tag=customer-amd64-0.16.0 \
    --set image.pullPolicy=Never \
    --set persistence.storageClass=standard \
    --set env.LUCY_PUBLIC_MCP_URL=http://lucy.integration-verify.example.com/mcp \
    --set env.LUCY_ALLOW_PLACEHOLDER_KTX=1 \
    --set existingSecret="" \
    --set extraSecretData.demo-password=change-me

  kubectl -n lucy wait --for=condition=Ready pod -l app.kubernetes.io/name=lucy --timeout=300s
  kubectl exec -n lucy deploy/lucy -- ktx --version | grep -q "0.16.0"
  kubectl port-forward -n lucy svc/lucy 5174:5174 7879:7879 &
  sleep 3
  curl -fsS http://127.0.0.1:5174/api/health | jq -e '.data.bundledKtxVersion=="0.16.0"'

  kill %1
  helm uninstall lucy -n lucy
  kind delete cluster --name lucy-integration-verify
  ```
- **产出**：`inbox/customer-k8s-integration-build/verification/kind-e2e.log`
- **验证**：所有断言 exit 0；`/api/health` 200 + `bundledKtxVersion==0.16.0`；`ktx --version` == `@kaelio/ktx 0.16.0`

### Step 12 — 更新 `Forrest219/lucy-customer-delivery` `main` 分支

- **动作**：
  1. `git clone git@github.com:Forrest219/lucy-customer-delivery.git`（用户会给凭证）
  2. 更新 `README.md`（顶部"最新交付"、旧版下移到"历史交付"）
  3. 更新 `RELEASE_NOTES.md`（追加 `## 20260827-v1` 段，内容与包内 `RELEASE_NOTES.md` 一致或摘要）
  4. `git commit -m "chore(release): lucy-k8s-integration-20260827-v1"`
  5. `git push`
- **产出**：`main` 分支 2 个文件的 commit
- **验证**：GitHub 上 `README.md` / `RELEASE_NOTES.md` 更新；无其他文件改动

### Step 13 —（可选）GitHub Release 挂大包

- **默认跳过**。仅当委托人要求「大包也挂 Releases」时执行。
- 手册更新仍走 Step 12：`git push` 到 `Forrest219/lucy-customer-delivery` 的 `main`（README / 说明 / 契约 / values-example / 验收命令）。
- 大包交接：把 `inbox/customer-k8s-integration-build/*.tar.gz` + `.sha256` 交给委托人另渠道发送；README 写清「镜像包另行获取，本仓库仅手册」。

- **动作**（用 `gh` CLI 或 GitHub Web）：
  ```bash
  cd lucy-customer-delivery
  git tag lucy-k8s-integration-20260827-v1
  git push origin lucy-k8s-integration-20260827-v1

  gh release create lucy-k8s-integration-20260827-v1 \
    --repo Forrest219/lucy-customer-delivery \
    --title "Lucy K8s Integration Delivery 20260827-v1" \
    --notes-file <(sed -n '/^## 20260827-v1/,/^## /p' RELEASE_NOTES.md | sed '$d') \
    ../inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1.tar.gz \
    ../inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1.tar.gz.sha256
  ```
- **产出**：GitHub Release `lucy-k8s-integration-20260827-v1` + 2 个 Assets
- **验证**：
  ```bash
  gh release view lucy-k8s-integration-20260827-v1 --repo Forrest219/lucy-customer-delivery
  # Assets 应该包含 .tar.gz 和 .tar.gz.sha256，大小合理
  ```

### Step 14 — 邮件 / 消息通知草稿

- **动作**：写 `inbox/customer-k8s-integration-build/lucy-k8s-integration-20260827-v1-notice.md`（中文），内容：Release 链接、Asset SHA256、变更摘要、验收路径、联系人
- **产出**：通知草稿
- **验证**：包含 Release URL、SHA256 值、变更摘要 3 项

---

## 7. 验收 Standard（Gate）

出包前必须全部通过：

| # | Gate | 命令 | 通过标准 |
|---|---|---|---|
| G1 | 判定 diff 完成 | 检查 Step 1 log 存在 | 存在，且路径决策明确 |
| G2 | 镜像元数据 | `docker image inspect --format '{{.Os}}/{{.Architecture}}'` | `linux/amd64` |
| G3 | **ELF 门禁（硬门禁）** | `bash scripts/assert-image-elf-arch.sh <tag> amd64` | exit 0；**node + tini** 均为 x86-64 |
| G3b | **运行时 smoke（硬门禁）** | `docker run --rm --platform linux/amd64 --entrypoint /bin/sh <tag> -c 'echo ok'` | exit 0 |
| G4 | KTX 版本 | `docker run --rm --platform linux/amd64 --entrypoint ktx <tag> --version` | 含 `0.16.0` |
| G4 | image 元数据落包 | `test -f image/image-digest.txt && test -f image/image-inspect.json` | 存在 |
| G5 | customer-config 冒烟 | `npm run smoke:p0:headless-config -- --root $PKG/customer-config-template --require-secret-files` | 8/8 PASS 或仅 secret-files 缺失 |
| G6 | `values-example.yaml` YAML 合法 | `python3 -c 'import yaml; yaml.safe_load(open(...))'` | exit 0 |
| G7 | `values-example.yaml` 字段与 chart 一致 | 见 Step 3 diff | 无孤儿字段 |
| G8 | 中文文档存在 | `test -f 请先阅读.md && test -f 集成说明.md && test -f K8s部署契约.md` | 存在 |
| G9 | 中文文档覆盖 §5.4 / §5.6 / §5.2 章节 | 人工 review | Pass |
| G10 | `验收命令.sh` shellcheck | `shellcheck 验收命令.sh` | no error |
| G11 | Service 契约不含 7878 | `grep -rE '7878' $PKG/K8s部署契约.md $PKG/values-example.yaml` | 只在"严禁暴露"上下文出现，不作为 Service port |
| G12 | 包内不含 secret | `grep -rE '(BEGIN.*PRIVATE\|-----.*KEY-----\|password.*=.*[a-zA-Z0-9]{8,})' $PKG` 过滤已知模板占位 | 无真实 secret |
| G13 | 包 SHA256SUMS 完整 | `sha256sum -c SHA256SUMS`（在包根执行） | 全绿 |
| G14 | tar.gz 完整性 | `sha256sum -c *.tar.gz.sha256` | exit 0 |
| G15 | 解压后自检 | Step 10 `验收命令.sh` 离线部分 | 前 3 步全绿 |
| G16 | kind e2e | Step 11 全流程 | Pod Ready + `/api/health` 200 + `ktx --version` 0.16.0 |
| G17 | `main` 更新 | `git diff origin/main` 只含 README / RELEASE_NOTES | 无其他文件改动 |
| G18 | Release 创建 | `gh release view` 有 2 个 Assets | Pass |

---

## 8. 分支决策（Builder 第一步就要拍板）

Step 1 判定的两条路径决定后续 12 步的工作量：

### 分支 A：仅刷说明 / 契约 / 验收脚本（无镜像重构建）

- 触发条件：Step 1 diff 无源码变更
- 复用：`inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar`
- 跳过：镜像重构建、ELF 门禁重跑
- 时间估算：~4 小时（文档翻译 + 打包 + kind 自检 + Release）

### 分支 B：需重构建镜像

- 触发条件：Step 1 diff 有源码 / Dockerfile / customer-config 实质变更
- 走：`docs/plans/wo-202608-07-customer-amd64-delivery.md` §2 单架构 amd64 native 构建（含 buildx builder 创建 + build + ELF 门禁 + smoke:p0:docker + smoke:p0:headless-config）
- 时间估算：~10-15 分钟构建 + 分支 A 的 4 小时

---

## 9. 已知风险与缓解（非 blocking）

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 客户已有 Helm Chart 的字段名与 `values-example.yaml` 不完全一致（客户 Chart 是自研） | `集成说明.md` 强调"抄字段含义，不是 1:1 抄 key"；`K8s部署契约.md` 用中文描述硬约束（端口 / 单副本 / PVC / 不暴露 7878）而非 helm 字段名 |
| R2 | 客户忘了首次开 `LUCY_ALLOW_PLACEHOLDER_KTX=1`，pod 一直 `CrashLoopBackOff` | `集成说明.md §6` 首次流程明确写"若首启启动前 `/data/lucy` 空，请临时设 `LUCY_ALLOW_PLACEHOLDER_KTX=1`；seed 完成后关闭" |
| R3 | 客户忘了关闭 `LUCY_ALLOW_PLACEHOLDER_KTX`，长期允许 CHANGE-ME | `验收命令.sh` 加自检：读 `env` 或 `/api/health` 里的 warning；不通过就打红字 |
| R4 | image tar 大，多节点无 registry 场景分发慢 | `请先阅读.md` 通俗解释 registry；`集成说明.md` 给两种分发路径 + 每节点 load 示例命令 |
| R5 | 客户 PSA `restricted` 拒绝 `runAsUser: 0` | `K8s部署契约.md` 明示"当前需 root 跑 entrypoint；PSA `restricted` 场景请联系我方"（非 root 镜像另立 WO） |
| R6 | 客户误改 Service 加 `7878` port，裸放数据接口 | `K8s部署契约.md` 用 ⚠ + 加粗中文警告；`验收命令.sh` 可选自检：`kubectl get svc <name> -o jsonpath` 若含 `7878` 直接红字失败 |
| R7 | `reference/helm-chart/examples/values.local-test.yaml` 含 `LUCY_ALLOW_PLACEHOLDER_KTX=1` + `extraSecretData.demo-password`；客户误抄 | `请先阅读.md` 明确 "**`reference/` 仅作参考，客户仍用自有 Chart 与 values；生产禁止直接抄 `reference/helm-chart/examples/`**" |
| R8 | 客户 K8s 无默认 StorageClass → PVC Pending | `values-example.yaml` 把 `persistence.storageClass` 列为必填占位；`集成说明.md §9` 排障表列出该场景 |

---

## 10. 未决问题（最多 2 个，需 xingchen 拍板后 Builder 才开工）

| # | 未决问题 | 需要的信息 | 建议默认 |
|---|---|---|---|
| Q1 | 本轮是否必须换新镜像？ | Step 1 diff 结果 + 是否有紧急修复需要落客户；或告知"本轮无源码更新，只刷文档" | 假设 **分支 A**（仅刷说明/契约/验收）→ 复用 `project-lucy:customer-amd64-0.16.0`；Builder 第一步跑 `git log --since=2026-07-27` 若有实质源码 diff 再切分支 B |
| Q2 | 本次 `customer-config-template/` 是否有变更？ | 客户之前给的 config 是否已更新；access.yaml 中的 role / connection 定义是否要同步 | 假设 **无变更** → 直接从 `customer-config.example/` 拷贝，去 secret 后入包；如客户给了新 config，Builder 把该 config 覆盖到 `customer-config-template/` 再入包 |

其他历史 blocking 项（v1.0 的 Q1 私有 registry / Q2 Ingress / Q3 sealed-secrets）**已在 v1.1 撤销**，均降级为"客户 IT 按自有环境调整"，非本 WO 阻塞项。

---

## 11. 降级的旧路径（v1.0 曾主张，v1.1 保留为可选内部工具）

以下资产**不进**本次交付包，但**保留**在本仓库内作为我方在客户现场协助时的手动工具，或后续 WO 演进的备料：

| 资产 | 现状 | 用途 | 是否入本次交付包 |
|---|---|---|---|
| `deploy/k8s/helm/lucy/examples/values.local-test.yaml` | 已存在 | kind 自检；chart 测试 | ❌（只作为 `reference/helm-chart/examples/` 一部分随 chart 快照带过去，明确标注 kind-only） |
| `scripts/customer-k8s/seed-context.sh`（v1.0 提议） | **不新建**（本 WO 撤销）；如后续需要，走单独 WO | 现场用 `kubectl cp` 注入 customer-config | ❌ |
| `scripts/customer-k8s/create-secret.sh`（v1.0 提议） | **不新建**（本 WO 撤销） | 交互向导创建 K8s Secret | ❌ |
| `scripts/build-customer-k8s-package.sh`（v1.0 提议） | **不新建**；本 WO 的出包流程直接手动跑 Step 1-14 | 一键出包 | ❌（如未来出包频率提升再抽脚本） |
| `docs/lucy-customer-k8s-offline-delivery-spec.md`（v1.0 提议） | **不新建** | 独立英文 Spec | ❌（本 WO §5 已覆盖 Builder 所需的 Spec 要点） |
| `docs/customer-k8s-offline-onsite-runbook.md`（v1.0 提议） | **不新建** | 现场 1 页 runbook | ❌（`集成说明.md` + `验收命令.sh` 已覆盖） |
| `inbox/customer-k8s-offline-package/`（v1.0 提议目录） | **不新建** | 客户交付根目录 | ❌（本次交付根目录改为 `inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1/`） |

---

## 12. 落位索引

| 产物 | 路径 |
|---|---|
| 本 WO | `docs/plans/wo-202608-27-customer-k8s-delivery.md`（本文件） |
| 出包工作区 | `inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1/` |
| 出包镜像元数据 | `inbox/customer-k8s-integration-build/git-since-last-delivery.log`（Step 1）+ `verification/*.log`（Step 10 / Step 11） |
| tar.gz | `inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260827-v1.tar.gz` |
| tar.gz sha256 | 同上 `.sha256` |
| 通知草稿 | `inbox/customer-k8s-integration-build/lucy-k8s-integration-20260827-v1-notice.md` |
| Release URL（Builder 完成后填） | `https://github.com/Forrest219/lucy-customer-delivery/releases/tag/lucy-k8s-integration-20260827-v1` |
| 上一版 Release（历史参照） | `https://github.com/Forrest219/lucy-customer-delivery/releases/tag/lucy-k8s-integration-20260727-v2` |

---

## Terminology Compliance

本 WO 遵循 `webui/docs/00-product-terminology-standard.md`。

本 WO 使用 / 引入的术语：

- **lucy-k8s-integration-delivery**：客户 K8s 集成交付包（tar.gz Asset），沿用上次命名规范；面向"客户已有 K8s + Helm 体系"的集成场景，与 `customer-amd64-offline-package`（Docker Compose 离线包）平行、独立。
- **私有 registry**：客户内网容器镜像仓库（Harbor / Nexus / 云厂商容器镜像服务等）；本 WO 明确不作为开工前置。
- **values-example.yaml**：参数示例文件，**非**可 `helm install` 的 values；供客户 IT 抄字段含义到自有 Chart。
- **reference/helm-chart**：本仓库 `deploy/k8s/helm/lucy/` 的只读快照，随包分发但明示"仅参考，客户仍用自有 Chart"。
- **K8s 部署契约**（`K8s部署契约.md`）：端口 5174/7879、单副本、Recreate、RWO PVC、不暴露 7878、SecurityContext 的硬约束集合；跨 Chart 实现（我方 chart / 客户自研 chart）统一遵守。

UI / 客户可见文案：本次交付包内所有中文文档必须与 `docs/customer-k8s-deployer-quickstart.md` 的英文术语保持双向对齐（Deployment / Service / PVC / MCP Proxy / bundled KTX / customer context package / `/data/lucy`）；不新造未在标准中登记的产品概念。
