# 版本信息身份块实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | v1.2 / 2026-10-30 |
| 目标版本 / 优先级 | 不绑定产品版本号 / P2 |
| 功能编号 | 无 |
| 主 Spec | [版本信息身份块 Spec](../specs/lucy-20261030-version-info-identity-spec.md)（v1.2，已验收） |
| 权威语义 | [构建修订标识 Spec](../specs/lucy-20261020-build-revision-identity-spec.md) §2 的健康检查与戳记。本 Plan 只改 `/admin/version` 的呈现 |
| 状态 | **v1.2 已验收**（2026-10-30）。SC-01–SC-10 关闭。代码审阅可交付；CR01、CR02 不阻断验收 |
| 授权边界 | 2026-10-30 取得实施授权，S1 与 S2 已执行。授权范围止于 `webui/src` 的呈现与主 Spec §7 列出的四处文档。不授权改健康检查、构建戳记、镜像 |
| 验收 | SC-01–SC-10 **已验收**（2026-10-30）。测试此前已通过。浏览器验收不在本条出口 |
| 实施主体 | Lucy WebUI `webui/src`。不修改 KTX，不修改 `webui/server` |

## 1. 目标

把 `/admin/version` 从四行等权宽表收成左对齐的三块身份信息：产品版本是阅读焦点，合法构建提交可见前 12 位，随包 KTX 版本以次要文字常驻。未提交改动留在构建提交同一行。

两个交付物：

1. **页面**：按主 Spec §4 重排 `VersionInfo`，短码规则放在 `lucyRevision.ts`。
2. **表面说明**：获批落地后，按主 Spec §7 替换仍要求「页面可见完整 40 位」或「工作区独占一行」的句子。健康检查、戳记、侧栏页脚和导航说明不动。

实施原则：

- 不新增产品名词，不新增颜色 token，不新增折叠状态。
- 复制仍写入完整 40 位。`title` 携带同一值。
- 既有测试 id 保留。

## 2. 开工前置

### S0 文档定稿（已关闭）

第 1 轮 F01–F04 与第 2 轮 F05、F06 已写入 v1.2。D1–D7 以主 Spec §3 为准，不因审阅改写。

| ID | 已拍板 |
|---|---|
| D1 | 可见 12 位，复制与 `title` 为完整 40 位 |
| D2 | 随包 KTX 版本常驻降级，不折叠 |
| D3 | 删除页头说明，保留页头分割线 |

文档已经定稿。定稿本身不授权实施。实施授权于 2026-10-30 取得，S1 与 S2 随后执行。此后若发现文档问题，先修订再复审，不在实施中改写 §3。

## 3. 文件落点

### 3.1 修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/lib/lucyRevision.ts` | 新增 `formatVisibleBuildCommit` | S1 |
| `webui/src/lib/lucyRevision.test.ts` | SC-10 | S1 |
| `webui/src/pages/admin/VersionInfo.tsx` | 身份块替换定义列表；删除说明 | S1 |
| `webui/src/__tests__/version-info.test.tsx` | SC-01–SC-09，含非法提交与类名 | S1 |
| `docs/specs/lucy-20261020-build-revision-identity-spec.md` | 按主 Spec §7 改目标里的附加行、非目标里的完整标识、§2 的构建提交行与工作区行、术语段、设计段的 `pl-card`、SC-6 的页面半句。健康检查四行、戳记和侧栏页脚半句不动 | S2 |
| `docs/governance/version-matrix.md` | 按主 Spec §7 改 §1.2 开头句和 WebUI 表行。`gitSha` / `gitDirty` 两行不动 | S2 |
| `docs/SYSTEM_HANDBOOK.md` | 只改正文里「构建提交是完整 40 位」且「另显示一行工作区状态」的那一段。入口表不改 | S2 |
| `docs/releases/README.md` | 按主 Spec §7 改把版本信息页当作 40 位 commit 读取位置的那句。门禁对台账 `commit` 字段仍要求完整 40 位 | S2 |

### 3.2 不改

- `webui/server/lucy-revision.ts`、`webui/server/index.ts` 的健康检查响应。
- `scripts/release/lucy-build-revision.mjs` 与镜像内 `/app/BUILD_REVISION`。
- `webui/docs/00-product-terminology-standard.md`。本 Spec 的 `New terms: None` 成立。
- `PageHeader` 的分割线样式。不新增 `hideDivider`。
- KTX、Helm、侧栏页脚。
- 导航说明及其镜像：`webui/src/app/navigation.ts`、`webui/docs/06-navigation-ia.md`、`webui/docs/61-help-sidebar-entry-map-spec.md`、`docs/SYSTEM_HANDBOOK.md` 的入口表、`webui/src/__tests__/help-center.test.tsx`。这些句子没有承诺可见文本是完整 40 位，也没有承诺工作区独占一行。帮助中心测试逐字比较 `navGroups.description`。

## 4. 分阶段实施

### S1 页面与短码

1. `formatVisibleBuildCommit` 按主 Spec §5：只匹配 `^[0-9a-f]{40}$` 才 `slice(0, 12)`。空字符串与缺失返回 `unknown`。大写、非十六进制和短串原样返回。
2. `VersionInfo` 去掉 `description`。三块类名按主 Spec §4，不额外加 `mt-4`。
3. 合法提交才设置 `title` 并渲染复制按钮；`onClick` 仍把完整 `gitSha` 交给 `copyTextWithToast`。
4. `version-info-workspace` 只在合法且 `gitDirty === true` 时出现在构建行内，类名含 `text-warning-strong` 与 `text-xs`。
5. 随包 KTX 版本保持常驻，行类名含 `text-xs` 与 `text-fg-muted`。`KTX` 与版本号继续 `translate="no"`。

