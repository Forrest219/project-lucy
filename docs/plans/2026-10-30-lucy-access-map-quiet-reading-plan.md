# 访问关系图阅读降噪实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.3** / 2026-10-30 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无，不进入 v0.25 登记册 |
| 主 Spec | [访问关系图阅读降噪 Spec](../specs/lucy-20261030-access-map-quiet-reading-spec.md)（**v0.3 已验收**） |
| 权威语义 | [Spec 187](../../webui/docs/187-access-relation-sankey-spec.md)。本 Plan 不改其 API、边状态、URL 值、两档措辞。Spec 187 的 SC-01–SC-14 不在本条出口 |
| 状态 | **v0.3 已验收**（2026-10-30）。S0–S4 已完成。SC-01–SC-16 关闭。本条收口不表示可上线 |
| 授权边界 | 已按授权实施：改页面、改 `TD-187-01`、改 Spec 187 §4.4 僵尸授权行的 UI 表现。**不涉及**构建镜像、部署、`git commit` / `git push`、浏览器走查 |
| 验收 | SC-01–SC-16 **已验收**（2026-10-30）。依据是 `access-map.test.tsx` 与 `access-map-layout.test.tsx` 合计 36 项通过，以及 `npm run lint:terminology` 退出码 0。浏览器走查不在本条出口 |
| 实施主体 | Lucy WebUI `webui/src`。不修改 KTX，不修改 `webui/server/admin/access-map.ts` |
| 待拍板 | **已关闭**（2026-10-30）：D1–D8 全部采纳，D3 与 D5 均未否决，否决退路已关闭 |

---

## 1. 目标

把 `/admin/access-map` 收成一条阅读路径：页头、工具条、三张指标卡、主工作区、凭证表。口径和快照离开首屏。节点名称落在卡片里。警告色只留给大于 0 的需复核与确凿越权，以及指标卡上的僵尸授权计数。

四个交付物：

1. **页壳**：页头、分段窗口、`pl-admin-tabbar`、三张 Metric Card、口径说明与快照折叠。
2. **图面**：列标题、定宽卡片、按 Spec §5.3 着色、横向滚动、视觉隐藏的键盘清单。
3. **明细与次级表**：聚焦面包屑、边明细抽屉、凭证表、数据表的可见标题与中文类型。
4. **登记**：`TD-187-01` 与 Spec 187 §4.4 的僵尸授权 UI 表现已指向主 Spec §5.3。

实施原则：

- test id 保持可找到。允许改的是文案、class、清单是否占位、明细放在抽屉里。
- 筛选仍只影响高亮和关系表行。
- Token 点击后的提示句逐字保持 Spec 187。
- 不新增运行时依赖，不新增裸十六进制颜色。

## 2. 开工前置

### S0 审阅（已关闭）

**2026-10-30 拍板结论**：D1–D8 全部按 Spec §4 的「提议」列采纳，**无否决项**。D3、D5 的否决退路已关闭。本节保留原拍板清单作为记录。

开工前要有书面拍板，至少覆盖：

| ID | 要拍板的句子 |
|---|---|
| D1 | 只改呈现 |
| D2 | 信号改为三张 Metric Card，ⓘ 与筛选按钮是兄弟节点 |
| D3 | 僵尸授权流带改为 `series/grant` default，卡片保留「僵尸授权」文字 |
| D4 | 卡片最小高度盖住两行字；图区横向滚动，不缩小 SVG |
| D5 | 节点清单与异常边清单视觉隐藏，test id 与键盘回调保留 |
| D6 | 边明细进右侧抽屉，Esc 先关抽屉 |
| D7 | 凭证清单改表 |
| D8 | 视图用 `pl-admin-tabbar`；窗口可见文案改为近 24 小时 / 近 7 天 / 近 30 天 |

D3 与 D5 均未否决，否决退路已关闭。S0 通过前未改 `webui/src`。

## 3. 文件落点

