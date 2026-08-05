# Role Admin Create / Edit Usability Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin Create / Edit Usability Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/admin/roles/new`、`/admin/roles`；用户 6 条反馈与改善方案拍板；交付质量交叉评估反对意见（Schema 数据源、选择器回退、sourceNames 失败语义、与 Spec 76 命名、术语闭环、分段验收）；`webui/src/pages/admin/RoleDetail.tsx`、`RoleList.tsx`；`webui/server/index.ts` connections/tables；`webui/docs/15-role-admin-spec.md` §5.3；`webui/docs/59-role-admin-ops-ux-clarification-spec.md`；`webui/docs/76-role-admin-list-clarity-followup-spec.md`；`GET /api/admin/mcp-tools`、`GET /api/connections` |
| 适用范围 | 指导 Role 新建/编辑页中文可用性与选择器化，以及列表页按连接 / MCP 工具 / 表的能力筛选；不替代 Spec 76 的列表 KPI/状态口径 |
| 输出位置 | `webui/docs/77-role-admin-create-edit-usability-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 77 |
| 关联工单 | `webui/docs/plans/wo-202608-09-role-admin-create-edit-usability.md` |
| 关联页面 | `/admin/roles/new`、`/admin/roles/:roleId`、`/admin/roles` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（新增 `UX-ADMIN-AGENTS-016` ~ `UX-ADMIN-AGENTS-021`） |
| 上游 Spec | `webui/docs/15-role-admin-spec.md`（补齐 §5.3 多选欠账）；`webui/docs/59-role-admin-ops-ux-clarification-spec.md`；与 Spec 76 并行、边界不重叠 |
| 状态 | Draft (v1.1 review-hardened) |
| 日期 | 2026-08-04 |
| 范围 | Wave A：新建页标题去重、角色标识/说明中文化、连接/工具/表范围选择器化（含受控手输回退）、names/prefix 中文说明；Wave B：列表能力筛选 + `sourceNames` |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：6 条新建/筛选反馈落盘 |
| v1.1 | 交叉评估纳入优化边界：Schema 主源改 `GET /api/connections.schemas`；选择器主路径 + 受控手输回退强制；`sourceNames: []` 失败语义与空结果提示；与 Spec 76 命名统一；术语同步进全局标准；Wave A/B 分段验收 |

## 1. 背景

2026-08-04 浏览器核查确认：M57 / Spec 59 已把 Role 列表从技术枚举收敛为运维中文口径，但**新建 / 编辑正式 Role** 仍是 YAML 心智的表单：英文标签、手录 connection / tool / table selector，且列表筛选只有生命周期维度。

用户 6 条反馈核查结论：

| # | 反馈摘要 | 核查结论 |
|---|---|---|
| 1 | 「新建 Role」与「新建正式 Role」重复 | **属实**。标题与副标题都带「新建」；「正式」相对「参考模板」，但副标题未把增量信息说清 |
| 2 | Role ID / Role Name 应拆分，ID 用流水号 | **方向属实、流水号方案不采纳**。现状只有 Role ID（`access.yaml` key）+ 描述；无独立「Role Name」。Agent 按 role id 引用，不能改为无意义流水号 |
| 3 | Connections / MCP 工具 / Table Selectors 难懂 | **属实**。英文标签 + 缺业务用途提示 |
| 4 | MCP 工具、Table Selectors 应选择而非录入 | **属实**。Spec 15 §5.3 已要求多选；实现仍是 textarea |
| 5 | prefix / names 难懂 | **属实**。英文 radio，无业务说明 |
| 6 | 列表筛选需按 MCP / Table / Connections | **属实**。当前仅状态筛选；搜索只按 role id / 描述 |

本 Spec 落实改善方案中已拍板的范围（文案 + 选择器 + 能力筛选），不引入 `displayName` / 流水号 schema。交付按 **Wave A → Wave B** 分段验收（见 §9），避免把列表筛选正确性与输入可用性一次打包。

## 2. 目标

### Wave A — 新建 / 编辑可用性（先交付）

1. **新建页标题去重**：副标题说明职责与 dryRun，不再重复「新建」。
2. **身份字段中文化**：`Role ID` →「角色标识」；`描述` →「说明」；明确标识是 Agent 引用用的技术 ID，不是流水号。
3. **权限字段中文化 + 用途提示**：连接 / MCP 工具 / 表范围优先中文主术语，并写清业务用途。
4. **选择器主路径 + 受控手输回退**：连接、MCP 工具、指定表名默认从系统候选多选；**禁止**以手录为唯一路径；当候选 API 失败或候选为空时，必须提供带清晰提示的受控手输回填，保证仍可完成配置。
5. **names / prefix 可理解**：中文主术语 + 一句用途说明；`prefix` 降为「高级」路径（prefix 本身仍是文本输入，不是多选）。

### Wave B — 列表能力筛选（后交付）

6. **列表能力筛选**：在 Spec 76 状态筛选之外，支持按连接、MCP 工具、表（source）过滤；搜索覆盖标识 / 说明 / 连接 / 工具 / 表名；`sourceNames: []` 为合法失败态，不做「解析失败即禁止筛选」。

## 3. 非目标

- 不改 `access.yaml` schema（不新增 `displayName` / per-role 流水号 / `createdAt`）。
- 不把 role id 自动改成无业务含义的流水号；不改变 Agent → role 绑定语义。
- 不改变 Lucy MCP Proxy runtime ACL、dryRun-first、template / copy 路径。
- 不重做 Spec 76 的 KPI 口径、Header 模板句、状态条、badge、「基于此新建」、`configUpdatedAt`（若 Spec 76 未合入，本工单**不抢做**这些项；能力筛选文案与 Spec 76 的「使用中 / 未引用」对齐即可）。交叉引用统一写 **Spec 76**，不混用工单编号作为边界表述主称。
- 不把 `GET /api/connections/:connId/tables` 当作 Schema 分层主数据源（该接口返回扁平 `schema.table` 列表）。
- 不强制浏览器复核；验收以 Vitest + `lint:terminology` + `build` 为准。
- 不做移动窄屏专项验证。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`，并登记本轮 UI 主术语。

