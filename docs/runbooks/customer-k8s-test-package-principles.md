# Lucy K8s 待测包原则

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy K8s Test Package Principles |
| 文档类型 | Runbook / 可复用原则 |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-07 |
| 委托人 | xingchen |
| 适用范围 | 在 Apple Silicon Mac 上构建、再送到自备 amd64 服务器做客户 K8s 平滑升级模拟的**待测包**。客户正式发放仍走 [`customer-delivery-preflight-checklist.md`](customer-delivery-preflight-checklist.md) 的 Go / No-Go |
| 关联文档 | [`customer-amd64-image-build-checklist.md`](customer-amd64-image-build-checklist.md)、[`deploy/k8s/K8S_CONTRACT.md`](../../deploy/k8s/K8S_CONTRACT.md)、[`deploy/k8s/helm/lucy/UPGRADE.md`](../../deploy/k8s/helm/lucy/UPGRADE.md) |

本文件是「Mac 构建 → amd64 服务器模拟升级 → 再决定是否成为客户包」的事实来源。与下文「历史计划」冲突时，以本文件和当前脚本为准。

## 两种产物

| 产物 | 目的 | 构建机 | 何时算完成 |
|---|---|---|---|
| **待测包** | 送到自备 amd64 服务器，模拟客户 K8s 平滑升级。不交给客户 | Apple Silicon Mac 可以构建镜像并组装 tar | 镜像构建成功，且本机 G1、G2 通过。tar 使用测试后缀 |
| **客户包** | 标注可直接原地升级，发放给客户 | 镜像可以仍由 Mac 构建；G4/G4b 与升级验收在 amd64 原生环境判定 | 预检清单 Go / No-Go 全部满足，包身份（后缀、digest、Chart、git SHA）按该次测试结果重新定稿 |

待测包升格为客户包之前，不沿用待测后缀，不把测试环境的 MCP 地址、PVC 名、Secret 名写进客户 values。

## 权威材料与历史计划

出待测包时阅读这些材料：

- [`deploy/k8s/K8S_CONTRACT.md`](../../deploy/k8s/K8S_CONTRACT.md) — 端口、副本、探针、UID、升级契约
- [`deploy/k8s/helm/lucy/UPGRADE.md`](../../deploy/k8s/helm/lucy/UPGRADE.md) — 原地升级步骤与症状对照
- [`scripts/gates/build-k8s-delivery-package.sh`](../../scripts/gates/build-k8s-delivery-package.sh) — 当前封包脚本
- 根目录 `VERSION` 与 `deploy/k8s/helm/lucy/Chart.yaml` — 产品版本与 Chart 版本的事实来源

下列计划记录的是已过时的出包步骤，**不要**当作本次操作手册：

- [`docs/plans/wo-202608-27-customer-k8s-delivery.md`](../plans/wo-202608-27-customer-k8s-delivery.md)：仍含「Chart 仅作参考」「可跳过 ELF」「复用历史 tar」「`runAsUser: 0`」「镜像 0.16.0」
- [`docs/plans/wo-20260901-k8s-delivery-hardening.md`](../plans/wo-20260901-k8s-delivery-hardening.md)：H2–H4 与非 root 镜像的勾选状态已落后于仓库；Chart 现为受支持交付物，运行 UID 为 10001

2026-10-09 的仓库基线：Chart `0.2.4`，`VERSION` `0.17.0`，捆绑 KTX `0.16.0`。以后以文件内容为准，不要从旧 WO 抄版本号。

## Mac 可以构建待测镜像

Apple Silicon 是合法的客户镜像构建机。以往交给用户、在 amd64 上正常运行的包，就是在 Mac 上交叉构建的。

客户环境里出现过的架构故障是另一件事：旧 Dockerfile 使用 `FROM --platform=$BUILDPLATFORM`，镜像元数据可以是 amd64，层内 `node` / `tini` 仍是 aarch64，x86 上表现为 `exec format error`。现行 Dockerfile 使用 `FROM --platform=$TARGETPLATFORM`。2026-09-27 的 QEMU `signal 11` 发生在构建期的 glibc 版 `uv`；Dockerfile 已改为 musl 静态 `uv`，使 `ktx admin runtime install` 能在 Apple Silicon 的 `docker build --platform linux/amd64` 里完成并写入镜像层。客户或测试服务器以原生 amd64 执行这些层，不再经过 QEMU。