**出口**：SC-01–SC-10 的组件测试、纯函数测试和对 `app.css` 的静态核对全部通过。任一失败则 S1 未完成。测试通过不宣称验收通过。

### S2 表面说明

1. 按主 Spec §7 改 §3.1 列出的四处文档。每处只替换表里的左列。健康检查、戳记、侧栏页脚和导航说明保持原句。
2. 去掉旧 Spec 顶部的「已定稿、尚未落地」指针，改成「页面呈现以版本信息身份块 Spec 为准」。
3. `webui` 下版本信息相关单测、SC-01 的样式静态核对，以及仓库根的 `npm run lint:terminology` 全部退出码为 0。
4. 仅当上一步全部通过，且 §7 的替换已经落盘时，把主 Spec 与本 Plan 的状态改为「已落地，SC 待验收」，并写明 SC-01–SC-10 的测试已通过。任一失败则不得写成已落地。

**出口**：§7 左列不再要求页面可见完整 40 位，也不再要求工作区独占一行。测试通过不写成验收通过。

## 5. 验收

2026-10-30 用户批准验收。SC-01–SC-10 关闭。代码审阅结论为可交付；CR01（短码长于 12 位时 SC-03 仍绿）与 CR02（第二个 `space-y-4` 时 SC-02 仍绿）不阻断本次验收。浏览器验收不在本条出口。

验收正文是主 Spec §6 的 SC-01–SC-10。本 Plan 不另起编号。

证据要求：

- SC-01 的页面断言落在 `webui/src/__tests__/version-info.test.tsx`。分割线那半句另读 `webui/src/app/app.css`，断言 `.pl-page-header` 仍含 `border-b`，并断言 `VersionInfo.tsx` 不传入隐藏分割线的参数。
- SC-02–SC-09 落在 `webui/src/__tests__/version-info.test.tsx`。类名用 DOM `class` 断言，不新开浏览器。
- SC-10 落在 `webui/src/lib/lucyRevision.test.ts`。
- 健康检查零改动以 `webui/server/lucy-revision.ts` 与健康响应组装处的 diff 为空为准，并保持既有修订测试通过。
- 浏览器点击验收不在本 Plan 范围内。

## 6. 完成定义

同时满足才算本 Plan 做完：

1. 主 Spec 与本 Plan 已定稿。实施授权于 2026-10-30 取得。D1–D7 保持主 Spec §3，未因审阅改写。
2. S1 的代码已在仓库里，且 SC-01–SC-10 的测试全部通过。断言只存在、测试未通过，不算完成。
3. S2 已按主 Spec §7 改完。旧 Spec 的健康检查四行、戳记合同和侧栏页脚半句保持原句。导航说明未被改写。
4. 仓库根 `npm run lint:terminology` 退出码为 0。
5. 仅在第 2、3、4 条都成立时，主 Spec 与本 Plan 的状态句更新为「已落地，SC 待验收」。任一失败则不得更新。
6. `GET /api/health` 的响应形状没有变化。
7. 上述完成不等于 SC 验收通过，也不包含浏览器验收。

## 7. 风险

| 风险 | 表现 | 对策 |
|---|---|---|
| 短码被当成新的产品标识 | 发版台账或走查拿页面可见文本去对 40 位 commit，对不上 | S2 写明对照用复制内容或 `gitSha`。可见文本只是前缀 |
| 非 40 位字符串被切短 | 大写、非十六进制或短串看起来像合法短码，或带上复制按钮 | `formatVisibleBuildCommit` 先匹配小写 40 位。SC-04 与 SC-10 覆盖大写、非十六进制、短串、空值，并在 `gitDirty: true` 时断言没有 `title`、复制和工作区节点 |
| 页头分割线被一并删掉 | 24px 版本号和 16px 页题粘成两个标题 | S1 不改 `PageHeader`。SC-01 静态核对 `.pl-page-header` 仍含 `border-b` |
| 旧 Spec 的页面句子改不干净 | 目标、术语、SC-6 或手册仍要求完整可见提交和独立工作区行 | S2 按主 Spec §7 的左列逐句替换。在审期间旧文顶部指针仍有效 |

## 8. 落盘自查

本表只服务这次审阅，不替代 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新增 Spec / Plan 的落盘清单」。

| # | 结果 |
|---|---|
| 1 | Spec 与 Plan 共用 `lucy-20261030-version-info-identity` |
| 2 | 主 Spec 有「核心流程（伪代码）」 |
| 3 | Spec 头部有文档类型 / 版本与状态。Plan 头部有状态、授权边界、验收 |
| 4 | Plan 有目标、开工前置、验收、完成定义、风险 |
| 5 | Terminology Compliance 含 `This feature follows` 与 `New terms:` |
| 6 | Design System Compliance 为四段式 |
| 7 | 已登记 `docs/README.md` 与 `docs/plans/README.md` |
| 8 | 无新增命令或 CI job |
| 9 | 功能编号为「无」 |
| 10 | 落盘后跑 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary` |
| 11 | 闭口层级为功能合同，上线关系写明「本条收口不表示可上线」 |
