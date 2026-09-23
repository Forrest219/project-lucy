# 发布工作台校验口径 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 发布工作台校验口径 Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-23 |
| 撰写人 | Grok |
| 委托人 | xingchen |
| 基于材料 | 2026-09-23 生产只读核查 `http://10.69.95.109:8276/publish/workbench`（v0.16）：120 个待同步文件在「校验中… / 处理中…」停留后，结果为「校验通过 27 张」；`webui/src/pages/publish/PublishWorkbench.tsx`；Spec 115 / 119 / 121 / 123 / 136 |
| 适用范围 | `/publish/workbench` 页眉与生效准备中的校验进行态、完成态文案；不改变整批同步契约 |
| 输出位置 | `webui/docs/145-publish-validation-count-clarity-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 145 |
| 关联工单 | `webui/docs/plans/wo-202609-23-skill-hub-and-publish-clarity.md` |
| 关联页面 | `/publish/workbench` |
| 上游 Spec | Spec 123（步骤与 CTA 用词）；Spec 115（校验 issues 披露）；Spec 119（队列–门禁布局） |
| 状态 | Implemented |
| 日期 | 2026-09-23 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：待同步文件数与表语义校验数分列；校验进行中给出对象说明 |
| v1.1 | Implemented：`PublishWorkbench.tsx` 页眉徽标、步骤条、校验摘要、Toast 按本 Spec 改写；新增 SC-145-01 至 SC-145-05 测试（`review.test.tsx`） |

## 1. 背景

生产现场一批变更包含 120 个待同步文件。页眉按钮长时间显示「校验中…」和「处理中…」，结束后显示「校验通过 27 张」。用户无法判断：

- 校验是否还在进行，还是界面卡住。
- 「校验成功」是否覆盖全部 120 个文件。

代码里这两个数本来就不是同一集合：待同步文件含 Wiki 与其它路径；表语义校验只覆盖进入 `validate-changed` 的表。文案把二者并置，又没有分母和对象，造成「假成功」感。

## 2. 目标

1. 校验进行中，用户能看出正在校验的是表语义，而不是逐个文件。
2. 校验结束后，待同步文件数与表语义校验结果分列，且表语义结果带分母。
3. 当待同步文件数大于进入表校验的表数时，明确其余文件随本批同步、不逐份做表语义校验。
4. 不改变「本批一并同步、不可分文件勾选」的发布契约。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 分文件勾选同步 | Spec 119 已排除；本 Spec 不重开 |
| 为每个 Wiki 文件增加语义校验 | 没有对应校验器；不得假装已校验 |
| 校验进度百分比 | 当前校验是单次请求，没有逐表进度事件；禁止编造百分比 |
| 改 `/api/diff`、`/api/validate-changed`、reindex 的请求协议 | 只改展示；若响应里已有逐表结果，只消费现有字段 |
| 重做 Spec 136 的视觉重构 | 本 Spec 只改计数与进行态文案 |

## 4. 产品行为

页眉保留「N 个待同步文件」。它只表示本批将同步的文件数。

表语义结果使用独立文案，禁止再使用不带对象的「校验通过 N 张」或单独的「校验成功」作为整批结论。

| 阶段 | 页眉 / 生效准备 |
|---|---|
| 无待同步文件 | 保持现有空态；不出现表语义校验数 |
| 校验请求未返回 | 「正在校验表语义…」；按钮保持禁用；展示已经过秒数 |
| 返回且失败表数 > 0 | 「表语义校验失败 F 张」；issues 仍按 Spec 115 披露；同步 CTA 保持不可用 |
| 返回且失败表数 = 0 且表数 > 0 | 「表语义校验通过 A/B」；A = B |
| 返回且表数 = 0 | 「无可校验表」；不得写成校验通过 |
| 待同步文件数 > B | 附加一句：「其余 N−B 个文件随本批同步，不逐份做表语义校验。」 |

步骤条上的「校验」完成态与页眉使用同一句「表语义校验通过 A/B」，不再只写「校验中…」直到请求结束却不解释对象。

## 5. 核心流程（伪代码）

```text
files = pending sync files
on files.length == 0:
  show "暂无待同步变更"
  stop

show "{files.length} 个待同步文件"
start validate request
show "正在校验表语义…" and elapsed seconds
disable 校验变更 and 同步索引并生效

on validate response:
  B = results.length
  F = count(results where not ok)
  A = B - F
  if F > 0:
    show "表语义校验失败 {F} 张"
    keep sync disabled
    show issues
  else if B == 0:
    show "无可校验表"
    keep sync disabled
  else:
    show "表语义校验通过 {A}/{B}"
    if files.length > B:
      show "其余 {files.length - B} 个文件随本批同步，不逐份做表语义校验。"
    enable 同步索引并生效
```

`正在校验表语义…` 对应 SC-145-01。`A/B` 与其余文件说明对应 SC-145-02、SC-145-03。失败与零表对应 SC-145-04、SC-145-05。

## 6. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` §4.3.

New terms:

- `N 个待同步文件`：本批文件数，含非表文件。
- `表语义校验通过 A/B`：只描述表语义校验。
- `正在校验表语义…`：进行态。禁止用「校验成功」概括整批 120 个文件。

既有用词继续有效：审阅变更、同步索引、同步索引并生效、全量重建索引。

## 7. Design System Compliance

- 不新增组件、颜色或按钮层级。
- 进行态沿用现有禁用按钮与步骤条；只替换文案并增加已过秒数。
- 其余文件说明使用现有 `pl-notice` / 次级说明，不新做 Banner 变体。
- 引用：`webui/docs/design-system/10-components-button.md`、`01-foundations-color.md`（失败态沿用现有错误色）。

## 8. 验收

| ID | 断言 |
|---|---|
| SC-145-01 | 校验请求未返回时，可见「正在校验表语义…」和已过秒数；同步 CTA 禁用 |
| SC-145-02 | 27 张表全部通过、待同步文件为 120 时，同时可见「120 个待同步文件」和「表语义校验通过 27/27」 |
| SC-145-03 | 上例中可见「其余 93 个文件随本批同步，不逐份做表语义校验。」 |
| SC-145-04 | 存在失败表时可见「表语义校验失败 F 张」，同步 CTA 不可用，issues 仍可见 |
| SC-145-05 | 校验结果为空时可见「无可校验表」，不出现「校验通过」 |
| SC-145-06 | 页面不再把整批文件称为「校验成功」或「校验通过 N 张」 |
| SC-145-07 | 术语检查通过；既有发布工作台测试改为断言新文案 |

数字 120 与 27 是生产观察样本。测试使用夹具中的任意 `files.length > results.length` 即可，不必固化这两个数。

## 9. 与上游 Spec 的关系

- Spec 123 的步骤名和主 CTA 名称不变。
- Spec 115 的 issue 列表不变；本 Spec 只规定摘要句。
- Spec 136 的视觉重构未完成，不作为本 Spec 的前置。若两者同时改 `PublishWorkbench.tsx`，计数文案以本 Spec 为准。
