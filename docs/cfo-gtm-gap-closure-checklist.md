# Lucy CFO GTM 差距 Closure Checklist

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy CFO GTM 差距 Closure Checklist |
| 文档类型 | Gap Closure / Backlog |
| 版本 | v0.2 |
| 撰写日期 | 2026-08-28 |
| 委托人 | xingchen |
| 适用范围 | 「彻底征服 CFO」GTM 路线：P0 五项 closure、POC eval 1:1 backlog、SKU 路线 A/B/C 决策 |
| 关联文档 | `docs/ceo-one-report-sow-product-risk-register.md`, `docs/lucy-r1-controlled-data-service-plan.md`, `docs/customer-deployment-guide.md`, `docs/eval-quiz-conventions.md`, `wiki/global/poc-*.md` |

## 1. 背景与目标

前序差距分析结论：Lucy 的治理 **能力**（Publish Gate、ACL audit、Eval monitor、trace/evidence）与 CFO 采购逻辑同方向，但 **operating model 外置、POC 证据链不完整、交付形态（headless SKU）不对 CFO** 构成结构性 gap。

本文档将差距量化为可执行的 closure backlog，不含 demo script 或展示材料。

**Closure 完成定义（P0 五项全部达标 + SKU 路线书面决策）：**

1. POC eval 密度与 wiki 场景对齐（≥15 machine cases，6 维覆盖矩阵达标）。
2. Operating model 在 GTM / 交付文档中正面定义，不再被误读为「Lucy 自带 approval workflow」。
3. SKU 路线（A/B/C）经决策并反映到 `customer-deployment-guide.md` / `admin-guide.md`。
4. CEO snapshot 从 `mock_value` 升级为 **已签字 benchmark 证据**（`owner_screenshot` 等）或 eval 明确 `blocked`。
5. Release readiness evidence 可由非工程师自助导出（UI 或 documented CLI 一键路径）。

---

## 2. SKU 路线决策（A / B / C）

Lucy 当前处于「三条路各做开头、哪条都没走通」状态。必须在下列三条中选 **主路线**（可组合，但需明确优先级）。

### 选项 A — Governance Platform SKU

| 维度 | 内容 |
|---|---|
| **定义** | WebUI 管理台进入客户交付承诺；CFO / 内审可通过浏览器访问治理控制面 |
| **必须补** | WebUI UAT 证据、客户文档、稳定性 SLA 口径；Release readiness / risk review / access gate **UI 补全** |
| **价值主张** | 「Lucy = 受治理的数据 Agent 控制塔 + MCP runtime」 |
| **适合客户** | 有数据平台团队、希望可视化治理、无成熟 external DG 流程 |
| **主要成本** | Support 模型、WebUI 稳定性验收、培训材料 |
| **解锁 P0** | #3（SKU 对齐）、#5（Release readiness UI） |

### 选项 B — Governance Evidence Runtime（维持 headless）

| 维度 | 内容 |
|---|---|
| **定义** | 维持 headless Docker + config package；强化 CLI/API 一键 compliance export |
| **必须补** | Documented 一键命令；POC eval 扩至 SOW 规模；GTM 正面声明 operating model 外置 |
| **价值主张** | 「Lucy = runtime + evidence generator；owner/approve 接你们现有 Data Governance 流程」 |
| **适合客户** | 已有成熟 data governance / change advisory board；GitOps 文化 |
| **主要成本** | 客户侧 DG 成熟度要求高；销售需诚实，不能 over-promise UI |
| **解锁 P0** | #2（operating model 文档）、#5（CLI export 路径） |

### 选项 C — Vertical Pack（CEO 一眼报治理包）

| 维度 | 内容 |
|---|---|
| **定义** | 将 POC wiki + semantic + eval + access 打包为可售 vertical config package |
| **必须补** | `customer-config.poc.example/`（或等价命名）；60+ eval cases；customer UAT 签字 benchmark |
| **价值主张** | 「买的是已验证的 vertical operating model，不是空平台」 |
| **适合客户** | 墨迹类 CEO 一眼报 / IDM 治理场景；垂直签单快于平台教育 |
| **主要成本** | 垂直深度 > 平台广度；每 vertical 需重复 eval + 客户 UAT 签字 |
| **解锁 P0** | #1（eval backlog）、#4（snapshot 升级） |

