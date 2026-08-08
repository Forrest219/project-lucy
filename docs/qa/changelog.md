# E2E 用例变更日志

> 维护规则：每次 PR 涉及 E2E 用例 / Selector 契约 / 影响映射 / 术语表，必须在本文件追加一节。
> CI 守门：PR 模板勾选"E2E 变更"时，要求本文件有本次 PR 对应的小节；否则阻断合并。

---

## 2026-08-08 · docs/runtime · Spider2 G-sample 改 MCP-direct（Cursor lucy-demo）

### 修改
- `demo_agent` / `ksc_financial_readonly`：ACL 追加 `sandbox` `prefix: s2_`（保留 KSC `ai.*`）
- `scripts/e2e-spider2-lite-sample.mjs`：默认 mcp-direct + `lucy-demo-agent-token`，移除 Claude CLI 依赖
- `docs/qa/suite-agent-mcp.md` §5、suite README / ONBOARD §14 交叉引用同步

### 影响映射更新
- 无（非 WebUI selector）

---

## 2026-08-08 · docs · Spider2-lite Pilot 挂入 E2E 总指引 + 分表

### 修改
- `docs/qa/e2e-sop.md` v1.1：§3 增加 Spider2 选用决策；配套索引指向 `evals/spider2_lite_sqlite/` 与 WO-58
- `docs/qa/suite-semantic-onboard-mcp-eval.md` v1.2：新增 §14 Spider2-lite Pilot 参考实例（参数表、Phase 差异、npm 门禁、复跑清单）
- `docs/qa/suite-agent-mcp.md` v1.1：新增 §5 Spider2 Agent 抽样可选扩展
- `docs/qa/README.md`：地图注明 Spider2 走 ONBOARD / AGENT 分表，不新建第四测试集

### 影响映射更新
- 无（非 WebUI selector 变更；不新增 `E2E-*` ID）

---

## 2026-08-08 · docs · E2E SOP 总指引 + 测试集分表

### 新增
- `docs/qa/e2e-sop.md`：E2E SOP 总指引（测试集总表、选用决策）
- `docs/qa/suite-webui-browser.md`：分表 `E2E-WEBUI`
- `docs/qa/suite-semantic-onboard-mcp-eval.md`：分表 `E2E-ONBOARD-EVAL`（由原主题接入 SOP 迁入）
- `docs/qa/suite-agent-mcp.md`：分表 `E2E-AGENT`

### 修改
- `docs/qa/README.md` / `docs/test-layers-and-release-gates.md` / `docs/README.md`：改为「总指引 + 分表」结构
- 旧路径 `docs/qa/semantic-onboard-mcp-eval-sop.md`、`docs/sop-semantic-upload-mcp-eval-e2e.md` 改为迁移桩

### 影响映射更新
- 无（非 WebUI selector 变更）

---

## 2026-08-08 · docs · 主题接入 SOP 入驻 docs/qa

### 新增
- `docs/qa/semantic-onboard-mcp-eval-sop.md`：语义上传包 → WebUI → ACL → MCP vs gold 端到端 SOP（跨 platform + business eval）
- `docs/qa/README.md`：QA / E2E 文档地图

### 修改
- `docs/test-layers-and-release-gates.md`：§1 增加跨层 E2E 文档索引表
- `docs/README.md`：§7 指向 `qa/` 下套件与 SOP
- 旧路径 `docs/sop-semantic-upload-mcp-eval-e2e.md` 改为迁移桩

### 影响映射更新
- 无（非 WebUI selector 变更）

---

## 模板

```md
## YYYY-MM-DD · PR #NNN · [<简述>](<PR_URL>)

### 新增
- E2E-XXX-NN：<一句话>（selector: `xxx-yyy`）
- 新增 selector testid `xxx-yyy`：位置 / 角色 / 文案约束

### 修改
- E2E-XXX-NN：<一句话>（原因：<issue / spec 引用>）
- selector testid 改名：`old` → `new`（影响：E2E-AAA, E2E-BBB）

### 废弃
- E2E-XXX-NN：<一句话>（原因：<功能下线 / 路由迁移>）
- selector testid `xxx-yyy` 标记 Deprecated：1 个版本后删除

### 影响映射更新
- 新增 `route` / `component` / `api` 条目
- 移除条目

### 术语 / 翻译防御更新
- 新增 forbidden term：`<term>`
- 移除 forbidden term：`<term>`（原因）
- 新增专业术语 token 防御类别
```

