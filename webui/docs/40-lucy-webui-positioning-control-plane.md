# Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane |
| 文档类型 | Product / UX / Branding Spec（范围收敛的修订 spec） |
| 版本 | v0.2-cross-review |
| 撰写日期 | 2026-08-01（v0.2 cross-review 修订：3 blocker + 5 建议见 `webui/docs/plans/review-spec40-m37.md`） |
| 适用范围 | Lucy WebUI 品牌区副标题、`<title>` 标签、术语标准、相关设计 spec 备注、关键测试断言 |
| 关联工单 | `webui/docs/plans/wo-M37-lucy-webui-positioning-control-plane.md` |
| 事实源 | `webui/docs/39-data-agent-ops-platform-global-ux-spec.md` §4 目标产品心智；`webui/src/app/App.tsx:113-114` 当前品牌区实现；`webui/src/__tests__/app-shell.test.tsx:124-127` 当前测试断言 |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/06-navigation-ia.md`、`webui/docs/39-data-agent-ops-platform-global-ux-spec.md`、`docs/vision.md`、`docs/design-webui-ui-refresh.md`、`docs/webui-module-guide.md`、`docs/project-overview.md` |

---

## 1. 背景

`webui/docs/39-data-agent-ops-platform-global-ux-spec.md` v0.1（2026-08-01）已经明确：

> Lucy WebUI 的目标心智应从"语义维护工作台"升级为 **Data Agent Ops Control Plane**。

M36 主工单聚焦 5+1 导航内的 UX 改造（运维驾驶舱、待处理事项、对象详情抽屉、发布风险工作台、质量运营中心、跨模块追溯），是一个 8 个 Task、600+ 行的大改造。

但在此之前，WebUI 最先被用户感知的定位文案已经滞后：

- `webui/src/app/App.tsx:113-114` 品牌区副标题仍是「语义维护工作台」——与 M36 §4 目标心智冲突。
- `docs/design-webui-ui-refresh.md:119,616,630` 三处「Phase 1 默认保留 KTX WebUI」备注与新定位冲突。
- `webui/docs/00-product-terminology-standard.md` v0.1 未登记 `Data Agent Ops Control Plane`，且「语义维护工作台」未标弃用。
- `webui/src/__tests__/app-shell.test.tsx:124-127` 只断言 `Lucy WebUI` 出现 / `KTX WebUI` 不出现，缺新定位断言兜底回归。

本 spec 只解决上述四个落点中残留的旧定位痕迹，**不**重做 M36 任一项 UX 改造。

**审阅拍板（2026-08-01）**：

1. 副标题措辞定为「Data Agent Ops Control Plane」（英文 brand term，主）+「Data Agent 运维控制台」（中文 caption，副）。
2. `<title>` **不**扩展，保持 `Lucy WebUI`。
3. `docs/vision.md` / `docs/webui-module-guide.md` 改写由 M38 单独承接，本 spec **不**列入 M37 范围。
4. 英文 brand term DOM 节点加 `translate="no"` + `notranslate` 浏览器翻译防御。
5. **顺手统一**动作：spec 39 §1 背景 line 25 现有「运维控制面」在 M37 内一并改为「运维控制台」，出 spec 39 v0.2 修订。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 品牌区副标题改为「Data Agent Ops Control Plane」+ 灰色 caption「Data Agent 运维控制台」 | 立即让用户进首页看到与 spec §4 一致的心智；中英双轨不增加维护成本 |
| P0 | 术语标准 v0.2 登记 `Data Agent Ops Control Plane` 主术语 | 复用第 3 节全局固定术语表模板；把「语义维护工作台」标为弃用别名 |
| P0 | `design-webui-ui-refresh.md` 三处「Phase 1 保留 KTX WebUI」备注改为已升级 | 防止后续 reviewer 被旧备注带偏 |
| P0 | `app-shell.test.tsx` 增加新定位断言 | 防止副标题回流 |
| P0 | 顺手统一：spec 39 §1 背景 line 25「运维控制面」→「运维控制台」并出 v0.2 修订 | 避免 spec 39 ↔ spec 40 出现「控制面」vs「控制台」混用 |
| P2 | `docs/project-overview.md:67`、`webui/docs/06-navigation-ia.md:3,26` 顶部小修 | 局部更新，不推翻结构 |
| P2 | `docs/user-guide/*.html` 批量替换「KTX WebUI」→「Lucy WebUI」 | 工作量大，独立安排 |

> **M38 承接（不在本 spec）**：`docs/vision.md` / `docs/webui-module-guide.md` 改写为 Data Agent Ops Control Plane 叙事，由 M38 单独出 spec / plan 推进。`<title>` 保持 `Lucy WebUI` 不扩展。

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 定位可见性 | 用户进入 Lucy WebUI 首页 0.1 秒看到与 spec §4 一致的 brand term |
| 术语事实源同步 | 00 术语标准登记新主术语并把旧文案标弃用，frontend linter 有据可查 |
| 设计 spec 备注同步 | 防止后续 reviewer 被过期备注带偏 |
| 回归兜底 | 关键文案有测试断言，避免再次回退到旧定位 |
| 顺手统一 | spec 39 §1 背景 line 25「运维控制面」在 M37 内一并改为「运维控制台」，避免跨 spec 用词漂移 |
| 范围收敛 | 本 spec 只动「定位文案 + 备注 + 术语 + 测试」四类，不碰 M36 的 UX 改造 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不实施 M36 任一 UX 改造（运维驾驶舱 / 对象抽屉 / 待处理队列 / 发布风险工作台 / 质量运营中心） | 这些是 M36 主工单范围（`wo-M36-data-agent-ops-platform-global-ux.md` Task 1-8），不在本 spec |
| 不改变 5+1 导航骨架 | M36 §5 明确保留，不在本次重做 |
| 不改 API 契约、`ktx.yaml`、`access.yaml`、data-qa instructions | 本 spec 只改 UI 文案 + 文档 + 测试，不触碰 runtime 与配置 |
| 不做客户侧手册大规模重写 | `docs/user-guide/*.html` 留作 P2 单独批次 |
| 不引入新的可视化框架 / 视觉 token | 保持现有 app.css 风格 |

## 4. 落地范围

### 4.1 UI 改动（最小集合）

| 文件 | 位置 | 现状 | 目标 |
|---|---|---|---|
| `webui/src/app/App.tsx` | 113-114 品牌区 | `<strong>Lucy WebUI</strong>` + `<span>语义维护工作台</span>` | `<strong>Lucy WebUI</strong>` + `<span translate="no" className="notranslate pl-brand-eyebrow">Data Agent Ops Control Plane</span>`（其下挂一个次级 `<span className="pl-brand-tagline">Data Agent 运维控制台</span>`） |

**P0 范围内**只动 `App.tsx` 品牌区，**不**改 `<title>`（保持 `Lucy WebUI`），**不**触动 `breadcrumbs.ts:90`（已在上一次反馈中改为「Lucy WebUI」），**不**触动现有 `app.css` 视觉风格以外的内容（仅追加两条新 class）。

### 4.1.1 浏览器翻译防御

`Data Agent Ops Control Plane` 是英文 brand term，按 spec 39 §10 + 00 §2.6 必须加 `translate="no"` + `notranslate`。中文 caption「Data Agent 运维控制台」不需防御（普通中文段落）。

### 4.2 术语标准修订

`webui/docs/00-product-terminology-standard.md` 由 v0.1 升到 v0.2：

1. 元数据表：版本 `v0.1` → `v0.2`；撰写日期 `2026-07-31` → `2026-08-01`；新增「v0.2 新增 Data Agent Ops Control Plane / Data Agent 运维控制台，标记『语义维护工作台』为弃用别名」。
2. 第 3 节全局固定术语表新增一行：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Data Agent Ops Control Plane | Data Agent Ops Control Plane | Data Agent 运维控制台 | 语义维护工作台、KTX WebUI（仅作为 UI 副标题时）、控制台（作为唯一称谓）、运维控制面（M37 后视为弃用） | Lucy WebUI 的产品定位；自 M37 起在品牌区副标题出现，文档叙事中以英文 brand term 优先 |

3. 在第 3 节表后追加一段「弃用别名说明」：列出 `语义维护工作台`、`KTX WebUI 治理控制台`、`本地治理工作台` 的弃用理由与可见位置（仅作为历史备注，不允许出现在新代码 / 新文档）。同时把 `运维控制面` 列为「M37 后视为弃用，应改为『运维控制台』」。
4. 第 7 节「迁移优先级」加一条 P0：把品牌区副标题替换为 `Data Agent Ops Control Plane` + `Data Agent 运维控制台`。

### 4.3 设计 spec 备注修订

`docs/design-webui-ui-refresh.md` 三处过期备注改为：

- §5.2 左侧导航：原「顶部品牌区暂不拍板最终品牌文案。Phase 1 默认保留当前 KTX WebUI 主标题，只把副标题从视觉上弱化；若产品确认切换品牌，再单独改为 Lucy。」改为「顶部品牌区已升级为 `Data Agent Ops Control Plane`（中文 caption：`Data Agent 运维控制台`），详见 spec 40 与 `39-data-agent-ops-platform-global-ux-spec.md` §4 / v0.2。」
- §10「未来工作 · P0 优先级」：原「**品牌口径**：Phase 1 保留 KTX WebUI，不改为 Lucy；只改善视觉层级。」改为「**品牌口径（已完成）**：品牌区副标题已升级为 `Data Agent Ops Control Plane`（spec 40 / M37）。后续仅当 brand term 再次调整时回到本节。」
- §10「待确认问题」表：原「WebUI 顶部品牌是 Lucy 还是 KTX WebUI」一行删除，备注「已在 spec 40 / M37 解决，关闭」。

### 4.4 文档侧修订（M38 承接，不在本 spec）

| 文件 | 改动 | 承接工单 |
|---|---|---|
| `docs/webui-module-guide.md:5,19,21` | 文档名 / 产品简介 / 核心问题描述从「KTX WebUI · 治理控制台 · Semantic/Knowledge/Quality Pack 叙事」改为「Lucy WebUI · Data Agent Ops Control Plane · 6 维心智叙事」；版本号升 v1.4 | M38 |
| `docs/vision.md:55,103` | 架构图中「Lucy WebUI（治理控制台）」改为「Lucy WebUI（Data Agent Ops Control Plane）」；§3 各层说明补一句「运维控制台覆盖 Runtime / Assets / Change / Quality / Access / Audit 六维」 | M38 |

> 本 spec §4.4 仅作为「承接关系登记」，**不**进入 M37 的 task 范围。Reviewer 在拍板 M37 完成后，需独立起草 M38 spec / plan 推进此节。

### 4.5 文档侧修订（P2，可后续批次）

| 文件 | 改动 |
|---|---|
| `docs/project-overview.md:67` | 目录注释「Lucy WebUI 本地治理工作台」→「Lucy WebUI 本地 Data Agent Ops Control Plane」 |
| `webui/docs/06-navigation-ia.md:3,26` | 顶部「本文定义 KTX WebUI 的导航口径」改为「本文定义 Lucy WebUI 的导航口径」；骨架不推翻 |
| `docs/user-guide/*.html` | 批量替换「KTX WebUI」→「Lucy WebUI」，批量替换「语义维护工作台」→「Data Agent Ops Control Plane」 |

### 4.6 测试断言

`webui/src/__tests__/app-shell.test.tsx:124-127` 现有断言保留（防 `KTX WebUI` 回流），新增：

```ts
it("renders the Data Agent Ops Control Plane tagline in the brand block", () => {
  renderAt("/onboarding");
  expect(
    screen.getByText("Data Agent Ops Control Plane"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Data Agent 运维控制台"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("语义维护工作台"),
  ).not.toBeInTheDocument();
});
```

`webui/src/__tests__/lint-terminology-scan.test.ts` 不需要修改——`Data Agent Ops Control Plane` 是英文 brand term，本就是术语标准允许的固定字符串；`Data Agent 运维控制台` 是允许补充说法。

### 4.7 spec 39 顺手统一（v0.2 修订）

`webui/docs/39-data-agent-ops-platform-global-ux-spec.md` 当前 v0.1 全文中只有 §1 背景 line 25 一处出现「运维控制面」（原文："从'资源维护'升级为'运维控制面'"）。§4 目标产品心智只保留 `Data Agent Ops Control Plane` 英文 brand term，无中文「控制面」用词。M37 顺手出 spec 39 v0.2 修订：

| spec 39 位置 | 现状 | 目标 |
|---|---|---|
| §1 背景 line 25 | "从'资源维护'升级为'运维控制面'" | "从'资源维护'升级为'运维控制台'" |
| §4 目标产品心智 | 仅英文 brand term `Data Agent Ops Control Plane`，无中文「控制面」 | 不变 |
| §11 验收标准 | "5+1 导航保持不破，系统概览承担运维驾驶舱职责"（无「控制面」） | 不变 |
| §12 阶段表 | 全文未出现「运维控制面」 | 不变 |

`spec 39` 元数据表升 v0.2，撰写日期追加 `2026-08-01 v0.2（顺手统一：line 25「运维控制面」→「运维控制台」）`。本动作纳入 M37 Task 5。

## 5. 验收标准

| 类别 | 验收 |
|---|---|
| 品牌区 | `webui/src/app/App.tsx:113-114` 渲染为 `Lucy WebUI` + `Data Agent Ops Control Plane`（`translate="no"` + `notranslate`）+ `Data Agent 运维控制台` |
| 浏览器 tab | `webui/index.html:6` `<title>` 保持 `Lucy WebUI`（不扩展） |
| 术语标准 | `00-product-terminology-standard.md` v0.2 第 3 节新增 `Data Agent Ops Control Plane` 行；「语义维护工作台」与「运维控制面」列入弃用别名 |
| 设计 spec 备注 | `docs/design-webui-ui-refresh.md` 三处过期备注全部更新 |
| spec 39 顺手统一 | `39-data-agent-ops-platform-global-ux-spec.md` 元数据升 v0.2，§1 背景 line 25 一处「运维控制面」→「运维控制台」 |
| 测试 | `app-shell.test.tsx` 新增 `Data Agent Ops Control Plane` + `Data Agent 运维控制台` 断言；同步断言 `语义维护工作台` 不再出现 |
| Lint | `cd webui && npm run lint:terminology` 通过；`npm run lint:ia-boundary` 通过 |
| Type | `npx tsc --noEmit` 通过 |
| Test | `npm test` 通过 |
| Build | `npm run build` 通过 |

> **不在 M37 验收（由 M38 承接）**：`docs/webui-module-guide.md` 升 v1.4 + 开篇叙事更新；`docs/vision.md:55,103` 升级。

## 6. 关联与风险

### 6.1 关联

- 上游：`webui/docs/39-data-agent-ops-platform-global-ux-spec.md`（M36 主 spec，v0.1）——本 spec 是其 §4 目标心智在品牌区 / 术语 / 文档的最小落地。
- 配套：`webui/docs/00-product-terminology-standard.md` v0.1 → v0.2 修订（Task 1）。
- 同源历史：
  - `docs/vision.md` v1.2 §3 lines 55、103（架构图 + 各层说明）—— M38 承接（见 §4.4）。
  - `docs/design-webui-ui-refresh.md` lines 119、616、630（三处过期备注）—— M37 Task 3 改写。
  - `docs/webui-module-guide.md` v1.3 lines 5、19、21（文档名 / 产品简介 / 核心问题）—— M38 承接。

### 6.2 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 副标题「Data Agent Ops Control Plane」过长挤压品牌区 | 中 | 在 app.css 中给 `.pl-brand-eyebrow` 设置 `font-size` 缩小、`color` 弱化、`white-space: nowrap` + `text-overflow: ellipsis`；如视觉不通过回退到 brand term + 单一 caption |
| 客户侧手册未同步导致「KTX WebUI」字样回流 | 低 | 列为 P2 单独批次；本 spec 不阻塞 |
| 「语义维护工作台」在历史 commit / wiki / Slack 残留 | 低 | 仅在 00 术语标准中标弃用 + app-shell 测试断言兜底；不再主动清理历史；浏览器 tab 不受影响 |
| 误把 brand term 翻译为中文做主术语 | 低 | spec 4.2 明确 UI 主术语为英文 brand term；中文仅做 caption；翻译防御已加 |
| spec 39 ↔ spec 40 「控制面」vs「控制台」混用 | 低 | M37 Task 5 顺手统一 spec 39 v0.2；spec 40 §4.2 禁止文案列追加「运维控制面」 |

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` v0.2.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Data Agent Ops Control Plane | Data Agent Ops Control Plane | Data Agent 运维控制台 | 语义维护工作台、KTX WebUI（仅作为 UI 副标题时）、控制台（作为唯一称谓）、运维控制面（M37 后视为弃用） | Lucy WebUI 的产品定位；自 M37 起在品牌区副标题出现，文档叙事中以英文 brand term 优先 |

Deprecated aliases (kept for traceability only, must not appear in new code / docs):

- `语义维护工作台`：v0.1 及以前的 WebUI 副标题；2026-08-01 起被 `Data Agent Ops Control Plane` 替代。
- `KTX WebUI 治理控制台`：v0.x 叙事；替代为 `Data Agent Ops Control Plane`。
- `本地治理工作台`：散见于 `docs/project-overview.md` 等处；并入新定位。
- `运维控制面`：M36 期间的中文叙事；M37 顺手统一为 `运维控制台`，2026-08-01 起新文档应使用后者。

Browser translation defense is mandatory for:

- `Data Agent Ops Control Plane` 整个 brand term。
- `KTX`、`MCP`、`Agent`、`Schema`、`Manifest`、`Catalog`、`YAML`、`Endpoint`、`Reindex`（沿用术语标准要求）。
- 文件名、路径、URL。

App.tsx 品牌区 DOM 应为（与 §4.1 / M37 Task 2 Step 1 完全一致）：

```tsx
<strong>Lucy WebUI</strong>
<span translate="no" className="notranslate pl-brand-eyebrow" title="Data Agent Ops Control Plane">
  Data Agent Ops Control Plane
</span>
<span className="pl-brand-tagline">Data Agent 运维控制台</span>
```

Notes:

- `Lucy WebUI` 保留为品牌 `<strong>`，与现有 `.pl-brand-block strong` 规则（app.css:112）兼容。
- 英文 brand term 节点加 `translate="no"` + `notranslate` 防御浏览器翻译。
- 加 `title` 属性以兜底 sidebar 220px 宽度截断（review 🟡 5），用户 hover 可看到完整 brand term。`title` 字符串不作为 DOM 文本翻译防御范围。
- 中文 caption 不需翻译防御（普通中文段落）。

## 8. 待审阅项

**已拍板（2026-08-01）**：

1. ✅ 副标题措辞：「Data Agent Ops Control Plane」+ 中文 caption「Data Agent 运维控制台」。
2. ✅ `<title>` 不扩展，保持 `Lucy WebUI`。
3. ✅ 文档侧 P1 范围由 M38 单独承接，**不**进入 M37。
4. ✅ 浏览器翻译防御：英文 brand term DOM 节点加 `translate="no"` + `notranslate`。
5. ✅ 顺手统一：spec 39 §1 背景 line 25「运维控制面」→「运维控制台」由 M37 Task 5 落地，出 spec 39 v0.2。

**本 spec 落盘后需 reviewer 在 M38 拍板的项**：

1. M38 spec 范围：`docs/webui-module-guide.md` v1.4 改写 + `docs/vision.md` 架构图更新 + 是否有额外文档需纳入。
2. M38 是否同时启动 `docs/project-overview.md:67` + `webui/docs/06-navigation-ia.md:3,26` 顶部小修（spec 40 §4.5 的 P2 内容）。
3. 客户侧手册 `docs/user-guide/*.html` 批量替换的批次排期。

## 9. 分阶段交付

| 阶段 | 范围 | 承接工单 | 成功标志 |
|---|---|---|---|
| Phase 1 | 00 术语标准 v0.2 + 品牌区副标题（App.tsx + app.css 两条新 class）+ `design-webui-ui-refresh.md` 三处备注 + app-shell 测试断言 + spec 39 v0.2 顺手统一 + `webui/docs/README.md` / `webui/docs/plans/README.md` 索引同步 | M37 | 验收标准中 P0 五项全部满足 + README 索引已登记；lint / type / test / build 通过；视觉 QA 三行品牌区无溢出 |
| Phase 2 | `webui-module-guide.md` v1.4 + `docs/vision.md:55,103` 升级 | M38（待起草） | vision / module-guide 文档侧品牌叙事一致；reviewer 拍板措辞与 spec 40 §4.4 一致 |
| Phase 3 | `docs/project-overview.md:67` + `webui/docs/06-navigation-ia.md:3,26` 顶部小修 + `docs/user-guide/*.html` 批量替换 | 后续批次 | P2 全部满足；外链手册与仓库内文档叙事一致 |

Phase 1 必须在 M37 内完成；Phase 2 由 M38 单独承接（本 spec §4.4 仅作关联登记）；Phase 3 留作 P2 单独批次。
