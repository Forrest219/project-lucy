# WO-20260901 K8s 交付体系加固（正式受支持 Helm Chart）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy K8s 交付体系加固执行计划 |
| 文档类型 | Spec / Work Order |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-01 |
| 委托人 | xingchen |
| 决策 | **选项 A** — `deploy/k8s/helm/lucy/` 为正式受支持 Chart，与镜像同版本交付 |
| 触发 | `lucy-k8s-20260901-v1` 升级审计：镜像正常，Chart/升级契约/交付包组织失败 |
| 关联 PR | [#32](https://github.com/Forrest219/project-lucy/pull/32) |

---

## 1. 目标

彻底消除「镜像过关、K8s 集成翻车」：

1. Chart、镜像、门禁、交付包四层绑定、同版本号、可审计。
2. 升级路径（N-1 → N）与回滚路径纳入硬门禁。
3. 产出干净的 `20260901-v2` 客户交付包。

## 2. 已完成（本 WO 第一批）

| 项 | 产物 |
|---|---|
| Chart 0.2.0 | HTTP 探针、端口分离、`image.digest` |
| 契约文档 | `deploy/k8s/K8S_CONTRACT.md` |
| 运维文档 | `helm/lucy/UPGRADE.md`、`ROLLBACK.md` |
| H1 静态门禁 | `scripts/helm-lucy-gate.sh` |
| H5 验收 | `scripts/k8s-acceptance.sh` |
| 门禁编排 | `scripts/k8s-release-gate.sh` |
| 测试 profile | `examples/values.k3s-test.yaml` |
| npm 入口 | `gate:k8s-static`、`gate:k8s-release`、`gate:k8s-acceptance` |
| 打包脚本骨架 | `scripts/build-k8s-delivery-package.sh` |

## 3. 待执行（按优先级）

### P0 — 测试环境

- [ ] 合并 PR #32 + 本 WO 追加 commit
- [ ] `lucy-test`：清 pending helm 状态
- [ ] `helm upgrade` + `values.k3s-test.yaml` + `--atomic --wait`
- [ ] `bash scripts/k8s-acceptance.sh --namespace lucy-test --release lucy --public-mcp-url http://10.69.95.109:8277/mcp --token …`
- [ ] 归档 `inbox/lucy-test-upgrade-YYYYMMDD.md`

### P1 — 门禁补全

- [ ] H2 kind 全新安装自动化（`scripts/k8s-fresh-install-gate.sh`）
- [ ] H3 N-1 升级 gate（load 旧镜像 tar → upgrade → 验收）
- [ ] H4 回滚 gate（故意坏 tag → `helm rollback` → 验收）
- [ ] 更新 `docs/customer-delivery-preflight-checklist.md` H2–H6 为硬门禁
- [ ] `docs/release-ci.md` 增加 `npm run gate:k8s-static` 到 release 路径

### P1 — 镜像与打包

- [ ] `build-customer-amd64-image.sh` 输出不可变 tag（含 date + git sha）
- [ ] 同 tag 不同 digest 时 fail
- [ ] 跑通 `build-k8s-delivery-package.sh` 产出 v2 干净包
- [ ] 外层仅 `*.tar.gz` + `*.sha256`，禁止 2.7GB 混合 ZIP

### P2 — 手册同步

- [ ] 更新 `Forrest219/lucy-customer-delivery` README → v2
- [ ] v1 标注作废；`RELEASE_NOTES.md` 写清探针/Chart 变更
- [ ] 修订 `wo-202608-27` 全文：Chart 从 reference 改为 supported

## 4. 完成定义

全部满足才可关闭本 WO：

1. Chart 0.2.x 为 supported delivery artifact
2. H1–H6 文档化；H1 + H5 脚本可用；H2–H4 至少在 kind 或 lucy-test 跑通一次
3. lucy-test 连续稳定；8276/8277/MCP/StarRocks 验收通过
4. v2 交付包结构符合 `K8S_CONTRACT.md`；无历史作废包
5. v1 明确作废；客户可独立按 UPGRADE.md 执行

## 5. Non-Goals

- HA / 多副本
- 非 root 镜像（单独 WO）
- K3s 一键装集群
- 客户 DB / MCP Token 明文进包

---

## 6. 门禁速查

```bash
# 每次改 Chart 后
npm run gate:k8s-static

# 集群可用时（lucy-test）
bash scripts/k8s-release-gate.sh \
  --with-cluster \
  --namespace lucy-test \
  --release lucy \
  --with-mcp \
  --public-mcp-url http://10.69.95.109:8277/mcp \
  --token "<bearer>"

# 出 v2 包前
bash scripts/build-k8s-delivery-package.sh \
  --image-tag project-lucy:customer-amd64-0.16.0-20260901-b893a0c \
  --output inbox/customer-k8s-integration-build/lucy-k8s-integration-delivery-20260901-v2.tar.gz
```
