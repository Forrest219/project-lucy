# Lucy WebUI E2E 真实浏览器测试套件

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI E2E 真实浏览器测试套件 |
| 文档类型 | QA / E2E / 活文档 |
| 版本 | v0.2 |
| 撰写日期 | 2026-07-31（v0.1 评审回炉 → v0.2 落地版） |
| 落位 | `docs/qa/`（项目正式 spec，与 `inbox/` 临时区分离） |
| 适用范围 | Lucy WebUI 在 `http://127.0.0.1:55176` 下的端到端交互；覆盖 `/connections`、`/connections/whitelist`、`/connections/test`、`/`、`/sources/:conn/:schema/:table`、`/joins/:conn/:schema/:table`、`/wiki`、`/publish/workbench`、`/publish/history`（含旧 `/review` 重定向） |
| 测试层级 | **真实浏览器 E2E**（Playwright Chromium 主跑 / WebKit 回归 / Firefox 次回归），不替代也不允许改写为 Vitest/单元/Mock 断言 |
| 关联规范 | [`webui/docs/00-product-terminology-standard.md`](../webui/docs/00-product-terminology-standard.md)（系统术语事实源）<br>[`webui/docs/06-navigation-ia.md`](../webui/docs/06-navigation-ia.md)（导航 IA）<br>[`webui/docs/21-connection-catalog-upload-ux-spec.md`](../webui/docs/21-connection-catalog-upload-ux-spec.md)（数据接入）<br>[`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`](../webui/docs/25-connection-module-terminology-ia-refresh-spec.md)（连接模块术语 IA）<br>[`webui/docs/12-semantic-layer-maintenance-ux-refresh.md`](../webui/docs/12-semantic-layer-maintenance-ux-refresh.md)（语义建模）<br>[`webui/docs/35-semantic-publish-workbench-ia-spec.md`](../webui/docs/35-semantic-publish-workbench-ia-spec.md)（语义发布）<br>[`webui/docs/36-business-wiki-read-edit-workbench-spec.md`](../webui/docs/36-business-wiki-read-edit-workbench-spec.md)（业务 Wiki 工作台）<br>[`webui/docs/23-semantic-asset-publish-export-spec.md`](../webui/docs/23-semantic-asset-publish-export-spec.md)（语义资产发布与导出）<br>[`webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`](../webui/docs/37-sidebar-navigation-ia-consolidation-spec.md)（侧栏导航 IA 收敛 · v0.4）<br>[`docs/DEVELOPMENT.md`](../DEVELOPMENT.md) |
| 维护约定 | 任何 UI 改名 / 新增页面 / 新增按钮 / 新增 API 行为必须 ① 更新 §5 Selector 契约表 ② 触发 §7 变更影响映射重算 ③ 追加 / 修改对应 E2E 用例；不更新即不通过 review |

---

## 0. Terminology Compliance

本套件是 `webui/docs/00-product-terminology-standard.md` 的运行时守门人，所有用例断言的 UI 文案必须与该标准一致。套件本身不新增产品概念。

**New terms**：

- `Selector 契约表`（§5）：组件 `data-testid` / `aria-label` / 角色名的唯一事实源。新增 selector 必须先在本表登记。
- `变更影响映射`（§7）：组件 / 路由 / API 改动 → 受影响 E2E 用例的反向查询表。维护自动化，不靠人脑。
- `Fixture Project`（§8）：E2E 写入操作的专属项目副本。真实项目仓库只读，E2E 永不污染 tracked 状态。

**Forbidden terms 必须在所有用例断言中 0 命中**（与系统级 forbidden 列表合并）：

```text
财政部舱单 / 舱单
替代测试
上传报价包 / 报价包
添加架构 / 目标架构
模式清单
重新加载资产 / 重新加载 catalog
触发 ingest
审阅与校验（导航 / 标题）
变更审阅（导航）
待发布变更（**仅导航**；作为发布工作台 section 标题允许，见 35-spec §6.3）
索引生效（导航）
资产包（导航）
Reindex 历史（导航）
发布并 reindex（按钮）
Validate changed（按钮）
Read-only expected（用户可见）
Write-risk（用户可见）
维基文档（导航）
```

**Browser translation defense**（在 §6 由结构化扫描自动断言，**不依赖** Chrome Auto-translate 插件行为）：

- `Schema` `Manifest` `Reindex` `YAML` `Wiki` `Diff` `Raw` `SlRef` `Overlay` `Endpoint` `KTX` `MCP` `Agent`
- 文件后缀 `.yaml` `.yml` `.md` `.zip`
- URL `http://127.0.0.1:55176` `http://127.0.0.1:7879/mcp`
- 文件路径 `semantic-layer/...` `wiki/...` `ktx.yaml` `.ktx-ui/...`
- DB 对象名 `mysql-aliyun` `dataforai` `openclaw_db` `superstore_orders` `finance_mart`

---

## 1. 目的与原则

为 Lucy WebUI 建立**真实浏览器**端到端回归网，按以下原则运作：

1. **强制黑盒**：用例描述用户视角的点击 / 输入 / 跳转 / Toast / 状态变化，不允许 `expect(component.props)` 一类白盒断言。
2. **强制术语**：每个用例的按钮、表头、Badge、Toast 文案必须与 `webui/docs/00-product-terminology-standard.md` 严格一致；用例本身要显式断言 forbidden terms 0 命中。
3. **强制结构化翻译防御**：所有专业英文 / 路径 / DB 对象 / URL 的 DOM 节点必须带 `translate="no"` + `className` 包含 `notranslate`；**由 Playwright 结构扫描断言**，不再依赖浏览器 Auto-translate 行为。
4. **强制业务闭环**：覆盖"数据接入 → 语义建模 → 业务 Wiki 关联 → 语义发布 Reindex"完整主链路（v0.4 IA 收敛后改写）。
5. **强制真实仓库只读**：E2E 写入操作统一在 `/tmp/lucy-e2e-fixture` 副本上进行；真实项目仓库（`/Users/zhangxingchen/Projects/project-lucy`）E2E 全程只读。
6. **强制准入分层**：4 层用例矩阵，避免把所有 P0 都堆到每个 PR。
7. **强制 selector 契约**：所有断言必须落在 §5 表中登记的 `data-testid` / `aria-label` / 角色名上；实现侧擅自改名即回归失败。

---

## 2. 工程入口（活文档的"脚手架"）