### 决策矩阵

| 评估问题 | 倾向 A | 倾向 B | 倾向 C |
|---|---|---|---|
| 客户有没有成熟 DG / CAB？ | 否 | 是 | 不关心（买 vertical） |
| CFO 会不会亲自看系统？ | 是 | 否（只看报告） | 是（看 vertical 证据） |
| 销售周期是平台还是项目？ | 平台 | 平台 | 项目 / SOW |
| 团队能否承担 WebUI support？ | 能 | 不能 | 部分（pack 内嵌） |

### 决策记录（待填）

| 字段 | 内容 |
|---|---|
| **主路线** | _待决策：A / B / C_ |
| **组合** | _例：C 为主 + B 交付形态_ |
| **决策人** | _待填_ |
| **决策日期** | _待填_ |
| **反映到** | `customer-deployment-guide.md` §1、`admin-guide.md` §1 |

**建议默认（若暂无书面决策）：** 短期 **C + B** — Vertical Pack 闭合 CFO 证据链；headless 维持交付成本；WebUI 作为 internal / optional add-on，不进首版 SKU 承诺，直至 UAT 证据补齐。

---

## 3. P0 Closure Checklist

### P0-1：POC eval 密度与 wiki 场景对齐

**现状：** `evals/data_agent_poc/` 仅 **1** 条 machine case；wiki 覆盖 3 个业务场景域 + 15+ 演示问题；`data_agent_poc-quiz-cases.html` metadata 引用但文件缺失。

> **命名约定：** 本文档是产品研发 backlog，按 **场景域 / 表 / 治理主题** 组织。`wiki/global/poc-*.md` 中若出现客户项目叙事里的人名（历史 POC 素材），**不**作为产品研发分工或验收责任人；产品侧只认场景 id 与 eval case id。

**目标：** ≥15 machine cases；6 维覆盖矩阵（`docs/eval-quiz-conventions.md` §3.1）在 `data_agent_poc` domain 达标；paired quiz HTML 可渲染。

**验收标准：**

- [ ] `evals/data_agent_poc/eval/data_agent_poc-eval-cases.yaml` ≥15 `cases`
- [ ] 6 维覆盖：basic ≥2、anti-pattern ≥3、boundary ≥2、degradation ≥1、multi-turn ≥2、path ≥2
- [ ] 每条 case 含 `trace_required: true`；口径题含 `context_required`
- [ ] `node scripts/render-quiz.mjs` 生成 `data_agent_poc-quiz-cases.html` 且无 broken ref
- [ ] `npm run smoke:p0:business-eval` 通过（YAML 可解析）
- [ ] `npm run smoke:p1:business-eval-full` 在具备 MCP token 环境跑通 `data_agent_poc` suite
- [ ] metadata `version` 升至 v0.2+；`snapshot_date` 更新

**负责域：** evals / POC data

---

### P0-2：Operating model 正面定义（GTM / 交付文档）

**现状：** `lucy-r1-controlled-data-service-plan.md` 明确 Lucy **不做** owner 协调、口径仲裁、权限审批；但 README / 对外叙事易被读成「完整 governance platform」。

**目标：** 交付文档与 GTM 一层表述一致：Lucy = **governance-enabling runtime**；operating model 四要素有文档锚点。

**必须写入或强化的四要素：**

| 要素 | Lucy 负责 | 客户 / 外部 workflow 负责 |
|---|---|---|
| 数仓 / SAP 边界 | 只读已确认表/视图；enabled_tables 白名单 | 建仓、ETL、SAP 入账、mart 维护 |
| 语义层 / Wiki 维护 | 提供 Catalog / WikiEditor / publish validate gate | 客户数据 Owner 定义口径、Review、Git 变更 |
| 口径变更治理 | Validate Gate + Eval gate + config audit | 客户 CAB / UAT 签字、生效日期、通知 |
| Agent 访问 | ACL + audit + trace | Token 生命周期、IdP（若未来 SSO） |

**验收标准：**

