# KTX WebUI — 文档索引

本目录是 KTX Local WebUI 的**架构与规格交付物**（source of truth 仍是 `../README.md` 的产品 MVP 方案）。
文档按「先架构、后规格、再任务」的顺序组织，供后续实现（含 Mulan 特工队）直接消费。

| 文档 | 作用 | 读者 |
| --- | --- | --- |
| [01-architecture.md](01-architecture.md) | 系统架构、组件分解、关键决策(ADR)、安全模型 | 全员 |
| [02-arch-spec.md](02-arch-spec.md) | 模块契约、目录骨架、脚手架计划、测试策略 | 实现者 |
| [03-api-spec.md](03-api-spec.md) | REST API 契约（请求/响应/错误） | 前后端 |
| [04-data-model.md](04-data-model.md) | 内部数据模型 ↔ 真实 YAML 映射、完成度算法 | 实现者 |
| [05-task-list.md](05-task-list.md) | 里程碑任务拆分与验收标准 | 实现者 / 验收 |
| [06-navigation-ia.md](06-navigation-ia.md) | 导航与信息架构优化，明确语义层/业务文档/审阅校验的用户口径 | 产品 / 前端 |
| [07-mcp-auth-proxy-spec.md](07-mcp-auth-proxy-spec.md) | MCP Auth Proxy、访问日志、多用户权限与工具过滤 | 后端 / 安全 / 前端 |
| [08-mcp-audit-question-tracing-spec.md](08-mcp-audit-question-tracing-spec.md) | MCP 审计增强：数据源正规化、问题簇推断、可选自然语言问题上报 | 后端 / 前端 / 审计 |

## 与原 README 的关键校正

架构阶段比对了 `semantic-layer/` 的**真实文件**，发现并修正了几处与原 MVP 方案的出入，详见
[01-architecture.md §8 与真实布局的对齐](01-architecture.md#8-与真实-semantic-layer-布局的对齐)：

1. 文件粒度是 **schema 文件**（`<conn>/_schema/<schema>.yaml` 内含多表），编辑单元「表」地址 = `connectionId + schema + table`。
2. YAML 编辑必须**就地补丁**（保留 `"on"` 引号、key 顺序、注释、未知字段）。
3. 人工描述写入独立作者桶（`human`），不覆盖 `ai`。
4. ADR-10 已探测：`grain / measures / segments` 写独立 overlay `semantic-layer/<conn>/<table>.yaml`；`role / visibility` 暂不落盘。

---
_架构设计 by Claude (architect) · 2026-06-15_
