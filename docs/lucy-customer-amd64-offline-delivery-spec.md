# Lucy 客户 amd64 离线交付包规格

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer amd64 Offline Delivery Spec |
| 文档类型 | Customer Delivery / Packaging Spec |
| 版本 | v0.2（2026-08-27：强制 G2–G4；作废坏包与盲复用） |
| 撰写日期 | 2026-08-04 |
| 适用范围 | 客户 IT 现场无公网 registry / 无 buildx，单机 x86_64 (AMD) 主机上的 Lucy 离线交付 |

## 1. 背景与目标

客户 IT 环境特征：

- 客户硬件：x86_64（AMD）单机。
- 网络：客户机可以接收离线文件，但**不保证**能从公网 `ghcr.io` / Docker Hub 拉取镜像，也不一定装有 `docker buildx`。
- 客户已有 / 计划接入的数据库为客户内部数据库实例，**不属于**本规格交付范围。

本次交付目标：

- 把当前 main HEAD（含 2026-08-03 之后的最新代码改动）构建为 **linux/amd64 单架构 docker image**。
- 把 image tar + compose 部署物料 + 客户配置模板 + 校验值 + 部署 runbook 组装成单一离线交付包。
- 给客户 IT 一份直接可用的部署邮件草稿。

非目标：

- 不交付 arm64 image；客户是 AMD x86，不需要 arm64 层。
- 不交付多副本 / HA Kubernetes 部署；本次只覆盖 Docker Compose 单机 baseline。
- 不交付源码仓库；客户 IT 用 image + compose 文件 + 配置包即可完成部署。

## 2. 镜像规格

### 2.1 平台与基础镜像

| 项目 | 取值 | 来源 |
|---|---|---|
| Target platform | `linux/amd64` | 客户硬件为 AMD x86_64 |
| Build driver | `docker buildx` + `docker-container` builder | 与现有 `.github/workflows/lucy-release.yml` 一致；本地单架构构建 |
| Base image | `node:22-bookworm-slim` | `Dockerfile` 已锁定 |
| KTX runtime | `@kaelio/ktx@0.16.0` | `Dockerfile` ARG `KTX_VERSION=0.16.0` |
| Working dir | `/app` | `Dockerfile` |
| Volume | `/data/lucy` | `Dockerfile` VOLUME |
| Exposed ports | `5174/tcp` (WebUI), `7879/tcp` (MCP Proxy) | `Dockerfile` + `docker-compose.yml` |
| Entrypoint | `tini -- /app/scripts/docker-entrypoint.sh` | `Dockerfile` |
| Healthcheck | `scripts/docker-healthcheck.sh` (30s interval, 10s timeout, 3 retries, 30s start period) | `Dockerfile` |

### 2.2 单架构构建命令

构建必须在 amd64 native 上完成，**禁止**用 QEMU 跨架构模拟（避免 npm ci / ktx install 出问题，且速度更快）。

```bash
# 一次性创建 buildx builder。禁止加 --use：
# --use 会把全局当前 builder 切到 lucy-amd64，污染本机 arm64 的 demo 重建
# （QEMU 跨架构，经常 >10 分钟像卡住）。客户包构建一律显式 --builder。
docker buildx create --name lucy-amd64 \
  --driver docker-container --platform linux/amd64 \
  2>/dev/null || docker buildx inspect lucy-amd64 >/dev/null

# 单架构构建并加载到本地 docker。
# 必须显式传入 TARGETPLATFORM/TARGETARCH：Dockerfile 的 FROM 绑定 TARGETPLATFORM，
# 仅靠 --platform 元数据不足以保证层内 ELF 与标签一致（见 WO-202608-08）。
docker buildx build \
  --builder lucy-amd64 \
  --platform linux/amd64 \
  --build-arg "KTX_VERSION=0.16.0" \
  --build-arg "TARGETPLATFORM=linux/amd64" \
  --build-arg "TARGETARCH=amd64" \
  --tag "project-lucy:customer-amd64-0.17.0-20260902-b262798" \
  --load \
  --metadata-file release/customer-amd64-buildx-metadata.json \
  .

# 构建结束后恢复 Engine 自带 default，避免后续 demo compose 误用 amd64 builder
docker buildx use default
```

