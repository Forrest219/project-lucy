# Spec 收口盘点（2026-11-01）— 哪些 Spec 还需要收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| 目的 | PM 问「还有哪些 Spec 需要收口」，本文件是逐份实测后的盘点结论，不是快照转述 |
| 方法 | 实读 `docs/specs/` 全部 60 份 Spec 的状态行与「闭口层级」小节，逐份核对验收矩阵执行结果；交叉比对 [`2026-11-01-spec-closure-batch-handoff.md`](2026-11-01-spec-closure-batch-handoff.md) |
| 机器门禁 | `node scripts/lint-spec-docs.mjs` → **exit 0**（343 files scanned；**盘点时 900 baseline exemptions，分叉后收口批次净减 21 条 → 现为 879**，见 §九） |
| 基线 | 盘点时 HEAD `8f7ed9e4`，分支 `lucy-v0.25`；盘点时工作区有在途改动（见 §六）。**本文件随后随 B 档 5 份收口、形态 9 份搭车与 C 档批次滚动更新，§九 记录分叉后的实际状态** |
| 授权范围 | 本文件本身只做盘点与建议。**§九 记录的后续收口是另一批次的授权范围内完成的**；盘点结论不代替任何一条 Spec 的收口记录 |

---

## 一、结论先行

**`docs/specs/` 共 60 份。按「能不能收」分成四档：**

| 档 | 份数 | 含义 | 本批建议动作 |
|---|---|---|---|
| **A｜已收口** | **12 → 17** | 状态行已写明收口／验收／关闭，且有收口记录 | B 档 5 份已于本批收口，移入 A |
| **B｜可立即收口** | **5** | 验收证据已在手，差的只是收口记录 + 状态行 | **本批就干这 5 份** |
| **C｜要补出口才能收** | **10** | 实现已落地，但验收矩阵没有逐条执行结果 | 先补用例/跑矩阵，再收 |
| **D｜不具备收口条件** | **7** | 未实施 / 待评审 / 已被取代 / 分析对照类 | 不收 |
| **E｜发布取证层** | **0 → 2** | 结构性空白。形态搭车后已**声明** 2 份（`lucy-customer-amd64-offline-delivery-spec`、`lucy-202608-08-image-arch-and-ktx-baseline-fix`），但**均未执行** | 仍需 PM 拍板宿主与出口矩阵（§五） |

A + B = **17** 份涉及功能合同层（B 档 5 份已于 2026-11-01 收口，故 A 档由 12 增至 **17**）；C 档 10 份是工作量主体；另有 **32 份存量 Spec 仍没有「闭口层级」小节**（baseline 豁免 = 形态债；本批已修掉 10 份——B1 的 skill-owner 1 份 ＋ 形态 9 份，见 §三）。

> ### ⚠️ 2026-11-01 13:57 修订：B 档由 3 份增至 5 份
>
> 复核 Plan 与 Spec 的一致性时发现**两份 Spec 的状态行是过期的**——它们的**实施 Plan 已记录「已落地、SC 全部通过」，但 Spec 状态行仍停在「已定稿／仍未执行」**。实测其测试全绿后，这两份从 D 档移入 B 档：
>
> | Spec | Spec 状态行（过期） | Plan 记录（真实） | 实测 |
> |---|---|---|---|
> | `lucy-20261030-login-accounts-spec.md` | `:8`「v1.2 已定稿，可交付开发。SC-01–SC-18 仍未执行」 | `docs/plans/lucy-20261030-login-accounts-plan.md:9`「v1.3：S1–S2 已落地。SC-01–SC-18 全部有通过记录」＋ §5.1 逐条表 | 4 文件 **66 条全绿** |
> | `lucy-20261030-agent-roster-spec.md` | `:8`「v1.2 已定稿。第 3 轮 Codex 确认可定稿」 | `docs/plans/lucy-20261030-agent-roster-plan.md:9`「S1、S2 已按本 Plan 实现，SC-01–SC-15 已执行并通过」＋ §5.1 逐条表 | 3 文件 **78 条全绿** |
>
> **教训**：Spec 状态行与实施 Plan 是**两份独立维护的事实源**，单看 Spec 会漏。盘点必须**两边对读**。

### 事实更正（对昨晚交接快照）

交接文档 §三 P1 写「**60 份中 18 份已收功能合同层**」。实测不是 18：

