# WebUI 存量 UI/UX 整改总纲 Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.2 草案（已含浏览器盘点），待委托人确认 Spec 范围、批次与裁决项 D-1–D-4**。本 Plan 是**优化方案**，不做开发；各批整改另出子 Plan 并另获开发授权 |
| 主 Spec | [`docs/specs/lucy-20261114-webui-uiux-remediation-spec.md`](../specs/lucy-20261114-webui-uiux-remediation-spec.md) **v0.2-draft** |
| 总账 | **P1-24**／REQ-030-045；**不入核心分母** |
| 授权边界 | 本 Plan 只改文档：Spec、总账、需求池、`docs/README.md`、`docs/plans/README.md`，以及（D-1–D-3 获批后）设计系统 `01`／`03`／`10` 章的条款文字。**不改** `webui/src/`、`app.css`、测试、`scripts/`、KTX。各批整改须另入子 Plan、终稿确权、委托人另发开发授权 |
| 验收 | Spec SC-01–SC-06 |

## 目标

把存量 UI/UX 偏差登记为带证据（静态＋浏览器）的 UXR 清单，给出可执行的批次方案与逐页进度台账，作为后期逐页整改的唯一问题口径；同时把需要先定标准的三项（对比度、最小字号、最小点击目标）列为裁决项，避免带着模糊标准动手。

## 开工前置

- [x] 委托人 2026-11-14 同意「提出整改意见、落盘为新 Spec、后期逐页修改」（立项）
- [x] 委托人 2026-11-14 指示「用浏览器探查，只做优化的 Spec 和 Plan，不做开发」；浏览器盘点已完成，见 Spec §2
- [ ] 委托人确认 Spec 范围与批次
- [ ] 委托人裁决 D-1（对比度）、D-2（最小字号）、D-3（最小点击目标）、D-4（`AsyncRegion` 是否扩全站），见 Spec §5
- [ ] 各批子 Plan 开工前：总账挂行、终稿确权、**委托人另发开发授权**；无授权则停止，不得改 `webui/src/**`

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 | 静态盘点＋三条 lint（已完成） | Spec §4 每条 UXR 的复跑命令得到相同结论 |
| 2 | 浏览器盘点：1920×1080 逐页、1440×900 与 1280×800 遍历、浮层键盘探针（已完成） | `inbox/uiux-browser-audit/audit.js` 可复跑；Spec §3 列出未发现偏差的项 |
| 3 | 落盘 Spec v0.2、总账与需求池同步（本次） | `npm run lint:spec-docs` 对本 Spec／Plan 无新增违规；`node scripts/uat/check-e2e-ledger.mjs` 通过 |
| 4 | 委托人裁决 D-1–D-4 | 裁决结果写入 Spec §5，并同句镜像到总账 |
| 5 | D-1–D-3 获批后，在 `01`／`03`／`10` 章补条款（文档） | 各章版本与日期更新；`lint:spec-docs` 的 `ds-meta` 通过 |
| 6 | 每批出子 Plan（见下节） | 子 Plan 过 `lint:spec-docs`，含交互合同与浏览器验证小节 |
| 7 | 授权后实施，回写 Spec §8 台账 | 由该批子 Plan 规定 |

## 批次方案

下列是各批子 Plan 的**范围、验证与回滚草案**，不是开发授权。

### B1 门禁回绿＋输入标签（UXR-05、06、13）

- 范围：`Audit.tsx` 的事件 ID 输入改局部状态镜像；3 处补 `translate="no"`／`notranslate`；`CaseList.tsx` 搜索框与 `RunList.tsx` 无标签的 `select` 补 `aria-label`。
- 不改：文案、布局、`data-testid`。
- 验证：`npm run lint:url-driven-input`、`npm run lint:terminology` 通过；相关 vitest（Audit、CaseList、RunList）通过；浏览器在 `/eval/cases`、`/eval/runs` 复跑 `audit.js` 的 `inputNoLabel` 为空。
- 回滚：还原该批提交。

### B2 可达性：确认框与无 `Esc` 的抽屉（UXR-02、UXR-01）

