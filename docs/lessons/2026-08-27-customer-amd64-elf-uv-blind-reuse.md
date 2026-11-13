# 错题：客户 amd64 交付——元数据 amd64 ≠ ELF；无 bake-in runtime；盲复用坏 tar

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-08-27 |
| 标签 | `ops-delivery` `gate-gap` `sev-high` |
| 环境 | 客户 x86_64／离线无公网；Apple Silicon 交叉构建出包 |
| 相关 | [`customer-amd64-image-build-checklist.md`](../runbooks/customer-amd64-image-build-checklist.md)；[`lucy-202608-08-image-arch-and-ktx-baseline-fix.md`](../specs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md)；Release `lucy-k8s-integration-20260827-v1` |
| 状态 | `mitigated`（G2／G4b／禁止盲复用已进脚本与镜像 checklist；登记 ≠ 每次出包可免检） |

## 1. 症状与影响

1. Pod／容器启动：`exec /usr/bin/tini: exec format error`（客户 amd64 上跑不起来）。
2. 镜像能起、Catalog／静态 YAML 可读，但查数时报 `ktx could not download uv …`（内网无外网）。
3. 坏包进 GitHub Release／交付 tar，后续「复用上次 image/*.tar」继续扩散。

## 2. 复现要点

- 仅看 `docker inspect … Architecture=amd64` 就出包；层内 `node`／`tini` 实为 aarch64。
- 镜像有 KTX CLI、无 `/home/lucy/.ktx/runtime/…/.venv/bin/python` bake-in；离线首次查数拉 uv。
- 出包路径 `cp`／直接打包 `inbox/…/image/*.tar` 等历史产物，未当场重跑 G2–G4b／G8。

## 3. 根因

| 表象 | 根因 |
|---|---|
| inspect 显示 amd64 | 元数据／平台声明与层内 ELF 可分离；交叉构建未锁死 `TARGETPLATFORM`／未做 ELF 断言 |
| uv 下载失败 | 查询依赖 DuckDB／Python runtime；构建漏装或未落盘；客户环境无公网 |
| 坏包扩散 | 「上次能用」替代本轮门禁；Release 未机器可读作废 |

## 4. 为何漏检

- 门禁停在镜像元数据，未对 **node + tini** 做 `readelf`／`file`。
- 无 `--network=none` 下的 `ktx --version`／runtime 路径存在性检查。
- 封包允许复用未过本轮门禁的历史 tar。

## 5. 举一反三

1. 客户 amd64 包：**禁止**仅凭 `Architecture=` 放行；必须 G2 ELF（node+tini）。
2. 内网客户：**必须** G4b（runtime 落盘 + `--network=none`）；缺则不得交付。
3. **禁止**盲复用未过本轮 G2–G4b–G8 的历史 `*.tar`；构建失败不得拿旧坏包顶替。
4. 坏包：升 Release tag、notes 标明作废；打包脚本拒绝已作废 suffix（如历史 `-v1`/`-v2`）。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| G2／G4b／G8 写入 `build-customer-amd64-image.sh` 与镜像 checklist | 完成 | 操作 SOT＝[`customer-amd64-image-build-checklist.md`](../runbooks/customer-amd64-image-build-checklist.md) |
| 旧「全流程 preflight」大清单 | 作废 | 经验进本错题本；门禁勿再抄第二份 |

## 7. 证据指针

- 镜像 checklist「背景」「出包红线」「作废规则」
- `scripts/release/assert-image-elf-arch.sh`、`scripts/release/build-customer-amd64-image.sh`