- [ ] `docs/customer-deployment-guide.md` §1 增补「Lucy 与客户 DG 流程分工」小节（≤1 页）
- [ ] `docs/admin-guide.md` §1 增补「Continuous Configuration Workflow 中的角色分工（RACI 简表）」
- [ ] `docs/lucy-r1-controlled-data-service-plan.md` §1 交叉引用上述小节，避免重复矛盾
- [ ] README「两个语境」段不新增数据问答规则；仅引用交付文档

**负责域：** docs / product

---

### P0-3：SKU 路线书面决策并反映到交付文档

**现状：** `lucy-platform-goal-checklist.md` §5.1：WebUI 已实现但 **不在首版客户交付承诺**；CFO 看不到控制面。

**目标：** §2 决策矩阵完成填写；`customer-deployment-guide.md` 与 `admin-guide.md` 的「已交付 / 不承诺」与决策一致。

**验收标准：**

- [ ] 本文 §2「决策记录」四项填完
- [ ] 若选 A：`customer-deployment-guide.md` 移除或修订「WebUI 不属于交付承诺」；补 WebUI UAT 证据链接
- [ ] 若选 B：明确「compliance export CLI」为交付物；WebUI 标为 internal
- [ ] 若选 C：新增 vertical pack 路径文档（见 P0-1 / P0-4 打包）
- [ ] `docs/lucy-platform-goal-checklist.md` §5.1 同步修订

**负责域：** product / GTM

---

### P0-4：CEO snapshot 从 mock_value 升级或明确 blocked

**现状：** `poc_ceo_metric_snapshot.benchmark_type = 'mock_value'`；benchmark 仍为模拟值，未接入客户 UAT 签字证据。

**目标：** 每条 snapshot 行 `benchmark_type` 升级为 `owner_screenshot`（或等价已验证来源）；若客户 UAT 证据未到位，相关 eval case 标 `blocked` 并说明原因。

**验收标准：**

- [ ] `semantic-layer/poc-mysql-aliyun/poc_ceo_metric_snapshot.yaml`（或 overlay）benchmark 元数据更新
- [ ] 至少 3 个 snapshot 日期（2026-01-31 / 03-31 / 05-31）各有 eval case 回归
- [ ] wiki `poc-idm-governance.md` CEO 快照段与 semantic 一致
- [ ] 若客户 UAT 证据未到位：相关 eval 标 `blocked` + `notes` 说明，**不得**在 GTM 中宣称「board number 已签字」

**负责域：** POC data + **客户 UAT / 数据治理流程**（产品不指定具体自然人）

---

### P0-5：Release readiness evidence 自助导出

**现状：** `webui/server/admin/release-readiness-package.ts` 已实现；**无 WebUI 页面**；CFO / 内审依赖工程师调 API。

**目标：** 非工程师可在 5 分钟内导出 compliance packet（JSON + Markdown）。

**验收标准（二选一或组合）：**

**路径 5a — WebUI（选 A 时必选）：**

- [ ] `/admin/release-readiness` 或 Overview 入口：下载 JSON + Markdown
- [ ] 包内不含 token 明文、raw SQL、客户行样本（遵守 `release-readiness-package.ts` 硬规则）
- [ ] Vitest / smoke 覆盖 API + UI 下载

**路径 5b — CLI（选 B 时必选）：**

- [ ] `npm run export:release-readiness` 或 documented `curl` 一键脚本
- [ ] 输出落盘至 `inbox/` 或客户指定路径
- [ ] `admin-guide.md` §6 有完整 copy-paste 示例

**负责域：** webui / platform

---

## 4. POC Eval Case Backlog（wiki 场景 1:1 映射）

以下 backlog 将 wiki 演示问题与 6 维覆盖矩阵映射为 **15+ machine cases**。Case id 命名：`data_agent_poc-{dimension}-{topic}-NNN`。

**图例：** ✅ 已有 | 🔲 待建 | 🚫 ACL/security 专项

### 4.1 覆盖矩阵目标

| 维度 | 目标条数 | 当前 | 缺口 |
|---|---:|---:|---:|
| basic | 2 | 0 | 2 |
| anti-pattern | 4 | 1 | 3 |
| boundary | 2 | 0 | 2 |
| degradation | 1 | 0 | 1 |
| multi-turn | 2 | 0 | 2 |
| path | 3 | 0 | 3 |
| security / ACL | 1 | 0 | 1 |
| **合计** | **15** | **1** | **14** |

