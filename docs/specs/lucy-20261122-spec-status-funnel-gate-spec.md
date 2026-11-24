# Spec 开发台状态漏斗门禁 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec／仓库级评审门禁 / **v1.0** |
| 日期 / 目标版本 | 2026-11-22／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-73**／REQ-030-094／**P1**（文档治理；不挡原 P0）。**不入 0.30 核心分母**。伞下双规则：`status-funnel`＋姊妹 `status-vocab` |
| 台账号 | 无。挂现行 `0.30` 执行总账 |
| 阶段 | S5 |
| 状态 | S5｜v1.2。功能合同已收口（2026-11-22，P1-73／P1-35 S5 收口批）。开发授权已获得；Wave A／B 已落地；**v1.1 MIG＋`inventory-stage` 已落地**；**v1.2 降熵补丁（委托人选 A＋B＋C）**：一条主漏斗＋分叉终态；D8／D8b／SC-06／D2 修订。SC-01–SC-15 证据关闭（[审计](../reviews/2026-11-22-p1-73-sc-evidence-audit.md)）；实现 CR PASS（[CR](../reviews/2026-11-22-p1-73-status-funnel-implementation-cr.md)）。伞级事实源＝漏斗 Spec；姊妹建议书为 Wave A 子句。测试台 not_registered；不入核心分母。未挂 0.30 总账的存量 Spec 仍可留 grandfather。本条收口不表示可上线 |
| 决策来源 | 2026-11-22 漏斗＋状态词互补一并审阅；[伞评审](../reviews/2026-11-22-p1-73-status-governance-umbrella-review.md) REQUEST CHANGES；同日委托人批准代理反馈改裁并定稿 |
| 需求来源 | 自由长文「状态」不可机读；英文／中文两套状态词并行；见 `inbox/20261122-1123-spec-funnel.md` |
| 实施主体 | 文档、`scripts/lint-spec-docs.mjs`、夹具、`DEVELOPMENT.md`、grandfather json、`package.json`、`lucy-ci.yml`、`test-layers-and-release-gates.md`。**不改** WebUI／Proxy／Ops／KTX 运行时代码 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「状态登记只有一份现值」「端到端三台账」「新增 Spec／Plan 的落盘清单」「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **不改**既有业务功能合同。[交互合同](lucy-20261107-ui-interaction-contract-gate-spec.md)、[状态机合同](lucy-20261118-multi-step-state-machine-contract-gate-spec.md)。姊妹：[状态词建议书](../plans/lucy-20261122-spec-status-vocabulary-chinese-plan.md)（`status-vocab`） |
| 实施计划 | [`docs/plans/lucy-20261122-spec-status-funnel-gate-plan.md`](../plans/lucy-20261122-spec-status-funnel-gate-plan.md) |
| 评审 | [2026-11-22 伞审阅](../reviews/2026-11-22-p1-73-status-governance-umbrella-review.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.2｜S5 | 2026-11-22：委托人选 **A＋B＋C 降熵补丁**——一条主漏斗＋分叉终态；修订 D2／D8／D8b／SC-06；§3.1「发布取证已收口」；总账收口分列。≠ 可上线 |
| v1.1｜S5 | 2026-11-22：委托人授权 MIG 回填＋总账↔Spec 阶段一致性 lint；规则 `inventory-stage`／`lint:inventory-stage`／PR CI；0.30 总账主 Spec 已迁出 grandfather；附录全仓残余仍可另批。≠ 可上线 |
| v1.0｜S5 | 2026-11-22：功能合同已收口（P1-73／P1-35 S5 收口批）；SC-01–SC-15＋实现 CR PASS；全仓 MIG 另授权；≠ 可上线 |
| v1.0｜S3 | 2026-11-22：开发授权已获得（委托人授予 P1-73／REQ-030-094）；阶段 S2→S3；实现进行中；仍 ≠ 功能合同收口；≠ 可上线 |
| v1.0 | 闭合伞评审 blocker／已批准改裁；OQ-1…7 裁定；终稿确权；阶段 S2；未获开发授权 |
| v0.2-draft | 与状态词建议书合并审阅：双规则伞、映射表、分工 |
| v0.1-draft | 初稿 |

## 闭口层级

- 层级：功能合同
- 本条承诺：门禁生效后，被检查的 Spec 须带可解析「阶段」码；「状态」与阶段不得机器可判矛盾；阶段格不得冒充可上线／UAT；Plan 须镜像阶段码；grandfather 内未授权文件不因缺阶段误红；Wave B 须把 `status-funnel` 接入 PR CI（与 Wave A 同实现库）；落地 diff 不触及业务运行时代码。姊妹 `status-vocab` 出口见建议书。
- 本条出口：SC-01 至 SC-15。
- 不在本条出口：全仓阶段迁移（附录）；业务运行时；UAT；可上线；husky；中文九词正向硬枚举；缺「状态」行（归既有 `metadata`）。
- 上线关系：本条收口不表示可上线；任一 Spec 到 S5 不表示系统可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 「阶段」「漏斗」「S1–S5」「合同收口」只用于治理与门禁，不出现在产品界面，不写入术语标准。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 本条落地不改页面、组件、颜色、间距或文案。
- [ ] Design System Compliance 四段式继续检查组件；本条追加的是文档门禁，不替换四段式。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 无。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面。本条只增加文档门禁与 lint，不改页面。
- 不改变：页面、路由、页头动作、空态、错误态、确认面、用户可见文案。

## 受影响画像

| 画像 | 判定 | 变更前 → 变更后 | 可核对依据 |
|---|---|---|---|
| 问数方 | ＝ | 无产品面变化 | 不改 Proxy／问数路径 |
| 治理方 | ↑ | 状态靠猜 → 阶段码可机拦 | §3；SC-01–SC-06 |
| 运维方 | ＝ | 无运行时变化 | 白名单禁止运行时 |
| 管理层 | ↑ | 漏斗可汇总 | §2 |

无 `↓`。

## 1. 背景与已核实事实

| 事实 | 证据 |
|---|---|
| 「状态」自由长文难映射漏斗 | 2026-11-22 盘点；`docs/specs` 含状态行约 138／总数约 151（口径：含「状态」元数据行的 Spec，非整仓文件数） |
| 英文／中文两套状态词并行 | 状态词建议书 §1 |
| DEVELOPMENT：开发台 ≠ 测试台 ≠ 可上线 | DEVELOPMENT 三台账 |
| 伞评审 REQUEST CHANGES | [评审报告](../reviews/2026-11-22-p1-73-status-governance-umbrella-review.md) |
| `lucy-ci.yml` 不跑 `lint:spec-docs` | 建议书 §4.3 |

## 2. 目标与非目标

**目标**

1. 冻结开发台 CRM 漏斗阶段字典（S1–S5 + X_*）。
2. Spec 头部可解析「阶段」行；「状态」补充且不与阶段矛盾。
3. 单 Spec 终态＝S5（或 X 退出）；系统上线不在字典。
4. `lint:spec-docs` 规则 `status-funnel`；与 `status-vocab` 同伞、同实现库。
5. Wave A→B；**Wave B 必接 PR CI**（`lucy-ci.yml` 调用含 `status-funnel` 的检查，可经全量 `lint:spec-docs` 或等价导出）。
6. DEVELOPMENT 落盘子节 + 落盘清单；测试门禁文档登记新命令／规则。

**非目标**

- 不把 UAT／可上线写成阶段。
- 不在本条迁完全仓阶段码。
- 不改业务运行时；不建 husky。
- 不强制中文九词正向枚举；缺状态行不归本规则（归 `metadata`）。

## 3. 决策（已裁定）

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 主漏斗 | S1→S2→S3→S4→S5；S5＝合同收口终态。**保留 S4**（OQ-1＝A） |
| D2 | 退出／旁路 | X_DEF／X_SUP／X_REL；发布取证**收口**终态必须 X_REL（实施期仍走 S1–S4，见 D8） |
| D3 | 阶段文法 | 恰好一行阶段；单元格去掉空白与 `*` 后整格匹配 CODE（大小写敏感） |
| D4 | S5 矛盾 | 阶段＝S5 时，状态行去掉空白后若命中「未收口」显式短语表 → 失败。短语表含：`≠功能合同收口`、`≠完整功能合同`、`≠功能已收口`、`功能合同尚未收口`、`功能合同待终稿复核`、`未收口`、`尚未收口`、`实现进行中`。**不含** `Wave 0`。v1 用显式表；正面语义判定留 v1.1。S1／S2 不得含「开发授权已获得」 |
| D5 | 禁止冒充 | （1）**阶段格**不得含 `可上线`／`UAT PASS`／`测试台PASS`／散文／空格；（2）**状态行**：取首个 `阶段:`／`阶段：` 之后的连续 token，若命中 {`可上线`, `UAT PASS`, `测试台PASS`} → 失败；该 token 为 `≠`-前缀形式（如 `≠可上线`、`≠ UAT PASS`、`≠功能合同收口`）→ 放行（DEVELOPMENT 标准写法） |
| D6 | 收口范围 | 可选「收口范围」仅当 S5 |
| D7 | 镜像 | Plan 状态去空白与前导 `*` 后须以 `阶段:<CODE>`／`CODE｜`／`CODE。` 开头。**总账跟进状态＝伞级一句**（本 Spec 状态行），不以子建议书另镜像 |
| D8 | 发布取证 | **不是第二条漏斗**。实施期与功能合同共用 S1–S4；收口终态＝X_REL；**禁止 S5**。口语禁止对发布取证说「推进到 S5」 |
| D8b | X_REL 在途矛盾 | 阶段＝X_REL 时，状态行去掉空白后若命中在途短语表 → 失败。短语表含：`实现进行中`、`终稿未确权`、`未获开发授权`、`开发未授权`、`评审前不开发`、`Wave 0` |
| D9 | grandfather | 落地提交**前** `git ls-files docs/specs/*.md` 快照；落地提交内新建 Spec 不进名单。无口令无标记 → 本规则通过 |
| D10 | 授权口令 | 「开发授权已获得」或标记行「状态漏斗门禁：纳入检查」 |
| D11 | 生效 | 定稿 ≠ 门禁生效；须另获开发授权 |
| D12 | 强制面与 CI | 主强制面＝`lint:spec-docs`（含 `status-funnel`）。**Wave B 必做**：`lucy-ci.yml` 接入含本规则的检查（全量 `lint:spec-docs` 或导出子集）。不新建 husky |
| D13 | 范围 | 入总账；不入核心分母 |
| D14 | 迁移 | 附录指针；另授权 |
| D15 | 双规则伞 | `status-funnel`＋`status-vocab`；共享实现；Wave A＝vocab，Wave B＝funnel（OQ-6＝A） |
| D16 | 中文九词 | 软推荐；映射 §3.1；不代替阶段码 |
| D17 | 总账 lint | v1 仅 Spec＋Plan（OQ-2＝A）；**v1.1 已落地**：规则 `inventory-stage`（总账 `CODE｜` ↔ Spec「阶段」；委托人 2026-11-22 授权 MIG＋lint） |
| D18 | hook | 本条不做 git／Cursor 复制判定 hook（OQ-5＝A） |

### 3.1 阶段码 ↔ 推荐中文（软；一对多已标明）

| 阶段码 | 推荐中文原子（软） | 说明 |
|---|---|---|
| S1 | 草案 | 终稿未确权；未获开发授权 |
| S2 | 终稿已确权 | 已确权、尚未「开发授权已获得」 |
| S3 | 开发授权已获得 | 实现中或未报实现已落地 |
| S4 | 实现已落地 **或** 待验收 | 一对多；代码已落地、合同未收口 |
| S5 | 功能合同已收口 | 终态；可选收口范围 |
| X_SUP | 被取代 | 退出 |
| X_DEF | 延期 **或** 结案不做 | 一对多 |
| X_REL | 发布取证已收口 | 发布取证收口终态（旁路码；不是第二条 S1→S5） |

### 3.2 姊妹规则分工

| 规则 | 扫描什么 | 硬／软 | 存量策略 |
|---|---|---|---|
| `status-vocab` | 「状态」行英文禁用词；表头不得 `Status` | 英文 deny-list＝硬；九词＝软 | **本规则落地前**清零本规则违规（英文 `Draft` 等）；不申请本规则基线；**缺状态行不归本规则**（归 `metadata`） |
| `status-funnel` | 「阶段」行；D4／D5；Plan 镜像 | 阶段码＝硬 | grandfather；迁移另批；**Wave B 进 PR CI** |

## 4. 文法（Normative）

解析前删除围栏代码块。

### 4.1 阶段行

元数据表中匹配 `| 阶段 | … |`（表头去 `*`）。单元格值：去掉空白与全部 `*` 后必须整格等于：

`S1` `S2` `S3` `S4` `S5` `X_DEF` `X_SUP` `X_REL`

### 4.2 收口范围（可选）

仅 S5：`| 收口范围 | <LABEL> |`（LABEL 非空、单行、无 `|`）。

### 4.3 状态行

现有 `metadata` 要求 `| 状态 |`。本规则另检 D4／D5。

### 4.4 Plan 镜像前缀

Plan `| 状态 |` 值去掉首尾空白与前导 `*` 后须匹配 `阶段:<CODE>`／`<CODE>｜`／`<CODE>。`。

### 4.5 标记行

正文去空白后恰好 `状态漏斗门禁：纳入检查` → 取消 grandfather 跳过。

## 5. 核心流程（伪代码）

```
function stripCell(s): return removeSpacesAndAsterisks(s)

function checkStatusFunnel(specRel, text, planText, opts):
  grandfathered = specRel in opts.grandfatherFiles
  authorized = statusRow(text).contains("开发授权已获得")
  marked = hasExactLine(text, "状态漏斗门禁：纳入检查")
  if grandfathered and not authorized and not marked:
    return PASS

  code = parseStageCode(text)  # 去 * 后整格；缺/非法 → FAIL
  if closeLayer(text) == "发布取证" and code == "S5":
    return FAIL("发布取证禁止 S5；收口用 X_REL，实施期 S1–S4")
  if code == "S5" and hitsUnclosedPhraseTable(statusRow(text)):
    return FAIL("S5 与未收口短语矛盾")
  if code == "X_REL" and hitsXRelOpenPhraseTable(statusRow(text)):
    return FAIL("X_REL 与在途短语矛盾")
  if code in {S1,S2} and statusRow(text).contains("开发授权已获得"):
    return FAIL("S1/S2 不得含授权口令")
  if stageCellHasProseOrShipAlias(stageCell(text)):  # 阶段格
    return FAIL("阶段格禁止散文/可上线/UAT")
  if statusClaimsStageAlias(statusRow(text)):  # 首个「阶段:」/「阶段：」后连续 token ∈ {可上线, UAT PASS, 测试台PASS}；≠-前缀放行
    return FAIL("状态行禁止把可上线/UAT当作阶段码")
  if hasScopeRow(text) and code != "S5":
    return FAIL("收口范围仅允许 S5")
  if planText != null and pairedPlan(specRel):
    if not planStatusMirrors(planText, code): return FAIL("Plan 镜像")
  return PASS
```

## 6. 验收

| 编号 | 验收 | 验证方式 |
|---|---|---|
| SC-01 | 无阶段行 → 失败（非 grandfather） | 夹具 |
| SC-02 | 非法 CODE（含未去 `*` 导致不匹配已由实现去 `*`）→ 失败 | 夹具 |
| SC-03 | S5 + 未收口短语表命中 → 失败；`≠功能已收口` 须命中 | 夹具 |
| SC-04 | S1/S2 + 「开发授权已获得」→ 失败 | 夹具 |
| SC-05 | 阶段格含 `可上线` → 失败；状态行 `≠ 可上线` → 通过 | 夹具 |
| SC-06 | 发布取证 + S5 → 失败；发布取证 + S1–S4／X_REL（无在途短语）→ 通过；X_REL + 在途短语 → 失败 | 夹具 |
| SC-07 | S5 + 合法收口范围 → 通过 | 夹具 |
| SC-08 | 非 S5 + 收口范围 → 失败 | 夹具 |
| SC-09 | grandfather 无口令无标记 → 通过 | 夹具 |
| SC-10 | grandfather + 授权口令 + 缺阶段 → 失败 | 夹具 |
| SC-11 | 标记行取消跳过 | 夹具 |
| SC-12 | Plan 前缀与 CODE 不一致 → 失败 | 夹具 |
| SC-13 | DEVELOPMENT 落盘清单有指针；`test-layers-and-release-gates.md` 登记规则／命令 | 文 diff |
| SC-14 | 落地 diff ⊆ §8 白名单（含 package.json、lucy-ci.yml、test-layers 文档） | 路径检查 |
| SC-15 | Wave B：`lucy-ci.yml` 已接入含 `status-funnel` 的检查 | 文 diff／CI |

测试台：not_registered。全量 `lint:spec-docs` exit 0 **不作为**本条验收口径（可被无关文件染红）；以本规则夹具＋§8 路径为准。

## 7. 开放项（已闭合）

| ID | 裁定 |
|---|---|
| OQ-1 | **A** 保留 S4 |
| OQ-2 | **A** v1 仅 Spec＋Plan |
| OQ-3 | **A** 先 grandfather，迁移另授权 |
| OQ-4 | **A** X_REL 允许散文 |
| OQ-5 | **A** 不做 hook |
| OQ-6 | **A** 先 vocab 后 funnel |
| OQ-7 | **A** 并入 P1-73 |

## 8. 落地白名单（获开发授权后）

允许：

- `scripts/lint-spec-docs.mjs`、`scripts/lint-spec-docs.test.mjs`
- `package.json`、`.github/workflows/lucy-ci.yml`（Wave A 与 Wave B **均可用**）
- `docs/governance/spec-status-funnel-grandfather.json`（新建）
- `docs/governance/DEVELOPMENT.md`
- `docs/governance/test-layers-and-release-gates.md`
- 本 Spec／Plan／姊妹建议书／`docs/README.md`／`docs/plans/README.md`／总账与需求池伞级镜像句
- 可选：仅包装 lint 命令的 hook 配置（默认不做）

禁止：`webui/src/**`、`webui/server/**`、KTX、客户部署；无名单批量改业务 Spec；第二份词表／字典拷贝。

SC-14 路径检查 **以本节为准**。

## 9. 附录：存量迁移批（指针）

草稿：`inbox/20261122-1123-spec-funnel.md`（非正式 SOT）。

**2026-11-22 已授权并完成（0.30 总账面）**：主 Spec／配对 Plan／总账 `CODE｜` 回填＋`inventory-stage` lint；脚本 `npm run mig:funnel-inventory`。未挂 0.30 总账、仍留 grandfather 的历史 Spec 可另批 MIG，**≠** 本条要求一次清零全仓。

## 10. 落盘清单自检

| # | 项 | 本条 |
|---|---|---|
| 1 | Spec／Plan 共用 slug | 是 |
| 2 | 伪代码 | §5 |
| 3 | 元数据阶段／状态 | 头部 |
| 4 | Plan 五类小节 | 是 |
| 5–6 | Terminology／DS | 有 |
| 7 | 索引 | 是 |
| 8 | 新命令／CI 登记 test-layers | Wave 落地时；白名单含该文件 |
| 9 | 台账号 | 无 |
| 10 | 机器门禁 | 授权后；全量 exit 0 非本条口径 |
| 11 | 闭口层级 | 有 |
| 12 | stale-status | 无裸写已作废句 |
| 13 | 交互合同 | 豁免 |
| 14 | 总账 | P1-73 |
| 15 | 三台账 | 测试台 not_registered；不写 UAT 进阶段 |
| 16 | 主路径可用性 | 问数＝；治理↑ |
| 17 | 受影响画像 | 有 |
| 18 | 浏览器 | 不适用 |
