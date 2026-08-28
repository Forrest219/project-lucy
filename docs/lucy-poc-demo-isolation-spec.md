# Lucy POC / Demo 独立语境规范

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy POC / Demo 独立语境规范 |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-28 |
| 适用范围 | Docker demo / executive-poc / postgres-demo、POC 演示、CI smoke |

## 1. 决策摘要

**POC 演示与能力测试不在默认部署（`docker-compose.yml`）内提供 demo 数据库或 demo 上下文。**

POC 使用 **独立语境包**：独立数据库、独立 `ktx.yaml` / semantic / wiki / ACL、独立 eval。

## 2. 四轨部署边界

| 轨 | Compose | 数据库 | 上下文来源 | 用途 |
|---|---|---|---|---|
| **客户默认** | `docker-compose.yml` | 无 | `/app/project-template` 或 `customer-config/` | 生产交付 |
| **POC Demo（MySQL）** | `docker-compose.demo.yml` | `demo-db` | `examples/docker-demo/project-template/` | 5 分钟 Superstore 试用 |
| **POC Demo（Postgres）** | `docker-compose.postgres-demo.yml` | `postgres-db` | `examples/postgres-demo/project-template/` | Postgres 驱动验证 |
| **Executive POC（内部）** | `docker-compose.executive-poc.yml` | `demo-exec-db` | `examples/executive-poc/project-template/` | CFO/COO/CIO 能力演示 |

**禁止**在默认 compose 内置 demo DB，或把根目录 `evals/superstore/` 挂进 demo / executive 容器。

## 3. Executive POC 包

路径：[`examples/executive-poc/`](../examples/executive-poc/README.md)

- MySQL 8.4 自包含（不绑定 StarRocks）
- 8 场景：半可加、现金流 bridge、预算、库存、获客、ACL、MV 等价层、Token ROI
- Gold：`examples/executive-poc/mysql/_baseline.json`
- **Internal-only**；不进 release gate

## 4. 变更规则

- 修改 demo / executive seed → 重跑对应 `gen-*-data.mjs` → 更新 `_baseline.json` → 同步 eval gold
- 默认 `docker-compose.yml` **不**增加 demo connection
