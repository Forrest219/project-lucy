# 空结果响应的结构化下一步指导 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec／**v0.8** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 功能编号 / 优先级 | **无**（挂在 `0.30` 需求池 **REQ-030-018**）/ **P0**（清单 **P0-5**；Agent 拿到空结果后的下一步可操作性）——与清单池 P0-5、需求池 REQ-030-018 的 **P0** 同口径 |
| 台账号 | **无**。`0.30` 台账尚未建立；待 PM 指派台账号后再登记 |
| 状态 | **v0.8；R2-F＋R4 已闭合（2026-11-09）**。实现已落地；独立复审 **Approve with nits**（与 P0-4 共存合同已齐）；SC-01–SC-30 证据关闭（2026-11-13，见 [证据审计](../reviews/2026-11-13-empty-result-next-step-sc-evidence-audit.md)）。**功能合同已收口**。本条收口不表示可上线 |
| 决策来源 | The New Stack《Why MCP servers should tell agents what to do next》（Matthew Burns 记 AWS James Ward，2026-11-07）主张「工具响应要带下一步指导」 |
| 需求来源 | [`docs/plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.1 差距 G1；需求池 REQ-030-018 |
| 实施主体 | Lucy MCP Proxy（`webui/server/proxy/`）。不改 KTX 源码，不改上游语义层 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **复用，不另造合同。** 修复提示的可用性闭环（B15 五项校验）沿用 Spec 162 §7.3；`result._meta.lucy` 富化合同沿用 Spec 162 §7.5 已在用的位置；空结果审计语义（`result_empty`）沿用 Spec 162 §8 不改；成功截断 `repair`（`TRUNCATION_REPAIR_HINT`）沿用 Spec 162 §7.5／`resolveResponseTruncated` **不得删除**；filter 去值纪律沿用 `webui/server/proxy/audit-privacy.ts` §「filters 先做结构化摘要（去值）」。**本条不修订** Spec 162 的任何既有取值 |
| 0.30 批次横向评审记录 | [`docs/reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md`](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（0.30 全部 35 份文档的第 1 轮：形式合规 ＋ 事实性核验；本条在 c9 块的 11 条已成立并修订） |
| 第 1 轮评审与裁定记录 | [`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)（**入库**；含第 1 轮 6 条阻断项的裁定、修订决定与横切批评审处理）。第 1 轮原始 findings 与裁定草稿落在本机 `inbox/`（临时件目录，`.gitignore` 忽略、**不入库**），结论以评审记录为准 |
| Codex 对抗评审 | [`docs/reviews/2026-11-09-empty-result-next-step-codex-review.md`](../reviews/2026-11-09-empty-result-next-step-codex-review.md)（**R2-F＋R4 已闭合 2026-11-09**） |
| 实施计划 | [`docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md`](../plans/lucy-20261107-empty-result-next-step-guidance-plan.md) **v0.8-draft** |

## 闭口层级

- 层级：功能合同
- 本条承诺：Agent 调用 `lucy_query` 成功但返回 0 行事实数据时，响应里带一份**结构化、只含该调用者 ACL 内对象**的下一步指导，并写入**模型可读的 MCP content 承载位**（见 §4 D4／§5.2），使 Agent 知道下一步该走哪条受控路径，而不是只拿到一个裸空结果。
- 本条出口：SC-01–SC-30。纯函数单测（指导构造、可见性口径、字段形状、严格零判定）；Proxy 层单测（已存在承载位一致注入、`_meta.lucy.next_step`、截断 `repair` 并存、**原始 token 数值保真**跳过、统一成功判定／错误路径、ACL／拒绝负向）；一次夹具上游的 MCP `tools/call` 0 行响应取形状证据；`lint:spec-docs` 通过。
- 不在本条出口：浏览器走查签字、Playwright、移动窄屏、镜像构建、部署、客户环境验收、Eval 跑批成绩、客户原始问句、真实数据查询（不得为验证提示盲发真实数据查询）、上游 KTX 行为变更、certified route / report template 路径的指导、**客户端最终是否把 content 交给模型**（仓内无法证明，见 §5.4）。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Next Step：协议字段名 `next_step`，中文主称「下一步建议」。指一次工具响应附带的**受控下一步指引**，只描述可走的路径，不构成授权，也不是结论。落在**已存在的承载位**：`result.content[0].text` 的 JSON 对象内同名键（模型可读主落点，必选）、`result.structuredContent.next_step`（仅当 `structuredContent` 已是普通对象时）、`result._meta.lucy.next_step`（合同／审计位）。**Lucy 注入的** `next_step` 同生同灭（见 §4 D4）；不得把「响应本来没有某承载位」写成「Lucy 未注入」。
- Empty Result：中文主称「空结果」。指 `lucy_query` 在本条 **统一成功判定**（§4 D13）下返回且行数严格等于 0。与既有审计标记 `result_empty`（Spec 162 §8）同义但不同层：`result_empty` 是审计事实，`next_step` 是面向 Agent 的建议。
- Suggestion：协议内 `next_step.suggestions` 数组，中文主称「建议动作」。每条是一条可执行的排查方向，不是命令，不构成对 Agent 的强制约束。
- **行范围与用户筛选无交集（既有主术语，本条不新造）**：空结果的一个**子类**，成因是行权限 OR 臂与用户等值过滤逐臂不相交。中文主称沿用术语标准 **§4.8 既有的 `Scope Intersection Empty` / 「行范围与用户筛选无交集」**，机器码沿用既有 `scope_intersection_empty`（与审计 `decision_reason` 同码），`next_step.kind` 取 **`scope_intersection_empty`**。**本条不新增第二个中文主称**（第 2 轮评审 N9）。

Forbidden:

- 把「下一步建议」写成安全边界或授权凭据——它是 fail-open 的建议层，裁决始终在 Proxy + ACL。
- 把「下一步建议」写成对 Agent 的强制指令或门闩——本条只提示，不阻断。
- 把 `next_step` 写成结论——空结果不等于「数据错误」，建议不得替 Agent 下结论。
- **把 `Next Step` 与 `Repair Hint` 混称或互相替代**：`Repair Hint`（Spec 162 §7.3）主要指**失败**路径的修复提示形状；`Next Step` 指**成功且严格 0 行**的引导。二者语义不得互换。**例外（D14）**：Spec 162 成功截断路径的 `_meta.lucy.repair`（`TRUNCATION_REPAIR_HINT`）**不是失败路径 Repair Hint 合同的替代物**，也**不得因本条而删除**；当同一成功响应同时满足「严格 0 行」与「截断」时，`repair` 与 `next_step` **允许并存**（不同键、不同合同）。
- 把行权限谓词、强制过滤表达式或任何角色不可见的对象写进 `next_step`。
- 把 `next_step` 追加为独立的 content 块（见 §3 非目标）。
- 把「行范围与用户筛选无交集」写成第二个中文主称（如「行权限交集空」）——沿用既有主术语与机器码（见 §4 D7）。
- 把 `next_step` 的**载荷**说成「回显请求参数」——载荷只由 §5.2 的白名单键构成，用户自定义键一律不出现。
- 把「服务端三处／已存在承载位一致」说成「模型一定收到」——可验收保证止于**模型可读的 MCP content 承载位已写入**；客户端最终投递属推断（见 §5.4）。

