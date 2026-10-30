# project-lucy Agent 开发入口

本仓库的开发治理规则见 [`docs/governance/DEVELOPMENT.md`](docs/governance/DEVELOPMENT.md)。功能闭口与发布取证、以及新 Spec 的唯一文件名，见该文件「功能闭口与发布取证」。
数据问答运行时指导走 Lucy MCP Proxy 的 `initialize` instructions 注入（内容来源 [`webui/config/data-qa-instructions.md`](webui/config/data-qa-instructions.md)，机制见 [`webui/docs/07-mcp-auth-proxy-spec.md`](webui/docs/07-mcp-auth-proxy-spec.md) §4.4），不再由 [`CLAUDE.md`](CLAUDE.md) 承载——`CLAUDE.md` 现在只做指引，不得再写入数据问答规则正文；如发现回归，请改回纯引用。

Vibe coding 双核角色协作（thinker / builder）的可选完整交付流水线见 [`docs/agent-pipeline.md`](docs/agent-pipeline.md)，按需调用，非必经流程。

## 环境与交付背景（勿混淆）

| 环境 | 硬件 / 平台 | 用途 |
|---|---|---|
| 开发环境 | Apple Silicon Mac（arm64）+ Docker Desktop | 本地开发、demo、冒烟验证、出客户镜像包 |
| 客户环境 | amd64（x86_64）服务器；部署方式按客户环境确定 | 最终交付与运行；当前已验证的正式交付形态为 Kubernetes |

由此派生的硬约束：

- **客户镜像是 linux/amd64 单架构**，但构建发生在 arm64 Mac 上：允许 `lucy-amd64` builder + QEMU 跨架构构建，**必须**完整过 G1–G4 硬门禁（ELF 架构门禁不得以元数据代替），禁止 `FROM --platform=$BUILDPLATFORM`，禁止 `docker buildx create --use`（会污染本机 demo 默认 builder）。口径见 [`docs/specs/lucy-customer-amd64-offline-delivery-spec.md`](docs/specs/lucy-customer-amd64-offline-delivery-spec.md) v0.3+ 与 [`docs/runbooks/customer-amd64-image-build-checklist.md`](docs/runbooks/customer-amd64-image-build-checklist.md)。
- **本地脚本必须兼容 stock macOS bash 3.2**（`readarray` / `mapfile` / 负数数组下标均不可用），相关回归门禁见 `scripts/upgrade/upgrade-lucy.test.mjs`。
- 单机 compose 栈（`deploy/compose/`）是开发/演示与升级验证环境，**不是**已完成客户验收的交付形态；当前正式客户交付以 [`deploy/k8s/helm/lucy/`](deploy/k8s/helm/lucy/) Chart + amd64 镜像为准（契约见 `deploy/k8s/K8S_CONTRACT.md`）。新增 Docker 或其他客户交付形态前，必须另行补齐交付契约及安装、升级、备份恢复、引导密钥和验收门禁。

## 部署方式与版本制品解耦（全局原则）

- **部署方式按客户环境选择，不把 Helm、Docker 或 Kubernetes 绑定为 Lucy 产品本身的统一前置条件。** Kubernetes 技术上也不强制使用 Helm；可以采用纯 Manifest、Kustomize 等方式，但只有经过对应交付验证的路径才能声明为受支持。当前已验证的标准 Kubernetes 交付路径使用 Helm CLI。
- **产品版本与部署制品版本解耦。** 同一批产品能力无论通过 Docker、Helm Chart、纯 Manifest 或其他方式交付，都使用同一个 Lucy 产品版本；不得按部署渠道分叉产品版本线或让同一代码在不同渠道使用不同产品版本。
- **各类制品独立编号。** Lucy 产品版本、容器镜像标签、Helm Chart 包版本、交付包修订号和捆绑 KTX 版本互不推导。只修改 Chart 而镜像摘要不变时，可以只递增 Chart 版本，不天然要求产品升版。
- **同一产品版本可以发布一种或多种交付制品。** 发版台账必须按制品分别记录版本、摘要、支持状态和门禁结果；未发布的制品须说明原因。任何一种部署路径通过验收，都不能推定其他路径已经通过。
- 新增部署方式属于交付范围扩展，不得夹在无关的产品版本修正中默认完成；必须先明确支持边界并完成对应验证。

