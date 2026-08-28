# Lucy POC / Demo 独立语境规范

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy POC / Demo 独立语境规范 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-28 |
| 适用范围 | Docker demo / postgres-demo、POC 演示、CI smoke；与默认客户部署的边界划分 |
| 关联文档 | `docs/deployment-docker.md`、`examples/docker-demo/README.md`、`docs/lucy-test-cases.md` |

## 1. 决策摘要

**POC 演示与能力测试不在默认部署（`docker-compose.yml`）内提供 demo 数据库或 demo 上下文。**

POC 使用 **独立语境包**：独立数据库、独立 `ktx.yaml` / semantic / wiki / ACL、独立 eval（gold 对齐 demo 基线）。默认部署保持 **单容器 + 客户自备 context** 的交付姿态。

## 2. 三轨部署边界

| 轨 | Compose | 数据库 | 上下文来源 | Eval | 用途 |
|---|---|---|---|---|---|
| **客户默认** | `docker-compose.yml` | 无（外接或 headless bind mount） | 镜像 `/app/project-template`（`CHANGE-ME`）或 `customer-config/` | 客户自备 / 无 | 生产交付、headless MCP |
| **POC Demo（MySQL）** | `docker-compose.demo.yml` | `demo-db`（1000 行 Superstore） | `examples/docker-demo/project-template/` | `examples/docker-demo/project-template/evals/` | 5 分钟试用、CI `smoke:p0:demo` |
| **POC Demo（Postgres）** | `docker-compose.postgres-demo.yml` | `postgres-db`（同基线数据） | `examples/postgres-demo/project-template/` | `examples/postgres-demo/project-template/evals/` | Postgres 驱动验证 |

**禁止**在默认 compose 中内置 demo DB，或把仓库根 `evals/superstore/`（Aliyun 10194 行快照）挂进 demo 容器——会与 demo 基线漂移并产生假阳性。

## 3. POC 独立包结构

MySQL demo 的完整 POC 包位于 `examples/docker-demo/`：

```text
examples/docker-demo/
  mysql/
    01-init.sql              # 独立 DB seed
    _baseline.json           # 数值单一事实源（seed=42, rows=1000）
  scripts/
    gen-demo-data.mjs        # 重生成 seed / baseline
  project-template/          # Lucy 运行时上下文（LUCY_TEMPLATE_ROOT）
    ktx.yaml                 # connection: demo-mysql → demo-db
    semantic-layer/demo-mysql/
    wiki/global/
    webui/config/access.yaml
    evals/demo_superstore/   # demo 专用 eval（connectionId + gold 对齐 _baseline.json）
```

Postgres demo 镜像结构相同，connection id 为 `demo-postgres`，密码走 Docker secret。

## 4. 与仓库根 `evals/` 的关系

| 路径 | 校准数据源 | 用于 |
|---|---|---|
| `evals/superstore/`、`evals/kx_financial/` 等 | 外部 Aliyun / StarRocks 等 | 全量业务回归、`p1-business-eval-full` |
| `examples/docker-demo/project-template/evals/` | `_baseline.json` + `demo-mysql` | Docker demo POC / smoke |
| `examples/postgres-demo/project-template/evals/` | 同上 + `demo-postgres` | Postgres demo POC / smoke |

两套 eval **不得混挂**。Demo compose 只挂载（或 seed）各自 `project-template/evals/`。

## 5. 运行与验收

```bash
# MySQL POC（推荐首次试用）
npm run smoke:p0:demo

# Postgres POC
npm run smoke:p0:postgres-demo

# 客户默认（无 demo DB）
docker compose up -d --build
# 需编辑 /data/lucy/ktx.yaml 或使用 customer-config bind mount
```

Demo 业务数值断言以 `examples/docker-demo/mysql/_baseline.json` 为准（Postgres 使用 `examples/postgres-demo/postgres/_baseline.json`，生成器输出一致）。

## 6. 变更规则

- 修改 demo 数据（seed / rows）→ 重跑 `gen-demo-data.mjs` → 更新 `_baseline.json` → 同步 demo eval gold。
- 新增 demo 能力测试 → 只加在 `examples/*/project-template/evals/`，不写入根 `evals/superstore/`。
- 默认 `docker-compose.yml` / `/app/project-template` **不**增加 demo connection 或 demo 表。

## 7. Terminology Compliance

本文档使用「POC Demo」「客户默认部署」「context package」与 `webui/docs/00-product-terminology-standard.md` 一致；connection id（`demo-mysql`、`demo-postgres`）为配置标识，非用户可见产品名。