### 2.1 目录结构

```text
docs/qa/lucy-webui-e2e-test-suite.md   ← 本文件（活文档）
docs/qa/selector-contract.md           ← §5 选择器契约表（独立文件，便于代码引用）
docs/qa/changelog.md                   ← §12 用例变更日志（独立文件，PR 必更新）
docs/qa/impact-map.json                ← §7 变更影响映射（机器可读，CI 校验）

webui/
├── tests/e2e/
│   ├── playwright.config.ts           ← Playwright 入口
│   ├── fixtures/
│   │   ├── fixture-project/           ← 拷贝自真实仓库，被 E2E 写入
│   │   ├── data/                      ← finance_mart.yaml 等 fixture
│   │   └── helpers/
│   │       ├── terminology.ts         ← forbidden 列表 + 翻译防御扫描
│   │       ├── reset.ts               ← Fixture Project 还原
│   │       └── trace.ts               ← 截图 / trace 落盘
│   ├── specs/
│   │   ├── e2e-pub-01.spec.ts
│   │   ├── e2e-pub-02.spec.ts
│   │   ├── ...
│   └── tags/
│       ├── pr-smoke.tag.ts            ← L1 准入标记
│       ├── pr-impacted.tag.ts         ← L2 准入标记
│       ├── nightly.tag.ts             ← L3 准入标记
│       └── release.tag.ts             ← L4 准入标记
```

### 2.2 `webui/package.json` 新增脚本

```jsonc
{
  "scripts": {
    // ... 已有
    "e2e:install": "playwright install --with-deps chromium webkit firefox",
    "e2e:fixture": "bash ../scripts/init-e2e-fixture.sh",
    "e2e:smoke": "playwright test --grep @pr-smoke --project=chromium",
    "pree2e:smoke": "npm run e2e:selector-contract && npm run e2e:fixture",
    "e2e:impacted": "playwright test --grep '@pr-smoke|@pr-impacted' --project=chromium",
    "pree2e:impacted": "npm run e2e:selector-contract && npm run e2e:fixture",
    "e2e:nightly": "playwright test --grep '@pr-smoke|@pr-impacted|@nightly'",
    "pree2e:nightly": "npm run e2e:selector-contract && npm run e2e:fixture",
    "e2e:release": "playwright test",
    "pree2e:release": "npm run e2e:selector-contract && npm run e2e:fixture",
    "e2e:report": "playwright show-report playwright-report",
    "e2e:selector-contract": "node scripts/check-selector-contract.mjs"  // CI 守门
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1"
  }
}
```

### 2.3 `webui/tests/e2e/playwright.config.ts` 关键设置

```ts
export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["json", { outputFile: "results.json" }],
  ],
  use: {
    baseURL: process.env.LUCY_E2E_BASE_URL ?? "http://127.0.0.1:55176",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-narrow", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:55176",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // 让 WebUI / KTX 指向 Fixture Project 副本，绝不污染真实仓库
      LUCY_PROJECT_DIR: process.env.LUCY_E2E_PROJECT_DIR ?? "/tmp/lucy-e2e-fixture",
    },
  },
});
```

### 2.4 CI 接入

| 阶段 | 命令 | 触发 | 阻塞合并？ |
|---|---|---|---|
| Lint | `npm run lint:terminology && npm run lint:ia-boundary && npm run e2e:selector-contract` | 每个 PR | 是 |
| Smoke | `npm run e2e:smoke` | 每个 PR | 是 |
| Impacted | `npm run e2e:impacted` | 每个 PR | 是（命中变更点时） |
| Nightly | `npm run e2e:nightly` | 每天 02:00 | 否，仅告警 |
| Release | `npm run e2e:release` | release tag 推送 | 是 |

`e2e:selector-contract` 守门：扫描 `webui/src/**` 中新增 / 改名的 `data-testid` 属性，若未在 `docs/qa/selector-contract.md` 登记，则 PR fail。

---

## 3. 准入分层（不再把所有 P0 堆到 PR）

| 层级 | 范围 | 用例数（目标） | 触发 | 失败动作 |
|---|---|---|---|---|
| **L1 PR Smoke** | 关键路径不回归、关键术语不出现回归 | 8 | 每个 PR 必跑 | 阻塞合并 |
| **L2 PR Impacted** | 由 §7 变更影响映射自动选择 | 0–16 / PR | 命中组件 / 路由 / API 时自动加入 | 阻塞合并 |
| **L3 Nightly Full** | 全部 P0 + P1 | ≈ 30 | 每日定时 | 失败告警，issue 自动创建 |
| **L4 Release Full** | 全部 P0 + P1 + P2 + 3 浏览器 | ≈ 35 × 3 | release tag | 阻塞 release |

L1 PR Smoke 8 条（与 §10 用例矩阵对齐）：

1. `E2E-PUB-02` `/review` 重定向
2. `E2E-CON-01` 连接卡片术语与 Header 治理
3. `E2E-CON-03` 受控 YAML 上传
4. `E2E-WIKI-01` Wiki 阅读态默认
5. `E2E-NAV-01` 导航 `语义发布` 2 个二级
6. `E2E-NAV-02` 面包屑展示
7. `E2E-SEC-01` 上传路径越权拦截
8. `E2E-I18N-01` 关键页 forbidden terms 0 命中

> **纠正 v0.1 自相矛盾**：v0.1 §6"约 8 个"与下方 16 个 P0 同时出现，v0.2 明确以本节 L1=8 为 PR 阻塞基线；其余 P0 在 L2 / L3 中跑。

---

## 4. 浏览器 / 视口 / 工具

| 维度 | 约定 |
|---|---|
| 框架 | Playwright 1.45+（TypeScript） |
| 浏览器矩阵 | Chromium（默认主跑）、WebKit（回归）、Firefox（次回归） |
| 视口 | `chromium` 默认 1440×900；`chromium-narrow` 1280×800（响应式 L3 跑） |
| 定位优先级 | 1) `getByTestId('<contract-id>')` 2) `getByRole` 3) `getByLabel` 4) `getByText`（仅 fallback） |
| Test ID 规范 | 见 §5 Selector 契约表 |
| 等待策略 | `await expect(locator).toBeVisible({ timeout: 10_000 })`；禁止 `waitForTimeout` |
| 截图 | 关键状态截图 → `webui/tests/e2e/artifacts/<runId>/<caseId>/<step>.png` |
| Trace | 失败时自动开启；归档 `webui/tests/e2e/traces/` |
| 时区 | `Asia/Shanghai`；DB 写 UTC，UI 本地化 |
| 翻译断言 | **不依赖** Chrome Auto-translate（见 §6） |