- **60 份**里，**18 份声明了「闭口层级」小节**（`grep -l 闭口层级`），
- 但这 18 份里**只有 12 份状态行真的写了收口／验收／关闭**；
- 另 **6 份声明了层级却没收口**（§二 B/C/D 档）。

**差 6 份**会直接低估下一批工作量——交接文档把「声明了层级」当成了「已收口」。

---

## 二、A / B / C 三档逐份清单（证据到行）

### A 档｜已收口（12 份，不用再动）

| Spec | 状态行 | 收口记录 |
|---|---|---|
| `lucy-20261020-v2p5-semantic-batch-operations-spec.md` | `:8` 已关闭（FC-01–FC-32） | `2026-10-31-l25-11-functional-contract-evidence.md` |
| `lucy-20261025-v0p25-hive-direct-connection-spec.md` | `:8` 编译侧功能合同已收口 | — |
| `lucy-20261029-question-budget-window-optimization-spec.md` | `:8` v1.0 已收口 | `2026-11-01-question-budget-window-closure.md` |
| `lucy-20261029-url-driven-input-ime-composition-spec.md` | `:8` v1.0 已收口 | `2026-11-01-url-driven-input-ime-composition-closure.md` |
| `lucy-20261030-access-grade-and-daily-question-kpi-spec.md` | `:8` v1.0 已收口 | `2026-11-01-access-grade-and-daily-question-kpi-closure.md` |
| `lucy-20261030-access-map-quiet-reading-spec.md` | `:8` v0.3 已验收 | — |
| `lucy-20261030-audit-context-bar-spec.md` | `:8` v1.0 已收口 | `2026-10-31-audit-context-bar-and-sqlserver-identity-closure.md` |
| `lucy-20261030-publish-workbench-three-column-spec.md` | `:6` v0.4 已收口 | `2026-11-01-publish-workbench-three-column-closure.md` |
| `lucy-20261030-role-create-readonly-defaults-spec.md` | `:7` v0.2 已收口 | `2026-11-01-role-create-readonly-defaults-closure.md` |
| `lucy-20261030-row-policy-view-presentation-spec.md` | `:8` v0.3 已收口 | `2026-11-01-row-policy-view-presentation-closure.md` |
| `lucy-20261030-sqlserver-table-identity-spec.md` | `:8` v1.0 已收口 | 同 audit-context-bar |
| `lucy-20261030-version-info-identity-spec.md` | `:8` v1.2 已验收 | — |

### B 档｜可立即收口（5 份，证据已在手）

> **2026-11-01 13:57 修订**：B 档由 3 份增至 5 份。`login-accounts` 与 `agent-roster` 由 D 档移入——它们的 **Spec 状态行过期**，实施 Plan 已记录「已落地、SC 全部通过」（见 §一 修订框）。

**B1｜`lucy-20261025-v0p25-skill-owner-spec.md`（L25-04）— 最干净的一条**

- 状态行 `:9`：S1／S2／S3 已实施，自动化覆盖全绿，**SKO-01–16 的验收口径已以自动化断言执行并全绿**（服务端 13／13 ＋ 工作台 6／6）。
- `:236` 残余：SKO-16 的 selector contract 门禁 **fail 数保持 24**（既有 L25-06 欠账，**本条未新增**）；新增 1 条 **warn 级 ORPHAN**（`skill-detail-owner`），成因是门禁脚本只识别字面量 `data-testid="..."`，与基线 53 条 ORPHAN 同型。
- **判定**：这两条**不是本条承诺的可打假检查**（本条承诺是「负责人字段的行为正确」），按 `DEVELOPMENT.md:80` 的出口按层收窄判据 → **不构成收口阻塞**，收口记录里如实登记为残余即可。
- **收口动作**：写 `docs/reviews/2026-11-01-skill-owner-closure.md`（出口矩阵 ＋ SKO→用例逐条落点表）→ 状态行改「v0.5 功能合同已收口」→ **补「## 闭口层级」小节**（它现在没有，`docs/governance/spec-plan-doc-baseline.json` 里有一条 `close-layer` 豁免要同步删）→ Plan／`docs/README.md`／`docs/plans/README.md`／`project-overview.md` 同步。

**B2｜`lucy-20261030-display-snapshot-invalidation-isolation-spec.md`**

