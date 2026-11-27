# Cases — UAT-SUITE-QUERY-DETAIL-ESCAPE

> 口径：对齐 Spec v1.4-r2 §2.4／SC-11–SC-14。不得用写诚实 `UAT-SWH-*` 冒充。
> 推荐顺序：R0 → 01 → 02 → 03 → 04（04 改 env 后须还原，避免污染后续套件）。

| ID | 标题 | 必做 | SC | 期望摘要 |
|---|---|---|---|---|
| UAT-QDE-R0 | 环境／可见源／默认门禁 | 是 | — | demo healthy；MCP 可达；默认未开 `REQUIRE_BUSINESS_MEASURES` |
| UAT-QDE-01 | 成形拉数无业务 measures 成交 | 是 | SC-11 | dims-only／空 measures+dims 不得 `measures_required`；须出数或可执行 next_step |
| UAT-QDE-02 | 显式业务 measures 分析回归 | 是 | SC-12 | 合法 measures 查询成交；与 01 同窗互不破坏 |
| UAT-QDE-03 | detailMode 披露与非业务叙事 | 是 | SC-13 | 适配路径响应含 `_meta.lucy.detailMode`；注入名 `_lucy_detail_count`；不得当业务口径成功叙事 |
| UAT-QDE-04 | 回退开关恢复旧门禁 | 是 | SC-14 | `LUCY_QUERY_REQUIRE_BUSINESS_MEASURES=1` 时 dims-only 硬拒；还原后 01 再成立 |

---

## UAT-QDE-R0 — 环境门禁

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 记录 `gitSha`／`lucyVersion`／`ktxRuntime`；确认 healthy。
2. 确认容器／进程**未**设置 `LUCY_QUERY_REQUIRE_BUSINESS_MEASURES=1`（默认关＝拉数逃生开）。
3. 纯 MCP `initialize` → `tools/list`：可见 `lucy_query`；选定可见 source（如 `superstore_orders`）及 source-qualified 维度字段。

### 期望

- 任一项失败 → 后续 `BLOCKED`，不得假绿。

---

## UAT-QDE-01 — 成形拉数无业务 measures 成交（SC-11）

### 步骤

1. `lucy_query`：`connectionId`＋`dimensions:[{field:"<source>.<dim>"}]`，**省略** `measures`。
2. 同形再发：`measures:[]`＋同上 dimensions。
3. 负例对照：仅 `connectionId`（或仅 `sourceName`、无 dims／filters／segments）→ 仍应 `measures_required`（或等价 client_schema_failure），证明无成形要素不放行。

### 期望

- 步骤 1–2：不得仅以「请填 measures」硬拒；须成交出数，或返回可执行 `next_step`（不得只有填 measures）。
- 步骤 3：硬拒成立。
- 用 vitest 冒充 → **FAIL**。

---

## UAT-QDE-02 — 显式业务 measures 分析回归（SC-12）

### 步骤

1. 与 01 同会话（或同身份新会话）：`lucy_query` 带非空业务 `measures`（字符串或 `{expr,name}`）＋可选 dimensions。
2. 再发一次 01 形 dims-only，确认仍成交。

### 期望

- 分析路径成交；与拉数路径同窗互不破坏。

---

## UAT-QDE-03 — detailMode 披露（SC-13）

### 步骤

1. 对 01 成功的 dims-only 响应检查 `_meta.lucy.detailMode`（或合同等价路径）。
2. 核对：`adapted=true`、`injectedMeasure.name=_lucy_detail_count`、`anchorField` 与请求维度一致、`note` 标明非业务度量。
3. 抽查审计／对外叙述：不得把 `_lucy_detail_count` 记成业务指标成功。

### 期望

- 缺披露或把技术性 count 当业务口径 → **FAIL**。

---

## UAT-QDE-04 — 回退开关（SC-14）

### 步骤

1. 将运行中 Lucy 设 `LUCY_QUERY_REQUIRE_BUSINESS_MEASURES=1` 并确保 Proxy 进程生效（重建／重启容器按当次运维约定；跑次写明手段）。
2. 重放 01 的 dims-only → 须 `measures_required`（或等价），且**不**转发上游成交。
3. **还原** env（删除或置非真），确认 01 形再次成交。

### 期望

- 开＝旧门禁；关＝SC-11 成立。未还原 env → 本用例与后续套件均记污染，不得 PASS。