---

## 5. Selector 契约表（事实源）

> 本表是 `data-testid` / 角色名 / `aria-label` 的唯一事实源，由 [`docs/qa/selector-contract.md`](selector-contract.md) 维护完整版本。CI 通过 `scripts/check-selector-contract.mjs` 扫 `webui/src/**` 中出现但未登记的 testid → fail PR。

### 5.1 工作台与发布（src/pages/publish/）

| Test ID / 角色 | 元素 | 出现位置 | 关键文案约束 |
|---|---|---|---|
| `workbench-pending-count` | Header Badge "N 个待发布文件" | PublishWorkbench | 文案精确匹配 `数字 个待发布文件`，`translate="no"` |
| `workbench-validate` | 按钮 `校验变更` | PublishWorkbench | 禁止 `Validate changed` |
| `workbench-reindex` | 按钮 `强制重建索引` | PublishWorkbench | 禁止 `索引生效` / `重建 KTX 索引` |
| `workbench-upload-semantic-asset` | 按钮 `上传语义资产` | PublishWorkbench | 禁止 `上传 YAML` |
| **`workbench-publish-and-reindex`** | **主按钮 `发布并重建索引`** | PublishWorkbench | **禁止 `发布并 reindex` / `发布并索引`** |
| `workbench-empty-state` | 空态提示 | PublishWorkbench | 必含 `暂无待发布变更` |
| `workbench-reindex-result` | reindex 成功结果 | PublishWorkbench | 必含 `退出码 0` 或对应码 |
| `workbench-reindex-error` | reindex 失败 | PublishWorkbench | 必含 `stdout` `stderr` |
| `publish-workbench-layout` | 整体布局 | PublishWorkbench | 桌面双列、窄屏单列 |
| `review-boundary-checklist` | 边界说明卡 | PublishWorkbench | — |

> **纠正 v0.1 错误**：v0.1 §断言矩阵第 215 行误写 `publish-workbench-cta-publish`，实际代码是 `workbench-publish-and-reindex`（PublishWorkbench.tsx:193）。所有用例统一以本表为准。

### 5.2 数据接入（src/pages/connections/）

| Test ID / 角色 | 元素 | 出现位置 | 关键文案约束 |
|---|---|---|---|
| `connection-card-${conn.id}` | 连接卡片根节点 | ConnectionOverview | — |
| `connection-readonly-${conn.id}` | `预期只读` 低权重提醒 | ConnectionOverview | 禁止 `Read-only expected` 露出 |
| `connection-kv-${conn.id}` | 连接属性 KeyValue 网格 | ConnectionOverview | 必含 `Host / Database`；不得逐卡出现 `配置文件 / 凭据来源` |
| `connection-refresh-warning-${conn.id}` | 未刷新 Warning Banner | ConnectionOverview | 必含 `本地目录未刷新：尚未读取本地 YAML 资产配置。` |
| `connection-refresh-warning-action-${conn.id}` | Banner `立即刷新` 按钮 | ConnectionOverview | 禁止 `↗` / `→` |
| `connection-last-reload-${conn.id}` | Header 右侧上次刷新时间 | ConnectionOverview | 仅展示 `上次刷新：<timestamp>`，不得展示表数/提示数摘要 |
| `catalog-reload-status-${conn.id}` | Catalog 刷新加载/失败状态 | ConnectionOverview | 仅用于 pending / error / 最近失败状态；健康成功态不出现 |
| `schema-row-${conn.id}-${schema}` | Schema 表行 | ConnectionOverview | 状态 `已存在` / `缺失 Manifest` / `Manifest 解析失败` |
| `schema-enabled-count-${conn.id}-${schema}` | Schema 启用表数 cell | ConnectionOverview | 数值来自该 Schema 下 `enabled_tables` 计数 |
| `schema-whitelist-${conn.id}-${schema}` | Schema 行内启用范围动作 | ConnectionOverview | 必含 `维护启用范围`；禁止 `维护白名单` |
| `add-schema-${conn.id}` | `+ 添加 Schema` 按钮 | ConnectionOverview | 禁止 `添加架构` / `添加模式` |
| `catalog-reload-${conn.id}` | `刷新本地目录` 按钮 | ConnectionOverview | 禁止 `重新加载资产` / `触发 ingest` |
| `add-schema-drawer-step-<1..4>` | AddSchemaDrawer 4 段 stepper | AddSchemaDrawer | 4 段必填 |
| `catalog-upload-input` | YAML 上传 Drawer input | CatalogAssetUploadDrawer | 接受 `.yaml`/`.yml` |
| `catalog-upload-filename` | 文件名回显 | CatalogAssetUploadDrawer | 落 `originalFilename` |
| `catalog-upload-confirm-overwrite` | 覆盖确认 checkbox | CatalogAssetUploadDrawer | — |

### 5.3 业务 Wiki（src/components/）

| Test ID / 角色 | 元素 | 出现位置 | 关键文案约束 |
|---|---|---|---|
| `wiki-tree` | 左侧目录树根 | WikiTree | 节点主标签 = 标题，副标签 = 路径 |
| `wiki-tree-node-<key>` | 目录树节点 | WikiTree | `aria-label` 优先含标题 |
| `wiki-mode-read` | 阅读态根容器 | WikiReadView | — |
| `wiki-mode-edit` | 编辑态根容器 | WikiEditView | 必含 `textarea` |
| `wiki-edit-textarea` | Markdown 文本框 | WikiEditView | 占主工作区 ≥ 80% |
| `wiki-meta-toggle` | 折叠 `文档信息` | WikiEditView | 默认折叠 |
| `wiki-save-preflight-drawer` | 保存预检 Drawer | WikiSavePreflight | 必含 `目标` `校验` `Diff` |
| `wiki-edit-status-badge` | 状态徽标 | WikiEditView | `未保存` / `已保存` / `预检失败` |
| `sl-ref-badge-<conn>-<schema>-<table>` | 关联语义对象 Badge | WikiReadView / WikiEditView | `data-status="known"`/`"unknown"` |

### 5.4 语义建模（src/pages/Catalog.tsx / TableEditor.tsx）

