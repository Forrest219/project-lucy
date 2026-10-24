# 访问日志按会话对账

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问日志按会话对账 |
| 文档类型 | Product / Audit / API Spec |
| Spec 编号 | 172 |
| 版本 | v0.3 |
| 撰写日期 | 2026-10-13 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/admin/audit` 问询记录、调用流水、两份 CSV 与配对 zip；MCP Proxy 的问询补绑 |
| 关联工单 | `webui/docs/plans/wo-202610-23-audit-session-visit.md`。探测与一问一询的修订见 Spec 173、`webui/docs/plans/wo-202610-25-one-question-one-inquiry.md` |
| 上游 | Spec 138、Spec 140、Spec 141、Spec 162 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 问询按 MCP 会话切开。推断问询 ID 改为首条调用 ID。未上报原文的握手仍有一条会话访问。同一次导出写出两份 CSV |
| v0.2 | 由 Spec 173 实施。2 秒补绑改为同会话 120 秒。已上报调用不再另起推断问询。探测簇不进问询。工单 WO-202610-25 |
| v0.3 | 已知产品的 User-Agent 覆盖空自报名、`lucy` 和 `lucy-mcp-proxy`。`client` 记产品名和 User-Agent 版本，自报名另记。旧行读取时现算，不回写 SQLite。`undici` 与 `Python-urllib` 仍不改写 |

2026-10-13 批准：一次客户端访问必须能在访问日志里查到。问询 ID 不得因页面时间窗改变。Cursor 与 WorkBuddy 不得并成一条问询。

## 1. 问题

2026-10-13 11:17–11:23，同一用户用 Cursor 和 WorkBuddy 各问了一次。问询记录里只有 Cursor 的一句原文，关联调用数为 0。两段查数被收成一条「推断：触达…」。调用流水上的推断问询 ID 是 `…_16`，问询导出里同一簇是 `…_03`。WorkBuddy Connector 和 Cursor 的 MCP 握手只含协议调用，默认调用流水里看不见。

## 2. 目标

1. 一次 MCP 会话对应至少一条问询。有用户原文时用已上报问询；没有原文时保留会话访问。
2. 推断问询 ID 只由用户和该簇首条 `access_log.id` 决定。换近 1 小时或近 7 天，ID 不变。
3. 不同 `lucy_session_id` 不成同一条问询。空会话仍按间隔单独成簇。
4. 同会话里、问询记下前 2 秒内的未归因非协议调用补到该问询，归因为 `session_bound`。`lucy_begin_question` 计入关联调用。
5. 会话握手出现在该问询的详情里。默认调用流水仍不列出反复的 `tools/list`。按问询 ID 筛选时，能看到 `initialize`。
6. 问询列表和问询 CSV 写出客户端与会话 ID。自报名是空的、`lucy` 或 `lucy-mcp-proxy`，且 User-Agent 属于已知产品时，客户端名和版本用该产品；否则用握手自报的 `clientInfo.name`。自报名另记在 `reported_client`。
7. 配对 zip 里的问询 CSV 与调用 CSV 来自同一次查询，调用上的问询 ID 都能在问询 CSV 里找到。

**v0.25 替代声明**：§2 第 4 条、§4 中“问询前 2 秒补绑”、§6 的 `PRIOR_BIND_MS = 2000` 及 `onBeginQuestion` 前向回绑伪代码、§8 的 SC-3 均被 Spec 173 v0.3 与 v0.25 审计增量撤销，不再作为实现或验收依据。不得按时间近邻回绑旧调用；自动会话归属只形成 `candidate + low`。握手 attachment 可以保留，但其来源单列，不冒充已确认用户问询。历史条文保留用于解释旧记录。

## 3. 非目标

- 不新增 Spec 138 的归因枚举。仍是 `explicit` / `session_bound` / `identity_inferred` / `unassigned`。
- 不因缺少 `lucy_begin_question` 拒绝查数。Spec 162 的这条保持。
- 不根据 User-Agent 把 `undici` 或 `Python-urllib` 改写成 WorkBuddy，也不根据 Token 备注推断使用人。自报名不是空、`lucy` 或 `lucy-mcp-proxy` 时，已知产品的 User-Agent 也不覆盖它。
- 不把每一次 `tools/list` 放进默认调用流水。
- 不改审计证据包 `/api/admin/audit/export-pack` 的文件结构。
- 不回填旧的窗口序号 ID。下次重建起使用新 ID。
- 不重建 Docker 镜像。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 138：推断问询按用户、间隔和权限快照成簇；ID 含窗口内序号 | 有会话 ID 时先按会话切开。ID 为 `inf_{userId}_{首条 access_log.id}` |
| Spec 140：问询 ID 用于关联调用流水 | 保持。ID 在不同时间窗导出中相同 |
| Spec 162：缺 begin 仍可查数；其后同会话调用为 `session_bound` | 保持。另外把问询前 2 秒内的同会话未归因调用补绑 |
| 问询列表把页面窗口传进重建回看 | 重建固定回看 30 天。页面窗口只过滤 `started_at` |
| `lucy_begin_question` 不计入关联调用 | 计入 |

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | 中文主术语 | 约束 |
|---|---|---|
| Session Visit | 会话访问 | 没有用户原文时按 MCP 会话生成的问询。摘要以「会话建立：」加客户端名开头。不是第三种来源 badge，来源仍是推断问询 |

问询 ID、会话 ID、客户端名的值节点使用 `translate="no"` 与 `notranslate`。

## 6. 核心流程（伪代码）

```text
REBUILD_LOOKBACK_HOURS = 720
HANDSHAKE = {initialize, notifications/initialized, tools/list}
PRIOR_BIND_MS = 2000