- 状态行 `:7`：实现已完成（提交 `ced19d1a`），**SI-01–SI-13 已执行并通过**，SI-14 浏览器往返见 §8.1。
- §8.1 逐条落点表已写好，每条都指向具体测试文件（`display-snapshot.test.ts` / `display-revisions.test.ts` / `display-invalidation.test.ts` / `display-permission-runtime.test.ts`）。
- `:15` 闭口层级已写明「本条出口：§8 验收矩阵 SI-01–SI-14 及其 §8.1 执行记录（SI-01–SI-13 为自动化用例；SI-14 为本地匿名夹具的浏览器往返，31 个实测样本全部成功、0 次 busy）」，且「**现场实例复核**、镜像构建与部署、客户交付均不在本条出口」。
- **判定**：出口已齐，**可以收口**。现场复核明确被排除在本条出口外，不需要等。
- **收口动作**：写收口记录（把 §8.1 提升为正式落点表，标注 SI-14 证据等级＝本地夹具）→ 状态行改「v0.1 功能合同已收口」→ Plan／各 README／project-overview 同步。

**B3｜`lucy-20261030-hive-query-execution-spec.md`（L25-10 问数执行波）**

- 状态行 `:8`：本模块 Wave A 已落地（审查→M1–M5，合成夹具 HQ）。
- `:18` 闭口层级已写：`本条出口：HQ-01–HQ-15、HQ-17，以及 HQ-16／HQ-18 的合成夹具维`；`不在本条出口：客户匹配 HS2／认证／TLS／JRE 全组合、整库 Agent 旅程…（归 HIV25）`。
- `:313`：Wave A 已落地，但**不**授权客户环境、镜像发布、支持矩阵晋级或 `HIV25` 收口。
- **判定**：出口定义是清晰的，缺口是 **§7 验收矩阵的逐条结果表还没写**。需要把 HQ-01…HQ-18 逐条核到 pass/fail ＋ 证据落点，再收口。工作量中等（§7 在 `:229` 起）。

**B4｜`lucy-20261030-login-accounts-spec.md`（2026-11-01 13:57 由 D 档移入）**

- Spec 状态行 `:8` 是**过期的**：「v1.2 已定稿，可交付开发。**SC-01–SC-18 仍未执行**」。
- 实施 Plan `docs/plans/lucy-20261030-login-accounts-plan.md:9` 的真实状态是「**v1.3：S1–S2 已落地**（2026-10-30）。SC-01–SC-18 全部有通过记录（组件测试、导航测试、术语检查）」，§5.1 有**逐条 SC→测试名→文件对照表**。
- 实测：`admin-accounts-route.test.tsx` / `navigation.test.ts` / `admin-accounts.test.tsx` / `admin-accounts-oidc.test.tsx` —— **4 文件全绿**。
- **判定**：可收口。Plan 同时写明「未做浏览器走查、移动窄屏、Docker 重建和客户交付；组件测试通过不等于这一页已经在运行中的容器里改版」——这些按闭口层级属**不在本条出口**。
- **收口动作**：写收口记录 → **Spec 状态行改「v1.3 功能合同已收口」**（版本随 Plan 升到 v1.3，口径对齐）→ Plan 状态行 → 索引 → project-overview。

**B5｜`lucy-20261030-agent-roster-spec.md`（2026-11-01 13:57 由 D 档 移入）**

- Spec 状态行 `:8` 同样是**过期的**：「v1.2 已定稿。第 3 轮 Codex 确认可定稿，阻塞 0，高 0」——只反映了**设计定稿**，没反映后续实施。
- 实施 Plan `docs/plans/lucy-20261030-agent-roster-plan.md:9`：「**S1、S2 已按本 Plan 实现，SC-01–SC-15 已执行并通过**（2026-10-30，记录见 §5）」，§5.1 给出改动文件与 SC 对应表。
- 实测：`agent-list.test.tsx` / `kpi-contracts.test.ts` / `object-detail-drawer.test.tsx` —— **3 文件全绿**。
- **判定**：可收口。

### C 档｜实现已落地但出口不齐（10 份，要先补）

共同形态：**代码在、状态行写「已实现／未验收」，但验收矩阵没有逐条执行结果。** 收口动作＝跑矩阵 ＋ 补缺失用例 ＋ 写落点表。