| Test ID / 角色 | 元素 | 出现位置 | 关键文案约束 |
|---|---|---|---|
| `catalog-row-<conn>-<schema>-<table>` | 表目录行 | Catalog | — |
| `catalog-row-btn-maintain` | `维护语义` 行按钮 | Catalog | 禁止 `查看详情` |
| `overlay-badge-grain` | 行粒度 Overlay Badge | TableEditor | Tooltip 解析 overlay 路径 |
| `overlay-badge-measures` | 指标 Overlay Badge | TableEditor | — |
| `overlay-badge-segments` | 分群 Overlay Badge | TableEditor | — |
| `candidate-join-banner` | 候选 Join banner | TableEditor | — |
| `candidate-join-action-confirm` | `确认写入语义层` | TableEditor | — |
| `candidate-join-action-keep` | `保留为候选` | TableEditor | — |
| `candidate-join-action-reject` | `标记不采用` | TableEditor | — |
| `inspector-tab-diff` | Diff Tab | TableEditor | — |
| `inspector-tab-yaml` | YAML Tab | TableEditor | — |
| `inspector-tab-validate` | Validate Tab | TableEditor | 状态 Badge `通过` / `失败` |

### 5.5 通用

| Test ID / 角色 | 元素 | 出现位置 |
|---|---|---|
| `breadcrumb` | 面包屑根 | 全局 |
| `sidebar-nav-group-<name>` | 一级导航组 | 全局 |
| `sidebar-nav-item-<id>` | 二级导航项 | 全局 |
| `toast` | Toast（sonner） | 全局（`getByText` 精确匹配文案） |
| `aria-current="location"` | 当前页链接 | 全局导航高亮 |

---

## 6. 翻译防御（结构化扫描，**不依赖** Auto-translate）

> **纠正 v0.1 不稳定做法**：v0.1 §2.3 写"默认开启 Chrome Auto-translate"，Playwright 对浏览器内置翻译控制不稳定（且 WebKit / Firefox 没有等价能力），无法作为自动化主断言。v0.2 改为结构扫描 + 原文 forbidden terms 双重断言；真实翻译冒烟作为 L3 Nightly 的 Chromium-only 专项，由人工 / 录制定期执行。

### 6.1 自动化主断言（所有用例必带）

```ts
// webui/tests/e2e/fixtures/helpers/terminology.ts
export const FORBIDDEN_TERMS = [
  // 与 §0 forbidden 列表完全一致；变更时同步更新本文件与本表
  "财政部舱单", "舱单", "替代测试", "上传报价包", "报价包",
  "添加架构", "目标架构", "模式清单",
  "重新加载资产", "重新加载 catalog", "触发 ingest",
  "审阅与校验", "变更审阅", "索引生效", "资产包",
  "Reindex 历史", "发布并 reindex", "Validate changed",
  "Read-only expected", "Write-risk", "维基文档",
];

export const PROFESSIONAL_TOKEN_REGEX = /(Schema|Manifest|Reindex|YAML|Wiki|Diff|Raw|SlRef|Overlay|Endpoint|KTX|MCP|Agent)/;
export const PROFESSIONAL_PATH_REGEX = /(\.ya?ml|\.md|\.zip|semantic-layer\/|wiki\/|ktx\.yaml|\.ktx-ui\/|http:\/\/127\.0\.0\.1)/;
export const DB_OBJECT_REGEX = /(mysql-aliyun|dataforai|openclaw_db|superstore_orders|finance_mart)/;

export async function assertNoForbiddenTerms(page: Page) {
  const content = await page.content();
  for (const term of FORBIDDEN_TERMS) {
    if (content.includes(term)) {
      throw new Error(`Forbidden term "${term}" found in page content`);
    }
  }
}

export async function assertProfessionalTermsProtected(page: Page) {
  // 对每个匹配专业 token / 路径 / DB 对象的可见节点，断言其或其祖先带 translate="no" + notranslate
  const violations = await page.evaluate(([tokenRe, pathRe, dbRe]: string[]) => {
    const tokenReObj = new RegExp(tokenRe);
    const pathReObj = new RegExp(pathRe);
    const dbReObj = new RegExp(dbRe);
    const out: Array<{ text: string; tag: string }> = [];
    const all = Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0);
    for (const el of all) {
      const text = (el.textContent ?? "").trim();
      if (
        tokenReObj.test(text) || pathReObj.test(text) || dbReObj.test(text)
      ) {
        const protectedEl = el.closest('[translate="no"]');
        if (!protectedEl || !protectedEl.className.includes("notranslate")) {
          out.push({ text, tag: el.tagName });
        }
      }
    }
    return out;
  }, [PROFESSIONAL_TOKEN_REGEX.source, PROFESSIONAL_PATH_REGEX.source, DB_OBJECT_REGEX.source]);
  if (violations.length > 0) {
    throw new Error(`Unprotected professional terms: ${JSON.stringify(violations.slice(0, 5))}`);
  }
}
```

### 6.2 L3 Nightly 专项（人工 / 录制）

| 专项 | 浏览器 | 频率 | 失败处理 |
|---|---|---|---|
| Chrome Auto-translate 开启后截图比对 | Chromium | 每晚 02:30 | 人工 review；与结构扫描结果交叉 |
| WebKit 翻译引擎（若未来支持） | WebKit | 待 WebKit API 稳定 | — |
| 真实语言切换（en / zh）截图归档 | Chromium | 每周 | 视觉回归 |

---

## 7. 变更影响映射（机器可读，CI 校验）

> **核心思路**：让 E2E 用例集合随产品代码变更**自动**收敛，而不是依赖人脑判断"这次改了什么，要跑哪些用例"。

### 7.1 维护方式

`docs/qa/impact-map.json` 维护三类映射：

