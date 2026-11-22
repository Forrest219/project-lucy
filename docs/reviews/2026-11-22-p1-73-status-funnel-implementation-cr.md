# P1-73 status-funnel 实现 Code Review

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-73 status-funnel 实现 Code Review |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Claude（Builder，Track A／T73；实现自审，须 R-1 复核） |
| 委托人 | xingchen |
| 基于材料 | [Spec §8 落地白名单](../specs/lucy-20261122-spec-status-funnel-gate-spec.md)；落地提交 `78c8d259`；后续治理提交 `54b9f239`；本批 T73 改动；基线 SHA `a093844f`；[SC 证据审计](2026-11-22-p1-73-sc-evidence-audit.md) |
| 适用范围 | P1-73／REQ-030-094 功能合同收口（S5）的实现审阅；≠ UAT PASS；≠ 可上线 |
| 输出位置 | `docs/reviews/2026-11-22-p1-73-status-funnel-implementation-cr.md` |

## 1. 结论

**PASS**。无阻断项。落地 diff 在 Spec §8 白名单内；运行时代码（`webui/src/**`、`webui/server/**`）零改动；SC-01…SC-15 证据齐备。含 2 条非阻断观察（O-1、O-2）和 2 条与本条无关的遗留（§4）。

## 2. 路径白名单对照（Spec §8）

落地提交 `78c8d259`（17 个文件）：

| 路径 | §8 归属 | 判定 |
|---|---|---|
| `scripts/lint-spec-docs.mjs`、`scripts/lint-spec-docs.test.mjs` | 允许 | 通过 |
| `package.json`（+2 行：`lint:status-vocab`／`lint:status-funnel`） | 允许 | 通过 |
| `.github/workflows/lucy-ci.yml`（+5 行） | 允许 | 通过 |
| `docs/governance/spec-status-funnel-grandfather.json`（新建） | 允许 | 通过 |
| `docs/governance/DEVELOPMENT.md`、`docs/governance/test-layers-and-release-gates.md` | 允许 | 通过 |
| 本 Spec／Plan／姊妹建议书、`docs/README.md`、`docs/plans/README.md` | 允许 | 通过 |
| 需求池 `lucy-20261102-…-requirement-pool-plan.md`、总账 `lucy-20261107-…-feature-inventory-pool.md` | 允许（总账与需求池伞级镜像句） | 通过 |
| `docs/reviews/…-umbrella-review.md`、`…-umbrella-recheck.md`（新建） | 评审记录，不改运行时、非业务 Spec | 通过 |
| `docs/plans/2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md`（1 行） | 不在 §8 字面清单 | **O-1** |
| `webui/**`、KTX、客户部署、`scripts/lint-spec.mjs` | 禁止 | 零改动（`git diff --stat 78c8d259^ 78c8d259 -- webui scripts/lint-spec.mjs` 为空） |

**O-1（非阻断）**：该 Plan 状态行由「当前 Draft `r6`」改为「当前草稿修订包 `r6`」，仅消除英文禁用词 `Draft`。依据 Spec §3.2「`status-vocab` 本规则落地前清零违规；不申请基线」，属 Wave A 必要前置，且不改变业务语义。

后续 `54b9f239`（`docs(governance): clear lint:spec-docs status-funnel and plan shape`）：只改 Spec／Plan 状态镜像句、Plan 小节形态、README、基线 json 缩减；`webui` 零改动；属 P1-73 落地后清存量红灯，与 §8「无名单批量改业务 Spec」的边界见 **O-2**。

**O-2（非阻断）**：`54b9f239` 批量触及约 20 份业务 Spec／Plan（多为 1–3 行状态镜像句）。目的为清 `status-funnel` 红灯，未改功能合同正文；同时使 statusCell 严格重扫降为 0。建议 R 在收口记录里声明该批为「状态镜像清残余」，不含业务语义改动。

## 3. 实现审阅

| 检查项 | 结论 | 证据 |
|---|---|---|
| 文法 D3：恰好一行阶段；去空白与 `*` 后整格匹配，大小写敏感 | 通过 | `checkStatusFunnel`：`funnelFieldRows`＋`funnelStripCell`＋`FUNNEL_CODES` |
| D4 未收口短语表、D5 冒充、D6 范围、D7 Plan 镜像、D8 发布取证 | 通过 | 对应夹具见 SC 审计表 |
| D9／D10 grandfather：无口令无标记跳过；口令或标记行取消跳过 | 通过 | `grandfathered && !marked && !authorized → []` |
| 状态单元格解析与围栏 | 通过 | `statusCell`（前 60 行）、标记行用 `stripFences` |
| 与 `status-vocab` 共享实现，导出入口 `--rule=status-funnel` | 通过 | `package.json:19`；`lucy-ci.yml:75` |
| 主路径可用性 | 通过 | 纯文档 lint；问数／MCP 运行时零改动；grandfather 未授权文件不因缺阶段被红 |
| 本批 T73 改动 | 通过 | `scripts/lint-spec-docs.test.mjs` 仅改 SC-09／SC-10 生产名单断言为双向；`test-layers-and-release-gates.md` 第 44 行去除过时「MIG 前 CI 红」；均在 §8 内 |
| 本批最小阶段行补齐 | 无需 | statusCell 严格重扫＝0，见 `inbox/s5-closure-20261122/phase-backfill.txt`；**全仓 MIG（附录 MIG-01…）仍另授权** |

## 4. 与本条无关的遗留（不阻断）

1. `docs/plans/lucy-20261122-s4-to-s5-parallel-wave-plan.md` 形态违规，使全量 `lint:spec-docs` 与 `仓库现状` 测试红。Spec §6 明确全量 exit 0 不作为本条验收口径。
2. `.github/workflows/lucy-ci.yml` 第 73–75 行注释过时（称 12 份存量红）。

## 5. 复跑记录

- `node --test scripts/lint-spec-docs.test.mjs`：56 用例，55 过；唯一红为遗留 1。
- `npm run lint:status-vocab`、`npm run lint:status-funnel`：exit 0。

## 6. 范围声明

本 CR 只证明 P1-73 功能合同实现与门禁证据。**≠ UAT PASS**（测试台 `not_registered`）；**≠ 可上线**；**≠ 全仓阶段迁移**。