| Spec | 状态行 | 验收矩阵 | 缺什么 |
|---|---|---|---|
| `lucy-20261024-v0p25-audit-reconciliation-view-spec.md` | `:8` 部分实现，未验收 | `:286` §7 | 上游精确 as-of S 能力未闭合，正式完整读取与导出必须阻断；V01–V12 全未执行 |
| `lucy-20261025-v0p25-access-authorization-summary-spec.md` | `:8` 已实现，未验收 | `:211` §8 | ASV-01–14 全未执行 |
| `lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` | `:8` 已实现 | `:229` §8 | 矩阵未执行 |
| `lucy-20261025-v0p25-upgrade-candidate-verification-spec.md` | `:8` 已实现，未验收 | `:169` §6 | 矩阵未执行 |
| `lucy-20261025-v0p25-upgrade-e2e-automation-spec.md` | `:8` 已实现，未验收 | `:149` §6 | 矩阵未执行 |
| `lucy-20261025-v0p25-oidc-single-sign-on-spec.md` | `:9` 已签核并实施 | `:509` §11 | OIDC-24／OIDC-25 记 `blocked_env`（真实环境不可得）→ 需按「不在本条出口」处理还是留阻塞，要 PM 定 |
| `lucy-20261025-v0p25-smtp-notifications-spec.md` | `:9` 已签核，S1／S1.1 已实施 | `:303` §11 | SMTP-01–26 全未执行；**S4 不启动、SMTP-26 保持 blocked** |
| `lucy-20261022-v2p5-row-permission-management-spec.md` | `:8` P0 已收口 | — | R1／R3 与 D-03 仍未闭（§14.9）；Wave 0b 仍挡交付 |
| `lucy-20261019-audit-trust-and-admin-investigation-spec.md` | `:7` 设计交付，骨架已实施 | — | **现场验收（EA 矩阵）未执行**；状态行自己写明「本状态不表示验收已通过」 |
| `lucy-20261030-webui-release-ux-review-spec.md` | `:8` v1.2 已落地，结构套件 27/27 绿 | §7／§8 | **走查和签字未做**；§8 检查单 UX-R01–R12 里的 UX-R02「路由覆盖」／UX-R03「未关闭台账」／UX-R04「壳层」都需要人工走查 → 这条**不能纯靠自动化收口**，要 PM 参与签字 |

### D 档｜不具备收口条件（7 份，不要收）

| Spec | 原因 |
|---|---|
| `lucy-20261031-help-center-experience-spec.md`（L25-12） | `:8` **待评审；仅授权起草与登记，暂不开发** |
| `lucy-20261027-v0p25-semantic-release-restore-spec.md`（L25-15） | 设计定稿 v0.11，S1–S6 可交付开发但未实施；SRR-01–SRR-24 全未执行 |
| `lucy-20261028-v0p25-lucy-ops-control-plane-spec.md`（L25-16） | W-A 实施中，S5 不得开始；VOPS-01–78 全未执行 |
| `lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md` | 实施中；它是**发布取证层**的宿主（`HIV25`），不是功能合同层 |
| `lucy-ci-restoration-spec.md` | T00–T04 实施中；**工作区在途改动就是这条线**（§六） |
| `lucy-20261018-enterprise-security-and-real-e2e-spec.md` | 已批准、实施中；目标 K8s 仍 BLOCKED |
| `lucy-20261021-v2p5-help-center-spec.md` | **已被取代，不得实施** → 它需要的不是「收口」，是**归档处置**（标注 superseded 并指向 L25-12 新 Spec） |

---

## 三、还有一批「不是功能合同」，别按功能合同收

42 份存量 Spec 没有「闭口层级」小节（baseline 豁免）。它们分两类，**处置方式相反**：

1. **本来就不该有该小节（豁免合理，保留）**——分析、对照、清单、评分卡、治理冻结类：
   `ceo-one-report-*`（4 份）、`lucy-202608-access-governance-gap-analysis`、`lucy-20261014-fivetran-context-layer-competitive-analysis`、`lucy-20261026-warehouse-table-scan-capability-analysis`、`lucy-platform-goal-checklist`、`lucy-aicon-online-capability-scorecard`、`lucy-20261018-cloudflare-os-benchmark`、`lucy-202608-upgrade-execution-control`、`lucy-202608-reliable-delivery-upgrade-spec`、`lucy-r1-controlled-data-service-plan`、`starrocks-r1-support-plan`、`api-staging-admission-spec`（治理口径已冻结、暂不开发）等。