```jsonc
{
  "route": {
    "/publish/workbench":  ["E2E-PUB-02", "E2E-PUB-03", "E2E-PUB-04", "E2E-PUB-05", "E2E-PUB-07"],
    "/publish/history":    ["E2E-PUB-06", "E2E-PUB-07"],
    "/connections":        ["E2E-CON-01", "E2E-CON-02", "E2E-CON-03", "E2E-CON-04", "E2E-CON-05", "E2E-CON-06"],
    "/connections/whitelist": ["E2E-WHL-01", "E2E-WHL-02"],
    "/wiki":               ["E2E-WIKI-01", "E2E-WIKI-02", "E2E-WIKI-03", "E2E-WIKI-04", "E2E-WIKI-05"],
    "/sources/:conn/:schema/:table": ["E2E-SEM-01", "E2E-SEM-02", "E2E-SEM-03", "E2E-SEM-04"]
  },
  "component": {
    "AddSchemaDrawer":       ["E2E-CON-02"],
    "CatalogAssetUploadDrawer": ["E2E-CON-03", "E2E-CON-04", "E2E-SEC-01"],
    "CatalogReloadButton":   ["E2E-CON-05"],
    "WikiTree":              ["E2E-WIKI-01", "E2E-WIKI-05"],
    "WikiReadView":          ["E2E-WIKI-01", "E2E-WIKI-03"],
    "WikiEditView":          ["E2E-WIKI-02", "E2E-WIKI-04"],
    "WikiSavePreflight":     ["E2E-WIKI-04"],
    "SlRefPicker":           ["E2E-WIKI-03"],
    "PublishWorkbench":      ["E2E-PUB-01", "E2E-PUB-03", "E2E-PUB-04", "E2E-PUB-05", "E2E-PUB-07"],
    "PublishHistory":        ["E2E-PUB-06"],
    "SemanticAssetPublishDrawer": ["E2E-PUB-01", "E2E-PUB-04"],
    "TableEditor":           ["E2E-SEM-01", "E2E-SEM-02", "E2E-SEM-03", "E2E-SEM-04"]
  },
  "api": {
    "POST /api/catalog/assets/upload":   ["E2E-CON-03", "E2E-CON-04", "E2E-SEC-01"],
    "POST /api/catalog/reload":          ["E2E-CON-05"],
    "PUT /api/sources/:conn/:schema/:table": ["E2E-SEM-01", "E2E-SEM-02", "E2E-SEM-03"],
    "POST /api/validate-changed":         ["E2E-PUB-04"],
    "POST /api/semantic-assets/publish": ["E2E-PUB-01", "E2E-PUB-04"],
    "POST /api/semantic-assets/reindex": ["E2E-PUB-05"],
    "GET /api/semantic-assets/releases": ["E2E-PUB-06"],
    "GET /api/semantic-assets/releases/:id/status": ["E2E-PUB-04", "E2E-PUB-06"],
    "POST /api/semantic-assets/export":  ["E2E-PUB-07", "E2E-SEC-02"],
    "PUT /api/wiki/:key":                ["E2E-WIKI-04"]
  }
}
```

### 7.2 CI 集成（`scripts/e2e-impact.ts`）

```ts
// 伪代码：git diff → 影响映射 → 自动加入 L2 准入
const diff = await getGitDiff(base, head); // 列出改动文件
const impacted = new Set<string>();
for (const file of diff.files) {
  if (file.path.startsWith("webui/src/pages/publish/")) impacted.add(...map.component["PublishWorkbench"]);
  // ... 同样的规则覆盖所有组件 / 路由 / API
}
const tagged = [...impacted].map((id) => `@pr-impacted&${id}`).join("|");
await runPlaywright(`--grep "${tagged}"`);
```

任何 E2E 用例文件改动 → 自动加入 L2。

---

## 8. Fixture Project 规范（真实仓库只读）

### 8.1 解决 v0.1 风险

v0.1 §测试数据 / 夹具约定打算 `git stash` / `cp` 还原 tracked 文件，会踩用户未提交改动、误删内容、与并发 PR 冲突。v0.2 改为**专用 fixture project 副本**：

| 维度 | 方案 |
|---|---|
| 路径 | `/tmp/lucy-e2e-fixture`（CI 用专用 runner 磁盘，本地用 `mktemp -d`） |
| 初始化 | `git clone --depth 1 file:///Users/zhangxingchen/Projects/project-lucy /tmp/lucy-e2e-fixture` |
| 写权限 | 唯一可写入口；WebUI / KTX 通过环境变量 `LUCY_PROJECT_DIR` 指向它 |
| 测试间隔离 | 每个 case `beforeEach` 重置到 init 状态（见 §8.3） |
| 真实仓库 | **E2E 全程只读**；任何试图写入真实仓库路径的代码视为 bug |
| 凭据 | 复制 `.ktx/secrets/*.example` 填充（`mysql-aliyun-password` 用 `test-fixture`），不读取真实凭据 |
| 删除 | `rm -rf /tmp/lucy-e2e-fixture`，CI 自动清理 |

### 8.2 初始化脚本

```bash
#!/usr/bin/env bash
# scripts/init-e2e-fixture.sh
set -euo pipefail
DEST="${1:-/tmp/lucy-e2e-fixture}"
SRC="${2:-/Users/zhangxingchen/Projects/project-lucy}"

rm -rf "$DEST"
git clone --depth 1 "file://$SRC" "$DEST"
# 注入 fixture 凭据（占位，绝不读真实）
echo "test-fixture" > "$DEST/.ktx/secrets/mysql-aliyun-password"
chmod 600 "$DEST/.ktx/secrets/mysql-aliyun-password"
# 用 fixture 替换 ktx.yaml / semantic-layer / wiki
FIXTURE_DIR="$SRC/webui/tests/e2e/fixtures/data"
cp "$FIXTURE_DIR/ktx-fixture.yaml" "$DEST/ktx.yaml"
cp -R "$FIXTURE_DIR/semantic-layer-fixture/." "$DEST/semantic-layer/"
cp -R "$FIXTURE_DIR/wiki-fixture/." "$DEST/wiki/"
if command -v ktx >/dev/null 2>&1 && ktx help catalog >/dev/null 2>&1; then
  (cd "$DEST" && ktx catalog reload 2>&1 || true)
else
  echo "[init] ktx catalog reload unavailable; skipped"
fi
echo "Fixture ready at $DEST"
```

### 8.3 测试间重置

```ts
// webui/tests/e2e/fixtures/helpers/reset.ts
export async function resetFixture() {
  // 调后端 fixture-reset 接口（专用，仅 E2E 开启）；或重跑 init 脚本
  await fetch(`${process.env.LUCY_E2E_BACKEND_URL}/api/test/reset-fixture`, { method: "POST" });
}
```

`beforeEach` 自动调用；任何 case 异常退出由 `afterAll` 强制重置，保证下一轮干净。

### 8.4 安全边界

