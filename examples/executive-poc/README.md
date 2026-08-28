# Executive POC（内部能力演示）

**Internal-only.** 面向 CFO / COO / CIO 的 Lucy 能力演示包：独立 MySQL 数据库、语义层、Wiki、Eval、ACL。**不**进入默认客户部署路径。

规范：[`docs/lucy-poc-demo-isolation-spec.md`](../../docs/lucy-poc-demo-isolation-spec.md)

## 快速启动

```bash
npm run executive-poc:gen-data    # 可选：重生成 SQL + baseline
npm run smoke:p0:executive-poc    # 构建、冒烟、tear down
```

手动：

```bash
docker compose -f docker-compose.executive-poc.yml up -d --build
curl http://127.0.0.1:55178/api/health
```

重建（清 runtime volume 再 seed）：

```bash
npm run executive-poc:rebuild
```

## 端口

| 服务 | 默认宿主端口 | 环境变量 |
|---|---:|---|
| WebUI | 55178 | `LUCY_EXEC_WEBUI_HOST_PORT` |
| MCP Proxy | 57883 | `LUCY_EXEC_PROXY_HOST_PORT` |
| MySQL | 53307 | `LUCY_EXEC_MYSQL_HOST_PORT` |

Advertise URL：`http://127.0.0.1:57883/mcp`

## 演示 Token（internal-only）

| 角色 | Token | 用途 |
|---|---|---|
| Full smoke | `exec-demo-full-token` | CI / 全表 |
| CFO | `exec-cfo-token` | 财务 + 全国 margin |
| COO | `exec-coo-token` | 供应链 + 获客 |
| Regional sales | `exec-sales-regional-token` | 仅华南 margin VIEW |

## 8 场景演示问句

| # | 角色 | 演示问句 |
|---|---|---|
| 1 | CFO | 过去6个月各子公司月末资金存量；哪家90+账龄应收占比最高？ |
| 2 | CFO | Q2 净利润同比 +15% 但经营 CF -28% 的驱动（回款、存货、退税）？ |
| 3 | CFO | 电商敏捷组 Q3 预算达成率？ |
| 4 | COO | 华南 DOS>60 滞销 SKU；华东可售<7 天且无 PO 的断货 SKU？ |
| 5 | COO | 渠道 B vs A 平均履约时长差异？ |
| 6 | CIO | 同一问题用 CFO vs 区域销售 token 查业绩与联系方式 |
| 7 | CIO | 2026Q2 华东 Electronics 销售额：MV 层 vs 明细一致？ |
| 8 | CIO | Engineering 部门 Token/关闭工单比？ |

## 30 分钟演示脚本

1. **0–5 min** CIO-6：切换 token，对比可见表/列
2. **5–15 min** CFO-1：强调禁止 SUM(日余额)，用 `cash_balance_month_end`
3. **15–22 min** COO-4：华南/华东双向预警
4. **22–28 min** CFO-2：三表多轮查询 + bridge
5. **28–30 min** CIO-7：MV 表查询；说明生产可换 StarRocks MV

## 包结构

```text
examples/executive-poc/
  mysql/01-init.sql, _baseline.json
  scripts/gen-executive-poc-data.mjs
  project-template/
    ktx.yaml
    semantic-layer/demo-exec-mysql/
    wiki/global/exec-*.md
    webui/config/access.yaml
    evals/executive_poc/
```

## 数据规模

- 默认 `--order-rows=50000`（可 `--order-rows=500000`）
- Gold：`mysql/_baseline.json`

## 数据库

MySQL 8.4（开源）。客户可用 MySQL / Postgres 等验证同类模式；本包首期仅 MySQL compose。

CIO-7 的 `mv_order_quarterly_rollup` 为 MySQL 预聚合表，**语义上等价** StarRocks 异步 MV 命中层。

## 不在 release gate

`smoke:p0:executive-poc` 为内部验证，首期不加入 `.github/workflows/lucy-release.yml`。
