# WO-202608-07 客户 amd64 离线交付执行计划

> 对应规格：[`docs/lucy-customer-amd64-offline-delivery-spec.md`](../lucy-customer-amd64-offline-delivery-spec.md)
>
> 范围：客户硬件为 x86_64 (AMD) 单机，网络无公网 registry / 无 docker buildx，需要把 main HEAD 当前 Lucy 离线交付过去。

## 1. 起点状态

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git status --short
git rev-parse HEAD    # 记录 commit，作为交付包版本标识
docker --version
docker buildx version
docker context ls     # 确认使用哪个 docker endpoint
```

确认 `release/project-lucy-0.16.0-image.tar`（v0.16.0 历史产物）只作对比参考，**不直接复用**：本次规格明确从 main HEAD 重新构建。

## 2. 执行步骤

### Step 1 — 创建 buildx builder 并启动构建（后台）

```bash
docker buildx create --use --name lucy-amd64 \
  --driver docker-container --platform linux/amd64

mkdir -p inbox/customer-amd64-build
echo "$(git rev-parse HEAD)" > inbox/customer-amd64-build/git-head.txt
echo "$(git rev-parse --short HEAD)" > inbox/customer-amd64-build/git-short.txt
```

构建命令放到后台跑（预计 10–15 分钟）：

```bash
docker buildx build \
  --builder lucy-amd64 \
  --platform linux/amd64 \
  --build-arg "KTX_VERSION=0.16.0" \
  --tag "project-lucy:customer-amd64-0.16.0" \
  --tag "project-lucy:customer-amd64-dev-$(cat inbox/customer-amd64-build/git-short.txt)" \
  --load \
  --metadata-file inbox/customer-amd64-build/buildx-metadata.json \
  . > inbox/customer-amd64-build/build.log 2>&1
```

后台跑期间可以并行起草 spec / plan / runbook / 邮件草稿（已提前完成规格骨架）。

### Step 2 — 构建结束后，校验 + 冒烟

```bash
test "$(docker image inspect project-lucy:customer-amd64-0.16.0 \
  --format '{{.Os}}/{{.Architecture}}')" = "linux/amd64" \
  || { echo "FAIL: 镜像不是 linux/amd64"; exit 1; }

docker image inspect project-lucy:customer-amd64-0.16.0 \
  --format '{{.Id}}' > inbox/customer-amd64-build/image-id.txt

# 仓库级 docker 冒烟
npm run smoke:p0:docker

# 客户配置包冒烟（用 customer-config.example 作为被检查对象）
npm run smoke:p0:headless-config -- --root customer-config.example --require-secret-files
```

任一冒烟失败 → 整个交付动作停步，先修代码再重跑构建。

### Step 3 — 导出 image tar

```bash
mkdir -p inbox/customer-amd64-offline-package/image
docker save \
  -o inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar \
  project-lucy:customer-amd64-0.16.0
sha256sum inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar \
  > inbox/customer-amd64-offline-package/image/.sha256
```

### Step 4 — 组装交付物料

按 spec §3 的目录结构，从仓库 copy：

```bash
PKG=inbox/customer-amd64-offline-package

mkdir -p $PKG/docs
mkdir -p $PKG/customer-config

cp docker-compose.yml              $PKG/
cp docker-compose.customer-config.yml $PKG/
# image tag override（强制指向 project-lucy:customer-amd64-0.16.0）
# 见 inbox/customer-amd64-offline-package/docker-compose.customer-amd64.yml
cp customer-config.example/README.md   $PKG/customer-config/
cp customer-config.example/ktx.yaml    $PKG/customer-config/

# semantic-layer / wiki / evals / skills / webui/config 整目录
for d in semantic-layer wiki evals skills; do
  test -d customer-config.example/$d && cp -R customer-config.example/$d $PKG/customer-config/
done
test -d customer-config.example/webui && cp -R customer-config.example/webui $PKG/customer-config/

