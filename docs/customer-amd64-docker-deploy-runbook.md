# 客户 amd64 Docker 部署 Runbook

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer amd64 Docker Deployment Runbook |
| 文档类型 | Customer Operations Runbook |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-04 |
| 适用范围 | 客户 IT 现场 AMD x86_64 单机，离线交付包 `customer-amd64-offline-package/` |

> **配套文档**：[`docs/lucy-customer-amd64-offline-delivery-spec.md`](./lucy-customer-amd64-offline-delivery-spec.md)、[`docs/customer-deployment-guide.md`](./customer-deployment-guide.md)、[`docs/deployment-docker.md`](./deployment-docker.md)、[`docs/security-guide.md`](./security-guide.md)。

## 0. 你拿到的东西

```text
customer-amd64-offline-package/
├── README.md
├── docker-compose.yml
├── docker-compose.customer-config.yml
├── .env.example
├── SHA256SUMS
├── image/
│   └── project-lucy-customer-amd64-0.16.0-image.tar
├── customer-config/
│   ├── README.md
│   ├── ktx.yaml                          ← 必须改
│   ├── semantic-layer/                   ← 客户语义层（按需补）
│   ├── wiki/                             ← 业务口径文档（按需补）
│   ├── evals/                            ← SOW/UAT 评估用例（按需补）
│   ├── skills/                           ← 客户自定义 skill（按需补）
│   ├── webui/config/access.yaml          ← agent token / ACL
│   └── .ktx/secrets/                     ← 数据库密码文件
└── docs/
    ├── customer-amd64-docker-deploy-runbook.md   ← 本文档
    ├── lucy-customer-amd64-offline-delivery-spec.md
    ├── lucy-customer-deployment-guide.md
    ├── lucy-deployment-docker.md
    ├── lucy-admin-guide.md
    └── lucy-security-guide.md
```

## 1. 环境前置检查

```bash
# 1.1 硬件架构
uname -m
# 期望：x86_64

# 1.2 OS / 内核
cat /etc/os-release
uname -r

# 1.3 Docker
docker --version        # 期望 Docker version 24.0+
docker compose version  # 期望 Docker Compose version v2.20+

# 1.4 磁盘 / 内存
df -h /                 # 至少 8 GB 可用
free -h                 # 至少 4 GB，建议 8 GB

# 1.5 时钟
date                    # 与 NTP 服务器偏差应 < 1 分钟
```

任何一条不通过 → 先解决环境再继续。

## 2. 完整性校验

```bash
cd <解压后的 customer-amd64-offline-package 目录>

# SHA256SUMS 校验
sha256sum -c SHA256SUMS 2>&1 | tail -20
# 期望：所有文件 OK

# 单独校验 image tar
sha256sum image/project-lucy-customer-amd64-0.16.0-image.tar
# 与 SHA256SUMS 中对应行比对
```

## 3. 加载镜像

```bash
docker load -i image/project-lucy-customer-amd64-0.16.0-image.tar
# 期望输出：Loaded image: project-lucy:customer-amd64-0.16.0

docker images project-lucy
# 期望出现 project-lucy  REPOSITORY 行，TAG = customer-amd64-0.16.0

# 架构断言
docker image inspect project-lucy:customer-amd64-0.16.0 \
  --format '{{.Os}}/{{.Architecture}}'
# 期望：linux/amd64
```

## 4. 准备 `.env`

```bash
cp .env.example .env
$EDITOR .env
```

**必填项**：

| 变量 | 示例 | 说明 |
|---|---|---|
| `LUCY_PUBLIC_MCP_URL` | `https://lucy.example.com/mcp` | Agent 实际访问的 public URL，**必须**显式设置 |

如客户 Agent 与 Lucy 容器之间有 nginx / 反向代理，`LUCY_PUBLIC_MCP_URL` 填代理后的对外 URL。

其它项（`LUCY_WEBUI_PORT` / `LUCY_PROXY_PORT` / 端口映射）保持默认即可，端口冲突时按需修改。

