# E2E 选择器契约 + L1 Smoke 现状快照(2026-09-26)

| 元数据 | 内容 |
|---|---|
| 文档名称 | `e2e-selector-smoke-snapshot-2026-09-26.md` |
| 文档类型 | 诊断快照 / 临时审计(inbox) |
| 撰写日期 | 2026-09-26 |
| 撰写人 | Mavis(root session `mvs_a8a940d198954cefa50af0474d7038b2`) |
| 范围 | project-lucy @ v0.17.0 / `webui/` / `docs/qa/` |
| 触发动因 | 用户要求「a」:跑一遍现状,摸出「哪些 L1 已绿、哪些 selector 已漂移」 |
| 端到端真实跑过的对象 | 仅本会话内运行的 `npm run e2e:selector-contract` 与 `npx playwright test --grep @pr-smoke --project=chromium` |
| 关联文档 | [`docs/qa/lucy-webui-e2e-test-suite.md`](../../docs/qa/lucy-webui-e2e-test-suite.md) §5 · [`docs/qa/selector-contract.md`](../../docs/qa/selector-contract.md) v0.3 · [`docs/qa/impact-map.json`](../../docs/qa/impact-map.json) · [`webui/playwright.config.ts`](../../webui/playwright.config.ts) · [`webui/scripts/check-selector-contract.mjs`](../../webui/scripts/check-selector-contract.mjs) |

---

## 0. 范围声明(LLM 强结论守门)

**已核实(本次会话内真实执行)**:

1. `npx playwright install chromium` — 安装 `chromium-1234` 与 `chrome-headless-shell-1234` 至 `~/.cache/ms-playwright/`
2. `cd webui && npm run e2e:selector-contract` — 单一 Node 脚本,无副作用
3. `cd webui && LUCY_E2E_BASE_URL=http://127.0.0.1:55176 LUCY_E2E_PROJECT_DIR=/tmp/lucy-e2e-fixture npx playwright test --grep @pr-smoke --project=chromium --max-failures=3` — 复用 docker demo,跑 12 条 L1 + 早停 3
4. 通过 `curl` 直读 demo 容器:`/api/health`、`/api/connections`、`/api/agents`(只读)

**未核实(本快照不覆盖)**:

- 未跑 L2 (`@pr-impacted`) 用例,未跑 L3 (`@nightly`) 用例,未跑 `npm run e2e:release`
- 未跑 `npm run e2e:fixture`(那个会复制真实仓库到 `/tmp/lucy-e2e-fixture`)
- 未修任何 spec / 未改 selector-contract.md / 未改 playwright.config.ts / 未点 WebUI
- 未对 `webui/` 60+ 个 server 侧 vitest、50+ 个 src 侧 RTL 用例的覆盖空隙做映射
- 未对工作区脏标记的 460 个未提交改动做任何风险定级
- 未在 macOS / Windows 双机 / CI 三环境复现

---

## 1. `e2e:selector-contract` 跑出 [FAIL] 104 issue(s)

源:`webui/scripts/check-selector-contract.mjs`。三向检查:

| 类别 | 数量 | 落位 | 含义 |
|---|---|---|---|
| `❌ [UNREGISTERED]` 静态 testid 漂移 | **36** | 全部在 `webui/src/pages/skills/SkillList.tsx` | v0.17.0 上线 `/skills`,实现给了 36 个 testid,但 `selector-contract.md` 一条都没登记 |
| `❌ [UNREGISTERED TEMPLATE]` 模板 testid 漂移 | **6** | `McpRuntimeStatusPanel.tsx`(2 条)、`RoleTableGrants.tsx`(2 条)、`pages/ops/CallMonitor.tsx`(2 条) | v0.17.0 三个新页面/组件的模板 testid |
| `⚠️ [ORPHAN]` 登记但实现缺失 | **42** | `selector-contract.md` 自身 | 包含路由级 container(`*-page` / `-detail` / `-header`)、表编辑深度交互系列、Audit / Token / Agent / Wiki / Help 等页面的退化 |

**模板 testid 漂移明细(6 条)**:

| 实现位置 | testid | 影响域 |
|---|---|---|
| `webui/src/components/McpRuntimeStatusPanel.tsx` | `` `mcp-runtime-status-${connectionId \|\| "unselected"}` `` | MCP 治理闭环(无 spec) |
| `webui/src/components/McpRuntimeStatusPanel.tsx` | `` `mcp-runtime-recheck-${connectionId \|\| "unselected"}` `` | MCP 治理闭环(无 spec) |
| `webui/src/components/RoleTableGrants.tsx` | `` `row-policy-editor-${table.name}` `` | `/admin/roles` 拆分后(无 spec) |
| `webui/src/components/RoleTableGrants.tsx` | `` `row-policy-collapsed-label-${table.name}` `` | 同上 |
| `webui/src/pages/ops/CallMonitor.tsx` | `` `call-monitor-tool-${row.tool}` `` | `/ops/calls` 调用监控(无 spec) |
| `webui/src/pages/ops/CallMonitor.tsx` | `` `call-monitor-failure-${row.id}` `` | 同上 |

