# Lucy Demo Builder ARM-default 修复规格

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Demo Builder ARM-default Fix Spec |
| 文档类型 | Developer-Experience Fix Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-05 |
| 适用范围 | 项目本机（Apple Silicon arm64）与同等开发者主机的 demo Lucy 重建/重启流程 |
| 对应问题 | demo 重建误用客户打包 builder（`lucy-amd64`）导致 QEMU 慢路径（常 >10 分钟像卡住）；以及平台 build-arg 为空时 `failed to parse platform : ""` |

> **Dockerfile 契约更新（2026-08-05）**：本规格 v0.2 曾写「不修改 `FROM --platform=$BUILDPLATFORM`」。该限制已被 [`docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`](./lucy-202608-08-image-arch-and-ktx-baseline-fix.md) **废止并替换**——`Dockerfile` 现绑定 `TARGETPLATFORM`。本规格其余条款（`BUILDX_BUILDER=default`、禁止客户 `create --use`）仍然有效；平台变量名以 202608-08 为准（`TARGETPLATFORM` / `TARGETARCH`）。

## 1. 背景与目标

### 1.1 背景

2026-08-04 / 2026-08-05 期间，本机（Apple Silicon，arm64）demo 重建出现两类问题：

1. **`BUILDPLATFORM` 为空**：`Dockerfile` 使用 `FROM --platform=$BUILDPLATFORM`；plain `docker build` / compose **不会**像 `docker buildx build` 那样自动注入该变量 → `failed to parse platform : ""`。
2. **客户 amd64 builder 污染全局当前 builder**：`lucy-customer-amd64-offline-delivery-spec` 曾使用 `docker buildx create --use --name lucy-amd64`，把全局选中 builder 切到 amd64 主平台。此后 `docker compose ... --build` 跟随当前 builder，在 ARM 上极易走 QEMU，表现为超过 10 分钟仍未完成。

`docker-compose.demo.yml` 已具备 `BUILDPLATFORM`/`TARGETARCH` 的 arm64 默认值；仅靠 compose args **不足以**阻止错选 builder。Compose yaml 无法可靠写死 `build.builder`，必须用 `BUILDX_BUILDER=default`（或等价 CLI）锁定本次构建。

### 1.2 目标

- 本机执行 **推荐入口** `npm run demo:rebuild`（`scripts/rebuild-demo-lucy.sh`）时：固定 `BUILDX_BUILDER=default`，按 host arch 设置 `BUILDPLATFORM`/`TARGETARCH`，一次完成重建，镜像平台与 host 一致。
- 客户 amd64 离线交付：创建 builder **禁止 `--use`**，构建一律 `--builder lucy-amd64`，结束后 `docker buildx use default`。
- 不修改 `Dockerfile` 的多架构契约；不破坏 `.github/workflows/lucy-release.yml`。

### 1.3 非目标

- 不修改 `Dockerfile` 的 `FROM --platform=$BUILDPLATFORM` 写法。
- 不强制删除本机已存在的 `lucy-amd64` / `lucy-builder`（可保留演练现场；demo 路径通过 `BUILDX_BUILDER=default` 隔离）。
- 不要求 plain `docker build`（不传 build-arg）成功——该路径仍须显式传 `BUILDPLATFORM`/`TARGETARCH`（或走 compose / 脚本）。
- 不在 ARM 本机把「无缓存 amd64 镜像构建」列为日常 DoD（那会故意制造 QEMU 慢路径）。

## 2. 修复规格

### 2.1 推荐入口：`scripts/rebuild-demo-lucy.sh`

行为契约：

| 项 | 要求 |
|---|---|
| Builder | 强制 `BUILDX_BUILDER=default`（仅影响本次进程环境） |
| 拒绝 | 若调用方已设 `BUILDX_BUILDER=lucy-amd64` 或 `lucy-builder` → 非零退出 |
| Platform | 按 `uname -m` 默认：`arm64\|aarch64` → `linux/arm64`；`x86_64\|amd64` → `linux/amd64`；允许环境变量覆盖（`TARGETPLATFORM` / `TARGETARCH`） |
| Compose | `docker compose -f docker-compose.demo.yml up -d --build lucy`；`--no-cache` 时改为 `build --no-cache` + `up -d --force-recreate --no-deps` |
| 断言 | 结束后 `project-lucy:demo` 的 `Os/Architecture` 必须等于所用 `TARGETPLATFORM`；并跑 `scripts/assert-image-elf-arch.sh` |

npm 入口：`package.json` → `"demo:rebuild": "bash scripts/rebuild-demo-lucy.sh"`。

### 2.2 `docker-compose.demo.yml` / `docker-compose.postgres-demo.yml`

`lucy.build.args`（变量名以 WO-202608-08 为准）：

```yaml
args:
  KTX_VERSION: "${KTX_VERSION:-0.16.0}"
  TARGETPLATFORM: "${TARGETPLATFORM:-linux/arm64}"
  TARGETARCH: "${TARGETARCH:-arm64}"
```

