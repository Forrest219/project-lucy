# Lucy 客户交付与镜像上线 Checklist（通用防坑指南）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer Delivery Preflight Checklist |
| 文档类型 | Governance / Quality Gate / Runbook |
| 版本 | v1.3 |
| 撰写日期 | 2026-08-28；2026-09-02 增补升级契约铁律；2026-09-02 v1.2 自动化 H3/H4；2026-09-02 v1.3 真实 N-1、Pod imageID、K6 load 重验、MCP URL 矩阵 |
| 适用范围 | 所有交付给客户的 Docker Compose 离线包、Kubernetes / Helm 集成包及 Release Assets |
| 关联文档 | [`docs/customer-amd64-image-build-checklist.md`](customer-amd64-image-build-checklist.md)、[`docs/customer-k8s-deployer-quickstart.md`](customer-k8s-deployer-quickstart.md)、[`docs/customer-deployment-guide.md`](customer-deployment-guide.md) |

---

## 核心复盘与五大铁律

在过往交付客户（尤其离线无外网环境）中，曾暴露致命故障。**后续任何发版出包，必须遵循五大铁律：**

1. **二进制架构铁律（防 `exec format error`）**：禁止仅凭 `docker inspect` 的 `Architecture=amd64` 结论出包。在 Apple Silicon / 多架构环境构建时，必须提取镜像内 `node` 和 `tini` 执行 ELF 校验（必须为 x86-64）。
2. **离线运行时铁律（防 `could not download uv`）**：客户环境无法连公网。镜像必须完整预装 KTX Python runtime，出包前必须在 `--network=none` 下通过 `ktx --version` 启动与运行时文件存在性校验。
3. **MCP Advertise 地址铁律（防「Lucy MCP 未就绪」）**：客户部署必须显式注入 `LUCY_PUBLIC_MCP_URL`（如 `https://lucy.example.com/mcp`）。禁止留空、保留占位符或填 `127.0.0.1`，避免 WebUI 产生 `fallback` 假象。
4. **禁止盲复用铁律（防坏包扩散）**：禁止直接复制任何未过本轮全套门禁的历史 `*.tar`。每次升级或出包必须当场重跑全套 Gates，坏包必须原地作废并升 Release tag。
5. **升级契约铁律（防 K8s 原地升级失败）**：禁止只修探针就发 K8s 升级包。必须 **自动化** 证明 H3（N-1 旧 PVC 升级）与 H4（回滚 digest）— 见 `scripts/k8s-upgrade-gate.sh`。禁止现场 `git init`、`chown`、`kubectl set env`、Deployment patch。

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
| **G4b-1** | **Python 运行时** | `docker run --rm --platform linux/amd64 --entrypoint /bin/sh <tag> -c 'test -x /home/lucy/.ktx/runtime/0.16.0/.venv/bin/python'` | Exit 0，确认 runtime 完整落盘（lucy 用户） |
| **G4b-2** | **无网离线启动** | `docker run --rm --network=none --platform linux/amd64 --entrypoint ktx <tag> --version` | 退出码 0 且版本正确（证明不依赖实时下载 uv） |
| **G8** | **K8s 镜像契约** | `bash scripts/g8-image-k8s-contract-gate.sh <tag>` | 与 Helm **解耦**；见镜像 checklist |
| **G5** | 仓库冒烟 | `npm run smoke:p0:docker` | 全绿（覆盖真实 DuckDB/KTX 查询链路） |
| **G6** | 交付隔离门禁 | `npm run smoke:p0:delivery-isolation` | 确保客户镜像中不含开发态内部路径 |

---

## 阶段二：Helm Chart 与交付包组装（K + H 门禁）

### 1. Helm Chart 守卫验证（H1 静态）

**H1a 通用 Chart 契约**（local-test / k3s-test / 生产 overlay 均必须满足）：

- [ ] HTTP 探针 `/api/health`；无 preflight / exec healthcheck / `GIT_CONFIG_COUNT`
- [ ] `workingDir: /data/lucy`；`runAsUser` / `fsGroup`: **10001**
- [ ] Service 不暴露 **7878**；容器端口 5174/7879
- [ ] `project-migrate` init **仅 chown**（不得 `git init` — 入口为唯一权威）

**H1b k3s-test profile**（仅 `examples/values.k3s-test.yaml`，非 universal）：

- [ ] `service.type: LoadBalancer`；外部 8276/8277
- [ ] `LUCY_PUBLIC_MCP_URL` 为真实外部 URL
- [ ] 包内 tag/digest 与 `image/image-digest.txt` 一致（K6）

- [ ] **静态门禁**：`npm run gate:k8s-static`

### 1b. K8s 运行时门禁（H2–H5，发版前至少执行一次）

| # | Gate | 命令 | 通过标准 |
|---|---|---|---|
| **H1** | 静态渲染 | `npm run gate:k8s-static` | lint + template + 探针/端口/MCP URL 守卫 |
| **H2** | 全新安装 | kind / 新 namespace `helm install` | Pod `1/1 Ready`；无 exec 探针超时 |
| **H3** | N-1 升级 | `bash scripts/k8s-upgrade-gate.sh …` 或 `k8s-release-gate.sh --test-upgrade`；**CI**：`k8s-upgrade-gate` job（kind，`npm run gate:k8s-kind-h3`） | access.yaml hash 不变；`.git` UID 10001；`/api/health` 200 |
| **H4** | 失败回滚 | `k8s-upgrade-gate.sh --test-rollback` | rollback 后 image digest 与升级前一致 |
| **H5** | 业务验收 | `bash scripts/k8s-acceptance.sh …` | ktx test / reindex / MCP initialize / tools/list |

