# 访问关系图小时明细表 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现＋访问层明细合同 / **v0.3** |
| 日期 / 目标版本 | 2026-11-04 / 不绑定产品版本号。不升 Spec 187 版本号，不进入 v0.25 登记册 |
| 功能编号 / 优先级 | **无** / **P1**（访问关系图「数据表」与页壳收口） |
| 状态 | **功能合同已收口（2026-11-04）**。S1–S3 已落地；SC-01–SC-18 有自动化证据。Codex 三轮已完成。本条收口不表示可上线。证据见 [实施笔记](../reviews/2026-11-04-access-map-hourly-detail-implementation-notes.md) |
| 决策来源 | 2026-11-04 对 `http://127.0.0.1:55176/admin/access-map` 的反馈：①「凭证清单」冗余；②「口径与快照」应简化且不折叠、放图下；③「数据表」粒度过粗。澄清后拍板：明细按 **小时**；去掉凭证清单与 Token 过滤；口径常驻一行；API 走同端点加 `detail`（方案 1）。Codex 第 1 轮（高 6／中 4）→ v0.2；第 2 轮（高 2／中 1）→ v0.3；第 3 轮可定稿（附条件，N1 已补） |
| 需求来源 | 桑基继续做路径汇总可视化；「数据表」应是同筛选下可审计的小时明细，而不是同一套汇总边的另一张皮 |
| 实施主体 | Lucy WebUI：`webui/server/admin/access-map.ts`（及 echo 复用）、`webui/src/pages/admin/AccessMap.tsx`、`AccessMapTable`／凭证清单相关组件与测试。不修改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **再修订** chart-first 的图下弱入口与次级「凭证清单」、quiet-reading §5.6「数据表＝边级汇总」呈现，以及 Spec 187 §7.5 无障碍等价主表合同（本条登记能力收缩，见 §4 D11）。**不改** Spec 187 授权骨架、边状态机、路径守恒、几何。访问层候选集合以 audit-echo 的 E／D 为准，但 **取消 Token 条件**（见 D5／§9）。权威骨架语义仍以 Spec 187 为准 |
| 实施计划 | [`docs/plans/lucy-20261104-access-map-hourly-detail-plan.md`](../plans/lucy-20261104-access-map-hourly-detail-plan.md)（**v0.3**） |

## 闭口层级

- 层级：功能合同
- 本条承诺：访问关系图「数据表」展示与当前窗口／问询种类／访问等级／关联口径／scope／focus **同投影**的小时级调用明细；页面不再展示凭证清单与 Token 过滤；图下口径改为常驻行（含窗口起止与快照覆盖率压缩披露），不再折叠长说明。
- 本条出口：SC-01–SC-18。服务端测试打假明细粒度、scope／focus、分页完整性、逐桶 ID 守恒与表视图降级；组件测试打假页壳、表列、无凭证清单、无折叠弱入口、披露字段。
- 不在本条出口：文档指针／索引／selector-contract／通用 lint（归 Plan S3 工程完成检查）；浏览器走查、Playwright、窄屏、镜像、部署、客户环境；CSV／导出；把小时明细画进桑基；恢复 Token 过滤；改 Spec 187 边状态与授权构图；改访问日志页本身；Spec 187／quiet-reading／chart-first／audit-echo 的历史 SC 全量重跑。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None as product navigation names. Tab 文案仍为「数据表」。

控件／展示文案（不登记为新导航术语；若出现固定中文句须可被组件断言）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 视图 Tab | 关系图 / 数据表 | 沿用 |
| 图下常驻行 | 关联口径：… · 问询种类：… · 访问等级：… · 窗口起止 | 不折叠 |
| 覆盖率压缩句 | 快照：可关联 a／需复核 b · 缺失 c | 承接 Spec 187 §4.9.2；低覆盖率不得读成低越权率 |
| 快照哈希 | `config … · policy …` | 沿用 `access-map-snapshot-id` |
| 无关联种类单元格 | 无关联 | `inquiryKind === null` 时的展示；**不是** InquiryKind 枚举第四值 |
| 明细表头 | 小时 · Agent · 角色 · 连接 · Schema · 表 · 问询种类 · 访问等级 · 允许调用 · 拒绝调用 | 标识列 `notranslate` |

Forbidden terms:

