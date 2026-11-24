# P0-A Semantic source field exposure · SC-01–SC-30 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P0-A SC-01–SC-30 证据审计 |
| 文档类型 | Checklist / Evidence |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Tester A／B／C → parent 收口汇总 |
| 委托人 | xingchen |
| 基于材料 | Spec `docs/specs/lucy-20261107-semantic-source-field-exposure-spec.md` §7；field-exposure 相关 vitest |
| 适用范围 | 功能合同收口证据；镜像由 parent 同次回写 |
| 输出位置 | `docs/reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md` |

## 结论（收口门禁）

| 项 | 值 |
|---|---|
| 功能合同可收口？ | **是** |
| OPEN SC | **无**（SC-01–SC-30 全部 CLOSED／CLOSED*） |
| Spec／Plan／清单／README | **功能合同已收口（2026-11-13）** |
| 本条收口不表示可上线 | 仍成立 |
| SC-25 残差 | 进程内代次探针（Spec「或等价」）；无 live KTX MCP 往返——不挡收口，披露于 CLOSED* |

## 测试基线（parent 复跑 2026-11-13）

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/field-exposure.test.ts \
  server/__tests__/field-exposure-acl-hook.test.ts \
  server/__tests__/field-exposure-proxy-sc04-sc06.test.ts \
  server/__tests__/field-exposure-sc12-sc13.test.ts \
  src/__tests__/field-exposure-workbench-sc13.test.tsx