## 5. 准备 customer-config

### 5.1 数据库连接

```bash
$EDITOR customer-config/ktx.yaml
```

- 把 `<CHANGE-ME-*>` 占位符替换为客户实际数据库连接信息。
- 严禁在 `ktx.yaml` 里写明文密码。密码必须用 `password: file:/data/lucy/.ktx/secrets/<name>` 形式。

### 5.2 写入数据库密码

```bash
mkdir -p customer-config/.ktx/secrets

# 写法 A：直接输入
cat > customer-config/.ktx/secrets/customer-db-password
# （输入实际密码，按 Ctrl-D 结束）

# 写法 B：从文件导入
cat /path/to/source-password-file \
  > customer-config/.ktx/secrets/customer-db-password

chmod 600 customer-config/.ktx/secrets/customer-db-password
ls -l customer-config/.ktx/secrets/
# 期望：-rw------- 1 root root ... customer-db-password
```

### 5.3 （可选）自定义语义层 / wiki / skills / evals

按需修改 `customer-config/semantic-layer/`、`wiki/`、`skills/`、`evals/`、`webui/config/access.yaml`。完成后跑一次静态校验：

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
# 期望 exit 0
```

> 该命令需要宿主机 Node 22+；如客户 IT 现场无 Node，可跳过这一步，由我们远程协助。

## 6. 启动

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  --env-file .env \
  up -d
```

`docker-compose.customer-amd64.yml` 是 image tag override，把 `image:` 强制指向本次交付的 `project-lucy:customer-amd64-0.16.0`。如果不加这个 override，compose 会沿用 `docker-compose.yml` 里的 `image: project-lucy:local`，可能拉到错的架构 / 错的镜像。

期望输出：

```text
[+] Running 2/2
 ✔ Network project-lucy_default   Created
 ✔ Container project-lucy-lucy-1  Started
```

## 7. 健康检查

```bash
# 7.1 Compose 状态
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  ps
# 期望：lucy 行的 State = healthy（启动后 30s 内）

# 7.2 WebUI 健康
curl -sf http://localhost:5174/api/health
# 期望：{"ok":true,...}

# 7.3 内置 KTX 版本
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  exec lucy ktx --version
# 期望：@kaelio/ktx 0.16.0

# 7.4 MCP 初始化（如已签发 Agent token）
TOKEN="$(cat customer-config/.ktx/secrets/customer-db-password >/dev/null; \
  grep -E '^[[:space:]]+token:' webui/config/access.yaml 2>/dev/null | head -1)"
# 若 access.yaml 不含明文 token（应如此），用 WebUI / Admin API 签发；详见 docs/lucy-admin-guide.md
curl -sf -X POST http://localhost:7879/mcp \
  -H "Authorization: Bearer ${LUCY_AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# 期望：200 + serverInfo
```

## 8. 常见故障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `docker load` 报 `unexpected EOF` | image tar 损坏 / 下载不全 | 重新下载，重新 `sha256sum -c SHA256SUMS` |
| `architecture mismatch` | 宿主机非 x86_64 | 本交付包只支持 AMD x86_64；如需 arm64，重新索要 arm64 包 |
| 容器启动后立刻退出，看 `ktx.yaml contains CHANGE-ME placeholders` | 没改 `customer-config/ktx.yaml` | 编辑 ktx.yaml，把 `<CHANGE-ME-*>` 全部替换 |
| 容器启动后退出，看 `no YAML files` / `no _schema YAML files` | `customer-config/semantic-layer/` 为空或只有占位 | 按 §5.3 补齐；或拷贝 `customer-config.example/semantic-layer/` 后再改 |
| `connection refused :5174` | 端口冲突；其他进程占用 | 改 `.env` 的 `LUCY_WEBUI_HOST_PORT` |
| `connection refused :7879` | 同上 | 改 `.env` 的 `LUCY_PROXY_HOST_PORT` |
| `ktx cannot connect to db` | secret 文件不存在 / 权限错 / 路径错 | `ls -l customer-config/.ktx/secrets/` 检查；权限必须是 600 |
| `permission denied` 在 MCP 调用 | Agent token 没建 / 已被吊销 | 走 `docs/lucy-admin-guide.md` 创建 Agent + Token |
| `LUCY_PUBLIC_MCP_URL not set` 警告 | 没填 `.env` 里的 `LUCY_PUBLIC_MCP_URL` | 填上后 `docker compose up -d` |

