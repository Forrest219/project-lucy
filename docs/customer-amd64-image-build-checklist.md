# Lucy 客户 amd64 镜像构建 Checklist

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer amd64 Image Build Checklist |
| 文档类型 | Checklist |
| 版本 | v1.5 |
| 撰写日期 | 2026-08-27；2026-08-28 增补 G4b；2026-09-02 增补 G8；2026-09-02 v1.4 解耦 G8/Helm；2026-09-02 v1.5 身份闭环（最终 digest 门禁、G4b 功能性、Offline/Registry 语义） |
| 撰写人 | Composer |
| 委托人 | xingchen |
| 基于材料 | 20260827 客户 `exec /usr/bin/tini: exec format error` 事故；20260902 K8s v1/v2 原地升级契约事故；`docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`；Release `lucy-k8s-integration-20260827-v1` 坏包复盘 |
| 适用范围 | 任何交付给客户的 `linux/amd64` Lucy 镜像（Docker Compose 离线包、K8s integration tar.gz、Release Assets） |
| 输出位置 | `docs/customer-amd64-image-build-checklist.md` |

## 背景

`docker image inspect … Architecture=amd64` **不能**作为交付依据。历史上出现过元数据 amd64、层内 ELF 为 **aarch64** 的坏包，客户在 x86_64 上运行会报：

```text
exec /usr/bin/tini: exec format error
```

**2026-08-27 事故链**：K8s 出包时直接复用 `inbox/customer-amd64-offline-package/image/*.tar`（2026-08-04 产物），**未重跑 G2 ELF 门禁**，导致坏包进 GitHub Release。

**铁律**：任何出包路径（含「复用旧 tar」）都必须**当场重跑 G1–G4 + G4b + G8**；未通过则禁止复用、禁止 `docker save`、禁止更新 Release、禁止发给客户。构建失败（含 Docker Hub 超时）→ **不得**回退到旧坏包凑交付。

### 20260902 K8s 升级契约事故

`lucy-k8s-integration-delivery-20260902-v1/v2` 在 K3s 测试环境原地升级时暴露：**镜像 amd64 / KTX / Python runtime 正常**，但镜像入口、Helm Chart 与旧 PVC（UID 10001、已有 `.git`/ACL/Token）之间的升级契约不完整。典型现象包括：

- `k8s-preflight.sh: No such file or directory`（旧 Chart init）
- `Startup probe failed: command timed out`（exec `docker-healthcheck.sh`）
- `fatal: detected dubious ownership in repository at '/data/lucy'`（root vs UID 10001）
- 无 `.git` 时启动失败（删 preflight 后无人 `git init`）
- Pod Running 但 8276/8277 不可达（ClusterIP + 错误 tag/digest）

**v3 起**：镜像必须以 UID **10001** 运行；入口幂等 `git init`；KTX runtime 位于 `/home/lucy/.ktx/`；出 K8s 包前必须过 G8 + H3（N-1 旧 PVC 升级）。

## 强制流程（缺一步不得出包）

推荐一键入口（含 G1–G4 + G4b）：

```bash
bash scripts/build-customer-amd64-image.sh
```

或手工逐步执行下表。

| # | Gate | 命令 | 通过标准 |
|---|---|---|---|
| G0 | 构建参数 | `docker buildx build --builder lucy-amd64 --platform linux/amd64 --build-arg TARGETPLATFORM=linux/amd64 --build-arg TARGETARCH=amd64 …` | 必须显式传 `TARGETPLATFORM` / `TARGETARCH`；禁止 `FROM --platform=$BUILDPLATFORM` |
| G1 | 元数据 | `docker image inspect <tag> --format '{{.Os}}/{{.Architecture}}'` | 输出 `linux/amd64` |
| G2 | ELF 门禁 | `bash scripts/assert-image-elf-arch.sh <tag> amd64` | **node + tini** 均为 x86-64，不得含 ARM/aarch64 |
| G3 | 运行时 smoke | `docker run --rm --platform linux/amd64 --entrypoint /bin/sh <tag> -c 'echo ok'` | exit 0（模拟客户 nerdctl/docker 最小启动） |
| G4 | KTX 版本 | `docker run --rm --platform linux/amd64 --entrypoint ktx <tag> --version` | 含 `@kaelio/ktx 0.16.0` |
| G4b | KTX Python runtime 离线预装 | 见下方 G4b 命令 | runtime python 存在，且 `--network=none` 下 `ktx --version` 成功 |
| G5 | 仓库冒烟 | `npm run smoke:p0:docker` | 全绿（推荐） |
| G6 | 配置包冒烟 | `npm run smoke:p0:headless-config -- --root customer-config.example --require-secret-files` | 8/8 PASS |
| G7 | 导出后复核 | `docker load -i <tar>` 后重跑 G1–G4 + **G4b** + **G8** | tar 内镜像与本地 tag 一致 |
| G8 | K8s 升级契约（**仅镜像**） | `bash scripts/g8-image-k8s-contract-gate.sh <tag>` | UID 10001；空 volume 自动 `.git`；runtime 在 `/home/lucy/.ktx` |

