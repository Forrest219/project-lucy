# URL 驱动受控输入框的输入法组合中断优化实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-10-29 |
| 目标版本 / 优先级 | v0.25（修订线）/ **P0**（S1–S3）+ P1（S4–S5）+ P2（S6–S7） |
| 主 Spec | [URL 驱动受控输入框的输入法组合中断优化 Spec](../specs/lucy-20261029-url-driven-input-ime-composition-spec.md)（**v0.1-draft**） |
| 需求来源 | 用户反馈：Audit 页「Agent 名称或 ID」搜索框输入法无法切换；2026-10-29 PM 指示排查全量同类筛选器 |
| 状态 | **待审阅，未批准**。第 1 轮审阅未进行 |
| 授权边界 | **无。** 不授权 S1–S7 任何阶段的编码、不授权测试执行、不授权治理文件变更、不授权浏览器验证、镜像、部署或 git 提交 |
| 验收 | SC-01 – SC-21 **全部未执行** |
| 实施主体 | Lucy WebUI（`webui/src` + `webui/scripts`）；不修改 KTX 源码、不改后端 API |
| 已拍板决策 | **无**。Spec §4 的 D1–D6 全部待 PM 拍板 |
| 待确认 | **D1（修法形态）**与 **D2（范围：13 处 vs 上轮已批 9 处）**为开工阻塞项；D3–D6 可同批拍板但不得由实现侧代决 |
| 本版修订 | v0.1 首版 |

---

## 1. 目标与实施原则

让所有**筛选栏文本输入框**在中文输入法下可用，并把「受控输入框的 value 源取自路由状态」这一写法从代码库中消除，且**用静态门禁保证不再回流**。

四个交付物：

1. **缺陷消除**——全量排查出的 **13 处** URL 驱动受控输入框（Audit 7、配置审计 3、Token 1、目录 1、发布历史 1）全部改为局部状态镜像（Spec §5.2）。
2. **防回归门禁**——新增 `npm run lint:url-driven-input`，对 `webui/src` 常驻扫描「value 源自路由状态」的受控文本输入框，改造前报 13 处、改造后报 0 处（Spec §5.5）。
3. **伴生缺陷收敛**——修掉 2 处「变换写回」（`AuditReconciliation` 的 `.trim()`、`CaseEditor` 的 `split/trim/filter` 写回）（Spec §5.4）。
4. **真浏览器验收手段入库**——把一次性 CDP IME 探针固化为 `webui/scripts/ime-composition-probe.mjs`，供后续同类缺陷复现与验收复用。

实施原则：

- **只换 value 源，不动 URL 语义**：URL 参数名、含义、格式、分享链接、深链能力**全部不变**；D4 默认选「每次按键即写 URL」，不顺手改成防抖。
- **DOM 结构与视觉零变更**：不新增/删除控件、不改 class、不改文案（Spec §10）。
- **判据是 value 源，不是 onChange 是否写 URL**：`onChange` 写 URL + `value` 取自本地 state 是**正确范式**，不得被门禁误伤（Spec §5.1）。
- **门禁不留白名单**：13 处改完必须全绿；仍有豁免需求即说明改造不彻底。
- **jsdom 不作为本缺陷的验收证据**：已实测 jsdom 无真实 IME 且导航同步，无法复现（Spec §1.2）；jsdom 只用于「value 源与 URL 同步」这类逻辑断言。
- **不代改他人条目**：本 Plan 只触碰 Spec §4 决策表与本 Plan 自身。
- **任何实现完成声明均不自动等于 SC 验收通过。**

---

## 2. 开工前置

### S0 开工裁决（**未进行**）

开工前置：**PM 拍板 D1–D6**。其中：

- **D1（修法形态）**——阻塞 S2、S3、S4。默认推荐 (a) 局部状态镜像；已实测 (c) 仅加 `isComposing` 守卫**无效**（守卫只拦 Enter 键，拦不住 `node.value` 写回），(b) 防抖是可选叠加项，由 D4 单独决定。
- **D2（范围）**——阻塞 S2、S3。上轮 PM 批的是 9 处，本轮全量排查为 **13 处**，新增 4 处为配置审计 3 处（`ConfigAudit.tsx:320/327/334`）与发布历史 1 处（`PublishHistory.tsx:508`）。四者同根因同修法，**推荐纳入**；若选「仅 9 处」，静态门禁对这 4 处无法放行 ⇒ 门禁必须带豁免 ⇒ 与「门禁不留白名单」原则冲突，需 PM 明确裁定。
- **D3–D6**——不阻塞开工，但须在 S1 结束前落定：门禁形态（D3）、URL 写入时机（D4）、伴生缺陷是否本期修（D5）、规范补齐方式（D6）。

