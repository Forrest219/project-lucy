# Lucy 客户交付与镜像上线 Checklist（通用防坑指南）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer Delivery Preflight Checklist |
| 文档类型 | Governance / Quality Gate / Runbook |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-28 |
| 适用范围 | 所有交付给客户的 Docker Compose 离线包、Kubernetes / Helm 集成包及 Release Assets |
| 关联文档 | [`docs/customer-amd64-image-build-checklist.md`](customer-amd64-image-build-checklist.md)、[`docs/customer-k8s-deployer-quickstart.md`](customer-k8s-deployer-quickstart.md)、[`docs/customer-deployment-guide.md`](customer-deployment-guide.md) |

---

## 核心复盘与四大铁律

在过往交付客户（尤其离线无外网环境）中，曾暴露四大致命故障。**后续任何发版出包，必须遵循四大铁律：**

1. **二进制架构铁律（防 `exec format error`）**：禁止仅凭 `docker inspect` 的 `Architecture=amd64` 结论出包。在 Apple Silicon / 多架构环境构建时，必须提取镜像内 `node` 和 `tini` 执行 ELF 校验（必须为 x86-64）。
2. **离线运行时铁律（防 `could not download uv`）**：客户环境无法连公网。镜像必须完整预装 KTX Python runtime，出包前必须在 `--network=none` 下通过 `ktx --version` 启动与运行时文件存在性校验。
3. **MCP Advertise 地址铁律（防「Lucy MCP 未就绪」）**：客户部署必须显式注入 `LUCY_PUBLIC_MCP_URL`（如 `https://lucy.example.com/mcp`）。禁止留空、保留占位符或填 `127.0.0.1`，避免 WebUI 产生 `fallback` 假象。
4. **禁止盲复用铁律（防坏包扩散）**：禁止直接复制任何未过本轮全套门禁的历史 `*.tar`。每次升级或出包必须当场重跑全套 Gates，坏包必须原地作废并升 Release tag。

---

## 阶段一：研发 / 出包端镜像构建与验证（G 门禁）

在具备公网的构建机上执行构建与严格门禁（一键入口：`bash scripts/build-customer-amd64-image.sh`）：

| # | Gate | 命令 / 动作 | 检验标准 |
|---|---|---|---|
| **G0** | 构建参数 | `docker buildx build --platform linux/amd64 --build-arg TARGETPLATFORM=linux/amd64 --build-arg TARGETARCH=amd64 ...` | 显式声明目标架构；禁止 `FROM --platform=$BUILDPLATFORM` |
| **G1** | 镜像元数据 | `docker image inspect <tag> --format '{{.Os}}/{{.Architecture}}'` | 必须输出 `linux/amd64` |
| **G2** | **ELF 二进制** | `bash scripts/assert-image-elf-arch.sh <tag> amd64` | `node` 与 `tini` 均为 x86-64，严禁含 aarch64 |
| **G3** | 启动 Smoke | `docker run --rm --platform linux/amd64 --entrypoint /bin/sh <tag> -c 'echo ok'` | Exit 0 |
| **G4** | KTX CLI 版本 | `docker run --rm --platform linux/amd64 --entrypoint ktx <tag> --version` | 包含指定版本（如 `@kaelio/ktx 0.16.0`） |
| **G4b-1** | **Python 运行时** | `docker run --rm --platform linux/amd64 --entrypoint /bin/sh <tag> -c 'test -x /root/.ktx/runtime/0.16.0/.venv/bin/python'` | Exit 0，确认 runtime 完整落盘 |
| **G4b-2** | **无网离线启动** | `docker run --rm --network=none --platform linux/amd64 --entrypoint ktx <tag> --version` | 退出码 0 且版本正确（证明不依赖实时下载 uv） |
| **G5** | 仓库冒烟 | `npm run smoke:p0:docker` | 全绿（覆盖真实 DuckDB/KTX 查询链路） |
| **G6** | 交付隔离门禁 | `npm run smoke:p0:delivery-isolation` | 确保客户镜像中不含开发态内部路径 |

---

## 阶段二：Helm Chart 与交付包组装（K 门禁）

