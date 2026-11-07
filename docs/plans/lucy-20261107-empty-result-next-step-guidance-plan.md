# 空结果响应的结构化下一步指导 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.4 / 2026-11-07 |
| 状态 | **v0.4，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。v0.1 经第 1 轮对抗式设计评审（6 条阻断项全部成立）修订为 v0.2；v0.2 并入横切批评审 9 条修订为 v0.3；v0.3 经**第 2 轮对抗式设计评审**（2 blocker ＋ 7 major ＋ 7 minor，经独立复核**全部成立**）修订为 v0.4。需求澄清已完成（D1／D2 委托人裁定 2026-11-07）；**D3 落点反转待委托人确认**；**未获开发授权**；本条不表示可上线 |
| 授权边界 | **不授权改代码**。本 Plan 只写清怎么改；动代码前须获得明确开工授权。Spec 见 [lucy-20261107-empty-result-next-step-guidance-spec.md](../specs/lucy-20261107-empty-result-next-step-guidance-spec.md) v0.4 |
| 验收 | 实施完成须同时满足：① Spec 的 SC-01–SC-21 逐条有证据；② `npm run lint:spec-docs` / `lint:spec` / `lint:terminology` / `lint:ia-boundary` 退出码 0；③ 相关 vitest 全绿；④ 一次**夹具上游**的 MCP `lucy_query` 0 行响应取到 `next_step` 形状证据。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 需求池 REQ-030-018；分支计划 §3.1 |
| 第 1／2 轮评审与裁定记录 | [`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)（**入库**；第 1 轮裁定、修订决定与横切批评审处理）。原始 findings 与裁定草稿在本机 `inbox/`（临时件目录，`.gitignore` 忽略、**不入库**），结论以评审记录为准 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「落盘清单」「强制流程：Plan Mode」 |

## 1. 目标

让 Agent 在 `lucy_query` 成功但 0 行时，拿到一份**结构化、ACL 内、不发明事实、模型一定看得见**的下一步指导，并让这份指导说清真实成因（普通无数据 vs 行权限交集空）。

实现口径全部以 Spec v0.4 为准，本 Plan 只负责落到具体文件、函数与测试。

**v0.2 相对 v0.1 的三处反转（务必先读）**（v0.3／v0.4 未改这三条）：

1. **落点从「追加 content 块」改为「单块内加键」**——追加块会打断 `scripts/eval/eval-runner.mjs:293-300` 的多块 JSON 解析，且其模型可见性依赖客户端渲染全部块（仓内无法验证）。详见 Spec §4 D3。
2. **`next_tools` 从授予清单改为可见清单**（`allowedToolNames`），删掉 `*` 通配语义。详见 Spec §4 D5。
3. **`query.filters` 改为「改写前的原始用户 filter + 去值摘要」**，行策略谓词一律不出现。详见 Spec §4 D6。

**v0.4 相对 v0.3 的六处反转（第 2 轮评审驱动，务必先读）**：

| # | 反转 | 触发发现 | 详见 |
|---|---|---|---|
| 1 | **三处落点改为同生同灭**——模型可见位不成立时三处都不发，只写 `next_step_skipped_reason` | N2（blocker）：v0.3 的三处伪码都是「先算再分别写」，`structuredContent` 与 `_meta.lucy` 照发 → 审计说「已下发」而模型一条没收到 | Spec §4 D4、§5.2 |
| 2 | **Spec §6 伪码重写**——`filters` 不再走 `provenance` 透传，改为独立 `filtersSummary` 入参 | N1（blocker）：v0.3 §6 的 `pick` 含 `"filters"` 且把**原始值**塞进 `provenance`，与 D6／SC-05 直接冲突 | Spec §6、Plan Task 1 |
| 3 | **`kind` 取 `scope_intersection_empty`**，summary／建议**不预设成因** | N4（major）：原措辞「该字段取值不在授权范围内」在「用户自己两条等值条件互斥」时是**假事实**（`row-policy.ts:672-676`／`:703`） | Spec §4 D7、§5.1 |
| 4 | **载荷改白名单构造**——`query` 只 6 个键，measure/dimension 对象项只保留 `expr` | N5（major）：`invalidMeasuresFieldReason` 不限制对象内其余键 → 用户可把 `rows` 塞进 measure 对象污染审计行数 | Spec §4 D11、§5.2 |
| 5 | **新增「上游自带 `next_step` 不覆盖」「`result.isError:true` 不发」两条短路** | N14／N13（minor→实质）：覆盖上游同名字段＝静默销毁数据；200 + `isError:true` 会在 outcome 判定**之前**进入富化 | Spec §4 D12／D13 |
| 6 | **可见性裁决只在 0 行路径求值**；`next_tools` 为空时 `hint` 明说「没有可用工具」 | N8／M1（major）：`degradedGlobal` 下每次响应多触发一次策略重编译；「没有可用工具」未对模型表达 | Spec §4 D5／D10、Plan Task 2 Step 4 |

## 2. 开工前置

1. **对抗式评审通过**：第 1 轮（6 条阻断项）与第 2 轮（2 blocker ＋ 7 major ＋ 7 minor）已全部修订；本 Plan v0.4 须再过一轮评审（Claude Code），阻断项清零。
2. **开发授权**：委托人明确授权改代码。未授权前只允许读文件和写文档。
3. **Spec 已立**：Spec v0.4 已落盘，D1–D13 已冻结（含评审修订的 D3–D13；**D3 的口径反转另需委托人确认**）。
4. **术语登记先行**：新术语先登记进术语标准 **§4.8**（MCP 调试台 / ACL 裁决可见性分区），再写用户可见文案。
5. **口径对齐**：不改 Spec 162 的 `result_empty` 审计语义、不改 `_meta.lucy` 既有字段取值、不改上游数据载荷的**值语义**、不追加 content 块、不新增任何真实数据查询。
6. **基线干净**：`npm run lint:spec-docs` 与相关 vitest 在开工前为绿（存量 WARN 除外）。

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
      const step = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0 });
      expect(step).not.toBeNull();
      expect(step?.kind).toBe("empty_result");
      expect(step?.summary).toBe(EMPTY_RESULT_SUMMARY);
      expect(step?.hint).toBe(EMPTY_RESULT_HINT);
    });

    it("SC-02 有数据时不带指导", () => {
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 3 })).toBeNull();
    });

    it("SC-03 行数未知时不判空", () => {
      expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: null })).toBeNull();
      expect(buildEmptyResultNextStep({ toolName: "lucy_query" })).toBeNull();
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
      const step = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0 });
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

    it("SC-21 measures/dimensions 对象项只保留 expr", () => {
      const step = buildEmptyResultNextStep({
        toolName: "lucy_query",
        rowCount: 0,
        provenance: {
          measures: [{ expr: "sum(revenue)", rows: 999 }],
          dimensions: ["month"]
        }
      });
      expect(step?.query?.measures).toEqual([{ expr: "sum(revenue)" }]);
      expect(step?.query?.dimensions).toEqual(["month"]);
      // N5：载荷内不得出现 rows/totalRows/columns/headers
      const payload = JSON.stringify(step);
      for (const banned of ["\"rows\"", "\"totalRows\"", "\"columns\"", "\"headers\""]) {
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
   * 空结果下一步指导（Spec 20261107 v0.4 §5.1 / D1–D13）。
   *
   * 只复用响应链路上**已经解析出**的事实。不断言 grain / 数据可用周期 /
   * 指标清单——代理在响应链路上拿不到这些事实，断言即编造。指导是 fail-open
   * 的建议层，不是授权，也不是结论。
   *
   * `filters` 只能经 `filtersSummary`（已去值）进入：原始 filter 值在结构上
   * 就到不了这里。
   */
  export type NextStep = {
    kind: "empty_result" | "scope_intersection_empty";   // N9：沿用既有机器码与主术语
    summary: string;
    query?: Record<string, unknown>;
    suggestions: string[];
    next_tools: string[];
    hint: string;
  };

  export const EMPTY_RESULT_SUMMARY = "本次查询返回 0 行事实数据。";
  // N4：不预设成因——「用户自己两条等值条件互斥」时不能说「取值不在授权范围内」。
  export const SCOPE_SUMMARY = "本次查询返回 0 行：当前的等值过滤与该角色的行权限范围没有交集，或同一字段的多个等值条件互相矛盾。";
  export const EMPTY_RESULT_HINT = "在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。";
  export const NO_TOOL_HINT = "当前角色没有可用的核对工具（next_tools 为空），以上建议只能人工核对；在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。";
  export const RELAX_FILTER_SUGGESTION = "放宽过滤条件（公司 / 产品线 / 时间范围）后重查";
  export const SCOPE_SUGGESTION = "移除或调整与行权限范围冲突的等值过滤条件，或检查同一字段的多个等值条件是否互相矛盾";
  export const CHECK_PERIOD_SUGGESTION = "确认目标期间落在该 source 的数据可用周期内";
  export const CHECK_GRAIN_SUGGESTION = "确认问题的时间粒度与该 source 的粒度一致";
  export const NEXT_STEP_TOOLS = ["lucy_read_source", "lucy_freshness"] as const;

  // D11 载荷白名单：query 顶层只允许这些键；measure/dimension 对象项只保留 expr。
  const NEXT_STEP_SCALAR_KEYS = ["connectionId", "sourceName", "orderBy"] as const;

  function shapeStringOrExprList(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item === "string") { out.push(item); continue; }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const expr = (item as Record<string, unknown>).expr;
        if (typeof expr === "string" && expr.length > 0) out.push({ expr });
      }
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
    // 未知行数不是空结果的证据（沿用 isEmptyResult 口径）。
    if (typeof input.rowCount !== "number" || input.rowCount > 0) return null;

    const scopeConflict = input.scopeIntersectionEmpty === true;
    const provenance = input.provenance ?? {};
    // D11：白名单构造——不透传 provenance 的任意键，用户自定义键进不来。
    const query: Record<string, unknown> = {};
    for (const key of NEXT_STEP_SCALAR_KEYS) {
      const value = provenance[key];
      if (value === undefined || value === null) continue;
      query[key] = value;
    }
    const measures = shapeStringOrExprList(provenance.measures);
    if (measures) query.measures = measures;
    const dimensions = shapeStringOrExprList(provenance.dimensions);
    if (dimensions) query.dimensions = dimensions;
    // filters 只认独立入参的**去值摘要**；provenance.filters 一律不采纳。
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
  Expected: PASS —— 9 条全绿。

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

- [ ] **Step 4：取调用者可见工具（只在 0 行路径求值）**

  在 `writeLucySemanticResponse` 内、构造 `body` 之前：

  ```ts
  // Spec 20261107 D5 —— next_tools 只列该调用者**可见**的工具。可见性裁决只有
  // allowedToolNames 一处（acl.ts:2397）：它展开 `*`、剔 deny、要求 DataPlane
  // capability、并在 degradedGlobal 下隐藏。permissions.tools 只是授予清单。
  //
  // N8：allowedToolNames → ensurePolicyRuntime()；degradedGlobal 下每次调用都会
  // 重新 commitEffectivePolicy()（acl.ts:2897-2901）。所以**只在 0 行路径求值**，
  // 有数据 / 非 lucy_query 的响应一次都不触发。
  const rowCount = lucyQueryRowCountOf(payload);          // 纯函数：取上游 result 子树的 rows.length
  const visibleTools = rowCount === 0
    ? await allowedToolNames(identity).catch(() => [] as string[])
    : [] as string[];
  ```

  > `allowedToolNames` 已在 `mcp-proxy.ts:35` import，无需加 import。
  > `lucyQueryRowCountOf` 是**纯函数**：对上游 `result` 子树取 `rows.length`（与 `inspectRowsAndColumns` 同口径，`mcp-proxy.ts:861-862`）；取不到返回 `null`（未知行数 → 不是 0 行 → 不触发可见性裁决）。
  > 行数判定与装配内 `inspectRowsAndColumns` 的结果必须一致；装配内**复用**同一份判定结果，不得二次解析出两个口径。

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

  it("SC-11 非空结果响应逐字节不变", async () => {
    // 同样夹具但上游 rows 非空（[["2902"]]）：
    expect(parsed.result.content[0]?.text).toBe(upstreamText);            // 逐字节
    expect(parsed.result.structuredContent).toEqual(upstreamStructured);  // 逐字节
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result.content?.length).toBe(1);                          // 不追加块
  });

  it("SC-12 text 不是 JSON 对象时三处都不发 next_step", async () => {
    // 上游 content[0].text 为 "plain text"（非 JSON）：
    expect(parsed.result.content[0]?.text).toBe("plain text");
    expect(parsed.result.structuredContent?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("content_text_not_json_object");
  });

  it("SC-18 上游 result.isError=true 时三处都不发", async () => {
    // 上游 200 + result.isError:true：
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("result_is_error");
  });

  it("SC-19 上游已带 next_step 键时不覆盖", async () => {
    // 上游 content[0].text 内已有 next_step: { upstream: true }：
    expect(JSON.parse(parsed.result.content[0]?.text ?? "").next_step).toEqual({ upstream: true });
    expect(parsed.result._meta?.lucy?.next_step).toBeUndefined();
    expect(parsed.result._meta?.lucy?.next_step_skipped_reason).toBe("upstream_next_step_present");
  });

  it("SC-20 有数据时不触发可见性裁决", async () => {
    // 上游 rows 非空：spy 住 allowedToolNames 或断言其未被 await——
    // 断言口径：响应里没有 next_step，且没有触发额外的策略重编译（本条只断言前者，
    // 后者靠 acl 层既有计数断言，不在本文件重复）。
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
  > SC-13（富化抛错回落上游原文）与 SC-14（审计行数不被污染）在同文件补断言：SC-14 断言审计行的 `response_row_count` 为 `0`，且**额外**断言载荷内不含 `rows`/`totalRows`/`columns`/`headers` 键（用 `JSON.stringify(next_step)` 做子串断言）。

- [ ] **Step 2：跑测试确认失败**

  Run: `cd webui && npx vitest run server/__tests__/empty-result-next-step-proxy.test.ts`
  Expected: FAIL —— `result._meta.lucy.next_step` 不存在。

- [ ] **Step 3：实现装配**

  3.1 在 `mcp-proxy.ts` 的 import 区加入（若尚未导入）：

  ```ts
  import { buildEmptyResultNextStep, type NextStep } from "./question-experience.js";
  import { summarizeFilters } from "./audit-privacy.js";
  ```

  3.2 改 `withLucyResultMeta` 签名，增加三个入参：

  ```ts
  function withLucyResultMeta(
    payload: unknown,
    requestId: string | number,
    toolName: string,
    args: unknown,
    sourceRefs: SourceRef[],
    visibleTools: readonly string[],
    originalUserFilters: unknown,
    scopeIntersectionEmpty: boolean
  ): unknown {
  ```

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

  3.4 构造并注入 `next_step`（**三处同生同灭**，D4）：

  ```ts
  const nextStep = buildEmptyResultNextStep({
    toolName,
    rowCount: inspectedResult.rows ?? null,
    scopeIntersectionEmpty,
    provenance: withoutFilters(provenance),          // 不含 filters（N1）
    filtersSummary: originalUserFilters === undefined ? null : summarizeFilters(originalUserFilters),
    visibleTools
  });

  let lucyNextStep: NextStep | undefined;            // 只有模型可见位注入成功才赋值
  let nextStepSkippedReason: string | undefined;
  if (nextStep) {
    if (resultRecord.isError === true) {
      nextStepSkippedReason = "result_is_error";     // D13：200 + isError 不发
    } else {
      const content = Array.isArray(resultRecord.content) ? resultRecord.content : [];
      const first = content[0] as { type?: string; text?: string } | undefined;
      let parsed: Record<string, unknown> | undefined;
      if (first && typeof first.text === "string") {
        try {
          const maybe = JSON.parse(first.text) as unknown;
          if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) parsed = maybe as Record<string, unknown>;
        } catch { parsed = undefined; }
      }
      if (!parsed) {
        nextStepSkippedReason = first && typeof first.text === "string"
          ? "content_text_not_json_object"
          : "content_text_absent";
      } else if (Object.prototype.hasOwnProperty.call(parsed, "next_step")) {
        nextStepSkippedReason = "upstream_next_step_present";   // D12：不覆盖上游同名字段
      } else {
        // 1) 模型可见位：data text 的 JSON 对象内加键
        first!.text = JSON.stringify({ ...parsed, next_step: nextStep });
        // 2) 结构化位
        if (resultRecord.structuredContent && typeof resultRecord.structuredContent === "object" && !Array.isArray(resultRecord.structuredContent)) {
          resultRecord.structuredContent = { ...(resultRecord.structuredContent as Record<string, unknown>), next_step: nextStep };
        }
        // 3) 合同位：与前两处**同生同灭**
        lucyNextStep = nextStep;
      }
    }
  }
  ```

  > **D4 的实现要点**：三处不是「各自判断、各自发」，而是**先判定模型可见位能不能承载，再一次性把同一个对象写进三处**。写成「text 不可注入就跳过 text、但 structuredContent 与 `_meta.lucy` 照发」＝ 审计说「已下发」而模型一条没收到，正是 D3 不变式要防的静默消失（第 2 轮 N2 blocker）。

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

  3.6 两处调用点补参数：

  ```ts
  body = JSON.stringify(withLucyResultMeta(payload, requestId, toolName, toolArgs, sourceRefs, visibleTools, originalUserFilters, scopeIntersectionEmpty));
  ...
  body = JSON.stringify(withLucyResultMeta(JSON.parse(originalBody), requestId, toolName, toolArgs, sourceRefs, visibleTools, originalUserFilters, scopeIntersectionEmpty));
  ```

  > `scopeIntersectionEmpty` 在 `writeLucySemanticResponse` 里来自既有入参 `options.scopeIntersectionEmpty`（现行 `:2842`，调用点 `:6006` 已在传）。

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

- [ ] **Step 1：在术语标准 §4.8（MCP 调试台 / ACL 裁决可见性）登记**

  ⚠️ **锚点说明**：该文件里 `§4.8` **重号**——`:807` 是「MCP 调试台 / ACL 裁决可见性」，`:824` 又是「访问权限升级」。本任务的目标是**第一个** §4.8，其表格**末行是 `Effective Permissions Snapshot`**——三行**追加在它之后、表格结束之前**（不是插在表格中间，那会破坏表格结构）。

  ```markdown
  | Next Step | next_step | 下一步建议 | 修复提示（作同义词）、安全边界、结论 | 成功但 0 行时响应附带的受控下一步指引；落在**三处**——`content[0].text` 的 JSON 对象内同名键（模型可见，主落位）、`structuredContent.next_step`（结构化位）、`_meta.lucy.next_step`（合同／审计位）；三处**同生同灭**；**不得与 `Repair Hint` 混用**（成功路径 vs 失败路径）。Spec `lucy-20261107-empty-result-next-step-guidance` |
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
- Produces: Spec 的 SC-01–SC-21 逐条证据落点

- [ ] **Step 1：用夹具上游取形状证据**

  **不发真实数据查询**（Spec 非目标）。用 Task 3 Step 1 的夹具（自建上游 + `buildProxy` + `fetch`）跑一次 `lucy_query` 0 行，把响应体存到 `inbox/`（临时件，不入库），确认三件事：

  1. `result._meta.lucy.next_step.kind == "empty_result"`；
  2. `result.content[0].text` 解析后含 `next_step`，且 `headers`/`rows`/`totalRows` 与上游原文一致；
  3. `result.structuredContent.next_step` 与 `_meta.lucy.next_step` 内容一致；
  4. **三处同生同灭**：另跑一次「上游 text 非 JSON」的夹具，确认三处都没有 `next_step`、且 `_meta.lucy.next_step_skipped_reason == "content_text_not_json_object"`（D4）。

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

- [ ] **Step 4：更新状态**

  Spec 状态行改为 `**v0.4 功能合同已收口（2026-11-XX）**。SC-01–SC-21 关闭。本条收口不表示可上线`，本 Plan 状态行改为 `**已执行（2026-11-XX）**`，并同步 `docs/README.md` 与 `docs/plans/README.md` 的索引行。

- [ ] **Step 5：提交**

  ```bash
  git add docs/specs/lucy-20261107-empty-result-next-step-guidance-spec.md docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md docs/README.md docs/plans/README.md
  git commit -m "docs: close empty-result next-step guidance functional contract"
  ```

## 5. 验收

- **本 Plan 级验收**：Task 1–5 全部步骤完成；Spec 的 SC-01–SC-21 逐条有证据落点；四道机器门禁退出码 0；相关 vitest 全绿。
- **功能级验收**：在 Spec §7 完成，本 Plan 不重复列断言。
- **不构成发布取证**：镜像构建、部署、客户环境验收、Eval 跑批成绩均不在本条出口。

## 6. 完成定义

- `buildEmptyResultNextStep` 为纯函数，无 I/O、无副作用，9 条单测覆盖 SC-01–SC-08。
- `lucy_query` 0 行响应的**三个落点**内容一致；上游 `headers`/`rows`/`totalRows` 取值不变。
- 非空结果响应**逐字节不变**；`content` 数组**长度不变**（不追加块）。
- `next_tools` 只含 `allowedToolNames` 判可见的工具；**没有任何 `*` 通配语义**。
- `query.filters` 是去值摘要；**行策略谓词与任何 filter 值都不出现**。
- `scopeIntersectionEmpty` 时 `kind` 与 `suggestions` 分流正确。
- text 非 JSON 对象时三处都不出现 `next_step`，且 `_meta.lucy.next_step_skipped_reason` 有值。
- 术语标准 §4.8 已登记四行；动态 instructions 已加一行。
- Spec 状态行与 Plan 状态行按 `docs/governance/DEVELOPMENT.md`「功能闭口与发布取证」同步；索引行同步。
- **本条收口不表示可上线。**

## 7. 风险与回滚

| 风险 | 说明 | 缓解 |
|---|---|---|
| **数据文本被重新序列化** | `content[0].text` 走 parse → 加键 → stringify，键序保留、值语义不变，但字符串规范化 | SC-09 / SC-11 断言取值一致；非空响应逐字节不变；不改上游取值 |
| **模型可见性仍可能落空** | 极少数客户端只渲染 `structuredContent` 或只读首个块 | 单块内加键使模型与数据同处一段文本；`structuredContent` 同步；`_meta.lucy` 兜底 |
| **指导不可见（富化抛错）** | 富化异常时整体回落上游原文 | fail-safe；SC-13 固化；审计可查 |
| **回显请求面带出敏感值** | filter 值若回显会带出敏感值 | D6 去值摘要（复用 `audit-privacy`）；原始值在结构上进不了 `next_step` |
| **指导越权泄漏** | 带出角色不可见的 source | 候选只来自 ACL 已解析的 `sourceRefs`；`next_tools` 按 `allowedToolNames` 过滤 |
| **建议方向错** | 泛化建议把 Agent 引向无关方向 | D7 按 `scopeIntersectionEmpty` 分流 |
| **行策略谓词泄漏进模型可见位** | `provenance.filters` 含策略谓词 | D6 用改写前的原始 filter；策略谓词完全不进 `next_step` |
| **额外权限解析开销** | 每次 0 行多一次 `allowedToolNames` | 走同一策略运行时（有缓存），且只在 0 行冷路径触发 |
| **回滚** | —— | 去掉 `withLucyResultMeta` 里的 `next_step` 装配与三处注入即可；不改上游取值、不改审计字段、无数据迁移 |