| Canonical Term | UI 主术语（本轮） | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Role ID | 角色标识 | 技术 ID、role id | Role Name（暗示可随意中文当作 key）、流水号（本轮） | `access.yaml.roles.<id>`；规则仍 `^[A-Za-z0-9_-]{1,64}$` |
| Role Description | 说明 | 用途说明 | Role Name（与标识混淆时） | 列表与详情的中文说明主文案 |
| Connection allow-list | 允许的连接 | 数据库连接 | Connections（裸露主标签）、链接 | 该 Role 可使用的连接 |
| MCP tool allow-list | 允许的 MCP 工具 | 工具权限 | Tools（裸露）、MCP Tools（无中文） | 显式列举；禁止 `*` |
| Table selector | 可访问的表范围 | 表授权范围 | Table Selectors（裸露）、selector（主按钮文案） | 对应 `allow.tableSelectors` |
| Exact table names | 指定表名 | 精确授权这些表 | names（裸露 radio） | selector `names` |
| Table name prefix | 按前缀匹配 | 前缀批量授权 | prefix（裸露 radio） | selector `prefix`；UI 标为高级 |
| Capability filter | 按能力筛选 | 按连接 / 工具 / 表筛选 | 功能筛选（与状态筛选混淆） | 列表次级筛选维 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：

- `Agent`、`MCP`、`ACL`、`YAML`、`access.yaml`、`Schema`
- role id、connection id、MCP tool name、source / table name、`dryRun`

**术语闭环（强制）：** §4 表中的 UI 主术语必须同步写入 `webui/docs/00-product-terminology-standard.md`（Wave A 合入前完成至少身份/权限字段相关行；Wave B 合入前完成「按能力筛选」行）。仅 Spec 局部表、未进全局标准，视为未完成交付。

## 5. 对 Spec 15 / 59 / 76 的关系