- 用「桑基图」作页面标题或导航名。
- 把汇总边表（旧「节点／关系」）继续标成「数据表」主内容而不提供小时明细。
- 默认页再渲染「凭证清单」区块或 Token 点选过滤入口。
- 再使用折叠 `<details>`「口径与快照」承载长口径全文作为默认合同。
- 声称明细行宽与桑基流带一一对应；可对齐的是同投影下允许调用 ID 去重合计。
- 把小时明细冒充 Spec 187 §7.5「全部节点与边」的无障碍等价物（本条已收缩，见 D11）。

`Agent`、连接名、表名、角色 id、`Schema`、`config`／`policy` 哈希在 DOM 上使用 `translate="no"` 与 `notranslate`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- [`docs/specs/lucy-20261101-access-map-chart-first-spec.md`](lucy-20261101-access-map-chart-first-spec.md)
- [`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`](lucy-20261102-access-map-audit-echo-spec.md)

### What This Change Follows

- [ ] 「数据表」使用既有 `pl-data-grid` 家族；表头吸顶；数字右对齐
- [ ] 关系图／数据表 Tab 选中态不用 `pl-btn--primary`
- [ ] 图下常驻行视觉弱于主图，但不折叠
- [ ] Partial／grant／access 降级仍用既有 `pl-notice`，不得静默吞掉

### Exceptions (If Any)

- Spec 187 §4.5／§7.3／§7.5 与 quiet-reading §5.6、chart-first §5.1「次级凭证清单」及「数据表＝边行」：**本条取代为有效呈现**。§7.5「全部边／节点可读」的主表义务按 D11 **能力收缩**：小时明细不列 dormant 授权边与边状态；Canvas 既有非 normal 边键盘入口保留。
- URL 参数名 `token`：本条起**忽略**（不参与候选集合、不因出现而 400）；UI 不读写。这是对 audit-echo D8／Spec 187 §6.3 Token 条件的**有意取消**，不是「筛选语义不变」。非法其它参数规则仍按 Spec 187／audit-echo（400）。

### Follow-up Needed

- None 于本条。若产品要恢复 Token 过滤、边级等价表或导出小时明细，另开 Spec。

---

## 1. 背景

chart-first 把桑基推到主视觉后，「数据表」仍是路径汇总边的无障碍等价物；页底「凭证清单」与图下折叠「口径与快照」在读图场景下显得冗余或过重。管理员需要的是：在同一套窗口／问询种类／访问等级／关联口径／scope／focus 下，能按小时核对「谁（Agent）经哪条角色与连接摸到了哪张表」。

## 2. 目标

1. **数据表 = 小时明细**：粒度含小时桶、Agent、角色、连接、Schema、表、问询种类、访问等级、允许调用、拒绝调用。
2. **去掉凭证清单**与 **Token 过滤**（取消 Token 条件）。
3. **口径常驻简化**：一行现状＋窗口起止＋快照覆盖率压缩句＋config／policy 哈希＋关联口径**静态披露**（固定已确认关联）；删除折叠与长口径段落。**关联口径下拉控件**自 [`lucy-20261105-access-map-confirmed-only-spec.md`](lucy-20261105-access-map-confirmed-only-spec.md) 定稿起废止（本条原「短控件」句不再现行）。
4. **同 API 挂载 `detail`**：一次准备 E／D 后，`view=table` 返回明细；桑基汇总算法不变。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改授权构图、边状态、几何、折叠预算 | Spec 187／geometry 不变 |
| 改 inquiryKind／accessGrade 缺省与非法 400 | audit-echo 不变（Token 除外）。**`trust` 硬锁已确认关联**见 [`lucy-20261105-access-map-confirmed-only-spec.md`](lucy-20261105-access-map-confirmed-only-spec.md)，不再保留 `include_candidate` |
| 明细行与桑基边一一对宽 | 汇总 vs 明细职责分离 |
| 把有权未用的授权骨架行写入明细 | 明细只反映发生过的调用尝试（E∪D） |
| CSV 导出、浏览器走查出口 | 另议／不在本条 |
| 恢复 Token 过滤或凭证清单 | 明确本轮删除 |
| 用小时明细恢复 §7.5 全边等价 | D11 能力收缩 |

## 4. 拍板记录