2. **是真功能 Spec，形态债该补**（补「闭口层级」小节 → baseline 条目变 STALE → 删掉，基线只减不增）：
   `lucy-20261014-release-bom-spec`、`lucy-20261014-safe-log-to-quality-eval-spec`、`lucy-20261014-concept-dictionary-spec`、`lucy-mcp-execution-runtime-ack-debug-spec`、`lucy-poc-demo-isolation-spec`、`lucy-customer-amd64-offline-delivery-spec`、`lucy-skills-mcp-spec`、`lucy-202608-08-image-arch-and-ktx-baseline-fix`、`lucy-202608-05-demo-builder-arm-default-spec`。
   → **本批已做（2026-11-01）**：9 份全部补上「闭口层级」小节 ＋「状态」行。

> ⚠️ **形态已合规 ≠ 功能合同已收口。** 这 9 份**没有一份**有逐条验收落点表或收口记录，所以状态行一律写成「**形态已合规；本条功能合同尚未收口**」，并逐份注明实现现状（如 release-bom 与 concept-dictionary 全仓未找到实现；skills-mcp 的实现目录 `lucy-skills/` 尚未建立；customer-amd64 与 image-arch 的门禁脚本在库但发布取证层**尚未执行**）。**不用形态合规冒充功能收口。**
>
> **层级判定**：`lucy-customer-amd64-offline-delivery-spec` 与 `lucy-202608-08-image-arch-and-ktx-baseline-fix` 判为**发布取证层**——它们的出口是真实构建上的 ELF 门禁与 Release CI 基线核对，按 `DEVELOPMENT.md:75–78` 属于「在这次跑到的系统路径上」那一层；其余 7 份为**功能合同层**。
>
> **基线净减 17 条，不是 9 条**：9 份的 `close-layer` 豁免各减 1；其中 8 份顺带补了「状态」行（`skills-mcp` 原本靠正文里的「当前状态」字样偶然满足 metadata 规则），`metadata` 豁免再减 8。另有 4 份英文表头的 Spec（`Document type` / `Version`）不满足 metadata 规则的中文键要求，已改为双语标签 `文档类型 / Document type`、`版本 / Version`。**形态基线 898 → 881，close-layer 41 → 32。**

---

## 四、基线账（形态门禁）

| 项 | 批次开始 | 本批之后 |
|---|---|---|
| 形态基线总条目 | **900** | **881**（净减 19） |
| 其中 `close-layer` 条目 | **42** | **32**（净减 10：B1 减 1，形态 9 份减 9） |
| 其中 `metadata` 条目 | 84 | **76**（净减 8：形态 9 份中 8 份补了「状态」行） |
| 实际有「闭口层级」的 Spec | **18** | **28**（18 ＋ B1 的 skill-owner 1 ＋ 形态 9 份），与 60 − 32 对账一致，无遗漏、无 STALE |
| 纪律 | — | **基线只减不增**；删条目用 `JSON.stringify(b,null,2)+"\n"` 写回，逐字节无格式漂移（本次 diff 全部为删除行，无格式重排） |

> 本批 19 条净减的来源：B1 skill-owner（`close-layer` 1 ＋ `index` 1）＝ 2；形态 9 份（`close-layer` 9 ＋ `metadata` 8）＝ 17。**合计 19。全程未新增任何豁免条目。**

---

## 五、结构性缺口：发布取证层**仍然没有人负责**（需 PM 拍板）

> **2026-11-01 形态搭车后的修正**：盘点时写作「0 份」。形态搭车给两份**交付／构建契约类** Spec 补了「闭口层级」，它们按出口性质判为**发布取证层**——`lucy-customer-amd64-offline-delivery-spec`（出包前 G1–G4 必跑，含 ELF 二进制门禁）与 `lucy-202608-08-image-arch-and-ktx-baseline-fix`（镜像架构一致性 ＋ Release CI KTX 版本基线）。**但这两份都只是「声明了层级」，发布取证本身尚未执行。**

所以缺口没有消失，只是从「**没有这一层**」变成「**这一层有 2 份声明，但一份都没跑过，且都不是本轮已收口功能的宿主**」。

后果很具体：几乎每份已收口 Spec 的「不在本条出口」都把同一批项推给发布取证——客户镜像、Helm 部署、远端 CI 绿灯、整库旅程、Agent 路径、跨模块故障演练、证据等级（客户环境）。**「本条收口不表示可上线」这句话目前仍没有承载它的已执行 Spec。**

