# Spec 功能合同收口盘点（`docs/specs/` 60 份实测）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 范围 | `docs/specs/` 全部 60 份 md 文件，按「闭口层级 + 出口矩阵执行状态」实测分档 |
| 数据源 | 仓库当前 HEAD（`lucy-v0.25`）的 60 份文件正文；无外部输入 |
| 用途 | [`2026-11-01-spec-closure-batch-handoff.md`](2026-11-01-spec-closure-batch-handoff.md) 第三节把 P1／P2 的待办分档「以本份为准」，本文件即该分档 |
| 复算方式 | 判据写在第一节，全部可由 `grep`／`node` 脚本复算，见第六节 |

> ⚠️ **本文件的来历**：交接文档在 2026-11-01 13:55 的提交（`c1ad7a8b`）里两处链接到
> `2026-11-01-spec-closure-inventory.md`，并写明「Claude Code 于 2026-11-01 13:52 产出的
> 逐份实测盘点」。但**那份文件从未落进仓库**——交接文档链接的是一个不存在的路径，
> 仓库里没有任何自动链接检查器，所以这个断链不会被任何门禁报出来。
> 本文件是按同一判据重做的实测版，数字以本文件为准。

---

## 一、判据（可复算）

分档按**先形态、后状态**两步走，顺序不可颠倒。

**第一步（形态）**：文件里有没有「闭口层级」小节，即有没有 `^- 层级：` 这一行。

- 有 → 该文件承诺了某一层的出口，收口与否按第二步判。
- 没有 → 形态债。它没有声明自己承诺哪一层出口，**无法判定收口**，先补声明再判。

**第二步（状态）**：按状态行原文的措辞落档。

| 档 | 判据 | 含义 |
|---|---|---|
| **A 已收口** | 状态行明写「已收口／已关闭／已验收」，且能点名它关掉了哪几条出口 | 这条已经站在功能合同层上了 |
| **B 可立即收口** | 出口矩阵**已逐条执行并全绿**（状态行点名了编号），只差收口手续（补闭口层级 + 改状态行 + 写收口记录） | 下一批最省力的一批 |
| **C 要补出口才能收口** | 出口编号存在，但状态行明写「未执行／未验收／未走查／保持开放」 | 要么补用例，要么按层收窄出口措辞 |
| **D 不具备收口条件** | 状态行明写「已被取代，不得实施／暂不开发／待评审／待决策／不授权」 | 这轮不动它 |
| **E 发布取证层** | `^- 层级：发布取证` | **0 份**——这一层目前是空的 |

**另设一档 F（非功能 Spec）**：文件根本不是功能 Spec（分析笔记、竞品对标、交付计划、
SOW 材料、清单、演讲素材）。它们不参与收口统计，但它们占着 `docs/specs/` 的位置，
所以单列出来，避免被误算成「待收口的存量债」。

---

## 二、总账

| 档 | 份数 | 说明 |
|---|---|---|
| A 已收口 | **12** | 其中 9 份状态行原话是「功能合同已收口」，另 3 份是「已关闭／已验收」 |
| B 可立即收口 | **4** | 出口已跑绿，只差手续 |
| C 要补出口才能收口 | **15** | |
| D 不具备收口条件 | **7** | |
| E 发布取证层 | **0** | **空层**——功能合同层推给这一层的证据，当前没有任何 Spec 承载 |
| F 非功能／早期 Spec | **22** | 不参与收口统计（10 份非功能 + 12 份早期功能 Spec） |
| **合计** | **60** | |

**形态债**：60 份里只有 **18 份**写了「闭口层级」小节；**42 份**没有。
其中 22 份落在 F 档（10 份根本不是功能 Spec，本就不需要），**剩下 20 份是判为
A／B／C／D 的真 Spec 却没有闭口层级声明**——它们承诺了哪一层出口从未被写下来过。
再加上 F 档里的 12 份早期功能 Spec，**形态债共 32 份**。

---

## 三、A 档 · 已收口（12）

| 文件 | 状态行原文要点 | 关掉的出口 |
|---|---|---|
| `lucy-20261020-v2p5-semantic-batch-operations-spec.md` | 已关闭（2026-10-31，§10.3） | FC-01–FC-32 |
| `lucy-20261025-v0p25-hive-direct-connection-spec.md` | 编译侧功能合同已收口（2026-10-30） | V01／V02／V06 + 配置失败关闭 |
| `lucy-20261029-question-budget-window-optimization-spec.md` | v1.0 功能合同已收口（2026-11-01） | SC-01–SC-48 逐条通过 |
| `lucy-20261029-url-driven-input-ime-composition-spec.md` | v1.0 功能合同已收口（2026-11-01） | SC-01–SC-23 |
| `lucy-20261030-access-grade-and-daily-question-kpi-spec.md` | v1.0 功能合同已收口（2026-11-01） | SC-01–SC-24、SC-26（SC-25 按 §8.1 排除） |
| `lucy-20261030-access-map-quiet-reading-spec.md` | v0.3 已验收（2026-10-30） | SC-01–SC-16 |
| `lucy-20261030-audit-context-bar-spec.md` | v1.0 功能合同已收口（2026-10-31） | SC-01–SC-08 |
| `lucy-20261030-publish-workbench-three-column-spec.md` | v0.4 功能合同已收口（2026-11-01） | PWB-01–26 中 25 条通过（PWB-24 浏览器走查按闭口层级不在出口） |
| `lucy-20261030-role-create-readonly-defaults-spec.md` | v0.2 功能合同已收口（2026-11-01） | RD-01–RD-10 |
| `lucy-20261030-row-policy-view-presentation-spec.md` | v0.3 功能合同已收口（2026-11-01） | SC-01–SC-18 |
| `lucy-20261030-sqlserver-table-identity-spec.md` | v1.0 功能合同已收口（2026-10-31） | SC-01–SC-11 |
| `lucy-20261030-version-info-identity-spec.md` | v1.2 已验收（2026-10-30） | SC-01–SC-10 |

