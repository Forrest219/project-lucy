# Manifest / Overlay 补充笔记

## 比率与校验列

| 模式 | 处理 |
|---|---|
| 行级已存比率 | Manifest 标注为校验列；overlay measure 用 `sum(a)/sum(b)` |
| 行级重复的日级总量 | 聚合用 `max` 而非 `sum`（须在中文 description 警告） |
| 展示百分比 | 存储用小数；说明「展示时 *100」 |

## JOIN KEY 常见形态

日表互相关联优先：

```text
date + platform + country_region
```

若国家英文双写，描述中要求优先 `country_abbr`。

## JOIN relationship（KTX 硬枚举）

仅允许：`many_to_one` | `one_to_many` | `one_to_one`。

**禁止** `many_to_many`。两张科目级明细事实表按 `fiscal_year + fiscal_quarter`（或 `report_period`）对齐时：

- Manifest **不要**写 `joins`
- 在表级 `descriptions` 写清对齐键
- 跨表公式放 Wiki（分表取 measure 再组合）

交付前跑 `scripts/lint-semantic-yaml.py`（见 [schema-lint-rules.md](schema-lint-rules.md)）。

## 描述写作示例（中文）

```yaml
descriptions:
  db: |
    新增用户数-墨迹/服务器口径，单位：人。
    业务别名：新增-服务器。通常 >= new_user_af_cnt（AF 为归因子集）。
  ai: 服务器/墨迹口径新增人数。别名：新增-服务器。通常大于等于 AF 新增。
```

错误示例（禁止）：

```yaml
ai: Server-side new users. Usually greater than AF count.
```
