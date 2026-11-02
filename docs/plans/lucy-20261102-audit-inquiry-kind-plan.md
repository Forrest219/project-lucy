# 访问日志问询种类与访问等级 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.4** / 2026-11-02 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [`docs/specs/lucy-20261102-audit-inquiry-kind-spec.md`](../specs/lucy-20261102-audit-inquiry-kind-spec.md)（**v0.4 已实施，功能合同未收口。本条收口不表示可上线**） |
| 权威语义 | Spec 172 / 173 的库存摘要与来源徽章；Spec 194 的 `accessGrade`。本 Plan 不改重建、回绑和用量 KPI |
| 状态 | **v0.4 已实施，功能合同未收口。本条收口不表示可上线**。S1–S4 已落地 |
| 授权边界 | 2026-11-02 用户批准落地。范围是审计读取、问询记录、调用流水、两份 CSV、字段说明和术语标准 §4.7。不授权镜像、部署、浏览器走查、KTX、使用概况 KPI、git commit |
| 验收 | 以主 Spec §7 SC-01–SC-25 为准 |
| 实施主体 | Lucy：`webui/server/admin/audit.ts` 与 `webui/src/pages/admin/Audit.tsx` |
| 待拍板 | 已关闭。Codex 第 3 轮可定稿。D1–D16 以主 Spec §4 为准。定稿不授权开发 |

## 1. 目标

让访问日志的两个页签用和 Spec 194 对齐的粒度做管理：

1. 问询 ID 改为本实例流水号。旧的 `lucy_<uuid>` 与 `inf_<userId>_<id>` 降为关联键。
2. 问询记录增加问询种类，默认去掉会话访问。
3. 调用流水增加访问等级，默认去掉连接级。问询 ID 与问询记录用同一流水号。
4. 筛选在分页前生效，导出跟随筛选。库存摘要不回写，已有 `lucy_turn_id` 不改写。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.4 已落盘，D1–D16 可直接实施 | 满足 |
| P2 | 用户明确授权改 `webui/server` 与 `webui/src` | 满足（2026-11-02） |
| P3 | 基线可跑：`webui/server/__tests__/admin-audit.test.ts`、`webui/src/__tests__/audit.test.tsx`、`webui/src/__tests__/admin-audit-turns.test.tsx` | 开工时确认 |

未满足 P2 时停在文档。不提前改 `Audit.tsx`。

## 3. 文件落点

### 3.1 预计修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/server/admin/audit-inquiry-serial.ts` | 新建。分配、补号、按流水号或关联键查找 | S1 |
| `webui/server/admin/audit-inquiry-kind.ts` | 新建。导出 `inquiryKindOfTurn` 与种类筛选 | S1 |
| `webui/server/proxy/audit.ts` | 库初始化、高水位、`writeConversationTurn` 同事务取号、推断重建删后重插时写回原号。不改聚类、摘要、成员和回绑 | S1 |
| `webui/server/admin/audit.ts` | 列表、调用列表、普通 CSV、字段说明、详情 / trace 先把流水号解析成关联键 | S1、S3 |
| `webui/server/admin/reconciliation.ts` | 单问询对账入口先解析流水号 | S1 |
| `webui/server/proxy/mcp-proxy.ts` | 只调用已取号的 `writeConversationTurn`。不改 `lucy_<uuid>`。不把展示号写入预算或 MCP 归因 | S1 |
| `webui/server/__tests__/admin-audit.test.ts` | SC-01–SC-13、SC-16、SC-19–SC-25 的读取、搜索、CSV 和导出包 | S1、S3 |
| `webui/server/__tests__/proxy-audit.test.ts` | SC-20、SC-24、SC-25 的重建与补号 | S1 |
| `webui/src/pages/admin/Audit.tsx` | 两列、两个首行下拉、摘要格、覆盖行、抽屉 | S2 |
| `webui/src/__tests__/admin-audit-turns.test.tsx` | SC-02、SC-04、SC-07、SC-14、SC-15、SC-23 的复制 | S2 |
| `webui/src/__tests__/audit.test.tsx` | 调用流水等级列与默认筛选 | S2 |
| `webui/docs/00-product-terminology-standard.md` | §4.7 登记问询种类、访问等级；改会话访问说明 | S4 |