> 12 份里 11 份写了「闭口层级＝功能合同」；`lucy-20261020-v2p5-semantic-batch-operations-spec.md`
> 写了 `层级：功能合同` 但状态行写「已关闭」，是本批交接（`4e194e16` 之前）落的。

## 四、B 档 · 可立即收口（4）

出口矩阵已经逐条跑绿，只差收口手续。**这一档是下一批的最优起点**。

| 文件 | 状态行原文要点 | 已跑绿的出口 | 还差什么 |
|---|---|---|---|
| `lucy-20261030-display-snapshot-invalidation-isolation-spec.md` | 实现已完成（WO Task 1–6，提交 `ced19d1a`）；SI-01–SI-13 已执行并通过 | SI-01–SI-13 | 补「闭口层级」小节 + 状态行 + 收口记录（SI-14 浏览器往返按层不在出口） |
| `lucy-20261025-v0p25-skill-owner-spec.md` | S1／S2／S3 已实施，自动化覆盖全绿；SKO-01–16 的验收口径已以自动化断言执行并全绿 | SKO-01–16 | 补「闭口层级」小节 + 状态行 + 收口记录（正式验收签核与客户交付不在出口） |
| `lucy-20261020-v2p5-audit-increment-spec.md` | 功能合同已收口；运行时取证未执行（§18.15）——功能合同是 S01–S07，运行时取证是 S08 | S01–S07 | 补「闭口层级」小节（状态行已明写功能合同／运行时取证两块互斥） |
| `lucy-20261030-hive-query-execution-spec.md` | 本模块 Wave A 已落地（审查→M1–M5，合成夹具 HQ） | HQ-01–HQ-18 的 Wave A 部分 | 补逐条落点表 + 状态行 + 收口记录（已写「闭口层级＝功能合同」） |

## 五、C 档 · 要补出口才能收口（15）

出口编号都在，但状态行明写没跑完。按 `DEVELOPMENT.md` 的出口判据：**真实实现缺口必须补用例，
不能靠收窄出口措辞掩盖**；只有「不是本条承诺的可打假检查」的项才收窄。

| 文件 | 状态行原文要点 | 未执行的出口 |
|---|---|---|
| `lucy-20261030-agent-roster-spec.md` | v1.2 已定稿；第 3 轮 Codex 确认可定稿，阻塞 0 高 0 | 设计已定稿，但出口矩阵尚未执行 |
| `lucy-20261030-login-accounts-spec.md` | v1.2 已定稿，可交付开发 | SC-01–SC-18 全部未执行 |
| `lucy-20261030-webui-release-ux-review-spec.md` | v1.2 已落地；结构套件 27/27 全绿，但走查和签字还没有做 | 走查与签字（浏览器层） |
| `lucy-20261022-v2p5-row-permission-management-spec.md` | P0 已收口（2026-10-30），出口只含 R2／R4／R5 | V01–V22 全部未执行；R1／R3 保持 P1；C19 待正式验收 |
| `lucy-20261024-v0p25-audit-reconciliation-view-spec.md` | 部分实现，未验收 | 验收矩阵在取得真实证据前仍为「未执行」 |
| `lucy-20261025-v0p25-access-authorization-summary-spec.md` | 已实现，未验收 | ASV-01–14 全部未执行 |
| `lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` | 已实现；2026-10-30 收口关闭 RTP-01–RTP-10、RTV-01–RTV-05、RTV-08 | **RTV-06、RTV-07 保持开放** |
| `lucy-20261025-v0p25-smtp-notifications-spec.md` | S1 与 S1.1 收口补丁已实施，自动化覆盖全绿 | SMTP-01–26 全部未按正式验收口径执行；S4 不启动、SMTP-26 保持 blocked |
| `lucy-20261025-v0p25-oidc-single-sign-on-spec.md` | 需求审查已签核通过，实施完成 | OIDC-01–26 全部未执行（OIDC-24／25 记 `blocked_environment`） |
| `lucy-20261027-v0p25-semantic-release-restore-spec.md` | v0.11 设计定稿，S1–S6 可交付开发 | SRR-01–SRR-24 全部未执行 |
| `lucy-20261028-v0p25-lucy-ops-control-plane-spec.md` | W-A 已授权实现（S1–S4）；W-B 不可交付开发 | 缺口 G1–G38、验收 VOPS-01–VOPS-78 全部未执行 |
| `lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md` | 实施中（W0 已授权启动） | 未执行浏览器、E2E、真实 Agent、升级或客户交付验证 |
| `lucy-20261025-v0p25-upgrade-candidate-verification-spec.md` | 已实现，未验收、非门禁 | 真实升级与真实备份未执行（`blocked_delivery`） |
| `lucy-20261025-v0p25-upgrade-e2e-automation-spec.md` | 已实现，未验收、非门禁 | 真实升级执行未授权（`blocked_delivery`） |
| `lucy-20261019-audit-trust-and-admin-investigation-spec.md` | 主体运行时骨架已实施；管理员第一现场已接入 Audit 页与 P0-4 使用概况页 | **现场验收（EA 矩阵）仍未执行** |

