# Reviewer 复核 — VIEW-as-pseudo-table（华东区域 demo）

| 元数据 | 内容 |
|---|---|
| 文档类型 | Review（独立复核报告） |
| 复核日期 | 2026-06-22 |
| 复核对象 | CIO 48h demo 权限场景：role `superstore_region_huadong` + VIEW `dataforai.superstore_orders_huadong` |
| 落位 | `inbox/review-huadong-view-pseudo-table-2026-06-22.md` |
| 读者 | PM / 改动人 / 后续 reviewer |

---

## 0. 结论

**CONDITIONAL PASS**（带 4 项按严重度排列的问题，必须先解决 P0-1 / P0-2 再上 demo）。

| 维度 | 状态 |
|---|---|
| 表层隔离（ACL selector + joins 参数扫描） | PASS |
| manifest 无意外 join 污染 | PASS |
| ktx.yaml 改动最小（仅 enabled_tables 追加 1 行） | PASS |
| 红线 §41（ktx.yaml 连接信息） / §40（secrets） | PASS |
| overlay 模型完整性 | PASS |
| 红线 §42 CREATE VIEW 豁免留痕 | 缺（P2-1） |
| overlay 文件纳入版本控制 | **FAIL（P0-1）** |
| access.yaml diff 干净 | **FAIL（P0-2）** |
| `npm run lint:spec` | **FAIL（P1-1，与本次无关但需知会 reviewer）** |
| demo token 自动过期机制 | 弱（P1-2） |
| 文档不会误读 | PASS（可加 overlay joins 说明，见 P2-2） |
| 扩展性诚实度 | PASS |

---

## 1. P0（必须解决，阻断 demo）

### P0-1 新 overlay 文件 `superstore_orders_huadong.yaml` 未被 git 追踪

证据：

```
$ git status --short | grep huadong
?? semantic-layer/mysql-aliyun/superstore_orders_huadong.yaml

$ git ls-files | grep huadong
（无任何匹配）
```

后果：如果按 review 清单提交，文件会丢；KTX daemon 重启后 MCP 检索到这个 source 时会找不到 overlay（虽然 ACL 层仍能拒绝，但 `sl_query` 走 manifest 渲染可能 fallback 到只有 manifest 的精简模型，破坏 demo 演示的一致性）。

建议：`git add semantic-layer/mysql-aliyun/superstore_orders_huadong.yaml`，确认它和 `ktx.yaml`、`access.yaml` 一起进同一个 commit。

### P0-2 `webui/config/access.yaml` diff 混入了与 demo 无关的文件级重排

证据：`git diff webui/config/access.yaml` 显示这次改动同时：

- 删除了文件顶部 4 行注释（`# Lucy MCP Proxy — 用户访问配置…`）
- 给所有 `hash` 字段去掉了引号（`"sha256:..."` → `sha256:...`）
- 给两个 `note` 字段去掉引号
- 重排 `lisi.allow` 的 YAML 缩进（`tables: ["*"]` → 多行）
- 删除了 `defaults.deny_tools` 上面的 "ACL tool classification…" 注释

后果：reviewer 必须在 49 行新增 diff 里分辨哪些是"新增 demo role+user"、哪些是无关 YAML 风格化；同时把 lint/spec 类工具的 blame 变复杂。

建议：从 staging 里 reset 掉这些无关改动，只保留 demo 必须的新增块（`superstore_region_huadong` role + `demo_huadong_manager` user），用 `git add -p` 逐块加。如果是你顺手格式化整个文件的，要么把格式化单独 commit，要么 revert 重做。

---

## 2. P1（强烈建议解决，影响"已验证"声明的可信度）

### P1-1 `npm run lint:spec` 实际 FAIL，reviewer 说"通过（仅 1 个预存 WARN）"不准确

证据：当前实际输出：

```
[spec-lint] PASS route-status
  routes and status table are aligned for first-batch modules
[spec-lint] FAIL api-spec
  webui/docs/03-api-spec.md: missing /api/admin/audit/:id/sources
[spec-lint] PASS skill-dependency
  2 skill files have resolvable dependencies
[spec-lint] PASS eval-schema-version
  2 eval files are readable with safety_contract and valid quiz links
[spec-lint] WARN access-role-policy
  webui/config/access.yaml: disabled legacy wildcard user lisi must not be re-enabled without role
[spec-lint] PASS access-role-policy
  access role policy has no blocking errors
```