落位：本条术语属 **MCP 协议／可见性**面，落术语标准 **§4.8（MCP 调试台 / ACL 裁决可见性）**，不落 §4.7（访问日志页面分区），也不落 §3（UI 主术语表——`next_step` 不是 UI 文案）。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`（修复提示可用性闭环 §7.3；`_meta.lucy` 富化形状 §7.5；成功截断 `repair`）
- `webui/docs/07-mcp-auth-proxy-spec.md`（Proxy 协议与角色化 instructions）

### What This Change Follows

- [ ] 本条**无 WebUI 界面变更**：不改页面、不加组件、不改文案样式。
- [ ] 协议字段命名沿用既有 `_meta.lucy` 命名空间（`contract` / `tool` / `result` / `provenance` / `repair`），不新造顶层键。
- [ ] 建议文案用中文，与既有修复提示（`TRUNCATION_REPAIR_HINT` 等）同风格；工具名与 source 名保持 `translate="no"` 语义。
- [ ] 不引入新的用户可见错误码或状态枚举。

### Exceptions (If Any)

- 无。本条不触碰任何 WebUI 设计面。

### Follow-up Needed

- 若后续把 `next_step` 呈现在审计「调用链故事线」或 MCP 调试台，需另立 Spec 并补 Design System 合规；本条只在协议层落位。

---

## 1. 背景

外部文章的核心主张：MCP 服务器不该只回数据，还要告诉 Agent **下一步该走哪条受控路径**；并用整段问询旅程做 Eval 反哺工具面。

对照 Lucy 现行实现，分成两半：

**已经有的是「失败路径的修复提示」与「成功截断的 repair」**：

| 失败／截断形状 | 提示落点 | 证据 |
|---|---|---|
| 权限拒绝 | `result.content[0].text` 的结构化 JSON（`reason` / `failureDimension` / `connections` / `sources`） | `webui/server/proxy/mcp-proxy.ts:4017-4065` |
| 过滤条件下推 | `result.content[0].text` 纯文本 hint | `webui/server/proxy/mcp-proxy.ts:2892-2937` |
| 结果截断（**成功路径**） | `result._meta.lucy.repair`（**仅此一处**；Spec 162 合同，本条不删） | `webui/server/proxy/mcp-proxy.ts:2699`、`webui/server/proxy/question-experience.ts:1039-1059` |

**没有的是「成功但严格 0 行」**：此时响应是一个裸空结果，Agent 拿到的只有 `rows: []`，没有任何指示。

| 事实 | 证据 |
|---|---|
| `result_empty` 只写审计，不进响应 | `webui/server/proxy/question-experience.ts:1000-1007`（`isEmptyResult` 要求 `responseRowCount === 0`）、`webui/server/proxy/mcp-proxy.ts:3027`（写审计）、`webui/server/proxy/audit.ts:1782`（计数） |
| 合同口径：只记 `result_empty=1` | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:329` |
| 运行时指导反而要求区分三类缺失 | `webui/config/data-qa-instructions.md:40`（无记录 / 字段为空 / 可推算） |

也就是说：**最常见的「查得到、查不出数」路径上，工具一个字都不说**，而 Agent 面对它只能猜——换 filter？换 period？换 source？猜错就变成一轮无意义的循环查询，正好是文章批评的 scenic route。

同时有一条容易被忽略的事实：**截断修复提示（`TRUNCATION_REPAIR_HINT`）至今只写在 `_meta.lucy.repair`，从未进入模型可见的 `content`**（`webui/server/proxy/mcp-proxy.ts:2699` 是唯一落点）。MCP 客户端把 `result.content` 呈现给模型，`_meta` 通常不透出。也就是说，Lucy 现有的成功截断「修复提示」在成功路径上**是给运维看的，不是给 Agent 看的**——本条不把它升级为模型可见，也不删除它。

## 2. 目标