# .ktx/secrets 占位目录
mkdir -p $PKG/customer-config/.ktx/secrets
echo "客户把数据库密码写入 customer-config/.ktx/secrets/customer-db-password（chmod 600）" \
  > $PKG/customer-config/.ktx/secrets/README

# docs/
cp docs/customer-deployment-guide.md $PKG/docs/lucy-customer-deployment-guide.md
cp docs/deployment-docker.md          $PKG/docs/lucy-deployment-docker.md
cp docs/admin-guide.md                $PKG/docs/lucy-admin-guide.md
cp docs/security-guide.md             $PKG/docs/lucy-security-guide.md

# 本次新写的两个文档
cp docs/customer-amd64-docker-deploy-runbook.md $PKG/docs/
cp docs/lucy-customer-amd64-offline-delivery-spec.md $PKG/docs/

# .env.example（基于 docker-compose.yml 提取）
# 见下方 §6 .env.example 模板
```

### Step 5 — 生成 SHA256SUMS + README

```bash
cd $PKG
sha256sum \
  docker-compose.yml \
  docker-compose.customer-config.yml \
  .env.example \
  image/project-lucy-customer-amd64-0.16.0-image.tar \
  customer-config/README.md \
  customer-config/ktx.yaml \
  docs/customer-amd64-docker-deploy-runbook.md \
  > SHA256SUMS

# 把 customer-config 子树和 docs 子树单独算一次
(cd customer-config && find . -type f ! -name '.DS_Store' -print0 | sort -z | xargs -0 sha256sum) >> SHA256SUMS
(cd docs && find . -type f ! -name '.DS_Store' -print0 | sort -z | xargs -0 sha256sum) >> SHA256SUMS
```

交付包根目录的 `README.md`（手写 1 页上手说明），在 §7 给出。

### Step 6 — 自检：解包到 `/tmp/lucy-verify` 跑一次端到端

```bash
VERIFY=/tmp/lucy-verify
rm -rf $VERIFY; mkdir -p $VERIFY
# 把所有非 image tar 的小文件同步过去
rsync -a --exclude='image/' inbox/customer-amd64-offline-package/ $VERIFY/

# 在 /tmp/lucy-verify 里把 image tar load 到本机 docker，做一次真实 up
docker load -i inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar
cd $VERIFY
# 注意：这里必须把 image 也 copy 进来
cp -R inbox/customer-amd64-offline-package/image .
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml up -d
sleep 30
curl -sf http://localhost:5174/api/health
docker compose -f docker-compose.yml -f docker-compose.customer-config.yml down -v
```

健康检查通过 + compose down 成功 → 进入 Step 7。

### Step 7 — 写邮件草稿并整理交付

- 邮件草稿：`inbox/customer-amd64-delivery-email-draft.md`
- 交付包：`inbox/customer-amd64-offline-package/`
- 构建日志归档：`inbox/customer-amd64-build/build.log`

把交付包通过 media tag 发回用户。

## 3. 必跑验收（Gate）

| Gate | 命令 | 通过标准 |
|---|---|---|
| 架构正确 | `docker image inspect ... --format '{{.Os}}/{{.Architecture}}'` | `linux/amd64` |
| docker 冒烟 | `npm run smoke:p0:docker` | exit 0 |
| headless config 冒烟 | `npm run smoke:p0:headless-config -- --root customer-config.example --require-secret-files` | exit 0 |
| image tar 可加载 | `docker load -i image.tar` | exit 0 |
| 启动 + 健康检查 | `curl -sf http://localhost:5174/api/health` | exit 0 |
| KTX 版本 | `docker compose exec lucy ktx --version` | 输出 `@kaelio/ktx 0.16.0` |
| MCP 链路 | `POST /mcp initialize` | 返回 200 + serverInfo |
| 关闭无残留 | `docker compose down -v` 后无 dangling volume（除非客户指定保留） | OK |

## 4. 回滚预案