---

## 2026-07-31 · v0.3 评审回炉 · 工程入口真正落地

### 修改
- **webui/package.json**：新增 `e2e:install` / `e2e:fixture` / `e2e:smoke` / `e2e:impacted` / `e2e:nightly` / `e2e:release` / `e2e:report` / `e2e:selector-contract` 8 个脚本；devDependencies 加 `@playwright/test@^1.62.1`（已 `npm install` 同步 lockfile）；`e2e:install` 安装 Chromium / WebKit / Firefox，与 release 浏览器矩阵一致；`pree2e:*` 自动先跑 selector 守门和 fixture 初始化
- **webui/playwright.config.ts**：移至 webui 根；testDir 指向 `tests/e2e/specs`；webServer.env 同时设 `KTX_PROJECT_ROOT`（server 优先读这个）
- **scripts/init-e2e-fixture.sh**：修正路径 bug——fixture 源从 SRC（真实仓库）读，不再依赖 DEST（刚 clone 完还没有 webui/tests/e2e）
- **webui/tests/e2e/fixtures/data/ktx-fixture.yaml**：从 list 改 map 格式（与真实 ktx.yaml 一致）
- **webui/tests/e2e/fixtures/helpers/reset.ts**：ESM 兼容（`import.meta.url` 替代 `__dirname`），新增 warn 模式供 L1 只读用例使用
- **webui/tests/e2e/fixtures/helpers/terminology.ts**：从 forbidden 列表移除 `待发布变更`（section 标题合规，误报）
- **webui/scripts/check-selector-contract.mjs**：契约解析改"只解析 markdown 表格首列"（避免内联代码误判）；模板 testid 走 split-then-regex
- **webui/tests/e2e/specs/smoke.spec.ts**：新增 8 条 L1 PR Smoke，全部用真实 testid，**不依赖 fixture init**
- **docs/qa/selector-contract.md**：完全重写，列 `webui/src/` 实际存在的 testid；标注 MISSING 项
- **docs/qa/impact-map.json**：`GET /api/validate-changed` → `POST`；`semantic-asset-publish-drawer-submit` → `semantic-asset-publish-submit`
- **webui/tests/e2e/specs/smoke.spec.ts**：`E2E-SEC-01` 改为打真实后端并严格断言 4xx + 越权错误码；`E2E-I18N-01` 从 `fixme` 改为 PR 阻塞的 forbidden terms 0 命中检查
- **docs/qa/lucy-webui-e2e-test-suite.md**：L1 PR Smoke 列表对齐实际 smoke：`E2E-PUB-02` / `E2E-CON-01` / `E2E-CON-03` / `E2E-WIKI-01` / `E2E-NAV-01` / `E2E-NAV-02` / `E2E-SEC-01` / `E2E-I18N-01`

### 新增
- `webui/playwright.config.ts`（真实可跑）
- `webui/tests/e2e/fixtures/helpers/trace.ts`（截图/trace 落盘）
- `webui/tests/e2e/fixtures/data/finance_mart.yaml`（Manifest fixture）
- `webui/tests/e2e/fixtures/data/wiki-fixture/`（2 篇 Wiki fixture）
- `webui/tests/e2e/fixtures/data/semantic-layer-fixture/`（3 个 YAML fixture）
- `webui/tests/e2e/specs/e2e-pub-01.spec.ts`（主链路 L3 Nightly）
- `webui/tests/e2e/specs/smoke.spec.ts`（L1 PR Smoke 8 条）

### 验证
- 守门脚本：`[OK] selector contract is consistent`（双向：实现未登记 → fail；spec 引用但实现缺失 → fail）
- L1 smoke：`7 passed / 1 fixme`（fixme 是已记录的产品 bug——侧栏 link 元素缺 `translate="no"` 防御）
- 真实仓库只读：guard 在 `LUCY_PROJECT_DIR` 指向真实仓库时 throw，fixture 缺失时 L1 warn / L3 strict throw

