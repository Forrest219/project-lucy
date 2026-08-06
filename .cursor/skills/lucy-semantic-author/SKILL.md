---
name: lucy-semantic-author
description: >-
  Generates Lucy semantic-layer YAML (schema Manifest + source overlays) from a
  database connection for WebUI upload. Use when the user asks to 生成语义 YAML、
  schema manifest、overlay、semantic-layer 配置, or draft upload files from DB
  tables for Lucy Publish Workbench.
---

# Lucy 语义配置作者

从数据库连接生成可上传的语义资产：`_schema/<schema>.yaml` + `<source>.yaml`。

## 中文硬性要求（本 Skill 强制）

完整规范：[chinese-copy-rules.md](references/chinese-copy-rules.md)

生成前必须遵守：

1. `descriptions.db` / `descriptions.ai` **用中文**写业务含义、单位、口径、陷阱。
2. `measures[].description` / `segments[].description` **用中文**。
3. 文件头注释中的业务说明 **用中文**。
4. 仅保留必要英文关键词：字段名、表名、`DAU`/`AF`/`USD`/`sum(...)`、枚举值如 `iphone`。
5. 产出后跑中文自检：若某 `ai:`/`description` 整句英文 → 必须改成中文后再交付。

## 契约硬性要求（本 Skill 强制 — 防上传低级错误）

完整规范：[schema-lint-rules.md](references/schema-lint-rules.md)

生成与交付前必须遵守：

1. `joins[].relationship` **只能**是 `many_to_one` | `one_to_many` | `one_to_one`。
2. **禁止** `many_to_many`（及 ORM/中文别名）。事实表仅按期间对齐时 **不要写 joins**，对齐键写进中文描述 + Wiki。
3. WebUI 上传的 `<source>.yaml` **必须**有 `table:`，且含全部物理列（有 `table:` 时 KTX 当 standalone，不与 Manifest 合并）。禁止「有 table: 但只有计算列」。
4. 列 `type` 只能是 `string` | `number` | `time` | `boolean`。
5. 写出 YAML 后 **必须**跑 lint（见下方交付门禁）；失败则改完再交付，不得跳过。

## 输入

- connection（DBeaver MCP 或等价）
- schema + tables
- 可选：业务问答样例 / Owner 口径（用于别名与勾稽）
- output_dir

## 工作流

```text
- [ ] 读中文规范 + schema-lint-rules
- [ ] list_tables(schema)
- [ ] information_schema 列类型 / COMMENT / PRI
- [ ] 抽样：日期范围、关键枚举（platform 等）、行数
- [ ] 推断 grain（主键）、度量 vs 维度、预计算比率列
- [ ] 判 JOIN：仅事实→维 / 维→事实 / 1:1 才写 joins；事实↔事实期间对齐不写 joins
- [ ] 写 Manifest：tables + columns + descriptions(中文) +（合法）joins
- [ ] 写每个 overlay：name/table/grain/measures/segments（描述中文）
- [ ] 中文自检
- [ ] 跑 scripts/lint-semantic-yaml.py（必须通过）
```

## Manifest 规则

目标文件名：`<schema>.yaml`（上传后落到 `semantic-layer/<connection>/_schema/`）。

```yaml
tables:
  <source_name>:
    table: <schema>.<physical_table>
    columns:
      - name: <col>
        type: time|string|number|boolean
        pk: true          # 若主键
        nullable: false   # 若非空
        descriptions:
          db: <中文：单位、口径、别名、陷阱>
          ai: <中文：给 Agent 的短说明，可含关键词>
    descriptions:
      db: <中文：表角色、grain、关联键>
      ai: <中文>
    # joins 可选。relationship 仅 many_to_one|one_to_many|one_to_one
    # 禁止 many_to_many。事实↔事实仅期间对齐 → 省略 joins，描述写清对齐键。
    joins:
      - to: <other_source>
        "on": <等值条件>
        relationship: many_to_one   # 或 one_to_many / one_to_one
        source: formal
```

类型映射：`date/datetime/timestamp`→`time`；`varchar/text`→`string`；数值→`number`。

### JOIN 快速决策

| 场景 | 动作 |
|---|---|
| 事实 → 维度（FK） | `relationship: many_to_one` |
| 维度 → 事实 | `relationship: one_to_many` |
| 真一对一 | `relationship: one_to_one` |
| 两张明细事实表按 `fiscal_year`/`date` 对齐做杜邦等 | **不写 joins**；描述 + Wiki 写对齐键与公式 |

## Overlay / Source 规则（WebUI 上传包）

- `name` 与文件名一致（可与物理表同名）。
- **必须**有 `table: schema.table`（WebUI 分类器要求；缺则 `OVERLAY_MISSING_TABLE`）。
- 有 `table:` 时文件是 KTX **standalone**：必须自带 **全部物理列** + grain/measures/segments；可选计算列须带 `expr`。
- 不要只写计算列却带 `table:`——发布时会报 `grain column(s) absent from physical table`。
- **预计算比率列**（行级 CAC、留存率、人均）禁止 `AVG`；measure 用 `sum/sum` 重算，并在中文 description 写明。
- 用户同义词写入中文描述（例：用户说 iOS → 过滤 `iphone`；新增-服务器 → `new_user_moji_cnt`）。
- 日期：写清业务时区；**不要把样本日期写死为唯一口径**。
- 跨表指标：单表算不清的，在表/字段中文描述里写清对齐键与公式，供 Wiki/Eval 引用。

## 口径与勾稽（有业务材料时）

从问答样例/Owner 说明抽取并写入中文描述：

- 单位（人 vs 次 vs 美元 vs 比率）
- 双口径字段（如服务器 vs AF）及不等式关系
- 时间语义（cohort 日 vs 观察日）
- 聚合陷阱（跨端 sum 去重风险）
- 脏数规则（如留存率 >1、留存人数 > DAU）

无业务材料时：基于 COMMENT + 抽样保守起草，并在 README 列出「待 Owner 确认」项（中文）。

## 输出

```text
<output_dir>/
  <schema>.yaml
  <source>.yaml          # 每表一个
```

模板细节见 [manifest-overlay-notes.md](references/manifest-overlay-notes.md)。

## 交付门禁（未通过不得声称完成）

在仓库根或任意 cwd 执行（路径按本 Skill 所在位置解析）：

```bash
python3 .cursor/skills/lucy-semantic-author/scripts/lint-semantic-yaml.py <output_dir>
```

- 退出码 `0`：可交付 / 可让用户上传。
- 退出码非 `0`：按报错修改 YAML，**禁止**带着非法 `relationship` 交付。
- 有 Lucy 工程根且 connection 已就绪时，再跑 `ktx sl validate <source> --connection-id <conn>` 作增强校验。
