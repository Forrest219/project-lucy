# 物理新鲜度合同 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计草案 / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-09 / 产品线 `0.30.0`（分支 `lucy-v0.30`）。不进入 `v0.25` 升级台账，不占用 `L25-*` |
| 台账号 | 无（0.30 台账未建立） |
| 功能编号 / 优先级 | 清单 **P0-B**；需求池 **REQ-030-028** / **P0 伴生** |
| 状态 | **v0.1-draft；O1–O3 已闭合（2026-11-13）＝建议包 F；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口**。须 Codex CLI 终审或委托人明示确权（R2-F）→ 另授开发授权后才可改代码。本条不表示可上线 |
| 授权边界 | 本文件**不授权改代码**。不修改 P0-4 已落地的 `answer_verifiability.cutoff`（该条 O2＝A：成功块一律 `not_checked`） |
| 决策来源 | 2026-11-08 能力盘点：呈现闸需要截止期真源；2026-11-09 委托人要求把 P0-B 的 Spec／Plan 往前推 |
| 需求来源 | [需求池 REQ-030-028](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)；[功能清单池 P0-B](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[P0-4 可核对 Spec](lucy-20261107-answer-verifiability-spec.md) §4.4 |
| 实施主体 | Lucy：`lucy_freshness` 的策略合同与水位读取。不改 KTX；不改 WebUI 页面 |
| 配套 Plan | [lucy-20261109-physical-freshness-contract-plan.md](../plans/lucy-20261109-physical-freshness-contract-plan.md) |
| 评审记录 | [2026-11-09 过程推进记录](../reviews/2026-11-09-p0-6-p0-7-p0-b-spec-advance.md)（过程修订，**不是** R2-F）；[2026-11-13 O1–O3 决策纸](../reviews/2026-11-13-p0-b-o1-o3-decision-package.md)（**R3：O1–O3 已闭合 2026-11-13＝建议包 F**；**不是** R2-F／R4） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」「伪代码」 |
| 与既有 Spec 的关系 | **串联，不改写 P0-4。** P0-4 负责可核对块里诚实的「未校验」。本条负责 `lucy_freshness` 有可声明的物理或业务水位，并且禁止用语义文件 mtime 冒充该水位。把已校验水位写进 `answer_verifiability.cutoff` 必须另升 P0-4，不在本条出口 |

## 变更记录

| 版本 | 说明 |
|---|---|
| v0.1-draft | 首立。冻结「未配置即可见、mtime 不得冒充、失败不编造时间、不改 P0-4 cutoff」。O1–O3 给出建议包，**未闭合** |
| v0.1-draft（O 闭合） | **R3（2026-11-13）**：委托人会话批准整包采纳建议包 F；§4 O1–O3 已闭合。**待 R2-F**；冻结落地；未授权实现。**不改 P0-4 cutoff**。**不构成 R2-F／R4** |

## 闭口层级

- 层级：功能合同
- 本条承诺：调用方可见的 source 上，`lucy_freshness` 返回一份策略结果：显式未配置、业务日期水位已校验，或失败可见。语义文件 mtime 只能出现在元数据字段，不能填进物理水位。
- 本条出口：SC-01–SC-10。纯函数与工具单测；`lint:spec-docs` 通过。
- 不在本条出口：全库 CDC、新统计表、WebUI 新鲜度页、把水位写进 `answer_verifiability.cutoff`、Eval 日跑断言（P0-6）、镜像／上线。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Physical Freshness：中文主称「物理新鲜度」。业务数据本身的水位，不是语义文件的修改时间。
- Freshness Policy：中文主称「新鲜度策略」。某个 source 上声明的水位算法，或显式「未配置」。
- Business Date Watermark：中文主称「业务日期水位」。按声明的日期字段取最大值得到的截止观察。
- Unconfigured Freshness：中文主称「未配置新鲜度」。策略缺失或写明未配置。必须可见，不能伪装成已校验。

Forbidden:

- 把语义层文件 mtime、查询时刻、发布业务日写成业务截止期或物理水位。
- 把 `lucy_freshness` 调用成功写成「数据截止期已校验」。
- 在本条把 `answer_verifiability.cutoff.status` 改成已校验。

落位：本条术语属 **问数／可核对**相邻分区。实现前补术语标准条目。用户可见说明用中文主称。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/00-product-terminology-standard.md`
- `lucy-20261107-answer-verifiability-spec.md`

### What This Change Follows

- [ ] 本条不新增页面、路由或文案面。
- [ ] 工具结果里的说明句用中文，区分「语义文件时间」和「业务水位」。

### Exceptions (If Any)

- 无 WebUI。水位只出现在 `lucy_freshness` 工具结果。

### Follow-up Needed

- 把已校验水位投影进可核对块：另升 P0-4。本条授权也不自动打开那次投影。

## 1. 背景与取证

P0-4 已落地的成功查数块把截止期固定为 `not_checked`。现网 `lucy_freshness` 只报告语义文件 mtime，`physicalDataUpdatedAt` 恒为 null，说明句承认物理水位不可用。缺的是一份可声明的策略：未配置必须看得出来，配置了就必须按声明的字段取水位，失败时不得编造时间。

| # | 事实 | 证据 |
|---|---|---|
| E1 | `lucyFreshness` 在目录可见后只 `stat` overlay 与 schema 文件，成功体 `mode:"metadata_only"`，`physicalDataUpdatedAt:null` | `webui/server/proxy/mcp-proxy.ts` `lucyFreshness`（约 `:1705-1746`，2026-11-09 复核） |
| E2 | 目录中找不到的 source 返回 `status:"forbidden_or_unknown"` 且 `freshness:null`，不读文件 | 同函数约 `:1713-1719` |
| E3 | P0-4 成功块 `cutoff.status` 唯一合法值是 `not_checked`；O2＝A 禁止本阶段接入探测 | [可核对 Spec](lucy-20261107-answer-verifiability-spec.md) §5.1.2、O2 |

## 2. 目标

1. 每个可见 source 都有新鲜度策略结果，缺失声明与「未配置」一样可见。
2. 唯一能产生物理水位的本版算法是业务日期水位：对声明的日期字段取最大值。
3. 语义文件 mtime 继续可报告，但与物理水位分字段，禁止互相填入。
4. 查询失败、无行、字段不合法时返回失败可见，水位为空。
5. 不改 P0-4 可核对块。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| CDC、binlog、实时湖仓 | REQ 明文不做 |
| 新的新鲜度表或定时全库扫描 | 按调用读取声明范围内的一个聚合 |
| WebUI 页面 | 本条是工具合同 |
| 改 `answer_verifiability.cutoff` | P0-4 O2＝A 已冻结 |
| 用 mtime 充当水位 | 这是本条要关掉的缺口 |
| 第二套 MCP 工具 | 仍走 `lucy_freshness` |

## 4. 设计决策

| 编号 | 决策 | 状态 |
|---|---|---|
| **D1** | 无声明，或声明 `policy: unconfigured`，结果都是未配置：`physicalDataUpdatedAt` 与 `asOf` 为 null。说明句不得暗示已校验 | **冻结** |
| **D2** | `semanticLayerUpdatedAt` 只表示语义文件 mtime。禁止把它、`Date.now()`、发布业务日写入 `physicalDataUpdatedAt` 或 `asOf` | **冻结** |
| **D3** | 调用方目录中不存在的 source 保持 `forbidden_or_unknown` + `freshness:null`。不得为不可见 source 读取文件或打业务库 | **冻结** |
| **D4** | 本版唯一可校验算法是 `business_date_max`。其他 policy 名 → `policy_invalid`，不打业务库 | **冻结** |
| **D5** | `status:"checked"` 必须同时带 `asOf`、`checkedAt`、`basis:"business_date_max"`、`dateField`。`physicalDataUpdatedAt` 等于 `asOf`。`checkedAt` 是观察时刻，不是业务截止日 | **冻结** |
| **D6** | 聚合失败、超时、最大值为空 → `status:"unavailable"`，水位字段为 null，不编造时间 | **冻结** |
| **D7** | `dateField` 必须是该 source 已暴露的日期或日期时间维度。否则 `policy_invalid`，零上游执行 | **冻结** |
| **D8** | 即使本工具返回 `checked`，`answer_verifiability.cutoff.status` 仍必须是 `not_checked` | **冻结** |
| **D9** | 不建表、不做 CDC、不改页面 | **冻结** |
| **O1** | 策略声明落点：source overlay 顶层 `freshness`（不设 connection 级默认） | **已闭合（2026-11-13）＝建议包 F** |
| **O2** | 水位聚合：服务端内部 `max`，复用 ACL；不新增 MCP | **已闭合（2026-11-13）＝建议包 F** |
| **O3** | 水位缓存：本版不缓存，每次实时读取 | **已闭合（2026-11-13）＝建议包 F** |

> **开放决策守卫**：O1–O3 已由委托人 2026-11-13 整包采纳建议包 F 闭合（R3）。在 R2-F 终稿确权与 R4 开发授权之前仍不得实现对应分支。缺省 fail-closed。**不是** R2-F，**不是** R4。

### 4.1 裁定（已闭合：建议包 F，2026-11-13）

委托人 2026-11-13 会话批准整包采纳建议包 F。决策纸见 [2026-11-13-p0-b-o1-o3-decision-package.md](../reviews/2026-11-13-p0-b-o1-o3-decision-package.md)。

| 项 | 建议 |
|---|---|
| O1 | 声明写在该 source 的 overlay 顶层 `freshness`。本版不设 connection 级默认；缺键即未配置。manifest 里出现 `freshness` 视为声明位置错误，按 `policy_invalid`，不打业务库 |
| O2 | 服务端内部聚合，固定形状为该字段的 `max`，复用该 source 的 ACL 与行权限。不新增 MCP 工具，不由模型拼 SQL。超时与用户 `lucy_query` 分开计 |
| O3 | 本版不缓存。每次 `lucy_freshness` 按策略实时读取；缓存留到后续版本 |

## 5. 结果形状（Normative）

目录不可见：

```text
{ sourceName, connectionId, status: "forbidden_or_unknown", freshness: null }
```

目录可见时，外层 `status` 为 `ok`，水位只出现在 `freshness`：

```text
freshness: {
  mode: "policy",
  policy: "unconfigured" | "business_date_max" | "policy_invalid",
  status: "unconfigured" | "checked" | "unavailable" | "policy_invalid",
  semanticLayerUpdatedAt: string | null,
  physicalDataUpdatedAt: string | null,
  asOf: string | null,
  checkedAt: string | null,
  basis: "business_date_max" | null,
  dateField: string | null,
  note: string
}
```

固定说明句：

- 未配置：`物理新鲜度未配置，不能当作业务截止期。`
- 已校验：说明句必须含「业务日期水位」，并点名字段名。
- 不可用：`物理新鲜度暂时不可用。`
- 策略非法：`新鲜度策略无效，未读取业务数据。`

`mode:"metadata_only"` 退出成功路径。旧客户端若把 `semanticLayerUpdatedAt` 当成业务截止期，属于调用方误读；本工具的说明句不得鼓励这种读法。

## 6. 核心流程（伪代码）

```text
lucyFreshness(identity, connectionId, sourceName):
  source := visibleCatalog(identity).find(connectionId, sourceName)
  if source is missing:
    return forbidden_or_unknown          # D3；不 stat 文件，不打业务库

  metaTime := semanticFileMtime(source)  # 只进入 semanticLayerUpdatedAt
  policy := readDeclaredPolicy(source)   # O1（已闭合）：overlay 顶层 freshness

  if policy is missing or policy.id == "unconfigured":
    return freshness(status=unconfigured, physical=null, asOf=null,
                     semanticLayerUpdatedAt=metaTime)   # D1 D2

  if policy.id != "business_date_max" or not exposedDateDimension(source, policy.dateField):
    return freshness(status=policy_invalid, physical=null)  # D4 D7；零上游

  result := maxOfField(source, policy.dateField)       # O2；遵守 ACL
  if result failed or result.max is null:
    return freshness(status=unavailable, physical=null) # D6

  return freshness(status=checked, asOf=result.max,
                   physicalDataUpdatedAt=result.max,
                   checkedAt=now(), basis=business_date_max,
                   dateField=policy.dateField,
                   semanticLayerUpdatedAt=metaTime)

# 本函数不写 answer_verifiability。P0-4 装配器继续固定 not_checked（D8）
```

## 7. 验收（SC-01–SC-10）

| ID | 断言 | 证据形态 |
|---|---|---|
| SC-01 | 无声明与 `unconfigured` 都返回未配置，水位字段为 null，说明句为固定未配置文案 | 单测 |
| SC-02 | 语义文件 mtime 只出现在 `semanticLayerUpdatedAt`；注入一个很新的 mtime 后 `physicalDataUpdatedAt` 仍为 null | 单测 |
| SC-03 | 目录不可见的 source 返回 `forbidden_or_unknown`，且不读取该 source 的文件、不打业务库 | 单测 |
| SC-04 | `business_date_max` 在最大值存在时返回 `checked`，`asOf` 等于该最大值，`physicalDataUpdatedAt` 等于 `asOf`，`basis` 与 `dateField` 齐全 | 单测 |
| SC-05 | 聚合失败、超时或最大值为空 → `unavailable`，水位为 null | 单测 |
| SC-06 | 未知 policy，或日期字段不是已暴露的日期维度 → `policy_invalid`，零上游 | 单测 |
| SC-07 | 行权限使聚合看不到行时，结果是 `unavailable`，不返回越权日期 | 单测 |
| SC-08 | 同一次进程里 freshness 已是 `checked` 时，成功 `lucy_query` 的 `answer_verifiability.cutoff.status` 仍是 `not_checked` | 单测 |
| SC-09 | 成功路径不再返回 `mode:"metadata_only"` | 单测 |
| SC-10 | `lint:spec-docs` 对本 Spec／Plan 退出码 0 | 门禁 |

全部 SC **未执行**。O1–O3 已闭合（建议包 F，2026-11-13）后 SC-04／SC-05／SC-07 可依冻结合同在 R4 后实现，但尚无功能合同收口证据。D8／SC-08：**不改 P0-4** `cutoff.status=not_checked`。本条收口不表示可上线。**本版不是 R2-F，不是 R4；待 R2-F 完成之前不可功能合同闭口。**

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 实现时顺手改 P0-4 cutoff | D8／SC-08；本条授权文本写明不改 |
| `max(日期)` 在大表上拖慢工具调用 | 单字段聚合、独立超时；O3 明确本版不缓存，避免用旧水位冒充 |
| overlay 校验器拒绝新键 | O1 已闭合落点 overlay 顶层 `freshness`；未获 R4 不得改发布校验器必填规则 |
| 调用方继续把 mtime 当截止期 | 分字段 + 固定说明句；P0-4 仍写未校验 |

## 9. 关联

- 清单：P0-B；强化 P0-4，但不在本版改写 P0-4
- Plan：`docs/plans/lucy-20261109-physical-freshness-contract-plan.md`
- 日跑里断言「截止期仍未校验」属于 P0-6 的非目标；本条提供真源之后才可能另开断言

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条只改 `lucy_freshness` 的结果合同。
- 不改变：页面、路由、页头动作、空态、错误态、确认面、用户可见 WebUI 文案。