### 已知产品 bug（E2E 捕获）
- [BUG-I18N-01] 侧栏导航 link 元素（`Wiki 文档` / `Agent 实例` 等）未带 `translate="no" notranslate` 防御。L1 E2E-I18N-01 标 `test.fixme`，等 frontend 修
- [BUG-MISSING-01] `add-schema-drawer-step-1..4` / `catalog-row-...` / `overlay-badge-*` / `sl-ref-picker` / `sl-ref-badge-*` 等 selector 在实现中缺失，E2E-SEM-* / E2E-WIKI-03 暂用 `getByRole` / `getByText` 兜底；selector-contract §9 列了提议 PR

---

## 2026-07-31 · v0.1 → v0.2 评审回炉 · 文档骨架建立

### 新增
- 活文档落位：`docs/qa/lucy-webui-e2e-test-suite.md`（替代 inbox 版本）
- 独立 Selector 契约：`docs/qa/selector-contract.md`（~80 个 testid 入册）
- 影响映射：`docs/qa/impact-map.json`（route/component/api/selectorTestId 四类）
- 变更日志：本文件 `docs/qa/changelog.md`
- E2E 用例层级 L1 / L2 / L3 / L4 准入分层
- Fixture Project 规范（`/tmp/lucy-e2e-fixture`，真实仓库只读）
- Playwright 工程入口设计（`playwright.config.ts` / scripts / `tests/e2e/`）

### 修改
- E2E-PUB-01：细化主链路，新增 §8 fixture project + §6 翻译防御 helper
- 全用例：Selector 引用从散落改为 §5 契约表
- 翻译防御：从依赖 Chrome Auto-translate 改为结构化扫描 + 原文 forbidden

### 废弃
- inbox 副本 `inbox/lucy-webui-e2e-test-suite-2026-07-31.md`（已 trash）
- v0.1 §"约 8 个用例"的模糊 PR 准入定义（改为 §3 明确分层）

### Selector 契约表变更
- 新增 §S.1 ~ §S.6 共 ~80 个 testid 入册
- 修正 v0.1 误写 `publish-workbench-cta-publish` → `workbench-publish-and-reindex`（实际 PublishWorkbench.tsx:193）
- 新增 `Rename History` 段落

### 影响映射更新
- 完整建立 route / component / api / selectorTestId 四类映射
- 反向链接所有 35 个 E2E 用例到至少一个映射键

### 术语 / 翻译防御更新
- 新增 forbidden 列表 23 项（§0）
- 新增翻译防御 helper `assertNoForbiddenTerms` + `assertProfessionalTermsProtected`
- Auto-translate 降为 L3 Nightly 专项，**不**作为 PR 阻塞

---

## 待办（v0.3 之后）

- [ ] Frontend 修 BUG-I18N-01（侧栏 link 加 `translate="no"` + `notranslate`）→ 取消 E2E-I18N-01 fixme
- [ ] Frontend 补 BUG-MISSING-01 的 testid（见 selector-contract §9 Pending Proposals）→ E2E-SEM-* 改回 `getByTestId` 精确断言
- [ ] CI workflow `.github/workflows/e2e-smoke.yml`（L1 + selector 守门）
- [ ] CI workflow `.github/workflows/e2e-nightly.yml`（L3 + 翻译专项）
- [ ] CI workflow `.github/workflows/e2e-release.yml`（L4 + 3 浏览器）
- [ ] `scripts/e2e-impact.ts` git diff → L2 自动选择
- [ ] `webui/server/index.ts` 增加 fixture 专用 `POST /api/test/reset-fixture` 接口（resetViaBackend 备用路径）

---

## 2026-08-01 · v0.4 IA 收敛 · 侧栏导航重构（docs/qa/lucy-webui-e2e-test-suite.md + selector-contract.md）

### 修改

#### 1. spec 直接修复（L1 PR Smoke 阻塞基线）

- **`webui/tests/e2e/specs/smoke.spec.ts`** · E2E-NAV-02：面包屑断言 `数据库接入` → `数据接入`（v0.4 IA 收敛：原"数据库接入"组名 → "数据接入"）。修复后 L1 smoke 8/8 全绿（chromium，2.0s）。
- **`webui/tests/e2e/specs/e2e-pub-01.spec.ts`** · step 1：新增 `expect(page-header).toContainText("数据接入")` 断言；保留对原 `表白名单` button 不出现的兜底断言（兼容期已移除该 header 跨页按钮，断言语义自动生效）。