本机构建命令必须同时满足：

- `--platform linux/amd64`
- `--build-arg TARGETPLATFORM=linux/amd64`
- `--build-arg TARGETARCH=amd64`
- 禁止 `FROM --platform=$BUILDPLATFORM`
- 禁止 `docker buildx create --use` 把 `lucy-amd64` 设成默认 builder

一键入口：`bash scripts/release/build-customer-amd64-image.sh`。

### 本机必须通过的门禁

| 门禁 | 本机角色 |
|---|---|
| G1 元数据 `linux/amd64` | 待测包放行条件 |
| G2 `node` 与 `tini` ELF 为 x86-64 | 待测包放行条件。只读 ELF 头，不执行 `ktx`。这是拦住「标签 amd64、二进制 arm64」的检查 |
| 构建日志里 `ktx admin runtime install` 所在的 `RUN` 成功 | 待测包放行条件。runtime 是在构建期写进层的 |

### 本机执行 `ktx` 的门禁

G4、G4b-2、G4b-3、G8 会在 Mac 上用 QEMU 再执行 `ktx` 或入口进程。此处若出现 `qemu: uncaught target signal 11`：

- 不能据此判定镜像不可用
- 不能据此改去复用历史 tar
- `build-customer-amd64-image.sh` 会以非零退出，但已构建成功的本地镜像还在，可以 `docker save`

G4b-1（`test -x` Python runtime 路径）走 `/bin/sh`，本机可以跑。它证明文件在层里，不证明 `ktx` 在 QEMU 下能启动。

amd64 服务器加载 tar 之后，用原生执行判定 G4 与 G4b。那一步是待测包的测试内容，不是 Mac 产出 tar 的前置条件。

### 打包脚本会删掉「QEMU 失败」的 tar

`build-k8s-delivery-package.sh` 在写出 tar 之后调用 `verify-k8s-package.sh`，默认再次 `docker run ktx`（K6-5）。QEMU 段错误会使脚本删除未完成的 tar。

待测包若在 Mac 上封包：不要把这次 K6 的 `ktx` 执行当成封包失败。封包脚本现在暴露 `--skip-ktx-exec`（透传给 `verify-k8s-package.sh`）：只跳过会在 QEMU 下执行 `ktx` 的 K6-5 步骤，G1 元数据与 G2 ELF 头检查照常执行。在 Mac 上封待测包时使用它，并在包外注明「G4/G4b 留待 amd64 原生验收」。

## 待测包身份

- 传入新的 `--version-suffix`（例如 `20261007-test`）。脚本默认后缀 `20260902-v3` 是历史客户包名，待测包不要沿用。
- 脚本拒绝 `-v1` / `-v2` 后缀。
- 镜像 tag 形如 `customer-amd64-<VERSION>-<YYYYMMDD>-<gitSha>`，与 `VERSION`、镜像内 `LUCY_VERSION` 一致。
- 离线待测包：`pullPolicy: Never`，`image.digest` 留空。config ID 写入 `image/image-config-id.txt`，不要填进 Helm `image.digest`。
- 目标是 K3s/containerd：节点上用 `sudo k3s ctr images import image/project-lucy-*.tar` 导入，不是 `docker load`；Values 的 `repository:tag` 必须与 `k3s ctr images list` 完全一致。
- 包内 `BUILD-INFO.json` 记录构建 commit（含 dirty 标记）、镜像 config ID/digest、`linux/amd64` 与依赖版本；封包前工作区应已提交，镜像 tag 中的 git SHA 指向该提交。
- `examples/values.k3s-test.yaml` 里的 `http://10.69.95.109:8277/mcp`、PVC `lucy`、Secret `lucy-starrocks`、`fullnameOverride: lucy`（Release `lucy-starrocks`）、`LUCY_CONTENT_ROOT: "."`、LoadBalancer `8276/8277` 是既有测试环境剖面。只有自备服务器就是这套时才直接使用；否则用该服务器的 namespace、PVC、Secret 和 MCP 地址覆盖后再升级。