说明：compose 默认值面向 Apple Silicon 主开发机；跨 arch 主机优先用 §2.1 脚本（按 host 覆盖）。直接手写 compose 时须自行设 `BUILDX_BUILDER=default`。

### 2.3 客户 amd64 交付路径（必改）

`docs/lucy-customer-amd64-offline-delivery-spec.md` 与对应 plan：

1. `docker buildx create --name lucy-amd64 ...` — **禁止 `--use`**。
2. 构建始终带 `--builder lucy-amd64`。
3. 构建结束后执行 `docker buildx use default`。

### 2.4 清理残留 amd64 builder（可选）

仅当确认不再做客户交付演练时：

```bash
docker buildx stop lucy-amd64 lucy-builder 2>/dev/null || true
docker buildx rm lucy-amd64 lucy-builder 2>/dev/null || true
```

清理不是 demo 一次完成的前提；`BUILDX_BUILDER=default` 才是。

### 2.5 CI 与多架构交付

- `.github/workflows/lucy-release.yml` 走 `docker/setup-buildx-action`；`Dockerfile` 现绑定 `TARGETPLATFORM`（见 202608-08）。
- 客户交付仍显式 `--builder lucy-amd64 --platform linux/amd64`，并传 `TARGETPLATFORM`/`TARGETARCH` build-arg + ELF 门禁。
- 根 `docker-compose.yml` 默认 `linux/amd64`（客户主平台）；demo 路径不依赖该默认。

### 2.6 校验要求

1. **推荐入口（必做）**
   ```bash
   npm run demo:rebuild
   docker image inspect project-lucy:demo --format '{{.Os}}/{{.Architecture}}'
   # Apple Silicon 期望：linux/arm64
   ```
2. **拒绝客户 builder（必做）**
   ```bash
   BUILDX_BUILDER=lucy-amd64 bash scripts/rebuild-demo-lucy.sh
   # 期望：非零退出，且提示 reserved for customer packaging
   ```
3. **plain `docker build` 无 args（文档边界）**
   ```bash
   DOCKER_BUILDKIT=1 docker build -t project-lucy:dev-noargs -f Dockerfile .
   # 自 WO-202608-08 起 Dockerfile 默认 TARGETPLATFORM=linux/amd64，该命令不再因空 platform 失败；
   # 在 Apple Silicon 上可能走 QEMU amd64 或产出非 host-native 镜像——日常请用 npm run demo:rebuild。
   ```
4. **amd64 覆盖（可选；勿在 ARM 上做 --no-cache DoD）**
   仅在 amd64 native 或明确接受 QEMU 时：
   ```bash
   TARGETPLATFORM=linux/amd64 TARGETARCH=amd64 BUILDX_BUILDER=default \
     docker compose -f docker-compose.demo.yml build lucy
   ```

## 3. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 同事仍手写 `compose ... --build` 且当前 builder 为 `lucy-amd64` | DEVELOPMENT.md 写明推荐 `npm run demo:rebuild`；交付文档禁止 `--use` |
| compose 默认 arm64 与 x86 主机不一致 | 脚本按 host 覆盖；文档说明手写时的环境变量 |
| 误删仍需用的 `lucy-amd64` | 清理步骤保持可选 |

回滚：还原本 spec 涉及的 compose / script / package.json / 交付文档与 DEVELOPMENT.md 相关段落。

## 4. 验收定义（DoD）

- [ ] `scripts/rebuild-demo-lucy.sh` + `npm run demo:rebuild` 已落地。
- [ ] `docker-compose.demo.yml` / `docker-compose.postgres-demo.yml` 含 `TARGETPLATFORM`/`TARGETARCH` 默认值。
- [ ] 客户交付 spec/plan：**无** `create --use`；有结束后 `docker buildx use default`。
- [ ] `docs/DEVELOPMENT.md` 含本地 Docker demo 重建约定。
- [ ] 本机 `npm run demo:rebuild` 成功且镜像平台与 host 一致；`BUILDX_BUILDER=lucy-amd64` 调用脚本失败。
- [ ] Dockerfile / release workflow 的平台与 KTX 基线以 [`lucy-202608-08-image-arch-and-ktx-baseline-fix.md`](./lucy-202608-08-image-arch-and-ktx-baseline-fix.md) 为准（本规格不再禁止改 Dockerfile）。

## 5. 术语一致性

本文档遵循 [`webui/docs/00-product-terminology-standard.md`](../webui/docs/00-product-terminology-standard.md)：

- **builder**：docker buildx 实例。
- **demo 镜像**：`project-lucy:demo`，由 `docker-compose.demo.yml` / `demo:rebuild` 构建。
- **客户 amd64 builder**：`lucy-amd64`，仅用于离线交付打包，不得作为本机 demo 当前 builder。