**D1–D6 未全部拍板前，S1 之后的所有阶段不得开工。**

---

## 3. 现状依赖与文件落点

### 3.1 复用边界

| 复用 | 落点 | 说明 |
|---|---|---|
| 局部状态镜像范式 | `webui/src/pages/HelpCenter.tsx:239-244` + `:359-369` | 仓库内**已存在**的正确范式：`draftQuery` 本地 state 驱动 DOM + `useEffect` 从 URL 反向同步 + 同步写 URL。**不新造范式**，直接抄 |
| 静态门禁房格 | `webui/scripts/lint-terminology.mjs`、`webui/scripts/lint-ia-boundary.mjs` | 新门禁沿用同一房格：Node ESM 脚本 + `scan*` / `collect*` 导出函数 + 直接调用时执行 `main()` + 退出码语义 |
| 门禁接线位置 | `.github/workflows/lucy-release.yml:68` | 与 `lint:terminology` 同一 job 并列 |
| 测试基建 | `webui/src/__tests__/`（vitest）、`webui/scripts/__tests__/`（vitest） | 门禁单测落 `webui/scripts/__tests__/`；页面回归落 `webui/src/__tests__/` |
| IME 探针技术 | 一次性探针（2026-10-29 已删除） | 系统 Chrome + CDP `Input.imeSetComposition` + patch `HTMLInputElement.prototype.value` setter。**不依赖 Playwright 浏览器下载**（本机 `~/.cache/ms-playwright` 为空，实测不可用） |

**不复用／不依赖**

- 不引入新的前端状态库（React `useState` + `useEffect` 足够）。
- 不引入 IME 第三方库（缺陷在 value 源，不在输入法）。
- 不改后端 API、审计语义、URL 参数。

### 3.2 计划新增文件

| 路径 | 用途 | 归属阶段 |
|---|---|---|
| `webui/scripts/lint-url-driven-input.mjs` | 静态门禁：判定「value 源自路由状态」的受控文本输入框 | S1 |
| `webui/scripts/__tests__/lint-url-driven-input.test.ts` | 门禁单测：四类判定（缺陷写法／正确范式／`useState(searchParams.get(...))`／非文本 input） | S1 |
| `webui/scripts/ime-composition-probe.mjs` | 真浏览器 IME 组合探针（CDP），供 SC-17 使用并留痕到 `inbox/` | S5 |
| `webui/src/lib/useUrlMirroredField.ts` | 局部状态镜像 hook（封装 Spec §5.2，供 5 个页面复用） | S2 |

