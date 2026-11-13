# 错题：K8s 原地升级——镜像过门禁仍因 Chart／入口／PVC 契约失败

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-09-02 |
| 标签 | `ops-delivery` `gate-gap` `contract-stack` `sev-high` |
| 环境 | K3s／客户 K8s；N-1 PVC 含 `.git`／ACL／Token／semantic／wiki |
| 相关 | [`customer-amd64-image-build-checklist.md`](../runbooks/customer-amd64-image-build-checklist.md) G8／H3–H5；`scripts/gates/k8s-upgrade-gate.sh`；`deploy/k8s/helm/lucy/UPGRADE.md` |
| 状态 | `mitigated`（G8 镜像契约 + H3 N-1／H4 回滚自动化；客户包仍须按现网门禁执行） |

## 1. 症状与影响

`lucy-k8s-integration-delivery-20260902-v1/v2`：amd64／KTX／Python runtime 均正常，**原地升级仍失败**——探针超时、git ownership、缺 `.git`、Service 不通、MCP fallback、升级后丢 Token／ACL 等。曾被误标「可直接原地升级」。

## 2. 复现要点

只修探针或只换镜像，不跑 **H3（真实 N-1 旧 PVC）**／**H4（失败回滚核对 imageID）**；或现场 `git init`／`chown`／`kubectl set env`／Deployment patch 顶替契约。

## 3. 根因

镜像层正确 ≠ 升级契约完整。失败落在：**入口唯一权威 `git init`**、**UID 10001 + projectMigrate 仅 chown**、**HTTP `/api/health` 探针**、**Service 暴露形态**、**values 中 MCP URL**、**PVC 不得误删** 等叠加。

## 4. 为何漏检

门禁停在「镜像能起／静态 lint」；缺少真实不同 N-1/N image+Chart 的升级与回滚自动化；现场手工补丁掩盖包缺陷。

## 5. 举一反三

1. 禁止「只修探针就发升级包」；客户「可原地升级」须 H3+H4（自动化）+ H5 证据。
2. 禁止现场 `git init`／随意 `chown`／`kubectl set env`／Deployment patch 代替 Chart／入口合同。
3. G8 只证明镜像侧契约；Helm H1 与升级门禁不可省略。
4. 无客户日志时，用下表对照现象再决定是否出新包，而不是改现场。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| G8／`k8s-upgrade-gate`／CI H3 | 完成 | 操作 SOT＝镜像 checklist + `docs/governance/release-ci.md` |
| 旧 preflight 内 H 表／Go-No-Go 勾选 | 作废 | 易过期；以脚本与现行 checklist 为准 |

## 7. 证据指针与症状对照

| 现象 | 根因 | 交付侧动作 |
|---|---|---|
| `k8s-preflight.sh: No such file` | 旧 Chart init 仍引用已删脚本 | Chart 0.2.x+；移除 `runtime-preflight` |
| `Startup probe failed: command timed out` | exec `docker-healthcheck.sh` 探针 | 升级至 HTTP `/api/health` 探针 Chart |
| `dubious ownership in repository at '/data/lucy'` | root 容器 vs UID 10001 的 `.git` | UID 10001 镜像+Chart；`projectMigrate` chown |
| Pod CrashLoop，PVC 无 `.git` | 入口未 `git init` | 入口为唯一权威；查 init／entrypoint 日志 |
| `GIT_CONFIG_COUNT ... not permitted` | 错误 Git 配置注入 | 从 values 移除；禁止不安全 env count |
| Pod Running 但 8276/8277 不通 | Service 为 ClusterIP 等 | LoadBalancer／NodePort；查 K3s ServiceLB |
| MCP fallback | `LUCY_PUBLIC_MCP_URL` 未进 Helm values | 写 values 后 `helm upgrade`；禁止只 `kubectl set env` |
| 行为与预期 build 不一致 | 包内 tag／digest 与镜像 tar 不一致 | Offline／Registry 身份自证（K6） |
| 升级后 Token／ACL 丢失 | 误删 PVC 或 Secret | 禁止 `kubectl delete pvc`；回滚并恢复备份 |