- `LUCY_PROJECT_DIR` 在 E2E 进程内是常量；任何代码试图解析或写入 `${LUCY_PROJECT_DIR}/../` 即 fail。
- `E2E-SEC-01` 越权用例在 fixture project 内运行，不影响真实仓库。
- `E2E-SEC-02` 导出快照时检查 zip 不含 `.ktx/secrets/`、`.env` 等，仍按 §11 用例执行。

---

## 9. 用例编号体系

```text
E2E-<模块>-<序号>[-<变体>]
模块缩写：
  CON  = Connections / 数据接入
  WHL  = Connections/Whitelist / 启用表范围（原"表白名单"，v0.4 起主导航禁用）
  SEM  = Sources / 语义建模（表目录 + 表详情）
  WIKI = Business Wiki / 业务 Wiki（v0.4 起从独立"业务文档"组并入"语义建模"组）
  PUB  = Semantic Publish / 语义发布（工作台 + 记录）
  NAV  = 全局导航 / 面包屑 / 跨路由
  I18N = 术语 / 翻译防御
  A11Y = 可访问性 / 快捷键
  RES  = 响应式 / 窄屏
  SEC  = 安全 / 凭据 / 越权路径
```

每条用例固定六字段：`用例 ID 与名称` / `优先级 / 准入层` / `前置条件` / `浏览器操作步骤` / `预期 UI 视觉与交互响应` / `断言与侧面验证`。

---

## 10. 用例矩阵

| ID | 名称 | 优先级 | 准入层 | 涉及阶段 |
|---|---|---|---|---|
| **E2E-PUB-01** | 完整语义资产从新建到发布 Reindex 闭环 | P0 | L3 | CON → SEM → WIKI → PUB |
| E2E-PUB-02 | 旧路由 `/review` 自动重定向 | P0 | L1 | PUB |
| E2E-CON-01 | 连接概览 Header 与连接卡片企业级展示 | P0 | L1 | CON |
| E2E-CON-02 | 添加 Schema 抽屉 4 段流程 | P0 | L2 | CON |
| E2E-CON-03 | 受控 YAML Manifest 上传（拖拽 + 粘贴） | P0 | L1 | CON |
| E2E-CON-04 | 目标文件已存在时的覆盖确认 | P0 | L2 | CON |
| E2E-CON-05 | `刷新本地目录` 不会连接数据库 | P0 | L2 | CON |
| E2E-CON-06 | 凭据类型 `inline` 风险提示 | P1 | L3 | CON |
| E2E-WHL-01 | 启用表范围 query param 预选 Schema（原"表白名单 query param"） | P0 | L2 | WHL |
| E2E-WHL-02 | 缺失 Manifest 行的跳转 | P0 | L2 | WHL |
| E2E-SEM-01 | 表目录 → 表详情（单表编辑） | P0 | L2 | SEM |
| E2E-SEM-02 | Overlay Badge 与 Tooltip | P0 | L2 | SEM |
| E2E-SEM-03 | 候选关联关系 banner 三动作 | P1 | L3 | SEM |
| E2E-SEM-04 | `Cmd/Ctrl + S` 触发 Dry-run | P1 | L3 | SEM |
| E2E-WIKI-01 | 阅读态默认进入 + Tree View 标题优先 | P0 | L1 | WIKI |
| E2E-WIKI-02 | 编辑态进入与 80% 主工作区 | P0 | L2 | WIKI |
| E2E-WIKI-03 | 关联 `sl_ref` Badge 双向跳转 | P0 | L1 | WIKI |
| E2E-WIKI-04 | 保存预检 Drawer 行为 | P0 | L2 | WIKI |
| E2E-WIKI-05 | 空草稿模板与 YAML 边界说明 | P1 | L3 | WIKI |
| E2E-PUB-03 | 工作台零待发布文件时空态 | P0 | L2 | PUB |
| E2E-PUB-04 | 校验变更全部通过 → `发布并重建索引` 可用 | P0 | L1 | PUB |
| E2E-PUB-05 | `强制重建索引` 终端输出回显 | P0 | L2 | PUB |
| E2E-PUB-06 | 发布记录表格列与状态 | P0 | L2 | PUB |
| E2E-PUB-07 | `导出当前快照 (.zip)` 辅助动作 | P1 | L3 | PUB |
| E2E-NAV-01 | 一级菜单 `语义发布` + 2 个二级 | P0 | L1 | NAV |
| E2E-NAV-02 | 面包屑全场景 | P0 | L2 | NAV |
| E2E-NAV-03 | 跨模块跳转完整链路 | P1 | L3 | NAV |
| E2E-I18N-01 | 关键页 Forbidden Terms 0 命中 | P0 | L1 | I18N |
| E2E-I18N-02 | 专业术语 / 路径 / DB 对象 `translate="no"` 防御 | P0 | L1 | I18N |
| E2E-A11Y-01 | 阅读 / 编辑切换按钮可访问名 | P1 | L3 | A11Y |
| E2E-A11Y-02 | Drawer / Modal 焦点陷阱与 Esc 关闭 | P1 | L3 | A11Y |
| E2E-RES-01 | 1280×800 窄屏工作台不溢出 | P1 | L3 | RES |
| E2E-RES-02 | 1280×800 Wiki 阅读态纵向堆叠 | P1 | L3 | RES |
| E2E-SEC-01 | 上传时前端无法写任意路径 | P0 | L1 | SEC |
| E2E-SEC-02 | `inline` 凭据不被 `导出当前快照` 包含 | P0 | L2 | SEC |

**L1 PR Smoke 8 条**（按矩阵中 `准入层=L1` 行筛选）：E2E-PUB-02 / E2E-CON-01 / E2E-CON-03 / E2E-WIKI-01 / E2E-WIKI-03 / E2E-PUB-04 / E2E-NAV-01 / E2E-SEC-01。

---

## 11. 详细用例

> 详细用例格式：每条保持 6 字段，关键断言直接引用 §5 Selector 契约表与 §6 翻译防御 helper。完整源码在 `webui/tests/e2e/specs/<id>.spec.ts`，本文件用紧凑版表达意图。

### 11.1 主链路 `E2E-PUB-01`

**用例 ID 与名称**：`E2E-PUB-01 / 完整语义资产从新建到发布 Reindex 闭环`
**优先级 / 准入层**：P0 / L3 Nightly
**涉及 Selector**：`workbench-pending-count` / `workbench-validate` / `workbench-reindex` / `workbench-upload-semantic-asset` / `workbench-publish-and-reindex` / `workbench-reindex-result` / `add-schema-mysql-aliyun` / `add-schema-drawer-step-1..4` / `catalog-upload-input` / `wiki-tree` / `wiki-mode-read` / `sl-ref-badge-mysql-aliyun-dataforai-superstore_orders` / `wiki-save-preflight-drawer` / `breadcrumb`

