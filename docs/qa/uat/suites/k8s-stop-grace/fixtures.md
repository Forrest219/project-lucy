# Fixtures — UAT-SUITE-K8S-STOP-GRACE

| 项 | 要求 |
|---|---|
| 环境档位 | K8s 专用套件，不使用 Docker lean／scale 档。正式证据必须来自原生 amd64 单节点 K3s；Docker／kind arm64／QEMU 不得替代 |
| 节点 | x86_64 Linux，固定 K3s／kubelet 版本；建议至少 4C8G、≥50GB 盘，资源限制与客户配置对齐；记录实际规格 |
| 访问 | `KUBECONTEXT`、`NAMESPACE`、`RELEASE`、`DEPLOYMENT`、`SERVICE` 在跑次脱敏记录；kubeconfig 只记仓库外路径与权限，不复制内容 |
| 隔离 | 每轮独立 namespace／PVC；RWO local-path 或合同台既定 StorageClass；不得使用客户 namespace／PVC |
| 改前身份 | 现行 Chart 包版本／摘要、现行镜像 digest、旧 Deployment／旧 Pod 有效宽限、P1-83 步骤 1⑥ 跑次路径 |
| 候选身份 | 计划 Chart `0.2.11`（若合入时变化记实际值）、values 摘要、同一产品镜像 digest、运行中 `imageID`；不得虚构新镜像 |
| 合规升级修订 | N＝60 秒、N+1＝75 秒；产品镜像 digest 不变；首升旧 Chart 必须缺宽限字段且单独登记 |
| 数据源 | 真实 KTX＋隔离合成 MySQL；合法轻量查询的独立 SQL oracle；约 10 秒真实数据库延迟查询 |
| 最长路径 | P1-83 步骤 1b 版本化外部注入器、RBAC 清单、故障生效证明与自动清理；不得新增产品 fault switch 或依赖 `inbox/` 临时 runner |
| 凭据 | 管理员凭据与 MCP Token 只从仓库外 0600 文件读入环境变量；只记路径，不写内容；纯 MCP 不带 WebUI Cookie |
| 静态工具 | 既有 `helm`、stock bash 3.2／awk；测试使用项目已有 Node `node:test` 与根依赖 `yaml`；不新增 `yq` 或 vendored 解析器 |
| 静态证据 | 建议 `inbox/p185-static-<日期>/`：渲染摘要、正负控、包布局结果与哈希；只是开发证据，不是正式 UAT 跑次 |
| 正式证据 | `runs/evidence/<run-id>/`：Deployment／Pod JSON、TERM／Probe／Endpoint 时间轴、事件、日志、在途结果、审计 ID／行数／水位、独立 SQL、清理回执、SHA256SUMS |
| 时间 | 所有操作使用统一时区的原始时间戳；另记录单调耗时。改前基线时间必须早于候选首次落台 |
| 停止命令 | `kubectl delete pod` 不传 `--grace-period`，不使用 `--force`；任何显式覆盖只可作补充实验，不得替代默认 60 秒验证 |
| 审计口径 | 删除前已受理、尤其已返回成功请求的唯一 ID 集逐条恰好一次，`ledger_seq` 水位不回退；不得只比总行数；停机后明确拒绝的新请求单独计数，不伪记成功、不自动重放 |
| 主路径 oracle | 每次替换后：同一 PVC＋合法管理读＋纯 MCP `initialize`→`tools/list`→合法只读查询＋独立 SQL 一致；无 WebUI Cookie |
| 浏览器 | 不适用；无 WebUI 用户可见面变更，不做移动窄屏测试 |
| 清理 | 先导出证据，再清本套件 namespace／PVC、注入器、临时连接／Token／合成表；不得清理或改写 P1-83 基线原始证据 |

## 建议变量（值在跑次填写）

```bash
export KUBECONTEXT=<native-amd64-k3s-context>
export NAMESPACE=<isolated-p185-namespace>
export RELEASE=<p185-release>
export DEPLOYMENT=<p185-deployment>
# KUBECONFIG、管理员凭据、MCP Token 均从仓库外受限文件读取，不粘贴到本文件或命令历史。
```

## 静态入口（开发检查，不是 INDEX 判定）

```bash
npm run gate:k8s-static
npm run test:k8s-gate-negative
npm run test:k8s-delivery-package
```

## 既有运行时回归（实现后）

```bash
node --test scripts/runtime/process-drain.test.mjs scripts/runtime/docker-entrypoint.test.mjs
```
