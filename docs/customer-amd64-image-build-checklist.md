# Lucy 客户 amd64 镜像构建 Checklist

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Customer amd64 Image Build Checklist |
| 文档类型 | Checklist |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-27；2026-08-28 增补 G4b（KTX Python/uv runtime 离线预装） |
| 撰写人 | Composer |
| 委托人 | xingchen |
| 基于材料 | 20260827 客户 `exec /usr/bin/tini: exec format error` 事故；`docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`；Release `lucy-k8s-integration-20260827-v1` 坏包复盘 |
| 适用范围 | 任何交付给客户的 `linux/amd64` Lucy 镜像（Docker Compose 离线包、K8s integration tar.gz、Release Assets） |
| 输出位置 | `docs/customer-amd64-image-build-checklist.md` |

## 背景

`docker image inspect … Architecture=amd64` **不能**作为交付依据。历史上出现过元数据 amd64、层内 ELF 为 **aarch64** 的坏包，客户在 x86_64 上运行会报：

```text
exec /usr/bin/tini: exec format error
```

**2026-08-27 事故链**：K8s 出包时直接复用 `inbox/customer-amd64-offline-package/image/*.tar`（2026-08-04 产物），**未重跑 G2 ELF 门禁**，导致坏包进 GitHub Release。

**铁律**：任何出包路径（含「复用旧 tar」）都必须**当场重跑 G1–G4 + G4b**；未通过则禁止复用、禁止 `docker save`、禁止更新 Release、禁止发给客户。构建失败（含 Docker Hub 超时）→ **不得**回退到旧坏包凑交付。

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
| G7 | 导出后复核 | `docker load -i <tar>` 后重跑 G1–G4 + **G4b** | tar 内镜像与本地 tag 一致 |

**G2–G4b 为交付硬门禁**。缺 G4b 的镜像在客户内网执行查询时会尝试下载 `uv`，表现为 `ktx could not download uv`。

### G4b 命令（出包必跑）

```bash
# G4b-1: bake-in 的 Python runtime 文件存在
docker run --rm --platform linux/amd64 --entrypoint /bin/sh \
  project-lucy:customer-amd64-0.16.0 -c \
  'test -x /root/.ktx/runtime/0.16.0/.venv/bin/python'

# G4b-2: 无公网仍可启动 ktx（证明不依赖现场下载 uv）
docker run --rm --network=none --platform linux/amd64 \
  --entrypoint ktx project-lucy:customer-amd64-0.16.0 --version
```

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
  'test -x /root/.ktx/runtime/0.16.0/.venv/bin/python'
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
| K1 | 不得盲复用历史 tar | 禁止直接 copy 未过本轮 G2–G4b 的 `inbox/customer-amd64-offline-package/image/` |
| K2 | 包内元数据 | 写入 `image/image-inspect.json` + `image-digest.txt` |
| K3 | 包内自证 | 解压后 `docker load` + G2 + G3 + **G4b** 通过再打外层 tar.gz |
| K4 | Release 前 | 对即将上传的 tar.gz 再抽检：load → G2 → G3 → G4b |

## 作废规则

以下镜像 **不得**再交付（即使 tag 同名）：

- 2026-08-04 前后未过 ELF 门禁的 `project-lucy:customer-amd64-0.16.0`
- `inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar`（同因，直至被本 checklist 重建产物替换）
- GitHub Release `lucy-k8s-integration-20260827-v1` 中的 tar（已确认 arm64 ELF）

替换时：**升 Release tag**（如 `…20260827-v2`），旧 Release notes 标注作废，勿悄悄覆盖同名坏文件而不改说明。

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
- `scripts/assert-image-elf-arch.sh`