| ID | 决议 |
|---|---|
| D1 | 「数据表」改为可审计小时明细，不是汇总边表 |
| D2 | 时间粒度选 **A：按小时**（Asia/Shanghai 小时桶） |
| D3 | 去掉整块「凭证清单」 |
| D4 | 口径常驻：一行现状＋窗口起止＋覆盖率压缩句＋快照哈希；长说明删除 |
| D5 | **取消 Token 条件**：`token` 忽略，不筛选；其余候选规则沿用 audit-echo |
| D6 | 明细列：五元组＋问询种类＋访问等级＋允许／拒绝 |
| D7 | API 方案 1：同 `/api/admin/access-map` 增加 `detail`；仅 `view=table` 必须计算返回 |
| D8 | 授权骨架（dormant 等）不进明细表 |
| D9 | **scope**：对明细行键做字段精确筛选（与现 `applyScopeFilters` 同源参数）。**focus**：与图共用 `focusSubgraph`；保留与 focused 访问边上调用 ID 相交的行；若 focus 指向 Agent／角色／连接／Schema／表节点且节点仍在 scoped 图中，另保留对应键字段相等的 deny-only 行。focus 失效则忽略（与现图一致） |
| D10 | **分页**：`hasMore = offset + rows.length < totalRowCount`。守恒仅当 `offset===0 && !hasMore && rows.length===totalRowCount`。非法非整数 limit／offset → 400；limit 超上限夹到 2000；offset&lt;0 → 0。筛选变化时 UI 重置 offset=0 |
| D11 | **§7.5 能力收缩**：数据表不再承诺列出全部授权边／dormant／边状态；小时明细 + Canvas 既有非 normal 边键盘入口共同承接可读性。须在 Spec 187 指针中写明 |
| D12 | **一次准备**：每次请求只调用一次 `buildBandED`。先判断 `result.ok`：`ok===false` 时保留 `reason`，`bandState=unavailable`，不读成功载荷、不生成成功明细；`ok===true` 才解构 `result.band`，加载 E∪D 调用行，图／meta／明细共用同一 `PreparedBand`。若另写适配器，须先冻结其返回合同与上述分支一致 |
| D13 | **无关联种类**：行字段 `inquiryKind: InquiryKind \| null`；`null` 展示「无关联」。不新增 InquiryKind 枚举值 |
| D14 | **逐桶 ID 集相等**：测试缝输出的完整行键集合，以及每个键的 allow／deny ID 集，须与夹具预写集合逐项相等；响应计数＝对应期望集大小。交换两桶 ID 且计数不变时测试必须失败。分页／scope／focus 比投影后期望桶 |

## 5. 呈现规格

### 5.1 页面骨架

```text
Page Header（访问关系图）
工具条（窗口 / Schema 层 / 问询种类 / 访问等级 / 搜索…；无 Token）
降级 pl-notice（按 §5.5 状态矩阵）
pl-admin-tabbar：关系图 | 数据表

【关系图】
  图例短行
  桑基 Canvas
  常驻行：关联口径 + 现状 + 窗口起止 + 覆盖率压缩句 + config/policy 哈希
  （无凭证清单）

【数据表】
  常驻行（同上，可置于表上方）
  小时明细表 + 翻页 / hasMore 提示
  （无节点汇总表、无关系汇总表、无凭证清单）
```

### 5.2 删除的元素

| 元素 | 处置 |
|---|---|
| `AccessMapCredentialList`／「凭证清单」 | 默认 DOM **不得出现** |
| Token 点选过滤 UI 与对访问层的 `token` 筛选 | 删除／忽略 |
| `<details data-testid="access-map-methodology-snapshot">` | 删除折叠形态 |
| `AccessMapSignalNotes` 长口径段落 | 默认页 **不得**再作为合同内容展示 |
| 旧 `AccessMapTable`「节点」「关系」两段汇总表 | 被小时明细表取代 |

### 5.3 常驻口径行

- 不使用默认关闭的 `<details>`。
- 须保留：`access-map-filter-status`（或等价现状行，含静态「关联口径：已确认关联」）、`access-map-snapshot-id`。**不再**要求 `access-map-trust` 下拉控件（废止见 [`lucy-20261105-access-map-confirmed-only-spec.md`](lucy-20261105-access-map-confirmed-only-spec.md) D11）。
- **须新增或迁入常驻可见**：统计窗口起止（承接 Spec 187 §7.4）；快照覆盖率压缩句（承接 §4.9.2：可关联／需复核／缺失；禁止把低覆盖率读成低越权率）。test id 可新建 `access-map-window-range`、`access-map-snapshot-coverage`（若旧 id 仍在弱入口，迁到常驻行即可）。
- 长 note 的旧 test id（如 `access-map-signal-needs-review-note`）不再要求出现在默认 DOM。