| 文档 | 关系 |
|---|---|
| Spec 15 §5.3 | **补齐欠账**：Connections / Tools 多选、names 多选；本 Spec 规定中文标签与候选数据源，并强制受控手输回退 |
| Spec 59 | 正式 Role 优先、dryRun、模板只读心智不变 |
| Spec 76 | **并行不重叠**：Spec 76 管列表 KPI/状态术语/卡片字段/时间；本 Spec 管创建编辑可用性（Wave A）+ 列表能力筛选（Wave B）。状态筛选主文案以 Spec 76 为准（`使用中` / `未引用`）；若 Spec 76 未合入，Wave B 能力筛选控件独立落地，状态下拉可暂留旧文案或最小对齐 |

## 6. 当前行为（2026-08-04 核查基线）

### 6.1 `/admin/roles/new` Header

```text
新建 Role
新建正式 Role，所有写入必须经过 access.yaml dryRun diff 确认。
```

### 6.2 基本配置字段

```text
Role ID          ← 手输 slug + 正则提示
描述             ← 可选
Connections      ← textarea 手录
MCP 工具         ← textarea 手录
Table Selectors  ← + 添加 selector
  connection / Schema 手录
  names | prefix 英文 radio
  names textarea / prefix input
```

### 6.3 `/admin/roles` 筛选

```text
搜索：按 role id / 描述搜索
下拉：全部正式 Role | 正在服务 Agent | 待修复 | 未被 Agent 使用 | 参考模板
```

无按连接 / 工具 / 表的能力维。

## 7. 目标 UX

### 7.1 新建 / 编辑 Header

新建：

```text
新建 Role
配置 Agent 可访问的连接、表范围与 MCP 工具。保存前须确认 access.yaml 变更 diff。
```

编辑（正式 Role）：

```text
{roleId}
编辑正式 Role 的访问边界。保存前须确认 access.yaml 变更 diff。
```

规则：

- 标题不再与副标题共用「新建…Role」叠句。
- 「正式」只在需要相对模板区分时出现（编辑/badge）；新建标题保持「新建 Role」。
- `access.yaml` / `Agent` / `MCP` / `diff` 保留翻译防御。

### 7.2 身份字段

| 字段 | UI 标签 | 行为 |
|---|---|---|
| `roleId` | 角色标识 | 新建必填；编辑正式 Role 只读；hint：`Agent 引用此 Role 时使用的技术标识`；规则提示保留但可用更友好句式（例如「仅英文字母、数字、下划线与连字符，最多 64 位」），正则可放在次要说明 |
| `description` | 说明 | 可选；placeholder：`例如：POC 只读问答角色` |

**可选增强（本轮允许实现，非强制）：** 用户填写「说明」后，若角色标识为空，可自动建议一个 ASCII slug（可编辑）。**禁止**静默覆盖用户已输入的标识。

**明确不采纳：** 系统流水号作为默认 role id。

### 7.3 允许的连接

- 标签：`允许的连接`
- 用途提示：`该 Role 可使用哪些数据库连接。`
- 控件：基于 `GET /api/connections` 的多选 chips / checkbox 列表（主路径）。
- 选中值写入 `allow.connections`。
- 空选：允许保存前校验按既有后端规则（有表范围或 table-touching tools 时必须有连接）。
- **受控手输回退（强制）：** 当 `GET /api/connections` 失败或返回空列表时，展示明确提示（例如「连接候选暂不可用，可手动填写连接 ID」），并允许手输 / chips 回填；不得因候选不可达导致无法配置。

### 7.4 允许的 MCP 工具

- 标签：`允许的 MCP 工具`
- 用途提示：`Agent 可调用的能力清单；须显式勾选，禁止使用 *。`
- 控件：基于 `GET /api/admin/mcp-tools` 的多选列表（主路径）；展示 `name`（notranslate）+ 可选 `description`。
- `globalDenied === true` 的工具：**不可选**，并标注「全局禁止」。
- 选中值写入 `allow.tools`；至少 1 个（沿用现有前端校验）。
- **受控手输回退（强制）：** 候选 API 失败或空列表时，允许带提示的手输工具名列表；成功拿到候选后仍以选择器为主路径。

### 7.5 可访问的表范围

