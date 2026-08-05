# Publish Workbench Validation Disclosure and Semantic Junk Scrub Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish Workbench Validation Disclosure and Semantic Junk Scrub Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核实发布门禁「校验失败」不展示 issues；根因 `._dataforai.yaml`；Spec 110 将工作台披露列为 Non-Goal；用户批准改善方案 |
| 适用范围 | `/publish/workbench` 校验摘要与 Toast；`validateSource` 前清理 semantic-layer junk；上传文件名拒绝 `._*` |
| 输出位置 | `webui/docs/115-publish-workbench-validation-disclosure-and-junk-scrub-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 115 |
| 关联工单 | `webui/docs/plans/wo-202608-48-publish-workbench-validation-disclosure-and-junk-scrub.md` |
| 关联页面 | `/publish/workbench`；校验链路共用 `ktx.ts` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-workbench.md`（`UX-PUBLISH-WORKBENCH-004`）；修订 `UX-CATALOG-029` Notes |
| 上游 Spec | Spec 110（表编辑器披露样板）；Spec 112（门禁 IA） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 工作台展示校验问题；Toast 首因；校验前 scrub AppleDouble/`.DS_Store`；上传拒收 junk 文件名 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented：工作台 issues 披露 + scrub + 上传拒收 + 台账 Fixed |

## 1. 背景

1. Spec 110 已让表编辑器展示 `issues`；发布工作台仍只显示 `OK`/`FAIL` +「退出码」，门禁阻断时用户看不到 `._dataforai.yaml: Semantic-layer source YAML must contain an object`。
2. 不改 ktx 二进制的前提下，WebUI 可在调用 `ktx sl validate` **之前**删除 `semantic-layer/**/._*` 与 `.DS_Store`，避免 junk 阻断真实语义校验。
3. 上传路径 `isValidFilename` 当前允许 `._foo.yaml`，应拒绝。

## 2. 目标

1. 校验摘要每行失败时：中文「未通过」；列出过滤 `Project:` 噪声后的 **校验问题**；退出码/原始输出入「技术详情」。
2. Toast：有失败时优先 `formatValidationFailureToast`（首条实质问题），可带「N 张表」前缀。
3. `validateSource` 开头调用 `scrubSemanticLayerJunk(projectRoot)`（仅删 junk 文件名，经 `safeRemove`）。
4. 语义资产上传：`isValidFilename` 拒绝以 `._` 开头或名为 `.DS_Store` 的**松散文件**条目；zip/tar 包内同类 junk **跳过**（不整包失败）。
5. 台账 `UX-PUBLISH-WORKBENCH-004` → `Fixed`；延伸跨页主题 `validation failure disclosure`；修订 Spec 110 Non-Goal 指向本 Spec。
6. 本轮不做浏览器验证。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 修改 ktx CLI 忽略规则 | 工具链另案；本轮用 scrub |
| 表编辑器导入安全 | Spec 114 |
| 递归删除非 junk 文件 / 改用户业务 YAML | 禁止 |
| 本轮浏览器验证 | 用户约束 |

## 4. Terminology Compliance

沿用 Spec 110：`Semantic Validate` / `Validation Issue` / `Validation Technical Detail`。

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Validation Pass/Fail (workbench row) | 通过 / 未通过 | 裸 OK / FAIL 作唯一主状态 | 校验摘要行 |
| Semantic Layer Junk File | 语义层垃圾文件 | 用户业务 YAML | `._*` / `.DS_Store` |

## 5. Target UX（校验摘要失败行）

```
demo-mysql/chatbi/ai_intl_ad_daily          未通过

校验问题
· semantic-layer/.../._dataforai.yaml: Semantic-layer source YAML must contain an object

▶ 技术详情
  退出码 1
  <stderr/stdout>
```

通过行：主状态「通过」；可不列问题。

Toast 示例：`校验未通过（1/1）：semantic-layer/.../._dataforai.yaml: ...`

## 6. 行为与数据契约

### 6.1 Frontend

- 复用 `src/pages/semantic/validation-utils.ts`。
- `POST /api/validate-changed` 响应 shape 不变。

### 6.2 `scrubSemanticLayerJunk`

- 遍历 `semantic-layer/`（跳过 symlink）；文件名 `=== ".DS_Store"` 或 `startsWith("._")` → `safeRemove`。
- 返回已删相对路径列表（供测试断言）；错误不阻断 validate（best-effort：单文件失败记日志可省略，继续删其余）。
- `validateSource` 在 spawn ktx **之前** await scrub。

### 6.3 Upload

- 松散文件 `isValidFilename`：basename 不得以 `._` 开头；不得为 `.DS_Store`。
- zip/tar：`shouldSkipPackageJunkEntry` 跳过 junk basename，其余非法路径仍 `PACKAGE_PARSE_FAILED`。

## 7. 验收标准

1. Vitest `review.test.tsx`：失败 validate mock 含 issues → UI 可见问题文案；无默认主行仅「FAIL」。
2. Vitest scrub：临时目录放入 `._x.yaml` + 正常 yaml → scrub 后 junk 消失、正常文件保留；`validateSource` mock/spy 证明先 scrub。
3. 上传/classify 相关测试：`._evil.yaml` 被拒。
4. `lint:terminology`、`build` 通过。
5. 台账与 README 跨页面主题已更新。

## 8. Design System Compliance

- Referenced：Spec 110 面板模式、`pl-validation-*`
- Follows：失败可读；技术细节折叠
- Exceptions：工作台行密度保持既有 `pl-validation-row`

## 9. 修订关系

- Spec 110 §3「发布工作台校验行展示 issues」Non-Goal → 由本 Spec 承接；更新 Spec 110 交叉引用一句。
- Spec 112 门禁文案保留；本 Spec 只充实校验摘要可读性。
