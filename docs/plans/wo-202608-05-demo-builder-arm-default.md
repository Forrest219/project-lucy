# WO-202608-05 demo compose arm-default 修复执行计划

> 对应规格：[`docs/lucy-202608-05-demo-builder-arm-default-spec.md`](../lucy-202608-05-demo-builder-arm-default-spec.md) **v0.2**
>
> 范围：让本机 demo Lucy 重建固定走 `BUILDX_BUILDER=default` + host-native `BUILDPLATFORM`，并切断客户交付 `create --use` 对全局 builder 的污染。不修改 `Dockerfile`，不动 `.github/workflows/lucy-release.yml`。

## 1. 起点状态

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git rev-parse HEAD
docker buildx ls                    # 记录是否存在 lucy-amd64 / 当前是否 default*
grep -nE "BUILDPLATFORM|TARGETARCH" docker-compose.demo.yml docker-compose.postgres-demo.yml
test -x scripts/rebuild-demo-lucy.sh || echo "script missing"
```

## 2. 执行步骤

### Step 1 — 落地推荐入口脚本 + npm

确保 `scripts/rebuild-demo-lucy.sh` 可执行，且 `package.json` 有 `"demo:rebuild"`。

契约见 spec §2.1（强制 `BUILDX_BUILDER=default`、拒绝 `lucy-amd64`/`lucy-builder`、按 host 设 platform、结束后断言镜像 arch）。

### Step 2 — compose args

- `docker-compose.demo.yml`：保留/确认 `BUILDPLATFORM`/`TARGETARCH` 默认 `linux/arm64` / `arm64`，注释指向脚本。
- `docker-compose.postgres-demo.yml`：按相同模式补齐两个 args。

### Step 3 — 切断客户交付 `--use` 污染

更新：

- `docs/lucy-customer-amd64-offline-delivery-spec.md`
- `docs/plans/wo-202608-07-customer-amd64-delivery.md`

要求：`create` 不加 `--use`；构建后 `docker buildx use default`。

### Step 4 — DEVELOPMENT.md

在 Onboarding 后增加「本地 Docker demo 重建」短节（推荐 `npm run demo:rebuild`；手写须 `BUILDX_BUILDER=default`；客户包禁止 `--use`）。

### Step 5 — 校验（无浏览器）

```bash
# 5a 拒绝客户 builder
BUILDX_BUILDER=lucy-amd64 npm run demo:rebuild ; test $? -ne 0

# 5b 正常重建（可用缓存；不必 --no-cache）
npm run demo:rebuild
docker image inspect project-lucy:demo --format '{{.Os}}/{{.Architecture}}'
# Apple Silicon 期望 linux/arm64

docker buildx ls | head -5
# 期望 default* 仍为当前（脚本不永久切换；若曾被 --use 污染，交付流程应已 use default）
```

**不要**把「ARM 上 `BUILDPLATFORM=linux/amd64 ... build --no-cache`」当作必过 DoD。

### Step 6 — （可选）清理残留 builder

仅当确认不再演练客户交付时 `docker buildx rm lucy-amd64 lucy-builder`。

## 3. 收尾与回滚

```bash
test -x scripts/rebuild-demo-lucy.sh
grep -q demo:rebuild package.json
grep -n BUILDPLATFORM docker-compose.demo.yml docker-compose.postgres-demo.yml
grep -n "禁止 --use\|禁止加 --use" docs/lucy-customer-amd64-offline-delivery-spec.md
```

回滚：还原上述文件；客户交付恢复前需知晓 `--use` 会再次污染 demo。

## 4. 完成定义（DoD）

- [ ] spec v0.2 + 本 plan 与实现一致。
- [ ] `npm run demo:rebuild` 可用；错设 `BUILDX_BUILDER=lucy-amd64` 失败。
- [ ] demo / postgres-demo compose 含 platform args。
- [ ] 客户交付文档无 `create --use`，有 `docker buildx use default`。
- [ ] `docs/DEVELOPMENT.md` 已补充重建约定。
- [ ] 未改 `Dockerfile` / release workflow。