1. `lucy_query` 成功且行数**严格等于 0** 时，响应带一份结构化下一步指导：本次查了什么、下一步能查什么、能用什么工具。
2. 指导写入**模型可读的 MCP content 承载位**（`content[0].text` JSON 内键）；不依赖「客户端是否渲染全部 content 块」或「是否透出 `_meta`」。
3. 指导内容**只含该调用者可见的对象**，且**不发明事实**——只复用响应链路上已经解析出的事实（ACL 已解析的 source 引用、请求自身的 provenance、调用者的可见工具清单）。
4. 指导**说清真实成因**——「行权限交集空」与「普通无数据」给不同的 `kind` 与不同的建议，不让 Agent 往错的方向试。
5. **只提示不阻断**：空结果不拒绝任何后续调用，不改变问询预算语义，不改 ACL 裁决。
6. 复用既有合同，不新造：`_meta.lucy` 命名空间、`provenance` 的有界收敛、`audit-privacy` 的 filter 去值纪律、`sourceRefs` 的 ACL 解析、`isEmptyResult` 的**严格零**判定口径、`allowedToolNames` 的可见性裁决；**不破坏** Spec 162 成功截断 `repair`。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| **把 `next_step` 追加为独立的 content 块** | 会打断仓库内唯一的多块 JSON 消费方：`scripts/eval/eval-runner.mjs:293-300` 把所有 text 块用 `'\n'` 拼接后再 `JSON.parse`，多块必然解析失败 → 结果断言全部落空；且追加块的模型可见性依赖客户端渲染全部块，仓内无法验证 |
| 改变上游数据载荷的**值语义** | 本条允许在 `content[0].text` 的 JSON 对象内**增加一个兄弟键**，但不改 `headers` / `rows` / `totalRows` / `sql` 的任何取值；若无法保真则**整段跳过指导**（D15） |
| 给空结果做门闩（拒绝后续调用） | 与「部分可回答仍须交付」冲突；且指导是 fail-open 建议层 |
| 断言 grain / 数据可用周期 / 指标清单 | Proxy 在响应链路上拿不到这些事实，断言即编造；本条只指向 `lucy_read_source`／`lucy_freshness` 去取 |
| 区分「无记录 / 字段为空 / 可推算」 | 空结果时没有行，工具无从区分这三类；这是回答质量规范的要求，不是工具侧能给的 |
| 覆盖 `lucy_read_source` / `entity_details` / `sl_validate` 的空返回 | 本条只覆盖 `lucy_query` 的严格 0 行事实数据；其余工具的空返回语义不同（SC-20／SC-04） |
| 覆盖 `lucy_certified_route` / `lucy_report_template` | 这两条路径内部执行查询但**绕过** `withLucyResultMeta`（`webui/server/proxy/mcp-proxy.ts:3761-3998`），本条不覆盖，见 §5.3 |
| 为验证提示发送真实数据查询 | 沿用 Spec 162 §7.3 的硬约束 |
| 改 `result_empty` 审计语义 | 审计口径归 Spec 162，本条只加响应字段 |
| 删除或改写 Spec 162 成功截断 `repair` | D14；不得 silently 删 Spec 162 截断提示 |
| 自动升工具面 / 改 skill | 归 REQ-030-021，本条不碰 |
| 证明「客户端最终把 content 交给了模型」 | 仓内无法验证；保证止于 MCP content 承载位（F10） |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | 指导以**结构化字段**承载：`next_step` 对象（`kind` / `summary` / `query` / `suggestions` / `next_tools` / `hint`） | 委托人裁定 2026-11-07。不落自由文本，模型可按字段枚举决策 |
| D2 | **只提示不阻断**：空结果不拒绝任何后续调用，不改问询预算 | 委托人裁定 2026-11-07。门闩会与「部分可回答仍须交付」冲突 |
| **D3** | **落点＝单块内加键（选项 A）**：在 `content[0].text` 的 JSON 对象内增加同名键 `next_step`；`structuredContent` 已是普通对象时同步加键；`_meta.lucy.next_step` 同步给出（审计位）。**不追加**独立 content 块。这是对原「不改写上游 `content[0].text`」口径的反转 | **委托人 2026-11-09 确认选项 A**。已迁入本表；**不得**再标未决或写「待委托人确认 D3」 |
| **D4** | **已存在承载位一致（同生同灭）**：① 模型可读主落点 `content[0].text` 必须是可注入的 JSON 对象，否则 **Lucy 不注入任何** `next_step`，只写 `_meta.lucy.next_step_skipped_reason`；② 注入前若 **任一已存在承载位**已有同名键 `next_step`（text 或已是对象的 `structuredContent`），**全部跳过**（D12），不覆盖任何一侧；③ 注入成功时：**必写** text 与 `_meta.lucy.next_step`；**仅当** `structuredContent` 已是普通对象时才写该处——**缺失 `structuredContent` 不是失败**，不得为「凑齐三处」而新建空对象；④ 「三处都没有」＝响应中**不存在 Lucy 注入的** `next_step`（区分「承载位本不存在」与「Lucy 未注入」） | **Codex R1 F02**：原「严格三处」与合法「仅有 text、无 structuredContent」响应冲突；伪码也会在 structured 已有键时覆盖原值。收紧为**已存在承载位一致** |
| **D5** | `next_tools` 只列**该调用者可见**的工具，用 `allowedToolNames(identity)` 的结果 | **第 1 轮评审修订**：原用 `permissions.tools`（授予清单）——`allowedToolNames` 才做可见性裁决（`*` 展开 `knownTools`、剔 deny、DataPlane 要求 capability、`degradedGlobal` 隐藏），`webui/server/proxy/acl.ts:2397-2431`。**第 2 轮／R1 F07／R2-02**：该裁决**只在统一成功判定（D13）通过且 `lucy_query` 严格 0 行之后**求值；**禁止**先求可见工具再补 `isError`／HTTP 门禁 |
| **D6** | `query.filters` 只回显**改写前的原始用户 filter**，且按 `audit-privacy` 口径**去值**（`kind` / `field` / `op` / `valueCount`）；**行策略谓词一律不出现** | **第 1 轮评审修订**。**第 2 轮评审追加**：载荷必须走**白名单构造**而非透传，见 D11 |
| **D7** | 用 `scopeIntersectionEmpty`（**发查询前**已算出）分流 `kind`：取 **`scope_intersection_empty`**（与审计 `decision_reason` 同码、同主术语「行范围与用户筛选无交集」）；summary 与建议**不预设成因** | **第 1／2 轮评审修订**：summary 与建议改为中性表述（见 §5.1） |
| D8 | 空结果判定复用 `isEmptyResult` 口径：**仅** `typeof rowCount === "number" && Number.isFinite(rowCount) && rowCount === 0`；负数／NaN／±Infinity／非数字 **≠** 空结果 | 「未知行数不是空结果的证据」已写在 `webui/server/__tests__/slow-call-and-empty-result.test.ts:60-66`；`isEmptyResult` 要求 `responseRowCount === 0`（`question-experience.ts:1005-1006`）。**Codex R1 F09**：禁止 `rowCount > 0` 假对称（会把 `-1` 当空结果） |
| D9 | 候选与提示**只复用响应链路上已有事实**：ACL 已解析的 `sourceRefs` + 请求自身 provenance；**不断言** grain／可用周期／指标清单 | 不发明事实是可用性闭环 B15 的同一原则 |
| D10 | `next_tools` 为空**不降级** `suggestions`；但 `hint` **必须**表达「当前角色没有可用的核对工具」 | **第 1／2 轮评审修订** |
| **D11** | **载荷白名单（与真实 schema 对齐）**：`query` 顶层只允许 `connectionId` / `sourceName` / `orderBy` / `measures` / `dimensions` / `filters`。分类型收敛：① **measures**：字符串项原样；对象项**只保留**非空字符串 `expr`（丢弃 `rows`／`name`／其它键）；无合法 `expr` 的对象整项丢弃。② **dimensions**：只接受普通对象；**只保留**非空字符串 `field`，以及可选的字符串 `granularity`；无 `field` 的项整项丢弃（对齐 `semanticQueryInputProperties`／`mcp-proxy.ts:1000-1008`，dimensions **不是** string-or-expr）。③ **orderBy**／`order_by` 同源：数组项只构造 `field`（必选）与可选 `direction`（仅 `asc`\|`desc`）；**丢弃**其它附加键（对齐 `:1010-1018`／`:1487-1499`——形状校验不拦附加键，故必须在白名单构造时剥掉，否则违反 SC-14） | **第 2 轮 D11 ＋ Codex R1 F04／F05** |
| **D12** | **任一已存在承载位已带 `next_step` 键时不覆盖**：拒绝注入，记 `next_step_skipped_reason="upstream_next_step_present"`；上游 text／structured 取值不变 | **第 2 轮 ＋ R1 F02**：含「仅 structured 有键、text 无键」 |
| **D13** | **统一成功判定（先判定，再权限／注入）**：本条「成功」须**同时**满足——① **HTTP／传输**：调用链必须传入**实际**上游 HTTP status（参数名 `upstreamHttpStatus: number`；来源 `writeLucySemanticResponse` 内的 `upstream.statusCode`，见 Plan）。判定用该值 `< 400`；**禁止**在成功判定里对缺省 `?? 200` 冒充真实 HTTP。`classifyUpstreamFailure` 因「body 已是 JSON-RPC 形」而放过的 **HTTP ≥400 + 合法 JSON-RPC `result`**（含 `rows:[]`）**仍非本条成功**（既有审计可记 error，本条不得注入成功空结果指导）；② **MCP result**：`result.isError !== true`（含 **HTTP 200 + `isError:true` + `rows:[]`**）；③ 工具名为 `lucy_query`；④ 行数严格 `=== 0`（D8）。**顺序硬约束**：先完成本判定（含 `upstreamHttpStatus`）→ 才允许 `allowedToolNames`／`buildEmptyResultNextStep`／注入；任一门失败 ⇒ 无 `next_step`、本功能新增的可见性裁决调用次数＝0。可见工具门禁与注入门禁**共用同一** `upstreamHttpStatus` 来源。JSON 与 SSE 装配**同口径**；两处 `withLucyResultMeta` 调用均须传入实际 status（SC-30） | **第 2 轮 D13 ＋ Codex R2-02／R3 major**：仅查 `isError`、放在装配末尾、或签名／调用缺 status／`?? 200` 假绿均不够；必须堵住 200+isError 与 500+result 反例 |
| **D14** | **成功截断 `repair` 与空结果 `next_step` 可并存**：当 `rows` 严格 0 且 Spec 162 截断条件成立时，既有 `_meta.lucy.repair` **保留**，同时按本条注入 `next_step`（若其它门禁通过）。优先级：不删 `repair`；不因存在 `repair` 而跳过 `next_step`；失败路径既有 Repair Hint 形状仍不叠加 `next_step`（§5.3） | **Codex R1 F03**：原「同响应不得并存」与 Spec 162 成功截断合同冲突 |
| **D15** | **JSON 数值保真（原始 token）**：保真必须以 `content[0].text` 的**原始数值 token 文本**为准——扫描 JSON 数字字面量并判定是否可在 IEEE-754 下无改写地表示；**或**采用**保留原文注入**（在合法 JSON 对象层插入 `next_step` 键，**不**对既有数字字面量做 `JSON.parse`→`JSON.stringify` 重写）。**禁止**以 parse 后 JS Number 的「有限 + 深等」冒充保真：`9007199254740993`→`9007199254740992`、`1e-400`→`0` 解析后仍为有限数且 round-trip 深等可通过，却已改写上游 `totalRows` 等。若存在精度损失／下溢／上溢（含 `1e400`→`Infinity`）风险的原始 token，或无法在不改写既有数字字面量的前提下注入 → **跳过指导**，`content[0].text` **逐字节不变**，记 `next_step_skipped_reason="content_json_number_not_fidelity_safe"`；**不**声称「数字改值不影响 totalRows」 | **Codex R1 F06 ＋ R2-01**：v0.5 以解析对象为基准会漏打假精度损失与下溢 |