**G2–G4b + G8 为交付硬门禁**。缺 G4b 的镜像在客户内网执行查询时会尝试下载 `uv`，表现为 `ktx could not download uv`。缺 G8 的镜像/Chart 组合会导致 K8s 原地升级失败。

### G4b 命令（出包必跑）

```bash
# G4b-1: bake-in 的 Python runtime 文件存在（lucy 用户，非 root）
docker run --rm --platform linux/amd64 --entrypoint /bin/sh \
  project-lucy:customer-amd64-0.16.0 -c \
  'test -x /home/lucy/.ktx/runtime/0.16.0/.venv/bin/python'

# G4b-2: 无公网仍可启动 ktx（证明不依赖现场下载 uv）
docker run --rm --network=none --platform linux/amd64 \
  --entrypoint ktx project-lucy:customer-amd64-0.16.0 --version
```

### G8 命令（镜像-only，与 Helm 解耦）

```bash
TAG=project-lucy:customer-amd64-0.16.0
bash scripts/g8-image-k8s-contract-gate.sh "${TAG}"
```

`build-customer-amd64-image.sh` 在 G4b 后自动调用 G8。**H1 Helm 静态门禁单独执行**（不与镜像构建绑定）：

```bash
npm run gate:k8s-static
```

### Git 初始化职责（架构约定）

| 组件 | 职责 |
|---|---|
| **入口 `docker-entrypoint.sh`** | **唯一权威**：幂等 `git -C /data/lucy init` |
| **`project-migrate` init** | 仅 `chown -R 10001:10001 /data/lucy`（禁止 `git init`） |
| 已废弃 preflight | 不得复活 |

### PVC UID 迁移矩阵

| 旧 PVC `.git` 属主 | v3 行为 |
|---|---|
| UID **10001**（标准旧环境） | 直接兼容 |
| UID **0**（v1/v2 root 残留） | `projectMigrate` init chown → 10001 |
| 其他 UID（客户自建 Chart） | **不自动支持**；需人工评估 chown 或重建 PVC |

### Docker Compose 交付联动（同一镜像）

K8s 与 Compose 共用 customer-amd64 镜像时，Compose 侧必须同步：

- 验收 runtime 路径：`/home/lucy/.ktx/runtime/0.16.0/.venv/bin/python`（**非** `/root/.ktx`）
- 首次启动若 volume 权限报错：对 named volume 执行一次性 `chown 10001:10001`（见 `docs/customer-deployment-guide.md`）
- Compose 出包前仍跑 G0–G8；**不要求** LoadBalancer（属 K8s profile）

### 出包红线（禁止事项）

1. **禁止**仅凭 `Architecture=amd64` 或「上次已构建」结论出包。
2. **禁止**未经当场 G2–G4b 复用 `inbox/customer-amd64-offline-package/image/` 或任意历史 `*.tar`。
3. **禁止**用 `FROM --platform=$BUILDPLATFORM` 契约打客户 amd64 包。
4. **禁止** `docker buildx create --use lucy-amd64` 污染本机 demo 默认 builder（一律 `--builder lucy-amd64`）。
5. **禁止**构建失败后用旧坏包顶替交付。
6. **禁止**跳过 G4b：仅有 KTX CLI、无 bake-in Python runtime 的镜像不得交付内网客户。

## 导出 image tar

仅在 G0–G4 + G4b 全部通过后：