- FAIL 的 `/api/admin/audit/:id/sources` 路由在 `webui/server/admin/audit.ts:418` 已实现，但 `webui/docs/03-api-spec.md` 没记录——这是 P0 audit-spec 工作（`webui/server/proxy/audit.ts` 改 263 行）的 spec 漂移，**与 demo 改动无直接关系**。
- WARN 的 `lisi` 是历史遗留，也与 demo 无关。

后果：CI 的 `spec-and-webui` job 会因为 FAIL api-spec 阻断 release gate；如果按 reviewer 描述的"已验证通过"去推 demo 后合并，可能 merge 时才发现 lint 失败。

建议：

- (a) 在演示前补 `webui/docs/03-api-spec.md` 里 audit routes 一节（纯文档修复，不改代码）。
- (b) 或者在 PR 描述里把这两个失败项明示标注为"已存在，与本次 demo 改动无关，将在 X PR 修复"，让 reviewer 知道这是已知。

### P1-2 demo token `cio-demo` 没有 expires_at，撤销路径依赖人工删除 token + revoked_tokens 机制

证据：`access.yaml` 里 `demo_huadong_manager.tokens` 只有 `hash/label/created`，无 `expires_at`；`revoked_tokens` 表机制存在（`webui/server/admin/tokens.ts:108-113`），但需要走 `DELETE /api/admin/agents/demo_huadong_manager/tokens/cio-demo` 才会触发。

后果：demo 结束后若忘了撤销，token 长期有效（hash 已落地）；除非 IT 走 revocation API。

建议：

- (a) demo 后的强制操作清单写进 `inbox/cio-briefing-access-governance-2026-06-22.html` 或 `docs/project-overview`：「48h 内必须 `DELETE /api/admin/agents/demo_huadong_manager/tokens/cio-demo`」。
- (b) 创建 token 时带 `expires_at` 字段（`POST /api/admin/agents/:userId/tokens` 已支持，`webui/server/admin/tokens.ts:21`）——虽然 UI 未暴露，但 admin API 可手调，2 天后自动过期更稳。

---

## 3. P2（建议，治理/语义层面）

### P2-1 DEVELOPMENT.md 红线 §42 与本次 CREATE VIEW 的关系没说清

证据：`docs/DEVELOPMENT.md:42` 写"生产数据库（Aliyun RDS MySQL）：只读查询，禁止 DDL/DML 写操作"。本次 `CREATE VIEW dataforai.superstore_orders_huadong AS SELECT …` 是 DDL 写操作。

后果：后续 reviewer（包括 Opus / 第三方 reviewer）扫到 git history 时会问"这条 CREATE VIEW 怎么过的红线？"——`access-governance-design §3.2` 那段"已验证的变通方案"提到了 VIEW 但没引用红线豁免路径。

建议：在 §3.2 的"已验证"段后加一句：本次 VIEW 是 Plan Mode 走通 + 人工 ExitPlanMode 批准 + 数据属演示用、生产基表零修改（仅新建 VIEW，drop 即还原）的最小变更；若未来要复用本模式，应在 plan 里明确红线豁免理由。或更稳妥：把"红线 §42 例外：VIEW-only DDL 且不修改基表"明确登记到 `DEVELOPMENT.md` 红线段下。

### P2-2 overlay 注释里"故意不带 joins"的措辞在代码里其实是被强制而非主动

证据：`webui/server/semantic-layer.ts:289` 中：

```ts
const joins = compact((Array.isArray(record.joins) ? record.joins : []).map(normalizeJoin));
```

**overlay 的 joins 字段不被读取，joins 永远从 manifest 读**。`huadong.yaml` 注释写"故意删掉了 joins"暗示是设计选择，实际是即使 overlay 写了也会被忽略。

后果：未来开发者想"既然写了没用，那我去 superstore_orders.yaml 的 overlay 里删掉 joins 试试"——会发现 overlay 删除 joins 无效，joins 仍由 manifest 决定（manifest 当前 superstore_* 表也没 accepted joins，因为 relationship detection 还在 review 阶段）。语义混淆。