### 4.2 场景域 A：用户活跃分析（`poc_app_active_daily`）

| # | Case ID | 维度 | Wiki 来源 | 问题摘要 | 关键断言 |
|---|---|---|---|---|---|
| 1 | `data_agent_poc-basic-android-dau-trend-001` | basic | poc-active-analysis L71 | 2026-01~05 Android DAU 趋势 | 下降趋势；数量级 ~1.2M→~900K；用 `dau_noback` |
| 2 | `data_agent_poc-basic-harmony-growth-001` | basic | poc-active-analysis L72 | 鸿蒙 DAU 增长多少 | 增长 ~141%；`dau_noback` |
| 3 | `data_agent_poc-path-active-table-routing-001` | path | poc-data-agent-playbook L20 | 三个平台人均启动哪个最高 | 路由到 `poc_app_active_daily`；measure `avg_start_cnt` |
| 4 | `data_agent_poc-anti-pattern-avg-start-check-001` | anti-pattern | poc-active-analysis L65 | 人均启动次数 | 禁止 `avg(avg_start_cnt_check)`；必须 sum/sum |
| 5 | `data_agent_poc-boundary-dau-with-without-back-001` | boundary | poc-active-analysis L74 | 含刷新 vs 不含刷新差多少 | 两 measure 均引用；说明 iPhone 差异 |

### 4.3 场景域 B：广告经营分析（`poc_ad_revenue_daily`）

| # | Case ID | 维度 | Wiki 来源 | 问题摘要 | 关键断言 |
|---|---|---|---|---|---|
| 6 | `data_agent_poc-path-ad-slot-ecpm-rank-001` | path | poc-ad-revenue L85 | 哪个广告位 eCPM 最高 | 开屏；measure `ecpm`；路由正确表 |
| 7 | `data_agent_poc-anti-pattern-ad-dau-sum-001` | anti-pattern | poc-ad-revenue L45 | 广告域 ARPU / DAU | 禁止 `sum(ad_dau)`；必须 max；ARPU 不被缩小 4× |
| 8 | `data_agent_poc-basic-ad-revenue-trend-001` | basic | poc-ad-revenue L86 | 1-5 月广告收入趋势 | `sum(ad_revenue)` 跨月 |
| 9 | `data_agent_poc-boundary-ad-vs-product-dau-001` | boundary | poc-ad-revenue L59 | 广告域 DAU vs 产品 DAU | 数值不同是预期；来源不同；不可混算 ARPU |

### 4.4 场景域 C：IDM 治理层（`poc_ad_revenue_by_type_daily` + `poc_ceo_metric_snapshot`）

| # | Case ID | 维度 | Wiki 来源 | 问题摘要 | 关键断言 |
|---|---|---|---|---|---|
| 10 | `data_agent_poc-anti-pattern-idm-dau-max-001` | anti-pattern | poc-idm-governance L50 | IDM 层广告 DAU | 禁止跨品类 `sum(ad_dau_idm)`；必须 max |
| 11 | `data_agent_poc-path-idm-consistency-001` | path | poc-idm-governance L144 | 四品类合计 = 经营表总收入 | 两表同日同国合计相等（196,314.31 @ 05-31） |
| 12 | `data_agent_poc-boundary-idm-vs-product-dau-001` | boundary | poc-idm-governance L57 | IDM DAU 与产品 DAU 差多少 | ~23% 差异；预期行为；非数据错误 |
| 13 | `data_agent_poc-basic-effect-revenue-share-001` | basic | poc-idm-governance L142 | 效果类收入占比 | ~40%；品类 grain |
| 14 | `data_agent_poc-path-ceo-arpu-snapshot-001` | path | poc-idm-governance L145 | 1月31日广告 ARPU | 路由 snapshot + 语义 measure；与 benchmark 对齐 |

### 4.5 跨场景 / 治理 / 安全

