# 空结果响应的结构化下一步指导 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.4** |
| 日期 / 目标版本 | 2026-11-07 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 功能编号 / 优先级 | **无**（挂在 `0.30` 需求池 **REQ-030-018**）/ **P0**（清单 **P0-5**；Agent 拿到空结果后的下一步可操作性）——与清单池 P0-5、需求池 REQ-030-018 的 **P0** 同口径 |
| 台账号 | **无**。`0.30` 台账尚未建立；待 PM 指派台账号后再登记 |
| 状态 | **v0.4，待严格评审／验收；冻结落地；未授权实现**。已并入 0.30 批次第 1 轮评审（形式合规 ＋ 事实性）并已修订；待 0.30 批次第 2 轮对抗式评审。v0.1 经第 1 轮对抗式设计评审（Claude Code）提出 6 条阻断项，**全部成立并已修订**；v0.2 并入横切批评审 9 条；v0.3 经第 2 轮对抗式设计评审提出 2 条阻断项 ＋ 7 条 major ＋ 7 条 minor，**经独立复核全部成立并已修订**（D4／D6／D7 改写、§6 伪码重写、验收扩到 SC-01–SC-21）。需求澄清已完成（D1／D2 由委托人裁定）；**D3 落点反转待委托人确认**（见 §4 D3）；**未获开发授权**；本条不表示可上线 |
| 决策来源 | The New Stack《Why MCP servers should tell agents what to do next》（Matthew Burns 记 AWS James Ward，2026-11-07）主张「工具响应要带下一步指导」 |
| 需求来源 | [`docs/plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md) §3.1 差距 G1；需求池 REQ-030-018 |
| 实施主体 | Lucy MCP Proxy（`webui/server/proxy/`）。不改 KTX 源码，不改上游语义层 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **复用，不另造合同。** 修复提示的可用性闭环（B15 五项校验）沿用 Spec 162 §7.3；`result._meta.lucy` 富化合同沿用 Spec 162 §7.5 已在用的位置；空结果审计语义（`result_empty`）沿用 Spec 162 §8 不改；filter 去值纪律沿用 `webui/server/proxy/audit-privacy.ts` §「filters 先做结构化摘要（去值）」。**本条不修订** Spec 162 的任何既有取值 |
| 0.30 批次横向评审记录 | [`docs/reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md`](../reviews/2026-11-07-lucy-0-30-spec-plan-review-round1.md)（0.30 全部 35 份文档的第 1 轮：形式合规 ＋ 事实性核验；本条在 c9 块的 11 条已成立并修订） |
| 第 1 轮评审与裁定记录 | [`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)（**入库**；含第 1 轮 6 条阻断项的裁定、修订决定与横切批评审处理）。第 1 轮原始 findings 与裁定草稿落在本机 `inbox/`（临时件目录，`.gitignore` 忽略、**不入库**），结论以评审记录为准 |
| 实施计划 | [`docs/plans/lucy-20261107-empty-result-next-step-guidance-plan.md`](../plans/lucy-20261107-empty-result-next-step-guidance-plan.md) v0.3 |

## 闭口层级

- 层级：功能合同
- 本条承诺：Agent 调用 `lucy_query` 成功但返回 0 行事实数据时，响应里带一份**结构化、只含该调用者 ACL 内对象、模型一定看得见**的下一步指导，使 Agent 知道下一步该走哪条受控路径，而不是只拿到一个裸空结果。
- 本条出口：SC-01–SC-21。纯函数单测（指导构造、可见性口径、字段形状）；Proxy 层单测（`_meta.lucy.next_step` 落位、`content[0].text` 落位、无指导的合法情形）；一次夹具上游的 MCP `tools/call` 0 行响应取形状证据；`lint:spec-docs` 通过。
- 不在本条出口：浏览器走查签字、Playwright、移动窄屏、镜像构建、部署、客户环境验收、Eval 跑批成绩、客户原始问句、真实数据查询（不得为验证提示盲发真实数据查询）、上游 KTX 行为变更、certified route / report template 路径的指导。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Next Step：协议字段名 `next_step`，中文主称「下一步建议」。指一次工具响应附带的**受控下一步指引**，只描述可走的路径，不构成授权，也不是结论。落在**三处**：`result.content[0].text` 的 JSON 对象内同名键（模型可见，主落点）、`result.structuredContent.next_step`（结构化位，`structuredContent` 是对象时）、`result._meta.lucy.next_step`（合同／审计位，模型通常不透出）。三处**同生同灭**（见 §4 D4）。
- Empty Result：中文主称「空结果」。指 `lucy_query` **成功返回 0 行事实数据**。与既有审计标记 `result_empty`（Spec 162 §8）同义但不同层：`result_empty` 是审计事实，`next_step` 是面向 Agent 的建议。
- Suggestion：协议内 `next_step.suggestions` 数组，中文主称「建议动作」。每条是一条可执行的排查方向，不是命令，不构成对 Agent 的强制约束。
- **行范围与用户筛选无交集（既有主术语，本条不新造）**：空结果的一个**子类**，成因是行权限 OR 臂与用户等值过滤逐臂不相交。中文主称沿用术语标准 **§4.8 既有的 `Scope Intersection Empty` / 「行范围与用户筛选无交集」**，机器码沿用既有 `scope_intersection_empty`（与审计 `decision_reason` 同码），`next_step.kind` 取 **`scope_intersection_empty`**。**本条不新增第二个中文主称**（第 2 轮评审 N9）。

