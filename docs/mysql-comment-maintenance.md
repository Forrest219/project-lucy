# MySQL 字段 COMMENT 维护说明

| 元数据 | 内容 |
|---|---|
| 文档名称 | MySQL 字段 COMMENT 维护说明 |
| 文档类型 | Ops Runbook |
| 撰写日期 | 2026-06-21 |
| 适用范围 | `dataforai.superstore_orders.discount` / `dataforai.superstore_orders.profit` |
| 执行边界 | 本仓库 agent 对 Aliyun RDS 只读；生产 DDL 必须由 DBA 或库 owner 授权执行 |

## 目标

将 MySQL 物理字段 COMMENT 从简单标签补齐为可被扫描器读取的业务口径：

| 字段 | 建议 COMMENT |
|---|---|
| `discount` | `折扣率（0-1 小数）。聚合折扣率必须按销售额加权：SUM(discount * sales) / NULLIF(SUM(sales), 0)，禁止直接 AVG(discount)。` |
| `profit` | `行级净利润，可为负值。整体利润率必须使用 SUM(profit) / NULLIF(SUM(sales), 0)，禁止 AVG(profit / sales) 或默认过滤 profit > 0。` |

## 只读校验

```sql
SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dataforai'
  AND TABLE_NAME = 'superstore_orders'
  AND COLUMN_NAME IN ('discount', 'profit')
ORDER BY FIELD(COLUMN_NAME, 'discount', 'profit');
```

## DBA 执行脚本生成

`MODIFY COLUMN` 必须保留线上字段的 `COLUMN_TYPE`、nullable、默认值等属性。先用下面的只读 SQL 生成候选 DDL，由 DBA 审核后执行。

```sql
SELECT CONCAT(
  'ALTER TABLE `dataforai`.`superstore_orders` MODIFY COLUMN `',
  COLUMN_NAME,
  '` ',
  COLUMN_TYPE,
  IF(IS_NULLABLE = 'NO', ' NOT NULL', ' NULL'),
  IF(COLUMN_DEFAULT IS NULL, '', CONCAT(' DEFAULT ', QUOTE(COLUMN_DEFAULT))),
  ' COMMENT ',
  QUOTE(CASE COLUMN_NAME
    WHEN 'discount' THEN '折扣率（0-1 小数）。聚合折扣率必须按销售额加权：SUM(discount * sales) / NULLIF(SUM(sales), 0)，禁止直接 AVG(discount)。'
    WHEN 'profit' THEN '行级净利润，可为负值。整体利润率必须使用 SUM(profit) / NULLIF(SUM(sales), 0)，禁止 AVG(profit / sales) 或默认过滤 profit > 0。'
  END),
  ';'
) AS ddl_to_review
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dataforai'
  AND TABLE_NAME = 'superstore_orders'
  AND COLUMN_NAME IN ('discount', 'profit')
ORDER BY FIELD(COLUMN_NAME, 'discount', 'profit');
```

## 执行后验收

1. 重新运行“只读校验”，确认 `COLUMN_COMMENT` 已更新。
2. 重新扫描或 reindex KTX 语义层，使 manifest / 搜索索引读取新 COMMENT。
3. 用 `ktx sl read superstore_orders` 验证 `discount` / `profit` 描述未回退。