```

| 项 | 结果 |
|---|---|
| Test Files | **5 passed** |
| Tests | **75 passed / 0 failed** |
| 时长 | ~2.4s |
| `npm run lint:spec-docs` | 失败项均为其他 Spec／Plan；**本条 Spec／Plan 未出现在失败列表** |
| 术语标准 | `webui/docs/00-product-terminology-standard.md` 已登记 Field Exposure／Field Not Exposed／Field Exposure Unavailable 与「业务暴露裁剪 ≠ 列级安全」 |

## SC 清单（CLOSED / OPEN）

### 读取器／期望集合 · `field-exposure.test.ts`

| ID | 状态 | 证据 |
|---|---|---|
| SC-01 | CLOSED | `configured empty excluded → full_expose (SC-01)` |
| SC-02 | CLOSED | `missing ledger + not expected → unconfigured full expose (SC-02/SC-24)` |
| SC-10 | CLOSED | `new columns not in excluded → default exposed (SC-10)` |
| SC-11 | CLOSED | `corrupt ledger → unavailable (SC-11)`；`source mismatch → unavailable (SC-11)` |
| SC-23 | CLOSED | `expected + missing ledger → unavailable (SC-23)` |
| SC-24 | CLOSED | 同 SC-02/SC-24 |
| SC-27 | CLOSED | `expected set corrupt → unavailable, not empty ready (SC-27)` |
| SC-28 | CLOSED | `expected set generation mismatch → unavailable (SC-28)` |

### 查数／发现／半通／发布 B1

| ID | 状态 | 证据 |
|---|---|---|
| SC-03 | CLOSED | `strips excluded columns from payload`（discovery trim） |
| SC-04 | CLOSED | 单元 `denies unexposed dimension (SC-04/05)`；loopback：`SC-04: lucy_query naming unexposed column → field_not_exposed; upstream execution = 0 (no scoped row policy)`；`SC-04: tables:["*"] agent lucy_query unexposed → field_not_exposed; upstream = 0`（`field-exposure-proxy-sc04-sc06.test.ts`） |
| SC-05 | CLOSED | `covers filters object, string, order_by, measures expr, segments (SC-05/19)` |
| SC-06 | CLOSED | 单元 `SC-06: lucy_explain_query carrier uses same exposure deny for unexposed column`；loopback：`SC-06: lucy_explain_query naming unexposed column is denied locally (no upstream)`；`SC-06: tables:["*"] agent lucy_explain_query unexposed → field_not_exposed; upstream = 0` |
| SC-07 | CLOSED | `discovery trim digest equals query deny digest for same snapshot` |
| SC-08 | CLOSED | `measure referencing trimmed…`；`grain / segment / join / derived…`；`cross-source reference…` |
| SC-09 | CLOSED | `NON_WAIVABLE_PREFIXES blocks exposure.* waiver (SC-09)` |
| SC-16 | CLOSED | `ledger-only trim loads external overlay via affectedClosure (B1)`（+ acl-hook 源码锁） |
| SC-17 | CLOSED | Agent C：`SC-17: legal ledger-only publish → activate success → runtime trims new exclusion set`（B1 合法闭包 → Strat-B 激活 → 发现面裁剪＋查数拒 secret） |
| SC-19 | CLOSED | 同 SC-05/19（已暴露放行／未暴露拒绝） |
| SC-20 | CLOSED | `trimmed scope hard-denies unparseable (SC-20)` |
| SC-29 | CLOSED | `unconfigured path does not hard-deny…`；`unconfigured target does not add exposure.*` |

### 发现面矩阵／下行／文案／草稿

| ID | 状态 | 证据 |
|---|---|---|
| SC-12 | CLOSED | Agent B：`field-exposure-sc12-sc13.test.ts`（见下方 ## Agent B） |
| SC-13 | CLOSED | Agent B：组件＋草稿／Proxy 对照＋pending `field_exposure`（见下方 ## Agent B；全浏览器 E2E 不在 Spec 出口） |
| SC-14 | CLOSED | `exports fixed 业务暴露裁剪 ≠ 列级安全 copy`；术语表已登记主术语与 reason code |
| SC-15 | CLOSED* | acl-hook：`validateQueryFieldsAgainstExposure` 插入点且不调用 `validateProtectedLucyQueryArgs`（SC-15／D10 锁）。「既有测试全绿」为环境态，不单列 |
| SC-21 | CLOSED | `rewriteExamples…`；`trimDiscoveryPayload strips hive_columns…`；`wires Hive…`；`kxCatalog examples use rewriteCatalogExamplesForExposure` |
| SC-22 | CLOSED | `unknown shape under trim → fail-closed, no original (SC-22)` |

### 执行代次／四透传／ACL 顺序

| ID | 状态 | 证据 |
|---|---|---|
| SC-18 | CLOSED | Agent C：无权连接／台账故障对照仍原 ACL；错误体无暴露码／配置；源码锁对象授权先于暴露检查（`field-exposure-acl-hook.test.ts`） |
| SC-25 | CLOSED* | Agent C：`SC-25: pin old ServingGeneration; OPEN upstream==serving; V1/V2 fork probe; Strat-B STOP`（并发 STOP＋同名 measure 语义分叉＋执行代次探针）。\*残差：无 live KTX MCP 往返 |
| SC-26 | CLOSED | 多条 Strat-B／激活失败／shared barrier／manual reindex 源码锁与单元（`forceStopAdmission…`；`reindex window…`；acl-hook SC-26 组） |
| SC-30 | CLOSED | passthrough EMPTY→INSTANCE_WIDE；四工具 deny／compat；空作用域；插入点锁（`wires sensitive-meta passthrough…`）。允许以「取证待办 + 首期 fail-closed」关闭 |

## 计数

| | |
|---|---|
| CLOSED | **30 / 30**（含 SC-15 CLOSED*；SC-25 CLOSED*；含 Agent B 的 SC-12／SC-13） |
| OPEN | **0**（主表无 OPEN；SC-25 仍有 live-KTX 残差披露） |
| 本轮新增测试 | Agent A：+5；Agent B：+9（SC-12×4、SC-13×5）；Agent C：+5（SC-17×1、SC-25×1、SC-18×3） |
| 本轮改动代码／测试文件 | Agent A：`field-exposure-proxy-sc04-sc06.test.ts`；`field-exposure.test.ts`（SC-06）；Agent B：见 ## Agent B；Agent C：`field-exposure.test.ts`（SC-17／25）；`field-exposure-acl-hook.test.ts`（SC-18）；本审计文档 |

## Blockers（挡收口）

1. ~~**SC-04**~~：**CLOSED**（Agent A）— loopback 上游＝0 + `tables:["*"]`。
2. ~~**SC-06**~~：**CLOSED**（Agent A）— 命名 `lucy_explain_query` 拒绝 + 零上游。
3. ~~**SC-12**~~：**CLOSED**（Agent B）— 暴露集不按 Role／Agent 异列；`lucy_catalog` sources 表列表不因 trim 变化。
4. ~~**SC-13**~~：**CLOSED**（Agent B）— 组件全量库存／开关 harness＋草稿／Proxy 对照＋pending `field_exposure`（非全浏览器 E2E）。
5. ~~**SC-17**~~：**CLOSED**（Agent C）— 合法纯台账发布 → 激活 → 运行面裁剪。
6. ~~**SC-18**~~：**CLOSED**（Agent C）— 无权身份原 ACL、无暴露码／配置泄漏。
7. ~~**SC-25**~~：**CLOSED***（Agent C）— 发布窗并发 STOP + V1／V2 measure 语义分叉 + 执行代次探针（残差：无 live KTX MCP 往返）。

## Agent A (SC-04/06)

- **目标**：仅补 SC-04／SC-06 自动化证据；不改 Spec／Plan／inventory 收口状态。
- **新增文件**：`webui/server/__tests__/field-exposure-proxy-sc04-sc06.test.ts`（loopback 上游计数夹具；无 scoped 行策略 Source；`table_agent` + `star_agent` `tables:["*"]`）。
- **SC-04 证据标题**：
  - `SC-04: lucy_query naming unexposed column → field_not_exposed; upstream execution = 0 (no scoped row policy)`
  - `SC-04: tables:["*"] agent lucy_query unexposed → field_not_exposed; upstream = 0`
- **SC-06 证据标题**：
  - `SC-06: lucy_explain_query naming unexposed column is denied locally (no upstream)`
  - `SC-06: tables:["*"] agent lucy_explain_query unexposed → field_not_exposed; upstream = 0`
  - 单元：`SC-06: lucy_explain_query carrier uses same exposure deny for unexposed column`
- **Vitest（Agent A 跑）**：3 files / **61 passed** / 0 failed（含既有 field-exposure + acl-hook）。
- **未触碰**：SC-12／13／17／18／25；无生产代码改动；无 git commit。
- **仍 OPEN（Agent A 当时）**：SC-12、SC-13、SC-17、SC-18、SC-25。Agent C 后仅余 SC-12／SC-13（见下节）。

## Agent C (SC-17/18/25)

| 元数据 | 内容 |
|---|---|
| 代理 | Tester Agent C |
| 日期 | 2026-11-13 |
| 范围 | 仅 SC-17／SC-18／SC-25；不改 Spec 头部收口；不碰 SC-04／06／12／13 |
| 基线命令 | `cd webui && npx vitest run server/__tests__/field-exposure.test.ts server/__tests__/field-exposure-acl-hook.test.ts server/__tests__/field-exposure-proxy-sc04-sc06.test.ts` |
| 本轮结果 | **3 files / 66 passed / 0 failed** |

### Per-SC

| ID | 状态 | 证据 |
|---|---|---|
| SC-17 | **CLOSED** | `field-exposure.test.ts` → `SC-17: legal ledger-only publish → activate success → runtime trims new exclusion set`：B1 合法闭包零违规 → `activateExecutionGenerationStratB` → 发现面裁剪＋查数拒 `orders.secret`／放行 `orders.amt` |
| SC-18 | **CLOSED** | `field-exposure-acl-hook.test.ts`：源码锁（对象授权先于暴露检查）；`SC-18: unauthorized connection guess…`；`SC-18: unauthorized table / ledger-fault guess…`（授权者对照得暴露码；无权者仍 `unknown_or_forbidden_connection:*`；错误体无 `field_not_exposed`／`field_exposure_unavailable`／台账配置） |
| SC-25 | **CLOSED*** | `field-exposure.test.ts` → `SC-25: pin old ServingGeneration; OPEN upstream==serving; V1/V2 fork probe; Strat-B STOP`：同名 `revenue` expr 分叉；发布窗 barrier＋并发 admission→`field_exposure_unavailable`；在途 pin 旧代；OPEN 时 upstream==serving；进程内执行代次探针断言返回语义属当前 OPEN 代（Spec「或等价」） |

\*SC-25 residual（诚实披露，不挡 CLOSED）：未跑 live KTX MCP `lucy_query` 往返；上游消费观察为按 `upstreamExecutionGenerationId` 取 measure expr 的进程内探针。

### 本轮改动文件

- `webui/server/__tests__/field-exposure.test.ts`（+SC-17／SC-25）
- `webui/server/__tests__/field-exposure-acl-hook.test.ts`（+SC-18）
- `docs/reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md`（本附录＋主表回写）

### 与 P0-A 收口关系

Agent C 三轨均 CLOSED。当时父任务仍待 **SC-12／SC-13**（后由 Agent B 关闭）；**本轮不得**改 Spec 状态行。**不可**仅凭 Agent C 宣称 P0-A 可收口。

## Agent B (SC-12/13)

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| Agent | Tester B（SC-12／SC-13） |
| 范围 | 仅 SC-12、SC-13；未改 Spec 状态；无 git commit；未改 Agent A／C 测试文件 |
| 基线命令 | `cd webui && npx vitest run server/__tests__/field-exposure-sc12-sc13.test.ts src/__tests__/field-exposure-workbench-sc13.test.tsx` |
| 连带回归 | 同跑 `field-exposure.test.ts` + `field-exposure-acl-hook.test.ts` + 本两文件 → **4 files / 71 passed** |

### Outcome

| ID | 结果 | 证据 |
|---|---|---|
| SC-12 | **CLOSED** | `field-exposure-sc12-sc13.test.ts`：① 读取器／查数校验签名无 Role／Agent；② 两 Agent 调用上下文 excluded／digest 一致；③ `lucyCatalog` 在 pin trimmed 前后 sources 表列表不变（两 Role agent）；④ `lucyCatalog` 源码锁：sources 来自 permissions，exposure 只改 examples |
| SC-13 | **CLOSED** | 后端：`SC-13: save without publish…` Proxy 仍见上一激活排除集；ServingGeneration 不变；pending 将 `_exposure` 归为 `field_exposure`。组件：`field-exposure-workbench-sc13.test.tsx` 全量库存（含 `secret`）＋文案；harness 可切换暴露并只写出 draft excluded。**全浏览器 E2E 不在 Spec 出口范围内**（Spec 要求组件＋Proxy 对照即可） |

### 新增／改动文件

| 文件 | 说明 |
|---|---|
| `webui/server/__tests__/field-exposure-sc12-sc13.test.ts` | **新建**；SC-12×4 + SC-13×3 |
| `webui/src/__tests__/field-exposure-workbench-sc13.test.tsx` | **新建**；SC-13 组件×2 |
| `docs/reviews/2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md` | 本附录＋主表 SC-12／13 状态 |

### 测试名与计数

- **本 Agent 新增：9**（全部通过）
  - `SC-12: loadExposureSet / validateQueryFieldsAgainstExposure take no Role or Agent identity`
  - `SC-12: exposure excluded set does not differ across Role/Agent call contexts`
  - `SC-12: lucyCatalog sources table list unchanged under trimmed exposure (trim ≠ hide tables)`
  - `SC-12 source lock: lucyCatalog builds sources from permissions; exposure only rewrites examples`
  - `SC-13: save without publish does not take effect — Proxy still sees prior activated exposure`
  - `SC-13: writing draft does not change ServingGeneration generationId or ledgers`
  - `SC-13: publish workbench pending classifies _exposure ledger as field_exposure`
  - `SC-13: workbench field list shows full inventory including columns that may be unexposed`
  - `SC-13: can toggle exposure and save without publish writes draft excluded set only`

### 与 P0-A 收口关系

SC-12／SC-13 **CLOSED**。主表 OPEN＝0，但 **本轮仍不得** 将 Spec 状态改为「功能合同已收口」（委托人未授权；SC-25 仍有 live-KTX 残差披露）。

## 建议 Spec 状态句

**不得**升格为功能合同已收口（即使主表 OPEN＝0）。保持：

> **实现已合入；待功能合同收口**（主表 SC 证据已齐；SC-25 CLOSED* 残差／委托人确权前不升格）。**本条不表示可上线。**