## 4.1 未决决策（不得标已冻结）

**无。** 原 §4.1 唯一悬空项 **D3** 已由委托人 2026-11-09 确认选项 A，并迁入 §4「已冻结决策」。本表不得再出现「待委托人确认 D3」或把 D3 标为未决。

> 历史动机（已闭合，仅留痕）：追加块会打断 eval runner 的多块 JSON 解析（`eval-runner.mjs:293-300`），且其模型可见性依赖客户端渲染全部块。单块内加键对仓库 content 消费者不破坏；代价是数据文本在保真前提下注入或按 D15 跳过。

## 5. 响应形状

### 5.1 结构化字段

`next_step` 对象（Lucy 注入的各已存在承载位内容**完全一致**）：

```json
{
  "kind": "empty_result",
  "summary": "本次查询返回 0 行事实数据。",
  "query": {
    "connectionId": "mysql-main",
    "sourceName": "sales_order",
    "measures": ["revenue"],
    "dimensions": [{ "field": "sales_order.month", "granularity": "month" }],
    "filters": { "kind": "list", "count": 1, "items": [{ "kind": "structured", "field": "company", "op": "contains", "valueCount": 1 }] },
    "orderBy": [{ "field": "sales_order.month", "direction": "asc" }]
  },
  "suggestions": [
    "放宽过滤条件（公司 / 产品线 / 时间范围）后重查",
    "确认目标期间落在该 source 的数据可用周期内",
    "确认问题的时间粒度与该 source 的粒度一致"
  ],
  "next_tools": ["lucy_read_source", "lucy_freshness"],
  "hint": "在核对粒度、期间与过滤条件之前，不要用近似值或上一期实际代替本次结果。"
}
```

行范围与用户筛选无交集时（`kind=scope_intersection_empty`）：

```json
{
  "kind": "scope_intersection_empty",
  "summary": "本次查询返回 0 行：当前的等值过滤与该角色的行权限范围没有交集，或同一字段的多个等值条件互相矛盾。",
  "suggestions": [
    "移除或调整与行权限范围冲突的等值过滤条件，或检查同一字段的多个等值条件是否互相矛盾",
    "确认目标期间落在该 source 的数据可用周期内",
    "确认问题的时间粒度与该 source 的粒度一致"
  ]
}
```

> **文案不预设成因**（D7）：`scope_intersection_empty` 只说明「结果为空且与行权限范围或等值条件有关」，**不**断言「该字段取值不在授权范围内」——后者在「用户自己两条等值条件互斥」的情形下是假事实。

字段口径：

| 字段 | 含义 | 来源 | 约束 |
|---|---|---|---|
| `kind` | 指导种类 | 常量；`empty_result` / `scope_intersection_empty` | 未来扩展时新增取值，**不**复用本值表达别的形状；`scope_intersection_empty` 与审计 `decision_reason` **同码同义** |
| `summary` | 一句人话结论 | 常量（按 kind 分支） | 不含结论性判断（不说「数据错误」）；`scope_intersection_empty` 分支**不预设成因** |
| `query` | 本次请求面回显 | `provenance` 同源，但 **①** `filters` 取**改写前**的原始用户 filter 并去值，**②** 只含白名单键（D11） | 字段缺失时省略该键，不填 `null` |
| `suggestions` | 建议动作数组 | 由 kind 与请求形状派生 | 只描述方向，不含具体数值；`scope_intersection_empty` 时不含泛化的「放宽过滤条件」 |
| `next_tools` | 建议接着调用的工具 | `allowedToolNames(identity)` ∩ {`lucy_read_source`, `lucy_freshness`} | 调用者不可见的工具**不出现**；无 `*` 通配语义 |
| `hint` | 一句约束性提醒 | 常量；`next_tools` 为空时换成**无工具版**常量（D10） | 提醒模型不要用近似值顶替；无工具版须明说「当前角色没有可用的核对工具」 |

`query.filters` 的**真实形状**（= `summarizeFilters` 的输出，`webui/server/proxy/audit-privacy.ts:171-178`）：