建议：注释改为更准确表述：「manifest 阶段 `superstore_orders_huadong` 无 accepted join 关系（relationship detection 未触发/未确认）；overlay 的 joins 字段当前不被 loader 读取（`webui/server/semantic-layer.ts:289`），因此即使 overlay 声明也不会生效。若未来需要 join，需先在 manifest 阶段让 relationship detection 接受（≥0.85 阈值）。」

### P2-3 overlay 的 `grain` 字段也是从 manifest 读、overlay 只是 override

证据：同 `modelFromTable` line 290：

```ts
const grain = stringArray(overlay.grain) ?? stringArray(record.grain);
```

`huadong.yaml` 写了 `grain: [row_id]`，manifest 里 row_id 也在——overlay 是冗余的（语义正确，不是 bug）。

建议：不阻塞 demo，但下次写 overlay 时知道：`grain/measures/segments` 是 overlay 真正生效的字段，`joins` 不是。

---

## 4. 针对 reviewer 6 个重点的逐一回应

### 4.1 真实隔离性

- tableSelectors 匹配：`webui/server/proxy/acl.ts:450-464` 的 `selectorMatches` 用 sourceName/physicalTable 双向匹配；huadong 仅 1 个 sourceName，没有 prefix/通配 → 严格只命中 1 个 source。✓
- 旁路——显式 sl_query joins 参数：line 639 `collectTableRefs(a.joins, …)` 会把 joins 文本里的 schema.table 字串抽出，再在 line 850-855 检查是否在 allowedTables。**如果 joins 文本里写了 `superstore_returns`，会被抓出 `dataforai.superstore_returns`，不在 allowedTables → `table_forbidden`**。✓
- 旁路——通过 manifest 里其他表的 joins 间接连回 huadong：huadong 在 manifest 里没有任何 joins 块（line 522-690），其他表（superstore_orders/returns/people）也都没有 accepted joins。✓
- 旁路——overlay 内置 SQL（measure/segment expr 里写 UNION/JOIN）：overlay 里所有 expr 都引用 `superstore_orders_huadong` 的列名（没有跨表 SQL），且 `sl_query` 路径走 KTX 上游的受控 SQL 生成器，不会原样执行 expr 里的 SQL 片段。✓ 风险低但不能 100% 排除（KTX 上游的 measure 渲染器是否会把 expr 字串注入 SQL WHERE——这层没读 KTX 代码）。

**结论：表层隔离通过；KTX 上游 measure/segment 渲染器的可信度未在本次复核范围内，依赖上游既有安全保证。**

### 4.2 manifest 是否被污染

- `semantic-layer/mysql-aliyun/_schema/dataforai.yaml` 已 grep（line 38/92/202/203/207）——只有 3 个 joins 块，全部是 KX 财务域（`kx_dim_company ↔ kx_fact_financial_amount`、`kx_dim_financial_item ↔ kx_fact_financial_amount`）。**没有任何指向 `superstore_orders_huadong` 的 join，也没有 superstore_* 表之间的 join**。✓
- 顺便：manifest 中 superstore_* 表都没有 joins（relationship detection accepted 2 review 17 是 KX 表的进度），这是 huadong 自然无 join 的另一层保险。✓

### 4.3 红线/治理合规

- Plan Mode：reviewer 描述里说"先 EnterPlanMode 写 plan、用户 ExitPlanMode 批准后才执行 CREATE VIEW 和 ktx.yaml 改动"——这次 plan 文件在哪？在 `inbox/` 没找到对应 plan 文档（grep `huadong` 在 inbox 无结果）。**建议把当时的 plan 内容/inbox 路径贴出来，或者新写一份 `inbox/demo-huadong-plan-2026-06-22.md` 留痕**。
- 红线 §42 豁免：见 P2-1。需明示。
- 红线 §41（ktx.yaml 连接信息）：本次只在 enabled_tables 末尾加 1 行，未触碰 host/username/password file 路径——✓ 符合红线。
- 红线 §40（secrets）：本次未触碰任何 `.ktx/secrets/` 文件——✓。

### 4.4 token 暴露面

见 P1-2。建议补 expires_at + 演示后撤销清单。

### 4.5 文档表述是否会误导