- **构建失败**：回到 main HEAD，删除 `lucy-amd64` builder 重来；或者换 `KTX_VERSION`（pinned 0.16.0 是默认，不要换）。
- **冒烟失败**：先看 `inbox/customer-amd64-build/build.log` 末尾报错；按 `docs/DEVELOPMENT.md` 红线修代码，绝不绕过冒烟。
- **客户装机失败**：让客户 IT 把 `docker compose logs lucy` 发回，对照部署 runbook 第 6 节排障表。最常见原因 = `customer-config/ktx.yaml` 仍含 `<CHANGE-ME-*>` / secret 文件没建。

## 5. 落位

| 产物 | 路径 |
|---|---|
| 规格 | `docs/lucy-customer-amd64-offline-delivery-spec.md` |
| 本工单（plan） | `docs/plans/wo-202608-07-customer-amd64-delivery.md` |
| 部署 runbook | `docs/customer-amd64-docker-deploy-runbook.md` |
| 构建日志 | `inbox/customer-amd64-build/build.log` |
| 构建元数据 | `inbox/customer-amd64-build/buildx-metadata.json` |
| 镜像 ID | `inbox/customer-amd64-build/image-id.txt` |
| 交付包 | `inbox/customer-amd64-offline-package/` |
| 邮件草稿 | `inbox/customer-amd64-delivery-email-draft.md` |

## 6. `.env.example` 模板（Step 4 落盘用）

```env
# ---- Lucy 客户 amd64 离线交付 .env 模板 ----
# 复制本文件为 .env 后，按客户现场填写。

# 客户 Agent 实际访问的 public MCP URL（必填，不要走 127.0.0.1 fallback）
LUCY_PUBLIC_MCP_URL=https://lucy.example.com/mcp

# 容器内 Lucy WebUI 监听端口（默认 5174）
LUCY_WEBUI_PORT=5174
# 容器内 Lucy MCP Proxy 监听端口（默认 7879）
LUCY_PROXY_PORT=7879

# 宿主机 → 容器端口映射（如端口冲突按需修改）
LUCY_WEBUI_HOST_PORT=5174
LUCY_PROXY_HOST_PORT=7879

# KTX 版本（必须与镜像内 bundled KTX 一致，本次 = 0.16.0）
KTX_VERSION=0.16.0

# PostHog 始终关闭
POSTHOG_DISABLED=1

# KTX telemetry 始终关闭
KTX_TELEMETRY_DISABLED=1
```

## 7. 交付包根 README 模板

```markdown
# Lucy 客户 amd64 离线交付包

| 字段 | 值 |
|---|---|
| Lucy 版本 | 0.16.0（@kaelio/ktx 0.16.0） |
| 镜像 tag | `project-lucy:customer-amd64-0.16.0` |
| 镜像平台 | linux/amd64 |
| 构建 commit | 见 `docs/lucy-customer-deployment-guide.md` 头部说明 |
| 校验 | `SHA256SUMS`（sha256） |

## 目录

- `image/project-lucy-customer-amd64-0.16.0-image.tar` — Docker image tar
- `docker-compose.yml` — 单机 compose baseline
- `docker-compose.customer-config.yml` — bind mount 客户配置包 override
- `.env.example` — 环境变量样例（拷贝为 .env 后再编辑）
- `customer-config/` — 客户配置包模板（替换 `ktx.yaml`、填实 secret）
- `docs/` — 部署 / 安全 / 管理 runbook
- `SHA256SUMS` — sha256 校验值

## 快速开始

```bash
docker load -i image/project-lucy-customer-amd64-0.16.0-image.tar
cp .env.example .env && $EDITOR .env
$EDITOR customer-config/ktx.yaml
mkdir -p customer-config/.ktx/secrets
echo '<your-db-password>' > customer-config/.ktx/secrets/customer-db-password
chmod 600 customer-config/.ktx/secrets/customer-db-password

docker compose -f docker-compose.yml -f docker-compose.customer-config.yml --env-file .env up -d
docker compose ps
curl -sf http://localhost:5174/api/health
docker compose exec lucy ktx --version
```

详细排障与回滚路径见 `docs/customer-amd64-docker-deploy-runbook.md`。
```