Forbidden:

- 把「下一步建议」写成安全边界或授权凭据——它是 fail-open 的建议层，裁决始终在 Proxy + ACL。
- 把「下一步建议」写成对 Agent 的强制指令或门闩——本条只提示，不阻断。
- 把 `next_step` 写成结论——空结果不等于「数据错误」，建议不得替 Agent 下结论。
- **把 `Next Step` 与 `Repair Hint` 混用**：`Repair Hint`（Spec 162 §7.3）指**失败**路径的提示；`Next Step` 指**成功但 0 行**路径的引导。两者不得互相替代，同一响应里也不得同时出现。
- 把行权限谓词、强制过滤表达式或任何角色不可见的对象写进 `next_step`。
- 把 `next_step` 追加为独立的 content 块（见 §3 非目标）。
- 把「行范围与用户筛选无交集」写成第二个中文主称（如「行权限交集空」）——沿用既有主术语与机器码（见 §4 D7）。
- 把 `next_step` 的**载荷**说成「回显请求参数」——载荷只由 §5.2 的白名单键构成，用户自定义键一律不出现。

落位：本条术语属 **MCP 协议／可见性**面，落术语标准 **§4.8（MCP 调试台 / ACL 裁决可见性）**，不落 §4.7（访问日志页面分区），也不落 §3（UI 主术语表——`next_step` 不是 UI 文案）。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`（修复提示可用性闭环 §7.3；`_meta.lucy` 富化形状 §7.5）
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

**已经有的是「失败路径的修复提示」**：

| 失败形状 | 提示落点 | 证据 |
|---|---|---|
| 权限拒绝 | `result.content[0].text` 的结构化 JSON（`reason` / `failureDimension` / `connections` / `sources`） | `webui/server/proxy/mcp-proxy.ts:4017-4065` |
| 过滤条件下推 | `result.content[0].text` 纯文本 hint | `webui/server/proxy/mcp-proxy.ts:2892-2937` |
| 结果截断 | `result._meta.lucy.repair`（**仅此一处**） | `webui/server/proxy/mcp-proxy.ts:2699`、`webui/server/proxy/question-experience.ts:1039-1059` |

**没有的是「成功但 0 行」**：此时响应是一个裸空结果，Agent 拿到的只有 `rows: []`，没有任何指示。

| 事实 | 证据 |
|---|---|
| `result_empty` 只写审计，不进响应 | `webui/server/proxy/question-experience.ts:1000-1007`（`isEmptyResult`）、`webui/server/proxy/mcp-proxy.ts:3027`（写审计）、`webui/server/proxy/audit.ts:1782`（计数） |
| 合同口径：只记 `result_empty=1` | `webui/docs/162-customer-query-experience-and-usage-evidence-spec.md:329` |
| 运行时指导反而要求区分三类缺失 | `webui/config/data-qa-instructions.md:40`（无记录 / 字段为空 / 可推算） |

也就是说：**最常见的「查得到、查不出数」路径上，工具一个字都不说**，而 Agent 面对它只能猜——换 filter？换 period？换 source？猜错就变成一轮无意义的循环查询，正好是文章批评的 scenic route。

同时有一条容易被忽略的事实：**截断修复提示（`TRUNCATION_REPAIR_HINT`）至今只写在 `_meta.lucy.repair`，从未进入模型可见的 `content`**（`webui/server/proxy/mcp-proxy.ts:2699` 是唯一落点）。MCP 客户端把 `result.content` 呈现给模型，`_meta` 通常不透出。也就是说，Lucy 现有的「修复提示」在成功路径上**是给运维看的，不是给 Agent 看的**。

## 2. 目标

1. `lucy_query` 成功且 0 行时，响应带一份结构化下一步指导：本次查了什么、下一步能查什么、能用什么工具。
2. 指导**模型一定看得见**——落在模型本来就会读的那段数据文本里，不依赖客户端是否渲染全部 content 块。
3. 指导内容**只含该调用者可见的对象**，且**不发明事实**——只复用响应链路上已经解析出的事实（ACL 已解析的 source 引用、请求自身的 provenance、调用者的可见工具清单）。
4. 指导**说清真实成因**——「行权限交集空」与「普通无数据」给不同的 `kind` 与不同的建议，不让 Agent 往错的方向试。
5. **只提示不阻断**：空结果不拒绝任何后续调用，不改变问询预算语义，不改 ACL 裁决。
6. 复用既有合同，不新造：`_meta.lucy` 命名空间、`provenance` 的有界收敛、`audit-privacy` 的 filter 去值纪律、`sourceRefs` 的 ACL 解析、`isEmptyResult` 的判定口径、`allowedToolNames` 的可见性裁决。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| **把 `next_step` 追加为独立的 content 块** | 会打断仓库内唯一的多块 JSON 消费方：`scripts/eval/eval-runner.mjs:293-300` 把所有 text 块用 `'\n'` 拼接后再 `JSON.parse`，多块必然解析失败 → 结果断言全部落空；且追加块的模型可见性依赖客户端渲染全部块，仓内无法验证 |
| 改变上游数据载荷的**值语义** | 本条允许在 `content[0].text` 的 JSON 对象内**增加一个兄弟键**，但不改 `headers` / `rows` / `totalRows` / `sql` 的任何取值 |
| 给空结果做门闩（拒绝后续调用） | 与「部分可回答仍须交付」冲突；且指导是 fail-open 建议层 |
| 断言 grain / 数据可用周期 / 指标清单 | Proxy 在响应链路上拿不到这些事实，断言即编造；本条只指向 `lucy_read_source`／`lucy_freshness` 去取 |
| 区分「无记录 / 字段为空 / 可推算」 | 空结果时没有行，工具无从区分这三类；这是回答质量规范的要求，不是工具侧能给的 |
| 覆盖 `lucy_read_source` / `entity_details` / `sl_validate` 的空返回 | 本条只覆盖 `lucy_query` 的 0 行事实数据；其余工具的空返回语义不同 |
| 覆盖 `lucy_certified_route` / `lucy_report_template` | 这两条路径内部执行查询但**绕过** `withLucyResultMeta`（`webui/server/proxy/mcp-proxy.ts:3761-3998`），本条不覆盖，见 §5.3 |
| 为验证提示发送真实数据查询 | 沿用 Spec 162 §7.3 的硬约束 |
| 改 `result_empty` 审计语义 | 审计口径归 Spec 162，本条只加响应字段 |
| 自动升工具面 / 改 skill | 归 REQ-030-021，本条不碰 |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | 指导以**结构化字段**承载：`next_step` 对象（`kind` / `summary` / `query` / `suggestions` / `next_tools` / `hint`） | 委托人裁定 2026-11-07。不落自由文本，模型可按字段枚举决策 |
| D2 | **只提示不阻断**：空结果不拒绝任何后续调用，不改问询预算 | 委托人裁定 2026-11-07。门闩会与「部分可回答仍须交付」冲突 |
| **D3** | **落点＝单块内加键**：`content[0].text` 的 JSON 对象内加 `next_step` 键；`structuredContent` 是对象时同步加键；`_meta.lucy.next_step` 同步给出（审计位）。**不追加 content 块** | **第 1 轮评审修订（原 v0.1 为「追加块」）**：追加块打断 eval runner 的多块 JSON 解析（`eval-runner.mjs:293-300`），且其模型可见性依赖客户端渲染全部块（仓内无法验证）。单块内加键对仓库 3 个 content 消费者都不破坏，且模型在它本来就读的 JSON 里就能看到 → **不变式：凡出现 `next_step`，模型一定看得见**。代价：数据文本被重新序列化（值语义不变，仅字符串规范化），见 §8。⚠️ **本项是推翻了原 Spec 非目标「不改写上游 `content[0].text`」的口径反转，待委托人确认；确认前不授权实现** |
| **D4** | **三处落点同生同灭**：模型可见位（`content[0].text` 的 JSON 对象）不成立时，三处**都不发** `next_step`，只写 `_meta.lucy.next_step_skipped_reason` | **第 2 轮评审修订（原 v0.3 写「text 非 JSON 时三处都不发」，但三处伪码都是「先算 `next_step` 再分别往三处写」，`structuredContent` 与 `_meta.lucy` 实际照发）** → 审计侧看到 `_meta.lucy.next_step` 就认为「指导已下发」，而模型侧一条都没收到，正是 D3 不变式要防的静默消失，只是从「整体没有」变成「审计说有、模型没有」。**不变式收紧为：凡出现 `next_step`，模型一定看得见；三处要么都有，要么都没有** |
| **D5** | `next_tools` 只列**该调用者可见**的工具，用 `allowedToolNames(identity)` 的结果 | **第 1 轮评审修订**：原用 `permissions.tools`（授予清单）——`allowedToolNames` 才做可见性裁决（`*` 展开 `knownTools`、剔 deny、DataPlane 要求 capability、`degradedGlobal` 隐藏），`webui/server/proxy/acl.ts:2397-2431`。用错清单会推荐调用者调不通的工具。**第 2 轮评审追加**：该裁决**只在 0 行路径求值**（有数据／非 `lucy_query` 的响应不触发），见 §8 成本口径 |
| **D6** | `query.filters` 只回显**改写前的原始用户 filter**，且按 `audit-privacy` 口径**去值**（`kind` / `field` / `op` / `valueCount`）；**行策略谓词一律不出现** | **第 1 轮评审修订**：`applyLucyQueryForcedFilters` 把策略谓词前插进 `record.filters`（`row-policy.ts:738`），`mcp-proxy.ts:4182-4183` 随即改写 `toolArgs`；若直接回显，模型会看到自己没发过的谓词，且「放宽过滤」对它无效。**第 2 轮评审追加**：载荷必须走**白名单构造**而非透传，见 D11 |
| **D7** | 用 `scopeIntersectionEmpty`（**发查询前**已算出）分流 `kind`：取 **`scope_intersection_empty`**（与审计 `decision_reason` 同码、同主术语「行范围与用户筛选无交集」）；summary 与建议**不预设成因** | **第 1 轮评审修订**：该情形下真实成因之一是用户等值过滤与行权限 OR 臂逐臂不相交（`row-policy.ts:686-711`），泛化建议会把 Agent 引向「改时间范围」这类无关方向。**第 2 轮评审再修订**：原措辞「该字段取值不在授权范围内」在一种可复现形状下是**假事实**——`row-policy.ts:672-676` 把同一字段的多条用户等值约束 AND 后取交集，`:703` 的 `userValues.size === 0` 命中的是**用户自己两条约束互斥**（与授权范围无关，此时取值反而**在**授权范围内）。故 summary 与建议改为中性表述（见 §5.1） |
| D8 | 空结果判定复用 `isEmptyResult` 口径：**行数未知 ≠ 空结果** | 「未知行数不是空结果的证据」已写在 `webui/server/__tests__/slow-call-and-empty-result.test.ts:60-66` |
| D9 | 候选与提示**只复用响应链路上已有事实**：ACL 已解析的 `sourceRefs` + 请求自身 provenance；**不断言** grain／可用周期／指标清单 | 不发明事实是可用性闭环 B15 的同一原则 |
| D10 | `next_tools` 为空**不降级** `suggestions`；但 `hint` **必须**表达「当前角色没有可用的核对工具」 | **第 1 轮评审修订**：三条建议都是推理动作，不依赖工具，空数组只说明该角色没有可用的核对工具。**第 2 轮评审追加**：`next_tools` 为空是**真实可达**场景（`lucy_read_source` / `lucy_freshness` 是 DataPlane 工具，可见性要求 capability，`acl.ts:2423-2424`），且恰是最需要指引的场景——「没有可用工具」这一事实必须让模型看见，不能只留在实现者脑子里 |
| **D11** | **载荷白名单**：`query` 顶层只允许 `connectionId` / `sourceName` / `orderBy` / `measures` / `dimensions` / `filters`；`measures` / `dimensions` 的**对象项只保留 `expr`**；字符串项原样 | **第 2 轮评审修订**：`invalidMeasuresFieldReason`（`mcp-proxy.ts:1497-1509`）只要求 measure 项是字符串或带 `expr` 的对象，**不限制对象里的其余键** → `measures: [{"expr":"sum(1)","rows":999}]` 可通过校验，经 `boundedProvenanceValue`（`:2610-2622`，按键名逐键复制）进入模型可见位，与 §5.2「载荷不得含 `rows`/`totalRows`/`columns`/`headers`」硬护栏**直接冲突**。白名单从构造上排除用户自定义键 |
| **D12** | **上游已带 `next_step` 键时不覆盖**：拒绝注入，记 `next_step_skipped_reason="upstream_next_step_present"` | **第 2 轮评审修订**：`{...parsed, next_step}` 会**原地覆盖**上游自己的 `next_step`（键位保留、值被换掉）→ 静默销毁上游数据。宁可无指导，不改上游取值 |
| **D13** | **`result.isError === true` 的 200 响应不发 `next_step`** | **第 2 轮评审修订**：`classifyUpstreamFailure`（`mcp-proxy.ts:2552-2572`）只拦 status ≥ 400，而 `outcome="error"` 是**富化之后**才判定的（`:2952-2963`）→ 200 + `result.isError:true` 会照常进入富化，与 §5.3「非成功路径不叠加」相悖 |

## 5. 响应形状

### 5.1 结构化字段

`next_step` 对象（三个落点内容**完全一致**）：

```json
{
  "kind": "empty_result",
  "summary": "本次查询返回 0 行事实数据。",
  "query": {
    "connectionId": "mysql-main",
    "sourceName": "sales_order",
    "measures": ["revenue"],
    "dimensions": ["month"],
    "filters": { "kind": "list", "count": 1, "items": [{ "kind": "structured", "field": "company", "op": "contains", "valueCount": 1 }] },
    "orderBy": ["month desc"]
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

### 5.2 三个落点

| 落点 | 内容 | 谁读 | 模型可见 |
|---|---|---|---|
| `result._meta.lucy.next_step` | 完整对象 | 审计 / 运维 / 工具台 | 否（`_meta` 通常不透出） |
| `result.content[0].text` 的 JSON 对象内 `next_step` 键 | 完整对象 | 客户端 / **模型** | **是**（模型本来就读这段数据文本） |
| `result.structuredContent.next_step`（当 `structuredContent` 是对象时） | 完整对象 | 优先读结构化结果的客户端 | 是（若客户端渲染它） |

规则：

- **三处同生同灭**（D4）：`content[0].text` 不是 JSON 对象 → 三处**都不发** `next_step`，只写 `_meta.lucy.next_step_skipped_reason`（合同位，不进 `content`，也不新增审计列）。
- 上游 `content[0].text` 里**已带** `next_step` 键 → 不覆盖（D12），记 `next_step_skipped_reason="upstream_next_step_present"`，上游取值逐字节不变。
- 上游 `result.isError === true` → 不发（D13），记 `next_step_skipped_reason="result_is_error"`。
- 注入只**增加一个兄弟键**，不改 `headers` / `rows` / `totalRows` / `sql` 的取值；数据文本因此被重新序列化（键序保留、值语义不变，仅字符串规范化）。
- **载荷白名单**（D11）：`query` 顶层只允许 `connectionId` / `sourceName` / `orderBy` / `measures` / `dimensions` / `filters`；`measures` / `dimensions` 的对象项**只保留 `expr`**；`filters` 只含 `summarizeFilters` 产出的 `kind`/`count`/`items`/`field`/`op`/`valueCount`/`length`。→ **载荷内不可能出现 `rows` / `totalRows` / `columns` / `headers` 键**（这是审计行数不被污染的**机制**，不是承诺）。
- **不追加** content 块（D3）。

### 5.3 不出现的情形（已知边界）

| 情形 | 行为 | 依据 |
|---|---|---|
| 响应有数据（`rows > 0`） | 不带 `next_step` | — |
| 行数未知 | 不带 `next_step` | D8 |
| `lucy_query` 之外的工具 | 不带 | — |
| 非成功路径（权限拒绝／过滤下推／上游错误） | 不带（那些路径已有各自的修复提示形状，**不重复叠加**） | — |
| 上游 200 且 `result.isError === true` | 不带，记 `next_step_skipped_reason="result_is_error"` | D13；`mcp-proxy.ts:2552-2572` 只拦 status ≥ 400，`:2952-2963` 的 outcome 判定在富化之后 |
| `content[0].text` 不是 JSON 对象 | **三处都不带**，记 `next_step_skipped_reason="content_text_not_json_object"` | D4 |
| 上游 `content[0].text` 已带 `next_step` 键 | **三处都不带**，记 `next_step_skipped_reason="upstream_next_step_present"` | D12 |
| `lucy_certified_route` / `lucy_report_template` | 不带——这两条路径不经 `withLucyResultMeta` | `webui/server/proxy/mcp-proxy.ts:4507-4508`（**分叉点**：此处走 `writeCertifiedRouteResponse`，`:3761-3998`）、`webui/server/proxy/mcp-proxy.ts:3761-3998`；⚠️ `:5990-6007` 是**会**走 `withLucyResultMeta` 的 `lucy_query` 分支，不能用作本条的「不经」证据。**覆盖缺口，已登记待后续** |
| 富化抛错 | 响应体回落上游原文，无指导（fail-safe） | `webui/server/proxy/mcp-proxy.ts:2887-2890` |
| 上游返回 `{"rows":[], "totalRows":500}` | 按 `rows.length` 判为 0 行（分页空页会被当成空结果） | `webui/server/proxy/mcp-proxy.ts:861-862`；属 `result_empty` 既有语义，本条不修，**已知边界** |

### 5.4 落点 × 消费者兼容矩阵

| 落点 | `scripts/eval/eval-runner.mjs:287-303`（多块拼接 → `JSON.parse`） | `scripts/eval/eval-runner.mjs:305-334`（`rowsToObjects`） | `webui/server/eval/offline-batch-main.ts:12-27` | `scripts/e2e/security/context.mjs:239-254` | MCP 客户端（Claude Code / Cursor / Codex） |
|---|---|---|---|---|---|
| `content[0].text` 单块内加键 | 不受影响（仍是**一个** text 块，拼接结果不变） | 不受影响（只读 `headers`/`rows`/`sql`） | 不受影响（取第一个带 `text` 的块并 `JSON.parse`，仍能解析） | 不受影响（只读 `headers`/`rows`） | **模型可见**（模型本来就读这段数据文本）——客户端侧渲染行为**仓内无法验证**，属推断级证据 |
| `structuredContent` 加键 | 不受影响 | 不受影响 | 不受影响 | 不受影响 | 依赖客户端是否渲染结构化结果（推断） |
| `_meta.lucy` 加键 | 不受影响 | 不受影响 | 不受影响 | 不受影响 | 通常不透出（审计位） |

> 追加独立 content 块会打断第一列（多块拼接后 `JSON.parse` 失败 → 退化为 `{raw}` → 结果断言落空），故 D3 选单块内加键。

## 6. 核心流程（伪代码）

```text
# 纯函数，可单测，不做 I/O
function buildEmptyResultNextStep(input: {
  toolName: string
  rowCount?: number | null
  scopeIntersectionEmpty?: boolean
  provenance?: Record<string, unknown>          # 既有 provenance，**不含 filters**；只读 connectionId/sourceName/measures/dimensions/orderBy
  filtersSummary?: Record<string, unknown> | null   # 已去值摘要（summarizeFilters 的输出），与 provenance 分开传
  visibleTools?: readonly string[]              # 已解析的可见工具名（allowedToolNames 的结果）
  #   ⚠️ 必须**惰性取值**：allowedToolNames 有成本，只在 **0 行分支**才求值（SC-20）。
  #   传普通入参会在每次响应都调一次 → 违 SC-20 与 §8 成本口径。实现形态：
  #   visibleTools: () => allowedToolNames(identity, policy)，在 buildEmptyResultNextStep 内按需调用。
}): NextStep | null:
  if input.toolName != "lucy_query": return null
  if typeof input.rowCount !== "number": return null      # 未知行数 ≠ 空结果
  if input.rowCount > 0: return null

  scopeConflict = input.scopeIntersectionEmpty === true

  # --- query：白名单构造（D11），缺字段的键整体省略，不填 null ---
  p = input.provenance ?? {}
  query = {}
  if p.connectionId != null: query.connectionId = p.connectionId      # 标量
  if p.sourceName != null: query.sourceName = p.sourceName            # 标量
  if p.orderBy != null: query.orderBy = p.orderBy                    # 字符串数组
  query.measures = shapeStringOrExprList(p.measures)                  # 字符串原样；对象项只保留 expr
  query.dimensions = shapeStringOrExprList(p.dimensions)
  if input.filtersSummary != null: query.filters = input.filtersSummary   # 去值摘要（不含任何 filter 值）
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
    hint: next_tools.length > 0 ? EMPTY_RESULT_HINT : NO_TOOL_HINT   # D10
  }
```

```text
# Proxy 装配（webui/server/proxy/mcp-proxy.ts）
#
# ⚠️ originalUserFilters 的**捕获点必须在改写之前**：
#    lucy_query 的 forced_filters 注入会改写 toolArgs——
#    `record.filters = [...forcedExprs, ...existing]`（webui/server/proxy/row-policy.ts:738），
#    改写发生在 mcp-proxy.ts:4182-4183（`applyLucyQueryForcedFilters`），且与 :5998 同在
#    handlePost（:3346）的作用域内 ⇒ 走到 withLucyResultMeta（:2643）时，
#    `args.filters` **已经是改写后的值**（含行策略强制谓词）。
#    若不在改写前抓原值，D6「回显改写前的用户 filter」就会把**行策略谓词写进模型可见载荷**，
#    违反 SC-14（谓词不得出现在模型可见位）。
#
# 正确落点：在 mcp-proxy.ts:4182 之前抓 originalUserFilters，再随调用透传。
function withLucyResultMeta(payload, requestId, toolName, args, sourceRefs, visibleTools, originalUserFilters, scopeIntersectionEmpty):
  enveloped = ensureJsonRpcEnvelope(payload, requestId)
  resultRecord = enveloped.result
  inspected = inspectRowsAndColumns(resultRecord)          # 上游 result 子树，不含我们的注入

  next_step = buildEmptyResultNextStep({
    toolName,
    rowCount: inspected.rows ?? null,
    scopeIntersectionEmpty,
    provenance: withoutFilters(provenanceOf(args, sourceRefs)),       # 不含 filters
    filtersSummary: originalUserFilters === undefined ? null : summarizeFilters(originalUserFilters),
    visibleTools
  })

  lucyNextStep = undefined
  skippedReason = undefined
  if next_step != null:
    if resultRecord.isError === true:
      skippedReason = "result_is_error"                                   # D13
    else:
      text = resultRecord.content?.[0]?.text
      parsed = tryParseJsonObject(text)
      if parsed == null:
        skippedReason = "content_text_not_json_object"                    # D4
      else if hasOwn(parsed, "next_step"):
        skippedReason = "upstream_next_step_present"                      # D12
      else:
        resultRecord.content[0].text = JSON.stringify({ ...parsed, next_step })   # 1) 模型可见位
        if isPlainObject(resultRecord.structuredContent):
          resultRecord.structuredContent = { ...resultRecord.structuredContent, next_step }   # 2) 结构化位
        lucyNextStep = next_step                                          # 3) 合同位（三处同生同灭）

  # `_meta.lucy` 是**全新字面量**：按现行实现（mcp-proxy.ts:2675-2719）逐字段重建，
  # 并在**同一个字面量里**追加 next_step / next_step_skipped_reason。
  # 不得 spread 任何既有 `_meta.lucy`，也不得写 `resultRecord._meta.lucy.next_step = ...`。
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

- 既有返回路径是 `_meta: { ...existingMeta, lucy: { ...全新字面量 } }`（`webui/server/proxy/mcp-proxy.ts:2675-2719`）——`existingMeta` 只在 `_meta` 层展开，`lucy` 是**全新对象**。
  → **`next_step` 必须写在 `lucy` 字面量内部**；写成 `resultRecord._meta.lucy.next_step = ...` 会落到被丢弃的旧对象上（SC-09 必挂）。
  → **不得 spread 既有 `_meta.lucy`**（那会把上游既有 `lucy` 字段带进来，改变 Spec 162 §7.5 治理的形状）；本条只**新增** `next_step` / `next_step_skipped_reason` 两个键。
- 上游**可能没有** `_meta`（`existingMeta` 此时是 `{}`）→ 直接访问 `resultRecord._meta.lucy` 会 TypeError → 落 2887-2890 降级 → **整个特性静默消失**。
  → **不得**假设 `_meta.lucy` 存在；一律在 `lucy` 字面量里构造。
- 判定用 `inspected.rows`（上游 result 子树，**注入前**算），不依赖注入后的 body。
- 三处落点**同生同灭**（D4）：`lucyNextStep` 只在模型可见位成功注入时才被赋值。
- 不发任何真实数据查询：全部输入来自本次请求已解析的对象。

## 7. 验收（本条出口）

| ID | 断言 |
|---|---|
| SC-01 | `buildEmptyResultNextStep` 对 `lucy_query` + `rowCount=0` 返回非空 `next_step`，`kind="empty_result"` |
| SC-02 | 对 `rowCount=3` 返回 `null`（有数据不带指导） |
| SC-03 | 对 `rowCount=null` / 缺省返回 `null`（未知行数不判空） |
| SC-04 | 对非 `lucy_query` 工具返回 `null` |
| SC-05 | `query` 只含存在的键；缺字段的键**被省略**而非填 `null`；`query.filters` 为**去值摘要**，且形状与 `summarizeFilters` 真实输出**逐项一致**（`kind=list\|single`；`count` 为全量条数；`items` ≤ 8；`structured` 项含 `kind`，`field`/`op` 仅在安全正则满足时出现；`expression` 项**只有** `kind`/`length`）；**不含**任何 filter 值 |
| SC-06 | `next_tools` 只含传入的可见工具；传入可见清单里没有的工具**不出现**；**没有任何 `*` 通配语义** |
| SC-07 | `scopeIntersectionEmpty=true` 时 `kind="scope_intersection_empty"`，`suggestions` **不含**泛化的「放宽过滤条件」那条，含交集专用那条，且**不含**「该字段取值不在授权范围内」这类**预设成因**的表述 |
| SC-08 | `summary` / `hint` 不含「数据错误」「数据缺失」等结论性判断 |
| SC-09 | Proxy 层：`lucy_query` 0 行响应的 `result._meta.lucy.next_step` 存在且 `kind="empty_result"`；`result.content[0].text` 解析后含 `next_step` 键，且 `headers`/`rows`/`totalRows` 取值与上游原文**一致** |
| SC-10 | Proxy 层：上游同时返回 `structuredContent` 对象时，其 `next_step` 与另两个落点**内容一致** |
| SC-11 | Proxy 层：**非空**结果响应的 `content[0].text` 与 `structuredContent` **逐字节不变**，且 `_meta.lucy` **不含** `next_step`；`content` 数组**长度不变**（不追加块） |
| SC-12 | Proxy 层：上游 `content[0].text` **不是 JSON 对象**时，**三个落点都没有** `next_step`，且 `_meta.lucy.next_step_skipped_reason="content_text_not_json_object"`（**同生同灭**，D4） |
| SC-13 | Proxy 层：富化抛错时，响应体**等于上游原文**且不含 `next_step`（既有降级路径不被破坏） |
| SC-14 | Proxy 层：`next_step` 载荷**只由本 Spec 定义的键构成**——`query` 顶层只有 `connectionId`/`sourceName`/`orderBy`/`measures`/`dimensions`/`filters`；`measures`/`dimensions` 的对象项**只保留 `expr`**；载荷内**不含** `rows`/`totalRows`/`columns`/`headers` 键；审计 `response_row_count` 与上游原文一致 |
| SC-15 | 术语标准 **§4.8（MCP 调试台 / ACL 裁决可见性，表格末行 `Effective Permissions Snapshot` 之后）** 已登记 `Next Step` / `Empty Result` / `Suggestion` 三行，既有 `Scope Intersection Empty` 行已补注「第二处承载：`next_step.kind`」；`Next Step` 行含「不得与 `Repair Hint` 混用」的禁止文案；`lint:spec-docs` 对本文件闭口层级与 stale-status 通过 |
| SC-16 | `lint:terminology` 通过 |
| SC-17 | `next_tools` 为空时，`suggestions` 仍为三条，`hint` **明确表达**「当前角色没有可用的核对工具」 |
| SC-18 | Proxy 层：上游 200 且 `result.isError === true` 时，三处**都不发** `next_step`，`next_step_skipped_reason="result_is_error"` |
| SC-19 | Proxy 层：上游 `content[0].text` **已带** `next_step` 键时，上游原值**逐字节不变**、三处都不发 `next_step`，`next_step_skipped_reason="upstream_next_step_present"` |
| SC-20 | Proxy 层：`allowedToolNames` **只在 0 行路径**被求值——有数据或非 `lucy_query` 的响应不触发可见性裁决 |
| SC-21 | 纯函数层：`measures`/`dimensions` 传**对象项**时，`query` 内该项**只剩 `expr`**，其余键不出现；传字符串项时原样保留 |

## 8. 风险与回滚

| 风险 | 说明 | 缓解 |
|---|---|---|
| **数据文本被重新序列化** | `content[0].text` 走 `JSON.parse` → 加键 → `JSON.stringify`，键序保留、值语义不变，但字符串规范化（`\uXXXX` 转义还原、数字字面量规范化） | SC-09 / SC-11 断言 `headers`/`rows`/`totalRows` 取值与上游一致；非空响应**逐字节不变**（SC-11）；本条**不改**上游取值 |
| **重新序列化的真实副作用（比「仅字符串规范化」更多）** | ① 整数样键名（`"2"`/`"1"`）在 `JSON.parse` 后按 JS 语义**重排**，键序不保留；② 非有限数字会被改值——`1e400` → `Infinity` → `null`、`1e-400` → `0`（下溢），这**是值语义变化**，不只是字符串规范化；③ 重复键被折叠（`{"a":1,"a":2}` → `{"a":2}`） | 这三项只影响**上游 JSON 的书写形式**，不影响 `headers`/`rows`/`totalRows` 的取值；SC-09 / SC-11 断言取值一致而非字节一致（**非空响应才是字节一致**）。**已在 §5.2 写明**，实施者不得以「仅字符串规范化」为由跳过核对 |
| **上游自带 `next_step` 键被覆盖** | `{...parsed, next_step}` 会原地覆盖上游自己的 `next_step`（键位保留、值被换掉） | D12：检测到已有 `next_step` 即**拒绝注入**，记 `next_step_skipped_reason="upstream_next_step_present"`，上游取值逐字节不变（SC-19） |
| **模型可见性仍可能落空** | 极少数客户端可能只渲染 `structuredContent` 或只渲染首个 content 块 | 单块内加键使模型与数据同处一段文本，是三种落点里可见性最强的一种；`structuredContent` 同步加键覆盖结构化优先的客户端；`_meta.lucy` 兜底供审计侧读。**三处同生同灭**（D4）保证「审计说已下发 ⇔ 模型确实收到」 |
| **指导不可见（富化抛错）** | 富化异常时整体回落上游原文 | fail-safe（不出现半截结构）；SC-13 固化该行为；审计可查 |
| **模型把指导读成数据** | `next_step` 与数据同处一个 JSON | `next_step` 是具名键，不是行数据；`hint` 明示不要用近似值顶替 |
| **回显请求面带出敏感值** | `query.filters` 若回显原值会带出 filter 值 | D6：**去值**摘要（`kind`/`field`/`op`/`valueCount`），复用 `audit-privacy` 的既有纪律；行策略谓词完全不出现 |
| **载荷混入用户自定义键** | `measures` 的对象项只校验「含 `expr`」，其余键不限制 → 用户可把 `rows` 塞进 measure 对象，经 `boundedProvenanceValue` 逐键复制进入模型可见位，污染按键名递归匹配的审计行数 | D11：**白名单构造**——`query` 顶层只允许 6 个键，measure/dimension 对象项**只保留 `expr`**；从构造上排除用户键（SC-14 / SC-21） |
| **指导越权泄漏** | 可能带出角色不可见的 source | 候选只来自 ACL 已解析的 `sourceRefs` 与自身 provenance；`next_tools` 按 `allowedToolNames` 过滤（SC-06） |
| **建议方向错** | 泛化建议会把 Agent 引向无关方向；**预设成因的文案会输出假事实**（用户自身等值条件互斥时，「取值不在授权范围内」为假） | D7：按 `scopeIntersectionEmpty` 分流 `kind` 与建议（SC-07），且 summary 与建议**不预设成因** |
| **语义漂移** | 模型可能把「建议」当结论 | 只提示不阻断（D2）；`summary`/`hint` 不含结论性判断（SC-08） |
| **可见性裁决的额外开销** | `allowedToolNames` → `ensurePolicyRuntime()`（`acl.ts:2897-2901`）；`degradedGlobal` 态下会**每次重编译策略** | **只在 0 行路径求值**（D5 / SC-20）：行数在装配前判定，非 0 行不调用可见性裁决 |
| **回滚** | —— | 去掉 `withLucyResultMeta` 里的 `next_step` 装配与三处注入即可；不改上游取值、不改审计字段、无数据迁移 |

## 9. 关联

- 需求池：[`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) REQ-030-018
- 分支计划：[`lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md`](../plans/lucy-20261107-mcp-next-step-guidance-and-journey-eval-plan.md)
- 实施计划：[`lucy-20261107-empty-result-next-step-guidance-plan.md`](../plans/lucy-20261107-empty-result-next-step-guidance-plan.md)
- 第 1 轮评审与裁定：[`docs/reviews/2026-11-07-empty-result-next-step-guidance-review.md`](../reviews/2026-11-07-empty-result-next-step-guidance-review.md)（**入库**；第 1 轮裁定、修订决定与横切批评审处理）｜原始 findings 与裁定草稿在本机 `inbox/`（临时件，**不入库**）
- 修复提示合同：[`webui/docs/162-customer-query-experience-and-usage-evidence-spec.md`](../../webui/docs/162-customer-query-experience-and-usage-evidence-spec.md)
- Proxy 协议：[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md)
- 术语标准：[`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) §4.8