### 5.4 数据表列

| 列 | 字段 | 说明 |
|---|---|---|
| 小时 | `hour` | Asia/Shanghai 桶起点，`YYYY-MM-DDTHH:00:00+08:00` 或同义可读格式 |
| Agent | `agentId`＋展示名 | `user_id` |
| 角色 | `roleId` | 与访问路径归因同规则 |
| 连接 | `connectionId` | |
| Schema | `schema` | 缺维显式 `unknown` |
| 表 | `table` | 缺维显式 `unknown` |
| 问询种类 | `inquiryKind` | `InquiryKind \| null`；`null`→「无关联」 |
| 访问等级 | `accessGrade` | 工具等级 |
| 允许调用 | `allowCalls` | 桶内允许，调用 ID 去重后的 **个数** |
| 拒绝调用 | `denyCalls` | 桶内拒绝，调用 ID 去重后的 **个数** |

排序全序（稳定）：`hour asc` → `agentId` → `roleId` → `connectionId` → `schema` → `table` → `inquiryKind`（null 最后）→ `accessGrade`。

### 5.5 表视图状态矩阵

| 条件 | `detail` | UI |
|---|---|---|
| grant unavailable | 可不计算 | 既有授权不可用 notice；**禁止**用明细空表冒充 |
| access unavailable（读失败／重建失败） | `detail: null` 或显式 `unavailable` 标志 | 表区 notice「审计数据不可用」；**禁止** `rows=[]` 且无说明 |
| access ok，E∪D 空 | `rows=[]`, `totalRowCount=0`, `hasMore=false` | 空态：可调整窗口或筛选；**禁止**「尚无 Agent 授权关系」除非 grant 亦空 |
| access ok，仅 D 非空（deny-only） | 有 deny 行 | **必须**展示；不得因图无访问边而隐藏 |
| access ok，有行且分页越界 | `rows=[]`, `hasMore=false`, `totalRowCount>0` | 提示无本页数据／回到第一页；不得声称「无调用」 |
| partial（授权或访问） | 按可读部分返回 | 既有 `pl-notice`；明细只含已成功读入的调用 |

页面不得仅因 `nodes.length===0` 就跳过 table 分支而丢掉仍可读的 deny／access 明细（grant 空但 access ok 时仍进表视图）。

## 6. API 合同

### 6.1 响应增量

```ts
detail?: {
  rows: AccessMapHourlyDetailRow[];
  hasMore: boolean;
  totalRowCount: number; // 投影后、分页前的精确行数
  limit: number;
  offset: number;
} | null;
```

- `view=map`：可不返回 `detail`（或 `null`）。
- `view=table`：按 §5.5 返回；access unavailable 时不得用空成功表冒充。

公共行 **不**暴露调用 ID 列表。测试通过 **测试缝**（如 `buildHourlyDetailBuckets` 返回 `Map<key,{allow:Set,deny:Set}>`）取得 ID 集。

### 6.2 查询参数增量

| 参数 | 取值 | 缺省 | 说明 |
|---|---|---|---|
| `detailLimit` | 正整数，上限 **2000** | 200 | 非整数 → 400；&gt;2000 → 夹紧 |
| `detailOffset` | ≥0 整数 | 0 | 非整数 → 400；&lt;0 → 0 |
| `token` | 任意 | — | **忽略**，不筛选、不 400 |

既有 `window`／`layer`／`inquiryKind`／`accessGrade`／`view`／scope／`focus` 参数不变（Token 条件取消除外）。`trust` 仅缺省或 `confirmed`；`include_candidate` → 400，见 confirmed-only Spec。

### 6.3 守恒（可打假）

仅当同时满足：access ok；**无** scope／focus 收窄；`offset===0`；`!hasMore`；`rows.length===totalRowCount`：