构建完后做**六层校验**（G1–G4 为交付硬门禁，缺一则禁止 `docker save` / 禁止出包）：

1. **元数据架构校验（G1）**：`docker image inspect project-lucy:customer-amd64-0.17.0-20260902-b262798 --format '{{.Os}}/{{.Architecture}}'` 必须输出 `linux/amd64`。
2. **ELF 二进制门禁（G2，必做）**：`bash scripts/assert-image-elf-arch.sh project-lucy:customer-amd64-0.17.0-20260902-b262798 amd64` 必须通过；检查 **`/usr/local/bin/node` 与 `/usr/bin/tini`**。仅检查 metadata **不够**——历史上出现过「元数据 amd64、ELF 实为 aarch64」，客户报 `exec /usr/bin/tini: exec format error`。
3. **运行时 smoke（G3，必做）**：`docker run --rm --platform linux/amd64 --entrypoint /bin/sh project-lucy:customer-amd64-0.17.0-20260902-b262798 -c 'echo ok'` 必须 exit 0。
4. **KTX 版本（G4）**：`docker run --rm --platform linux/amd64 --entrypoint ktx project-lucy:customer-amd64-0.17.0-20260902-b262798 --version` 含 `@kaelio/ktx 0.16.0`。
5. **冒烟**：`npm run smoke:p0:docker` 必须全绿。
6. **客户配置包冒烟**：`npm run smoke:p0:headless-config -- --root customer-config.example --require-secret-files` 必须全绿。

推荐一键入口：`bash scripts/build-customer-amd64-image.sh`（含 G1–G4）。完整清单见 [`docs/customer-amd64-image-build-checklist.md`](./customer-amd64-image-build-checklist.md)。

> **作废声明**：2026-08-04 前后基于 `FROM --platform=$BUILDPLATFORM` 打出的历史 `project-lucy:customer-amd64-0.16.0` / `inbox/customer-amd64-offline-package` **不得交付客户**；GitHub Release `lucy-k8s-integration-20260827-v1` 亦因同因作废，须按本规格重建并通过 G2–G4c 后再交付。

### 2.3 镜像导出

```bash
# 导出 docker save 格式（标准 image tar），供客户 docker load 使用
docker save \
  -o release/project-lucy-customer-amd64-0.17.0-20260902-b262798-image.tar \
  project-lucy:customer-amd64-0.17.0-20260902-b262798
```

`docker save` 输出的 tar 是 OCI-compatible docker 仓库格式（manifest + blobs/），客户 `docker load` 后即可使用。

## 3. 交付包结构

```
customer-amd64-offline-package/
├── README.md                          # 1 页上手说明
├── docker-compose.yml                 # 直接来自仓库根
├── docker-compose.customer-amd64.yml  # 本次新增：强制 image tag override
├── docker-compose.customer-config.yml # 直接来自仓库根（bind mount override）
├── .env.example                       # LUCY_PUBLIC_MCP_URL 等可调环境变量样例
├── image/
│   └── project-lucy-customer-amd64-0.17.0-20260902-b262798-image.tar
├── customer-config/
│   ├── README.md                      # 来自 customer-config.example/README.md
│   ├── ktx.yaml                       # 来自 customer-config.example/ktx.yaml
│   ├── semantic-layer/                # 来自 customer-config.example/semantic-layer/
│   ├── wiki/                          # 来自 customer-config.example/wiki/
│   ├── evals/                         # 来自 customer-config.example/evals/
│   ├── skills/                        # 来自 customer-config.example/skills/
│   └── webui/config/access.yaml       # 来自 customer-config.example/webui/config/
├── docs/
│   ├── lucy-customer-deployment-guide.md  # 来自 docs/customer-deployment-guide.md
│   ├── lucy-deployment-docker.md          # 来自 docs/deployment-docker.md
│   ├── lucy-admin-guide.md                # 来自 docs/admin-guide.md
│   ├── lucy-security-guide.md             # 来自 docs/security-guide.md
│   └── customer-amd64-docker-deploy-runbook.md  # 现场部署 runbook（本次新写）
└── SHA256SUMS                          # 交付包内所有文件的 sha256
```