| 形状 | 取值 |
|---|---|
| `kind` | `"list"`（入参是数组）或 `"single"`（入参是单个 filter 对象） |
| `count` | **全量**条数（不是 `items.length`） |
| `items` | 最多 **8** 项（`slice(0, 8)`），超出部分不出现 |
| 单项 `kind` | `"structured"`（filter 是对象）／`"expression"`（filter 是**字符串**）／其它 `typeof` |
| `structured` 项 | `kind` 必有；`field` 仅当匹配 `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$` 时出现；`op` 仅当匹配 `^[A-Za-z_]+$` 时出现；`valueCount` 必有 |
| `expression` 项 | **只有** `kind` 与 `length`——**没有** `field`/`op`/`valueCount`，模型无法从载荷判断是哪个字段 |

### 5.2 已存在承载位

| 落点 | 内容 | 谁读 | 模型可读（协议层） |
|---|---|---|---|
| `result._meta.lucy.next_step` | 完整对象 | 审计 / 运维 / 工具台 | 否（`_meta` 通常不透出） |
| `result.content[0].text` 的 JSON 对象内 `next_step` 键 | 完整对象 | 客户端 / **模型可读主落点** | **是**（写入模型本来就会读的数据文本） |
| `result.structuredContent.next_step`（仅当已是对象） | 完整对象 | 优先读结构化结果的客户端 | 是（若客户端渲染它） |

规则：

- **已存在承载位一致**（D4）：`content[0].text` 不是 JSON 对象 → **Lucy 不注入**任何 `next_step`，只写 `_meta.lucy.next_step_skipped_reason`（`content_text_not_json_object`）；`content[0].text` **缺席**时记 `content_text_absent`（同属跳过枚举，见 §5.3）。
- **同名键冲突**（D12）：text **或**（若存在）structuredContent 已有 `next_step` → 全部跳过，记 `upstream_next_step_present`；**不覆盖**任何一侧。
- **缺失 structuredContent**：不新建；text＋`_meta` 仍可同生同灭注入（SC-22）。
- **统一成功判定**（D13）失败（含 `isError===true`、HTTP≥400 即使带 JSON-RPC `result`）→ 不发；若已进入装配且仅 `isError` 触发，记 `result_is_error`。
- **数值保真**（D15）：须基于**原始数值 token**或保留原文注入；无法保真 → 跳过，018 层 text 逐字节不变，记 `content_json_number_not_fidelity_safe`。
- **与 P0-4 `answer_verifiability` 共存**：装配顺序＝先 018 `next_step` 富化，再 AV 投影。AV 合法加键后，**不再**要求整段 `content[0].text` 与上游逐字节相等；仍须保证（①）018 的 `next_step`（若应注入）在约定承载位；（②）上游业务数字／字段在 D15 意义下保真（原始 token）。AV 返回错误信封时，**必须保留**已写入的 `_meta.lucy.next_step` 或 `next_step_skipped_reason`（不得静默抹掉）。
- 注入只**增加一个兄弟键**，在保真前提下不改 `headers` / `rows` / `totalRows` / `sql` 的**原始字面量**。
- **载荷白名单**（D11）：见上；→ **载荷内不可能出现**用户塞进 measure／dimension／orderBy 对象的 `rows` / `totalRows` / `columns` / `headers` 键。
- **不追加** content 块（D3＝A 已冻结）。
- **截断并存**（D14）：`_meta.lucy.repair` 与 `next_step` 可同时出现。

### 5.3 不出现的情形（已知边界）

| 情形 | 行为 | 依据 |
|---|---|---|
| 响应有数据（`rows.length > 0`） | 不带 `next_step` | — |
| 行数未知／非有限／非严格 0 | 不带 `next_step` | D8 |
| `lucy_query` 之外的工具（含 `lucy_read_source` 0 行） | 不带；**不**为求 `next_tools` 调用 `allowedToolNames` | D5／F07 |
| 非成功路径（权限拒绝／过滤下推／上游错误／P0-3 歧义拒绝） | 不带（那些路径已有各自的修复／拒绝形状，**不重复叠加**） | F08 负向 |
| 上游 200 且 `result.isError === true`（含 `rows:[]`） | 不带；不调本功能 `allowedToolNames`；记 `result_is_error` | D13；SC-18（JSON＋SSE） |
| HTTP ≥400 且 body 含合法 JSON-RPC `result`＋`rows:[]` | 不带；不调本功能 `allowedToolNames`；不得注入成功空结果指导（即使 classifier 放过信封） | D13；SC-30（JSON＋SSE） |
| `content[0].text` 不是 JSON 对象 | **Lucy 不注入**，记 `content_text_not_json_object`；与 P0-4 共存时该 reason **须仍可在最终响应／`_meta` 观测到**（SC-12） | D4 |
| `content[0].text` 缺席（无 text 字段） | **Lucy 不注入**，记 `content_text_absent`（跳过枚举独立码，不并入 `content_text_not_json_object`） | D4；N2 |
| 任一已存在承载位已带 `next_step` | **Lucy 不注入**，记 `upstream_next_step_present` | D12 |
| JSON 数值无法保真（上溢／精度损失／下溢等原始 token） | **Lucy 不注入**，018 层 text 逐字节不变，记 `content_json_number_not_fidelity_safe`；与 P0-4 共存时最终 text 须仍含该原始 token（可另含 AV 键） | D15；SC-25 |
| 成功截断且严格 0 行 | **保留** `_meta.lucy.repair`，并按门禁注入 `next_step` | D14；不得删 Spec 162 截断提示 |
| `lucy_certified_route` / `lucy_report_template` | 不带——这两条路径不经 `withLucyResultMeta` | `webui/server/proxy/mcp-proxy.ts:4507-4508`、`:3761-3998`；⚠️ `:5990-6007` 是**会**走 `withLucyResultMeta` 的 `lucy_query` 分支。**覆盖缺口，已登记待后续** |
| 018 富化自身抛错（AV 尚未执行） | 无 Lucy `next_step`／`next_step_skipped_reason`；HTTP 200 时可为 P0-4 错误信封；非 200 回落上游原文（fail-safe） | SC-13(a)；与 P0-4 B-ASSEMBLE 对齐 |
| 018 已完成后 AV 失败 | 最终错误载荷／可观测 `_meta.lucy` **仍须保留**已写入的 `next_step` 或 `next_step_skipped_reason` | SC-13(b)；装配 M2 |
| 上游返回 `{"rows":[], "totalRows":500}` | 按 `rows.length === 0` 判为空结果（分页空页会被当成空结果） | `webui/server/proxy/mcp-proxy.ts:861-862`；属 `result_empty` 既有语义，本条不修，**已知边界** |

### 5.4 落点 × 消费者兼容矩阵