## 六、D 档 · 不具备收口条件（7）

| 文件 | 状态行原文要点 |
|---|---|
| `lucy-20261031-help-center-experience-spec.md` | 待评审；仅授权起草与登记，暂不开发 |
| `lucy-20261021-v2p5-help-center-spec.md` | **已被取代，不得实施**（由上一行那份取代） |
| `api-staging-admission-spec.md` | 计划支持；治理口径已冻结，暂不开发 |
| `lucy-20261026-warehouse-table-scan-capability-analysis.md` | 待决策（评估／能力分析，非 Spec） |
| `lucy-20261018-enterprise-security-and-real-e2e-spec.md` | 已批准；R8 基础设施负责人待指定；可发布 ❌ |
| `lucy-ci-restoration-spec.md` | 定稿 v1.0；不授权 T05 分支保护写入、不授权 R01 |
| `lucy-20261020-build-revision-identity-spec.md` | 已批准并实现；无可判定的出口矩阵编号 |

## 七、F 档 · 非功能／早期 Spec（22）

这些文件占着 `docs/specs/` 的位置，但本轮不参与收口统计。
**其中一部分可能是放错目录的**（分析笔记、竞品对标、SOW 材料、演讲素材），
是否迁出属目录治理议题，不在收口范围内。

非功能 Spec（10）：`ceo-one-report-lucy-data-model-notes`（数据模型笔记）、
`ceo-one-report-lucy-migration-delivery-plan`（交付计划）、
`ceo-one-report-sow-product-risk-register`（风险登记）、
`lucy-20261014-fivetran-context-layer-competitive-analysis`（竞品对比）、
`lucy-20261018-cloudflare-os-benchmark`（竞品对标，明写「不是功能 Spec」）、
`lucy-aicon-online-capability-scorecard`（演讲过程性材料）、
`lucy-r1-controlled-data-service-plan`（设计／实施计划）、
`starrocks-r1-support-plan`（支持范围计划）、
`lucy-202608-access-governance-gap-analysis`（已迁移）、
`lucy-platform-goal-checklist`（目标／验收清单）

早期功能 Spec（12，同属形态债——缺闭口层级声明）：
`ceo-one-report-sow-eval-uat-contract`、`lucy-202608-05-demo-builder-arm-default-spec`、
`lucy-202608-08-image-arch-and-ktx-baseline-fix`、`lucy-202608-reliable-delivery-upgrade-spec`、
`lucy-202608-upgrade-execution-control`、`lucy-20261014-concept-dictionary-spec`、
`lucy-20261014-release-bom-spec`、`lucy-20261014-safe-log-to-quality-eval-spec`、
`lucy-customer-amd64-offline-delivery-spec`、`lucy-mcp-execution-runtime-ack-debug-spec`、
`lucy-poc-demo-isolation-spec`、`lucy-skills-mcp-spec`

---

## 八、复算方式

```bash
cd /Users/forrest/GitHub/project-lucy

# 总数与形态分层
ls docs/specs/*.md | wc -l                                            # 60
grep -rlE '^- 层级：功能合同' docs/specs/ | wc -l                     # 12 份声明功能合同层
grep -rlE '^- 层级：发布取证' docs/specs/ | wc -l                     # 0 份声明发布取证层
for f in docs/specs/*.md; do grep -qE '^- 层级：' "$f" || echo "$f"; done | wc -l   # 42 份无闭口层级

# A 档：状态行明写「功能合同已收口」且声明了该层
for f in $(grep -rl "功能合同已收口" docs/specs/); do
  grep -qE '^- 层级：功能合同' "$f" && basename "$f"
done | wc -l                                                          # 9
```

---

## 九、不在本盘点里

- 出口矩阵**逐条**是否真的通过——本盘点只读状态行，不重新执行任何矩阵。
  「已收口」在本文件里指**状态行这么写**，不是本文件重新验过的结论。
- 发布取证层该长什么样——E 档是空的，本文件只陈述它是空的，不给设计。
- L25 登记册 16 条的出口矩阵执行状态——见交接文档第三节 P1 与
  [`2026-11-01-l25-registry-verification.md`](2026-11-01-l25-registry-verification.md)。
