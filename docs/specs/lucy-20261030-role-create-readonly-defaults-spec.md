# 新建角色默认只读问答工具 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | Product / UX / Frontend Implementation Spec |
| 版本 / 日期 | v0.2 / 2026-10-30 |
| 状态 | **已实现**（Plan Task 1–4 已落地，RD-01–RD-10 全部通过，见 §6） |
| 功能编号 | **无**。WebUI 流水号 194 已由 [访问分级与日真实问询 KPI Spec](lucy-20261030-access-grade-and-daily-question-kpi-spec.md) 占用；本 Spec 按 [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「新 Spec 只有一个身份」不占号 |
| 适用页面 | `/admin/roles/new`；编辑与复制页面仅涉及空工具校验及兼容回归 |
| 关联 Plan | [实施 Plan](../plans/lucy-20261030-role-create-readonly-defaults-plan.md) |
| 上游契约 | [开发治理](../governance/DEVELOPMENT.md)、[Spec 150](../../webui/docs/150-role-permission-configuration-structure-spec.md)、[Spec 15](../../webui/docs/15-role-admin-spec.md)、[Spec 177](../../webui/docs/177-compile-failure-diagnostic-spec.md)、[访问权限域档案](../access-control/README.md) |
| 优先顺序 | 默认可用 → 配置引导 → 空工具校验兜底 |
| 授权范围 | 本次授权实施 Plan 的 Task 1–4 与本 Spec 的验收登记；不含浏览器验证、镜像构建、部署、推送与客户交付 |

## 1. 问题与证据

管理员创建采购运营角色时，已选一张表，但未进入工具页勾选工具。保存返回 `role_resolution_failed:token_caigou_yunying`，无法直接看出缺少什么配置。

2026-10-30 只读排查确认：

- 新建角色页显示一个连接、一张表、零个 MCP 工具；工具页显示“当前未授权任何工具”。
- `webui/src/pages/admin/RoleDetail.tsx` 的新建草稿工具为空（实施前是 `EMPTY_DRAFT.tools` 为空、`initializeDraft` 直接复用空草稿）。
- 同页 `validateDraft` 检查工具通配符，但未提前拦截空工具列表。
- `webui/src/lib/rolePermissionDraft.ts` 已提供 `READONLY_QA_PRESET`，目前需要管理员主动点击“只读问答”。
- `webui/server/proxy/acl.ts` 的 `compileRole` 对空工具列表返回上述通用角色解析失败原因。

核心缺口是新建流程缺少合理的默认查询能力。错误文案是辅助修正，不能作为主要交付结果。

## 2. 目标与范围

### 2.1 目标

管理员进入新建角色页时，已有基础只读问答工具；常规操作聚焦于填写角色信息、选择可访问的表和按需限制行权限。工具页保留显式勾选能力，供管理员调整。

### 2.2 本次范围

1. 新建草稿默认预选现有只读问答预设。
2. 基本信息页明确说明默认查询能力及下一步的数据范围配置。
3. 默认工具参与工具页、摘要、保存预览和最终提交，形成同一份共享草稿。
4. 清空可授予工具后，在当前表单内提供明确提示，并在保存前定位到工具页。
5. 保持编辑、复制、放弃修改、权限变更预览与行级策略的既有行为。

### 2.3 边界

- 默认只作用于 WebUI 新建草稿。API、YAML 导入及运行时不补写默认工具。
- 不修改既有角色、内置模板、Agent 绑定或真实实例配置。
- 不默认选择连接、表或全部连接，不扩大表范围及行权限。
- 不新增工具预设，不重排页面 Tab，不引入向导或权限模板系统。
- Wiki / Skill 通道、建模工具和全选工具不纳入这次默认集合。
- 后端通用编译诊断、MCP 错误码翻译作为独立后续议题；本次保持运行时拒绝语义。

## 3. 默认能力契约

唯一事实源为 `webui/src/lib/rolePermissionDraft.ts` 中的 `READONLY_QA_PRESET`。新建初始化必须引用该常量并生成独立副本，禁止另抄一份工具名单。

默认集合是 **`READONLY_QA_PRESET` 全集**，不写死工具个数——名单以常量为准。下表只是当前全集的说明，不是第二份名单。

| 工具 | 用途 |
|---|---|
| `lucy_catalog` | 发现授权范围内的数据目录 |
| `lucy_read_source` | 读取允许访问的表结构与语义信息 |
| `lucy_query` | 执行受控数据查询 |
| `lucy_explain_query` | 解释查询 |
| `lucy_freshness` | 查看数据新鲜度 |
| `lucy_begin_question` | 初始化问答上下文 |
| `lucy_continue_question` | 问询预算用尽后继续同一问询，再开一档数据额度 |

> **2026-10-30 文档漂移修正**：本 Spec 初稿把默认集合写成「6 个工具」并漏列 `lucy_continue_question`，而事实源 `READONLY_QA_PRESET` 早已包含该工具（服务端同集合的 `LUCY_R1_EXACT_TOOLS` 也是 7 个）。本次以常量为准：预选全集，不为对齐表格删除 `lucy_continue_question`，也不新增工具。文中不再写死个数。

“默认只读问答”表示工具预选，不承诺未配置数据范围即可查询。表范围、行级限制和工具运行时校验仍按原契约生效。限定行角色已有的工具兼容提示与裁决继续适用；不以默认工具绕过行级限制。

默认工具先进入内存草稿，仍需管理员审阅权限变更并确认保存后才产生持久权限。

## 4. 状态与交互契约

### 4.1 初始化、编辑与复制

| 场景 | 工具草稿 | 未保存修改状态 |
|---|---|---|
| 首次新建 | 预设的 `READONLY_QA_PRESET` 全集，角色标识及表范围为空 | 初始无未保存修改提示 |
| 新建后修改工具或其他字段 | 保留用户操作结果 | 按相对初始草稿的差异显示 |
| 新建后放弃修改 | 恢复默认工具全集并清空其余新建输入 | 恢复初始状态 |
| 编辑既有角色 | 沿用角色工具；不自动补齐预设 | 沿用原有差异逻辑 |
| 复制角色 / 模板 | 沿用源角色可授予工具及现有过滤规则 | 沿用复制流程的保存及审阅要求 |

切换 Tab、查询候选工具、请求重试或候选刷新均不得重置用户修改。用户主动取消某个默认工具或清空工具后，不自动再次选中。

**初始草稿与权限比较基线必须分开：**

- 新建的“是否已修改”以带默认工具的初始草稿为基线。
- 新建的“新增权限”以尚不存在角色的空权限为基线。审阅摘要必须列出最终草稿中的全部工具，不能漏掉默认工具。
- 编辑和复制继续使用各自现有的权限比较语义。本次不改写它们的差异算法。

### 4.2 页面引导与错误文案

基本信息页增加弱提示：

> 已默认启用只读问答工具，请选择可访问的表；如需调整工具，可前往“允许的 MCP 工具”。

工具页保留现有预设按钮、勾选、选中计数与“当前与只读问答一致”的反馈。默认选项必须真实出现在共享草稿和复选框中，不能仅显示说明。

可授予工具为空时显示页内校验提示：

> 请至少选择一个 MCP 工具。常规查询可选择“只读问答”。

点击保存时，沿用现有校验次序：角色信息等更早的首因校验通过后，空工具校验将用户定位到“允许的 MCP 工具”，焦点移至可读的校验提示或其关联控件。提示使用 `role="alert"` 或等价可达语义。允许沿用 Toast 展示首因，但 Toast 不能替代页内提示。选择有效工具后，页内错误随之消除。

空工具判断以 `partitionGrantableTools(draft.tools).grantable.length === 0` 为准；仅包含系统禁止工具也视为空。仍保留既有通配符校验，不将本地校验成功视为服务端编译成功。

### 4.3 候选加载与保存

- 默认工具初始化不依赖候选接口的成功、返回时机或顺序。接口加载和失败处理沿用现有工具页能力，不因接口失败清空草稿。
- 不按候选列表静默删减默认集合，也不自动添加替代工具。运行时不支持某工具时，沿用服务端 dryRun 失败处理，禁止绕过编译。
- 本地空工具校验失败时，不发送创建、复制或修改角色的 dryRun / 写入请求，不打开确认 Drawer。
- 本地校验通过后沿用 `dryRun → 权限确认 Drawer → 确认保存 → runtimeAck`。草稿发生变化时，既有预览失效约束继续适用。
- dryRun 与最终保存必须使用相同的角色 payload；序列化包含用户最终选择的工具，不能在提交阶段补回已取消的默认项。

## 5. 核心流程（伪代码）

```text
进入或放弃修改：
  if mode == create:
    pristine = 独立空草稿 + tools = copy(READONLY_QA_PRESET)
    baseline = 独立副本(pristine)            # 用于未保存修改判断
    draft = 独立副本(pristine)
  else:
    使用现有编辑/复制初始化与过滤规则

新建 dirty = hash(draft) != hash(baseline)
新建 impact = derivePermissionImpact(空权限草稿, draft, ...)
编辑/复制 dirty 与 impact = 原有算法

用户修改工具/表/信息：
  只更新共享 draft；清除既有保存预览
  工具候选请求不参与草稿重置
  若工具已非空，消除空工具提示

点击保存：
  执行既有更早首因校验（迁移阻断、角色标识、工具通配符）
  if 无可授予工具:
    定位工具 Tab；展示并聚焦页内错误；return（零角色写请求）
  执行现有数据范围、行级策略等剩余校验
  payload = serializeDraft(draft)
  执行既有 dryRun
  if dryRun failed: 沿用既有失败处理；不进入最终写入
  else: 显示含全部最终工具的权限确认 Drawer
  确认时核对草稿 hash；变化则预览失效
  提交同一 payload；仅按现有写入结果与 runtimeAck 判定成功
```

## 6. Acceptance

以 Vitest + React Testing Library / jsdom 验证，不要求浏览器或移动窄屏测试。

**2026-10-30 实施记录**：Task 1–4 已按 [实施 Plan](../plans/lucy-20261030-role-create-readonly-defaults-plan.md) 落地，RD-01–RD-10 **全部执行并通过**。证据文件为 `webui/src/__tests__/role-detail.test.tsx` 的 `describe("新建角色默认只读问答工具 Spec")`（用例名以 RD-xx 开头）。

| 编号 | 验收条件 | 状态 | 证据 |
|---|---|---|---|
| RD-01 | 打开新建页即预选且仅预选预设的 `READONLY_QA_PRESET` 全集；初始无未保存修改提示，角色标识及表范围为空 | 通过 | `role-detail.test.tsx` RD-01（生效边界摘要：工具=全集长度、连接 0、表 0；无 `role-dirty-bar`；工具页显示「当前与只读问答一致」且芯片集合等于常量全集） |
| RD-02 | 填标识、选表后，无需点击工具预设即可发起有效 dryRun；摘要和 Drawer 完整计入默认工具的新增权限，确认提交与预览 payload 一致 | 通过 | `role-detail.test.tsx` RD-02（dryRun `allow.tools` 等于全集；Drawer「新增 MCP 工具」列出全集；确认保存的 payload 与预览深相等） |
| RD-03 | 取消一个默认工具后跨 Tab、候选延迟返回及刷新仍保持用户选择；保存不补回该工具 | 通过 | `role-detail.test.tsx` RD-03（跨 Tab、`invalidateQueries(["admin","mcp-tools"])` 刷新后仍取消；dryRun payload 不含该工具） |
| RD-04 | 修改后放弃修改，恢复空标识、空表范围、默认工具及干净状态；不同新建生命周期的工具数组互不污染 | 通过 | `role-detail.test.tsx` RD-04（放弃修改后工具恢复全集、标识空、表未选、无脏栏；重新挂载的创建页仍是全集） |
| RD-05 | 清空工具后点击保存，定位工具页并展示可达的页内提示；不产生角色 dryRun / 写请求、不打开 Drawer；只含禁止工具时同样阻断 | 通过 | `role-detail.test.tsx` RD-05（`role-tools-empty-error` 为 `role="alert"` 且获得焦点；无 `POST /api/admin/roles`；无 Drawer）与「只含系统禁止工具时同样阻断」（候选接口不可用时经既有手工输入入口填入 `sl_query`，同样阻断、不发请求） |
| RD-06 | 从空工具恢复一个有效工具，提示消除，允许进入后续既有校验和 dryRun 流程 | 通过 | `role-detail.test.tsx` RD-06（提示消失；随后的保存只发一次 dryRun，`allow.tools` 等于该单个工具） |
| RD-07 | 编辑仅有自定义工具或 Wiki 工具的角色，以及复制这些角色/模板时，不自动添加默认工具全集；原有过滤、迁移、版本及预览失效行为通过回归 | 通过 | `role-detail.test.tsx` RD-07（编辑与复制均只有 `wiki_search`，无「当前与只读问答一致」）；同文件既有迁移、预览失效、模板只读用例通过 |
| RD-08 | 候选接口失败不丢失默认工具或用户修改，既有手工输入入口仍可用；不静默删减默认集合或放行不受支持的工具 | 通过 | `role-detail.test.tsx` RD-08（候选接口 500 时仍显示全集与手工输入入口；手工新增工具后为全集 + 新增项） |
| RD-09 | 未选表不会自动获得连接/表范围；限定行角色原有提示、最终行约束预览和禁止工具防护继续通过原有测试 | 通过 | `role-detail.test.tsx` RD-09（连接 0、表 0、限定行表 0）；`role-detail-row-policy-save.test.tsx` 全部通过（最终行约束预览确认与提交绑定）；既有行级工具兼容警示用例通过 |
| RD-10 | 基本信息引导、默认选中计数、错误提示一致；术语及专业英文节点的翻译防御符合标准 | 通过 | `role-detail.test.tsx` RD-10（引导文案、计数、错误文案断言）；`npm --prefix webui run lint:terminology` 通过（1076 个文件） |

未执行：浏览器 / Playwright / 移动窄屏验证、镜像构建、部署、客户交付、真实实例写入。这些不在本次授权内。

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

沿用“角色”“角色标识”“可访问的表”“允许的 MCP 工具”“只读问答”“行级策略”“权限变更”等现有术语。文案中的 `MCP`、工具 ID 及其他专业英文节点须有 `translate="no"` 与 `notranslate`。

## 8. Design System Compliance

### Referenced Specs

- [页面布局 §5](../../webui/docs/design-system/20-patterns-page-layout.md)
- [按钮规范 §2–§4](../../webui/docs/design-system/10-components-button.md)
- [Toast §4](../../webui/docs/design-system/13-components-toast.md)

### What This Change Follows

- 保留配置页和共享草稿结构，默认能力说明置于基本信息说明层，不增加一级操作。
- 复用现有预设和保存按钮层级、焦点及禁用状态，不以主按钮样式表达预设选中态。
- 校验错误采用页内提示（`pl-error` + `role="alert"`），可辅以现有底部 Toast；不新增弹窗。
- 不新增视觉模式或设计 token；颜色与间距沿用既有语义 class。

### Exceptions (If Any)

- None

### Follow-up Needed

- None

## 9. 闭口层级

- 层级：功能合同
- 本条承诺：新建角色页默认预选只读问答工具全集，管理员不点预设也能发起受控问数；可授予工具为空时保存被就地阻断并定位到工具页。
- 本条出口：`webui/src/__tests__/role-detail.test.tsx` 的 RD-01–RD-10 用例（默认预选、初始干净状态、权限审阅完整、候选解耦、用户取消不补回、空工具就地阻断与提示消除）。
- 不在本条出口：浏览器与移动窄屏验证、镜像构建与部署、客户环境验证、真实实例写入。
- 上线关系：本条收口不表示可上线

## 10. 实施与回退

实施文件、任务顺序和验证命令见关联 Plan。只变更前端草稿默认值、引导与本地校验及对应测试，不调整权限编译器、API 或存储格式。

回退前端变更即可恢复原新建体验。已由管理员确认创建的角色保持其显式工具配置；不随前端回退删除工具。发布与实例升级另行授权，本次不出包、不执行部署。
