# 版本信息身份块 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / v1.2 |
| 日期 | 2026-10-30 |
| 功能编号 | 无。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **已落地，SC 待验收**。SC-01–SC-10 的测试已通过（组件测试与纯函数测试），浏览器点击验收不在范围内。2026-10-30 取得实施授权；D1–D7 未因审阅改写 |
| 决策来源 | 2026-10-30 对 `http://127.0.0.1:55176/admin/version` 的页面审阅。用户拍板短显 12 位、随包 KTX 版本常驻降级、删除页头说明；随后确认保留页头分割线、脏状态用 `text-warning-strong`、只对合法 40 位提交取短码、层间距只使用一次 `space-y-4` |
| 需求来源 | 版本信息页把产品版本、40 位构建提交、工作区诊断和随包 KTX 版本排成等权宽表 |
| 实施主体 | Lucy WebUI `webui/src/pages/admin/VersionInfo.tsx` 与 `webui/src/lib/lucyRevision.ts`。不修改 KTX，不修改 `GET /api/health` |
| 与既有 Spec 的关系 | 修订 [`lucy-20261020-build-revision-identity-spec.md`](lucy-20261020-build-revision-identity-spec.md) §2 里 `/admin/version` 的四行呈现。构建戳记、`gitSha`、`gitDirty`、`lucyVersion`、`bundledKtxVersion` 的取值规则仍以该文为准。本文落地后，`/admin/version` 的页面呈现以本文为准；该文的健康检查、戳记与侧栏页脚规则不变 |
| 实施计划 | [`docs/plans/lucy-20261030-version-info-identity-plan.md`](../plans/lucy-20261030-version-info-identity-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：版本信息页以产品版本为阅读焦点；合法构建提交的可见文本是前 12 位，复制与 `title` 仍是完整 40 位；随包 KTX 版本以次要文字常驻；未提交改动只在构建提交同一行出现。
- 本条出口：SC-01–SC-10。组件测试打假可见文本、复制内容、`title`、非法提交分支、脏状态是否占位，以及 §4 的类名。页头分割线用静态核对，不新增浏览器出口。
- 不在本条出口：整库旅程、Agent 路径、浏览器走查、发版台账对照、镜像重建、证据等级。
- 上线关系：本条收口不表示可上线

## 1. 现象

2026-10-30 在运行中的版本信息页取证：

- 页头说明是「核对这次运行对应的产品版本和构建提交。」
- 一张通栏定义列表用 `py-4` 和行间分割线并列四行：产品版本 `v0.20.0`、完整构建提交、工作区「构建时工作区有未提交改动」、随包 KTX 版本 `0.16.0`。
- 40 位提交把该行撑满，复制按钮离开短码旁边的可视区域。
- 该实例 `gitDirty === true`，所以工作区诊断与产品版本同一权重。

## 2. 范围

### 2.1 本期包括

- `/admin/version` 的页头说明、身份块排版、构建提交的可见长度、复制载荷、脏状态的位置与颜色、随包 KTX 版本的字号。
- `formatVisibleBuildCommit`：只对合法 40 位小写十六进制取前 12 位。
- 获批落地时，按 §7 替换仍把页面写成「可见完整 40 位」或「工作区独占一行」的句子。健康检查、构建戳记、侧栏页脚和导航说明保持原句。

### 2.2 本期不包括

- `GET /api/health` 的字段名、取值、`unknown` 与 `gitDirty` 规则。
- 构建戳记 `/app/BUILD_REVISION`、镜像标签、Helm、侧栏页脚。
- 构建时间、镜像摘要、Chart 版本、Node、平台。
- 新的折叠控件、新的颜色 token、新的按钮样式。
- 移动窄屏验证。

## 3. 决策

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 短显长度 | 合法提交的可见文本是 `gitSha.slice(0, 12)`。复制写入完整 40 位。短码节点的 `title` 也是完整 40 位 |
| D2 | 随包 KTX 版本 | 常驻。不用折叠。整行 `text-xs text-fg-muted`，版本号另加 `font-mono` |
| D3 | 页头说明 | 删除。保留面包屑「系统设置」、标题「版本信息」，以及既有 `.pl-page-header` 的底部分割线。不给 `PageHeader` 增加隐藏分割线的参数 |
| D4 | 脏状态 | 仅当提交合法且 `gitDirty === true` 时，渲染在构建提交同一行末尾。文案仍是「构建时工作区有未提交改动」。颜色是 `text-warning-strong`，字号 `text-xs`。为假时不渲染该节点 |
| D5 | 非法提交 | 不是 40 位小写十六进制时，可见文本原样显示（缺失为 `unknown`）。不取短码，不设 `title`，不渲染复制按钮，不渲染脏状态 |
| D6 | 容器 | 左对齐 `max-w-xl space-y-4`。三块是产品版本组、构建行、KTX 行。产品版本组内是 `gap-1`。KTX 行不再叠加 `mt-4`。不使用通栏卡片，不使用行间分割线 |
| D7 | 后端 | 零改动。页面仍读现有 `/api/health` |

## 4. 呈现

三块自上而下：

```text
系统设置
版本信息
────────
产品版本
v0.20.0

构建提交  8838c5ce6615  复制  构建时工作区有未提交改动
随包 KTX 版本  0.16.0
```

分隔线来自既有页头，不是身份块自己的边框。`gitDirty === false` 时，脏状态那句不占 DOM。

| 块 | 类名 |
|---|---|
| 容器 | `max-w-xl space-y-4` |
| 「产品版本」标签 | `text-xs text-fg-muted` |
| 产品版本值 | `text-2xl font-semibold tracking-tight text-fg-default`，并带 `translate="no"` 与 `notranslate` |
| 构建行 | `flex flex-wrap items-center gap-3 text-sm` |
| 「构建提交」标签 | `text-fg-muted` |
| 短码 | `font-mono text-fg-default`，并带 `translate="no"` 与 `notranslate` |
| 复制 | 既有 `pl-btn pl-btn--ghost text-sm`。成功提示仍是「已复制构建提交」，失败提示仍是「复制失败，请重试」 |
| 脏状态 | `text-warning-strong text-xs` |
| KTX 行 | `text-xs text-fg-muted`。`KTX` 与版本号各自带 `translate="no"` 与 `notranslate`。版本号另加 `font-mono` |

保留这些 `data-testid`：`version-info`、`version-info-loading`、`version-info-error`、`version-info-product`、`version-info-sha`、`version-info-copy`、`version-info-workspace`、`version-info-ktx`。`version-info-workspace` 放在构建行内，不再独占一行。

加载句仍是「正在加载版本信息…」。请求失败仍显示接口错误，不编造提交。

## 5. 核心流程（伪代码）

```text
SHA = ^[0-9a-f]{40}$

function visibleCommit(sha):
  if sha matches SHA: return sha.slice(0, 12)
  if sha is a non-empty string: return sha
  return "unknown"

function renderVersionPage(health):
  product = formatLucyVersionLabel(health.lucyVersion)
  sha = health.gitSha if it is a string else "unknown"
  show header "版本信息" with breadcrumb "系统设置" and no description
  show product label and product value

  show label "构建提交"
  show visibleCommit(sha) on the sha node
  if sha matches SHA:
    set that node's title to sha
    show copy button; click writes sha
    if health.gitDirty is true:
      show "构建时工作区有未提交改动" in the same row
  else:
    omit title, copy button, and dirty status

  show "随包 KTX 版本" and formatBundledKtxVersion(health.bundledKtxVersion)
```

`formatLucyVersionLabel` 与 `formatBundledKtxVersion` 沿用现有实现。页面可见文本不含 `dirty`。

## 6. 验收

| 编号 | 断言 |
|---|---|
| SC-01 | 页头有「版本信息」和「系统设置」，没有「核对这次运行对应的产品版本和构建提交。」`VersionInfo` 不向 `PageHeader` 传入隐藏分割线的参数，也不覆盖 `.pl-page-header`。静态核对 `webui/src/app/app.css` 里 `.pl-page-header` 仍含 `border-b` |
| SC-02 | 产品版本可见文为 `v0.20.0` 这一类 `vX.Y.Z`，测试 id 仍是 `version-info-product`，值的类名含 `text-2xl`。身份块容器类名含 `max-w-xl` 与 `space-y-4`。产品版本组类名含 `gap-1`。容器、构建行、KTX 行都没有 `mt-4` |
| SC-03 | 合法 40 位小写提交的可见文是前 12 位；该节点 `title` 是完整 40 位；点击复制写入完整 40 位 |
| SC-04 | 下列输入都设 `gitDirty: true`。缺字段与空字符串的可见文是 `unknown`。`unknown`、40 位大写十六进制、含非十六进制字符的 40 位、7 位小写十六进制都原样显示。这些情况都没有 `title`、没有复制按钮、没有 `version-info-workspace` |
| SC-05 | 合法提交且 `gitDirty === true` 时，「构建时工作区有未提交改动」与短码在同一行。该节点测试 id 为 `version-info-workspace`，类名含 `text-warning-strong` 与 `text-xs`。它不是单独的定义列表行 |
| SC-06 | 合法提交且 `gitDirty === false` 时，不渲染 `version-info-workspace` |
| SC-07 | 随包 KTX 版本常驻可见。该行类名含 `text-xs` 与 `text-fg-muted`，且没有 `mt-4`。版本号类名含 `font-mono`。页面没有名为「组件」的展开控件 |
| SC-08 | 页面可见文本不含 `dirty`。复制按钮类名含 `pl-btn--ghost` |
| SC-09 | 健康检查失败时显示接口错误，不渲染身份块，不编造提交 |
| SC-10 | `formatVisibleBuildCommit` 对 40 位小写提交返回前 12 位。对 `0.2.0`、7 位短串、`unknown`、40 位大写十六进制、含非十六进制字符的 40 位原样返回。空字符串与缺失返回 `unknown` |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

沿用「版本信息」「产品版本」「构建提交」「随包 KTX 版本」「构建时工作区有未提交改动」。不把构建提交改名为构建标识，不把脏状态改写成「非正式构建」。`KTX`、产品版本、构建提交和随包 KTX 版本号保持 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 阅读焦点是产品版本；构建提交与随包 KTX 版本用字号和颜色降级
- [x] 复制沿用 `pl-btn--ghost`，不新增按钮层级
- [x] 页头仍是既有 `PageHeader`，可见主动作只有复制
- [x] 脏状态使用 `text-warning-strong`，不新增硬编码色值
- [x] 三块间距使用一次 `space-y-4`，组内使用 `gap-1`
- [x] 文案沿用既有术语
- [x] 复制按钮保持可键盘访问；加载与错误状态保留

### Exceptions (If Any)

- 产品版本值使用 `text-2xl`，大于页题的 16px。这是本页的阅读焦点。页头分割线保留，版本号与页题分属两个区域。
- 身份块不使用 `pl-card`。本页只有一组只读身份，不再套通栏卡片。

### Follow-up Needed

- None。不新增设计系统章节。

## 7. 表面说明的替代

落地时只改下表左列。右列是替代关系。健康检查字段、构建戳记、侧栏页脚不在表内。

| 现行句子 | 替代 |
|---|---|
| 构建修订 Spec 目标里的「三行」和「工作区状态……作为附加行出现」 | 常驻仍是产品版本、构建提交、随包 KTX 版本。工作区状态不是独立行，排版以本文 §4 为准 |
| 构建修订 Spec 非目标里的「版本信息页直接显示完整提交标识」 | 不发明新名词。可见文本是前 12 位；完整标识在 `title` 与剪贴板 |
| 构建修订 Spec §2 的「构建提交」行 | 可见前 12 位；`title` 与复制是完整 40 位小写十六进制，或非法值按本文 §5 原样 / `unknown` |
| 构建修订 Spec §2 的「工作区」行 | 不独占一行。合法提交且 `gitDirty` 为真时，在构建行内显示原句 |
| 构建修订 Spec 术语段「另显示一行工作区状态」 | 改为「在构建提交同一行显示工作区状态」 |
| 构建修订 Spec 设计段「使用……`pl-card`」 | 删去 `pl-card`。身份块无卡片；`PageHeader` 与 `pl-btn--ghost` 保留 |
| 构建修订 Spec SC-6 里「完整 `gitSha`」和「另展示一行工作区状态」 | 页面半句改指向本文 SC-03、SC-05、SC-06。侧栏页脚那半句保持原句 |
| `docs/governance/version-matrix.md` §1.2 开头「版本信息页与 `/api/health` 展示源提交」，以及表内 WebUI 行的 full `gitSha` | 健康检查仍是完整 40 位。页面可见文本是前 12 位；完整值在 `title`、复制内容和 `gitSha` |
| `docs/SYSTEM_HANDBOOK.md` 里「构建提交是完整 40 位」且「另显示一行工作区状态」的那一段 | 页面可见文本是前 12 位；复制或 `gitSha` 才是完整提交。脏状态在构建行内，不独占一行。同页入口表那句通用说明不改 |
| `docs/releases/README.md` 把版本信息页列为读取 40 位 commit 的位置 | 改为：页面可见前 12 位；完整提交看复制内容、`/api/health.data.gitSha` 或 `/app/BUILD_REVISION` |

不改这些仍然成立的导航说明，也不改镜像它们的测试：「查看产品版本、构建提交和随包 KTX 版本；有未提交改动时显示工作区状态。」事实源是 `webui/src/app/navigation.ts`。`webui/docs/06-navigation-ia.md`、`webui/docs/61-help-sidebar-entry-map-spec.md`、`docs/SYSTEM_HANDBOOK.md` 的入口表、`webui/src/__tests__/help-center.test.tsx` 保持原句。
