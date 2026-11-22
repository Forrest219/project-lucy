# P1-73 SC-01…SC-15 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-73 SC-01…SC-15 证据审计 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Claude（Builder，Track A／T73） |
| 委托人 | xingchen |
| 基于材料 | [`lucy-20261122-spec-status-funnel-gate-spec.md`](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) §6；`scripts/lint-spec-docs.test.mjs`；`scripts/lint-spec-docs.mjs`；`.github/workflows/lucy-ci.yml`；`package.json`；`docs/governance/DEVELOPMENT.md`；`docs/governance/test-layers-and-release-gates.md`；`docs/governance/spec-status-funnel-grandfather.json`；基线 SHA `a093844f`（落地提交 `78c8d259`） |
| 适用范围 | 开发台功能合同收口（S5）证据；≠ UAT PASS；≠ 可上线 |
| 输出位置 | `docs/reviews/2026-11-22-p1-73-sc-evidence-audit.md` |

## 1. 复跑结果（2026-11-22）

| 命令 | 结果 |
|---|---|
| `node --test scripts/lint-spec-docs.test.mjs` | 56 用例，55 过／1 红。红＝`仓库现状：门禁在基线之上必须通过`，原因是已提交的 `lucy-20261122-s4-to-s5-parallel-wave-plan.md` 形态违规（plan-parts／metadata），**与 status-funnel／status-vocab 无关**（见 §3） |
| `npm run lint:status-vocab` | exit 0 |
| `npm run lint:status-funnel` | exit 0 |
| statusCell 严格重扫 grandfather（150 份） | 授权或标记行且缺 `\| 阶段 \|`＝**0** |

SC-01…SC-12 全部由 `scripts/lint-spec-docs.test.mjs` 的 status-funnel 夹具覆盖（以下行号为该文件）；夹具内 `runFunnel`／`checkStatusFunnel` 调用的是与 `npm run lint:status-funnel` 同一实现。

## 2. SC 证据表

| 编号 | Spec 验收 | 证据指针 | 判定 |
|---|---|---|---|
| SC-01 | 无阶段行 → 失败（非 grandfather） | 夹具 `scripts/lint-spec-docs.test.mjs:752`「SC-01／SC-02」首条 `funnelFail(stage: undefined)`；实现 `scripts/lint-spec-docs.mjs` `checkStatusFunnel` 的 `stageRows.length !== 1` | 满足 |
| SC-02 | 非法 CODE → 失败；去 `*` 后整格匹配 | 同夹具 :752：`S6`、`S3｜可上线`、`s3` 失败，`*S3*`、` S3 ` 通过；`funnelStripCell` | 满足 |
| SC-03 | S5＋未收口短语 → 失败；`≠功能已收口` 命中 | 夹具 :761「SC-03」（`≠功能已收口`、`≠ 功能合同收口`、`功能合同尚未收口`、`实现进行中`）；`FUNNEL_UNCLOSED_PHRASES` | 满足 |
| SC-04 | S1／S2＋「开发授权已获得」→ 失败 | 夹具 :769「SC-04」（S1／S2 失败、S3 通过） | 满足 |
| SC-05 | 阶段格含 `可上线` → 失败；状态行 `≠ 可上线` → 通过 | 夹具 :752 `stage: "S3｜可上线"` 失败（阶段格）；:775「SC-05」`≠ 可上线`／`阶段：≠ 可上线` 通过，`阶段：可上线`／`阶段： UAT PASS`／`阶段：测试台PASS` 失败；`funnelStatusClaimsAlias` | 满足 |
| SC-06 | 发布取证＋非 X_REL → 失败 | 夹具 :785「SC-06」（S5＋发布取证失败，X_REL 通过） | 满足 |
| SC-07 | S5＋合法收口范围 → 通过 | 夹具 :790「SC-07／SC-08」首条；空范围失败 | 满足 |
| SC-08 | 非 S5＋收口范围 → 失败 | 夹具 :790 `stage: "S4"` ＋范围 → `/收口范围/` | 满足 |
| SC-09 | grandfather 无口令无标记 → 通过 | 夹具 :796「SC-09／SC-10／SC-11」首条；生产名单双向断言 :812（本批改为预期集与实际失败集 `deepEqual`，当前预期集＝实际集＝空） | 满足 |
| SC-10 | grandfather＋授权口令＋缺阶段 → 失败 | 夹具 :796 第二条（`开发授权已获得；实现中`，grandfather＝true → `/恰好一行「阶段」/`） | 满足 |
| SC-11 | 标记行取消跳过 | 夹具 :796 第三条（`marker: true`） | 满足 |
| SC-12 | Plan 前缀与 CODE 不一致 → 失败 | 夹具 :802「SC-12」（`阶段:S3`／`S3｜`／`S3。`／`*S3｜…*` 通过；`**S3**｜`、`阶段:S4` 与 S3、`S3` 与 S4 失败） | 满足 |
| SC-13 | DEVELOPMENT 落盘清单有指针；test-layers 登记规则／命令 | `docs/governance/DEVELOPMENT.md`「开发台漏斗阶段码」（约 195–208 行）与落盘清单第 20 项（约 390 行）；`docs/governance/test-layers-and-release-gates.md` 第 44 行（`lint:status-funnel` 登记，本批已改正存量残余句）、第 301 行 `spec-and-unit` 含 `lint:status-vocab`／`lint:status-funnel`；`package.json` 第 18–20 行 | 满足 |
| SC-14 | 落地 diff ⊆ §8 白名单 | 见 [实现 CR](2026-11-22-p1-73-status-funnel-implementation-cr.md) §2；落地提交 `78c8d259` 对 `webui/**` 零改动 | 满足（含 1 条边界说明，CR O-1） |
| SC-15 | Wave B：`lucy-ci.yml` 含 `status-funnel` | `.github/workflows/lucy-ci.yml` 第 75 行 `- run: npm run lint:status-funnel`（第 70–71 行同一 job 已有 `lint:spec`／`lint:status-vocab`）；`package.json:19` 定义 `lint:status-funnel` 为 `node scripts/lint-spec-docs.mjs --rule=status-funnel` | 满足 |

无空行；无 GAP。

## 3. 与本条无关的红灯（只记录）

| 项 | 说明 | 对 P1-73 的影响 |
|---|---|---|
| `docs/plans/lucy-20261122-s4-to-s5-parallel-wave-plan.md` | 缺目标／开工前置／验收／完成定义／风险小节，元数据缺状态／授权边界／验收（全量 `lint:spec-docs` 与 `仓库现状` 测试红）；不在基线 | Spec §6 末句：全量 `lint:spec-docs` exit 0 **不作为**本条验收口径；不阻断 SC-01…SC-15 |
| `lucy-ci.yml` 第 73–75 行注释 | 仍写「12 份已授权未迁……本步骤红」，与现实（0 份、exit 0）不符 | 仅注释；SC-15 以步骤存在为准。建议 R 另行处理（该文件不在 T73 §3.1 白名单） |

## 4. 结论

SC-01…SC-15 均有可核对证据指针，无 GAP。证据层面支持 P1-73 功能合同 S5；S5 ≠ UAT PASS（测试台 `not_registered`）；≠ 可上线。