### 3.2 不改

- `webui/server/proxy/audit.ts` 的聚类、`SESSION_VISIT_SUMMARY_PREFIX`、`UNREPORTED_QUESTION_SUMMARY` 和回绑禁令。该文件要改的只是发号和重建时保留流水号。
- `webui/server/proxy/usage-classification.ts` 的 `accessGrade` 名单。
- `webui/server/admin/daily-question-kpi.ts` 与使用概况页面。
- 来源徽章的两个文案。

## 4. 分阶段实施

### S1 问询种类读取与筛选

新建 `audit-inquiry-kind.ts`：

```ts
export type InquiryKind = "real" | "unreported_query" | "session_visit";
export type InquiryKindFilter = "management" | "real" | "unreported_query" | "session_visit" | "all";

export function inquiryKindOfTurn(turn: {
  source: "reported" | "inferred";
  questionSource?: string | null;
  questionSummary?: string | null;
}): InquiryKind

export function parseInquiryKindFilter(raw: string | null | undefined): InquiryKindFilter
export function inquiryKindMatches(kind: InquiryKind, filter: InquiryKindFilter): boolean
```

`inquiryKindOfTurn` 按 Spec §6：先认真实问询，再用 `SESSION_VISIT_SUMMARY_PREFIX` 认会话访问，其余为未上报问询。`parseInquiryKindFilter` 缺省和非法值都是 `management`。界面中文是「未上报问询」，不断言查数。

新建 `audit-inquiry-serial.ts`。持久化一张发号高水位，不从现存问询行的最大值推下一个号。`conversation_turns` 与 `inferred_turns` 的 `inquiry_no` 跨表唯一。`allocateInquiryNo(correlationKey)` 见到映射就返回原号；否则在同一写事务里取高水位加 1、写入问询行并推进高水位。事务回滚则号码不算发出。删除最大号、清空问询行、重启之后，下一个号仍大于高水位。

补号在任何新发号之前。先合并两表，排序时间取已上报的 `created_at` 或推断的 `started_at`，再按完整关联键。不对两表分别排序后拼接。补号、高水位和完成标记同一事务。只有完成标记可以跳过。没有标记但已有部分号码时失败关闭，不重编号。测试夹具：已上报 10:00 键 `lucy_b`、推断 09:00 键 `inf_a`、已上报 09:00 键 `lucy_a`。号码顺序是 `inf_a`、`lucy_a`、`lucy_b`。不由来源分组决定。`writeConversationTurn` 在 `proxy/audit.ts`，与取号同一事务。推断重建可以删后重插，插入时按关联键写回原号，不重新发号。

详情 `GET /api/admin/audit/turns/:turnId`、调用筛选、`association-revisions`、`reconciliation/inquiries/:turnId`、`trace/events?turnId=` 收到纯数字时先解析成关联键。旧关联键仍可直接用。预算和 MCP 归因只接受关联键。

列表、抽屉和复制按钮使用 `inquiryNo`。响应同时带 `correlationKey`。调用流水用 `lucy_turn_id` 或推断关联键查出同一个 `inquiryNo`，查不到则为空。搜索纯数字走流水号，含 `lucy_` 或 `inf_` 走关联键。

在 `listAuditTurnEntries` 里，现有 `filtered` 形成之后、分页之前：

1. 用 `displayedTurnIdentity` 之后的 `questionSummary` 计算 `inquiryKind`。
2. 先数三种 `kindCounts`。
3. 再按 `inquiryKindMatches` 过滤。
4. 分页和 `total` 使用过滤后的数组。

`GET /api/admin/audit/turns` 把 `inquiryKind` 传到 `TurnFilterQuery`。响应增加 `kindCounts: { real, unreportedQuery, sessionVisit }`。

先写失败测试再改实现。用例放在 `admin-audit.test.ts`：

