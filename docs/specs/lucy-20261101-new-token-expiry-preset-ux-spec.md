# 新建 Token 过期快捷预设 UX Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.2 功能合同已收口** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P2**（签发页局部 polish）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.2 功能合同已收口（2026-11-01）**。SC-01–SC-05 由 `new-token.test.tsx` 关闭。SC-06 术语 lint 于 2026-11-02 拆出，见 [出口拆分记录](../reviews/2026-11-02-functional-contract-exit-split.md)。浏览器走查与 docker 重建不在本条出口。本条收口不表示可上线。**覆盖注记（2026-11-01）**：正文与 SC-02 所写「默认 today+90／初载 90d active」的**现行产品值**改由 [`lucy-20261101-token-default-ttl-365-spec.md`](lucy-20261101-token-default-ttl-365-spec.md) 覆盖为默认 365／初载 365d；本条 segmented 呈现、禁止政策提示句、四档天数集合与上限 365 **仍有效**。历史收口证据不回改 |
| 决策来源 | 对 `http://127.0.0.1:55176/admin/agents/zhangxingchen/tokens/new` 的走查：旧容器仍渲染无样式的 `pl-badge` 预设；仓库源码已用 `pl-btn` 表示选中，但仍违反 Spec 101「选中 ≠ primary」；「默认 90 / 最长 365」提示插在设备备注与过期时间之间，视觉突兀 |
| 需求来源 | 签发页快捷预设需有明确互斥选中态；政策句删除或下移。委托人确认采用方案 B（删除） |
| 实施主体 | `webui/src/pages/admin/NewToken.tsx` 与 `webui/src/__tests__/new-token.test.tsx`。不改 Token API、默认天数、365 上限 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | 对齐 [`webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md`](../../webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md) §5.2 选中态分离；调用监控等页已有的 `pl-segmented-control--cols-4` 为视觉先例。不修订 Token 过期服务端策略 |
| 实施计划 | [`docs/plans/lucy-20261101-new-token-expiry-preset-ux-plan.md`](../plans/lucy-20261101-new-token-expiry-preset-ux-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：新建 Token 页的过期快捷预设以四档 segmented 呈现互斥选中；页面不再展示「默认 90 / 最长 365 / Proxy 拒绝」政策提示句；默认值与日期边界行为不变。
- 本条出口：SC-01–SC-05。组件测试打假 class、`aria-pressed`、默认日期、点选写回、自定义日期无选中、政策提示 DOM 缺席。
- 不在本条出口：SC-06 术语 lint；浏览器走查、Playwright、窄屏、镜像构建、部署、Token 签发 API、Onboarding Step6 短期 Token 下拉。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用 Token、Agent、快捷预设、过期时间。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 过期时间 | 过期时间（必填） | 不变 |
| 快捷预设组 | 快捷预设 | `aria-label` 同步 |
| 预设项 | 30 天 / 90 天 / 180 天 / 1 年 | 天数与标签不变 |

Forbidden:

- 用 `pl-btn--primary` / `pl-btn--danger` 表示当前选中的预设。
- 保留或改写后仍展示整句「新签发的 Token 默认有效期为 90 天，最长为 365 天；到期后 Proxy 立即拒绝访问。」
- 新增「永不过期」入口。

`Token`、`Proxy`（若仍出现在本页其他文案）、Agent id、标签输入使用既有 `notranslate` / `translate="no"` 约定。本条删除的政策句不再占用术语扫描。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md` §5.2
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 选中态未误用 `primary` / `danger`；过期快捷预设走 `pl-segmented-control`
- [x] 页内唯一实心 primary 仍是「生成 Token」
- [x] 颜色与间距使用既有 segmented token，无新增硬编码色值
- [x] 文案与排版符合术语标准；删除冗余政策句
- [x] `aria-pressed` 与可见选中态一致

### Exceptions (If Any)

- None.

### Follow-up Needed

- None。不扩写 Design System 新章节；四档固定列使用已有 `pl-segmented-control--cols-4`。

---

## 1. 背景

1. 运行中的 demo 曾用 `pl-badge` 渲染预设，而样式类已从 `app.css` 移除，选项退化为近似纯文本。
2. 仓库源码已改为 `pl-btn` + 选中 `pl-btn--primary`，但仍与 Spec 101「筛选 / 时间窗不得用 primary 表示选中」冲突，并与页脚主 CTA 抢层级。
3. `pl-notice` 政策句位于设备备注帮助文案与「过期时间」标题之间，样式与字段帮助同级，打断表单分组；默认 90 天、`max=365` 与预设档位已编码同一约束。

## 2. 目标

1. 快捷预设改为四档 `pl-segmented-control pl-segmented-control--cols-4`。
2. 选中项使用 `pl-segmented-control-item--active`，不得使用 `pl-btn--primary`。
3. 删除 `data-testid="new-token-expiry-policy-notice"` 整块及其文案。
4. 保持：默认 `expiresAt = today+90`；日期 `min=today+1`、`max=today+365`；档位 30 / 90 / 180 / 365。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改签发 API / `expires_at` 服务端校验 | 本条只改呈现与选中控件 |
| 改 Onboarding Step6 有效期下拉 | 另一入口；短期体验 Token 口径不同 |
| 恢复或缩短政策提示句 | 方案 B 明确删除 |
| 浏览器 / 移动窄屏验证 | 项目默认不要求；不在本条出口 |

## 4. 页面合同

过期时间区块自上而下：

1. 标签：`过期时间（必填）`
2. `input[type=date]`（既有 `min` / `max` / `aria-label`）
3. 辅助标签：`快捷预设`
4. Segmented 组：`data-testid="new-token-expiry-presets"`，`role="group"`，`aria-label="快捷预设"`
5. 四枚按钮，testid 仍为 `new-token-expiry-preset-${id}`，`id ∈ {30d,90d,180d,365d}`

不得在该区块上方或中间再插入独立政策提示段落。

## 5. 核心流程（伪代码）

```text
PRESETS = [
  { id: "30d", days: 30, label: "30 天" },
  { id: "90d", days: 90, label: "90 天" },
  { id: "180d", days: 180, label: "180 天" },
  { id: "365d", days: 365, label: "1 年" }
]

onMount:
  expiresAt := dateString(today + 90 days)

renderPreset(p):
  active := (expiresAt == dateString(today + p.days))
  class := "pl-segmented-control-item"
           + (active ? " pl-segmented-control-item--active" : "")
  aria-pressed := active
  onClick -> expiresAt := dateString(today + p.days)

onDateInputChange(value):
  expiresAt := value
  # 若 value 不等于任一 preset 日期，则四档 active 均为 false；不回写、不纠正

onSubmit:
  # 既有校验不变：必填、> today、<= today+365
```

伪代码豁免不适用：日期与预设联动有分支，故保留本节。

## 6. 验收（SC）

| ID | 断言 |
|---|---|
| SC-01 | 预设容器含 class `pl-segmented-control` 与 `pl-segmented-control--cols-4`；不含用 `pl-btn--primary` 表达选中的预设按钮 |
| SC-02 | 初载：日期为 today+90；`new-token-expiry-preset-90d` 含 `--active` 且 `aria-pressed="true"`；其余三档 `aria-pressed="false"` |
| SC-03 | 点击「30 天」后日期为 today+30，且仅 30d 为 `--active` |
| SC-04 | 将日期改为不等于任一预设的合法日时，四档均无 `--active` |
| SC-05 | DOM 中不存在 `new-token-expiry-policy-notice`，也不存在「默认有效期为 90 天」可见文案 |
| SC-06 | **拆出。** 术语 lint 是过程门禁，不在本条出口 |

测试落点：优先扩展 `webui/src/__tests__/new-token.test.tsx`。浏览器走查不在出口内；实现后可用 demo WebUI 人工确认，但不作为收口门禁。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| demo 镜像未重建仍显示旧 UI | 实现后对 lucy 做缓存重建升级；与本条出口分离 |
| 既有 e2e 选择器依赖 button name | 保留「30 天」等可见文案与 role=button；real-e2e 的 `role=button[name=/^30 天$/]` 应仍可用 |
| selector-contract 仍登记 policy notice | 实现时同步删或改 `docs/qa/selector-contract.md` 对应行 |