- 区块标题：`可访问的表范围`
- 用途提示：`限定该 Role 可查询的 Schema 与表。未添加任何范围时，不能访问数据表。`
- 主按钮：`+ 添加表范围`（禁止主文案 `+ 添加 selector`）
- 每条范围卡片：
  1. **连接**：下拉，候选来自「允许的连接」；若角色级连接仅 1 个可默认填入。
  2. **Schema**：**主数据源**为 `GET /api/connections` 返回的该连接 `schemas: string[]`（分层 Schema 列表）。**禁止**从 `GET /api/connections/:connId/tables` 反推 Schema 列表作为主源（该接口返回扁平 `schema.table` 字符串，见 `webui/server/index.ts`）。若 `schemas` 为空或连接 API 不可用，允许带提示的 Schema 手输。
  3. **匹配方式**（二选一）：
     - **指定表名**（默认）：多选该 Schema 下的表；表候选来自 `GET /api/connections/:connId/tables` 的扁平列表，按当前 Schema 前缀过滤（`schema.`）后取表名；候选失败/空时允许带提示手输表名 → 写入 `names`。
     - **按前缀匹配**（高级）：单行输入前缀；hint：`授权所有以此前缀开头的表，例如 poc_`；写入 `prefix`（本路径本质是文本，不要求多选）。
  4. 删除本条。

空态文案：

```text
尚未添加表范围。此 Role 不能访问任何数据表。
```

### 7.6 列表：能力筛选与搜索（Wave B）

在 Spec 76 状态筛选旁增加能力维（布局建议：搜索框 + 状态下拉 + 能力筛选区）：

| 控件 | 行为 |
|---|---|
| 按连接 | 下拉 / 多选；命中 `role.connections` 含所选 id |
| 按 MCP 工具 | 下拉 / 多选；命中 `role.tools` 含所选 name |
| 按表 | 文本或下拉；命中 list 摘要中的 `sourceNames`（见 §8）任一包含查询串（大小写不敏感） |

搜索框 placeholder：

```text
按标识 / 说明 / 连接 / 工具 / 表名搜索
```

搜索匹配字段：`id`、`description`、`connections[]`、`tools[]`、`sourceNames[]`。

能力筛选与状态筛选取 **AND**；同一能力维多选取 **OR**。

**`sourceNames` 失败语义（强制）：**

- `sourceNames: []` 是合法状态（解析失败、模板未解析、0 source 均返回空数组），**不是**「禁止筛选」或字段缺失。
- 「按表」筛选启用时：`sourceNames.length === 0` 的角色**不命中**该表条件（避免误判为「包含任意表」）。
- 空结果文案须可区分：例如「没有匹配当前表条件的 Role」；若当前结果集中存在 `invalid` 或已知解析失败角色，可附加弱提示「部分 Role 无法解析表范围，不会出现在按表筛选结果中」。
- 本轮**不**要求匹配未解析的 raw `names`/`prefix` 字符串作为筛选回退。

## 8. API / 数据契约

### 8.1 复用既有 API（只读）

| API | 用途 |
|---|---|
| `GET /api/connections` | **连接候选主源**；其 `schemas[]` 为 **Schema 下拉主源** |
| `GET /api/connections/:connId/tables` | **仅表候选兜底**：返回扁平 `schema.table` 列表；按 Schema 前缀过滤后供「指定表名」多选；**不得**用作 Schema 分层主源 |
| `GET /api/admin/mcp-tools` | MCP 工具候选 + `globalDenied` |
| `POST /api/admin/roles` / `PATCH` / dryRun | 写入形状不变：`allow.connections` / `tools` / `tableSelectors` |

### 8.2 列表摘要最小扩展（Wave B）

`GET /api/admin/roles` 每条 Role 摘要在现有 `tools` / `connections` / `sourceCount` 之外**必须**增加：

```ts
sourceNames: string[]; // 始终存在；已解析 source 的 table 字段；解析失败 / 0 source 时为 []
```

规则：

