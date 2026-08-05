# Publish Workbench Feedback

本页记录 `/publish/workbench`（发布工作台）相关 UI/UX 反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

## UX-PUBLISH-WORKBENCH-001: 发布流程不可发现

Status: Fixed
Route: `/publish/workbench`
Area: Page-level publish flow / wayfinding
Severity: P1
Reported: 2026-08-06

### Feedback
用户反馈「没搞清楚发布流程是啥」：进入工作台后看不到「先做什么 → 再做什么 → 最后发布」的清晰路径；Header 动作、左栏文件、中栏 Diff、右栏影响/校验块之间没有流程叙事。

### Evidence
- Screenshot: [`../assets/publish-workbench/UX-PUBLISH-WORKBENCH-001-003.png`](../assets/publish-workbench/UX-PUBLISH-WORKBENCH-001-003.png)
- 浏览器：页头 description 仅一句「查看并发布…自动重建 KTX 索引」，无步骤指示。
- Header 并排 6 个动作（校验 / 强制重建 / 上传 / 发布 / 表目录 / 导出），无「当前步骤」或 gate 说明。
- 右栏另有「校验变更」「KTX 索引」「建议命令」静态说明块，与 Header 动作重复且不构成可执行流程。
- 「发布并重建索引」在未校验时为 disabled secondary，但旁侧无「为何不可点 / 下一步点哪里」。

### Expected
首屏能回答：主路径是什么、当前卡在哪一步、下一步该点哪个按钮。建议形态之一：
- 轻量步骤条 / 状态行（如：审阅变更 → 校验 → 发布并重建索引），或
- 右栏收敛为「发布门禁」单一审阅区（待发布数 / 校验结果 / 阻断原因 / 主 CTA），
禁止再靠并列 6 按钮 + 三块说明靠用户自己拼流程。

### Browser Check
1. Open `/publish/workbench` with ≥1 pending file and without having validated.
2. Confirm a new user can identify the recommended sequence without reading Spec 35.
3. Confirm disabled「发布并重建索引」旁有可读的 gate 原因（例如「先校验变更」）。
4. Confirm 右栏不再出现与 Header 重复且不可执行的「校验变更 / 建议命令」噪声块（或已降级到帮助入口）。

### Notes
Spec 112 / `wo-202608-45` 已落地（本轮不做浏览器验证，待复核后升 Verified）。右栏改为「发布门禁」+ 步骤指示 + 下一步文案；进页自动校验；删「建议命令」。主题：`publish flow discoverability`。

## UX-PUBLISH-WORKBENCH-002: 三栏分区角色不清

Status: Fixed
Route: `/publish/workbench`
Area: Three-panel review layout (`pl-review-layout`)
Severity: P1
Reported: 2026-08-06

### Feedback
用户反馈「待发布变更、`semantic-layer/demo-mysql/_schema/dataforai.yaml`、变更影响范围」三个分区让人摸不着头脑：不清楚左选文件、中看什么、右栏影响与发布的关系。

### Evidence
- Screenshot: 同上 `UX-PUBLISH-WORKBENCH-001-003.png`
- CDP / DOM：`[data-testid=publish-workbench-layout]` 三子节点分别为：
  1. `pl-review-sidebar` → 标题「待发布变更」
  2. `pl-review-main` → 标题直接是文件路径 `semantic-layer/demo-mysql/_schema/dataforai.yaml`（无「变更详情 / Diff」角色标题）
  3. `pl-review-sidebar` → 标题「变更影响范围」
- 中栏副文「状态：W」为内部 git/status 码，用户不可读。
- 右栏把 `_schema/dataforai.yaml` 解析成表名 `dataforai` 并标「未在 Catalog 中」，与真实 Schema Manifest 角色不符，加重三栏困惑。
- Spec 35 §6.3 ASCII 主布局是「文件列表 | Diff」两栏；影响范围是后续叠加，未与左/中形成统一任务叙事。

### Expected
三栏各自有稳定角色标题与一句职责：
| 栏 | 角色标题（示例） | 职责 |
|---|---|---|
| 左 | 待发布变更 | 选文件 |
| 中 | 变更详情 | 看 Diff / 补丁；路径作副标题，不作唯一标题 |
| 右 | 发布门禁 / 影响与校验 | 影响对象 + 校验结果 + 为何能/不能发布 |

额外：
- 「状态：W」改为业务可读（如「已修改」），或隐藏内部码。
- Schema Manifest（`_schema/*.yaml`）不得当成普通表名进「影响 N 张表」。