| 落点 | `scripts/eval/eval-runner.mjs:287-303`（多块拼接 → `JSON.parse`） | `scripts/eval/eval-runner.mjs:305-334`（`rowsToObjects`） | `webui/server/eval/offline-batch-main.ts:12-27` | `scripts/e2e/security/context.mjs:239-254` | MCP 客户端（Claude Code / Cursor / Codex） |
|---|---|---|---|---|---|
| `content[0].text` 单块内加键 | 不受影响（仍是**一个** text 块，拼接结果不变） | 不受影响（只读 `headers`/`rows`/`sql`） | 不受影响（取第一个带 `text` 的块并 `JSON.parse`，仍能解析） | 不受影响（只读 `headers`/`rows`） | **协议层模型可读**：指导已进入 content 文本。客户端是否最终投递给模型属**推断**，仓内无法验收 |
| `structuredContent` 加键（仅已存在对象） | 不受影响 | 不受影响 | 不受影响 | 不受影响 | 依赖客户端是否渲染结构化结果（推断） |
| `_meta.lucy` 加键 | 不受影响 | 不受影响 | 不受影响 | 不受影响 | 通常不透出（审计位）；**不得**由 `_meta` 推导「模型已收到」 |

> 追加独立 content 块会打断第一列（多块拼接后 `JSON.parse` 失败 → 退化为 `{raw}` → 结果断言落空），故 D3＝A 冻结为单块内加键、不追加 content 块（委托人 2026-11-09 确认）。

**可验收保证（F10）**：Lucy 注入成功 ⇒ `next_step` 出现在模型可读的 MCP `content[0].text` JSON 内（且与 `_meta.lucy.next_step` 同生；structured 按 D4）。**不可验收保证**：任意具体客户端已把该 content 交给模型。

## 6. 核心流程（伪代码）

```text
# 纯函数，可单测，不做 I/O
function shapeMeasures(value): unknown[] | undefined
  # 字符串原样；对象项只保留非空 string expr；其它丢弃

function shapeDimensions(value): unknown[] | undefined
  # 仅普通对象；只保留 field（非空 string）+ 可选 granularity（string）
  # 无 field → 整项丢弃；字符串维度整项丢弃（与真实 schema 一致）

function shapeOrderBy(value): unknown[] | undefined
  # 仅普通对象；只保留 field（非空 string）+ 可选 direction∈{asc,desc}
  # 附加键（如 rows）一律丢弃

function buildEmptyResultNextStep(input: {
  toolName: string
  rowCount?: number | null
  scopeIntersectionEmpty?: boolean
  provenance?: Record<string, unknown>          # 不含 filters
  filtersSummary?: Record<string, unknown> | null
  visibleTools?: readonly string[]              # 已解析；缺省＝[] → next_tools 空 → NO_TOOL_HINT（SC-01 须显式传可见工具）
}): NextStep | null:
  if input.toolName != "lucy_query": return null
  if typeof input.rowCount !== "number": return null
  if !Number.isFinite(input.rowCount): return null
  if input.rowCount !== 0: return null          # 严格零（D8）；禁止 rowCount > 0 假对称

  scopeConflict = input.scopeIntersectionEmpty === true
  p = input.provenance ?? {}
  query = {}
  if p.connectionId != null: query.connectionId = p.connectionId
  if p.sourceName != null: query.sourceName = p.sourceName
  orderBy = shapeOrderBy(p.orderBy ?? p.order_by)
  if orderBy: query.orderBy = orderBy
  measures = shapeMeasures(p.measures)
  if measures: query.measures = measures
  dimensions = shapeDimensions(p.dimensions)
  if dimensions: query.dimensions = dimensions
  if input.filtersSummary != null: query.filters = input.filtersSummary
  if Object.keys(query).length == 0: query = undefined

  suggestions = scopeConflict
    ? [SCOPE_SUGGESTION, CHECK_PERIOD_SUGGESTION, CHECK_GRAIN_SUGGESTION]
    : [RELAX_FILTER_SUGGESTION, CHECK_PERIOD_SUGGESTION, CHECK_GRAIN_SUGGESTION]

  visible = input.visibleTools ?? []
  next_tools = ["lucy_read_source", "lucy_freshness"].filter(t => visible.includes(t))

  return {
    kind: scopeConflict ? "scope_intersection_empty" : "empty_result",
    summary: scopeConflict ? SCOPE_SUMMARY : EMPTY_RESULT_SUMMARY,
    query,
    suggestions,
    next_tools,
    hint: next_tools.length > 0 ? EMPTY_RESULT_HINT : NO_TOOL_HINT
  }
```

```text
# Proxy 装配（webui/server/proxy/mcp-proxy.ts）
#
# 统一成功判定（D13／R2-02／R3 major）——必须先于 allowedToolNames／build／注入：
#   isEmptyResultNextStepEligible({ status: upstreamHttpStatus, result, toolName, rowCount }) =
#     typeof status === "number" && Number.isFinite(status) && status < 400
#     && result.isError !== true
#     && toolName === "lucy_query"
#     && typeof rowCount === "number" && Number.isFinite(rowCount) && rowCount === 0
#   HTTP≥400 即使 body 为 JSON-RPC result＋rows:[] → eligible=false（classifier 放过 ≠ 本条成功）
#   禁止对 status 做 ?? 200；缺省／非有限 status ⇒ eligible=false
#   JSON 与 SSE 装配同口径；两处调用均传实际 upstream.statusCode
#
# originalUserFilters 捕获点必须在 forced_filters 改写之前（mcp-proxy.ts:4182 前）
function withLucyResultMeta(
  payload, requestId, toolName, args, sourceRefs,
  visibleTools, originalUserFilters, scopeIntersectionEmpty,
  upstreamHttpStatus: number   # 必含；来自 writeLucySemanticResponse 的 upstream.statusCode
):
  enveloped = ensureJsonRpcEnvelope(payload, requestId)
  resultRecord = enveloped.result
  inspected = inspectRowsAndColumns(resultRecord)   # 注入前；与 isEmptyResult 同口径用 === 0

  lucyNextStep = undefined
  skippedReason = undefined

  eligible = isEmptyResultNextStepEligible({
    status: upstreamHttpStatus,
    result: resultRecord,
    toolName,
    rowCount: inspected.rows
  })

  if !eligible:
    # 不调 allowedToolNames；不构造 next_step；可选记 skipped（仅 isError 路径记 result_is_error）
    if resultRecord.isError === true && toolName === "lucy_query" && inspected.rows === 0:
      skippedReason = "result_is_error"
  else:
    # 可见工具：仅 eligible 之后求值（由调用方传入已求值清单，或惰性闭包）
    # 调用顺序：先 eligible → 再 allowedToolNames → 再 build／注入
    next_step = buildEmptyResultNextStep({
      toolName,
      rowCount: inspected.rows ?? null,
      scopeIntersectionEmpty,
      provenance: withoutFilters(provenanceOf(args, sourceRefs)),
      filtersSummary: originalUserFilters === undefined ? null : summarizeFilters(originalUserFilters),
      visibleTools
    })
    if next_step != null:
      text = resultRecord.content?.[0]?.text          # 保留原文引用
      parsed = tryParseJsonObject(text)
      if parsed == null:
        skippedReason = text !== undefined
          ? "content_text_not_json_object"
          : "content_text_absent"
      else if hasOwn(parsed, "next_step"):
        skippedReason = "upstream_next_step_present"
      else if isPlainObject(resultRecord.structuredContent) && hasOwn(resultRecord.structuredContent, "next_step"):
        skippedReason = "upstream_next_step_present"          # D12：structured 侧冲突也整单跳过
      else if !rawNumericTokensFidelitySafe(text):             # D15：扫原始数字字面量；禁止仅靠 parse 后有限＋深等
        skippedReason = "content_json_number_not_fidelity_safe"
      else:
        # 优先保留原文注入（不改写既有数字 token）；否则仅当 token 安全才允许 stringify
        candidateText = injectNextStepPreservingNumberTokens(text, next_step)
          ?? (fidelitySafeStringify(parsed, next_step))
        if candidateText == null || !originalNumberTokensUnchanged(text, candidateText):
          skippedReason = "content_json_number_not_fidelity_safe"
        else:
          resultRecord.content[0].text = candidateText         # 1) 模型可读主落点
          if isPlainObject(resultRecord.structuredContent):
            resultRecord.structuredContent = { ...resultRecord.structuredContent, next_step }
          lucyNextStep = next_step                             # 3) 合同位；与 text 同生同灭

  # `_meta.lucy` 全新字面量；保留既有 truncation.repair（D14，不得删）
  lucy = {
    contract: <既有取值>,
    tool: toolName,
    upstreamTool: <既有取值>,
    sources: sourceRefs,
    guardrails: <既有取值>,
    result: <既有取值>,
    ...(truncation?.repair ? { repair: truncation.repair } : {}),
    ...(lucyNextStep ? { next_step: lucyNextStep } : {}),
    ...(skippedReason ? { next_step_skipped_reason: skippedReason } : {}),
    ...(appliedLucyVersion(toolName, args, sourceRefs) ?? {}),
    provenance
  }
  return { ...enveloped, result: { ...resultRecord, _meta: { ...existingMeta, lucy } } }
```