- 测试缝中全部桶的 `allow` ID **全局去重** 集合大小 = `meta.echo.enteringAllowCallCount`（即 `|E|`）。
- 全部桶的 `deny` ID 全局去重 = `|D|`／`deniedCalls`（同类条件）。
- **禁止**用 Σ 行上 `allowCalls` 冒充 `|E|`。
- **D14**：夹具预写「完整行键 → allow／deny ID 集」。测试缝输出的行键集合与每个键的 allow／deny ID 集须与预写**逐项相等**；响应行的 `allowCalls`／`denyCalls` 等于对应期望集大小。仅核对全局并集大小或行计数、放过「两桶交换 ID」的夹具，视为失败。

截断／分页中／有 scope／focus 时：**不得**声称全局守恒；只验投影后期望桶的键集与逐桶 ID 集相等（仍禁止只比计数）。

## 7. 核心流程（伪代码）

```ts
type PreparedBand = {
  E: Set<CallId>;
  D: Set<CallId>;
  calls: Map<CallId, CallRow>; // 含 tool、ts、user_id、sources、roles、turn…
  echoMeta: { enteringAllowCallCount: number; deniedCalls: number };
  bandState: "ok" | "unavailable" | "partial";
};

async function prepareBand(f: EchoFilter): Promise<PreparedBand> {
  // tokenLabel forced null (D5); D12 matches real buildBandED contract
  const result = await buildBandED({ ...f, tokenLabel: null }, db);
  if (!result.ok) {
    return { E: empty, D: empty, calls: empty, echoMeta: zero, bandState: "unavailable", reason: result.reason };
  }
  const band = result.band;
  // load call rows once for E∪D from band; never treat ok:false as empty success
}

function shanghaiHourFloor(tsIso: string): string { /* Asia/Shanghai hour floor +08:00 */ }

function buildHourlyBuckets(prepared: PreparedBand): Map<string, Bucket> {
  const rowsByKey = new Map();
  for (const callId of union(prepared.E, prepared.D)) {
    const row = prepared.calls.get(callId);
    const turn = resolveTurn(row, db);
    const kind = turn ? inquiryKindOfTurn(turn) : null; // D13
    const grade = accessGrade(row.tool);
    const hour = shanghaiHourFloor(row.ts);
    for (const roleId of attributeRoles(row)) {
      for (const src of sourcesOrUnknown(row)) {
        const key = pack({ hour, agentId: row.user_id, roleId, ...src, inquiryKind: kind, accessGrade: grade });
        const bucket = rowsByKey.get(key) ?? emptyBucket(key);
        if (prepared.E.has(callId)) bucket.allow.add(callId);
        if (prepared.D.has(callId)) bucket.deny.add(callId);
        rowsByKey.set(key, bucket);
      }
    }
  }
  return rowsByKey;
}

function projectBuckets(buckets, query, graphAfterScope) {
  let list = [...buckets.values()];
  list = applyScopeToDetailRows(list, query); // exact field match
  if (query.focus && graphAfterScope.nodes.has(query.focus)) {
    const focused = focusSubgraph(graphAfterScope, query.focus);
    const edgeCallIds = callIdsOnAccessEdges(focused.edges);
    list = list.filter(b =>
      intersects(b.allow∪b.deny, edgeCallIds) ||
      detailRowMatchesFocusEntity(b.meta, focused.nodes.get(query.focus))
    );
  }
  return list;
}

function pageDetail(list, { limit, offset }) {
  const sorted = sortStable(list); // §5.4 total order
  const totalRowCount = sorted.length;
  const slice = sorted.slice(offset, offset + limit);
  return {
    rows: slice.map(b => ({ ...b.meta, allowCalls: b.allow.size, denyCalls: b.deny.size })),
    hasMore: offset + slice.length < totalRowCount,
    totalRowCount,
    limit,
    offset
  };
}

// provider:
//   prepared = await prepareBand(...)
//   build grant + access edges from prepared.E (unchanged aside from token)
//   scope → focus on graph
//   if view==="table":
//     if prepared.bandState==="unavailable": detail=null + notice
//     else detail = pageDetail(projectBuckets(buildHourlyBuckets(prepared), ...), page)
```

## 8. 验收矩阵