## 客户部署包与引导密钥（每次出包强制遵守）

- 面向首次创建管理员的客户生成部署包时，必须在供应方同次出包中同步生成或复用 `webui-bootstrap-token`，配齐实例签发状态、凭据元数据和使用说明；不得把生成、补齐或手工改绑密钥的工作留给部署人员。
- 同一逻辑实例重出包、版本升级或部署重试复用原密钥；不同实例分别签发；已有管理员不新发密钥、不重开认领。
- 密钥必须与部署入口实际读取的值一致。私有附件缺失、绑定不符或复用验证未通过，均视为客户部署交付未完成，禁止发出声称可部署的客户包。
- 通用镜像和公共软件包仍不含密钥；客户私有附件与软件包成套交付，不能把同一密钥随公共包分发给多个客户。私有附件保存在 Git、inbox、构建上下文和公共上传目录之外，目录 0700、文件 0600，不打印密钥内容。
- 出包前必须执行 [客户升级交付 Checklist](docs/runbooks/customer-v2-upgrade-release-checklist.md) 的 C01、C05、C20 及其他适用项。自动化尚未覆盖的步骤由供应方在同次出包补齐并验证，不得降级为部署人员补密钥。

具体原则和实现见 [出包时配套生成引导密钥](docs/plans/2026-10-20-build-time-bootstrap-credential-plan.md)。标准出包入口已自动生成/复用私有附件并执行 C20 门禁；自动化未覆盖的新场景仍由供应方在同次出包补齐并验证。

## KTX 依赖边界与开发优先级

KTX 是 Lucy 引用的上游依赖。本仓库只使用 KTX 提供的 CLI、接口和配置约定，
不修改 KTX 源码。功能开发、缺陷修复、兼容适配和体验优化均以 Lucy 为实施主体；
遇到 KTX 相关问题时，优先在 Lucy 的代理层、适配层、配置或文档中解决。

需要了解 KTX 时，直接查阅以下资料，避免重复搜索：

- [KTX 源码仓库](https://github.com/Kaelio/ktx)
- [KTX Quickstart](https://docs.kaelio.com/ktx/docs/getting-started/quickstart)

## 浏览器测试约束

正式治理见 [`docs/governance/DEVELOPMENT.md`](docs/governance/DEVELOPMENT.md) 的“验证策略：浏览器测试约束”。

简要规则：正常开发任务默认不需要做浏览器测试；Lucy 项目默认不需要做移动窄屏测试。只有在用户、当前任务说明或已批准计划明确要求浏览器测试 / 移动窄屏验证时，才执行对应测试。

## 全系统术语规范

所有 WebUI、API 用户可见错误、Toast、Modal、Drawer、测试断言、Spec、Plan、Runbook 的术语必须遵守
[`webui/docs/00-product-terminology-standard.md`](webui/docs/00-product-terminology-standard.md)。

新模块新增产品概念时，必须先补充术语标准或在功能 Spec 的 `Terminology Compliance`
小节登记，再写 UI 文案、API 用户可见错误或测试断言。专业英文术语、数据库对象名、
文件名、路径和 URL 的 DOM 节点必须按标准添加浏览器翻译防御。

## 临时文件落位

默认临时文件、一次性审计输出、过程性报告落在仓库根目录 [`inbox/`](inbox/)。
`inbox/` 定位为 tmp 文件夹，进程结束后可随时删除。

项目本身的正式 spec、代码、配置、运行时上下文不属于此约定；这些文件仍按
[`docs/governance/DEVELOPMENT.md`](docs/governance/DEVELOPMENT.md) 的落位规则维护。
