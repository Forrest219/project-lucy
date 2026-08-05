# Table Editor Validation Issue Disclosure Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Editor Validation Issue Disclosure Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器 + API 核实：`/catalog/demo-mysql/dataforai/superstore_orders` 点「校验」仅见 Exit Code 1；API `issues` 含 `._dataforai.yaml: Semantic-layer source YAML must contain an object`；用户批准 P0「把原因露出来」 |
| 适用范围 | 表语义工作台 Header「校验」与右侧「变更审阅 → 校验」结果展示；不改 ktx CLI / 磁盘清理 |
| 输出位置 | `webui/docs/110-table-editor-validation-issue-disclosure-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 110 |
| 关联工单 | `webui/docs/plans/wo-202608-43-table-editor-validation-issue-disclosure.md` |
| 关联页面 | `/catalog/:conn/:schema/:table` |
| 关联台账 | `docs/ui-ux-feedback/pages/catalog.md`（`UX-CATALOG-029`） |
| 上游 Spec | Spec 73（`UX-CATALOG-021` 校验按钮语义）；M3 save/validate |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 校验失败时展示 `issues` 可读列表；Toast 带首条原因；弱化裸 Exit Code；中文主术语；澄清校验对象为已落盘文件 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented：表编辑器校验披露 + 台账 UX-CATALOG-029 Fixed |

## 1. 背景

现场复现（2026-08-06）：

1. 点 Header「校验」后右侧切到「校验」Tab，徽章显示「校验未通过 / Validate 未通过」，面板仅有「Validate 状态：未通过」与「Exit Code：1」。
2. `POST /api/sources/.../validate` 已返回 `issues[]` / `stderr`，前端未渲染。
3. 本例真实原因是容器内 AppleDouble 文件 `semantic-layer/demo-mysql/_schema/._dataforai.yaml` 被 `ktx sl validate` 扫到；**与当前表草稿编辑无关**，但用户无法从 UI 得知。

用户选择并批准 **P0：UI 把原因露出来**。P1（清理 `._*`）与 P2（ktx 忽略 junk）本 Spec 列为非目标。

## 2. 目标

1. 校验完成后，右侧「校验」面板必须展示可读原因：优先 `validation.issues[].message`，否则回退 `stderr` / `stdout` 分行。
2. 失败 Toast 必须包含首条实质问题（过滤仅 `Project: …` 的噪声行）；成功 Toast 使用「校验通过」。
3. 裸「Exit Code」不得作为默认主信息；放入「技术详情」折叠（退出码 + 原始 stderr/stdout）。
4. 面板主术语中文化：禁止以裸英文 `Validate` 作为状态主标签。
5. 增加一句范围说明：校验针对**已保存到磁盘**的语义层文件，不写入；未保存草稿不纳入本次校验。
6. 台账 `UX-CATALOG-029` → `Fixed`（实现后）；本轮不做浏览器验证。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 删除容器 / 仓库中的 `._*` / `.DS_Store` | P1 环境卫生，另开运维动作 |
| 修改 `ktx sl validate` 忽略 junk 文件 | P2 工具链；不在本 WebUI 工单 |
| 改为校验未保存草稿 YAML | 需新 API / dry-run validate；本轮只披露现有契约 |
| 发布工作台校验行展示 issues | 可后置；主题可共用，本单只改表编辑器 |
| 本轮浏览器验证 | 用户明确约束 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`。

本 Spec 登记（实现前写入术语表）：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Semantic Validate | 校验 | 结构校验 | 裸 Validate 作主标签、Validate 未通过（主徽章） | Header 按钮与审阅面板状态 |
| Validation Issue | 校验问题 | 问题详情 | 仅 Exit Code、仅 FAIL | `issues[].message` 列表项 |
| Validation Technical Detail | 技术详情 | 原始输出 | 默认主屏 Exit Code | 折叠：退出码、stderr、stdout |
| Saved Semantic Layer Validate Scope | 已保存语义层 | 磁盘上的语义文件 | 暗示「校验当前草稿」若未实现草稿校验 | 面板说明文案 |

Protected / `notranslate`：文件路径、`ktx`、YAML、stderr/stdout 原文中的英文错误句。

## 5. Target UX

### 5.1 右侧「校验」面板（失败）

```
保存与校验
校验针对已保存到磁盘的语义层文件，不写入；未保存草稿不纳入本次校验。

校验状态          未通过

校验问题
· semantic-layer/demo-mysql/_schema/._dataforai.yaml: Semantic-layer source YAML must contain an object
（可多行；路径与英文错误句 notranslate）

▶ 技术详情
  退出码 1
  <stderr / stdout 原文，可滚动>
```

### 5.2 通过态

```
校验状态          通过
（无校验问题列表；技术详情可省略或仍可展开看空输出）
```

### 5.3 Toast

| 结果 | Toast |
|---|---|
| `ok: true` | `校验通过` |
| `ok: false` 且有实质 issue | `校验未通过：{首条实质 message}`（过长截断至约 160 字） |
| `ok: false` 且无 issue | `校验未通过` |
| 请求抛错（`validationError`） | 已有错误文案；保持 `pl-error` 展示 |

### 5.4 徽章

`SaveStatusBadges` 中「Validate 通过/未通过/失败」改为「校验通过 / 校验未通过 / 校验失败」。

## 6. 行为与数据契约

- 继续调用既有 `POST /api/sources/:conn/:schema/:table/validate`；**不改**响应 shape。
- `ValidationResult.issues` 已存在；前端必须消费。
- 首条实质问题选取规则：
  1. `issues` 中第一条非空且不以 `Project:` 开头的 `message`；
  2. 否则第一条非空 `message`；
  3. 否则 `stderr` 再 `stdout` 按行同样过滤。
- `handleValidateCurrent` 成功/失败 Toast 文案按 §5.3；请求级异常仍走 `validationError`。

## 7. 验收标准

1. Vitest：mock validate `ok:false` + issues → 面板可见问题文案；Toast 含首条问题（若测试可断言 toast）。
2. Vitest：`ok:true` → 「校验通过」；无「Exit Code」作为默认可见主行（技术详情折叠内可有「退出码」）。
3. 徽章/面板无裸主标签「Validate …」。
4. `lint:terminology`、相关 `table-editor` 测试、`build` 通过。
5. 台账 `UX-CATALOG-029` = `Fixed`；README 维护记录与跨页面主题已更新。

## 8. Design System Compliance

- Referenced：`design-system/00-principles.md`（失败态可读）、inspector 既有 `pl-validation-*` / `pl-error`
- Follows：错误用 danger 语义；列表密度对齐变更审阅；不新增第三栏
- Exceptions：技术详情可用原生 `<details>`，不必新组件

## 9. 修订关系

- 补充 Spec 73 / `UX-CATALOG-021`：彼时已记录「有 Exit Code 但缺用途说明」；本 Spec 专治**失败原因不可见**。
- 不修改 validate API；P1/P2 另案。