- 类型上为**必填数组**（不要用 `undefined` 表示失败，避免前端误判「字段未上线」）。
- 复用 list 路径上已有的 permission preview / resolve 结果填充；**禁止**为筛选再发起与 role 数成正比的额外远程解析（N+1）。
- template / invalid：`sourceNames` 为 `[]`；筛选语义见 §7.6。

不改 create/patch body schema。

## 9. 验收标准

### 9.1 Wave A（新建 / 编辑可用性）— 可单独合入

1. `/admin/roles/new` 标题为「新建 Role」；副标题**不以**「新建正式 Role」开头，且说明 dryRun / `access.yaml` 确认职责。
2. 表单可见主标签为「角色标识」「说明」「允许的连接」「允许的 MCP 工具」「可访问的表范围」；无裸露主标签 `Connections` / `Table Selectors` / `names` / `prefix`。
3. Schema 下拉主源为 `GET /api/connections` 的 `schemas`；表候选才用 `/tables` 扁平列表过滤。
4. 连接 / MCP 工具 / 指定表名：选择器主路径可用；候选 API 失败或空时有受控手输回退与提示；全局禁止工具不可选。
5. 「指定表名」/「按前缀匹配」中文标签与用途 hint 正确；主按钮「+ 添加表范围」；空态中文化。
6. dryRun / 写入形状与既有 create/edit 一致；未引入 `access.yaml` schema 新字段。
7. §4 相关主术语已写入 `00-product-terminology-standard.md`；`lint:terminology` 通过；`role-detail` 测试覆盖文案、选择路径与回退路径。
8. 专业术语与 id / tool / table 名保留翻译防御。

### 9.2 Wave B（列表能力筛选）— 在 Wave A 之后单独验收

1. list 每条 Role **始终**返回 `sourceNames: string[]`（可空）。
2. `/admin/roles` 可按连接、MCP 工具、表过滤；搜索覆盖标识 / 说明 / 连接 / 工具 / 表名。
3. `sourceNames: []` 在「按表」筛选下不误命中；空结果提示不与「待修复为空」混淆，并可提示不可解析表的 Role 不会出现。
4. 未引入按 role 的额外 N+1 远程解析。
5. `role-list` + `admin-roles` 测试覆盖筛选 / 搜索 / 空 `sourceNames`；`lint:terminology` + `build` 通过。

## 10. 测试要点

### 10.1 `role-detail.test.tsx`（Wave A）

- 新建页：断言新 Header 文案；断言不再出现「新建正式 Role」叠句。
- 断言标签「角色标识」「说明」「允许的连接」「允许的 MCP 工具」「可访问的表范围」。
- Mock `GET /api/connections`（含 `schemas`）+ `GET /api/admin/mcp-tools`：勾选后「预览保存」payload 含对应 `connections` / `tools`。
- Schema 选项来自 connection.schemas，而非从 `/tables` 解析。
- 添加表范围：选择「指定表名」并选表 → selector `names`；切换「按前缀匹配」→ `prefix` 字段可见且中文标签存在。
- 全局 deny 工具不可选。
- Mock 连接/工具 API 失败：仍可通过受控手输完成必要字段（断言回退 UI 可见）。

### 10.2 `role-list.test.tsx`（Wave B）

- 能力筛选：fixture 含不同 connections / tools / sourceNames；切换筛选后列表命中正确。
- `sourceNames: []` 的角色在「按表」筛选下不出现。
- 搜索：输入 tool name / connection id / 表名可命中。
- 与状态筛选 AND 组合：例如「使用中」+ 某连接（文案以 Spec 76 合入态为准）。

### 10.3 `admin-roles.test.ts`（Wave B）

- list 响应每条 yaml role 含 `sourceNames` 数组（可为空数组，键始终存在）。

## 11. 后续候选项（本轮不做）

- `displayName` 中文展示名 + 列表优先显示中文名。
- 内部审计流水号（非 `access.yaml` key）。
- 表范围解析结果的可视化预览嵌在基本配置（权限预览 Tab 已存在则可复用，不在本轮重做）。
- 能力筛选的 URL query 持久化 / 分享。
- 按表筛选匹配 raw `tableSelectors.names` / `prefix`（未解析时）。