**H3 标准复现环境**（无客户日志时内部必跑）：

- PVC `lucy` 已存在，`.git` 属主 UID **10001**（或 root 残留由 projectMigrate chown）
- 含 semantic-layer / wiki / access.yaml / `.ktx/secrets/` / SQLite index
- StarRocks 连接 `kc-starrocks` 已配置

```bash
bash scripts/k8s-release-gate.sh --with-cluster \
  --namespace lucy-test --release lucy-starrocks \
  --test-upgrade -f deploy/k8s/helm/lucy/examples/values.k3s-test.yaml \
  --test-rollback \
  --with-mcp --public-mcp-url http://10.69.95.109:8277/mcp --token "<bearer>"
```

### 2. 交付包封包与自检
- [ ] **K1–K3**：镜像 tar 当场 G2–G8 复验
- [ ] **K6 包自证**：`npm run gate:k8s-package -- --tar <pkg>` 或封包脚本自动执行
- [ ] **K4 校验和**：包内 `SHA256SUMS` + 外层 `*.tar.gz.sha256`
- [ ] **作废拦截**：不得构建 `-v1`/`-v2` suffix（脚本硬拒绝）

### 2b. Docker Compose 同一镜像（联动）

- [ ] runtime 验收路径 `/home/lucy/.ktx/…`（见 G8）
- [ ] volume 权限：容器 UID 10001 可写 `/data/lucy`
- [ ] 不要求 LoadBalancer / Helm values（K8s profile 专用）

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
- [ ] **Runtime 内置**：Pod 内 `/home/lucy/.ktx/runtime/0.16.0/.venv/bin/python` 存在。
- [ ] **服务健康**：`/api/health` 返回 200 且 `bundledKtxVersion` 为 `0.16.0`。
- [ ] **MCP Configured**：`/api/project` 的 `mcpEndpoint.status` 为 `configured`（绝不能是 `fallback`）。
- [ ] **业务端到端查询验证**：配置 Agent Token 后，在 Agent 侧发起真实业务指标问答（如“DAU 是多少”），确认不再报 Python/uv 错误，能正常返回查询结果。

### 4. 无客户日志 Symptom → 根因对照（K8s 升级）

| 现象 | 根因 | 交付经理动作 |
|---|---|---|
| `k8s-preflight.sh: No such file` | 旧 Chart init 仍引用已删脚本 | 确认 Helm revision 使用 Chart 0.2.x+；移除 `runtime-preflight` |
| `Startup probe failed: command timed out` | exec `docker-healthcheck.sh` 探针 | 升级至 HTTP `/api/health` 探针 Chart |
| `dubious ownership in repository at '/data/lucy'` | root 容器 vs UID 10001 的 `.git` | 使用 v3 镜像+Chart（UID 10001）；启用 `projectMigrate` init |
| Pod CrashLoop，PVC 无 `.git` | 入口未 `git init` | 使用 v3 镜像；检查 init/entrypoint 日志 |
| `GIT_CONFIG_COUNT ... not permitted` | 错误 Git 配置注入 | 从 values 移除；禁止 `allowUnsafeConfigEnvCount` |
| Pod Running 但 8276/8277 不通 | Service 为 ClusterIP | 改用 LoadBalancer 或 NodePort；检查 K3s ServiceLB |
| MCP fallback | `LUCY_PUBLIC_MCP_URL` 未在 Helm values 中 | 写入 values 后 `helm upgrade`；禁止 `kubectl set env` |
| 行为与预期 build 不一致 | 包内 tag/digest 与镜像 tar 不一致 | 使用 v3+ 包；Offline 核 `image-config-id.txt` + tar SHA；Registry 核 `image-manifest-digest.txt` |
| 升级后 Token/ACL 丢失 | 误删 PVC 或 Secret | 禁止 `kubectl delete pvc`；回滚并恢复备份 |

---

## 放行条件（Go / No-Go）

以下全部满足才可标注「可直接原地升级」并发放客户 K8s 包：

- [ ] G1–G4b、G8 针对**最终交付镜像身份**执行（registry digest 或 offline load 后 config ID）
- [ ] OCI manifest 含 `linux/amd64`；node/tini/Python ELF 为 x86-64
- [ ] 无公网下 Python runtime 功能性命令通过（G4b-3）
- [ ] H3 使用真实不同的 N-1/N image + Chart（`deploy/k8s/gate/n1-baseline.txt`）
- [ ] UID 0 与 UID 10001 两类旧 PVC fixture 均升级成功
- [ ] H4 使用 Pod 实际 `imageID` 验证失败升级与回滚
- [ ] ACL/Token/Secret/audit/semantic/wiki/skills/`.git` sentinel 保留
- [ ] K6 从外层 tar 校验并 `docker load` 重跑门禁
- [ ] Offline / Registry digest 语义分离（禁止 config ID 填入 `image.digest`）
- [ ] 打包脚本无 heredoc 命令替换副作用
- [ ] H1 MCP URL 负例矩阵全部拒绝
- [ ] H5 在 lucy-test 或等价集群执行并归档证据
- [ ] Release metadata 含 git SHA、Chart version、KTX version、config ID、manifest digest（Registry）/ tar SHA256（Offline）、包 SHA256
- [ ] 旧 v1/v2 包保持机器可读作废（打包脚本拒绝 `-v1`/`-v2` suffix）