```bash
mkdir -p release
docker save -o release/project-lucy-customer-amd64-0.16.0-image.tar \
  project-lucy:customer-amd64-0.16.0
shasum -a 256 release/project-lucy-customer-amd64-0.16.0-image.tar \
  | tee release/project-lucy-customer-amd64-0.16.0-image.tar.sha256
# G7：再 load 到本地后重跑 assert + docker run smoke + G4b
bash scripts/assert-image-elf-arch.sh project-lucy:customer-amd64-0.16.0 amd64
docker run --rm --platform linux/amd64 --entrypoint /bin/sh \
  project-lucy:customer-amd64-0.16.0 -c 'echo ok'
docker run --rm --platform linux/amd64 --entrypoint /bin/sh \
  project-lucy:customer-amd64-0.16.0 -c \
  'test -x /home/lucy/.ktx/runtime/0.16.0/.venv/bin/python'
docker run --rm --network=none --platform linux/amd64 \
  --entrypoint ktx project-lucy:customer-amd64-0.16.0 --version
```

一键构建脚本：`bash scripts/build-customer-amd64-image.sh`  
- 默认 builder：`desktop-linux`（共用本机镜像缓存，减少 Hub 前端拉取失败）  
- 自动去掉 `# syntax=docker/dockerfile:1.7` 行生成临时 Dockerfile，避免 buildx 容器因 Hub/IPv6 拉取 frontend 失败  
- 构建失败时明确提示：**禁止**回退到 `inbox/customer-amd64-offline-package/` 历史坏包
## K8s integration 包额外 Gate

组装 `lucy-k8s-integration-delivery-*.tar.gz` 前：

| # | Gate | 说明 |
|---|---|---|
| H1 | Helm 静态 | `npm run gate:k8s-static`（H1a 通用 + H1b k3s profile） |
| K1 | 不得盲复用历史 tar | 禁止 copy 未过本轮 G2–G4b–G8 的历史 `*.tar` |
| K2 | 包内元数据 | `image/image-inspect.json` + `image-digest.txt` |
| K3 | 包内自证 | 解压后 `docker load` + G2 + G3 + G4b + G8 |
| **K6** | **包完整性自证** | `bash scripts/verify-k8s-package.sh --tar <pkg>` 或封包脚本自动执行 |
| K4 | Release 前 | 对上传 tar.gz 再跑 K6 |
| K5 | 机器可读作废 | `build-k8s-delivery-package.sh` **拒绝** `--version-suffix` 以 `-v1`/`-v2` 结尾 |

**K6 自动检查**：deprecated 包名、tag/digest 非占位符、`image-digest.txt` 与 values 一致、包内 Chart 过 H1。

**发客户「可直接升级」前还必须**：H3（`npm run gate:k8s-upgrade` 或 `k8s-release-gate.sh --test-upgrade`）+ H4（`--test-rollback`）+ H5。

## 作废规则

以下镜像 **不得**再交付（即使 tag 同名）：

- 2026-08-04 前后未过 ELF 门禁的 `project-lucy:customer-amd64-0.16.0`
- `inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar`（同因，直至被本 checklist 重建产物替换）
- GitHub Release `lucy-k8s-integration-20260827-v1` 中的 tar（已确认 arm64 ELF）
- `lucy-k8s-integration-delivery-20260902-v1` / `v2`（升级契约不完整，不得标「可直接原地升级」）

替换时：**升 Release tag**（如 `…20260902-v3`），旧 Release notes 标注作废，勿悄悄覆盖同名坏文件而不改说明。

## 构建 host 说明

| 构建机 | 做法 |
|---|---|
| amd64 native（强烈推荐） | `bash scripts/build-customer-amd64-image.sh` |
| Apple Silicon (arm64) | 可用 `lucy-amd64` builder + QEMU，**但必须**过 G2–G4b；不得以 metadata 代替 ELF；Hub 超时不得用旧坏包顶替 |

构建后恢复 demo builder：`docker buildx use default`。

## 关联文档

- `docs/customer-delivery-preflight-checklist.md`（全流程通用交付防坑指南）
- `docs/lucy-customer-amd64-offline-delivery-spec.md`
- `docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`
- `docs/plans/wo-202608-07-customer-amd64-delivery.md`
- `docs/plans/wo-202608-27-customer-k8s-delivery.md`
- `scripts/build-customer-amd64-image.sh`
- `scripts/g8-image-k8s-contract-gate.sh`
- `scripts/verify-k8s-package.sh`
- `scripts/k8s-upgrade-gate.sh`
