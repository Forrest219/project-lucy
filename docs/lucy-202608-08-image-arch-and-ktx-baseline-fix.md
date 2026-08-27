# Lucy 镜像架构一致性与 KTX 版本基线修复规格

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Image Architecture Integrity & KTX Baseline Fix Spec |
| 文档类型 | Fix Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | 张兴晨 |
| 基于材料 | 客户部署风险复核；`inbox/customer-amd64-offline-package` 坏镜像取证；`Dockerfile`；`.github/workflows/lucy-release.yml`；`docs/lucy-202608-05-demo-builder-arm-default-spec.md` |
| 适用范围 | Docker 镜像构建契约、客户 amd64 离线交付门禁、Release CI KTX 版本基线 |
| 输出位置 | `docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md` |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（沿用既有：MCP Proxy、customer config package、`/data/lucy`、KTX）

## 1. 背景与问题

2026-08-05 客户部署评估指出：不宜覆盖现网，应并行隔离测试。仓库取证确认其中核心技术风险**真实存在**：

1. **跨架构坏镜像**：`Dockerfile` 使用 `FROM --platform=$BUILDPLATFORM`。在 Apple Silicon 上执行 `docker buildx build --platform linux/amd64` 时，镜像 **OCI/Docker 元数据可为 amd64**，但层内 ELF（如 `/usr/local/bin/node`）仍为 **ARM aarch64**。现有 `inbox/customer-amd64-offline-package/image/project-lucy-customer-amd64-0.16.0-image.tar` 已坐实该缺陷。
2. **KTX 版本基线漂移**：源码 / Compose / version-matrix 默认 `@kaelio/ktx@0.16.0`，但 `.github/workflows/lucy-release.yml` 的 `workflow_dispatch` default 与 job `env` fallback 仍为 `0.13.0`；push/PR 上的 `smoke:p0:docker` 会按 env 构建 **0.13.0**，与文档宣称的 0.16.0 不一致。
3. **与 WO-202608-05 的关系**：demo builder 隔离（`BUILDX_BUILDER=default`）仍然有效；但该工单明确「不修改 Dockerfile」——本规格**废止该限制**，以架构正确性优先。

## 2. 目标

- 镜像 **元数据架构** 与 **层内原生二进制架构** 必须一致。
- `Dockerfile` 的 `FROM --platform=...` 绑定 **TARGETPLATFORM**（目标平台），不再绑定 BUILDPLATFORM。
- Release / smoke 默认 KTX 与 Dockerfile / Compose / version-matrix 对齐为 **0.16.0**。
- 客户 amd64 交付增加 **ELF 二进制门禁**（仅检查元数据不够）。
- 本地 demo 重建继续 host-native；推荐入口仍为 `npm run demo:rebuild`。

## 3. 非目标

- 不在本工单内重新导出客户离线包或替换 `inbox/` 历史坏产物（文档声明作废即可）。
- 不在本工单内打正式 git Release Tag / 发 GH Release。
- 不在 ARM 主机上把「无缓存 amd64 全量构建」列为日常 DoD（仍可为可选 QEMU 慢路径）。
- 不做浏览器验证；不做客户 Ubuntu 现场部署演练（由后续交付工单承接）。
- 不修改 WebUI 业务功能、语义层内容、Token/ACL 产品逻辑。

## 4. 修复规格

### 4.1 Dockerfile

```dockerfile
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:22-bookworm-slim

ARG KTX_VERSION=0.16.0
ARG TARGETARCH=amd64
```

约束：

- **禁止** `FROM --platform=$BUILDPLATFORM`。
- 注释须说明：元数据与层内二进制以 TARGETPLATFORM 为准；跨架构构建依赖 QEMU/buildx，客户 amd64 包应在 **amd64 native** 上构建。
- `TARGETARCH` 保留供未来原生依赖分支；默认与客户主平台一致（`amd64`）。

### 4.2 Compose / demo 重建脚本

| 文件 | 要求 |
|---|---|
| `docker-compose.demo.yml` | build args：`TARGETPLATFORM`（默认 `linux/arm64`）、`TARGETARCH`（默认 `arm64`）；删除对 BUILDPLATFORM 的 FROM 契约说明 |
| `docker-compose.postgres-demo.yml` | 同上 |
| `docker-compose.yml` | 增加显式 `TARGETPLATFORM`/`TARGETARCH`（默认 `linux/amd64`/`amd64`），避免 plain compose 在 ARM 上误用 Dockerfile 默认 amd64 却未声明意图 |
| `scripts/rebuild-demo-lucy.sh` | 按 host 设置 `TARGETPLATFORM`/`TARGETARCH`；断言 `project-lucy:demo` 的 `Os/Architecture` **等于** `TARGETPLATFORM` |