### 3.1 文件大小与压缩

- image tar 不压缩（已经 gzip 友好）；预估 900 MB - 1.2 GB（与现 `release/project-lucy-0.16.0-image.tar` 的 ~870 MB 同量级）。
- 整包不打成一个 zip / tar.gz（客户 IT 可单独核对 SHA256、单独验证 image tar；如客户要求单文件交付，可后续打成 zip，本规格不要求默认压缩）。
- `SHA256SUMS` 使用 GNU coreutils `sha256sum` 格式，文件名相对交付包根目录。

### 3.2 必须排除

- `inbox/`、`release/`、`node_modules/`、`webui/node_modules/`、`webui/dist/`、`.git/`、`.claude/`、`.codex/`、`tests/`、`.ktx/`、`.ktx-ui/`、`coverage/`。
- 所有 `*.log`、`*.sqlite`、`*.sqlite-journal`、`*.sqlite-wal`、`*.sqlite-shm`。
- `.ktx/secrets/` 下的真实密码文件（即使是占位）。
- `customer-config/.ktx/`、`.ktx-ui/` 下的运行时状态。

## 4. 部署要求

### 4.1 客户 IT 主机最小要求

| 项目 | 最小 | 推荐 | 备注 |
|---|---|---|---|
| CPU | x86_64 (AMD) | 多核 | 必须与镜像架构一致 |
| RAM | 4 GB | 8 GB | Lucy + KTX + WebUI build cache |
| Disk | 8 GB 可用 | 20 GB | image tar 解压后 ~1 GB + `/data/lucy` volume |
| Docker | Engine ≥ 24.0 | 27.x | 必须支持 `docker compose v2` |
| Docker Compose | v2.20+ | 最新 | `docker compose` 子命令形式 |
| 网络 | 宿主机可访问客户 DB | 同上 | 客户 DB 不需要公网入口 |
| 时间同步 | NTP | NTP | audit 时间戳可信 |

### 4.2 启动方式

```bash
# 在 customer-amd64-offline-package/ 目录下
docker load -i image/project-lucy-customer-amd64-0.17.0-20260902-b262798-image.tar

# 编辑 .env，至少设置 LUCY_PUBLIC_MCP_URL
cp .env.example .env
$EDITOR .env

# 编辑 customer-config/ktx.yaml，替换 <CHANGE-ME-*>
$EDITOR customer-config/ktx.yaml

# 把客户 DB 密码写入 secret 文件
mkdir -p customer-config/.ktx/secrets
cat > customer-config/.ktx/secrets/customer-db-password <<< '实际的密码'
chmod 600 customer-config/.ktx/secrets/customer-db-password

# 启动
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  --env-file .env \
  up -d
```

`docker-compose.customer-amd64.yml` 是 image tag override——强制 `image: project-lucy:customer-amd64-0.17.0-20260902-b262798`，避免 compose 沿用 `docker-compose.yml` 里默认的 `image: project-lucy:local`（可能不是本次交付的 amd64 tag）。

### 4.3 健康检查

```bash
docker compose ps                          # 期望 lucy 状态 healthy
curl -sf http://localhost:5174/api/health  # WebUI health
docker compose exec lucy ktx --version     # 内置 KTX 0.16.0
curl -sf -X POST http://localhost:7879/mcp \
  -H "Authorization: Bearer ${LUCY_AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  | jq .                                  # MCP initialize 返回 200 + serverInfo
```

