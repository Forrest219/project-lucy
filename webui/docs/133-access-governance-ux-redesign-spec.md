# Access Governance UX Redesign Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Access Governance UX Redesign Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-29 |
| 撰写人 | Claude (Cursor Agent) |
| 委托人 | xingchen |
| 基于材料 | CFG-ADM-01 自动化运行截图证据与 UI 交互审视、Lucy WebUI 源码 (RoleList/RoleDetail/AgentDetail/Navigation/CheckboxCandidatePicker) |
| 适用范围 | Lucy WebUI 访问治理模块前端 UI/UX 体验重构（`/admin/roles`、`/admin/roles/:roleId`、`/admin/agents`、`/admin/agents/:userId`、`/admin/tokens`） |
| 输出位置 | `webui/docs/133-access-governance-ux-redesign-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 133 |
| 关联工单 | `webui/docs/plans/wo-202608-59-access-governance-ux-redesign.md` |
| 关联页面 | `/admin/roles`、`/admin/roles/new`、`/admin/roles/:roleId`、`/admin/agents`、`/admin/agents/:userId`、`/admin/tokens` |
| 上游 Spec | Spec 14 / Spec 15 / Spec 59 / Spec 76 / Spec 88 / Spec 89 / Spec 95 / Spec 129 |
| 状态 | Planned / Approved |
| 日期 | 2026-08-29 |
| 范围 | 纯前端 UI/UX 提升：组件收敛、信息架构扁平化、安全交互层级隔离、Pre-flight 保存流闭环 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿落盘：确定纯前端重构方案（四核心维度：资产层级选择器、扁平化单页/高密表格、危险区强隔离、Pre-flight Diff Modal 保存流） |
| v1.1 | 完善体验闭环与边界规范：补充 Agent 详情 Token 内嵌表格规范（图 10 改造）、Schema 规则互斥与并集叠加策略、Dirty 状态路由拦截守卫（Route Guard） |

---

## 1. 背景与问题定义

在审视 `CFG-ADM-01` 自动化运行截图证据及当前 Lucy WebUI 代码实现后，发现访问治理模块在交互效率、信息架构、安全语义与状态反馈机制上存在以下四个维度的硬伤：

1. **资产选择交互反模式**：`CheckboxCandidatePicker` + `TagInput` 的三重杂交模式导致勾选、删除、手动录入状态割裂；换行 Tag 堆砌在面对百级以上表资产时极易撑爆屏幕。
2. **空间利用率与信息密度失衡**：Role 详情页中仅含 2 个输入框的“基本信息”独占一个 Tab，迫使用户机械横切；Role 列表采用松散超大 Card 堆叠，与 Agent 列表的 Data Table 规范割裂。
3. **安全语义与决策防误触薄弱**：高危的实心红色 `删除` 按钮与常规操作并排置于顶部；界面直出后端编译技术注释（如“对人级最终约束做 AND 收紧”），缺乏业务抽象。
4. **状态机与反馈流断层**：常驻的「变更预览」Tab 与底部全局浮动保存条存在入口双通道冲突；深层二级路由（如 `/admin/roles/:roleId`）左侧侧边栏高亮丢失。

---

## 2. 核心设计原则与约束

* **纯前端闭环（Zero Backend Changes）**：不修改后端 API 路由、请求参数、响应结构或 YAML 序列化协议。
* **零功能与数据模型损失**：完整保留当前对连接、MCP 工具、表范围（`names` / `prefix`）、行级安全谓词（`row_policy` / `predicates`）及版本回滚校验的全部能力。
* **企业级高密与安全对齐**：提升首屏信息密度，消除跨 Tab 横切，高危操作物理与交互双重隔离，单向确定的保存状态机。

---

## 3. 详细设计规范

### 3.1 模块一：资产权限配置交互重构（告别“三重杂交与 Tag 爆屏”）

#### 3.1.1 资产层级规则构建器（Asset Hierarchy Selector）
废除原 `CheckboxCandidatePicker` + `TagInput` 组合，升级为基于连接与 Schema 的层级规则构建器：

1. **层级折叠树（Hierarchy Tree）**：
   * 一级节点：`Connection`（数据库连接）。
   * 二级节点：`Schema / Database`。
2. **Schema 级表范围选择的三种直观模式与互斥/叠加交互契约**：
   * **单次配置单选契约（Radio Mode）**：同一个 Schema 下在单次添加规则时，通过单选模式在三种规则间切换：
     * **模式 A：全部表（`*` 通配）**：一键授权该 Schema 下全部已有及未来新增表。
     * **模式 B：按前缀规则（`prefix` 通配）**：单行输入框录入前缀（如 `ods_*`），右侧实时反馈当前匹配命中数（如 `已匹配 18 张表`）。
     * **模式 C：指定特定表（`names` 精确枚举）**：带本地过滤搜索的高密 Checkbox 列表，顶部提供 `已选 N/M` 计数与一键 `[全选] / [清空]`。
   * **多规则叠加策略（Union Mode）**：
     * 若用户需要复合规则（例如：既配置了 `ods_*` 前缀规则，又需要额外包含某张特殊命名的表 `dim_special_user`），无需在同一表单内杂交输入，可通过 `[+ 添加同 Schema 规则]` 独立生成第二条规则卡片。
     * 后端将以两个独立的 selector 对象存储（`kind: "prefix"` 与 `kind: "names"`），规则在 ACL 判定时天然为**并集叠加（OR）**。前端规则摘要卡片明确标示：`合并策略：并集 (OR)`。
3. **规则卡片摘要（Policy Summary Card）**：
   * 移除散落换行的带 `x` 的 Tag 药丸池。
   * 替换为紧凑的规则表格/列表项：
     * 例：`kc-starrocks > ods > 前缀规则: ods_* (匹配 18 张表)` [编辑] [删除]
     * 例：`kc-starrocks > dwd > 指定 4 张表 (dwd_orders, dwd_users...)` [编辑] [删除]

---

### 3.2 模块二：信息架构与空间利用率优化（高密扁平化）

#### 3.2.1 角色详情页（RoleDetail）Tab 结构扁平化
原 5 个 Tab（`基本信息`、`权限配置`、`生效边界`、`使用情况`、`变更预览`）收敛为 **2 个高内聚视图**：

* **Tab 1：角色配置工作台（Configuration）**：
  * **首屏基础信息卡片（Basic Info Card）**：将标识、名称、说明内联在页面顶部，直接在当前页编辑。
  * **主体配置区**：向下单页自然展开“数据连接与工具”、“库表与行级规则”，单页自然滚动，消除跨 Tab 机械跳转。
  * **底部危险区**：删除操作下沉至独立卡片，与常规保存解耦。
* **Tab 2：使用与生效分析（Insights & Usage）**：
  * 将原“生效边界”与“使用情况”合并：
    * **左栏**：绑定的 Agent 列表及其当前运行状态、最后活跃时间。
    * **右栏**：只读的最终生效数据资产汇总表及行级约束模拟清单。

#### 3.2.2 列表视图规范统一（Role 列表 Table 化）
* 将 `RoleList.tsx` 重构为与 `AgentList.tsx` 视觉规范一致的标准 **Data Table**：
  1. **列 1**：角色 ID / 名称（加粗展示，附带复制按钮）。
  2. **列 2**：角色来源（`正式配置` 蓝标 / `参考模板` 灰标）。
  3. **列 3**：关联范围摘要（如 `2 个连接 · 12 张表 · 4 个工具`）。
  4. **列 4**：绑定 Agent（如 `3 个 Agent 引用`，悬浮或点击 Popover 展示 Agent 清单）。
  5. **列 5**：更新时间（格式化为本地时间）。
  6. **列 6**：操作（`编辑`、`克隆/复制`、`更多`）。
* **抽屉式快捷预览（Quick Drawer）**：
  * 单击表格行在右侧弹出抽屉，快速查看权限规则与 YAML 配置，无需反复进出详情页。

---

### 3.3 模块三：安全语义与决策防误触治理

#### 3.3.1 危险操作层级治理（Danger Zone Isolation）
1. **移除顶部红色删除按钮**：
   * 顶部 PageHeader 操作区仅保留探索与只读操作（`在 MCP 调试台试调`、`变更历史`、`克隆角色`）。
2. **设立底部 Danger Zone**：
   * 在页面最底部使用柔和红边卡片建立“危险区域”。
   * 点击 `删除角色` / `删除 Agent` 时，触发 **强制两阶段确认弹窗**：
     * 弹窗内明确提示下游影响（例如：“警告：当前有 2 个 Agent 正绑定此角色，删除后将直接导致下游 Agent 访问鉴权失败”）。
     * 要求操作者手动输入当前对象的 ID 确认后方可解锁提交。

#### 3.3.2 权限计算语义的可视化升级
1. **废除硬编码技术注释**：
   * 移除“对人级最终约束做 AND 收紧；多 Role 不会自动对人级行集做 AND”等后端编译器直出文本。
2. **引入权限管线示意图（Visual Permission Pipeline）**：
   * 使用轻量图形组件直观展示权限交集逻辑：`Agent 个人约束 ∩ Role 角色权限 = 最终生效范围`。
   * 配合 Tooltip 解释：“当为 Agent 单独配置约束时，系统将自动与 Role 权限取**交集（收紧规则）**，确保最小特权原则”。

#### 3.3.3 Token 凭证交互安全规范与表格化重构（图 10 改造）
1. **生成即脱敏**：新生成 Token 时弹窗提示“该 Token 仅展示一次，请立即复制并妥善保存”，关闭弹窗后页面永久遮罩显示（`••••••••`）。
2. **Agent 详情页 Token 列表表格化（Embedded Table）**：
   * 彻底废除原有松散的大 Card 堆叠布局，改为紧凑内嵌表格：
     * **列 1：客户端标识 / 备注**（`client` 字段，加粗，附设备类型图标）。
     * **列 2：状态 Tag**（`有效` 绿标 / `已撤销` 灰标 / `已过期` 橙标）。
     * **列 3：最近使用**（相对时间如 `10 分钟前`，悬浮展示最后调用的 MCP 工具与状态）。
     * **列 4：过期时间**（格式化本地时间 `YYYY-MM-DD HH:mm` 或 `永不过期`）。
     * **列 5：操作**：
       * `[复制 Token ID/Hash]`（次级图标按钮）。
       * `[撤销 Token]`（次级幽灵按钮 Ghost Button，点击后触发气泡确认防误触）。

---

### 3.4 模块四：状态机、导航与反馈流闭环

#### 3.4.1 统一保存工作流（Pre-flight Diff Modal）与路由守卫（Route Guard）
1. **移除常驻「变更预览」Tab**：避免未编辑时展现空白 Diff 的无意义状态。
2. **内聚的保存状态机**：
   * 表单发生修改（Dirty）时，页面底部滑出轻量浮动条：`您有未保存的修改 [放弃修改] [查看并保存]`（支持快捷键 `Cmd/Ctrl + S`）。
   * 点击 `[查看并保存]` 时呼出 **“变更确认弹窗（Pre-flight Diff Modal）”**：
     * 弹窗左侧：高亮列出**结构化差异**（如：`+ 新增 ods_orders 表`、`- 移除 admin_db 连接`）。
     * 弹窗右侧：展示标准 YAML 文本 Diff。
     * 弹窗底部：`[取消]` 与 `[确认应用并发布]`。
   * 点击保存后调用原有 API，成功后自动关闭弹窗、收起浮动条，并弹出带有 `policyVersion` 的 Toast 反馈。
3. **Dirty 状态丢失拦截守卫（Route Guard）**：
   * **页面卸载拦截**：监听 `beforeunload`，防止意外刷新浏览器或关闭标签页导致编辑内容丢失。
   * **站内导航拦截**：当浮动条处于 Dirty 状态时，捕获对左侧侧边栏、顶部面包屑、浏览器后退键等导航动作，弹出统一的确认 Modal：
     * `「您有未保存的修改，离开本页将丢失当前编辑内容。确定离开吗？」`
     * 按钮：`[继续编辑]`（关闭弹窗保留当前页）与 `[放弃修改并离开]`（确认放行路由跳转）。

#### 3.4.2 路由激活与全局面包屑修正
1. **修复侧边栏 Active 判定**（`webui/src/app/navigation.ts`）：
   * 角色菜单项：`active: (path) => path.startsWith("/admin/roles")`
   * Agent 菜单项：`active: (path) => path.startsWith("/admin/agents")`
   * Token 菜单项：`active: (path) => path.startsWith("/admin/tokens")`
2. **页面顶部规范化面包屑（Breadcrumbs）**：
   * 详情页顶部统一注入：`访问治理 / 角色管理 / {roleId}`，点击各层级无缝返回列表。

---

## 4. 实施计划与里程碑

| 阶段 | 改造内容 | 涉及主要前端文件 | 验证方式 |
| :--- | :--- | :--- | :--- |
| **Phase 1: 骨架与导航** | 修复侧边栏高亮匹配；重构 RoleList 为 Data Table；Tab 结构扁平化 | `webui/src/app/navigation.ts`, `webui/src/pages/admin/RoleList.tsx`, `webui/src/pages/admin/RoleDetail.tsx` | 单元测试 & 列表高密展示断言 |
| **Phase 2: 状态机与安全** | 移除 Diff Tab，实现 Pre-flight Diff Modal 保存流与 Route Guard 路由守卫；危险区强隔离 | `webui/src/pages/admin/RoleDetail.tsx`, `webui/src/pages/admin/AgentDetail.tsx` | 保存流、离开拦截与删除防误触交互测试 |
| **Phase 3: 资产选择器与 Token 表格** | 封装资产层级选择器（单选模式+并集叠加）；重构 Agent 详情 Token 为紧凑内嵌表格 | `webui/src/components/AssetHierarchyPicker.tsx`, `webui/src/pages/admin/RoleDetail.tsx`, `webui/src/pages/admin/AgentDetail.tsx` | 多 Schema/多表场景无 Tag 溢出验证，Token 表格渲染 |
| **Phase 4: 语义可视化与微交互** | 权限交集示意图、Token 生成/撤销交互规范化、文案技术注释清洗 | `webui/src/pages/admin/AgentDetail.tsx`, `webui/src/pages/admin/Tokens.tsx` | 视觉与文案回归检查 |
