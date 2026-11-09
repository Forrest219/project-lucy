# 空结果响应的结构化下一步指导 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v0.8-draft** / 2026-11-09 |
| 状态 | **v0.8-draft；R2-F＋R4 已闭合（2026-11-09）**。实现已落地；复审 **Approve with nits**。未宣称可上线 |
| 授权边界 | **已获开发授权（R4，2026-11-09）**：按本 Plan 执行实现 Task。Spec 见 [lucy-20261107-empty-result-next-step-guidance-spec.md](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) **v0.8-draft** |
| 验收 | 实施完成须同时满足：① Spec 的 SC-01–SC-30 逐条有证据；② `npm run lint:spec-docs` / `lint:spec` / `lint:terminology` / `lint:ia-boundary` 退出码 0；③ 相关 vitest 全绿；④ 一次**夹具上游**的 MCP `lucy_query` 0 行响应取到 `next_step` 形状证据。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 第 1／2 轮评审与裁定记录 | [`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md) |
| Codex 对抗评审 | [`docs/reviews/2026-11-09-empty-result-next-step-codex-review.md`](../reviews/2026-11-09-empty-result-next-step-codex-review.md)（过程对抗；≠ 终稿确权／开发授权） |
| 需求来源 | 需求池 REQ-030-018；分支计划 §3.1 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「落盘清单」「强制流程：Plan Mode」「状态登记只有一份现值」 |

## 1. 目标

让 Agent 在 `lucy_query` 成功但严格 0 行时，拿到一份**结构化、ACL 内、不发明事实、写入模型可读 MCP content 承载位**的下一步指导，并让这份指导说清真实成因（普通无数据 vs 行权限交集空）。

实现口径全部以 Spec **v0.8-draft** 为准，本 Plan 只负责落到具体文件、函数与测试。

**v0.2 相对 v0.1 的三处反转（历史；D3 现已冻结为 A）**：

1. **落点从「追加 content 块」改为「单块内加键」**——见 Spec §4 **D3＝A**（委托人 2026-11-09 确认）。
2. **`next_tools` 从授予清单改为可见清单**（`allowedToolNames`）。详见 Spec §4 D5。
3. **`query.filters` 改为「改写前的原始用户 filter + 去值摘要」**。详见 Spec §4 D6。

**v0.4 相对 v0.3 的六处反转（第 2 轮；仍有效，已被 v0.5 收紧处见下表）**：见 Spec v0.4 变更史；本版不重抄。

**v0.5-draft 相对 v0.4（Codex R1 F01…F12，务必先读）**：

| # | 修订 | 触发 | 详见 |
|---|---|---|---|
| 1 | **D3 曾单列未决**（**v0.7 已迁入 §4＝A**）；开工前置补 **R2-F＋决策闭合＋另发 R4** | F01 | Spec §4 D3；Plan §2 |
| 2 | **已存在承载位一致**（缺 structured 可注入 text＋meta；同名键冲突整单跳过） | F02 | Spec D4／D12；SC-22／SC-23 |
| 3 | **截断 `repair` 与 `next_step` 可并存**；不得删 Spec 162 截断提示 | F03 | Spec D14；SC-24 |
| 4 | **measures／dimensions／orderBy 分型白名单**对齐真实 schema | F04／F05 | Spec D11；SC-21 |
| 5 | **JSON 数值保真**（v0.5 口径；**v0.6 已按原始 token 收紧**） | F06 | Spec D15；SC-25 |
| 6 | **行数求值**仅成功 `lucy_query`；严格 `===0`；作用域在富化保护内 | F07／F09 | Spec D5／D8；SC-03／SC-20 |
| 7 | **修正 SC-01／SC-20 假绿**；补 ACL／拒绝负向 SC-26–SC-28 | F08 | Spec §7；Plan Task 1／3 |
| 8 | **证据措辞**止于 MCP content；状态镜像同句；版本指针／用例计数 | F10–F12 | Spec §5.4；Plan §2／Task 5 |


**v0.6-draft 相对 v0.5（Codex R2-01／02／03，务必先读）**：

| # | 修订 | 触发 | 详见 |
|---|---|---|---|
| 1 | **数值保真改为原始 token／保留原文注入**；补精度损失与下溢；跳过时原文不变 | R2-01／F06 | Spec D15；SC-25 |
| 2 | **统一成功判定先于权限／注入**（含 `isError`、HTTP≥400＋JSON-RPC result）；JSON／SSE 错误路径断言 | R2-02／F07 | Spec D13；SC-18／SC-30 |
| 3 | **Plan 术语模板同步 D4／D14**；证据范围扩至 SC-30（含 SC-29） | R2-03 | Plan Task 4／5 |


**v0.7-draft 相对 v0.6（Codex R3＝BLOCK 残留，务必先读）**：

| # | 修订 | 触发 | 详见 |
|---|---|---|---|
| 1 | **`withLucyResultMeta` 签名必含 `upstreamHttpStatus: number`**；JSON／SSE 两处调用传 `upstream.statusCode`；**禁止**成功判定 `?? 200`；可见工具门禁与注入门禁共用同一 status；可选辅助 `isEmptyResultNextStepEligible`；SC-30 夹具断言该路径 | R3／R2-02 major | Spec D13；Plan Task 2／3 |
| 2 | **收口示例** `SC-01–SC-29` → **`SC-01–SC-30`** | R3／R2-03 minor | Plan Task 5 |
| 3 | **D3＝A 全链路回写**：迁入 Spec §4；清空 §4.1；头部／Plan／评审／清单与「D3＝A 已确认」一致；**不得**再写「待确认 D3」 | R3 minor（回写缺陷）；委托人 2026-11-09 确认 | Spec §4／§4.1；Plan §2 |


**v0.8-draft 相对 v0.7（P0-5 独立评审 Request changes＝与 P0-4 共存，务必先读）**：

| # | 修订 | 触发 | 详见 |
|---|---|---|---|
| 1 | **SC-11／SC-25**：与 AV 共存后不再要求整段 text 逐字节相等；保证 next_step 承载位＋D15 业务数字保真；018 跳过／mock AV 时仍逐字节不变 | Major M1 | Spec §7；本 Plan 断言 |
| 2 | **SC-12**：最终响应／可观测 `_meta` 必须仍见 `next_step_skipped_reason`（含 `content_text_not_json_object`）；不得被 AV 错误信封抹掉 | Major M1／M2 | Spec SC-12；装配 |
| 3 | **SC-13**：区分 018 富化抛错 vs 018 完成后 AV 失败；后者须保留已写入 next_step／skipped_reason | Major M1／M2 | Spec SC-13；`buildAnswerVerifiabilityErrorEnvelope(lucy018)` |
| 4 | **N1**：`upstreamHttpStatus: number` 必参；缺省／非有限传 NaN，禁止 `?? 200` | N1 | Spec D13；`withLucyResultMeta` |
| 5 | **N2**：`content_text_absent` 写入 skipped_reason 枚举（独立码） | N2 | Spec §5.3 |


## 2. 开工前置

> **开工前置已齐（2026-11-09）**。下列项已闭合，**可按本 Plan 改运行代码与测试**。

1. **过程对抗清零**：R3 残留已在 v0.7-draft 闭合；过程再审＝CONDITIONAL，镜像 minor 已修。
2. **决策闭合**：D3＝A 已确认并迁入 Spec §4；D1–D15 一致。
3. ~~R2-F~~ → **已闭合（2026-11-09，委托人明示确权）**
4. ~~R4~~ → **已授予（2026-11-09）**
5. **术语登记先行**：新术语先登记进术语标准 **§4.8**，再写用户可见文案。
6. **口径对齐**：不改 Spec 162 的 `result_empty`／成功截断 `repair`、不改 `_meta.lucy` 既有字段取值、**不追加 content 块**（D3＝A）、不新增真实数据查询；数值无法保真时跳过指导（D15）；成功判定**禁止** `?? 200`。
7. **基线干净**：`npm run lint:spec-docs` 与相关 vitest 在开工前为绿（存量 WARN 除外）。
8. **状态镜像**：全部已有镜像与 Spec 头部「状态」行**同一句现值**（SC-29）。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/proxy/question-experience.ts` | 修改 | 新增**纯函数** `buildEmptyResultNextStep` 与常量；无 I/O、无副作用 |
| `webui/server/proxy/audit-privacy.ts` | 修改 | 把 `summarizeFilterItem` / `summarizeFilters` 由私有改为 **export**，供 filter 去值摘要复用（隐私纪律单一事实源） |
| `webui/server/proxy/mcp-proxy.ts` | 修改 | ① 改写前快照原始用户 filter；② 取 `allowedToolNames`；③ `withLucyResultMeta` 装配 `next_step` 并注入三处落点；④ 动态 instructions 增加一行 |
| `webui/server/__tests__/empty-result-next-step.test.ts` | 新增 | 纯函数单测（SC-01…SC-08） |
| `webui/server/__tests__/empty-result-next-step-proxy.test.ts` | 新增 | Proxy 层单测（SC-09…SC-14），夹具复用 `mcp-proxy-smoke.test.ts` 的自建上游 |
| `webui/docs/00-product-terminology-standard.md` | 修改 | **§4.8** 登记四条术语（SC-15） |
| `docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md` | 修改 | 状态行 + 验收证据落点 |
| `docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md` | 修改 | 状态行 |

**不新建模块**：纯函数进 `question-experience.ts`（既有纯函数模块：`repairHint` / `isEmptyResult` / `resolveResponseTruncated` 同居），装配留在 `mcp-proxy.ts`。

## 4. 任务分解

### Task 1：纯函数 `buildEmptyResultNextStep`

**Files:**
- Modify: `webui/server/proxy/question-experience.ts`（文件末尾追加）
- Test: `webui/server/__tests__/empty-result-next-step.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  export type NextStep = {
    kind: "empty_result" | "scope_intersection_empty";   // N9：沿用既有机器码与主术语
    summary: string;
    query?: Record<string, unknown>;
    suggestions: string[];
    next_tools: string[];
    hint: string;
  };

  export function buildEmptyResultNextStep(input: {
    toolName: string;
    rowCount?: number | null;
    scopeIntersectionEmpty?: boolean;
    provenance?: Record<string, unknown>;              // 不含 filters
    filtersSummary?: Record<string, unknown> | null;   // 已去值；调用方负责去值
    visibleTools?: readonly string[];                  // 已解析的可见工具名
  }): NextStep | null;

  export const EMPTY_RESULT_SUMMARY: string;
  export const SCOPE_SUMMARY: string;               // N4：不预设成因
  export const EMPTY_RESULT_HINT: string;
  export const NO_TOOL_HINT: string;                // D10：next_tools 为空时的 hint
  export const RELAX_FILTER_SUGGESTION: string;
  export const SCOPE_SUGGESTION: string;
  export const CHECK_PERIOD_SUGGESTION: string;
  export const CHECK_GRAIN_SUGGESTION: string;
  export const NEXT_STEP_TOOLS: readonly string[];
  ```

  > **`filters` 单独作为 `filtersSummary` 入参**是刻意的结构防护：纯函数**不可能**拿到原始 filter 值，原始值永远进不了 `next_step`。

- [ ] **Step 1：写失败测试**

  新建 `webui/server/__tests__/empty-result-next-step.test.ts`：

  ```ts
  /**
   * Spec 20261107 §7 — 空结果下一步指导的纯函数合同（SC-01…SC-08）。
   */
  import { describe, expect, it } from "vitest";
  import {
    buildEmptyResultNextStep,
    CHECK_GRAIN_SUGGESTION,
    CHECK_PERIOD_SUGGESTION,
    EMPTY_RESULT_HINT,
    EMPTY_RESULT_SUMMARY,
    NEXT_STEP_TOOLS,
    NO_TOOL_HINT,
    RELAX_FILTER_SUGGESTION,
    SCOPE_SUGGESTION,
    SCOPE_SUMMARY
  } from "../proxy/question-experience.js";
  import { summarizeFilters } from "../proxy/audit-privacy.js";

  describe("buildEmptyResultNextStep", () => {
    it("SC-01 对 lucy_query 的 0 行返回 empty_result 指导", () => {
      // F08：必须显式传可见工具；缺省 visibleTools=[] → hint=NO_TOOL_HINT（见 SC-17）
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        visibleTools: ["lucy_read_source", "lucy_freshness"]
      });
      expect(step).not.toBeNull();
      expect(step?.kind).toBe("empty_result");
      expect(step?.summary).toBe(EMPTY_RESULT_SUMMARY);
      expect(step?.hint).toBe(EMPTY_RESULT_HINT);
      expect(step?.next_tools).toEqual(["lucy_read_source", "lucy_freshness"]);
    });

    it("SC-02 有数据时不带指导", () => {
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 3 })).toBeNull();
    });

    it("SC-03 行数未知／非有限／非严格 0 时不判空", () => {
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: null })).toBeNull();
      expect(buildEmptyResultNextStep({ toolName: "lucy_query" })).toBeNull();
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: -1 })).toBeNull();
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: Number.NaN })).toBeNull();
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: Number.POSITIVE_INFINITY })).toBeNull();
    });

    it("SC-04 非 lucy_query 工具不带指导", () => {
      expect(buildEmptyResultNextStep({ toolName: "lucy_read_source", rowCount: 0 })).toBeNull();
      expect(buildEmptyResultNextStep({ toolName: "entity_details", rowCount: 0 })).toBeNull();
    });

    it("SC-05 query 只含存在的键，filters 用去值摘要", () => {
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        provenance: { sourceName: "sales_order", connectionId: null, measures: ["revenue"] },
        filtersSummary: { kind: "list", count: 1, items: [{ kind: "structured", field: "company", op: "contains", valueCount: 1 }] }
      });
      expect(step?.query).toEqual({
        sourceName: "sales_order",
        measures: ["revenue"],
        filters: { kind: "list", count: 1, items: [{ kind: "structured", field: "company", op: "contains", valueCount: 1 }] }
      });
      expect(Object.prototype.hasOwnProperty.call(step?.query ?? {}, "connectionId")).toBe(false);
    });

    it("SC-05 filters 缺省时不出现该键，且不含任何原始值字段", () => {
      const step = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0 });
      expect(Object.prototype.hasOwnProperty.call(step?.query ?? {}, "filters")).toBe(false);
      const withRaw = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        provenance: { filters: [{ field: "company", op: "contains", value: "某某公司" }] }
      });
      // provenance 里的 filters 不被采纳——只有 filtersSummary 生效
      expect(Object.prototype.hasOwnProperty.call(withRaw?.query ?? {}, "filters")).toBe(false);
    });

    it("SC-06 next_tools 只含调用者可见的工具，无通配语义", () => {
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        visibleTools: ["lucy_read_source"]
      });
      expect(step?.next_tools).toEqual(["lucy_read_source"]);
      expect(step?.next_tools).not.toContain("lucy_freshness");
      const none = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0, visibleTools: [] });
      expect(none?.next_tools).toEqual([]);
      expect(none?.suggestions.length).toBeGreaterThan(0);   // D10：工具为空不降级建议
    });

    it("SC-07 行权限交集空时分流 kind 且不给泛化建议", () => {
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        scopeIntersectionEmpty: true
      });
      expect(step?.kind).toBe("scope_intersection_empty");
      expect(step?.summary).toBe(SCOPE_SUMMARY);
      expect(step?.suggestions).toContain(SCOPE_SUGGESTION);
      expect(step?.suggestions).not.toContain(RELAX_FILTER_SUGGESTION);
      // N4：不预设成因——不得断言「取值不在授权范围内」
      expect(step?.summary).not.toContain("不在授权范围内");
      expect(step?.suggestions.join(" ")).not.toContain("不在授权范围内");
    });

    it("SC-08 hint 与 summary 不含结论性判断", () => {
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        visibleTools: ["lucy_read_source"]
      });
      for (const text of [step?.summary ?? "", step?.hint ?? ""]) {
        expect(text).not.toContain("数据错误");
        expect(text).not.toContain("数据缺失");
      }
      expect(NEXT_STEP_TOOLS.length).toBe(2);
    });

    it("SC-17 next_tools 为空时 hint 明说没有可用工具", () => {
      const none = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0, visibleTools: [] });
      expect(none?.next_tools).toEqual([]);
      expect(none?.suggestions.length).toBe(3);
      expect(none?.hint).toBe(NO_TOOL_HINT);
      expect(none?.hint).toContain("没有可用的核对工具");
      const some = buildEmptyResultNextStep({
        toolName: "lucy_query", rowCount: 0, visibleTools: ["lucy_read_source"]
      });
      expect(some?.hint).toBe(EMPTY_RESULT_HINT);
    });

    it("SC-21 measures/dimensions/orderBy 白名单与真实 schema 对齐", () => {
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        visibleTools: ["lucy_read_source"],
        provenance: {
          measures: [{ expr: "sum(revenue)", rows: 999, name: "x" }],
          dimensions: [
            { field: "sales_order.month", granularity: "month", extra: true },
            "month" // 字符串维度：真实 schema 不接受 → 整项丢弃
          ],
          orderBy: [{ field: "sales_order.month", direction: "asc", rows: [] }]
        }
      });
      expect(step?.query?.measures).toEqual([{ expr: "sum(revenue)" }]);
      expect(step?.query?.dimensions).toEqual([{ field: "sales_order.month", granularity: "month" }]);
      expect(step?.query?.orderBy).toEqual([{ field: "sales_order.month", direction: "asc" }]);
      const payload = JSON.stringify(step);
      for (const banned of ["\"rows\"", "\"totalRows\"", "\"columns\"", "\"headers\"", "\"extra\""]) {
        expect(payload).not.toContain(banned);
      }
    });

    it("SC-05 去值摘要形状与 summarizeFilters 真实输出一致", () => {
      // N11：纯函数不自己造摘要形状——直接用 audit-privacy 的真实实现喂进去
      const structured = summarizeFilters([{ field: "company", op: "contains", value: "某某公司" }]);
      expect(structured.kind).toBe("list");
      expect(structured.count).toBe(1);
      const expression = summarizeFilters(["company like '%X%'"]);
      expect((expression.items as Record<string, unknown>[])[0]?.kind).toBe("expression");
      expect((expression.items as Record<string, unknown>[])[0]).not.toHaveProperty("field");
      expect((expression.items as Record<string, unknown>[])[0]).not.toHaveProperty("op");
      const single = summarizeFilters({ field: "company", op: "eq", value: "X" });
      expect(single.kind).toBe("single");
    });
  });
  ```

- [ ] **Step 2：跑测试确认失败**

  Run: `cd webui && npx vitest run server/__tests__/empty-result-next-step.test.ts`
  Expected: FAIL —— 导出 `buildEmptyResultNextStep` 不存在。

- [ ] **Step 3：实现纯函数**

  在 `webui/server/proxy/question-experience.ts` 末尾追加：

  ```ts
  /**
   * 空结果下一步指导（Spec 20261107 v0.7-draft §5.1 / D1–D15；D3＝A 已冻结）。
   *
   * 只复用响应链路上**已经解析出**的事实。不断言 grain / 数据可用周期 /
   * 指标清单。指导是 fail-open 的建议层，不是授权，也不是结论。
   *
   * `filters` 只能经 `filtersSummary`（已去值）进入。
   */
  export type NextStep = {
    kind: "empty_result" | "scope_intersection_empty";
    summary: string;
    query?: Record<string, unknown>;
    suggestions: string[];
    next_tools: string[];
    hint: string;
  };

  export const EMPTY_RESULT_SUMMARY = "本次查询返回 0 行事实数据。";
  export const SCOPE_SUMMARY = "本次查询返回 0 行：当前的等值过滤与该角色的行权限范围没有交集，或同一字段的多个等值条件互相矛盾。";
  export const EMPTY_RESULT_HINT = "在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。";
  export const NO_TOOL_HINT = "当前角色没有可用的核对工具（next_tools 为空），以上建议只能人工核对；在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。";
  export const RELAX_FILTER_SUGGESTION = "放宽过滤条件（公司 / 产品线 / 时间范围）后重查";
  export const SCOPE_SUGGESTION = "移除或调整与行权限范围冲突的等值过滤条件，或检查同一字段的多个等值条件是否互相矛盾";
  export const CHECK_PERIOD_SUGGESTION = "确认目标期间落在该 source 的数据可用周期内";
  export const CHECK_GRAIN_SUGGESTION = "确认问题的时间粒度与该 source 的粒度一致";
  export const NEXT_STEP_TOOLS = ["lucy_read_source", "lucy_freshness"] as const;

  function shapeMeasures(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item === "string" && item.length > 0) { out.push(item); continue; }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const expr = (item as Record<string, unknown>).expr;
        if (typeof expr === "string" && expr.length > 0) out.push({ expr });
      }
    }
    return out.length > 0 ? out : undefined;
  }

  function shapeDimensions(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: unknown[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue; // 字符串维度丢弃
      const rec = item as Record<string, unknown>;
      if (typeof rec.field !== "string" || rec.field.length === 0) continue;
      const dim: Record<string, unknown> = { field: rec.field };
      if (typeof rec.granularity === "string") dim.granularity = rec.granularity;
      out.push(dim);
    }
    return out.length > 0 ? out : undefined;
  }

  function shapeOrderBy(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: unknown[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.field !== "string" || rec.field.length === 0) continue;
      const row: Record<string, unknown> = { field: rec.field };
      if (rec.direction === "asc" || rec.direction === "desc") row.direction = rec.direction;
      out.push(row);
    }
    return out.length > 0 ? out : undefined;
  }

  export function buildEmptyResultNextStep(input: {
    toolName: string;
    rowCount?: number | null;
    scopeIntersectionEmpty?: boolean;
    provenance?: Record<string, unknown>;
    filtersSummary?: Record<string, unknown> | null;
    visibleTools?: readonly string[];
  }): NextStep | null {
    if (input.toolName !== "lucy_query") return null;
    // D8／F09：严格零；与 isEmptyResult 同口径。禁止 `rowCount > 0` 假对称。
    if (typeof input.rowCount !== "number" || !Number.isFinite(input.rowCount) || input.rowCount !== 0) {
      return null;
    }

    const scopeConflict = input.scopeIntersectionEmpty === true;
    const provenance = input.provenance ?? {};
    const query: Record<string, unknown> = {};
    if (provenance.connectionId != null) query.connectionId = provenance.connectionId;
    if (provenance.sourceName != null) query.sourceName = provenance.sourceName;
    const orderBy = shapeOrderBy(provenance.orderBy ?? provenance.order_by);
    if (orderBy) query.orderBy = orderBy;
    const measures = shapeMeasures(provenance.measures);
    if (measures) query.measures = measures;
    const dimensions = shapeDimensions(provenance.dimensions);
    if (dimensions) query.dimensions = dimensions;
    if (input.filtersSummary && typeof input.filtersSummary === "object") {
      query.filters = input.filtersSummary;
    }

    const suggestions = scopeConflict
      ? [SCOPE_SUGGESTION, CHECK_PERIOD_SUGGESTION, CHECK_GRAIN_SUGGESTION]
      : [RELAX_FILTER_SUGGESTION, CHECK_PERIOD_SUGGESTION, CHECK_GRAIN_SUGGESTION];

    const visible = input.visibleTools ?? [];
    const nextTools = NEXT_STEP_TOOLS.filter((tool) => visible.includes(tool));

    return {
      kind: scopeConflict ? "scope_intersection_empty" : "empty_result",
      summary: scopeConflict ? SCOPE_SUMMARY : EMPTY_RESULT_SUMMARY,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      suggestions,
      next_tools: [...nextTools],
      hint: nextTools.length > 0 ? EMPTY_RESULT_HINT : NO_TOOL_HINT
    };
  }
  ```

- [ ] **Step 4：跑测试确认通过**

  Run: `cd webui && npx vitest run server/__tests__/empty-result-next-step.test.ts`
  Expected: PASS —— **本文件全部 `it` 全绿**（现行用例数以测试文件为准；**不得**再写死「9 条全绿」历史数量作出口，F12）。

- [ ] **Step 5：提交**

  ```bash
  git add webui/server/proxy/question-experience.ts webui/server/__tests__/empty-result-next-step.test.ts
  git commit -m "feat(proxy): add empty-result next-step builder"
  ```

### Task 2：原始用户 filter 快照 + 可见工具清单

**Files:**
- Modify: `webui/server/proxy/audit-privacy.ts`（`summarizeFilterItem` / `summarizeFilters` 加 `export`）
- Modify: `webui/server/proxy/mcp-proxy.ts`（改写前快照；`writeLucySemanticResponse` 取可见工具）

**Interfaces:**
- Consumes: Task 1 的 `buildEmptyResultNextStep`
- Produces:
  - `audit-privacy.ts` 导出 `summarizeFilterItem(value: unknown): Record<string, unknown>` 与 `summarizeFilters(value: unknown): Record<string, unknown>`
  - `writeLucySemanticResponse` 新增入参 `originalUserFilters: unknown`（改写前的原始用户 filter，可为 `undefined`）

- [ ] **Step 1：在改写前快照原始用户 filter**

  在 `webui/server/proxy/mcp-proxy.ts` 的 `handlePost` 内，`if (toolName === "lucy_query") {` 那一段（现行 `:4181-4189`）**之前**加：

  ```ts
  // Spec 20261107 D6 —— 行策略谓词会在下面被前插进 filters。先快照**原始用户
  // filter**，next_step 只回显它（且去值），策略谓词与强制表达式一律不出现。
  let originalUserFilters: unknown;
  ```

  并在该段开头（`:4182` 之前）加：

  ```ts
  originalUserFilters = (toolArgs as Record<string, unknown> | undefined)?.filters;
  ```

  > 只快照 `filters`：`applyLucyQueryForcedFilters` 只改 `filters`（并删 `forced_filters`），`measures` / `dimensions` / `order_by` 不受影响。

- [ ] **Step 2：把快照传进响应装配**

  在 `handlePost` 调用 `writeLucySemanticResponse(...)` 的地方（现行 `:5990-6007`）追加参数 `originalUserFilters`，并在 `writeLucySemanticResponse` 的签名（现行 `:2827-2843`）末尾加同名参数。

- [ ] **Step 3：导出 filter 去值摘要器**

  在 `webui/server/proxy/audit-privacy.ts` 把两处 `function` 改为 `export function`：

  ```ts
  export function summarizeFilterItem(value: unknown): Record<string, unknown> { ... }
  export function summarizeFilters(value: unknown): Record<string, unknown> { ... }
  ```

  > 隐私纪律单一事实源：审计落库与 Agent 可见响应共用同一套「filters 去值」口径。

- [ ] **Step 4：取调用者可见工具（只在成功 `lucy_query` 严格 0 行求值）**

  在 `writeLucySemanticResponse` 内、**既有富化 try／catch 保护之内**、且已能安全取得上游 `result` 子树之后。  
  **实际 HTTP status 来源**（现行源码）：本函数入参 `upstream: IncomingMessage` 的 **`upstream.statusCode`**（同文件 `classifyUpstreamFailure(upstream.statusCode, …)` 已用该字段，见 `:2956`）。先绑定局部常量，再喂给门禁与 `withLucyResultMeta`：

  ```ts
  // Spec 20261107 D13／D5／R2-02／R3 —— 统一成功判定通过后才求值。
  // 顺序：isEmptyResultNextStepEligible → allowedToolNames → build／注入。
  // 禁止对 status 做 ?? 200；缺省／非有限 status ⇒ 非 eligible。
  // 不得对 200+isError 或 500+JSON-RPC result+rows:[] 触发；JSON／SSE 同口径。
  const upstreamHttpStatus = upstream.statusCode; // 实际上游 HTTP；不得 ?? 200
  const inspectedEarly = inspectRowsAndColumns(/* 上游 result 子树 */);
  const resultRecordEarly = /* 上游 result 子树 */;
  const shouldResolveVisibleTools = isEmptyResultNextStepEligible({
    status: upstreamHttpStatus,
    result: resultRecordEarly,
    toolName,
    rowCount: inspectedEarly.rows
  });
  const visibleTools = shouldResolveVisibleTools
    ? await allowedToolNames(identity).catch(() => [] as string[])
    : ([] as string[]);
  ```

  > `allowedToolNames` 已在 `mcp-proxy.ts:35` import。
  > 可见工具门禁与注入门禁**必须**共用同一 `upstreamHttpStatus`（同一局部常量）。
  > 装配内**复用**同一份行数判定，不得二次解析出两个口径。
  > SC-20 须对本功能新增的 `allowedToolNames` 调用点做 **spy 计数＝0**（有数据／非 `lucy_query`）。
  > SC-30 夹具须断言 HTTP≥400 路径上该门禁为 false 且 spy＝0。

- [ ] **Step 5：跑既有测试确认无回归**

  Run: `cd webui && npx vitest run server/__tests__/audit-v025-privacy.test.ts server/__tests__/mcp-proxy-smoke.test.ts`
  Expected: PASS。（`audit-privacy` 的导出改动不得改变既有落库形状。）

- [ ] **Step 6：提交**

  ```bash
  git add webui/server/proxy/audit-privacy.ts webui/server/proxy/mcp-proxy.ts
  git commit -m "feat(proxy): snapshot original user filters and resolve visible tools"
  ```

### Task 3：装配 `next_step` 并注入三处落点

**Files:**
- Modify: `webui/server/proxy/mcp-proxy.ts`（`withLucyResultMeta`）
- Test: `webui/server/__tests__/empty-result-next-step-proxy.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `buildEmptyResultNextStep`；Task 2 的 `visibleTools` / `originalUserFilters`
- Produces: 响应体上出现 `result._meta.lucy.next_step`、`result.content[0].text` 的 `next_step` 键、`result.structuredContent.next_step`

- [ ] **Step 1：写失败测试（可运行）**

  新建 `webui/server/__tests__/empty-result-next-step-proxy.test.ts`。

  **夹具来源**：克隆 `webui/server/__tests__/mcp-proxy-smoke.test.ts:923-1005` 那条用例——它自带完整启动方式（同文件的 `ACCESS_YAML` / `beforeEach` / `TOKEN` / `readRequestBody` 全部复用），**只做两处改动**：

  1. 上游 payload 的 `rows` 由 `[["2902"]]` 改为 `[]`（`totalRows` 同步改为 `0`）；
  2. 断言换成下面这组。

  ```ts
  /**
   * Spec 20261107 §7 — Proxy 层落位（SC-09…SC-14）。
   *
   * 夹具：克隆 mcp-proxy-smoke.test.ts:923-1005 的自建上游 + buildProxy + fetch，
   * 只把上游 rows 改成 []。本文件不重复 ACCESS_YAML / TOKEN / readRequestBody
   * 的定义——直接照抄那一条用例的 setup，只改 payload 与断言。
   */
  // 上游返回 0 行：
  //   content: [{ type: "text", text: JSON.stringify({ headers: ["dau"], rows: [], totalRows: 0 }) }]
  //   structuredContent: { headers: ["dau"], rows: [], totalRows: 0 }

  it("SC-09 空结果带 next_step，且上游数据取值不变", async () => {
    // ... 复用 smoke 用例的 setup，拿到 parsed 后：
    const meta = parsed.result._meta?.lucy;
    expect(meta?.next_step?.kind).toBe("empty_result");
    const text = parsed.result.content[0]?.text ?? "";
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data.next_step).toBeDefined();
    expect((data.next_step as { kind: string }).kind).toBe("empty_result");
    // 上游取值不变
    expect(data.headers).toEqual(["dau"]);
    expect(data.rows).toEqual([]);
    expect(data.totalRows).toBe(0);
  });

  it("SC-10 structuredContent 与另两处内容一致", async () => {
    expect(parsed.result.structuredContent?.next_step).toEqual(parsed.result._meta?.lucy?.next_step);
    const text = JSON.parse(parsed.result.content[0]?.text ?? "");
    expect(text.next_step).toEqual(parsed.result._meta?.lucy?.next_step);
  });

  it("SC-11 非空结果无 next_step；与 AV 共存时业务字段保真", async () => {
    // 上游 rows 非空；与 P0-4 共存后不再要求整段 text 逐字节相等：
    expect(textObj.headers).toEqual(["dau"]);
    expect(textObj.rows).toEqual([["2902"]]);
    expect(textObj.totalRows).toBe(1);
    expect(textObj.answer_verifiability).toBeTruthy(); // P0-4 合法加键
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result.content?.length).toBe(1); // 不追加块
  });

  it("SC-12 text 不是 JSON 对象 → 不注入；skipped_reason 不被 AV 抹掉", async () => {
    // 上游 content[0].text 为 "plain text"（非 JSON）；P0-4 可走错误信封：
    expect(parsed.result.structuredContent?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    // 最终响应／可观测 _meta 必须仍见（M2：AV 错误信封保留）
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("content_text_not_json_object");
  });

  it("SC-18 JSON／SSE：200 + isError:true + rows:[] 不发且不调 allowedToolNames", async () => {
    // 上游 HTTP 200 + result.isError:true + rows:[]（JSON 与 SSE 各一条）
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("result_is_error");
    expect(allowedToolNamesSpy.mock.calls.length).toBe(0);
  });

  it("SC-19 上游已带 next_step 键时不覆盖", async () => {
    // 上游 content[0].text 内已有 next_step: { upstream: true }：
    expect(JSON.parse(parsed.result.content[0]?.text ?? "").next_step).toEqual({ upstream: true });
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("upstream_next_step_present");
  });

  it("SC-20 有数据／非 lucy_query 时不触发可见性裁决（计数）", async () => {
    // F08：必须对本功能新增调用点 spy；不得只断言「没有 next_step」假绿。
    const spy = vi.spyOn(/* allowedToolNames 模块导出 */, "allowedToolNames");
    // 变体 A：lucy_query + rows 非空 → spy 调用次数增加量 === 0
    // 变体 B：lucy_read_source + rows:[] → spy 调用次数增加量 === 0，且无 next_step
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(spy.mock.calls.length).toBe(0);
  });

  it("SC-22 无 structuredContent 时 text＋meta 仍注入", async () => {
    // 上游只有 content text JSON、无 structuredContent：
    expect(parsed.result.structuredContent).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step?.kind).toBe("empty_result");
    expect(JSON.parse(parsed.result.content[0]?.text ?? "").next_step).toEqual(
      parsed.result._meta?.lucy?.next_step
    );
  });

  it("SC-23 structured 已有 next_step、text 无 → 整单跳过", async () => {
    expect(parsed.result.structuredContent?.next_step).toEqual({ upstream: true });
    expect(JSON.parse(parsed.result.content[0]?.text ?? "").next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("upstream_next_step_present");
  });

  it("SC-24 rows=[] 且截断 → repair 与 next_step 并存", async () => {
    // 夹具：触发 Spec 162 resolveResponseTruncated 出 repair，同时 rows:[]
    expect(parsed.result._meta?.lucy?.repair).toBe(TRUNCATION_REPAIR_HINT);
    expect(parsed.result._meta?.lucy?.next_step?.kind).toBe("empty_result");
  });

  it("SC-25 原始 token 不保真 → 018 跳过；与 AV 共存时 token 仍在", async () => {
    // 必覆盖三类原文夹具（禁止仅用 parse 后有限＋深等判可注入）：
    //   (a) totalRows: 1e400
    //   (b) totalRows: 9007199254740993
    //   (c) totalRows: 1e-400
    // 与 P0-4 共存：不再要求整段 text === upstreamText；须仍含原始 token。
    expect(parsed.result.content[0]?.text).toContain(token);
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe(
      "content_json_number_not_fidelity_safe"
    );
  });

  it("SC-13(b) 018 注入成功后 AV 失败 → _meta 仍含 next_step", async () => {
    // 上游 text 已带 answer_verifiability 键 → 018 可注入 next_step，AV 键冲突失败
    expect(parsed.result.isError).toBe(true);
    expect(parsed.result._meta?.lucy?.next_step?.kind).toBe("empty_result");
  });

  it("SC-30 JSON／SSE：HTTP 500 + JSON-RPC result + rows:[] → 无 next_step 且不调 allowedToolNames", async () => {
    // classifier 可能放过 JSON-RPC 信封；本条仍非成功（D13）
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(allowedToolNamesSpy.mock.calls.length).toBe(0);
  });

  it("SC-26／SC-27 ACL 外表／未暴露列／P0-3 拒绝／权限拒绝 → 无 next_step", async () => {
    // 复用既有 denial／歧义门闩夹具；断言响应无 next_step，且不改既有拒绝形状
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
  });

  it("N7 行策略谓词绝不出现在 query.filters（端到端）", async () => {
    // 夹具变体：角色带行策略 forced filter，同时用户自己发一条 filter。
    // 上游 0 行；断言 query.filters 只含**用户**那条的去值摘要，且不含 forced 谓词的字段。
    const text = JSON.parse(parsed.result.content[0]?.text ?? "");
    const filters = text.next_step?.query?.filters as { items?: Record<string, unknown>[] } | undefined;
    const fields = (filters?.items ?? []).map((i) => i.field);
    expect(fields).toContain("company");        // 用户自己的 filter
    expect(fields).not.toContain("__forced__"); // 策略谓词不得出现
    expect(JSON.stringify(filters)).not.toContain("forced");
  });
  ```

  > **N7 的夹具要求**：原 smoke 夹具的 `lucy_query` 入参**不带任何 filter**（`mcp-proxy-smoke.test.ts:957-962` 只有 `connectionId`/`measures`/`limit`）→ `originalUserFilters` 恒为 `undefined` → `query.filters` 在所有 Proxy 层测试里**根本不会出现**，第 1 轮唯一 blocker（B2：策略谓词泄漏）的不变量就**一条断言都没有**。因此本任务必须**加一条带 filter 的夹具变体**：用户在 `lucy_query` 入参里带一条 `filters`（如 `{ field: "company", op: "contains", value: "某某公司" }`），且该角色的行策略同时带一条 forced filter，断言 `query.filters` 里只有用户那条的 `field`/`op`/`valueCount`、**没有** forced 谓词。
  > SC-13（区分 018 富化抛错 vs AV 失败保留 next_step）与 SC-14（审计行数不被污染）在同文件补断言：SC-14 断言审计行的 `response_row_count` 为 `0`，且**额外**断言载荷内不含 `rows`/`totalRows`/`columns`/`headers` 键（用 `JSON.stringify(next_step)` 做子串断言）。

- [ ] **Step 2：跑测试确认失败**

  Run: `cd webui && npx vitest run server/__tests__/empty-result-next-step-proxy.test.ts`
  Expected: FAIL —— `result._meta.lucy.next_step` 不存在。

- [ ] **Step 3：实现装配**

  3.1 在 `mcp-proxy.ts` 的 import 区加入（若尚未导入）：

  ```ts
  import { buildEmptyResultNextStep, type NextStep } from "./question-experience.js";
  import { summarizeFilters } from "./audit-privacy.js";
  ```

  3.2 先新增（或与 `withLucyResultMeta` 同文件局部）统一成功判定辅助函数，**签名必含 `status`**；再改 `withLucyResultMeta` 签名，**必含** `upstreamHttpStatus: number`（或从上游 `IncomingMessage`／`Response` 明确传入的同义参数）。**禁止**在成功判定里对缺省 `?? 200`：

  ```ts
  /** Spec D13／R3 — 先判定再权限／注入；status 必须是实际上游 HTTP。 */
  function isEmptyResultNextStepEligible(input: {
    status: number | undefined;
    result: { isError?: unknown } | null | undefined;
    toolName: string;
    rowCount: number | null | undefined;
  }): boolean {
    const { status, result, toolName, rowCount } = input;
    if (typeof status !== "number" || !Number.isFinite(status) || status >= 400) return false;
    if (result?.isError === true) return false;
    if (toolName !== "lucy_query") return false;
    return typeof rowCount === "number" && Number.isFinite(rowCount) && rowCount === 0;
  }

  function withLucyResultMeta(
    payload: unknown,
    requestId: string | number,
    toolName: string,
    args: unknown,
    sourceRefs: SourceRef[],
    visibleTools: readonly string[],
    originalUserFilters: unknown,
    scopeIntersectionEmpty: boolean,
    upstreamHttpStatus: number   // 必含；来自 writeLucySemanticResponse 的 upstream.statusCode
  ): unknown {
  ```

  > 调用顺序硬约束：① `isEmptyResultNextStepEligible({ status: upstreamHttpStatus, … })` → ② 仅 eligible 时 `allowedToolNames` → ③ `buildEmptyResultNextStep`／注入。  
  > `upstreamHttpStatus` 与 Task 2 Step 4 的局部常量**同一来源**；JSON／SSE 两处调用均须传入（见 3.6）。

  3.3 把既有内联的 `provenance` 提成局部变量（**字段与取值一个都不改**，只是提成变量以便复用）：

  ```ts
  const provenance = {
    connectionId: firstStringField(argsRecord, ["connectionId", "connection_id", "connection"]) ?? null,
    sourceName: firstStringField(argsRecord, ["sourceName", "source_name", "source", "table"]) ?? sourceRefs[0]?.sourceName ?? null,
    measures: boundedProvenanceValue(firstFieldValue(argsRecord, ["measures"])) ?? null,
    dimensions: boundedProvenanceValue(firstFieldValue(argsRecord, ["dimensions"])) ?? null,
    filters: boundedProvenanceValue(filters) ?? null,
    segments: boundedProvenanceValue(segments) ?? null,
    orderBy: boundedProvenanceValue(orderBy) ?? null,
    sourceResolution: sourceRefs.length > 0 ? "acl_source_map" : "none",
    freshness: { /* 既有值不动 */ },
    truncation: /* 既有值不动 */
  };
  ```

  > **不改** `provenance` 的任何既有取值（包括 `connectionId` 的 `?? null`）——那是 Spec 162 §7.5 治理的字段，本条不修订。

  再加一个**只给 `next_step` 用**的裁剪视图（既有 `provenance` 本身不动）：

  ```ts
  // N1：next_step 的 query **不认** provenance.filters —— 它只认独立的 filtersSummary
  // （去值摘要）。否则原始用户 filter 值会直达模型可见位。
  const nextStepProvenance = { ...provenance };
  delete nextStepProvenance.filters;
  ```

  装配时把 `nextStepProvenance` 传给纯函数（见 3.4）。

  3.4 构造并注入 `next_step`（**已存在承载位一致**，D4；**先统一成功判定**，D13；**同一 `upstreamHttpStatus`**）：

  ```ts
  // D13／R3：先判定再权限／注入。非 eligible 时不得依赖 visibleTools 副作用。
  // 禁止 (upstreamHttpStatus ?? 200)；缺省／非有限 status ⇒ eligible=false。
  const eligible = isEmptyResultNextStepEligible({
    status: upstreamHttpStatus,
    result: resultRecord,
    toolName,
    rowCount: inspectedResult.rows
  });

  let lucyNextStep: NextStep | undefined;
  let nextStepSkippedReason: string | undefined;

  if (!eligible) {
    if (resultRecord.isError === true && toolName === "lucy_query" && inspectedResult.rows === 0) {
      nextStepSkippedReason = "result_is_error"; // SC-18
    }
  } else {
    // visibleTools 须已在 Task 2 按同一 eligible 口径求值后传入；此处不得再补 ?? 200。
    const nextStep = buildEmptyResultNextStep({
      toolName,
      rowCount: inspectedResult.rows ?? null,
      scopeIntersectionEmpty,
      provenance: withoutFilters(provenance),
      filtersSummary: originalUserFilters === undefined ? null : summarizeFilters(originalUserFilters),
      visibleTools
    });
    if (nextStep) {
      const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
      const first = content[0] as { type?: string; text?: string } | undefined;
      const originalText = first && typeof first.text === "string" ? first.text : undefined;
      let parsed: Record<string, unknown> | undefined;
      if (originalText !== undefined) {
        try {
          const maybe = JSON.parse(originalText) as unknown;
          if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) parsed = maybe as Record<string, unknown>;
        } catch { parsed = undefined; }
      }
      const structuredIsObject =
        resultRecord.structuredContent
        && typeof resultRecord.structuredContent === "object"
        && !Array.isArray(resultRecord.structuredContent);
      if (!parsed || originalText === undefined) {
        nextStepSkippedReason = originalText !== undefined
          ? "content_text_not_json_object"
          : "content_text_absent"; // N2：独立枚举码，见 Spec §5.3
      } else if (Object.prototype.hasOwnProperty.call(parsed, "next_step")) {
        nextStepSkippedReason = "upstream_next_step_present";
      } else if (
        structuredIsObject
        && Object.prototype.hasOwnProperty.call(resultRecord.structuredContent as object, "next_step")
      ) {
        nextStepSkippedReason = "upstream_next_step_present";
      } else if (!rawNumericTokensFidelitySafe(originalText)) {
        // D15／R2-01：扫原始数字字面量；禁止 parse 后有限＋深等冒充保真
        nextStepSkippedReason = "content_json_number_not_fidelity_safe";
      } else {
        const candidateText =
          injectNextStepPreservingNumberTokens(originalText, nextStep)
          ?? fidelitySafeStringify(parsed, nextStep);
        if (
          candidateText == null
          || !originalNumberTokensUnchanged(originalText, candidateText)
        ) {
          nextStepSkippedReason = "content_json_number_not_fidelity_safe";
        } else {
          first!.text = candidateText;
          if (structuredIsObject) {
            resultRecord.structuredContent = {
              ...(resultRecord.structuredContent as Record<string, unknown>),
              next_step: nextStep
            };
          }
          lucyNextStep = nextStep;
        }
      }
    }
  }
  ```

  > **D13／R2-02／R3**：`eligible` 失败时**不**进入注入；HTTP≥400＋JSON-RPC result 与 200＋isError 同属非成功；`upstreamHttpStatus` **必传**且禁止 `?? 200`。
  > **D15／R2-01**：优先**保留原文注入**；跳过时 `content[0].text` 必须与上游 **逐字节**相同。
  > **D3＝A／D4／F02**：单块内加键；先判定 text 能否承载 + 同名键冲突 + 原始 token 保真，再写入。**缺失 structuredContent 不是失败**。**不得**在 text 失败时仍写 `_meta`／structured。**不追加** content 块。
  > **D14／F03**：下方 `lucy` 字面量继续 `...(truncation?.repair ? { repair } : {})`，**不得**因注入 `next_step` 而删除 Spec 162 截断 `repair`。

  3.5 **把 `next_step` 放进 `lucy` 字面量内部**（关键，Spec §6 已钉死）：

  ```ts
  return {
    ...record,
    result: {
      ...resultRecord,
      _meta: {
        ...existingMeta,
        lucy: {
          contract: "lucy-r1-controlled-data-service",
          tool: toolName,
          upstreamTool: toolName === "lucy_query" ? "sl_query" : "sl_read_source",
          sources: sourceRefs,
          guardrails: { /* 既有值不动 */ },
          result: { /* 既有值不动 */ },
          ...(truncation?.repair ? { repair: truncation.repair } : {}),
          ...(lucyNextStep ? { next_step: lucyNextStep } : {}),
          ...(nextStepSkippedReason ? { next_step_skipped_reason: nextStepSkippedReason } : {}),
          ...(appliedLucyVersion(toolName, argsRecord, sourceRefs) ?? {}),
          provenance
        }
      }
    }
  };
  ```

  > **不得**写成 `resultRecord._meta.lucy.next_step = ...`：既有返回路径的 `lucy` 是全新字面量（`mcp-proxy.ts:2675-2719`），那样写会落到被丢弃的旧对象上；且上游无 `_meta` 时会 TypeError → 整个特性静默消失。

  3.6 两处调用点补参数（现行 `writeLucySemanticResponse` 内 `:2988` SSE／`:2991` JSON）。**必须传入实际** `upstream.statusCode`（先绑定为 `upstreamHttpStatus`，与 Task 2 Step 4 同一局部常量）；**禁止**省略或 `?? 200`：

  ```ts
  // writeLucySemanticResponse 内（与 classifyUpstreamFailure 同源）：
  const upstreamHttpStatus = upstream.statusCode;
  if (typeof upstreamHttpStatus !== "number" || !Number.isFinite(upstreamHttpStatus)) {
    // 无可靠 HTTP status ⇒ 本条视为非成功：visibleTools=[]，withLucyResultMeta 仍传入
    // 该非有限／缺省值会使 isEmptyResultNextStepEligible 返回 false（不得改写成 200）。
  }

  // SSE 分支（现行 :2988 附近）：
  body = JSON.stringify(withLucyResultMeta(
    payload, requestId, toolName, toolArgs, sourceRefs,
    visibleTools, originalUserFilters, scopeIntersectionEmpty,
    upstreamHttpStatus as number
  ));
  // JSON 分支（现行 :2991 附近）：
  body = JSON.stringify(withLucyResultMeta(
    JSON.parse(originalBody), requestId, toolName, toolArgs, sourceRefs,
    visibleTools, originalUserFilters, scopeIntersectionEmpty,
    upstreamHttpStatus as number
  ));
  ```

  > `scopeIntersectionEmpty` 在 `writeLucySemanticResponse` 里来自既有入参 `options.scopeIntersectionEmpty`（现行 options 形参；调用点已在传）。
  > SC-30 夹具：上游 `statusCode=500`（或其它 ≥400）+ JSON-RPC `result` + `rows:[]`，断言 JSON 与 SSE 均无 `next_step`、本功能 `allowedToolNames` spy＝0，并确认装配走了上述带 `upstreamHttpStatus` 的调用路径。

- [ ] **Step 4：跑测试确认通过**

  Run: `cd webui && npx vitest run server/__tests__/empty-result-next-step-proxy.test.ts server/__tests__/mcp-proxy-smoke.test.ts server/__tests__/query-truncation.test.ts server/__tests__/slow-call-and-empty-result.test.ts`
  Expected: PASS。

- [ ] **Step 5：跑全量 server 测试确认无回归**

  Run: `cd webui && npx vitest run server/__tests__`
  Expected: 全绿。特别确认 `mcp-proxy-*`、`denial-repair-hint`、`audit-v025-privacy` 未受影响。

- [ ] **Step 6：提交**

  ```bash
  git add webui/server/proxy/mcp-proxy.ts webui/server/__tests__/empty-result-next-step-proxy.test.ts
  git commit -m "feat(proxy): attach next_step guidance to empty lucy_query results"
  ```

### Task 4：术语登记与运行时指导

**Files:**
- Modify: `webui/docs/00-product-terminology-standard.md`（**§4.8** 表格）
- Modify: `webui/server/proxy/mcp-proxy.ts`（动态 instructions 段）

**Interfaces:**
- Consumes: Task 1 的字段名
- Produces: §4.8（MCP 调试台）表格**末尾追加三行**＋既有 `Scope Intersection Empty` 行补注；`initialize` instructions 多一行

- [ ] **Step 1：在术语标准 §4.8（MCP 调试台 / ACL 裁决可见性）登记**（须满足 Spec SC-15：含 D4「已存在承载位」与 D14 截断并存说明）

  ⚠️ **锚点说明**：该文件里 `§4.8` **重号**——`:807` 是「MCP 调试台 / ACL 裁决可见性」，`:824` 又是「访问权限升级」。本任务的目标是**第一个** §4.8，其表格**末行是 `Effective Permissions Snapshot`**——三行**追加在它之后、表格结束之前**（不是插在表格中间，那会破坏表格结构）。

  ```markdown
  | Next Step | next_step | 下一步建议 | 修复提示（作同义词）、安全边界、结论 | 成功但严格 0 行时响应附带的受控下一步指引；落在**已存在承载位**：`content[0].text` 的 JSON 对象内同名键（模型可读主落点，必选）、`structuredContent.next_step`（**仅当** `structuredContent` 已是普通对象时同步）、`_meta.lucy.next_step`（合同／审计位）。**Lucy 注入的** `next_step` 同生同灭（D4）；缺失 structured **不是**失败，不得为凑齐「三处」而新建空对象。**不得与 `Repair Hint` 混称／替代**；**例外（D14）**：成功截断路径的 `_meta.lucy.repair` 与空结果 `next_step` **允许并存**（不得删 Spec 162 截断提示）。Spec `lucy-20261107-empty-result-next-step-guidance` |
  | Empty Result | — | 空结果 | 与审计标记 `result_empty` 混为一件 | `lucy_query` 成功返回 0 行事实数据；与 `result_empty`（Spec 162 §8）同义不同层 |
  | Suggestion | — | 建议动作 | 写成对 Agent 的强制命令 | `next_step.suggestions` 的每一条，是排查方向不是指令 |
  ```

  并在**既有**行 `Scope Intersection Empty | 行范围与用户筛选无交集 | scope_intersection_empty | …` 的说明列**末尾**补一句（**不新增行**，N9）：

  ```markdown
  | Scope Intersection Empty | 行范围与用户筛选无交集 | `scope_intersection_empty` | 允许执行（混用） | 调用流水：`outcome=ok` 且裁决原因区分空交集。**第二处承载：MCP 工具响应的 `next_step.kind`（同一概念、同一机器码，跨面引用须写明承载位）** |
  ```

  > **N9 的处理**：v0.3 计划新增的 `Scope Conflict Result` /「行权限交集空」是同一事实的**第二个中文主称**，违反术语标准 §2.2「一个概念一个主术语」。本版**取消该新词**，沿用既有主术语与机器码，`next_step.kind` 取 `scope_intersection_empty`。

- [ ] **Step 2：动态 instructions 增加一行**

  在 `webui/server/proxy/mcp-proxy.ts` 的 instructions 数组中，紧跟「查询顺序」相关行之后加入：

  ```ts
  "- A successful `lucy_query` that returns zero fact rows carries a structured `next_step` inside the result JSON (and in `_meta.lucy.next_step`). Read it before retrying: it names the source, the filters you used, and the controlled next calls (`lucy_read_source`, `lucy_freshness`) to verify grain, period and filters. Do not substitute an approximation for the empty result.",
  ```

  > 只改动态 instructions（`mcp-proxy.ts` 内），**不改** `webui/config/data-qa-instructions.md`——那份是生成失败时的中性 fallback，不承载规则正文。

- [ ] **Step 3：跑术语门禁**

  Run: `npm run lint:terminology`
  Expected: `Terminology lint passed`。

- [ ] **Step 4：提交**

  ```bash
  git add webui/docs/00-product-terminology-standard.md webui/server/proxy/mcp-proxy.ts
  git commit -m "docs(terminology): register next-step guidance terms in 4.8"
  ```

### Task 5：形状证据与门禁

**Files:**
- Modify: `docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md`（状态行 + 验收证据落点）
- Modify: `docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md`（状态行）

**Interfaces:**
- Consumes: Task 1–4 的全部产物
- Produces: Spec 的 SC-01–SC-30 逐条证据落点（含 SC-29 状态镜像）

- [ ] **Step 1：用夹具上游取形状证据**

  **不发真实数据查询**（Spec 非目标）。用 Task 3 Step 1 的夹具（自建上游 + `buildProxy` + `fetch`）跑一次 `lucy_query` 0 行，把响应体存到 `inbox/`（临时件，不入库），确认三件事：

  1. `result._meta.lucy.next_step.kind == "empty_result"`；
  2. `result.content[0].text` 解析后含 `next_step`，且 `headers`/`rows`/`totalRows` 与上游原文一致；
  3. `result.structuredContent.next_step` 与 `_meta.lucy.next_step` 内容一致；
  4. **已存在承载位一致（D4）**：另跑一次「上游 text 非 JSON」的夹具，确认 Lucy 未注入任何 `next_step`、且最终响应／可观测 `_meta.lucy.next_step_skipped_reason == "content_text_not_json_object"`（与 P0-4 错误信封共存时亦须可见）；再跑一次「无 structuredContent」夹具确认 text＋meta 仍注入且不新建 structured（SC-22）。
  5. **错误路径（D13／SC-18／SC-30）**：200＋isError、500＋JSON-RPC result＋rows:[] 在 JSON／SSE 均无 `next_step` 且本功能 `allowedToolNames` 计数为 0。
  6. **保真跳过（D15／SC-25）**：精度损失／下溢／上溢三类 token → 018 跳过；与 AV 共存时最终 text 仍含原始 token（不再要求整段逐字节相等）。

  Run: `cd webui && npx vitest run server/__tests__/empty-result-next-step-proxy.test.ts`（同一夹具，断言即证据）。
  Expected: 全绿；响应快照另存 `inbox/empty-result-next-step-evidence-20261107.json`。

  > **不做**「过滤到不存在的公司简称」这类真实数据查询——那会违反 Spec 非目标与 Spec 162 §7.3。

- [ ] **Step 2：回填 Spec 验收表**

  在 Spec §7 之后追加「证据落点」一节，逐条写：断言 → 证据文件（测试文件:行号 或 实跑记录文件）。

- [ ] **Step 3：跑全部机器门禁**

  Run:
  ```bash
  npm run lint:spec-docs
  npm run lint:spec
  npm run lint:terminology
  npm run lint:ia-boundary
  ```
  Expected: 四条全绿（存量 WARN 除外）。

- [ ] **Step 4：更新状态（SC-29／F11）**

  收口时 **全部已有镜像**使用与 Spec 头部「状态」行**同一句现值**（禁止 Spec 写「功能合同已收口」、Plan 写「已执行」两套现值）。同步落点（有则必改，无则不新造）：

  1. Spec 头部「状态」
  2. 本 Plan 头部「状态」
  3. `docs/README.md` 本条索引
  4. `docs/plans/README.md` 本条索引
  5. `docs/governance/project-overview.md` §9 本条现行行（另加历史 `v1.x 更新` 留痕，不回改旧行）
  6. `docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md` REQ-030-018 条目状态
  7. `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md` P0-5／S4 跟进状态

  示例收口句（日期实填）：`**vX.Y 功能合同已收口（2026-11-XX）**。SC-01–SC-30 关闭。本条收口不表示可上线`——Spec／Plan／上述镜像**同句**。

- [ ] **Step 5：提交**

  ```bash
  git add docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md docs/README.md docs/plans/README.md docs/governance/project-overview.md docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md
  git commit -m "docs: close empty-result next-step guidance functional contract"
  ```

## 5. 验收

- **本 Plan 级验收**：Task 1–5 全部步骤完成；Spec 的 SC-01–SC-30 逐条有证据落点；四道机器门禁退出码 0；相关 vitest 全绿。
- **功能级验收**：在 Spec §7 完成，本 Plan 不重复列断言。
- **不构成发布取证**：镜像构建、部署、客户环境验收、Eval 跑批成绩均不在本条出口。

## 6. 完成定义

- `buildEmptyResultNextStep` 为纯函数，无 I/O、无副作用；纯函数单测覆盖 SC-01…SC-08／SC-17／SC-21（及 SC-03 边界）；**用例数以测试文件为准**（F12）。
- `lucy_query` 严格 0 行时：**已存在承载位**上的 Lucy `next_step` 内容一致；缺 structured 时 text＋meta 仍注入（SC-22）。
- 上游 `headers`/`rows`/`totalRows`/`sql` 在注入成功时**原始字面量**不变；无法保真（含精度损失／下溢）则 018 跳过且原始 token 仍可见（SC-25；与 AV 共存后不以整段逐字节为合同）。
- 非空结果：`_meta` 无 `next_step`；`content` 长度不变；与 AV 共存时业务字段保真，不再要求整段 text 逐字节相等（SC-11）。
- 成功截断 `repair` 与 `next_step` 可并存（SC-24）；不得删 Spec 162 截断提示。
- `next_tools` 只含 `allowedToolNames` 判可见的工具；**没有任何 `*` 通配语义**；裁决仅成功 `lucy_query` 严格 0 行触发（SC-20 计数）。
- `query.filters` 是去值摘要；行策略谓词与任何 filter 值都不出现；measures／dimensions／orderBy 白名单与真实 schema 对齐（SC-14／SC-21）。
- text 非 JSON／同名键冲突／`isError`／HTTP≥400＋JSON-RPC result／ACL 拒绝／P0-3 拒绝时 Lucy 不注入；非 JSON 时 `next_step_skipped_reason` 最终仍可见（SC-12／SC-18／SC-19／SC-23／SC-26／SC-27／SC-30）。
- AV fail-closed 不得抹掉已写入的 `next_step`／`next_step_skipped_reason`（SC-13(b)）。
- 术语标准 §4.8 已登记；动态 instructions 已加一行。
- Spec／Plan／全部已有镜像**同一句现值**（SC-29）——v0.8 共存修订后须再对齐镜像句。
- **本条收口不表示可上线。**

## 7. 风险与回滚

| 风险 | 说明 | 缓解 |
|---|---|---|
| **数据文本被重新序列化／有限数仍改值** | parse 深等假绿（精度损失／下溢） | D15／SC-25：原始 token 或保留原文注入；018 跳过时原文不变 |
| **HTTP 错误＋JSON-RPC result** | classifier 放过后误注入 | D13／SC-18／SC-30：先成功判定再权限／注入 |
| **模型可见性证据边界** | 服务端一致 ≠ 客户端已投递 | 保证止于 MCP content（F10）；不得由 `_meta` 推导「模型已收到」 |
| **截断 repair 被误删** | 旧「不得并存」口径 | D14／SC-24：并存；保留 Spec 162 `repair` |
| **指导不可见（018 富化抛错）** | 无 next_step；HTTP 200 可走 P0-4 错误信封 | SC-13(a) |
| **AV fail-closed 抹掉 018** | 错误信封替换整包 | SC-13(b)：`lucy018` 保留 next_step／skipped_reason |
| **指导不可见（富化抛错）** | 回落上游原文 | fail-safe；SC-13 |
| **回显敏感值／附加键** | filter 值或 orderBy.rows | D6／D11／SC-14／SC-21 |
| **指导越权泄漏** | 不可见 source | ACL `sourceRefs`；SC-06／SC-26 |
| **建议方向错** | 泛化建议 | D7／SC-07 |
| **行策略谓词泄漏** | 改写后 filters | D6 改写前快照 |
| **额外权限解析开销** | `allowedToolNames` | 仅成功 `lucy_query` 严格 0 行（SC-20） |
| **假绿验收** | SC-01／SC-20 旧写法 | 显式 visibleTools；spy 计数；负向 SC-26–SC-28 |
| **回滚** | —— | 去掉装配与注入即可；不改上游取值、不改审计、不删 Spec 162 `repair`、无迁移 |