WO-202608-05 的 `BUILDX_BUILDER=default` 与拒绝 `lucy-amd64`/`lucy-builder` 行为保持不变。

### 4.3 Release workflow KTX 基线

`.github/workflows/lucy-release.yml`：

| 项 | 旧值 | 新值 |
|---|---|---|
| `inputs.ktx_version.default` | `0.13.0` | `0.16.0` |
| `env.KTX_VERSION` / `LUCY_EXPECTED_KTX_VERSION` fallback | `0.13.0` | `0.16.0` |
| `ktx-upgrade-compat` 触发条件 | `inputs.ktx_version != '0.13.0'` | `!= '0.16.0'` |
| `compat:ktx-upgrade --baseline` | `0.13.0` | `0.16.0` |

### 4.4 客户 amd64 交付门禁

更新 `docs/lucy-customer-amd64-offline-delivery-spec.md` 与 `docs/plans/wo-202608-07-customer-amd64-delivery.md`：

1. 构建必须传：
   ```bash
   --platform linux/amd64 \
   --build-arg TARGETPLATFORM=linux/amd64 \
   --build-arg TARGETARCH=amd64 \
   --build-arg KTX_VERSION=0.16.0
   ```
2. **元数据门禁**（已有）：`docker image inspect … '{{.Os}}/{{.Architecture}}'` = `linux/amd64`。
3. **新增 ELF 门禁**：用脚本从镜像取出 `/usr/bin/tini`（ENTRYPOINT）与 `/usr/local/bin/node`，`file` 输出必须匹配 `x86-64` / `x86_64`，**不得**出现 `ARM` / `aarch64`。现场典型失败：`exec /usr/bin/tini: exec format error`。
4. 明确：2026-08-04 前后基于 `FROM --platform=$BUILDPLATFORM` 打出的 `customer-amd64-0.16.0` 离线包**作废**，不得交付客户。

新增脚本：`scripts/assert-image-elf-arch.sh`

```text
用法: scripts/assert-image-elf-arch.sh <image> <expected-arch>
expected-arch: amd64 | arm64
```

行为：`docker create` → `docker cp` `/usr/bin/tini` 与 `/usr/local/bin/node` → `file` 断言 → `docker rm`；失败非零退出。

### 4.5 文档同步

| 文档 | 变更 |
|---|---|
| `docs/version-matrix.md` | Image architecture evidence 改为 `TARGETPLATFORM` + ELF 门禁 |
| `docs/DEVELOPMENT.md` | demo 重建说明改为 `TARGETPLATFORM`/`TARGETARCH` |
| `docs/lucy-202608-05-demo-builder-arm-default-spec.md` | 增加「Dockerfile 契约已被 202608-08 废止/替换」交叉引用（保留 builder 隔离条款） |

## 5. 验收（无浏览器）

1. `rg -n 'FROM --platform=\$BUILDPLATFORM' Dockerfile` → 无匹配。
2. `rg -n 'default: \"0\\.13\\.0\"|\\|\\| \\0470\\.13\\.0\\047' .github/workflows/lucy-release.yml` → 无匹配（KTX 相关）。
3. `bash -n scripts/rebuild-demo-lucy.sh scripts/assert-image-elf-arch.sh`
4. 对已知坏镜像（若本地仍 load）：
   ```bash
   bash scripts/assert-image-elf-arch.sh project-lucy:customer-amd64-0.16.0 amd64
   # 期望非零退出
   ```
5. 可选（Apple Silicon，有缓存即可）：`npm run demo:rebuild` 后镜像为 `linux/arm64`，且
   `bash scripts/assert-image-elf-arch.sh project-lucy:demo arm64` 通过。
6. Code review only；**不做**浏览器验证。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 跨架构构建变慢（走 QEMU） | 客户包要求 amd64 native；demo 走 host-native |
| 旧文档仍写 BUILDPLATFORM | 本工单同步关键路径；历史 ledger 备注可保留 |
| CI multi-arch arm64 首次变慢/失败 | release-package 已启用 QEMU；失败则修门禁而非退回 BUILDPLATFORM |

回滚：还原本规格触及的 Dockerfile / compose / workflow / 脚本 / 文档；重新启用 BUILDPLATFORM 视为已知缺陷回归。
