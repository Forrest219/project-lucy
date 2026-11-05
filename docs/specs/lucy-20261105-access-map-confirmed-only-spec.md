# 访问关系图固定已确认关联 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.3**（可定稿） |
| 日期 / 目标版本 | 2026-11-05 / 不绑定产品版本号。不进入 v0.25 登记册 |
| 功能编号 / 优先级 | **无** / **P1**（访问关系图关联口径硬锁） |
| 状态 | **v0.3 功能合同已收口（2026-11-05）**。S1–S2 已落地；SC-01–SC-14 本机自动化通过，证据见 [收口记录](../reviews/2026-11-05-access-map-confirmed-only-closure.md)。功能合同收口批准：用户 2026-11-05「授权开发落地，推进到收口」。本条收口不表示可上线 |
| 决策来源 | 2026-11-05 对 `http://127.0.0.1:55176/admin/access-map?window=720h` 反馈：取消「关联口径」筛选器；整页默认且仅「已确认关联」。用户选硬锁 A、方案 1（去控件、保留静态披露） |
| 需求来源 | 关联质量切换对管理员造成筛选噪音；产品决定访问面只认已确认关联 |
| 实施主体 | Lucy WebUI：`webui/server/admin/access-map*.ts`、`routes/access-map.ts`、`webui/src/pages/admin/AccessMap.tsx`、相关组件／测试／术语与交叉指针。不修改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **修订** audit-echo／hourly-detail／Spec 187／chart-first 中「含候选关联」可切换与 `access-map-trust` **下拉控件**合同（见 §4 D11 废止表）。路径主键、角色归因、守恒、边状态、问询种类／访问等级主筛选、小时明细其余列与分页**不变**。审计页 association／trust 三态与 Spec 173 写入**不在本条**。冲突时以**本 Spec**为准；被废止句／SC 自本条**定稿**起不再构成现行出口 |
| 实施计划 | [`docs/plans/lucy-20261105-access-map-confirmed-only-plan.md`](../plans/lucy-20261105-access-map-confirmed-only-plan.md) |
| 审阅 | [`docs/reviews/2026-11-05-codex-review-access-map-confirmed-only.md`](../reviews/2026-11-05-codex-review-access-map-confirmed-only.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：访问关系图产品面取消「关联口径」筛选；访问面（含允许集合 E、拒绝集合 D 与小时明细）固定只计已确认关联；查询串无 `trust` 键时按已确认构图；键一旦出现则 trim 后必须等于 `confirmed`，否则 HTTP 400；现状／图例保留静态「关联口径：已确认关联」。
- 本条出口：SC-01–SC-14。
- 不在本条出口：浏览器走查、Playwright、窄屏、镜像构建、部署、客户环境；`lint:spec-docs`／通用术语 lint（归 Plan S3）；Spec 173 关联写入；审计页 trust 三态；功能合同收口签字（须用户另行批准）。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 「关联口径」「已确认关联」「候选关联」「访问面」「授权路径」沿用既有术语。

控件／披露文案（不登记为新术语）：

| 位置 | 文案 | 说明 |
|---|---|---|
| 现状行／图例 | 关联口径：已确认关联 | **静态披露**；图例用字面量 |
| （删除） | 含候选关联（作访问关系图选项） | 不再提供切换 |
| （删除） | ACCESS_MAP_TRUST_HINT | 随下拉删除 |
| 400 用户可见句 | 关联口径只接受已确认关联 | 禁用「访问口径」「问询计入」；不夹英文参数值 |

Forbidden:

- 恢复「关联口径」下拉／分段或「问询计入」。
- 把出现的非法／含候选／空／空白／大小写变体／`confirmed_only` 静默回落为 confirmed。
- 声称候选关联调用仍可进入 E、D 或小时明细。
- 改写审计页关联三态语义。

`Agent`、连接名、表名、角色 id、Token、`Schema` 继续 `translate="no"` + `notranslate`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- [`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`](lucy-20261102-access-map-audit-echo-spec.md)
- [`docs/specs/lucy-20261104-access-map-hourly-detail-spec.md`](lucy-20261104-access-map-hourly-detail-spec.md)

### What This Change Follows

- [ ] 不新增控件族；删除「关联口径」下拉
- [ ] 常驻行保留现状／窗口／覆盖率／哈希；去掉可切换 trust 列与旁注
- [ ] 主工具条：统计窗口 → Schema 层 → 问询种类 → 访问等级 → 定位

### Exceptions (If Any)

- 历史允许 `trust=include_candidate`；本条定稿起拒绝（400）。
- trust 解析必须保留键存在性与全部重复值；**禁止**仅依赖已折叠的 Fastify `request.query` 判断「键是否出现」。

### Follow-up Needed

- **定稿时**（非 S3）按 D11 改写矛盾正文；SC-14 含限定文档集语义复扫。

---

## 1. 背景

弱入口「关联口径」下拉仍造成主筛选错觉。2026-11-05 拍板：取消筛选；固定已确认关联；硬锁拒绝含候选。

## 2. 目标

1. 删除下拉与旁注。
2. 形成 **B** 时永久 `association_status = 'confirmed'`；E、D、小时明细同投影。
3. 无 `trust` 键 → confirmed；键出现则 trim 后必须 `confirmed`，否则 400。
4. 现状／图例静态披露。
5. 首屏非法 trust 原样请求；用户**主动**改其它筛选时可省略 trust。
6. 定稿时按 D11 改写既有 docs（不构成 webui 开工）。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改问询种类／访问等级／窗口／Schema／focus | 本条只收 trust |
| 改路径主键、守恒、边状态 | Spec 187 |
| 改 Spec 173 写入／审计页三态 | 范围外 |
| 抹掉 `meta.access.trust` | 方案 1：恒 `confirmed` |
| 改 `gov.*` trust 枚举 | 非本页 |
| 浏览器／镜像／客户环境 | 不在出口 |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | 取消筛选控件与旁注；固定已确认关联 | 拒方案 2／3 |
| D2 | 硬锁 A：出现的非合法 confirmed → 400 | 拒静默回落 |
| D3 | **仅键未出现**时缺省；键出现则 **trim 后**必须 `=== "confirmed"`（前后空白的 `confirmed` → 200）；空串／仅空白 → 400 | 统一 trim 规则；废「原始串字节级」歧义 |
| D4 | 现状行与 legend 字面量「关联口径：已确认关联」 | |
| D5 | `meta.access.trust` 成功恒 `"confirmed"` | |
| D6 | B 加载谓词永久 confirmed；E 与 D 同收窄；删光 include 分支 | |
| D7 | 授权骨架不受 trust 影响 | |
| D8 | 图、`enteringAllowCallCount`、`deniedCalls`、小时明细与同一 B→E／D 一致 | |
| D9 | 已收口 Spec **状态行**可不重开；废止句自定稿失效 | |
| D10 | 定稿不授权改 `webui/`；须「按本 Plan 开工」 | |
| D11 | 废止表见下；**定稿时改写**，禁止只加指针、禁止拖到 S3 | |
| D12 | 路由必须用**原始查询串**构造 `URLSearchParams`（或等价保留 `has`＋全部重复值）再解析 trust；禁止用折叠后的 `request.query` 判断键存在性；禁止 `toLowerCase` 接纳；重复键任一非法 → 400；两键皆 `confirmed` → 200 | F02 |
| D13 | 首屏／400 响应路径不得改写地址栏以掩盖错误；**仅当用户主动变更其它筛选**时写出 URL 可省略 `trust` | F08 |
| D14 | 内部 parse 错误对象含 `param: "trust"`；HTTP 信封沿用 `{ error:{code,message}, data:{param} }`；SC 断言 **`body.data.param === "trust"`**；用户句「关联口径只接受已确认关联」 | F06 |
| D15 | 小时明细打假：无 scope／focus；真实 provider；测试缝逐桶 allow／deny id 集与预写夹具**精确相等**；已确认 allow／deny **必须**出现在预期明细；禁止空表冒充通过 | F03 |

### D11 废止表（定稿时改写）

| 文档 | 废止／改写对象 | 保留 |
|---|---|---|
| hourly-detail | §5.3 `access-map-trust` 控件存在性；「关联口径短控件」；「trust 非法集合含 include_candidate 不变」 | 窗口／覆盖率／哈希／小时列／分页／inquiryKind／accessGrade |
| audit-echo | §5.1「弱入口保留 `access-map-trust`」；§5.2 下拉双选项；§5.3 取值含 `include_candidate`；§6 `EchoFilter.trust` 联合类型含 `include_candidate`；SC-04；SC-09「可切 include_candidate」 | 问询种类／访问等级；E／D 其余算法 |
| Spec 187 | SC-05「可切含候选」（含文末重复验收行）；URL 合法 `include_candidate`；伪代码 include 分支；响应示例 `confirmed_only`／含候选图例句（§7.4 等） | 路径主键、守恒、边状态、授权面 |
| chart-first | 弱入口 `access-map-trust` 下拉要求 | 去 KPI、图例短行位置 |
| 术语 §4.8 Association Scope | 「弱入口筛选／含候选选项」现行句 | 术语名本身 |
| selector-contract | `access-map-trust`／`access-map-trust-hint` 可操作筛选登记 | 可改为静态披露说明或删除 |

SC-14：对上表文档集做矛盾语义复扫（含「可切／含候选／include_candidate／access-map-trust 下拉」现行句），不得残留。

## 5. 界面

### 5.1 删除

下拉 `access-map-trust`、hint、`ACCESS_MAP_TRUST_HINT`、写入 `include_candidate` 的 UI 路径。

### 5.2 保留

现状行与 `access-map-legend-trust` 字面量「关联口径：已确认关联」；常驻行窗口／覆盖率／哈希；主工具条不变。

### 5.3 URL（前端）

- **首屏／400 路径**：非法 `trust` 原样发给 API；失败后**不得**改写地址栏为缺省／confirmed。
- **用户主动改其它筛选**：写出时可省略 `trust`（此后按缺省 confirmed 构图，属用户新操作，非掩盖首屏 400）。

## 6. URL／API

| 情况 | 结果 |
|---|---|
| 无 `trust` 键 | 200；confirmed |
| `trust=confirmed` 或 trim 后为 `confirmed`（含前后空白） | 200 |
| 键存在且 trim 后为 `include_candidate`／`""`／仅空白／大小写变体／`confirmed_only`／其它 | 400；`data.param === "trust"` |
| 重复 `trust`：任一非法 | 400 |
| 重复 `trust`：全部 trim 后为 `confirmed` | 200 |

`meta.access.trust` 成功恒 `"confirmed"`。

## 7. 核心流程（伪代码）

```ts
type TrustParse =
  | { ok: true; trust: "confirmed" }
  | { ok: false; status: 400; param: "trust"; message: string };

/** Route MUST pass raw query string (e.g. request.url search) into URLSearchParams. */
function parseAccessMapTrustFromRawSearch(search: string): TrustParse {
  const input = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!input.has("trust")) return { ok: true, trust: "confirmed" };
  for (const raw of input.getAll("trust")) {
    if (raw.trim() !== "confirmed") {
      return {
        ok: false,
        status: 400,
        param: "trust",
        message: "关联口径只接受已确认关联"
      };
    }
  }
  return { ok: true, trust: "confirmed" };
}

// HTTP 400 envelope (unchanged shape):
// { ok:false, error:{ code, message }, data:{ param: "trust" } }
// Illegal trust MUST NOT call buildAccessMap / provider.

// B load SQL: AND association_status = 'confirmed'  (all sites; no include branch)
// E / D / hourly detail from same B; test seam: per-bucket allow/deny id sets
```

## 8. 验收矩阵

| ID | 断言 | 证据 |
|---|---|---|
| SC-01 | 无 `access-map-trust` 下拉、无 hint | 组件 |
| SC-02 | 现状行含「关联口径：已确认关联」 | 组件 |
| SC-03 | legend 字面量「关联口径：已确认关联」 | 组件 |
| SC-04 | 用户主动改其它筛选后写出 URL 无 `include_candidate` | 组件 |
| SC-05 | 首屏非法 trust（空／include_candidate／重复键非法在后等）请求仍携带原查询；400 后地址栏不被改成缺省／confirmed；非法请求未触发成功构图 | 组件 + 路由／HTTP |
| SC-06 | 无 trust 键 → 200；`meta.access.trust==="confirmed"`；未误调失败路径 | HTTP |
| SC-07 | `trust=confirmed` 与 `trust=%20confirmed%20` → 200 | HTTP |
| SC-08 | `include_candidate` → 400；`body.data.param==="trust"`；message 含「关联口径只接受已确认关联」；**未调用** build／provider | HTTP |
| SC-09 | 空串、仅空白、`Confirmed`、`INCLUDE_CANDIDATE`、`confirmed_only` → 400；`data.param==="trust"` | HTTP |
| SC-10 | 重复键：`confirmed`+`include_candidate` 两种顺序 → 400；双 `confirmed` → 200 | HTTP |
| SC-11 | 无 scope／focus；真实 provider；预写四条（候选 allow／deny、已确认 allow／deny）；测试缝逐桶 allow／deny id 集与夹具**精确相等**；候选两侧 ∉ E／D／明细；已确认 allow ∈ E 且出现在明细；已确认 deny ∈ D 且出现在明细拒绝侧；核对 `enteringAllowCallCount`／`deniedCalls`；禁止空表通过 | 服务端 |
| SC-12 | 授权骨架不因本条要求为空 | 服务端或组件 |
| SC-13 | D11 表内对象正文已改写／划掉 | 文档 diff |
| SC-14 | 对 D11 文档集语义复扫：无残留「可切／含候选／include_candidate 作合法 trust／access-map-trust 下拉」现行句 | 文档 |

## 9. 定稿与授权

- 审阅上限 3 轮已用尽（第 1 轮 CLI 失败时用等价对抗审阅；第 2–3 轮 Codex CLI）。
- 本版已达「可定稿／可交付开发」；**仍不**等于功能合同已收口；**仍不**自动授权改 `webui/`。
- D11／SC-13／SC-14 文档改写已在定稿同次完成。
- **未获「按本 Plan 开工」前**不得改 `webui/` 业务代码（D11 文档除外）。收口另批。
