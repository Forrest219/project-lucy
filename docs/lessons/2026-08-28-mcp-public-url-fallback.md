# 错题：客户部署 MCP「未就绪」——未配 LUCY_PUBLIC_MCP_URL 却像配置成功

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-08-28 |
| 标签 | `ops-delivery` `ux-regression` `gate-gap` `sev-high` |
| 环境 | 客户 K8s／离线交付；外部 Agent 连 MCP |
| 相关 | Helm MCP URL 守卫；[`customer-amd64-image-build-checklist.md`](../runbooks/customer-amd64-image-build-checklist.md) H1；现场验收 `mcpEndpoint.status` |
| 状态 | `mitigated`（H1 负例矩阵／验收断言；登记 ≠ 可跳过 values） |

## 1. 症状与影响

WebUI 报红或等价文案：「Lucy MCP 未就绪，请检查 Endpoint 配置」。本机 demo 能通，客户侧外部 Agent 不可用。

## 2. 复现要点

客户 Helm／Compose **未**注入真实对外 `LUCY_PUBLIC_MCP_URL`（留空、占位符、或 `127.0.0.1`）；系统降级为本地 `fallback`，看起来「有 Endpoint」实则不可给外部 Agent 用。

## 3. 根因

Advertise 地址与进程监听地址分离。空／本机 URL 触发 fallback，满足「进程起来了」但不满足客户交付合同。

## 4. 为何漏检

静态 Chart／冒烟未强制拒绝空 URL；验收只看 Pod Ready／health，未断言 `mcpEndpoint.status == configured`。

## 5. 举一反三

1. 客户包：values 必须写外部 Agent 可访问的完整 MCP URL；禁止空、占位、`127.0.0.1`。
2. H1／封包：空 URL 负例必须失败；不得只靠现场 `kubectl set env` 补救。
3. 现场验收：`/api/project`（或等价）`mcpEndpoint.status` 必须为 `configured`，绝不能是 `fallback`。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| Helm／`gate:k8s-static` MCP URL 守卫 | 完成 | 操作跟 H1，不跟已作废的 preflight 大清单 |
| 现场验收清单条目 | 完成 | 见部署／验收手册；本条只保留错题 |

## 7. 证据指针

- `npm run gate:k8s-static`；`scripts/gates/helm-lucy-gate.sh`
- 部署侧：`customer-k8s-deployer-quickstart.md`／Chart values 示例