> 落位依据：[`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」——实现细节允许放 `<module>/docs/`，但**代码**落 `webui/src` 与 `webui/scripts`；探针运行产物落 `inbox/`（AGENTS.md「临时文件落位」）。

### 3.3 计划修改文件

| 路径 | 改动 | 归属阶段 |
|---|---|---|
| `webui/src/pages/admin/Audit.tsx` | 7 处输入框改局部状态镜像；`clearFilters`（`:1693`）显式重置全部镜像 draft；hydration（`:1497-1521`）经反向同步 | S2 |
| `webui/src/pages/admin/ConfigAudit.tsx` | 3 处（`:320`/`:327`/`:334`） | S3 |
| `webui/src/pages/admin/Tokens.tsx` | 1 处（`:214`） | S3 |
| `webui/src/pages/Catalog.tsx` | 1 处（`:493`） | S3 |
| `webui/src/pages/publish/PublishHistory.tsx` | 1 处（`:508`） | S3 |
| `webui/src/pages/admin/AuditReconciliation.tsx` | 1 处（`:313`）：去 `.trim()` 写回，改在查询消费点 trim | S4 |
| `webui/src/pages/eval/CaseEditor.tsx` | 1 处（`:291`）：拆「原文 draft」与「解析值」双态 | S4 |
| `webui/package.json` | 新增 `lint:url-driven-input` | S1 |
| `package.json`（根） | 新增同名脚本（与既有 `lint:terminology` / `lint:ia-boundary` 并列） | S1 |
| `.github/workflows/lucy-release.yml` | CI job 增跑新门禁 | S7 |
| `docs/governance/test-layers-and-release-gates.md` | §2「Current Commands」登记 `npm run lint:url-driven-input`；§8「CI Mapping」的 `spec-and-unit` job 命令列表增列该门禁 | S7 |
| `webui/docs/design-system/99-governance.md` | 登记「筛选栏文本输入框 value 源」临时决策（Spec §10） | S6 |
| `webui/docs/design-system/14-components-filter-input.md` | **待定**：是否补输入框组件章节（D6） | S6 |
| `docs/README.md`、`docs/governance/project-overview.md`、`docs/plans/README.md` | 索引与登记行 | S6 |
| `CHANGELOG.md` | 按仓库 CHANGELOG 约定追加条目（`<major>.<minor>.<patch>` 行制；本次为**用户可见修复**，属 `Fixed`） | S6 |

---

## 4. 分阶段实施

### S1 静态门禁与基线固化（P0）

**目标**：先把「缺陷在哪」变成机器可核对的事实，再改代码。

1. 落 `webui/scripts/lint-url-driven-input.mjs`，实现 Spec §5.1 的判定算法与 §5.5 的门禁语义。
2. 落单测 `webui/scripts/__tests__/lint-url-driven-input.test.ts`，覆盖四类判定。
3. 接入 `webui/package.json` 与根 `package.json`（`npm run lint:url-driven-input`）。
4. **在未改造的代码上跑门禁，把输出固化为基线**：必须恰好报出 Spec §2.1 表中的 **13** 处，且**不多不少**（多报 = 判定算法过宽，少报 = 判定算法过窄）。

**验收对应**：SC-14（改造前报 13 处）、SC-15（零误报）、SC-16（单测全绿）。

**出口条件**：基线恰好 13 处。**若数量不等于 13，停止并回退修正判定算法，不得带着错位的基线进入 S2**——否则 S2/S3 完成后无法判断是否真的收敛。

### S2 Audit 页 7 处改造（P0）

**目标**：先在用户反馈所在页面落地主修法，验证 hook 与反向同步的可行性。

1. 落 `webui/src/lib/useUrlMirroredField.ts`，实现 Spec §5.2 的 `useUrlMirroredField(paramKey)`：本地 state 驱动、`useEffect` 反向同步、同步写 URL。
2. Audit 页 7 处（`:2061`/`:2081`/`:2178`/`:2186`/`:2193`/`:2201`/`:2217`）改用该 hook。
3. **`clearFilters`（`:1693`）显式重置全部镜像 draft**——该函数把 URL 整体重建为仅含 `range`/`view`/`turnId`/`object`/`eventId`，不重置即违反 INV-3（输入框残留旧文本、URL 已清空）。**本阶段最高回归风险点**。
4. 统一搜索框（`:2081`）的 `unifiedSearchValue` 聚合语义（`key` / `turnSearch` / `tableSearch` 三选一）需一并映射为**单一镜像字段 + 写入时按当前 tab 分派到对应 param**，不得让三个 param 各自成为镜像源。
5. 补 `webui/src/__tests__/` 页面级回归：深链初值、输入后 URL 同步、后退回填、清除筛选清空。

**验收对应**：SC-01 – SC-07、SC-20（`admin-audit-turns.test.tsx:777` 的「清除筛选」用例不得回归）。

### S3 其余 4 页 6 处改造（P0）

**目标**：把同一模式在全库消除。

1. 配置审计 3 处（`ConfigAudit.tsx:320`/`:327`/`:334`）——该页 `updateParam`（`:172-175`）与 Audit 同款。
2. Token 1 处（`Tokens.tsx:214`）——`updateParam`（`:52-60`）同款。
3. 目录 1 处（`Catalog.tsx:493`）——`patchSearchParams`（`:247-272`）走 `setSearchParams(next, { replace: true })`；**该页的 `q` 与树形筛选（`connection`/`schema`/`scope`/`completion`）并存**，镜像改造不得影响树形筛选的 URL 行为（`catalog.test.tsx:442-465` 有断言）。
4. 发布历史 1 处（`PublishHistory.tsx:508`）——`updateParam`（`:362-366`）同款；注意该页另有 `window`/`since`/`until` 等时间参数，与文本框互不干扰。
5. 跑门禁：**必须 0 处**。

**验收对应**：SC-08 – SC-13、SC-14（改造后 0 处）。

### S4 伴生缺陷：变换写回（P1）

**目标**：消除「state ≠ DOM 值」的第二个来源，并顺带修掉 C-2 这个与 IME 无关的独立 bug。

1. `AuditReconciliation.tsx:313`：`setTurnId(e.target.value.trim())` → 存原文；发起查询前（`:59-64`）再 `trim()`。
2. `CaseEditor.tsx:291`：`value={form.expected_measures.join(", ")}` + 拆分/trim/过滤写回 → 拆成「原文 draft」（受控输入框绑定）与「解析值」（仅下游消费）；提交前再解析。**必须能键入 `", "` 而不被立即抹除**。
3. 复核 `RowPolicyView.tsx` 的 5 处非受控 + trim（Spec §1.4 C-3）：**不改**，仅确认不受影响，避免被误当作同类缺陷一并「修」而引入回归。

**验收对应**：SC-18、SC-19。

### S5 真浏览器探针入库与一次性验收（P1）

**目标**：把一次性验证手段固化为可复用工具，并产出 SC-17 的运行记录。

1. 落 `webui/scripts/ime-composition-probe.mjs`：系统 Chrome + CDP `Input.imeSetComposition` + patch `HTMLInputElement.prototype.value` setter；输入「待测输入框选择器列表」，输出每个输入框的 `compositionstart` 计数、最终 DOM 值、DOM 写回次数、焦点保持情况。
2. 在 S2/S3/S4 完成后，对 13 处**逐处**跑一遍（`zhong` → `zhongwen` → `中文`）。
3. 运行产物落 `inbox/`（如 `inbox/ime-probe/2026-10-29-ime-composition/`），含脚本、输出与 Chrome 版本。
4. **对照件**：同页放 1 个本地 state 驱动的对照输入框，断言其 `compositionstart`=1、DOM 写回 0 次——证明探针本身有效，而非「探针测不出问题」。

**验收对应**：SC-17（**必须真实浏览器运行记录**；jsdom 结果不得充当该项证据）。

**边界**：该探针**不进 CI 门禁**（依赖系统 Chrome + 运行中的 WebUI，不适合 CI 常驻）。CI 门禁是 S1 的静态检查。

### S6 文档、规范与登记同步（P2）

1. `webui/docs/design-system/99-governance.md`：登记临时决策「筛选栏文本输入框的 `value` 必须由局部状态驱动，URL 作为下游事实源跟随」。
2. 按 D6 决定是否新增 `webui/docs/design-system/14-components-filter-input.md`；**若不补章节，本 Spec §5 即该约束的事实源**，须在 `99-governance.md` 写明。
3. `docs/README.md`：按既有格式加索引行。
4. `docs/governance/project-overview.md`：加登记行（注明「待审阅、未批准、SC 全部未执行」；**不得**写成已实现或已验收）。
5. `docs/plans/README.md`：加 Plan 索引行（与既有行同格式，状态写「待审阅，未批准」）。
6. `CHANGELOG.md`：按仓库 CHANGELOG 约定追加 `Fixed` 条目（`<major>.<minor>.<patch>` 行制；条目须写「修复筛选栏文本输入框在中文输入法下组合被打断」这一**用户可见**事实，不写内部实现术语）。

### S7 门禁接线与全量回归（P2）

1. `.github/workflows/lucy-release.yml`：在 `lint:terminology`（`:68`）之后增跑 `npm run lint:url-driven-input`。
2. **`docs/governance/test-layers-and-release-gates.md`**：§2「Current Commands」表增行登记 `npm run lint:url-driven-input`（Layer 建议 `platform`，Purpose 说明「扫描受控文本输入框的 value 是否源自路由状态，防 IME 组合被打断缺陷回流」）；§8「CI Mapping」的 `spec-and-unit` job 命令列表增列该门禁。**新增命令必须在此登记，否则门禁在发布口径里不可见。**
3. 全量回归：`cd webui && npm test`、`npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:spec`、`npm run lint:url-driven-input`。
4. 复跑 SC-17 的真浏览器探针，确认门禁接入未影响运行时。

---

## 5. 验收追踪

| 验收项 | 覆盖阶段 | 证据形式 |
|---|---|---|
| SC-01 – SC-07（Audit 7 处） | S2 | 页面级 vitest + 真浏览器探针 |
| SC-08 – SC-13（其余 6 处） | S3 | 页面级 vitest + 真浏览器探针 |
| SC-14（门禁前 13 后 0） | S1 / S3 | 门禁输出基线对比 |
| SC-15（零误报） | S1 | 门禁输出 + 抽样断言 |
| SC-16（门禁单测） | S1 | vitest |
| SC-17（真浏览器 IME 验收） | S5 | `inbox/` 内的运行记录 |
| SC-18（C-1） | S4 | vitest |
| SC-19（C-2） | S4 | vitest |
| SC-20（全量回归不破） | S2 / S3 / S7 | `npm test` + lint |
| SC-21（CI 接线） | S7 | CI job 结果 |

---

## 6. 完成定义与非目标复核

### 6.1 实现完成

- 13 处全部改为局部状态镜像，门禁报 0 处；
- 2 处变换写回已修；
- 门禁 + 单测 + CI 接线就位；
- 文档、规范、登记、CHANGELOG 同步完成。

### 6.2 功能验收

SC-01 – SC-21 全部通过，其中 SC-17 有真实浏览器运行记录（落 `inbox/`）。**实现完成 ≠ 验收通过**：验收结论以 SC 执行结果为准。

### 6.3 不变边界复核

- URL 参数名与语义不变（深链、分享链接、外部跳转继续可用）；
- `localStorage` 筛选快照键与内容不变，无迁移；
- 后端 API 与审计语义不变；
- DOM 结构、视觉、文案零变更（Spec §10）；
- 未触碰 KTX 源码。

---

## 7. 风险与回滚

| 风险 | 等级 | 缓解 | 回滚 |
|---|---|---|---|
| 「清除筛选」后输入框与 URL 脱节 | **高** | INV-3 + SC-01(5)；`admin-audit-turns.test.tsx:777` 作回归哨兵 | Audit 页独立回滚 |
| 本地 state 与 URL 双源时序错位（后退/深链/hydration） | 中 | 反向同步路径 + SC-01(3)(4) | 按页回滚 |
| 门禁判定算法过宽/过窄 | 中 | S1 出口条件卡「恰好 13 处」 | 门禁为只读脚本，回滚不影响运行时 |
| 探针不可用（无系统 Chrome） | 中 | SC-17 为一次性验收，非 CI 门禁；失败时记录为 `blocked_environment`，**不得**降级为 jsdom 证据 | — |
| D2 选「仅 9 处」导致门禁需豁免 | 中 | 与「门禁不留白名单」原则冲突，需 PM 明确裁定 | — |
| 顺带改了「每次按键即写 URL」的行为 | 中 | D4 默认选 (a) 不改该行为 | 按页回滚 |

**回滚粒度**：13 处分散在 5 个文件，每页可独立回滚；`useUrlMirroredField.ts` 为新增文件，删除即回退到各页内联实现；门禁与探针为新增只读脚本。无数据面变更，回滚无残留。

---

## 8. 本次文档交付的实际范围

- 本轮**只落盘两份文档**：本 Plan 与主 Spec（`docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md`）。
- **代码一行未改**；S1–S7 **全部未执行**；SC-01 – SC-21 **全部未执行**。
- 一次性探针（vite 验证台、CDP 驱动脚本、临时 vitest 探针）**已全部删除**，`git status` 不含本次残留。
- 全量排查为**只读分析**，结论落在 Spec §2.1；排查脚本本身未入库（若 PM 认为其有长期价值，可在 S1 阶段把判定算法固化为门禁——那正是 S1 的内容）。
- 本 Plan 未修改任何既有 Spec、Plan、登记册行；`docs/governance/project-overview.md` 的登记行**留待 S6** 由实施阶段写入，避免在未批准状态下先行登记。

---

## 9. 与仓库规范的对齐自检

本 Plan 与主 Spec 落盘时已逐条比对 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 与相关治理文档，结果如下。

| 成文要求 | 出处 | 本文档的落点 | 状态 |
|---|---|---|---|
| 仓库级 Spec 落 `docs/` | DEVELOPMENT.md「Spec 落位规则」 | `docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md` | ✅ |
| 仓库级 Plan 落 `docs/plans/` | `docs/plans/README.md` 首行 | `docs/plans/2026-10-29-lucy-url-driven-input-ime-composition-plan.md` | ✅ |
| Spec／Plan 须登记进对应索引 | DEVELOPMENT.md「新增 Spec / Plan 的落盘清单」第 7 条 | Spec 已登记 `docs/README.md`；Plan 已登记 `docs/plans/README.md`（状态写「待审阅，未批准」） | ✅ |
| 重要功能 Spec 必含固定标题的伪代码小节 | DEVELOPMENT.md「Spec 内容规格：重要功能必含伪代码」 | Spec §5「核心流程（伪代码）」，含判定算法、镜像模式、时序、变换写回、门禁算法五段 | ✅ |
| 新增/重大更新 Spec 必含 `Terminology Compliance` | DEVELOPMENT.md「新模块必填 Terminology Compliance」 | Spec §9，形态与同日 peer 一致（`This feature follows…` + `New terms: - None` + 说明段） | ✅ |
| UI 交互改动须含 `Design System Compliance` | DEVELOPMENT.md「WebUI 设计规范」＋ `30-pr-compliance-template.md` | Spec §10，**已改为该模板规定形态**（Referenced Specs / What This Change Follows / Exceptions / Follow-up Needed） | ✅ |
| 规范缺失先记临时决策再补章节 | `webui/docs/design-system/99-governance.md` | Spec §10 Exceptions + 临时决策；补章节提案列入 Follow-up Needed | ✅ |
| 先出计划、经确认后再落地 | DEVELOPMENT.md「强制流程：Plan Mode」 | 本轮**只落文档、不改代码**；S1–S7 全部未执行 | ✅ |
| 浏览器测试须由计划明确要求 | DEVELOPMENT.md「验证策略：浏览器测试约束」 | SC-17 在本 Plan 内**显式要求**真实浏览器验证并规定证据形态；默认不做移动窄屏测试 | ✅ |
| 新增门禁须在测试门禁文档登记 | `docs/governance/test-layers-and-release-gates.md` §2／§8 | Plan §3.3 已把该文件列入修改清单，S7 第 2 步写明 §2／§8 两处登记动作 | ✅ |
| 工作项编号须经 PM 指派、由权威登记册登记 | `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` | Spec 元数据标「待 PM 指派」并指向权威登记册；**本轮不代改登记册** | ⚠️ 待 PM |
| 文档形态门禁 | `npm run lint:spec-docs`（DEVELOPMENT.md「新增 Spec / Plan 的落盘清单」配套） | 本 Plan 与主 Spec 在该门禁下**零违规**（存量豁免见 `docs/governance/spec-plan-doc-baseline.json`） | ✅ |
| 机器可查门禁 | `npm run lint:terminology` / `lint:ia-boundary` / `lint:spec` | 三项全绿（`lint:spec` 仅余两项既有 WARN，与本次无关） | ✅ |

**自检发现的 3 处缺口已在本轮修掉**（Spec §10 模板形态、Plan 门禁登记落点、Plan 索引行）；剩余唯一未闭环项是**功能编号待 PM 指派**，属决策事项而非文档缺陷。

> ⚠️ **一处需要更正的自述**：本节初版曾写「Plan 须登记进索引」并把「索引覆盖全部 plan」当作依据。**该依据是错的**——2026-10-29 实测 `docs/plans/` 74 份中仅索引 15 份、`docs/specs/` 46 份中仅索引 16 份，**两个索引都是策展式**。现按 DEVELOPMENT.md「新增 Spec / Plan 的落盘清单」第 7 条执行：**存量不补登记，自规范生效起新增的必须登记**。

### §9 修订（2026-10-29 PM 裁定：门禁判定范围按 git 跟踪状态分流）

PM 裁定：**形态门禁的判定范围按 git 跟踪状态分流**——已跟踪文件（已提交或已 `git add`）的基线外违规仍为**阻塞**（exit 1），**未跟踪文件**（尚未 `git add` 的在途草稿）的基线外违规**只报 WARN、不阻塞**。

- **起因**：门禁初版对未跟踪与已跟踪文件一视同仁，在**共享工作区**里把另一个会话的在途草稿算成阻塞项，导致本门禁对他人「误伤」，且输出无法区分责任归属。
- **口径未松**：该文件一旦被 `git add` 或提交，同一条违规**立即转为阻塞项**；CI 侧工作树干净、文件均已跟踪，判定与本地一致。
- **落点**：`scripts/lint-spec-docs.mjs`（`loadTrackedFiles()` + `classifyViolations()` 三参数分流 + `formatReport()` 双通道输出）＋ `scripts/lint-spec-docs.test.mjs`（新增 3 条单测）＋ `docs/governance/DEVELOPMENT.md`「门禁的判定范围（按 git 跟踪状态分流）」＋ `docs/governance/test-layers-and-release-gates.md` §2 登记行。
- **不代他人豁免**：未跟踪文件的问题由其主人解决，**不得**代改、**不得**因此写进基线（基线只减不增）。
- 上表「文档形态门禁」行的**零违规结论不受影响**：本 Plan 与主 Spec 均已跟踪且零违规。