### 3.1 修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/pages/admin/AccessMap.tsx` | 页头、工具条、tabbar、面包屑、折叠区、主工作区切换 | S1、S3 |
| `webui/src/components/admin/AccessMapSignalBar.tsx` | 换成三张 Metric Card；长文移出标题行 | S1 |
| `webui/src/components/admin/AccessMapLegend.tsx` | 四枚图例收进口径说明 | S1 |
| `webui/src/components/admin/AccessMapCanvas.tsx` | 卡片布局、着色、横向滚动、隐藏清单、抽屉入口 | S2、S3 |
| `webui/src/components/admin/AccessMapTable.tsx` | 可见标题、中文类型、状态徽章、数字右对齐、表头吸顶 | S3 |
| `webui/src/components/admin/AccessMapCredentialList.tsx` | 改为单表 | S3 |
| `webui/src/__tests__/access-map.test.tsx` | 按 SC-14 更新断言，保留 test id | S1–S3 |
| `webui/src/__tests__/access-map-layout.test.tsx` | 新增：布局几何自检（SC-07）与源码色值扫描（SC-15） | S2、S4 |
| `webui/docs/design-system/99-governance.md` | `TD-187-01` 的僵尸授权着色句已指向主 Spec §5.3 | S4 |
| `webui/docs/187-access-relation-sankey-spec.md` | §4.4 僵尸授权 UI 表现已改为引用主 Spec §5.3 | S4 |

### 3.2 不改

- `webui/server/admin/access-map.ts` 与其测试。
- `docs/qa/selector-contract.md` 里已有的 `access-map-*` test id。新增抽屉容器若需要 test id，使用 `access-map-edge-drawer`，并在同一清单补一行。
- KTX、Helm、镜像、术语标准正文。本 Spec 的 `New terms: None` 成立，不改 `00-product-terminology-standard.md`。

## 4. 分阶段实施

### S1 页壳（D2、D8，以及折叠）

1. 页头描述改为 Spec §5.1 那一句。哈希移入「快照」。
2. 统计窗口改为分段控件。选项 `value` 不变。
3. Schema 层与访问口径的标签放到控件上方。可见文案去掉 `（flat）` / `（schema）`。
4. 「定位」改为 `pl-icon-btn`，`aria-label` 为「定位」。Enter 仍调用 `runSearch`。
5. 视图切换改为 `pl-admin-tabbar`，`aria-pressed` 与 `access-map-view-map` / `access-map-view-table` 保留。
6. 信号条改为 §5.2 的三张卡。现有五段说明性 test id 放进默认关闭的「口径说明」。

**出口**：SC-01、SC-02、SC-03、SC-04、SC-05 有组件测试。图面可以仍是旧 SVG。

### S2 图面（D3、D4、D5）

1. `layoutAccessMap` 把节点宽度改为定宽卡片，高度取 `max(两行字, 流量高度)`。
2. 流带锚点改到卡片左右缘。单测断言：任一节点文字盒与任一流带采样点不重叠。
3. 按 Spec §5.3 改 `ribbonStrokeClass` / `kernelStrokeClass`。D3 已采纳，这一步已执行。
4. SVG 去掉 `max-w-full`。外层 `overflow-x: auto`。
5. 节点清单与异常边清单加视觉隐藏 class。`data-testid`、按钮回调、`aria-expanded` 保留。
6. 列标题按当前 `layer` 渲染。

**出口**：SC-06、SC-07、SC-08、SC-09、SC-15。

### S3 明细与两张表（D6、D7）

1. 边明细从画布下方的 `section` 移到 Radix Dialog 侧栏。内容字段不变。
2. Esc 处理按 Spec §5.5：先关抽屉，再清 `focus`。
3. `focus` 存在时渲染「全图 / {label}」。
4. 凭证清单改为表，提示句不改。
5. 数据表补可见标题、中文类型、状态徽章、右对齐数字、吸顶表头。

**出口**：SC-10、SC-11、SC-12、SC-13。

### S4 登记与回归

1. D3 已采纳。`TD-187-01` 与 Spec 187 §4.4 僵尸授权行的 UI 表现已指向主 Spec §5.3。判定条件与状态名未改。
2. 跑 `webui` 下访问关系图相关单测，以及 `npm run lint:terminology`。
3. 主 Spec 与本 Plan 的状态已写成「v0.3 已验收」，并写明 SC-01–SC-16 的证据。

**出口**：SC-14、SC-16。2026-10-30 已随 SC-01–SC-16 一并验收。

## 5. 验收

验收正文是主 Spec §7 的 SC-01–SC-16。本 Plan 不另起编号。

证据要求：