**关键点（实现必须照此，否则特性静默消失）**：

- `next_step` 必须写在 `lucy` 字面量内部；不得假设 `_meta.lucy` 已存在；不得 spread 既有 `_meta.lucy`。
- **先**统一成功判定（D13，含必传 `upstreamHttpStatus`），**再**权限／构造／注入；判定用 `inspected.rows`（注入前），严格 `=== 0`；禁止 `?? 200`。
- 已存在承载位同生同灭（D4）；落点为单块内加键（D3＝A）；同名键冲突整单跳过（D12）；数值不保真则跳过且 text 不变（D15，原始 token）。
- 不发任何真实数据查询。

## 7. 验收（本条出口）

| ID | 断言 |
|---|---|
| SC-01 | `buildEmptyResultNextStep` 对 `lucy_query` + `rowCount=0` + **显式** `visibleTools` 含至少一核对工具 → 非空 `next_step`，`kind="empty_result"`，`hint=EMPTY_RESULT_HINT`（**不得**在缺省 `visibleTools` 下期望普通 hint——缺省为 `[]` → `NO_TOOL_HINT`，见 SC-17） |
| SC-02 | 对 `rowCount=3` 返回 `null` |
| SC-03 | 对 `rowCount=null`／缺省／`NaN`／`Infinity`／`-1` 返回 `null`（未知／非有限／非严格 0 不判空；与 D8／`isEmptyResult` 同口径） |
| SC-04 | 对非 `lucy_query` 工具（含 `lucy_read_source` + `rowCount=0`）返回 `null` |
| SC-05 | `query` 只含存在的键；缺字段省略；`query.filters` 为去值摘要且与 `summarizeFilters` 逐项一致；**不含**任何 filter 值 |
| SC-06 | `next_tools` 只含传入的可见工具；无 `*` 通配 |
| SC-07 | `scopeIntersectionEmpty=true` 时 `kind="scope_intersection_empty"`，建议分流正确且**不预设成因** |
| SC-08 | `summary`／`hint` 不含「数据错误」「数据缺失」等结论性判断 |
| SC-09 | Proxy：`lucy_query` 严格 0 行时 `_meta.lucy.next_step` 与 `content[0].text` 内 `next_step` 存在且一致；`headers`／`rows`／`totalRows` 取值与上游一致 |
| SC-10 | Proxy：上游同时有 `structuredContent` 对象时，其 `next_step` 与另两处内容一致 |
| SC-11 | Proxy：**非空**结果 → `_meta.lucy` **不含** `next_step`；`content` 长度不变。与 P0-4 共存时：允许 `answer_verifiability` 合法加键；业务字段（`headers`／`rows`／`totalRows` 等）在 D15 意义下保真（原始 token）；**不再**要求整段 `content[0].text`／`structuredContent` 与上游逐字节相等。若仅测 018 层（mock 掉 AV），则 text／structured 须逐字节不变 |
| SC-12 | Proxy：text 非 JSON 对象 → Lucy 不注入 `next_step`；最终响应（成功路径或可观测 `_meta`，**含** P0-4 错误信封）**必须仍能看到** `next_step_skipped_reason="content_text_not_json_object"`（不得被 AV 错误信封抹掉）；structured／`_meta` 均无 Lucy `next_step` |
| SC-13 | Proxy：区分——(a) 018 富化自身抛错（AV 尚未执行）→ 无 Lucy `next_step`／`next_step_skipped_reason`；HTTP 200 时可为 P0-4 错误信封，非 200 回落上游原文；(b) 018 已完成后 AV 失败 → 最终错误载荷／可观测 `_meta.lucy` **仍须保留**已写入的 `next_step` 或 `next_step_skipped_reason`（不得静默抹掉） |
| SC-14 | Proxy：`next_step` 载荷只由本 Spec 键构成；measures 对象项只含 `expr`；dimensions 对象项只含 `field`／可选 `granularity`；orderBy 项只含 `field`／可选 `direction`；载荷无 `rows`／`totalRows`／`columns`／`headers`；审计 `response_row_count` 与上游一致 |
| SC-15 | 术语标准 §4.8 已登记；`Next Step` 行含 D4「已存在承载位／structured 仅已存在时同步」与「不得与 Repair Hint 混称／替代」及 D14 截断并存说明；`lint:spec-docs` 通过 |
| SC-16 | `lint:terminology` 通过 |
| SC-17 | `visibleTools=[]`（或缺省）时 `suggestions` 仍三条，`hint` 含「没有可用的核对工具」 |
| SC-18 | Proxy（**JSON 与 SSE 各至少一条**）：HTTP 200 + `result.isError===true` + `rows:[]` → 不注入；`next_step_skipped_reason="result_is_error"`；本功能新增 `allowedToolNames` 调用次数＝0 |
| SC-19 | Proxy：text 已带 `next_step` → 上游原值逐字节不变、Lucy 不注入，`upstream_next_step_present` |
| SC-20 | Proxy：`allowedToolNames` **只在** `toolName===lucy_query` 且严格 0 行路径被调用——有数据、非 `lucy_query`（含 `lucy_read_source` 0 行）须对**本功能新增调用点**做**调用次数＝0**断言（不得只断言「没有 next_step」假绿） |
| SC-21 | 纯函数：measures 对象附加键被剥；dimensions `{field,granularity,extra}` 只剩 `field`／`granularity`；字符串维度不进入 `query.dimensions`；orderBy 对象附加键（如 `rows`）被剥，只留 `field`／`direction` |
| SC-22 | Proxy：**无** `structuredContent` 的合法 0 行响应 → text 与 `_meta.lucy.next_step` 均有且一致；不因缺 structured 而跳过；响应仍无 structured（不新建） |
| SC-23 | Proxy：structured 已有 `next_step`、text 无 → 整单跳过，两侧原值不变，`upstream_next_step_present` |
| SC-24 | Proxy：`rows:[]` 且截断条件成立 → `_meta.lucy.repair` **仍在**（Spec 162 文案不变），且 `next_step` 按门禁注入（D14） |
| SC-25 | Proxy：上游 text 含无法保真的原始数值 token 时 → 018 不注入，记 `content_json_number_not_fidelity_safe`。与 P0-4 共存时：最终 text **须仍含**该原始 token（D15），且可另含 `answer_verifiability`；**不再**要求整段 text 与上游逐字节相等。若仅测 018 层（mock 掉 AV），则 text 须逐字节不变。**必覆盖至少三类**：（a）上溢／非有限字面量 `1e400`；（b）精度损失 `9007199254740993`；（c）下溢 `1e-400`。**禁止**仅用 parse 后有限＋深等判定为可注入 |
| SC-26 | Proxy 负向：ACL 外表／未暴露列导致的既有拒绝路径 → **无** `next_step`（指导不得出现不可见对象名） |
| SC-27 | Proxy 负向：P0-3 歧义拒绝／权限拒绝 → **无** `next_step`（不与既有拒绝／Repair 形状叠加） |
| SC-28 | Proxy 负向：JSON 与 SSE 装配的非 `lucy_query` 成功 0 行样例 → 无 `next_step`，且 SC-20 计数为 0 |
| SC-29 | 状态镜像：Spec／Plan／`docs/README.md`／`docs/plans/README.md`／`docs/governance/project-overview.md` §9／需求池 REQ-030-018／清单池 P0-5 **同一句现值**（见 DEVELOPMENT.md「状态登记只有一份现值」）；收口时禁止 Spec 写「功能合同已收口」而 Plan 写「已执行」两套现值 |
| SC-30 | Proxy（**JSON 与 SSE 各至少一条**）：HTTP 500（或其它 ≥400）+ 合法 JSON-RPC `result` + `rows:[]` → **无** `next_step`；本功能新增 `allowedToolNames` 调用次数＝0；不得因 classifier 放过 JSON-RPC 信封而注入成功空结果指导。夹具须走 **实际** `upstream.statusCode` → `withLucyResultMeta(..., upstreamHttpStatus)` 路径（禁止缺省 `?? 200`）；可见工具门禁与注入门禁共用同一 status 来源 |