**前置条件**：
- Fixture Project `/tmp/lucy-e2e-fixture` 已由 `scripts/init-e2e-fixture.sh` 初始化
- WebUI 进程 `LUCY_PROJECT_DIR=/tmp/lucy-e2e-fixture` 启动
- 当前 `ktx.yaml` 中 `mysql-aliyun.schemas` 不含 `finance_mart`
- `wiki/finance-playbook.md` 不存在
- 浏览器 Cookie / LocalStorage 已清空

**浏览器操作步骤**（压缩版，完整步骤见 `specs/e2e-pub-01.spec.ts`）：

1. 导航 `/connections` → 断言 `breadcrumb` = `数据接入 / 连接概览`（v0.4 起；原 `数据库接入 / 连接概览` 已弃用）。
2. `add-schema-mysql-aliyun` → 输入 `finance_mart` → `add-schema-drawer-step-2` 测试连接 → `add-schema-drawer-step-3` 写入 `ktx.yaml` → `add-schema-drawer-step-4` 引导上传 Manifest。
3. Schema 行 `schema-row-mysql-aliyun-finance_mart` 出现，状态 `缺失 Manifest`。
4. 行内 `上传 Manifest` 打开 `CatalogAssetUploadDrawer` → 粘贴 `fixtures/manifests/finance_mart.yaml` → `catalog-upload-input` → `校验` → `上传`。
5. Toast `已上传 finance_mart.yaml`，Schema 行状态变 `已存在`。
6. 导航 `/` → Schema 筛选 `finance_mart` → 行 `catalog-row-mysql-aliyun-finance_mart-fact_revenue` `catalog-row-btn-maintain`。
7. `/sources/mysql-aliyun/finance_mart/fact_revenue` → `overlay-badge-grain` 鼠标悬停，Tooltip 解析 `semantic-layer/mysql-aliyun/fact_revenue.yaml`。
8. 行粒度填 `[order_id, line_id]`；指标追加 `gross_profit: sum(profit)`；`保存`。
9. `inspector-tab-validate` Badge `通过`。
10. 导航 `/wiki` → `+ 新建 Wiki` → 模板 `指标口径` → 标题 `Finance Mart 利润分析`。
11. 关联 `sl-ref-picker` 选 `mysql-aliyun/finance_mart/fact_revenue` → `sl-ref-badge-mysql-aliyun-finance_mart-fact_revenue` 出现。
12. `保存预检` → `wiki-save-preflight-drawer` 显示 `目标 wiki/finance-playbook.md` + Diff + 校验 → `保存`。
13. 阅读态 `wiki-mode-read` → 点 Badge → URL 跳 `/sources/mysql-aliyun/finance_mart/fact_revenue`。
14. 表详情 `相关业务 Wiki` 区域列出 `Finance Mart 利润分析`。
15. 导航 `/publish/workbench` → `workbench-pending-count` Badge `3 个待发布文件`。
16. `workbench-validate` → 3 行全 `通过` → `workbench-publish-and-reindex` 变 highlighted enabled。
17. 点 `workbench-publish-and-reindex` → Drawer submit → 进度 `reindexing` → 终态 `workbench-reindex-result` 含 `退出码 0`。
18. 导航 `/publish/history` → 首行 `触发方式 = WebUI 发布`、`Reindex 状态 = 成功`。
19. `查看 Diff` → 列出 3 文件 unified diff。
20. `下载当前快照` → 触发 download `lucy-snapshot-*.zip`。
21. 离线 `unzip -l` 校验含 3 个文件，**不含** `.ktx/secrets/` `.env` `*.pem` `*.key`；`ktx.yaml` 的 `password` 字段为 `<REDACTED>`。

**预期 UI 视觉与交互响应**：
- 4 段 stepper 文案与 `webui/docs/21-connection-catalog-upload-ux-spec.md` §4.5 一致
- 所有专业术语节点 `translate="no"` + `notranslate`
- Drawer Esc 关闭 + 焦点陷阱
- `workbench-publish-and-reindex` 在 `pending files > 0 && validate gate passed` 之前 disabled

**断言与侧面验证**：

| 类别 | 断言 |
|---|---|
| URL | 9 步 URL 精确匹配 |
| DOM | 引用 §5 Selector 契约表的 testid |
| 网络 | `POST /api/semantic-assets/publish` 带 `confirmOverwrite`；轮询 `/api/semantic-assets/releases/:id/status` 至终态 |
| I18N | `assertNoForbiddenTerms(page)` + `assertProfessionalTermsProtected(page)` 在 9 步中每步调用 |
| 翻译专项 | 不在本用例跑；归 §6.2 L3 专项 |
| 可达性 | Drawer `Tab` 焦点循环；Esc 关闭后焦点回触发按钮 |
| 截图 | 步骤 1 / 5 / 9 / 13 / 15 / 17 / 18 各一张 |

**回归影响**：覆盖 `webui/docs/00 / 21 / 25 / 12 / 35 / 36 / 23` 的核心路径。

### 11.2 L1 PR Smoke 8 条摘要

完整源码在 `webui/tests/e2e/specs/`，每条 ≤ 60 行；本节给出每条核心断言集合。

| ID | 核心断言（节选） |
|---|---|
| E2E-PUB-02 | 访问 `/review` → `expect(page).toHaveURL(/\/publish\/workbench$/)` |
| E2E-CON-01 | `connection-readonly-mysql-aliyun` 文案 `预期只读`；Header 右侧无 `表白名单` `连通测试` 跨页按钮（v0.4 起原 header 跨页按钮上提为侧栏 Link） |
| E2E-CON-03 | `catalog-upload-input` 拖入 `finance_mart.yaml` → `校验` → `上传` → Toast `已上传 finance_mart.yaml` |
| E2E-WIKI-01 | `/wiki` 默认 `wiki-mode-read`；`textarea` 计数 0；Tree 节点主标签为文档标题 |
| E2E-WIKI-03 | `sl-ref-badge-mysql-aliyun-dataforai-superstore_orders` 点击 → URL 跳 `/sources/...`；反向跳转回 `/wiki?key=...` |
| E2E-PUB-04 | `workbench-pending-count` = `2 个待发布文件` → `workbench-validate` 后 2 行 `通过` → `workbench-publish-and-reindex` enabled |
| E2E-NAV-01 | 侧栏 `sidebar-nav-group-语义发布` 包含 2 个 `sidebar-nav-item-`，**不**含 `变更审阅` / `待发布变更` / `索引生效` / `资产包` |
| E2E-SEC-01 | `page.route` 拦截 `POST /api/catalog/assets/upload` 篡改 `targetPath` 为 `../etc/passwd` → 响应 4xx；UI Toast `目标路径非法` |