## 平滑升级模拟要证明的事

自备 amd64 服务器上的测试就是这次的 H3/H5，不要求在产出 tar 之前先跑完 kind H3。

升级时保留 PVC 上的 `/data/lucy`（`ktx.yaml`、semantic-layer、wiki、evals、skills、`access.yaml`、`.ktx/`、audit）以及数据库密码和 MCP Token 的 Secret。禁止为了「测干净」而 `kubectl delete pvc` 或 `helm uninstall` 后重装，除非这一轮明确要测全新安装。

Chart 契约：单副本、`Recreate`、RWO、容器端口 5174/7879、Service 不暴露 7878、HTTP 探针 `/api/health`、运行 UID/GID 10001、`project-migrate` 只 `chown`、`git init` 只在入口。

自动化 kind 门禁的 N-1 基线是 `deploy/k8s/gate/n1-baseline.txt`（`3c4d067`，Chart 0.2.1，已是 UID 10001 契约），并用 chown 模拟 UID 0 与 UID 10001 两种旧盘。它不从 Chart 0.1.x 或已作废的 `20260902-v1` / `v2` Deployment 起装。若测试服务器仍停在那类旧 Chart，以服务器上的 `helm upgrade` 为准，并对照 `UPGRADE.md` 的 values 迁移表（容器端口与 Service 端口拆分、去掉 exec 探针和 `k8s-preflight`）。

kind 门禁的 sentinel 不含 `evals/`。契约要求升级后保留 `evals/`；服务器模拟时单独看这个目录是否还在。

## 2026-10-07 工作区上下文

构建用的树必须包含 Dockerfile 对模板路径的修正：`customer-config.example/config/semantic-layer` 与 `customer-config.example/config/wiki`。目录已经迁到 `config/` 下。不带这处修改的构建会在拷贝模板时失败。该修改在落笔时尚未提交；镜像 tag 里的 git SHA 应指向包含它的提交。

## 核心流程（伪代码）

```text
if 目标是客户包:
  走 customer-delivery-preflight-checklist 的 Go/No-Go
  停止

# 待测包
assert Dockerfile 使用 TARGETPLATFORM，且模板路径指向 customer-config.example/config/
在 Mac 上 docker build --platform linux/amd64
  且 TARGETPLATFORM=linux/amd64、TARGETARCH=amd64
if 构建失败:
  停止，禁止用历史 tar 顶替
assert G1 == linux/amd64
assert G2：node 与 tini 均为 x86-64
if 本机 G4/G4b/G8 出现 qemu signal 11:
  保留镜像，标记「ktx 执行门禁留待 amd64」
else if 本机 G4/G4b/G8 因缺文件、架构或版本不符失败:
  停止

组装 tar，version-suffix 含 test，且不是 20260902-v3 / -v1 / -v2
if 封包脚本因本机 K6 执行 ktx 而失败:
  不要把 tar 删掉之后改用旧包；改为在 amd64 上封包，或跳过本机 ktx 执行校验并注明

把 tar 送到自备 amd64 服务器
docker load
在原生 amd64 上跑 G4 与 G4b
用该服务器真实的 namespace / PVC / Secret / MCP URL 做 helm upgrade
确认 PVC 上的配置、ACL、audit、semantic、wiki、skills、evals、.git 仍在
记录 Chart 版本、镜像 tag、config ID、git SHA、包 SHA256

只有上述原生验收通过，才允许另起客户包后缀并走客户 Go/No-Go
```

## Terminology Compliance

This runbook follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **待测包**：内部交付阶段名称，指尚未在 amd64 上完成平滑升级验收、不发放给客户的 K8s integration tar。不是 WebUI 文案。
- **客户包**：内部交付阶段名称，指已满足 [`customer-delivery-preflight-checklist.md`](customer-delivery-preflight-checklist.md) Go / No-Go、可以标注原地升级并发放的包。不是 WebUI 文案。