### 1. Helm Chart 守卫验证
- [ ] **空 URL 渲染阻断**：当 `image.repository != project-lucy` 且 `env.LUCY_PUBLIC_MCP_URL` 为空、含 `REPLACE-ME` 或 `127.0.0.1` 时，`helm template` 必须 fail 报错。
- [ ] **合法配置放行**：配置合法公网/网关 URL 后，`helm template` 正常输出。
- [ ] **端口守卫**：Service 仅暴露 WebUI 与 MCP Proxy；**严禁暴露 7878**（KTX upstream 仅 Pod 内）。
- [ ] **容器/Service 端口分离**：容器固定监听 `5174`/`7879`；外部 `8276`/`8277` 等仅在 Service 层映射。
- [ ] **探针守卫**：Startup/Readiness 使用 HTTP `GET /api/health`；渲染结果不得含 `runtime-preflight`、`k8s-preflight.sh` 或 exec `docker-healthcheck.sh`。
- [ ] **静态门禁脚本**：`bash scripts/helm-lucy-gate.sh` 通过。
- [ ] **单副本与 Recreate 约束**：`replicaCount=1`，`strategy.type=Recreate`。

### 2. 交付包封包与自检
- [ ] **K1 现场导出**：G0–G6 全通过后执行 `docker save -o release/<name>.tar <tag>`。
- [ ] **K2 元数据固化**：包内写入 `image-inspect.json`、`image-digest.txt`、`image-arch.txt`。
- [ ] **K3 解压后重验**：解压出的镜像在本地执行 `docker load`，重跑 G2 + G3 + G4b。
- [ ] **K4 校验和清单**：生成包内 `SHA256SUMS` 与外层 `*.tar.gz.sha256`。

---

## 阶段三：Release 与文档同步

- [ ] **新建 Release Tag**：版本升号（如 `lucy-k8s-integration-YYYYMMDD-vN`），严禁覆盖旧 Release。
- [ ] **作废说明**：若有历史坏包，在 Release Notes 与 README 中明确标注作废原因（如 `20260827-v1 arm64 ELF 作废`）。
- [ ] **资产完整性**：上传 `*.tar.gz` 与 `*.tar.gz.sha256`，校验下载链接与哈希值。
- [ ] **手册同步**：更新 `Forrest219/lucy-customer-delivery` 仓库 `main` 分支的文档及指向。

---

## 阶段四：现场交付与安装验收（交付经理执行）

在客户内网服务器或集群上执行：

### 1. 部署前检查
- [ ] **禁止现场 build**：内网环境严禁执行 `docker build` / `docker compose build`，必须使用交付包中的 `image/*.tar`。
- [ ] **SHA256 核验**：`shasum -a 256 -c *.tar.gz.sha256` 确认包完整。
- [ ] **架构再次确认**：
  ```bash
  docker load -i image/project-lucy-customer-amd64-0.16.0-image.tar
  docker image inspect project-lucy:customer-amd64-0.16.0 --format '{{.Os}}/{{.Architecture}}'
  # 必须为 linux/amd64
  ```

### 2. 配置与启动
- [ ] **LUCY_PUBLIC_MCP_URL 配置**：设置为外部 Agent 实际访问的完整 URL（如 `https://lucy.<客户域名>/mcp`）。
- [ ] **数据库凭据**：通过 Secret 注入到 `/data/lucy/.ktx/secrets/<key>`，权限 `600`。
- [ ] **PVC 持久化**：确认挂载至 `/data/lucy` 且采用 `ReadWriteOnce`。

### 3. 验收脚本执行
运行包内 `bash 验收命令.sh`，确认以下全部通过：
- [ ] **Pod Ready**：Pod 就绪探针通过（`1/1 Ready`）。
- [ ] **Runtime 内置**：Pod 内 `/root/.ktx/runtime/0.16.0/.venv/bin/python` 存在。
- [ ] **服务健康**：`/api/health` 返回 200 且 `bundledKtxVersion` 为 `0.16.0`。
- [ ] **MCP Configured**：`/api/project` 的 `mcpEndpoint.status` 为 `configured`（绝不能是 `fallback`）。
- [ ] **业务端到端查询验证**：配置 Agent Token 后，在 Agent 侧发起真实业务指标问答（如“DAU 是多少”），确认不再报 Python/uv 错误，能正常返回查询结果。