### 11.3 L2 / L3 用例索引

完整列表见 §10 矩阵 + `webui/tests/e2e/specs/`。每条 L2 用例在 CI 中由 §7 变更影响映射自动选择是否加入本次 PR 的 L2 跑集。

---

## 12. 用例变更日志（活文档必备）

> 完整 changelog 在 [`docs/qa/changelog.md`](changelog.md)，每次 PR 涉及 E2E 用例必须更新。

模板：

```md
## 2026-08-XX · PR #N · [简述]

### 新增
- E2E-XXX-NN：<一句话>

### 修改
- E2E-XXX-NN：<一句话>（原因：<issue / spec 引用>）

### 废弃
- E2E-XXX-NN：<一句话>（原因：<功能下线 / 路由迁移>）

### Selector 契约表变更
- 新增 testid `xxx-yyy`：位置 / 角色 / 文案约束
- 改名：old → new（影响：E2E-AAA, E2E-BBB）

### 影响映射更新
- 新增 `route` / `component` / `api` 条目

### 术语 / 翻译防御更新
- 新增 / 移除 forbidden term
```

每次 PR 模板里要求填 changelog 章节，否则 CI 阻断。

---

## 13. 维护节奏

| 时机 | 动作 |
|---|---|
| 每个 PR | L1 smoke + L2 impacted（自动选择） + Selector 契约守门 + changelog 更新 |
| 每个 Milestone（周） | 完整跑一次 L3 Nightly，trace 报告归档 |
| 每个 Release | L4 Release Full + 3 浏览器 |
| 术语规范更新 | 先改 `webui/docs/00-product-terminology-standard.md` → 再回写本文件 §0 forbidden 列表 + §6.1 helper |
| 新增 UI 模块 / 改名 / 新增路由 | ① §5 Selector 契约表 ② §7 impact-map.json ③ 新增 / 修改对应 E2E ④ changelog ④ PR 模板勾选 |
| 新增 API | ① §7 `api` 映射 ② 若涉及用户可见行为，追加 E2E |

---

## 附录 A · 角色与责任

| 角色 | 责任 |
|---|---|
| QA Lead | 维护本文件、§5 Selector 契约、§10 用例矩阵；把控 L1 准入 |
| Frontend | 在 PR 中标记影响 §5 / §7 的 UI 改动；改 testid 必须先更新契约表 |
| Backend | 在 API 变更时同步更新 §7 `api` 映射与对应 E2E 期望 |
| Terminology 维护者 | 维护 §0 / §6 forbidden 列表，接收 E2E-I18N-01 失败告警 |
| Security | 维护 E2E-SEC-* 用例，评估越权回归风险 |
| Release Manager | 把控 L4 Release Full 准入；归档 trace |

---

## 附录 B · 术语速查（用例中固定使用）

```text
Schema             不可译作 架构 / 模式
Manifest           不可译作 舱单 / 清单 / 财政部舱单
Whitelist          不可译作 表白 / 白表
Asset Package      不可译作 报价包
Connection Test    不可译作 替代测试
Read-only          本地化为 预期只读
发布并重建索引      不可写 发布并 reindex / 发布并索引
强制重建索引        不可写 索引生效 / 触发 reindex
校验变更           不可写 Validate changed
发布工作台         不可写 变更审阅 / 变更审阅与校验
发布记录           不可写 Reindex 历史
阅读态             不可写 预览态 作为页面主状态
编辑态             不可写 代码模式
保存预检           不可写 提交代码 / Git 提交
关联语义对象       不可写 关联架构 / 关联模式
刷新本地目录       不可写 重新加载资产 / 触发 ingest
导出当前快照 (.zip) 不可写 资产包导出 / 下载资产包
```

任何 PR 引入的 UI 文本若与上表冲突，必须先在 `webui/docs/00-product-terminology-standard.md` 登记或更新，再回写本附录。

---

## 附录 C · v0.1 → v0.2 评审回炉变更

| 项 | v0.1 | v0.2 |
|---|---|---|
| 落位 | `inbox/lucy-webui-e2e-test-suite-2026-07-31.md` | `docs/qa/lucy-webui-e2e-test-suite.md`（活文档） |
| 入口 | 无 Playwright 工程入口 | §2 新增 `playwright.config.ts` / scripts / `tests/e2e/` 目录 |
| 准入 | 全部 P0 堆 PR | §3 拆 4 层 L1=8 / L2 auto / L3 nightly / L4 release |
| 数据隔离 | `git stash` / `cp` 还原 | §8 Fixture Project `/tmp/lucy-e2e-fixture`，真实仓库只读 |
| 翻译断言 | 依赖 Chrome Auto-translate | §6 改结构扫描 + 原文 forbidden；Auto-translate 降为 L3 专项 |
| Selector | 散落在用例正文 | §5 Selector 契约表（独立文件 + CI 守门） |
| 变更影响 | 靠人脑 | §7 impact-map.json + git diff 自动选 L2 |
| 修订日志 | 无 | §12 changelog.md（PR 必填） |
| PR 模板 | 无 | §13 / §12 联动 PR 模板勾选 |
| `publish-workbench-cta-publish` | 误写 | 修正为 `workbench-publish-and-reindex`（PublishWorkbench.tsx:193） |
| `pub workbench-pending-count` 数量 | 误标 "2 个待发布文件" | 改 "3 个待发布文件"（与 21 / 35 spec 对齐） |
| 12 个 E2E-PUB-01 步骤 8 的 Schema 筛选 | 写 `finance_mart` | 保留 `finance_mart`；与 fixture project 中已有 `dataforai` 不冲突 |
| E2E-PUB-01 终态断言 | 只断言 `释放记录` | 增补 `lastBySchema['mysql-aliyun.finance_mart']` 出现于 `/api/catalog/assets/uploads` |