| ID | 断言 | 证据 |
|---|---|---|
| SC-01 | 默认页无「凭证清单」、无 `access-map-credential-list` | 组件 |
| SC-02 | 无 Token 过滤控件；切换筛选不写 `token` | 组件 |
| SC-03 | 无折叠「口径与快照」`<details>`；有常驻现状行、窗口起止、覆盖率压缩句、`access-map-snapshot-id` | 组件 |
| SC-04 | 无长口径 note 必填 test id 于默认 DOM | 组件 |
| SC-05 | 「数据表」无「节点」「关系」汇总标题作为主表；有小时列与五元组列 | 组件 |
| SC-06 | 表列含问询种类、访问等级、允许调用、拒绝调用；`inquiryKind=null` 展示「无关联」 | 组件 |
| SC-07 | `view=map` 可不含 `detail`；`view=table` 按 §5.5 返回；access unavailable 时返回 `detail:null` 或显式 unavailable 标志，禁止以无说明的成功空表冒充 | 服务端 |
| SC-08 | `hour` 为 Asia/Shanghai 小时桶；跨小时同五元组拆两行 | 服务端 |
| SC-09 | 完整页＋无 scope／focus：allow 全局去重 = `enteringAllowCallCount`；**且**测试缝行键集合与每键 allow ID 集与预写逐项相等；交换两桶 ID 且计数不变必须失败；响应 `allowCalls`＝期望集大小 | 服务端 |
| SC-10 | 同类条件下 deny 全局去重 = `|D|`／`deniedCalls`；**且**每键 deny ID 集与预写逐项相等（同 SC-09 交换夹具） | 服务端 |
| SC-11 | `token` 出现不影响 map／table 的 E／D／边计数／明细（忽略）；其它非法参仍 400 | 服务端 |
| SC-12 | `detailLimit`／`detailOffset` 非法非整数 400；limit 夹紧；首／中／末／越界页的 `hasMore` 与 `totalRowCount` 正确；末页后 `hasMore=false` 不得触发守恒 | 服务端 |
| SC-13 | scope／focus 后明细行符合 D9；focus 失效忽略；deny-only 在 Agent focus 下仍可见 | 服务端 |
| SC-14 | 授权骨架仍可在 map 展示；仅改明细／页壳不改变 dormant 边判定 | 服务端回归 |
| SC-15 | 组件夹具逐项覆盖 §5.5：grant unavailable、access unavailable（读／重建失败）、真实零行、deny-only、分页越界、partial；分别断言 notice、明细可见性与空态文案——不可用／越界页不得显示为「无调用」；partial 不丢已读明细；grant 空 + access ok 不误用「尚无 Agent 授权关系」挡表 | 组件（主）／服务端对照 |
| SC-16 | 标识列 `notranslate`；无「桑基图」标题 | 组件 |
| SC-17 | 每次请求只调一次 `buildBandED`；先判 `result.ok`；`ok===false` → unavailable（带 reason），不生成成功明细；`ok===true` 才共用 `band` 构图与明细 | 服务端 |
| SC-18 | 常驻行可见窗口起止与覆盖率压缩句；低覆盖率文案不暗示低越权率 | 组件 |

文档指针、索引镜像、selector-contract、`lint:spec-docs`／`lint:terminology`：**不在本条功能出口**，见 Plan S3。

## 9. 对既有 Spec 的指针修订

| 文档 | 修订 |
|---|---|
| chart-first | 图下折叠弱入口与次级凭证清单 → 本 Spec 常驻行；无凭证清单 |
| quiet-reading §5.6 | 数据表／凭证表呈现 → 本 Spec |
| Spec 187 §4.5／§7.3 | UI 凭证清单 → 本 Spec；语义骨架不变 |
| Spec 187 §7.5 | **有效呈现改为小时明细；登记 D11 能力收缩**（不再要求边级全量等价主表） |
| Spec 187 §4.9.2／§7.4 | 覆盖率与窗口起止迁入常驻行（本 Spec §5.3） |
| Spec 187 §6.3／audit-echo D8 | **Token 条件取消**；其余候选规则不变 |
| audit-echo | 关联口径常驻行承载；**筛选语义除 Token 外不变** |

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 大窗口行数爆炸 | limit 上限 2000、hasMore、建议收窄窗口 |
| 多角色展开导致 Σ≠\|E\| | SC-09 用全局 ID＋预写键集 |
| 旧测试绑凭证清单／弱入口 | Plan S2 改写断言 |
| 时区歧义 | 固定 Asia/Shanghai；SC-08 |
| 误把分页页当成完整结果 | D10／SC-12 |

---

**定稿条件：** Codex 交叉审阅闭合且用户确认定稿。实施须另授开发授权（Plan P3）。功能合同收口须 SC-01–SC-18 关闭且用户批准收口。本条收口不表示可上线。