按 `DEVELOPMENT.md:80–84`，上线需要三件事同时成立：① 各模块按自己的合同收口（本批后 17 份达成）② 兜底跑在目标拓扑上（**无人负责**）③ 证据等级够（**无人负责**）。

**建议**：下一批立**第一条「发布取证」层 Spec**，宿主选已收功能合同且范围可控的（如 `lucy-20261030-publish-workbench-three-column` 或 `lucy-20261030-sqlserver-table-identity`），出口矩阵覆盖：amd64 镜像构建 → Helm 部署 → 健康检查 → 一次真实端到端问询 → 证据等级登记。它与上两份的区别是：**上两份是「交付契约自带的门禁」，新这份是「已收口功能合同在目标拓扑上的兜底」**——后者才是「上线」这个词真正缺的那一块。

**但这一条要 PM 先拍板两件事**：
1. 发布取证 Spec 的**宿主选哪份**（= 决定第一条要覆盖的产品面）。
2. 发布取证的**环境边界**：本机 + CI，还是必须客户环境？客户环境目前**不在任何 CI 覆盖内**（交接文档 §七明确「客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这份交接里」）。

---

## 六、硬约束（动手前必读）

1. **工作区有在途改动，不要碰**（本文件落盘时的实况，HEAD 仍是 `8f7ed9e4`）：

   ```
   M  package.json                                        （已暂存）
   M  scripts/gates/root-test-registry.json               （已暂存）
   A  scripts/smoke/lucy-runtime-build-context.test.mjs  （已暂存，新增）
   ?? docs/reviews/2026-11-01-spec-closure-inventory.md   （本文件）
   ```

   这几个文件属 **CI／交付隔离线**（`lucy-ci-restoration-spec.md`），**不是收口批次**，不是本盘点的收口对象。

   ⚠️ **盘点期间该会话改过一次法**：它原先往 `.github/workflows/lucy-ci.yml` 与 `lucy-release.yml` 各加了 2 行（`smoke:p0:delivery-isolation:test` 与 `…:build-context`），随后**撤回**，改为把新测试登记进 `scripts/gates/root-test-registry.json` 的 `workflow-contracts` 门禁。**HEAD 期间未动**（仍是 `8f7ed9e4`）。

   → **这条线是活的**。收口批次动手时**必须先重跑 `git status`**，并对每个自己改过的文件逐个 `git diff` 复核——**登记类文件被并发会话覆盖是静默的**，不报冲突也不报错，commit 成功、工作区干净、diff 里看不出异常（`docs/README.md`、`docs/plans/README.md`、`project-overview.md`、`webui/docs/README.md` 是重灾区）。
