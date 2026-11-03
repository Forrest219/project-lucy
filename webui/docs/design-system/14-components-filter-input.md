# Lucy WebUI 筛选栏输入框组件规范

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI 筛选栏输入框组件规范 |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-30 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | [`docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md`](../../../docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md) v1.0（§5 实现合同） |
| 适用范围 | 全站**筛选栏**的**文本**输入框／文本域；不含 `<select>`、勾选框、日期与非受控输入框 |
| 输出位置 | `webui/docs/design-system/14-components-filter-input.md` |

> **事实源说明**：本章落地**前**，本约束的事实源是
> [`docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md`](../../../docs/specs/lucy-20261029-url-driven-input-ime-composition-spec.md)
> §5（实现合同）。本章落地**后**，本章是规范正文，Spec §5 保留为实现合同与验收依据。

## 1. 目的

规定筛选栏文本输入框的 **`value` 源**、URL 跟随方式与清除动作，消除「受控值取自路由状态」
这一写法——它在中文输入法（IME）组合进行中会被浏览器取消组合。

## 2. `value` 源：局部状态驱动，URL 跟随

**强制**：筛选栏文本输入框的 `value` 必须由**组件本地状态**驱动；URL 是**下游事实源**，
跟随本地状态。

```
✗ value={searchParams.get("user") ?? ""}          ← URL 驱动：组合会被打断
✓ value={userDraft}                                 ← 局部状态驱动：URL 跟随
```

**为什么**：路由导航是异步的，React 会先用**旧 URL 值**渲染一帧。那一帧里 `value` prop ≠ DOM
当前值，React 于是写 `node.value`；Chrome 在 IME 组合进行中收到 `node.value` 写入即**取消当前
组合**，拼音缓冲由「替换」退化为「追加」（见 Spec §1.3）。

**不适用**：`<select>`、勾选框、日期等非文本输入不承载 IME 组合，不受本章约束；
非受控输入框（`defaultValue`）React 不回写其 `value`，也不受本章约束。

### 2.1 落地形态

统一使用 `webui/src/lib/useUrlMirroredField.ts` 的 `useUrlMirroredField({ read, write, history })`：

| 参数 | 含义 |
|---|---|
| `read(searchParams)` | 读出该字段当前应显示的文本。多个 URL 参数聚合成一个输入框时在这里聚合。 |
| `write(prev, raw)` | 由 `prev` 与**原文**产出下一份 `URLSearchParams`。**不得改写 `raw`。** |
| `history` | `"push"` 或 `"replace"`，**保持调用点现状**（目录是 `replace`，其余是 `push`）。 |

## 3. 写入契约

- `setSearchParams` **必须使用函数式更新**，从 `prev` 拷贝后再改本字段。禁止
  `new URLSearchParams(searchParams)` 闭包快照。
- 落进 URL 的是**原文**。分类、查询、提交可以在**消费点** `trim`，但**不得**把 trim 后的值
  写回受控 state，也**不得**把变换后的字符串写进 URL 再靠反向同步抹掉空格。
- 每次按键即写 URL（不做防抖）。地址栏随时等于当前筛选。
- URL 参数名与含义**保持不变**：深链、分享链接、外部跳转继续可用。

## 4. 反向同步：回声协议

无条件 `setDraft(urlValue)` 会在连续按键时把草稿打回较早的 URL 值——输入法下一次按键经常
快过路由提交，于是 React 在组合中改 `node.value`，组合再次被打断。

**位置变化到达时**（`urlValue` = 当前 URL 派生的显示值；`navType` 来自
`useNavigationType()`）：

| 情形 | 动作 |
|---|---|
| `navType == POP`（浏览器后退／前进） | 清空 pending／superseded，采用 URL。**即使用户正在组合也采用。** |
| `urlValue` == 最新一次本地提交 | 确认它，把未确认的旧值盖进 superseded（最多 8 条）。**不写草稿。** |
| `urlValue` 在 pending 里（更早一次提交晚到） | 吃掉该前缀。**不写草稿。** |
| `urlValue` 在 superseded 里（更新的提交已确认后旧值又晚到） | **不写草稿。** |
| 其余 PUSH／REPLACE（深链、hydration、清除、抽屉回填、其它入口） | 清空 pending／superseded，采用 URL。 |

**同值回声不调用 `setDraft`。**

## 5. 清除动作必须 `reset`

「清除筛选」这类动作**只改 URL 是不够的**：若某个参数本来就是空的，URL 派生的显示值不变，
反向同步不会触发，输入框会留下旧文本。

**强制**：清除动作必须对**每一个**镜像调用 `reset(nextValue)`（该字段清除后的显示值，通常是
`""`）。`reset` 同时清掉 pending／superseded。

```tsx
function clearFilters() {
  // …重建 URL…
  setSearchParams(next);
  userMirror.reset("");
  toolMirror.reset("");
  // …每个镜像都要 reset
}
```

## 6. 三条不变量

| 编号 | 不变量 | 成立条件 |
|---|---|---|
| **INV-1** | **组合存活**：组合进行中 `value` prop 与 DOM 值**恒等** ⇒ React 永不写 `node.value` ⇒ Chrome 不取消组合。 | `value` 由局部状态驱动（§2）＋ 回声协议（§4）。 |
| **INV-2** | **禁止变换写回**：`onChange` 中**不得**对 `e.target.value` 做 `trim`／大小写／拆分／过滤后再 `setState`，也**不得**把变换后的字符串写进 URL。 | 受控输入框的值 = 用户输入的原文；规范化只发生在下游消费点（§3）。 |
| **INV-3** | **不得脱节**：后退、深链、hydration、清除筛选、其它入口改同一参数，最终都必须把草稿拉回 URL 所表达的文本。 | 反向同步（§4）＋ 清除动作调用 `reset`（§5）。 |

## 7. 防回归

- **静态门禁**：`npm run lint:url-driven-input` 扫描 `webui/src`，判定依据是 `value` 表达式的
  **来源**（不是 `onChange` 是否写 URL）。**不设白名单。**
- **真浏览器验收**：`node webui/scripts/ime-composition-probe.mjs` 用系统 Chrome ＋ CDP
  `Input.imeSetComposition` 逐处断言组合存活。**jsdom 不可复现，不得充当验收证据。**
- 命令登记见 [`docs/governance/test-layers-and-release-gates.md`](../../../docs/governance/test-layers-and-release-gates.md)
  §2／§8。

## 8. 验收

| 项 | 判定 |
|---|---|
| `value` 源 | 输入框的 `value` 不取自 URL 派生变量 |
| 写入 | 用户键入后 URL 立即等于输入原文（末尾空格保留）；消费值在发请求前 trim |
| 深链 | 打开带参 URL 时输入框显示该值 |
| 后退／前进 | POP 后输入框回到该历史条目的值，即使焦点仍在输入框内 |
| 清除 | 清除筛选后输入框清空且 URL 无对应参数；参数原本为空时也必须清空 |
| 组合 | 真浏览器下 `compositionstart` = 1、最终 DOM 值 = 目标文本、组合期间 `value` setter = 0、焦点保持 |