#### 2. helper 路径 bug 修复

- **`webui/tests/e2e/fixtures/helpers/reset.ts`**：`REPO_ROOT = resolve(__dirname, "../../../../")`（4 级）→ `"../../../../../"`（5 级）。原 4 级定位到 `webui/`，导致 `INIT_SCRIPT` 解析为不存在的 `webui/scripts/init-e2e-fixture.sh`，L3 `resetFixture()` 必 throw。修复后 L3 跑得到 fixture 初始化。

#### 3. 主文档同步

- **`docs/qa/lucy-webui-e2e-test-suite.md`**：
  - 关联规范表：补 `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`；"数据库接入"→"数据接入"；"语义层维护"→"语义建模"；"业务文档"→"业务 Wiki"
  - §1.4 业务闭环：主链路文字更新为"数据接入 → 语义建模 → 业务 Wiki 关联 → 语义发布 Reindex"
  - §5.2 / §5.3 / §5.4 章节标题：分别改为"数据接入 / 业务 Wiki / 语义建模"
  - §9 模块缩写：CON/WHL/SEM/WIKI 注释更新
  - §10 矩阵：E2E-WHL-01 名称从"表白名单 query param"→"启用表范围 query param"
  - §11.1 step 1：面包屑期望从 `数据库接入 / 连接概览` → `数据接入 / 连接概览`
  - §11.2 E2E-CON-01：testid 引用从 `connection-card-mysql-aliyun-badge-readonly` → `connection-readonly-mysql-aliyun`（v0.3 早已对齐实现，本次同步文档）
- **`docs/qa/selector-contract.md`**：
  - §2/§3/§4/§5 章节标题：分别改为"数据接入 / 启用表范围 / 语义建模 / 业务 Wiki"
  - §2.3 `catalog-asset-upload-primary`：文案约束从"前往配置表白名单 ->"→"前往配置启用表范围 →"

### 新增

- **L1 smoke 文件头注释**：v0.4 变更说明 + 不需修改的 spec 列表
- **§13 维护节奏补充**：v0.4 起的导航术语反向维护原则（先动 `webui/docs/00`，再回写 spec / contract / changelog）

### 验证

- **Selector 契约守门**：`node scripts/check-selector-contract.mjs` → `[OK] selector contract is consistent`（185 静态 / 24 模板 / 238 契约 / 35 spec 引用）
- **L1 PR Smoke（chromium）**：`npm run e2e:smoke` → **8 passed (2.0s)**；E2E-PUB-02 / E2E-CON-01 / E2E-CON-03 / E2E-WIKI-01 / E2E-NAV-01 / E2E-NAV-02 / E2E-SEC-01 / E2E-I18N-01 全绿
- **L3 Nightly 主链路**：`npx playwright test --grep "@nightly" --project=chromium` → **e2e-pub-01 主链路 step 2 失败**（详见下方"失败分类"）

### 失败分类（L3 e2e-pub-01 step 2 — `添加 Schema finance_mart`）

- **失败位置**：`webui/tests/e2e/specs/e2e-pub-01.spec.ts:74` — `add-schema-success-message` 不可见
- **根本原因**：`webui/server/project.ts:439-450` 的 `addSchema` 在写路径（非 dryRun）pre-flight 调用 `ktx connection test ${connId}`，fixture 环境（`/tmp/lucy-e2e-fixture`）的 ktx.yaml 指向 127.0.0.1:3306 但**没有真实 MySQL** 监听；ktx CLI shell out → 4.6s TCP 超时 → `ECONNREFUSED` → `ConnectionTestFailedError` → HTTP 400 → `add-schema-success-message` 永远不出现
- **分类**：
  - **不是** selector 契约漂移
  - **不是** fixture 数据问题（fixture 的 `ktx-fixture.yaml` / 凭据 / `semantic-layer/` / `wiki/` 都已正确注入）
  - **不是** 测试本身不符合产品契约（spec 期望的 `add-schema-preview-btn` → 预览 → `add-schema-confirm-btn` → 成功，**完全对齐** `AddSchemaDrawer.tsx:178-220` 的 3 段 stepper 行为）
  - **是** **产品真实架构问题** + **测试基础设施缺口**（被 E2E 准确捕获）