- SC-01–SC-13 落在 `webui/src/__tests__/access-map.test.tsx` 或同目录新测试文件。
- SC-14 以该测试文件加 `docs/qa/selector-contract.md` 的既有 id 仍能对上为准。
- SC-15 以源码检索 `AccessMap*.tsx` 无新的 `#` 色值为准。
- SC-16 以 `npm run lint:terminology` 退出码 0 为准。

落地现状（2026-10-30）：

| 证据项 | 落点 | 状态 |
|---|---|---|
| SC-01–SC-13 | `webui/src/__tests__/access-map.test.tsx` | 有断言 |
| SC-07 的几何自检 | `webui/src/__tests__/access-map-layout.test.tsx` | 有断言 |
| SC-14 | `webui/src/__tests__/access-map.test.tsx`（既有 test id 仍可找到） | 有断言 |
| SC-15 | `webui/src/__tests__/access-map-layout.test.tsx`（源码扫描无裸十六进制） | 有断言 |
| SC-16 | 仓库根 `npm run lint:terminology` | 已跑，退出码 0 |

2026-10-30 用户批准验收。上表即本条出口，SC-01–SC-16 关闭。浏览器走查归 [`lucy-20261030-webui-release-ux-review-spec.md`](../specs/lucy-20261030-webui-release-ux-review-spec.md) 的必走表面，不在本条出口。Spec 187 的 SC-01–SC-14 不因本 Plan 收口而关闭。

## 6. 完成定义

2026-10-30 本 Plan 已收口。下列条件均已满足：

1. S0 的八条决策有拍板记录。D3、D5 未否决，否决退路已关闭。
2. S1–S3 的代码与测试在仓库里，且 SC-01–SC-15 有断言。
3. `TD-187-01` 与 Spec 187 §4.4 僵尸授权行的 UI 表现已指向主 Spec §5.3。
4. SC-16 已跑过，`npm run lint:terminology` 退出码 0。
5. 主 Spec 与本 Plan 的状态句为「v0.3 已验收」。
6. 没有改动 `/api/admin/access-map` 的响应形状。

浏览器走查、Spec 187 的 SC-01–SC-14、镜像构建、部署与 git 提交不在本完成定义内。本条收口不表示可上线。

## 7. 风险

| 风险 | 表现 | 对策 |
|---|---|---|
| D3 与 `TD-187-01` 同时生效 | 代码已是中性流带，治理条文仍写 warning | S2 着色与 S4 条文已在同一批落地。D3 已采纳 |
| 卡片最小高度拉高表列 | 表多时图变长，左列留白变大 | 接受留白。流量仍决定高度下限以上的比例。不把标签再放回流带通道 |
| 视觉隐藏被写成 `display: none` | 读屏与测试都丢按钮 | Spec §5.7 禁止 `display: none` 与 `aria-hidden`。SC-09 断言按钮存在且不占布局高度 |
| 抽屉吞掉 Esc | 聚焦态无法用键盘返回全图 | Esc 分两段：开着抽屉只关闭，关着才清 `focus`。SC-11 覆盖返回全图 |
| 提示句被改写 | Token 过滤被读成授权变窄 | SC-13 锁定 Spec 187 原句 |
| 测试只改 class、漏了语义 | 需复核文案混入「越权」 | SC-02 直接断言文本 |

回滚：本变更只在 WebUI 呈现层。回退 S1–S3 的前端提交即可恢复现行页面。不涉及数据迁移。

## 8. 落盘清单（本轮文档）

| # | 结果 |
|---|---|
| 1 | Spec：`docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`。Plan：本文件 |
| 2 | Spec §6 有核心流程（伪代码） |
| 3 | 两份文首元数据含状态；Spec 含文档类型 / 版本；Plan 含授权边界与验收 |
| 4 | 本 Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Spec 的 Terminology Compliance 含规定两句 |
| 6 | Spec 的 Design System Compliance 含四段 |
| 7 | `docs/README.md` 与 `docs/plans/README.md` 已登记 |
| 8 | 无新命令、无新 CI job |
| 9 | 功能编号无。不进入 v0.25 登记册 |
| 10 | 2026-10-30 闭口时执行 `npm run lint:spec-docs`。本 Spec 与本 Plan 无新增形态违规。工作区里另有与本功能无关的既有违规，整条命令退出码不是 0 |
| 11 | 主 Spec 已含「闭口层级」，层级为功能合同 |
