# 访问关系图与访问日志口径对齐 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.3** |
| 日期 / 目标版本 | 2026-11-02 / 不绑定产品版本号。不升 Spec 187 版本号，不进入 v0.25 登记册 |
| 功能编号 / 优先级 | **无** / **P1**（访问关系图工具条与访问层筛选口径） |
| 状态 | **v0.3 功能合同已收口（2026-11-04）**。S1–S3 已落地；SC-01–SC-20 关闭；证据见 [实施笔记](../reviews/2026-11-04-access-map-audit-echo-implementation-notes.md)。本条收口不表示可上线。原 Deferred → [`REQ-030-003`](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) 已拉出并实施完成。剥离背景见 [A／B](../reviews/2026-11-03-product-close-peel-a-b.md) |
| 决策来源 | 2026-11-02 对 `http://127.0.0.1:55176/admin/access-map?trust=include_candidate` 的反馈：①筛选器行不对齐；②「问询计入」分段控件突兀。澄清后拍板 **方案 B**：桑基图是访问日志／调用流水的可视化，不得另造核心分类；维度与数量须呼应。Codex 第 1 轮退回（高 3／中 2）→ v0.2；第 2 轮退回（中 2：结构筛选后 meta、deny 集合 D）→ v0.3 闭合 |
| 需求来源 | 治理台访问关系图应让管理员用与访问日志相同的管理语言筛选访问面；关联质量口径可保留，但不得冒充「问询」主筛选 |
| 实施主体 | Lucy WebUI：`webui/server/admin/access-map.ts`、`webui/src/pages/admin/AccessMap.tsx` 及相关组件／测试。不修改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **修订访问层候选调用集合及其默认筛选**（不仅是呈现）。在 Spec 187 原有时间窗、`trust`、Token 条件上**相与**问询种类与访问等级，再按原五元组构建访问路径。路径主键、角色归因、守恒算法、边状态判定顺序不变。权威骨架语义仍以 [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md) 为准；实施时同步修订其 §4.2、§5.2、§6.3、§7.4 的有效指针。问询种类／访问等级枚举复用 [`lucy-20261102-audit-inquiry-kind-spec.md`](lucy-20261102-audit-inquiry-kind-spec.md) 与 Spec 194 的 `accessGrade`，**不另起枚举**。图面几何沿用 geometry；页壳弱入口沿用 chart-first |
| 实施计划 | [`docs/plans/lucy-20261102-access-map-audit-echo-plan.md`](../plans/lucy-20261102-access-map-audit-echo-plan.md)（**v0.4**） |
| 审阅 | [`docs/reviews/2026-11-02-codex-review-access-map-audit-echo.md`](../reviews/2026-11-02-codex-review-access-map-audit-echo.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：访问关系图工具条与访问层筛选使用与访问日志同一套「问询种类／访问等级」词汇与缺省；「关联口径」（原「问询计入」／`trust`）降为弱入口；筛选行单行对齐；进入访问路径构建的允许调用集合 E 可按合同打假，不以另一套分类伪造数量；当前筛选下无访问路径不得表述为「全量日志无访问」。
- 本条出口：SC-01–SC-20。服务端测试打假关联链路、投影集合 E、跨边并集、非法 URL；组件测试打假工具条、弱入口、文案。
- 不在本条出口：浏览器走查、Playwright、窄屏、镜像构建、部署、客户环境；Spec 187 全量历史 SC 的重新执行；把问询种类筛选项反向加进调用流水 Tab；改凭证清单 Spec 189 Default Usage 口径。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 问询种类、真实问询、未上报问询、会话访问、访问等级、已确认关联、候选关联、授权路径、访问路径沿用既有术语。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 主工具条下拉 | 问询种类 | 与访问日志问询记录 Tab 相同五选项 |
| 主工具条下拉 | 访问等级 | 与访问日志调用流水 Tab 相同选项集 |
| 弱入口选择 | 关联口径 | 取代工具条「问询计入」。已确认关联／含候选关联 |
| 弱入口现状行 | 关联口径：… · 问询种类：… · 访问等级：… | 放在「口径与快照」 |

Forbidden:

- 继续用「问询计入」作为主工具条标签、分段控件标题或图例前缀。
- 把关联口径选项写成问询种类三值，或把问询种类写成已确认／候选。
- 新增第三套访问分类枚举。
- 声称「访问路径数 = 问询记录行数」或「访问路径数 = 调用流水行数」。可对齐的是集合 E（去重允许调用 id）与边上的 `accessCalls`；`accessPaths` 是路径去重。
- 在缺省／收紧筛选下把「图上无访问路径」写成「系统无访问」或「日志为空」。

`Agent`、连接名、表名、角色 id、Token、`Schema` 继续 `translate="no"` + `notranslate`。问询种类与访问等级中文值不包进 `notranslate`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- [`docs/specs/lucy-20261101-access-map-chart-first-spec.md`](lucy-20261101-access-map-chart-first-spec.md)
- [`docs/specs/lucy-20261102-audit-inquiry-kind-spec.md`](lucy-20261102-audit-inquiry-kind-spec.md)

### What This Change Follows

- [ ] 主工具条筛选使用现有 `pl-input` 下拉；统计窗口保留 `pl-segmented-control`；不新做控件族
- [ ] 筛选行单行：每列「标签 + 控件」，控件底边对齐；禁止列内多行说明
- [ ] 「关联口径」说明只在「口径与快照」
- [ ] 问询种类／访问等级文案与访问日志下拉一致

### Exceptions (If Any)

- 统计窗口继续分段控件；Schema 层继续下拉。
- Spec 187 的 `trust` 参数名保留；UI 标签改为「关联口径」。
- 访问关系图 URL 对非法 `inquiryKind`／`accessGrade` **返回 400**（与 Spec 187 其它参数一致，分享链接不静默改写）。这与访问日志对这两参数的「非法回落缺省」不同；缺省仅在**参数缺省未出现**时由服务端按 management／exclude_connect 解析。差异必须在文档与 SC-19 写明。

### Follow-up Needed

- None 于本条。

---

## 1. 背景

访问关系图访问层从 `access_log`（及 `access_log_sources`）构图。访问日志已用「问询种类」「访问等级」做管理默认筛选。关系图工具条却把 `association_status` 做成醒目的「问询计入」分段，并挂两行说明，导致语言错位、行不对齐、与日志默认调用集合无法对账。

## 2. 目标

1. 主工具条：问询种类、访问等级下拉；缺省与访问日志一致（参数缺省时 management、exclude_connect）。
2. 「问询计入」→ 弱入口「关联口径」；默认仍 `trust=confirmed`。
3. 筛选行单行对齐。
4. 冻结投影集合 E 与跨边并集合同，测试可打假。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改路径主键、角色归因、守恒、边状态判定顺序 | Spec 187 |
| 改图面几何／chart-first 去 KPI | 另有 Spec |
| 删除 `trust` 或改默认 `confirmed` | 信任边界仍要 |
| 宣称路径数＝问询数或＝流水行数 | 粒度不同 |
| 改写 association_status 写入 | Spec 173 |
| 改 accessGrade 工具名单 | Spec 194 |
| 改凭证清单 Default Usage | Spec 189 |
| 给调用流水 Tab 补问询种类筛选 | 不在本条 |
| 浏览器／镜像／客户环境 | 不在出口 |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | 访问面筛选词汇复用问询种类与访问等级，不另造主分类 | 拒绝「问询计入」主控件 |
| D2 | 主工具条：统计窗口 → Schema 层 → 问询种类 → 访问等级 → 定位 | 与日志语言对齐 |
| D3 | 参数**缺省**时 `inquiryKind=management`；UI 选项与审计相同 | 复用 `inquiryKindOfTurn`／`inquiryKindMatches`；**非法值 400**（见 D10） |
| D4 | 参数**缺省**时 `accessGrade=exclude_connect`；复用 `accessGrade`／`accessGradeSql` | **非法值 400** |
| D5 | 关联口径退出主工具条，进入「口径与快照」；禁止「问询计入」标签 | 保留 `trust` 名与默认 confirmed |
| D6 | **关联链路（唯一）**：优先非空 `access_log.lucy_turn_id` → `conversation_turns`；仅显式键为空时经 `inferred_turn_access_logs.access_log_id` → `inferred_turns`。禁止用展示流水号、Session ID、时间邻近另推。读取前必须完成与审计问询列表相同的既有推断重建准备；准备失败 → 访问层 `unavailable`（不得空结果冒充无关联）。准备后仍无对应问询的调用，在 `inquiryKind ≠ all` 时排除。`inquiryKind=all` 只解除种类限制 | 与审计 `attachInferredTurnIds` 同序；失败关闭 |
| D7 | 访问等级只经 `accessGrade(tool)`／`accessGradeSql`，禁止第二份名单 | |
| D8 | **候选 B／允许 E／拒绝 D**：同一时间窗、trust、Token、D6 问询关联与种类、访问等级、存在 ≥1 条 `access_log_sources` 形成候选调用集合 **B**（半开区间 `al.ts ∈ [startIso, endIso)`）。其中 `outcome='allow'` 构成 **E**，`outcome='deny'`（及其他非 allow）构成 **D**。E 进入访问路径构建；D **不**进入访问路径。`deniedCalls`（或既有等价字段）按调用 id 去重统计 **\|D\|**，范围同为结构筛选前。`meta.echo.enteringAllowCallCount = \|E\|`，且须明示属于结构筛选前。边 `e` 的调用 id 集合 `I(e)`：结构筛选前全量访问边满足 `⋃ I(e) = E`；`accessCalls(e) = \|I(e)\|`。**禁止**把各边 `accessCalls` 相加当作全局调用数。scope／focus 后返回边的调用并集允许为 E 的子集，但 **enteringAllowCallCount 仍为 \|E\|**，不得改成局部数量；切换 `layer=flat\|schema` 不改变 E。`accessPaths` 始终是去重五元组路径数 | 诚实粒度；保留 Spec 187 deny 单独计数 |
| D9 | 筛选行内无关联口径长说明 | |
| D10 | URL：`inquiryKind`、`accessGrade` 与既有参数一并分享。**缺省未出现** → 用 D3／D4。**非法值 → 400**（与 Spec 187／现路由一致，不静默纠正）。这与审计页对这两参数的非法回落不同，属有意差异。`trust` 非法仍 400 | 分享链接诚实 |
| D11 | 呼应对象是投影集合 E，**不是**任一审计 Tab 的现成行数。对照审计原始调用时：须允许协议调用进入候选后再套访问等级；种类、trust、allow、表源是本条显式投影。自动化必须用真实 provider SQL 与**预先写定的调用 id 期望集**逐项比较；共享谓词只能作附加校验 | 防自证通过 |
| D12 | Token／问询种类／访问等级只滤访问面；授权骨架不变 | |
| D13 | 本条修订候选调用集合，不仅呈现。同步 Spec 187 §4.2／§5.2／§6.3／§7.4 指针。筛选后零访问路径 ≠ 原始日志无访问 | |

## 5. 界面与 URL

### 5.1 工具条布局

```
[统计窗口] [Schema 层] [问询种类] [访问等级] [定位]
```

- `flex flex-wrap items-end gap-x-6 gap-y-3`；每列仅标签 + 单行控件。
- test id：`access-map-inquiry-kind`、`access-map-access-grade`；弱入口关联口径保留 `access-map-trust`。
- 删除主工具条 `access-map-trust-hint`。

### 5.2 弱入口「口径与快照」

| 内容 | 要求 |
|---|---|
| 关联口径控件 | 已确认关联／含候选关联；`data-testid="access-map-trust"` |
| 说明 | 「授权连接始终显示。关联口径只影响访问面：默认只计已确认关联；含候选关联时，候选关联上的允许调用也计入访问。」 |
| 现状 | 关联口径／问询种类／访问等级中文 |
| 空访问提示 | 若 E 为空但授权骨架非空，提示须提及当前问询种类或访问等级，不得写「无访问日志」 |

`access-map-legend-trust` → `关联口径：{label}`，禁止「问询计入：」。

### 5.3 URL

| 参数 | 取值 | 缺省（未出现） | 非法 |
|---|---|---|---|
| `inquiryKind` | management／real／unreported_query／session_visit／all | management | 400 |
| `accessGrade` | exclude_connect／all／connect／browse／prepare／ask／query／control／unclassified | exclude_connect | 400 |
| `trust` | confirmed／include_candidate | confirmed | 400 |

## 6. 核心流程（伪代码）

```ts
import { inquiryKindOfTurn, inquiryKindMatches } from "./audit-inquiry-kind.js";
import { accessGrade, accessGradeSql } from "../proxy/usage-classification.js";

type EchoFilter = {
  window: { startIso: string; endIso: string }; // half-open [start, end)
  trust: "confirmed" | "include_candidate";
  inquiryKind: InquiryKindFilter; // absent → management; illegal → 400 before here
  accessGrade: string;            // absent → exclude_connect; illegal → 400
  tokenLabel: string | null;
};

/** Same order as audit attachInferredTurnIds */
function resolveTurn(row: AccessLogRow, db: Db): TurnRow | null {
  if (row.lucy_turn_id) return loadConversationTurn(db, row.lucy_turn_id);
  const inferredId = lookupInferredTurnAccessLog(db, row.id);
  if (inferredId) return loadInferredTurn(db, inferredId);
  return null;
}

function ensureInquiryRebuildOrUnavailable(db: Db): void {
  // Same prep as audit turns list. On failure: access side state = unavailable.
}

function buildBandED(f: EchoFilter, db: Db): { B: Set<CallId>; E: Set<CallId>; D: Set<CallId> } {
  ensureInquiryRebuildOrUnavailable(db);
  const B = new Set<CallId>();
  const E = new Set<CallId>();
  const D = new Set<CallId>();
  for (const row of loadRowsWithSources(f.window, f.trust, f.tokenLabel)) {
    if (!passesAccessGrade(row.tool, f.accessGrade)) continue;
    if (f.inquiryKind !== "all") {
      const turn = resolveTurn(row, db);
      if (turn == null) continue;
      if (!inquiryKindMatches(inquiryKindOfTurn(turn), f.inquiryKind)) continue;
    }
    // has sources already enforced by loadRowsWithSources
    B.add(row.id);
    if (row.outcome === "allow") E.add(row.id);
    else D.add(row.id);
  }
  return { B, E, D };
}

// Path build uses E only. deniedCalls = |D| (deduped call ids), pre-structure.
// After path build from E, before scope/focus:
//   meta.echo.enteringAllowCallCount === E.size (labeled pre-structure)
//   union of I(e) over all access edges === E
// After scope/focus: returned union ⊆ E; enteringAllowCallCount still |E|
// layer flat/schema must not change E
```

## 7. 验收矩阵

| ID | 断言 | 证据 |
|---|---|---|
| SC-01 | 主工具条无「问询计入」；无其双选项主位分段 | 组件 |
| SC-02 | 有问询种类、访问等级下拉；选项文案与审计一致 | 组件 |
| SC-03 | 参数缺省时服务端按 management／exclude_connect 构图；组件请求可不写参数 | 服务端 + 组件 |
| SC-04 | 弱入口有关联口径控件与「只影响访问面」说明 | 组件 |
| SC-05 | legend-trust 为「关联口径：…」，无「问询计入」 | 组件 |
| SC-06 | 筛选行无旧 trust-hint 多行说明 | 组件 |
| SC-07 | 切换问询种类写 URL 并重请求 | 组件 |
| SC-08 | 切换访问等级写 URL 并重请求 | 组件 |
| SC-09 | 关联口径写 `trust`；默认 confirmed；可切 include_candidate；非法 trust → 400 | 组件 + 服务端 |
| SC-10 | 仅推断关联的会话访问允许表调用：缺省 inquiryKind 不进 E；session_visit 或 all 可进。夹具走推断键，不靠显式 lucy_turn_id | 服务端 |
| SC-11 | 连接级工具调用：缺省 accessGrade 不进 E；connect 或 all 且仍有 sources 时可进。对照时期望集含协议调用候选再套等级 | 服务端 |
| SC-12 | 关联链路：显式关联、仅推断、二者同时（显式优先）、悬空显式键、无关联。management 下无关联不进 E；all 下可进。覆盖先开关系图／先开审计页顺序下重建准备后结果一致；重建失败 → unavailable | 服务端 |
| SC-13 | 真实 SQL 得到的 E 与夹具预写期望 id 集逐项相等（含时间上界半开、数量同但 id 不同必须失败）。meta.enteringAllowCallCount=\|E\| | 服务端 |
| SC-14 | 结构筛选前 ⋃I(e)=E；不得用 Σ accessCalls 冒充 \|E\|；改变候选集合但路径去重／归因规则不变；多角色／多表／同路径多调用夹具。夹具 E={a,b}：scope／focus 后仅保留含 a 的边时，返回并集为 {a}，`enteringAllowCallCount` 仍为 2 且标明结构筛选前；切换 flat／schema 不改变 E；逐边 `accessCalls(e)=\|I(e)\|`。候选 B 中 deny 构成 D：匹配／不匹配新增筛选的 deny、多表源重复 deny 均不进 E，但 `deniedCalls=\|D\|`（去重）正确；loadAccessSide 不得因「只返回 E」而把拒绝计数归零 | 服务端 |
| SC-15 | 仅改 inquiryKind／accessGrade 时授权骨架不变 | 服务端 |
| SC-16 | 无 access-map 私有第二份种类／等级枚举；复用既有模块 | 服务端／静态 |
| SC-17 | 工具条各列仅标签+单控件 | 组件 |
| SC-18 | 可见文案无「问询计入」；E 空时提示不声称全量无访问 | 组件 |
| SC-19 | 非法 inquiryKind 或 accessGrade → 400；与非法 trust 同时出现仍 400；文档写明与审计非法回落的差异 | 服务端 |
| SC-20 | Spec 187／chart-first 指针已更新（§4.2／§5.2／§6.3／§7.4 与工具条／弱入口） | 文档检查（S3） |

## 8. 对既有 Spec 的指针修订

| 文档 | 修订 |
|---|---|
| Spec 187 §4.2、§5.2、§6.3、§7.4 | 候选集合增加 inquiryKind／accessGrade；图例「问询计入」→「关联口径」；主筛选呈现改指本 Spec |
| chart-first | 工具条两下拉；弱入口关联口径 |
| 术语标准 | 退役「问询计入」产品句，指向关联口径 |

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 缺省变严图变空 | 空态提示点名筛选；demo 夹具覆盖查数 |
| D6 重建失败被当成无数据 | unavailable 降级，SC-12 |
| 与审计非法回落不一致 | D10／SC-19 明示 |
| 凭证清单数字 ≠ \|E\| | Spec 189 不变；文档写明 |

---

**定稿条件：** Codex 两轮已完成；第 2 轮 R3 残留与 N1 已按可贴句写入 D8／§6／SC-14。**2026-11-04 实施完成并功能合同已收口**（Plan v0.4；S1–S3；SC-01–SC-20 关闭）。本条收口不表示可上线。