- **复现路径**：
  1. 跑 `bash scripts/init-e2e-fixture.sh` 初始化 fixture
  2. 跑 `cd webui && npx playwright test --grep "@nightly" --project=chromium`
  3. 在 `/connections` 点 `add-schema-mysql-aliyun` → 填 `finance_mart` → 点 `add-schema-preview-btn`（dryRun=200，5ms）→ 点 `add-schema-confirm-btn`（dryRun=false，触发 pre-flight `ktx connection test`，4.6s 后 ECONNREFUSED → 400）
  4. 终端日志可见 `[WebServer] POST /api/connections/mysql-aliyun/schemas ... 400 (4657ms)` 紧跟 `connect ECONNREFUSED 127.0.0.1:3306`
- **建议修复点**（不在本次 PR 范围；由架构 / Backend 决策）：
  1. **临时方案**（保留产品语义）：在 fixture 启动 fake ktx stub（`scripts/fake-ktx-stub.sh`）+ 在 fixture 项目根放 `ktx` shim，使 `ktx connection test mysql-aliyun` 返回 ok / mocked stdout，**不**触及产品代码
  2. **产品方案**（更彻底）：在 `addSchema` 的 pre-flight 加 `skipPreFlight` 选项，文档化为 fixture-only；或在 L3 e2e-impact 阶段按 `process.env.LUCY_E2E_SKIP_PREFLIGHT=1` 跳过；这要求后端确认 pre-flight 是否是契约必须
  3. **CI 方案**：在 `.github/workflows/e2e-nightly.yml` 加 `services: mysql` 启动真实 MySQL（或 docker-compose）

### 影响映射

- **`docs/qa/impact-map.json`** 的 `selectorTestId` 字段仍是 v0.2 老命名（`connection-card-<id>-btn-add-schema` 等），与现行 v0.3 契约不同步。`scripts/e2e-impact.ts` 落地前不会生效；建议下个 PR 同步重写该字段为 v0.3 模板形式。**本次不修**（不在 §3 自动选择链路里）
- 新增 4 个 testid 全部使用现成实现（`add-schema-close` / `add-schema-static-loading-hint` / `add-schema-reload-catalog` / `add-schema-upload-yaml`），**未发明**新 testid
- 模板 testid 全部维持 v0.3：`connection-card-${conn.id}` / `connection-readonly-${conn.id}` / `schema-row-${conn.id}-${schema}` / `add-schema-${conn.id}` 等

### 已知产品 bug（E2E 捕获 · v0.3 已记录 · v0.4 续命中）

- [BUG-I18N-01] 侧栏导航 link 元素未带 `translate="no" notranslate` 防御（v0.4 起新增命中"数据接入"/"启用表范围"/"业务 Wiki"/"语义建模"/"评测用例"/"角色权限"/"数据热力"/"配置审计"等 link）。L1 E2E-I18N-01 当前**已自动通过**（`assertProfessionalTermsProtected` 只检查 token / 路径 / DB 对象，未检查导航 link 元素）。建议下个 PR 把 `assertProfessionalTermsProtected` 扩展为"侧栏 link 文本必须带 `translate="no"`"。
- [BUG-MISSING-01] `add-schema-drawer-step-1..4` / `catalog-row-...` / `overlay-badge-*` / `sl-ref-picker` / `sl-ref-badge-*` / `inspector-tab-*` / `table-editor-grain-input` / `table-editor-metadata-grid` 等 selector 在实现中缺失，E2E-SEM-* / E2E-WIKI-03 / E2E-CON-02 仍用 `getByRole` / `getByText` 兜底。v0.4 新增 `AddSchemaDrawer` 的 `pl-step--active/complete/upcoming` 状态机，但**没有**给 stepper 元素加 `data-testid`，L1 E2E-CON-03 与 stepper 状态机交互未断言。详见 `selector-contract §9 Pending Proposals`。