### 证据落点（2026-11-09）

| ID | 证据 |
|---|---|
| SC-01…SC-08／SC-17／SC-21 | `webui/server/__tests__/empty-result-next-step.test.ts` |
| SC-09…SC-14／SC-18…SC-20／SC-22…SC-28／SC-30 | `webui/server/__tests__/empty-result-next-step-proxy.test.ts` |
| SC-15 | `webui/docs/00-product-terminology-standard.md` §4.8（Next Step／Empty Result／Suggestion＋Scope Intersection Empty 补注） |
| SC-16 | `npm run lint:terminology`（本条新增术语已登记；仓库另有 TableEditor 存量 WARN／失败与本条无关） |
| SC-29 | Spec／Plan／README／overview／需求池／清单池同句现值 |
| 形状快照 | `inbox/empty-result-next-step-evidence-20261109.json`（临时件，不入库） |

## 8. 风险与回滚

| 风险 | 说明 | 缓解 |
|---|---|---|
| **数据文本被重新序列化** | parse→加键→stringify | 优先保留原文注入；仅原始 token 保真通过才注入（D15／SC-25）；与 AV 共存后 SC-11／SC-25 以业务字段保真为准 |
| **有限数仍改值** | `9007199254740993`／`1e-400`／`1e400` | D15：扫原始 token；禁止 parse 后有限＋深等冒充保真；018 跳过时原文不变（SC-25） |
| **HTTP 错误＋JSON-RPC result** | classifier 放过信封后误注入 | D13／SC-18／SC-30：先统一成功判定再权限／注入 |
| **上游自带 `next_step`／承载位冲突** | 覆盖即销毁上游数据 | D12／SC-19／SC-23 |
| **模型可见性证据边界** | 服务端一致 ≠ 客户端已投递 | 可验收保证止于 MCP content 承载位（§5.4／F10）；不得由 `_meta` 推导「模型确实收到」 |
| **指导不可见（018 富化抛错）** | 无 next_step；HTTP 200 可走 P0-4 错误信封 | SC-13(a) |
| **AV fail-closed 抹掉 018** | 错误信封替换整包 | SC-13(b)／装配：错误信封保留 `_meta.lucy.next_step`／`next_step_skipped_reason` |
| **截断提示被误删** | 与 next_step「不得并存」旧口径冲突 | D14／SC-24：并存；不删 Spec 162 `repair` |
| **回显敏感值／自定义键** | filter 值或 orderBy 附加键 | D6／D11／SC-14／SC-21 |
| **指导越权泄漏** | 不可见 source／列 | 候选仅 ACL `sourceRefs`；SC-06／SC-26 |
| **建议方向错／假事实** | 预设成因 | D7／SC-07 |
| **可见性裁决开销** | `allowedToolNames` | 仅 D13 成功且严格 0 行之后（SC-20／SC-18／SC-30） |
| **假绿验收** | SC-01／SC-20 旧写法 | SC-01 显式 visibleTools；SC-20 计数断言；SC-26–SC-28／SC-30 负向 |
| **回滚** | —— | 去掉装配与注入即可；不改上游取值、不改审计字段、不删 Spec 162 `repair`、无数据迁移 |

## 9. 关联

- 需求池：[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) REQ-030-018
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md)
- 实施计划：[`lucy-20261107-empty-result-next-step-guidance-plan.md`](../plans/lucy-20261107-empty-result-next-step-guidance-plan.md) **v0.8-draft**
- 第 1 轮评审与裁定：[`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)
- Codex 过程对抗：[`docs/reviews/2026-11-09-empty-result-next-step-codex-review.md`](../reviews/2026-11-09-empty-result-next-step-codex-review.md)
- 修复提示合同：[`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md)
- Proxy 协议：[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md)
- 术语标准：[`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §4.8