**特别注意 orphan(42)**:

- `table-editor-conn` / `table-editor-metadata-grid` / `table-editor-grain-input` / `table-editor-btn-save` / `overlay-badge-{grain,measures,segments}` / `inspector-tab-{diff,yaml,validate}` —— `/catalog/:c/:s/:t` 表编辑深度交互。`e2e-pub-01.spec.ts:127` 已自承"实现严重不足",这是单一根源。
- `audit-export-csv` —— `/admin/audit` 导出(企业级签字 audit 流程中的关键功能,无 E2E 覆盖)。
- `ops-service-health` —— `/ops/calls` 卡的 service health 区。
- `agent-detail` / `new-role` / `new-token` / `role-detail` / `roles-page` / `audit-page` / `onboarding-delivery-banner` / `help-header` —— 多半是 v0.5 时代路由级 container 命名约定被 v0.17 的 `<PageHeader>` 重构吃掉。
- `breadcrumb` —— 全局面包屑,需复核是否被独立元素替代或删除。

**摘要数字**:782 静态 impl testid · 129 模板 impl testid · 863 contract 登记 · 65 spec refs。

---

## 2. `e2e:smoke`(L1 PR Smoke)9 passed / 3 failed,16.4 秒

跑法:`LUCY_E2E_BASE_URL=http://127.0.0.1:55176` 复用 docker demo,`--max-failures=3` 早停。

| Test ID | 行号 / 入口 | 结果 | 根因 |
|---|---|---|---|
| E2E-PUB-02 `/review` 重定向 | `smoke.spec.ts:21` | ✅ pass | — |
| E2E-PUB-03 发布工作台流水线与门禁 | `smoke.spec.ts:29` | ✅ pass | — |
| **E2E-CON-01 连接概览术语** | `smoke.spec.ts:38` | ❌ fail | `connection-card-mysql-aliyun` not found;demo 连接叫 `demo-mysql` |
| **E2E-CON-03 上传 Drawer 打开** | `smoke.spec.ts:48` | ❌ fail | `add-schema-mysql-aliyun` click 超时;cascade from CON-01 |
| E2E-TOK-01 Token 资产看板 | `smoke.spec.ts:59` | ✅ pass | — |
| **E2E-AUD-01 访问日志** | `smoke.spec.ts:68` | ✅ pass | 最近 +28 行 Audit 改动后仍绿 |
| **E2E-USG-01 使用概况复合指标** | `smoke.spec.ts:77` | ✅ pass | `GovernanceOverview.tsx +189` 行改动后仍绿 |
| **E2E-LIC-01 部署许可激活码** | `smoke.spec.ts:86` | ✅ pass | — |
| **E2E-WIKI-01 Wiki 工作台** | `smoke.spec.ts:94` | ✅ pass | — |
| E2E-NAV-01 语义发布导航 | `smoke.spec.ts:103` | ✅ pass | — |
| E2E-NAV-02 页面标题与侧栏归属 | `smoke.spec.ts:115` | ✅ pass | — |
| **E2E-SEC-01 上传目标路径不可越权** | `smoke.spec.ts:122` | ❌ fail | demo 返回 `UNKNOWN_CONNECTION`,期望 `TARGET_EXISTS`;同一根因 |

旁注:1 条 `1 error was not a part of any test` —— Playwright 内部(可能是 webServer probe 或 trace zip 落盘次要警告),与上述 3 失败独立。

**3 个失败全部收敛到一个根因**:

> smoke.spec.ts 把连接 ID `mysql-aliyun` 写死,而 docker demo 容器只配置了 `demo-mysql`(已核实 `GET /api/connections` 返回 `[{ id: "demo-mysql", ... }]`)。这是**环境约束**,不是 selector/code 漂移。

`LUCY_E2E_BASE_URL` 路由复用生效:Playwright `webServer.url = BASE_URL`(`webui/playwright.config.ts:51`)在 55176 已响应时不会触发 `npm run dev`(`reuseExistingServer: !process.env.CI`),所以这次跑没有另起一份 vite。

---

## 3. 跨两份结果的反直觉但正确的解读

**selector-contract FAIL 与 smoke PASS 的反差**:

- selector-contract 抓**源码 ↔ 契约表静态同步**,其报出的 104 个问题都真实存在(consistency 维度)
- smoke 抓**真实可跑性**,其引用的 testid 全部仍存在于 v0.17.0 实现中,所以 9/12 能过
- 两者不矛盾的原因是:smoke 关心的页面路径上的 testid 仍健在,而**未引用**的 testid(skill / call-monitor / role-table-grants / mcp-runtime)是否漂移 smoke 不查