### Browser Check
1. Open `/publish/workbench` with a pending `_schema/*.yaml` and a table overlay.
2. Verify center panel has a role title（变更详情）且路径为副信息。
3. Verify left/center/right titles read as a coherent review → detail → gate story.
4. Verify Schema Manifest 不出现在「影响表」列表里，或单独标为 Schema 级变更。

### Notes
Spec 112 / `wo-202608-45` 已落地（本轮不做浏览器验证，待复核后升 Verified）。三栏标题改为待发布变更 / 变更详情 / 发布门禁；`fileChangeStatusLabel`；`classifyChangedSemanticFile` 分流 Manifest vs overlay。主题：`publish workbench three-panel ia`。

## UX-PUBLISH-WORKBENCH-003: 顶部动作条过密

Status: Fixed
Route: `/publish/workbench`
Area: PageHeader actions
Severity: P2
Reported: 2026-08-06

### Feedback
顶部一排按钮过于密集，难以分辨主路径与辅助动作。

### Evidence
- Screenshot: 同上
- CDP：Header 同排 6 个控件，y≈62 同行：
  1. `校验变更`（secondary）
  2. `强制重建索引`（secondary）
  3. `上传语义资产`（secondary）
  4. `发布并重建索引`（disabled secondary）
  5. `表目录`（ghost link → `/`）
  6. `导出当前快照 (.zip)`（ghost）
- Spec 35 §6.2 主动作序为「校验 / 强制重建 / 上传 / 发布」；§6.1 仅把导出列为 Header 辅助。**未**要求「表目录」进 Header（违反跨页主题 `header sibling nav redundancy`：语义资产/表目录已有侧栏入口）。
- 4 个 secondary 并列 + 2 ghost，视觉权重几乎平铺；主 CTA 在 gate 未过时也看不出「唯一主路径」。

### Expected
- Header 主组 ≤3～4 个：主路径相关（校验、发布）+ 必要兜底（强制重建或上传二选一常驻，另一个下沉）。
- 「表目录」移出 Header（侧栏「语义资产」已覆盖）。
- 「导出当前快照」保留为最右辅助，或并入 overflow / 更多菜单。
- 同组遵守 `button hierarchy consistency`：未就绪时发布按钮可 disabled，但须有单一推荐下一步（校验）在视觉上更醒目，避免六钮平权。

### Browser Check
1. Open `/publish/workbench` at ≥1280px width.
2. Count PageHeader action controls；期望明显少于 6，且无「表目录」。
3. Identify one recommended next action without reading every label.
4. Confirm export still reachable as auxiliary.

### Notes
Spec 112 / `wo-202608-45` 已落地（本轮不做浏览器验证，待复核后升 Verified）。有待发布：校验 + 发布 + 导出；空态：上传 + 强制重建 + 导出；删「表目录」；上传/强制重建在有变更时下沉「高级」。主题：`header action density`。

## UX-PUBLISH-WORKBENCH-004: 校验失败只显示 OK/FAIL，不展示 issues；junk 阻断门禁

Status: Fixed
Route: `/publish/workbench`
Severity: P1
Reported: 2026-08-06

### Feedback
发布门禁「校验摘要」仅显示表身份 + `OK`/`FAIL` + 退出码；Toast 只报「N 张表未通过」。与表编辑器 Spec 110 已解决的「原因不可见」同类。现场常见失败原因为 AppleDouble `semantic-layer/.../._*.yaml`，与待发布 overlay 内容无关，但用户无法从工作台得知。

### Expected
1. 失败行展示「校验问题」列表（过滤 `Project:` 噪声）；退出码入「技术详情」。
2. Toast 含首条实质问题。
3. 调用 `ktx sl validate` 前 scrub `._*` / `.DS_Store`；上传拒收 junk 文件名。

### Browser Check
1. Open `/publish/workbench` with pending table overlay；mock/实机校验失败含 issues。
2. Verify 校验摘要可见问题路径/文案；主状态为「未通过」而非裸 FAIL。
3. Expand 技术详情；verify 退出码可见。
4. （可选）PVC 存在 `._*.yaml` 时，scrub 后真实校验不再因 junk 失败。

### Notes
Spec 115 / `wo-202608-48` 已落地（本轮不做浏览器验证，结束后只做 code review，待复核后升 Verified）。延伸跨页面主题 `validation failure disclosure`；新增 `semantic-layer junk scrub`。