- 范围：先 `AgentList` 新建 Agent，再 `Tokens` 的续期与吊销（`RenewTokenDialog`），再 `AgentDetail`；最后 13 个无 `Esc` 的手写 Drawer。统一迁到 Radix Dialog，沿用 `15-components-overlay.md` 的类名族。
- 不改：表单字段、提交逻辑、既有 `data-testid`。
- 验证：每个浮层补测试断言「可访问名称存在、`Esc` 关闭（提交中除外）、打开后焦点进入、关闭后焦点回入口」；浏览器用 `audit.js` 的 `__probe` 复测，目标是 `role`／`aria-modal`／名称／`Esc` 全为是；吊销只打开不确认。
- 风险：Radix 会改变焦点与滚动锁定行为；每个浮层单独成提交，便于回滚。

### B3 对比度、字号、点击目标（UXR-10、11、12；依赖 D-1／D-2／D-3）

- 范围：以 `app.css` 的 token 与共享类为主。`fg-muted` 加深；文字用 `danger-strong`／`warning-strong`；指定文字链接色；`pl-row-action-link` 扩点击区；徽章与辅助文字统一字号下限。
- 前置：D-1–D-3 获批，且对应设计系统章节已补条款。
- 验证：用 `audit.js` 的对比度判定在 10 个以上页面复测，`lowContrast` 只剩已登记的装饰符号；`smallTargets`、`smallFont` 按裁决阈值归零或有登记例外；`lint:terminology` 不回退。
- 风险：改 token 影响全站视觉。缓解：先在候选值上用脚本求解并写入子 Plan，再逐页复核；不做大范围视觉重排。回滚：token 改动单独成提交。

### B4 数据网格与容器内溢出（UXR-04、14、15）

- 范围：评测三页表格改用 `pl-data-grid`；`RowPolicyStateBadge` 哈希值可换行；`/catalog` 滚动容器补 `role`／`aria-label`／`tabindex`；`MarkdownPreview` 表格套滚动容器。
- 前置：评测页需有数据才能浏览器确认；子 Plan 先决定造种子数据的方式（不使用生产数据）。
- 验证：1280×800 下 `/catalog`、`/help`、`/admin/row-policies` 无裁切；1440×900 下 `tooWide` 为 0；相关 vitest 通过。

### B5 样式收敛（UXR-02 其余、UXR-01 其余、UXR-03）

- 范围：`pl-modal-*` 与 `pl-wiki-preflight-*` 并入 `pl-dialog-*`；剩余手写 Drawer 迁 Radix（含焦点进入）。
- 验证：`app.css` 中无引用的旧类名可删除并通过构建；`rg` 复核三套旧类名的使用文件数为 0。
- 风险：纯样式迁移，视觉应不变；每页保留既有测试。

## 浏览器验证

不适用：本 Plan 只落盘文档，不改变用户可见 WebUI 表面；浏览器盘点本身是取证，不是对某页的验证。各批子 Plan 须自行写明视口（`1920×1080` 或 `1440×900`）与验证步骤。

## 验收

- Spec §9 的 SC-01–SC-06。
- `npm run lint:spec-docs` 对本 Spec／Plan 无新增违规。

## 完成定义

- Spec §9 的 SC-01–SC-06 全部成立。
- 总账 P1-24 与需求池 REQ-030-045 与 Spec 状态同句。
- D-1–D-4 有明确裁决或明确挂起。
- **不等于** 任何页面已整改，不等于 UAT PASS，不等于可上线。

## 风险

- **盘点是下限**：浏览器盘点只看 DOM 与计算样式，没有截图与人工视觉判断，`focus-visible` 样式与真实 Tab 顺序未判定。缓解：各批子 Plan 在该页再核对一次。
- **测试环境偏差**：盘点对象是本机 demo 容器（`gitSha` 82809ae，`gitDirty`），与仓库 HEAD 不同；评测等页面无数据。缓解：子 Plan 开工时重跑 `audit.js`，以当时的构建为准。
- **标准未定先动手**：对比度、字号、点击目标目前设计系统没有数值标准。缓解：D-1–D-3 先裁决、先补条款，再排 B3。
- **范围蔓延**：整改时顺手改视觉。缓解：Spec 非目标；子 Plan 必须写明保持 `data-testid` 与文案不变。
- **迁移回归**：手写浮层迁 Radix 可能改变焦点或滚动行为。缓解：每个浮层单独提交并补键盘断言；回滚是还原该提交。
- **总账失同步**：进度只以 Spec §8 为现值，总账 P1-24 只做同句镜像。