2. **全量测试必须用干净 PATH**：`/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会**挂死不返回**（症状：vitest 报 `timed out in 5000ms` 但该文件耗时 120 秒）。
   ```bash
   CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
   env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1
   ```
3. **新增 Spec/Plan 与索引登记必须同一个 commit**（`lint:spec-docs` 的 `index` 规则对已跟踪文档判「未登记」即阻塞）。
4. **共享索引文件是并发热点**：`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md`、`webui/docs/README.md`。
5. **版本计数器跨会话共享**：写 `project-overview.md` 前必须实读顶部版本行取 current+1。
6. **SC 编号跨 Spec 串号**：`SC-17`／`SC-20`／`SC-24`／`SC-25` 至少 6 个 Spec 各有一套含义，「SC 全覆盖」无法机器校验，只能靠**逐条 SC→用例名映射表人工对账**。

---

## 七、决策与授权（2026-11-01 13:53 PM 已拍板）

| # | 决策 | PM 裁定 | 执行口径 |
|---|---|---|---|
| D1 | 本批收哪几条 | **B 档 + 形态 9 份搭车** | B 档由 3 增至 5（§一 修订框）。全为文档动作，不改运行代码 |
| D2 | 发布取证层是否现在立 | **暂不立**，先收完功能合同层 | 本批不新建发布取证 Spec；§五 的空白原样保留 |
| D3 | 并发会话关系 | **等 CI 线落地再开始** | CI 线已于 13:53 落地（`3a0857ee`），13:55 口径更正（`c1ad7a8b`）；批次自 13:56 起执行 |
| D4 | `blocked_env` 类（OIDC-24/25、SMTP-26） | 未决 | 属 C 档，本批不动 |
| D5 | 被取代的 `lucy-20261021-v2p5-help-center-spec.md` | 未决 | 属 D 档，本批不动 |
| D6 | 服务端 flake 归属 | 未决 | 交接 §三 P0；本批不涉及 |

**并发安全前提**：`3a0857ee` 与 `c1ad7a8b` 已落地，工作区在批次开始时**干净**（仅本盘点文档未跟踪）。批次每个 commit 前重跑 `git status`，并逐文件 `git diff` 复核。

---

## 八、不在本次盘点里

- 客户镜像、Helm、集群部署、客户环境验证与客户交付。
- `webui/docs/` 下的数字流水号存量 Spec（`07`／`14`／`15` 等）——它们是**已封板的存量路径**，按 `DEVELOPMENT.md:65` 不作为新编号先例，本轮不纳入功能合同收口盘点。
- 本批三份 Spec 的收口**都不表示可上线**，也不构成客户包验收。

---

## 九、并行会话的第二次实测与分叉后的实际执行口径（2026-11-01 下午）

### 9.1 两条线怎么分叉的，冲突以哪边为准

本文件与远端 `origin/lucy-v0.25` 的 `45d091bd` **从 `c1ad7a8b` 分叉**：

| 线 | 独有 commit | 独有内容 |
|---|---|---|
| 本地线（本分支） | `e50f8aad` ＋ B 档 5 份收口 ＋ 形态 9 份搭车，共 7 个 | 本文件（**A–E 五档**版，13:52 产出；[交接文档](2026-11-01-spec-closure-batch-handoff.md) 已按它的口径引用：「A 已收口 12 / B 可立即收口 3 / C 要补出口才能收 10 / D 不具备收口条件 9 / E 发布取证层 0」＋形态债 42 份） |
| 远端线 | `45d091bd` 盘点重做 ＋ `d77bf2eb` 登记缺口 ＋ `29f32170` CI 修复 | 同一路径的**另一次独立重做**（**A–F 六档**版，判据写成可复算形式；远端已推） |

**合并口径**：主体保留 **A–E 五档版**（交接文档已按它的口径引用），把六档版的**独有贡献**并入本节。**第一至八节是分叉点的快照；分叉后的实际状态以本节为准。** 六档版的独有贡献见 9.2。

### 9.2 六档版的独有贡献（已并入本文件）

1. **判据可复算**：分档按「**先形态、后状态**」两步走——第一步查文件里有没有 `^- 层级：` 这一行（没有 → 形态债，无法判定收口）；第二步按状态行原文措辞落档。判据写成 `grep`／`node` 命令，第三方可独立复算。
2. **新增 F 档（非功能 Spec）**：60 份里有 **22 份根本不是功能 Spec**（分析笔记、竞品对标、交付计划、SOW 材料、清单、演讲素材）。**它们不参与收口统计，但占着 `docs/specs/` 的位置**——单列出来是为了避免被误算成「待收口的存量债」。这条提醒对本仓成立：把「形态债 32 份」直接当成「32 份 Spec 要收口」是错的。
3. **形态债计数**：32 份存量 Spec 没有「闭口层级」小节（baseline `close-layer` 豁免数）。

### 9.3 分叉后本分支实际完成了什么

| 批次 | 内容 | 证据 |
|---|---|---|
| **B 档 5 份收口** | `skill-owner`（SKO-01–16）、`display-snapshot-invalidation-isolation`（SI-01–14）、`hive-query-execution`（HQ-01–18）、`login-accounts`（SC-01–18）、`agent-roster`（SC-01–15） | `docs/reviews/2026-11-01-{skill-owner,display-snapshot-invalidation-isolation,hive-query-execution,login-accounts,agent-roster}-closure.md` |
| **形态搭车 9 份** | 9 份存量 Spec 补「闭口层级」小节与「形态已合规；本条功能合同尚未收口」状态行 | `e3728395` |
| **B 档由 3 → 5**（§一 13:57 修订的更正） | `login-accounts` 与 `agent-roster` 的 **Spec 状态行过期**（Plan 已记「已落地、SC 全通过」，Spec 仍停「已定稿／仍未执行」）→ 从 D 档移入 B 档。**教训：Spec 状态行与实施 Plan 是两份独立维护的事实源，盘点必须两边对读** | 本文件 §一 修订块 |
| **全仓约定：证据等级门槛** | 「**本机 ＋ CI 即可**」写入 `docs/governance/DEVELOPMENT.md`——功能合同收口**不需要**客户环境证据；客户环境证据归发布取证与交付层，在功能合同里按「不在本条出口」登记或逐条记 `blocked`，**不构成把整条 Spec 挂成未收口的理由**；反向约束：不得用 mock 冒充客户环境 | `cd1d5b8b` |

**形态基线变化**：904 → 900（盘点时）→ 881（形态搭车后）→ **879**（B 档 5 份各减 2）；`close-layer` 豁免 42 → **32**。

### 9.4 分档口径速查（分叉点 → 现在）

| 档 | 分叉点（13:52 快照） | 现在 | 差异来源 |
|---|---|---|---|
| A 已收口 | 12 | **17** | B 档 5 份收口后移入 |
| B 可立即收口 | 3（后更正为 5） | **0** | 5 份已收口 |
| C 要补出口才能收 | 10 | 10（**执行中**） | 本批正在处理 |
| D 不具备收口条件 | 9 | **7** | `login-accounts`／`agent-roster` 移出（状态行过期） |
| E 发布取证层 | 0 | **2（已声明，均未执行）** | 形态搭车后 2 份声明了该层 |

### 9.5 C 档 10 份的执行顺序与处置

| # | Spec | 台账号 | 处置 |
|---|---|---|---|
| 1 | `lucy-20261025-v0p25-access-authorization-summary-spec.md` | L25-01 | **已收口**（ASV-01–14 全关闭；补 23 条此前不存在的断言） |
| 2 | `lucy-20261025-v0p25-row-policy-templates-and-view-spec.md` | L25-14 P1-1 | 收口中（RTP-01–10、RTV-01～05、RTV-08 已于 2026-10-30 关闭；**只剩 RTV-06／RTV-07**） |
| 3 | `lucy-20261025-v0p25-smtp-notifications-spec.md` | L25-05 | 排队（**SMTP-26 保持 blocked**：S4 不启动，需客户目标 SMTP ＋ linux/amd64 K8s） |
| 4 | `lucy-20261025-v0p25-oidc-single-sign-on-spec.md` | L25-06 | 排队（**OIDC-24／25 保持 `blocked_environment`**） |
| 5 | `lucy-20261025-v0p25-upgrade-e2e-automation-spec.md` | L25-07 | **授权阻塞**：真实升级执行未授权（`blocked_delivery`），非门禁 |
| 6 | `lucy-20261025-v0p25-upgrade-candidate-verification-spec.md` | L25-13 | **执行阻塞**：真实升级与真实备份未执行（`blocked_delivery`），非门禁 |
| 7 | `lucy-20261019-audit-trust-and-admin-investigation-spec.md` | — | 现场验收 EA-01–36 未执行；仓内已有 22 个测试文件，**按新约定可在本机推进**（执行层级 C／I／B／O／V 本机可做，A 层需真实受控客户端） |
| 8 | `lucy-20261024-v0p25-audit-reconciliation-view-spec.md` | L25-02・03 | **真实实现缺口**：上游精确 as-of S 能力未闭合 → 按新约定可在本条记 `blocked` 并收其余部分，**但缺口本身须先由 PM 定夺是否补实现** |
| 9 | `lucy-20261030-webui-release-ux-review-spec.md` | — | **需 PM 人工动作**：结构套件 27/27 已绿，走查与签字未做 |
| 10 | `lucy-20261022-v2p5-row-permission-management-spec.md` | L25-14 P0-2 | P0 已收口；R1／R3 随第 2 项关闭，**D-03 仍 open**，Wave 0b 仍 `blocked_delivery` |

> **第 5–10 项的处置依据**：①「本机 ＋ CI 即可」只放宽**证据等级门槛**，**不构成执行授权**——第 5 项缺的是 PM 对真实升级执行的授权，第 9 项缺的是 PM 走查与签字；② 第 7／8 项的新约定让「整条 Spec 挂成未收口」不再是唯一选项，可以逐条 `blocked` 后继续收其余部分；③ 第 8 项的 as-of S 是**真实实现缺口**，不属于「按层收窄出口」能覆盖的范围，须 PM 定夺。