排障抓现场：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  logs --tail=200 lucy

docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  exec lucy ls -la /data/lucy

docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  exec lucy ktx --project-dir /data/lucy admin reindex 2>&1 | tail -40
```

## 9. 备份与恢复

### 9.1 备份

```bash
# 备份 named volume lucy-data
docker run --rm \
  -v project-lucy_lucy-data:/data/lucy:ro \
  -v "$PWD/backups:/backup" \
  busybox \
  tar czf /backup/lucy-data-$(date +%Y%m%d-%H%M%S).tgz -C /data/lucy .

# 备份 customer-config（独立于 volume）
cd <customer-amd64-offline-package 父目录>
tar czf customer-config-$(date +%Y%m%d-%H%M%S).tgz \
  customer-amd64-offline-package/customer-config/
```

### 9.2 恢复

```bash
# 恢复 lucy-data volume
docker run --rm \
  -v project-lucy_lucy-data:/data/lucy \
  -v "$PWD/backups:/backup" \
  busybox \
  tar xzf /backup/lucy-data-<时间戳>.tgz -C /data/lucy

# 恢复 customer-config：直接 git checkout 对应 commit / 解压对应 tar 即可
```

## 10. 升级

本次交付镜像 tag = `customer-amd64-0.16.0`。后续升级：

1. 拿到下一个版本（例如 `customer-amd64-0.17.0`）的 image tar + SHA256SUMS。
2. `docker load -i <新 tar>`；`project-lucy:<新 tag>` 会与旧 tag 并存。
3. 修改 `docker-compose.customer-amd64.yml` 的 `image:` 字段切到新 tag；或拷一份新的 override 文件。
4. `docker compose up -d`；旧容器自动停止、新容器启动。
5. 数据通过 `/data/lucy` volume 自动继承；如 volume 内 KTX bundled 版本变了，第一次启动会跑 reindex。

## 11. 卸载

```bash
# 停止并删除容器 + 网络（保留 volume）
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  down

# 如需彻底清理（包括 volume）
docker compose \
  -f docker-compose.yml \
  -f docker-compose.customer-amd64.yml \
  -f docker-compose.customer-config.yml \
  down -v

# 清理镜像（可选）
docker rmi project-lucy:customer-amd64-0.16.0
```

## 12. 安全合规要点

- 不要把交付包提交到任何公网仓库；交付包内含 `customer-config.example/`，但 secret 文件是占位。
- `customer-config/.ktx/secrets/` 下的密码文件**不**进版本控制。
- `webui/config/access.yaml` 只存 token hash，不存明文 token；明文 token 只在签发时返回一次。
- `/data/lucy/.ktx-ui/audit.sqlite` 是审计事实源，按客户合规要求保留。
- 见 [`docs/security-guide.md`](./security-guide.md) §5（secrets / 5 do / 5 do-not）。

## 13. 联系我们

排障时按以下顺序提供信息：

1. `docker compose ps` 输出
2. `docker compose logs --tail=200 lucy` 输出
3. `docker image inspect project-lucy:customer-amd64-0.16.0 --format '{{.Id}}'`（确认实际镜像 id）
4. `sha256sum image/project-lucy-customer-amd64-0.16.0-image.tar`（确认收到的 tar 完整）
5. 客户现场 `customer-config/ktx.yaml`（**先把 password 行整行删除**再贴出来，避免泄露）
6. 客户数据库 network 是否能通（`nc -zv <db-host> <db-port>`）