- `access-governance-design §3.2` 新增的「已验证的运行时变通方案（VIEW-as-pseudo-table，不是本节方案的提前实施）」措辞清晰，明确说"不是本节方案的提前实施"。✓
- 「局限（记录是为了不让人误以为这是参数化方案）：每个切片需要单独建 VIEW + overlay + role」——准确，**但遗漏了一条：overlay 的 joins 字段当前不被读（见 P2-2）**，所以即使 overlay 声明了 joins 也不会生效。这一点应在"局限"段补充，否则未来有人会以为"补个 join 就行"。
- `project-overview §8` line 119 一句话指针足够。✓

### 4.6 可扩展性诚实度

reviewer 描述"每个切片需要单独建 VIEW+overlay+role，不是参数化方案"——准确。

**更便宜的扩展路径有没有被漏掉？** 三条值得记录：

- (a) **DB 视图层用 SQL CASE / 参数化视图**：MySQL VIEW 不支持参数化，但可以用 `WHERE region = SUBSTRING_INDEX(CURRENT_USER(), '@', 1)` 这种基于会话用户名的动态过滤——**但需要 MySQL 用户名映射到 region，并且 DB 用户连接串按 region 分发**，整体复杂度超过"每区域 1 VIEW"。
- (b) **predefined-stored-procedure + VIEW 组合**：用存储过程把 region 注入到 SQL 里——但项目明确禁止 DML，且 sl_query 走 KTX 上游不接受存储过程调用，**不可行**。
- (c) **DB 行级安全（MySQL 8.0 内置）**：MySQL 没有 PostgreSQL 那种 row-level security。只能靠 VIEW-per-region 或者应用层过滤——VIEW 已经是 MySQL 上最便宜的方案。

**结论：VIEW-per-slice 确实是 MySQL 8 上"不改应用层代码、不改 ACL 引擎"的最便宜方案；描述准确，没有更便宜路径被漏掉。** ✓

补一条建议：在 §3.2 "局限"段把 P2-2（overlay joins 不被读）也写进去，让"加个 join 就行"的误解被堵住。

---

## 5. 行动建议（按顺序）

1. `git add semantic-layer/mysql-aliyun/superstore_orders_huadong.yaml`（P0-1）
2. `git checkout webui/config/access.yaml` → 重做 demo role/user 的最小 diff，避免无关格式化（P0-2）
3. 给 demo token 加 `expires_at=2026-06-25`（48h 后自动失效）（P1-2）
4. 在 `docs/DEVELOPMENT.md` 红线段或 inbox 留 CREATE VIEW 的红线豁免记录（P2-1）
5. （可选）补 `03-api-spec.md` 的 `/api/admin/audit/:id/sources` 路由文档（P1-1）
6. （可选）修 §3.2 "局限"段加一句"overlay joins 字段当前不被读"（P2-2）

**1 + 2 完成后可以 PASS 上 demo。**

---

## 6. 证据索引（file:line）

| 断言 | 位置 |
|---|---|
| tableSelectors 匹配逻辑 | `webui/server/proxy/acl.ts:450-464` |
| sl_query joins 参数扫描 | `webui/server/proxy/acl.ts:639` |
| tables ∈ allowedTables 检查 | `webui/server/proxy/acl.ts:850-855` |
| demo token 没 expires_at | `webui/config/access.yaml:74-77` |
| token revoke API 入口 | `webui/server/admin/tokens.ts:84-129` |
| overlay joins 字段不被读 | `webui/server/semantic-layer.ts:289` |
| overlay grain 是 fallback | `webui/server/semantic-layer.ts:290` |
| 红线 §42（生产库禁止 DDL/DML） | `docs/DEVELOPMENT.md:42` |
| 红线 §41（ktx.yaml 连接信息） | `docs/DEVELOPMENT.md:41` |
| §3.2 变通方案描述 | `docs/access-governance-design.md:158-170` |
| §8 一句话指针 | `docs/project-overview.md:119` |
| manifest 无 superstore joins | `semantic-layer/mysql-aliyun/_schema/dataforai.yaml:38/92/202/203/207` |
| `/api/admin/audit/:id/sources` 已实现但 spec 缺 | `webui/server/admin/audit.ts:418` ↔ `webui/docs/03-api-spec.md` 缺记录 |
| lint:spec FAIL api-spec | 当前 working tree `npm run lint:spec` 输出 |

— 完