**这意味着**:

- 「L1 smoke 是否漂移」问题的答案是:**9/12 通过(已核实)**,3 个失败同根
- 「哪些新功能的 testid 仍健康」问题的答案是:**6 个模板 testid 漂移**(已核实,影响 3 个未来 spec 落点)
- 「contract 是否在 0.17 还可用」问题的答案是:**会阻塞新增 testid 入库**(按脚本逻辑)但目前 CI 未接,我未跑 CI 验证

---

## 4. 修订与原评估报告(对话上下文)的对齐

修订 1:早期对话里我写过"`smoke.spec.ts` 断言的 testid 名是 8 月以后大改后的产物,不敢打包票说还能过" — **已核实:9/12 转绿,3 失败原因唯一收敛到连接命名**,所以"漂移"那条降级成"环境约束",原文不再持有。

修订 2:早期对话里我写过"`/admin/usage` 8 月后 +189 行后是否还能渲染"存疑 — **已核实 E2E-USG-01 三 testid 全可见**(已核实:`governance-usage-overview` / `governance-usage-metrics` / `governance-usage-rank-grid`) ✅。

修订(追加):MCP runtime / CallMonitor / RoleTableGrants 的 6 个模板 testid 已**统一被 contract 报"未登记"**;这一发现把 P0 候选清单按"代码已上线 & spec 未写 & contract 未登记"对齐。

---

## 5. 已知限制 / 反证(看得见的没看的)

| 项 | 状态 |
|---|---|
| 工作区脏改动数 | 460 个未提交改动 / +5228 / -3049(已核实,但未做 risk-by-PR)|
| L2 / L3 E2E 是否漂移 | **未核实**(本次仅跑 L1)|
| selector-contract.md 与 `/tmp` 副本是否同步 | 未核实 |
| 浏览器矩阵 WebKit / Firefox | 未安装;`npx playwright install --with-deps` 未跑 |
| CI 守门真在跑 | 未核实(`pree2e:smoke` 在 package.json 写了,CI 文件未读) |
| `e2e:fixture` 与 demo 隔离行为 | 未跑;但 `smoke.spec.ts:17` 是 `warnIfMissing: true` 模式 |
| demo 容器的 connection 命名 | 唯一是 `demo-mysql`;不影响业务,但拖累 smoke 36% |

---

## 6. 给下一轮的候选清单(任何一项都可接续,可组合)

按代码层 vs 工程修正 vs 立项排序:

1. **代码层 / 一次性补登**:把 §1 的 36 + 6 = 42 个新 testid 一次性登记到 `docs/qa/selector-contract.md`,并复核 §1 orphan 中的实存功能(`audit-export-csv` / `ops-service-health` 优先)。这属于治理类文件改动,需要 Plan Mode + 人工确认。
2. **工程修正 / 低风险**:让 `smoke.spec.ts` 把 `mysql-aliyun` 通过 `process.env.LUCY_E2E_CONNECTION_ID ?? "mysql-aliyun"` 参数化,demo 与本地默认开发库都能跑;余下 3 条不应再因环境差异失败。
3. **立项 P0 / 高价值**:写 `/ops/calls` 调用监控的 L1 1 条 + L3 1 条 — `call-monitor-tool-${row.tool}` 与 `call-monitor-failure-${row.id}` 模板 testid 已实存,先扩 `selector-contract.md` §S.6,再写 spec,被 contract 双向守门挡住。
4. **立项 P0 / 高价值**:写 `/admin/roles` 拆分后 L2 1 条 —— `row-policy-editor-${table.name}` / `row-policy-collapsed-label-${table.name}` 已实存,接 spec 直接生效。
5. **文档层 / 一次性**:对照 v0.17 重写 `docs/governance/lucy-test-cases.md` 到 v2.0,把 8-9 月新增 Spec / Ac-p0~p15 / UI usage / Audit drill-down 收纳。这是跨产品文档任务,可作 RFC 输入。

---

## 7. 验证日志与产物

| 产物 / 现象 | 路径 / 结果 |
|---|---|
| Chromium | `~/.cache/ms-playwright/chromium-1234`(已核实安装) |
| Selector-contract 输出 | 单进程 stdout,FAIL 104 issue |
| Smoke 报告 1(success) | `webui/playwright-report/`(list 报告器,HTML+JSON 已生成)|
| Smoke 报告 2(失败 trace) | `webui/test-results/smoke-L1-PR-Smoke-12-条-升级对-*-chromium/trace.zip` × 3(已生成) |
| 本快照 | `docs/qa/audit/2026-09-26-e2e-selector-smoke-snapshot.md` |
| 工作区状态 | 仍脏,未触碰过任何文件 |

---

## 8. 修订历史

- v0(2026-09-26):Mavis 一次性快照。下游 PR 引用前请先复核本节 §0 范围声明与 §5 限制。