| # | Case ID | 维度 | Wiki 来源 | 问题摘要 | 关键断言 |
|---|---|---|---|---|---|
| 15 | ✅ `data_agent_poc-timezone-utc-display-001` | anti-pattern | poc-data-agent-playbook L56 | UTC ISO → 北京业务日 + CEO 对账 | 已有 |
| 16 | `data_agent_poc-security-forbidden-finance-deny-001` | security | poc-idm-governance L146 | 查询净利润会怎样 | ACL deny；audit；不返回数据 |
| 17 | `data_agent_poc-multiturn-dau-definition-drift-001` | multi-turn | poc-active-analysis L67 | 先问 DAU 再追问含不含刷新 | 两轮 measure 不漂移 |
| 18 | `data_agent_poc-multiturn-idm-reconciliation-001` | multi-turn | poc-idm-governance | 先问品类收入再问是否与经营表一致 | 上下文继承；一致性断言 |
| 19 | `data_agent_poc-degradation-metric-catalog-fallback-001` | degradation | poc-data-agent-playbook L23 | 问 catalog 未覆盖指标 | 明示限制；不编造 measure |
| 20 | `data_agent_poc-path-metric-catalog-routing-001` | path | poc-data-agent-playbook L23 | 某指标口径与证据等级 | 路由 `poc_metric_catalog` |

**Quiz 配对：** 每个 anti-pattern / boundary / security case 至少 1 道 quiz（目标 quiz ≥12 题）；Q1（timezone）已有。

### 4.6 依赖与顺序

```text
P0-2 文档（operating model） ──可并行──┐
P0-3 SKU 决策 ─────────────────────────┼──► P0-5 export 路径选型
P0-4 UAT benchmark ──blocks──► case #11,#14 benchmark 断言
P0-1 eval backlog (#6-20) ──► quiz HTML ──► smoke:p1:business-eval-full
```

**建议实施波次：**

| 波次 | Cases | 治理主题（产品语言） |
|---|---|---|
| Wave 1 | #7, #10, #11, #16 | DAU 重复存储 anti-pattern、跨表一致性、ACL deny |
| Wave 2 | #1, #2, #6, #15(已有), #17, #18 | 三场景域核心查询 + multi-turn |
| Wave 3 | #3-5, #8-9, #12-14, #19-20 | 6 维覆盖矩阵补全 |

---

## 5. P1  backlog（P0 后）

| # | 项 | 关联 P0 | 验收 |
|---|---|---|---|
| P1-1 | Tiered access governance gate UI | P0-3/A | Agent/Role dryRun 展示 P0/P1/P2 + override drawer |
| P1-2 | Risk review 页面 | P0-5 | `/admin/risk-review` 只读候选 + 跳转 audit |
| P1-3 | POC reviewer skill | P0-1 | `skills/reviewer` 或新 `skills/domains/poc/`；覆盖 DAU max、UTC、ACL |
| P1-4 | `pending_confirmation` closure | P0-4 | Catalog 或 metric_catalog 可视化待核实项 |
| P1-5 | `customer-config.poc.example/` | P0-3/C | 镜像 POC semantic + wiki + eval + access |
| P1-6 | Semantic + Wiki 联动 publish 提示 | P0-2 | sl_ref 变更时 Publish Workbench 警告 |

---

## 6. 进度跟踪

| P0 项 | 状态 | 证据链接 | 备注 |
|---|---|---|---|
| P0-1 POC eval ≥15 | 🔲 Not started | | 当前 1/15 |
| P0-2 Operating model 文档 | 🔲 Not started | | |
| P0-3 SKU 决策 | 🔲 Not started | | §2 决策记录待填 |
| P0-4 CEO snapshot | 🔲 Blocked on UAT evidence | | mock_value |
| P0-5 Release readiness export | 🔲 Not started | API: `release-readiness-package.ts` | UI 缺失 |

**下次评审建议携带：**

1. §2 SKU 决策记录（签字）
2. Wave 1 eval cases PR + smoke 日志
3. `customer-deployment-guide.md` operating model 小节 diff

---

## 7. Changelog

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-08-28 | 初稿：P0 五项、SKU A/B/C、POC eval 1:1 backlog（20 cases）、P1 六项 |
| v0.2 | 2026-08-28 | 去除产品研发文档中的人名绑定；场景改为场景域 A/B/C；P0-4 改为客户 UAT 证据；补充命名约定 |