- 夹具同时有已上报问询、未上报问询和会话访问。缺省列表保留前两者，排除会话访问。三者的 `inquiryNo` 是互不相同的正整数，文本不含 `lucy_` 或 `inf_`。
- 同一推断关联键删后重建、中间插入另一条后再重建、重启后再重建，`inquiryNo` 不变。
- 删除最大号并清空问询行后，下一个号仍大于高水位。两个连接同时发号不重复。插入失败回滚后该号不算发出。
- 补号中途失败全部回滚。没有完成标记但已有部分号码时再次初始化失败，不重编号。
- 未打开管理页时，第一次 `lucy_begin_question` 取到号。
- 带会话的纯 `lucy_catalog` 簇和纯准备簇仍各生成一条未上报问询。含 `lucy_query` 的推断问询种类仍是未上报问询，该调用的访问等级是查数。
- 问询号 12、另一关联键含 12、事件 ID 12 和 112：纯数字统一搜索只命中问询 12；`eventId=12` 只命中该事件。
- 流水号和关联键打开详情、调用筛选、关联修订、对账和 trace，五处结果一致。展示号不出现在预算状态里。
- 已上报行的摘要即使被写成「会话建立：x」，种类仍是 `real`。
- 非法 `inquiryKind=nope` 与缺省相同。
- 过滤后的 `total` 不等于过滤前的行数，且第一页不超过页大小。

出口：SC-01–SC-08、SC-16 的问询一半、SC-19–SC-21、SC-24。

### S2 问询记录与调用流水界面

问询表的「问询 ID」绑定 `inquiryNo`，不再绑定 `id`。抽屉问询 ID 用同一数字，其下增加次级「关联键」。复制按钮只复制流水号。

问询表在会话 ID 和问询摘要之间加「问询种类」。映射：`real` → 真实问询，`unreported_query` → 未上报问询，`session_visit` → 会话访问。复制按钮只写入流水号。事件搜索是单独输入，参数 `eventId`。

摘要格：`inquiryKind === "session_visit"` 时渲染「—」，否则保持 `questionPreview ?? questionSummary`。

首行增加下拉，`aria-label="问询种类"`，选项文案按 Spec §5.1。缺省不写 URL，表示 `management`。选「全部种类」写 `inquiryKind=all`。清除筛选时删掉该参数，回到管理相关。

覆盖行改为 Spec §5.1 的三数。`sessionVisit > 0` 且当前筛选排除会话访问时续写隐藏条数。

抽屉：基础信息显示问询种类。会话访问的摘要区使用「这次只有会话访问，没有问句。」

调用表在工具列前加「访问等级」。首行下拉 `aria-label="访问等级"`。缺省不写 URL，表示排除连接。选项值：`all`、`exclude_connect`、`connect`、`browse`、`prepare`、`ask`、`query`、`control`、`unclassified`。中文按 Spec §5.2。

组件测试用现有 fixture 加三种问询和一条 `initialize`。断言默认问询表没有「会话建立」，调用表默认没有「连接」，两个下拉都在首行容器而不是 `#audit-advanced-filters` 里。来源下拉的两个选项文本不变。

出口：SC-02、SC-04、SC-07、SC-11、SC-14、SC-15。

### S3 调用等级、CSV 与字段说明

调用查询在现有协议门之后、分页之前套 `accessGrade`。优先用已有 `accessGradeSql` 放进 SQL，使总数和分页一致。`exclude_connect` 是 `grade <> 'connect'`。`all` 不加等级条件。

问询 CSV 的「问询 ID」改为流水号，后一列插入「关联键」。再在「问询摘要」前插入「问询种类」，单元格用中文。同一行「问询摘要」继续写 `questionSummary`，会话访问仍是「会话建立：…」。调用 CSV 新增 `inquiry_no`，未挂接留空；保留 `lucy_turn_id` 与 `inferred_turn_id`。普通导出接收同一个筛选。

`export-inquiry-pack` 与 `export-pack` 不套用普通调用列表的排除连接。配对包从同一次问询结果带上流水号，包内非空 `inquiry_no` 必须出现在该包 turns.csv。证据包继续追加已关联握手。

