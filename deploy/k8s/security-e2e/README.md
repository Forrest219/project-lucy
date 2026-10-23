# security-e2e：隔离单副本 K8s 测试部署

| 元数据 | 内容 |
|---|---|
| 文档名称 | security-e2e 隔离 K8s 测试部署说明 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-18 |
| 撰写人 | Claude（Cursor Builder，T14） |

供 `customer-release-readiness` 之前的真实用户 E2E 使用（Spec §6.2、§8.3，R8）。**只用于测试命名空间，不是客户交付形态。**

| 文件 | 作用 |
|---|---|
| `values.security-e2e.yaml` | 候选镜像按 **digest** 固定；单副本；`LUCY_DEPLOYMENT_MODE=customer`（Chart 写死）；无任何凭据 |
| `networkpolicy.yaml` | 入口仅 ingress 与 runner；7878 不可达；出站仅合成库与 DNS（SEC-16/SEC-22 的网络前提） |
| `deploy-candidate.sh` | 部署**已过 G1–G8 的同一 digest**、播种合成 fixture 项目、用 `kubectl create secret --from-file` 注入引导密钥、再调用 `k8s-acceptance.sh --expect-image-digest --deployment-evidence` 把“实际部署了什么”写入 `results/deployment.json` |

约束：

- fixture 项目来自 `inbox/e2e/<runId>/project`（`prepare-environment.mjs` 生成的合成内容），不得复制私有配置或生产数据。
- 故障注入不在产品与 Chart 中：由测试控制面从 Pod 外部执行（滚动重启、`kubectl exec`）。**当前仓库尚未提供 K8s 版 fault-control 控制面**，因此依赖 `fault-control` 的变体在 K8s 上保持 BLOCKED，而不是被跳过或放行。
- 候选镜像可先进入受限 staging registry；客户发布 tag 与离线包只能在 `customer-release-readiness` 通过后由**同一 digest** promote 产生。
