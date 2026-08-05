# WO-202608-08 镜像架构一致性与 KTX 版本基线修复

> 对应规格：[`docs/lucy-202608-08-image-arch-and-ktx-baseline-fix.md`](../lucy-202608-08-image-arch-and-ktx-baseline-fix.md) **v1.0**
>
> 范围：修正 `FROM --platform=$BUILDPLATFORM` 导致的「元数据 amd64 / 层内 arm64」坏镜像；对齐 Release CI KTX 默认到 `0.16.0`；为客户 amd64 交付增加 ELF 门禁。结束后 **仅 code review**，不做浏览器验证。

## 1. 起点状态

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git rev-parse --short HEAD
rg -n 'FROM --platform|BUILDPLATFORM|TARGETPLATFORM' Dockerfile docker-compose*.yml scripts/rebuild-demo-lucy.sh
rg -n '0\.13\.0|0\.16\.0' .github/workflows/lucy-release.yml Dockerfile docker-compose.yml
```

## 2. 执行步骤

### Step 1 — Dockerfile

按 spec §4.1：`FROM --platform=$TARGETPLATFORM`，默认 `linux/amd64`；更新注释；保留 `KTX_VERSION=0.16.0` 与 `TARGETARCH`。

### Step 2 — Compose + demo 脚本

- demo / postgres-demo：`TARGETPLATFORM`/`TARGETARCH`（arm64 默认）
- 根 `docker-compose.yml`：显式 amd64 默认
- `scripts/rebuild-demo-lucy.sh`：导出并断言 `TARGETPLATFORM`

### Step 3 — ELF 断言脚本

新增 `scripts/assert-image-elf-arch.sh`（spec §4.4）。

### Step 4 — Release workflow

`.github/workflows/lucy-release.yml`：所有 KTX fallback / default / upgrade baseline 从 `0.13.0` → `0.16.0`。

### Step 5 — 客户交付与关联文档

更新：

- `docs/lucy-customer-amd64-offline-delivery-spec.md`
- `docs/plans/wo-202608-07-customer-amd64-delivery.md`
- `docs/version-matrix.md`
- `docs/DEVELOPMENT.md`
- `docs/lucy-202608-05-demo-builder-arm-default-spec.md`（交叉引用：Dockerfile 契约由本 WO 替换）

声明旧 `customer-amd64-0.16.0` 离线包作废。

### Step 6 — 非浏览器校验

```bash
rg -n 'FROM --platform=\$BUILDPLATFORM' Dockerfile   # 无
rg -n '0\.13\.0' .github/workflows/lucy-release.yml  # 无（KTX 相关）
bash -n scripts/rebuild-demo-lucy.sh scripts/assert-image-elf-arch.sh

# 若本地仍有坏镜像 tag：
bash scripts/assert-image-elf-arch.sh project-lucy:customer-amd64-0.16.0 amd64 ; test $? -ne 0

# 可选 demo 重建（有缓存）：
npm run demo:rebuild
bash scripts/assert-image-elf-arch.sh project-lucy:demo arm64
```

### Step 7 — Code review only

对本次 diff 做缺陷优先 code review；**不**做浏览器验证。

## 3. 完成定义（DoD）

- [x] Spec v1.0 + 本 plan 与实现一致
- [x] Dockerfile 使用 `TARGETPLATFORM`；无 `FROM --platform=$BUILDPLATFORM`
- [x] demo/postgres/根 compose + rebuild 脚本对齐
- [x] `assert-image-elf-arch.sh` 可用；坏 amd64 标签镜像会被拒绝
- [x] release workflow KTX 默认 / fallback / upgrade baseline = `0.16.0`
- [x] 客户交付文档含 TARGETPLATFORM build-arg + ELF 门禁 + 旧包作废声明
- [x] 无浏览器验证；有 code review 结论（APPROVE_WITH_NITS，MINOR 已跟进）

## 4. 回滚

还原本 plan 触及文件。禁止以「恢复 BUILDPLATFORM」作为长期方案。