调用 CSV 在「工具」前插入「访问等级」。`export-metadata` 的 `fields[]` 与表头同序，并把两个旧键标为关联键。

测试：

- 管理相关问询导出没有会话访问。`inquiryKind=all` 的会话访问行同时有种类「会话访问」、摘要「会话建立：」和以 `inf_` 开头的关联键。问询 ID 是流水号。
- 缺省调用导出没有 `initialize`。`accessGrade=all&includeProtocol=true` 的 `initialize` 行等级为「连接」。未知工具名是「未分级」。`accessGrade=query` 与调用来源可以同时生效。非法 `accessGrade` 按排除连接。
- `lucy_query` 为「查数」，`lucy_catalog` 为「浏览」。
- 普通调用 CSV 行集等于同一筛选的列表。字段说明列序与表头一致。
- 配对包在排除连接的普通筛选下仍保留已关联 `initialize`，且非空流水号都能在 turns.csv 找到。证据包同样保留已关联握手。
- 跑既有 `access-grade.test.ts`，断言不改。使用概况 KPI 响应字段的既有用例保持原期望。本阶段不改 `daily-question-kpi.ts`。

出口：SC-09–SC-13、SC-16、SC-17、SC-22、SC-23 的服务端一半。

### S4 术语标准

在 `webui/docs/00-product-terminology-standard.md` §4.7 增加问询种类、真实问询、未上报问询、访问等级、关联键。未上报问询写明不表示查数。问询 ID 那一行改为：值是实例内流水号，不携带 Agent 或平台；旧键称为关联键。Session Visit 行保留「禁止第三种来源徽章」，说明改为：管理列表用问询种类「会话访问」；库存摘要仍可以「会话建立：」开头。

跑 `npm run lint:terminology`。出口：SC-18。

## 5. 验收

| 阶段 | 命令 | 覆盖 |
|---|---|---|
| S1 | `cd webui && npx vitest run server/__tests__/admin-audit.test.ts server/__tests__/proxy-audit.test.ts` | SC-01–SC-08、SC-16、SC-19–SC-21、SC-24、SC-25 |
| S2 | `cd webui && npx vitest run src/__tests__/admin-audit-turns.test.tsx src/__tests__/audit.test.tsx` | SC-14、SC-15、SC-23 的复制 |
| S3 | 同一 `admin-audit.test.ts`，另跑 `server/__tests__/access-grade.test.ts` | SC-09–SC-13、SC-17、SC-22 |
| S4 | `npm run lint:terminology` | SC-18 |

全部阶段后再跑 `npm run lint:spec-docs`。本机测试通过只证明本条出口，不表示可上线。

## 6. 完成定义

- SC-01–SC-25 都有对应用例，且命令通过。
- 问询记录和调用流水的问询 ID 是正整数，不含 Agent 或平台。抽屉仍能看到关联键。
- 默认打开 `/admin/audit` 的问询记录看不到会话访问，筛选能把它们叫回。
- 默认调用流水看不到连接级，筛选能看回 `initialize`。
- `conversation_turns.question_summary` 与 `access_log` 无新列、无回写。
- 使用概况 KPI 源文件无 diff。

## 7. 风险

| 风险 | 处理 |
|---|---|
| 旧书签不带新参数，列表比以前少 | 这是 D5 / D7 的缺省。`inquiryKind=all` 与 `accessGrade=all` 恢复全量。覆盖行写出被隐藏的会话访问数 |
| 「显示协议调用」在默认等级下仍看不到握手 | Spec D8 写明两个条件都要满足。测试 SC-11 锁住 |
| 摘要前缀和种类各判一次导致漂移 | 种类只在服务端算，界面只读 `inquiryKind`，不自己看「会话建立：」 |
| `audit.ts` 继续变大 | 种类和流水号各放新文件；等级直接调用 `accessGrade`，不把工具名单抄进审计 |
| 补号被跑第二次导致号码全变 | 只有完成标记可以跳过。部分号码且无标记时失败关闭。测试锁住重建不换号 |
| 默认筛选改变现有测试夹具的行数 | 先改断言再改缺省，避免把「列表变短」误写成查询失败 |