function rebuild(user):
  rows = access_log where user and ts >= now - REBUILD_LOOKBACK_HOURS
  business = rows whose tool is not in HANDSHAKE
  groups = group business by lucy_session_id (empty session is its own group)
  for each group:
    split by gap 120s and by policy/permission snapshot change
    skip a no-session group whose every tool is kx_catalog, unless includeCatalogOnly
  for each session that has a business cluster:
    attach the first initialize, first notifications/initialized, and first tools/list
    of that session onto the earliest cluster
    id = "inf_" + userId + "_" + first business access_log.id
  for each session whose only calls are HANDSHAKE:
    write one turn
    id = "inf_" + userId + "_" + first handshake access_log.id
    summary = "会话建立：" + resolved client from initialize, or "未知客户端"
  page filter applies to started_at only and does not rebuild with a shorter lookback

function onBeginQuestion(call):
  turn = createTurn(text, session)
  bind calls in the same user, token, and session
    whose lucy_turn_id is empty
    whose tool is not HANDSHAKE
    whose ts is within PRIOR_BIND_MS before turn.createdAt
    mode = session_bound, confidence = high
  stamp the session's first HANDSHAKE calls with this turn id, same mode
  later calls in this session stay on Spec 138 session_bound

function exportInquiryPack(filter):
  turns = list turns for filter          # one rebuild
  calls = access_log in the same filter that belong to those turn ids
          including linked HANDSHAKE rows, excluding other tools/list
  return zip(turns.csv, calls.csv)
```

默认调用流水在没有问询 ID 筛选时仍排除 `HANDSHAKE`。带问询 ID 或统一搜索时，属于该问询的握手调用进入结果。

## 7. 问询上的客户端与会话

问询列表、问询详情和问询 CSV 增加「客户端」「会话 ID」。

| 问询 | 客户端 | 会话 ID |
|---|---|---|
| 已上报问询 | `conversation_turns.client` | `conversation_turns.session_id` |
| 推断问询 | 该会话 `initialize` 经同一客户端规则解析后的产品名；没有则用簇内第一条能解析出的客户端 | `lucy_session_id` |

CSV 列加在 `Agent` 之后。配对 zip 仍由 `GET /api/admin/audit/export-inquiry-pack` 提供。页头不单列「导出问询与调用」；日常导出跟随当前页签。

## 8. 验收

| ID | 断言 |
|---|---|
| SC-1 | 两个会话、间隔小于 120 秒，重建后是两条问询 |
| SC-2 | 先按 30 天重建，再按 1 小时过滤，同一簇的问询 ID 不变 |
| SC-3 | 同会话 `lucy_catalog` 比 begin 早 18 毫秒时，该调用为 `session_bound`，关联调用数至少为 2 |
| SC-4 | 只有握手的会话摘要为 `会话建立：WorkBuddy Connector`。默认调用流水不含 `tools/list`。按该问询 ID 筛选能看到 `initialize` |
| SC-5 | 配对 zip 中，调用 CSV 里非空的问询 ID 都出现在问询 CSV 中 |