### 4.4 回滚路径

- 镜像回滚：客户保留上次交付的 image tar，回退到 `docker load` 上一个 tag，`docker compose up -d` 即生效。
- 数据回滚：见部署 runbook 第 5 节（`lucy-data` volume tar 备份与恢复）。
- 配置回滚：`customer-config/` 进客户 Git，回滚一次 git checkout 即可。

## 5. 安全与合规

- **不嵌入任何客户 secret**：本次规格内所有 secret 文件只放占位 / 空文件，由客户 IT 现场填实。
- **LUCY_PUBLIC_MCP_URL 必须显式设置**：避免走默认 `http://127.0.0.1:7879/mcp` fallback。`docker-compose.yml` 与 `.env.example` 强制包含该字段。
- **KTX_INTERNAL_TOKEN 不暴露**：容器内自动生成的 32-byte hex token，仅用于容器内部 KTX MCP upstream 与 Proxy 之间的链路；不能用作 Agent token。
- **审计落盘路径**：`/data/lucy/.ktx-ui/audit.sqlite`，按 `docs/security-guide.md` §4 执行。

## 6. 验收 Gate（出包前必跑）

```bash
# 1. 镜像构建（显式 --builder；不要 docker buildx use lucy-amd64）
docker buildx build --builder lucy-amd64 --platform linux/amd64 \
  --build-arg "KTX_VERSION=0.16.0" \
  --build-arg "TARGETPLATFORM=linux/amd64" \
  --build-arg "TARGETARCH=amd64" \
  --tag "project-lucy:customer-amd64-0.17.0-20260902-b262798" --load .
docker buildx use default

# 2. 元数据架构断言
test "$(docker image inspect project-lucy:customer-amd64-0.17.0-20260902-b262798 --format '{{.Os}}/{{.Architecture}}')" = "linux/amd64"

# 2b. ELF 二进制门禁（必做）
bash scripts/assert-image-elf-arch.sh project-lucy:customer-amd64-0.17.0-20260902-b262798 amd64

# 3. 导出 image tar
docker save -o release/project-lucy-customer-amd64-0.17.0-20260902-b262798-image.tar project-lucy:customer-amd64-0.17.0-20260902-b262798

# 4. 仓库级冒烟
npm run smoke:p0:docker

# 5. 客户配置包冒烟
npm run smoke:p0:headless-config -- --root customer-config.example --require-secret-files

# 6. 装机验证（用本机 image tar 跑一次 docker load + up）
docker load -i release/project-lucy-customer-amd64-0.17.0-20260902-b262798-image.tar
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml up -d
curl -sf http://localhost:5174/api/health
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml down
```

## 7. 落位 / 索引

- 规格本体：`docs/lucy-customer-amd64-offline-delivery-spec.md`
- 配套 plan：`docs/plans/wo-202608-07-customer-amd64-delivery.md`
- 架构修复规格：`docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`
- 部署 runbook：`docs/customer-amd64-docker-deploy-runbook.md`
- 邮件草稿：`inbox/customer-amd64-delivery-email-draft.md`
- 交付包根目录：`inbox/customer-amd64-offline-package/`
- 镜像构建日志：`inbox/customer-amd64-build/build.log`
- 构建元数据：`inbox/customer-amd64-build/buildx-metadata.json`

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **customer-amd64-offline-package**: 面向客户 IT 的离线交付包目录，区别于仓库内 `release/`（release artifacts）与 `lucy-docker-source-bundle.tar.gz`（可重建源码包）。
- **customer-amd64 image tag**: `project-lucy:customer-amd64-0.17.0-20260902-b262798`，明确 amd64 单架构 + 客户交付语义。

UI / 用户可见文案：

- 邮件草稿涉及的所有术语必须与 `docs/customer-deployment-guide.md` 第 1–5 节保持一致（MCP Proxy、customer config package、bind mount、`/data/lucy`）。
