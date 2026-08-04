# Role Admin List Clarity Follow-up Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin List Clarity Follow-up Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/admin/roles`；`GET /api/admin/roles`；`webui/src/pages/admin/RoleList.tsx`；`webui/server/admin/roles.ts`；`webui/server/admin/access-config.ts`；`webui/docs/59-role-admin-ops-ux-clarification-spec.md`（M57）；用户对 7 条反馈的核查结论；2026-08-04 上线前反对意见（使用中 yaml 口径、待修复/模板可见性、configUpdatedAt 单次 mtime、MetricCard a11y、时区格式） |
| 适用范围 | 指导 `/admin/roles` 列表页二轮清晰度修复的实现与验收；修订 Spec 59 中已被二次反馈证伪或过时的目标 UX |
| 输出位置 | `webui/docs/76-role-admin-list-clarity-followup-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 76 |
| 关联工单 | `webui/docs/plans/wo-202608-08-role-admin-list-clarity-followup.md` |
| 关联页面 | `/admin/roles` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（新增 `UX-ADMIN-AGENTS-009` ~ `UX-ADMIN-AGENTS-015`） |
| 上游 Spec | `webui/docs/59-role-admin-ops-ux-clarification-spec.md`（M57，Verified；本 Spec 对其 §7.1–7.5 做局部修订） |
| 状态 | Draft (v1.1 review-hardened) |
| 日期 | 2026-08-04 |
| 范围 | 待修复 KPI 口径、Header/状态条降噪、Role 主语术语、卡片字段标签、badge 连读歧义、复制动作表意、配置时间元数据 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：7 条二轮反馈落盘 |
| v1.1 | 上线前卡住口径：`使用中`/`未引用`/对应筛选强制 `source==="yaml"`；「待修复」筛选只展 formal invalid，模板 invalid 必须在「参考模板」持续可见；`configUpdatedAt` 复用 `readAccessYaml` 单次 mtime；MetricCard 可点击 a11y；时间展示固定 `Asia/Shanghai` |

## 1. 背景

M57（Spec 59）已将 `/admin/roles` 从「模板平铺清单」改为「正式 Role 运维状态页」，术语从 `YAML / Template / Invalid` 收敛为中文运维口径，并完成浏览器复核（`UX-ADMIN-AGENTS-005` ~ `008` = Verified）。

2026-08-04 对同页的二轮反馈与浏览器核查确认：M57 解决了「技术英文标签」问题，但默认页仍存在**数字与列表脱节、主语偏 Agent、文案冗余、卡片不可扫读**的清晰度问题。7 条反馈均属实（第 1、2 条比字面更严重）：

| # | 反馈摘要 | 核查结论 |
|---|---|---|
| 1 | 「待修复」看不出修什么 | **属实且更严重**：KPI=4，默认筛选「全部正式 Role」列表看不到；切「待修复」后 4 条**全部是参考模板**解析失败，正式 Role `invalid=false` |
| 2 | Header「参考模板仅用于低频创建辅助」冗余 | **属实（默认心智下）**：模板只在筛选中出现，默认列表无模板卡片 |
| 3 | 「正在服务 Agent / 未被 Agent 使用」串台；状态条冗余 | **属实**：KPI/筛选偏 Agent；状态条重复 KPI 并塞入「6 个参考模板」 |
| 4 | `demo_readonly` 卡片缺标题-内容对应 | **属实**：裸描述、裸 tool chips、无字段标签 |
| 5 | 「正式 Role 正在服务 Agent」无义务含义 | **属实**：两枚 badge 并排被读成一句复合义务 |
| 6 | 「复制」表意弱 | **属实**：未说明是「基于此 Role 新建」 |
| 7 | 缺创建/最后修改日期 | **属实**：UI 与 `GET /api/admin/roles` 均无时间字段 |

本 Spec 是 Spec 59 的**局部修订与二轮打磨**，不推翻 M57 的正式 Role 优先心智，只修正已被二次反馈证伪的目标细节。

## 2. 目标

1. **KPI「待修复」与默认列表一致**：默认页数字只反映正式 Role 的异常；模板解析失败不得在无人点击筛选时制造「有 4 个待修」的假象。
2. **删除默认页冗余文案**：Header 不再提参考模板；删除与 KPI 重复的状态条。
3. **KPI / 筛选 / badge 改 Role 主语**：避免「正在服务 Agent / 未被 Agent 使用」把页面读成 Agent 管理页。
4. **Role 卡片可扫读**：字段有标签；badge 不可连读成一句义务；工具列表有标题。
5. **复制动作表意明确**：列表「复制」改为「基于此新建」（或等价清晰文案）。
6. **补配置时间元数据**：正式 Role 卡片展示 `access.yaml` 配置最近写入时间；不伪造 per-role 创建日期。

## 3. 非目标

- 不删除参考模板机制，不改变 template expand / dryRun / copy API 路径语义。
- 不改变 Lucy MCP Proxy runtime ACL 判定。
- 不改 `access.yaml` schema（不新增 per-role `createdAt` / `updatedAt` / `enabled` 字段）。
- 不把 `invalid` 翻译成 `已停用` / `禁用`（沿用 Spec 59）。
- 不把 KPI「待修复」改回统计全部 template invalid 作为默认主指标。
- 不实现真正的 per-role 创建日期（需 schema 变更，单列后续 Spec）。
- 不做移动窄屏专项验证。
- 本轮验收以 Vitest + `lint:terminology` + `build` 为准；浏览器复核可另排，不阻塞合入。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`，并修订 Spec 59 §5 中与本轮冲突的 UI 主术语。

| Canonical Term | UI 主术语（本轮） | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Persisted Role | 正式 Role | 已落盘 Role | YAML role（主标签）、已启用（无 enabled 字段时） | `source="yaml"`；badge 短标签可用 `正式` |
| Reference Role Template | 参考模板 | 内置参考模板 | Template（裸露）、模板角色（暗示可直接运行） | 低频辅助；不进默认 KPI |
| Needs Repair (formal) | 待修复 | 正式 Role 权限解析失败 | Invalid、禁用、已停用 | **KPI 仅统计正式 Role** |
| Template Resolution Issue | 环境未就绪 / 参考模板无法解析 | 当前环境无法解析该模板 | 待修复（作为正式 Role 故障暗示） | 模板 invalid 的诊断口径，不等于线上正式 Role 故障 |
| In Use Role | 使用中 | 被 Agent 引用 | 正在服务 Agent（主标签）、in use、已启用 | Role 主语；hint 可写「至少 1 个 Agent 引用」 |
| Unused Role | 未引用 | 暂无 Agent 引用 | 未被 Agent 使用（主标签）、空闲（暗示可删） | Role 主语 |
| Copy As New Role | 基于此新建 | 复制为新 Role | 复制（无对象）、复制为 YAML Role | 列表次级动作；创建正式 Role |
| Config Last Written | 配置最近写入 | access.yaml 最近修改 | 创建日期（在无字段时伪造） | 来自 `access.yaml` mtime |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：

- `Agent`、`MCP`、`ACL`、`YAML`、`access.yaml`
- role id（如 `demo_readonly`）、MCP tool names、`role_resolution_failed:*`

实现本 Spec 时，若 `00-product-terminology-standard.md` 仍登记旧主术语「正在服务 Agent / 未被 Agent 使用」，应在同一 PR 内按上表更新对应行，避免术语标准与 UI 漂移。

## 5. 对 Spec 59 的修订点

| Spec 59 原文 | 本 Spec 修订 |
|---|---|
| §7.1 Header 含「参考模板仅用于低频创建辅助」 | **删除**该从句；Header 只说明正式 Role 职责 |
| §7.2「待修复」= `roles.filter(invalid).length` | **改为**仅 `source==="yaml" && invalid`；模板 invalid 不进该 KPI |
| §7.2「正在服务 Agent」「未被 Agent 使用」 | **改为**「使用中」「未引用」；KPI 与筛选均强制 `source==="yaml"` |
| §7.4 必须展示状态条（含参考模板数） | **删除**默认状态条；筛选非默认时可显示「当前筛选」一句 |
| §7.5 badge「正式 Role」「正在服务 Agent」 | badge 短标签改为「正式」「使用中」，避免连读；使用中仅 yaml |
| （未覆盖）卡片字段标签、复制文案、时间元数据 | 本 Spec §7–9 新增；`configUpdatedAt` 复用 `readAccessYaml` 单次 mtime；UI 固定 `Asia/Shanghai` |

未修订部分（仍有效）：正式 Role 默认筛选、参考模板不进默认 KPI、待修复 ≠ 已停用、中文诊断 + 技术详情、模板列表仅「查看」、详情 CTA「基于此模板创建 Role」。

## 6. 当前行为（2026-08-04 核查基线）

### 6.1 Header

```text
角色权限
管理 Agent 可访问的数据源和 MCP 工具边界。正式 Role 写入 access.yaml；参考模板仅用于低频创建辅助。
新建 Role
```

### 6.2 Metrics

```text
正式 Role: 1 · 写入 access.yaml
正在服务 Agent: 1 · 至少 1 个 Agent 引用
待修复: 4 · 权限解析失败，需处理后再分配   ← 4 个全是 template
未被 Agent 使用: 0 · 正式 Role 中未被引用
```

### 6.3 Status strip + filter

```text
筛选默认：全部正式 Role
当前：1 个正式 Role · 1 个正在服务 Agent · 4 个待修复 · 6 个参考模板
列表：仅 demo_readonly
```

### 6.4 Formal role card

```text
demo_readonly  [正式 Role] [正在服务 Agent]
Demo Superstore readonly agent
3 个 source · 1 个 connection · 允许的 MCP 工具：6 个
[kx_catalog] [sql_query] ...
3 位 Agent 引用 · demo_agent, zhaoying, xxx
编辑 / 复制 / 删除
```

无字段标签，无配置时间。

### 6.5 API

`GET /api/admin/roles` 返回的 Role 摘要无 `createdAt` / `updatedAt` / `configUpdatedAt`。

## 7. 目标 UX

### 7.1 Header

```text
角色权限
管理 Agent 可访问的数据源和 MCP 工具边界。正式 Role 写入 access.yaml。
新建 Role
```

规则：

- 删除「参考模板仅用于低频创建辅助」。
- 参考模板说明只出现在：筛选「参考模板」的空态 / 列表提示，或新建流程次级入口。

### 7.2 Top Metrics

| Metric | Definition | Hint | Tone | 对应筛选 |
|---|---|---|---|---|
| `正式 Role` | `source === "yaml"` | `写入 access.yaml` | default | `formal` |
| `使用中` | `source === "yaml" && usageCount > 0` | `至少 1 个 Agent 引用` | default | `in-use` |
| `待修复` | `source === "yaml" && invalid` | `正式 Role 权限解析失败` | danger | `needs-repair` |
| `未引用` | `source === "yaml" && !invalid && usageCount === 0` | `正式 Role 暂无 Agent 引用` | default | `unused` |

**硬口径（实现必须遵守，禁止与现实现「只看 usageCount」混用）：**

1. `summarizeRoles` 的 `inUseCount` / `unusedFormalCount` / `needsRepairCount` **全部**只统计 `source === "yaml"` 的条目。模板即使 `usageCount > 0` 也不得计入「使用中」KPI（正常情况下模板不应被 Agent 引用；即便数据异常也不能污染正式运维指标）。
2. 筛选过滤与 KPI **一一对齐**：
   - `in-use`：`source === "yaml" && usageCount > 0`
   - `needs-repair`：`source === "yaml" && invalid`（**只展正式 Role**）
   - `unused`：`source === "yaml" && !invalid && usageCount === 0`
   - `templates`：`source === "template"`（含 valid 与 invalid）
   - `formal`：`source === "yaml"`
3. **KPI「待修复」不得计入 `source === "template"` 的 invalid。**
4. 当正式「待修复」= 0 但存在 template invalid 时：默认 KPI 显示 0；点「待修复」得到正式空列表时，可显示弱提示「没有正式 Role 待修复」。**模板解析失败的根因必须在「参考模板」筛选下持续可见**（`待修复` badge + §8 诊断文案 + 技术详情），不得因收紧「待修复」筛选而消失。
5. 推荐筛选文案：

```text
全部正式 Role
使用中
待修复          ← 仅 formal + invalid
未引用
参考模板        ← 模板 invalid 诊断的主入口
```

#### MetricCard 可点击 + 可访问性（强制）

四个 MetricCard 必须可切换对应筛选，且满足：

- 交互元素使用 `<button type="button">`（或语义等价的可聚焦控件），**禁止**仅在 `<div onClick>` 上挂点击。
- 每个控件有明确 `aria-label`（例如 `筛选：使用中`）。
- 当前激活的筛选对应卡片设置 `aria-pressed="true"`，其余为 `false`（若用 toggle button 模式）；或用 `aria-current` 表达当前范围。
- Tab 键可达；Enter / Space 可激活（原生 `button` 即满足）。
- 保留 `data-testid`（如 `role-metric-使用中`）供测试。

### 7.3 删除默认状态条

- 删除 `data-testid="role-status-strip"` 所代表的默认摘要条。
- 可选：仅当 `sourceFilter !== "formal"` 时显示一行弱提示，例如 `当前筛选：待修复（0）`，不重复四个 KPI 数字，不展示「N 个参考模板」总览。

### 7.4 Role Card — 字段标签与 badge

目标结构（正式 Role 示例）：

```text
demo_readonly                         [正式] [使用中]
描述：Demo Superstore readonly agent
数据范围：3 个 source · 1 个 connection
允许的 MCP 工具：6 个
  [kx_catalog] [sql_query] ...
引用 Agent：3 个 · demo_agent, zhaoying, xxx
配置最近写入：2026-08-04 14:32
编辑 / 基于此新建 / 删除
```

规则：

| 元素 | 要求 |
|---|---|
| Source badge | 短标签 `正式` 或完整 `正式 Role`（二选一，全页一致）；`tone=done` |
| Usage badge | 仅当 `source === "yaml" && usageCount > 0` 显示 `使用中`；**禁止**再使用「正在服务 Agent」作为 badge 文案；模板即使异常带 usage 也不贴「使用中」 |
| Repair badge | `invalid` 时显示 `待修复`（danger） |
| Template badge | `参考模板`（neutral） |
| 描述 | 前缀标签 `描述：`；无 description 时整行省略 |
| 数据范围 | 前缀 `数据范围：` + source/connection 计数 |
| 工具 | 保留「允许的 MCP 工具：N 个」；chips 紧随其后，视为该字段的值 |
| 引用 | 前缀 `引用 Agent：` + 计数与 id 列表 |
| 时间 | 正式 Role 显示 `配置最近写入：{formatted}`；模板显示 `内置参考模板`（不显示伪造日期） |
| 动作 | `编辑` / `基于此新建` / `删除`；`基于此新建` 的 `title` 与 `aria-label` 须说明「基于此 Role 创建新的正式 Role」 |

Badge 视觉：两枚及以上 badge 之间用间距分隔，不得排成可连读的无标点短语；若需说明关系，使用独立字段「引用 Agent」而不是把 Agent 塞进 source badge。

### 7.5 复制动作

| 位置 | 文案 |
|---|---|
| 正式 Role 列表次级链接 | `基于此新建` |
| 模板详情主 CTA | 仍为 Spec 59 的 `基于此模板创建 Role`（本轮不改详情页，除非测试断言冲突） |
| 路由 | 保持 `/admin/roles/:roleId?mode=copy` |

禁止把列表按钮写回裸「复制」。

### 7.6 配置时间元数据

#### API

`GET /api/admin/roles`（及必要时 detail）增加：

```ts
configUpdatedAt?: string | null; // ISO-8601，access.yaml 的 mtime
```

规则：

- **单次 mtime，禁止 O(N) `stat`：** `readAccessYaml()` 已对 `access.yaml` 做一次 `stat`（见 `server/admin/access-config.ts`）。本轮应把该次 `mtime` 透出（推荐扩展 `AccessFile` 增加 `mtimeMs` 或 `configUpdatedAt`），由 list handler **一次**写入所有 yaml role 的同一 `configUpdatedAt`。禁止在 `roles.map` 内对每个 role 再 `fs.stat`。
- 对 `source === "yaml"` 的条目填写同一 `configUpdatedAt`（文件级时间，诚实标注为配置文件最近写入）。
- 对 `source === "template"` 的条目显式 `null` 或不返回。
- **不**新增 `createdAt` / per-role `updatedAt`（Non-goal）。
- **不**从 `version` 字符串反解 mtime（脆弱）；以结构化字段传递。

#### UI

- 正式 Role 卡片：`配置最近写入：YYYY-MM-DD HH:mm`。
- **时区与格式固定：** 使用统一 formatter，时区 `Asia/Shanghai`，`hour12: false`，输出 `YYYY-MM-DD HH:mm`（对齐 `ConnectionOverview` 等已有 `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ... })` 模式）。禁止依赖浏览器默认本地时区，避免「同一 ISO 在不同机器显示不同钟点」造成「时间被改过」的误解。
- 模板卡片：`内置参考模板`（无时间）。
- 页面级不强制再放一条重复的文件时间，除非卡片无法展示。

## 8. 诊断文案微调（模板 invalid）

沿用 Spec 59 的中文诊断主句。当 `source === "template" && invalid` 时，列表诊断可追加一句弱说明（非替换）：

```text
权限解析失败：当前配置无法生成有效的数据源 / MCP 工具边界。
该条目是参考模板；当前环境可能缺少对应连接或表，不代表已落盘正式 Role 故障。
技术详情：role_resolution_failed:<roleId>
```

正式 Role invalid 不加「参考模板」从句。

## 9. 测试要求

优先更新 / 新增 `src/__tests__/role-list.test.tsx`，覆盖：

1. KPI「待修复」在仅有 template invalid、无 formal invalid 时为 `0`。
2. Header description **不包含**「参考模板仅用于低频创建辅助」。
3. 页面**不渲染**默认 `role-status-strip`（或等价摘要条不再出现四个 KPI 复读 + 参考模板数）。
4. Metric / filter 文案为 `使用中` / `未引用`，不再出现主标签 `正在服务 Agent` / `未被 Agent 使用`。
5. **`使用中` KPI 与 `in-use` 筛选不计 template：** fixture 含 `source=template && usageCount>0` 时，KPI「使用中」与筛选「使用中」列表仍只含 yaml role。
6. **`未引用` / `unused` 同理只含 yaml。**
7. `demo_readonly` 卡片含可见字段标签：`描述`、`数据范围`、`允许的 MCP 工具`、`引用 Agent`（或本 Spec 最终采用的标签全集）。
8. 正式 Role 动作含 `基于此新建`，不含裸按钮文案 `复制`。
9. 正式 Role 卡片展示 `配置最近写入`（`Asia/Shanghai` 格式）；模板卡片不伪造创建日期。
10. badge 不出现「正在服务 Agent」连读文案；`invalid` 仍不得渲染为 `已停用` / `禁用`。
11. **模板 invalid 可见性：** 切到「参考模板」后，invalid 模板卡片仍显示 `待修复` badge、§8 中文诊断与技术详情；不得因「待修复」筛选收紧而丢失。
12. **MetricCard a11y：** 指标为 `button`（或等价），带 `aria-label`；点击后筛选切换；当前筛选项有 `aria-pressed` 或 `aria-current`。

后端：`server/__tests__/admin-roles.test.ts`：

1. 列表响应 yaml role 含 ISO `configUpdatedAt`；template 为 `null`/缺省。
2. 断言实现路径不依赖 per-role 额外 `stat`（可通过 spy `stat` 调用次数，或断言 `AccessFile` 已透出 mtime 且 list 仅用该值）——至少保证单次 list 请求对 `access.yaml` 的 `stat` 次数不随 role 数量线性增长。

回归：`role-detail.test.tsx`、相关 Agent 页若仍断言旧 KPI/badge 文案，一并更新。

## 10. Acceptance Criteria

- [ ] 默认 `/admin/roles`：正式 Role KPI 与列表可见集合语义一致；「待修复」在仅有模板失败时为 0。
- [ ] Header 无参考模板低频说明句；无默认状态条复读 KPI。
- [ ] KPI/筛选/badge 使用 Role 主语：`使用中` / `未引用` / `待修复` / `正式`。
- [ ] **`使用中` / `未引用` / `待修复` 的 KPI 与筛选均强制 `source === "yaml"`，不计模板。**
- [ ] **「参考模板」筛选下，invalid 模板仍可见且保留诊断文案（无认知断层）。**
- [ ] 正式 Role 卡片具备标题-内容字段标签；工具 chips 从属「允许的 MCP 工具」。
- [ ] 列表复制动作为 `基于此新建`，表意覆盖「基于当前 Role 创建新正式 Role」。
- [ ] 正式 Role 展示 `配置最近写入`（来自 `readAccessYaml` 单次 mtime，`Asia/Shanghai` 格式化）；不展示伪造的创建日期。
- [ ] MetricCard 为可聚焦 `button`（或等价），键盘可达，带 `aria-label` / pressed-or-current 状态。
- [ ] `npm test`（role-list / role-detail / admin-roles 相关）全绿；`npm run lint:terminology`；`npm run build`。

## 11. 台账映射

| 反馈 # | Ledger ID | Severity |
|---|---|---|
| 1 | `UX-ADMIN-AGENTS-009` | P1 |
| 2 | `UX-ADMIN-AGENTS-010` | P2 |
| 3 | `UX-ADMIN-AGENTS-011` | P1 |
| 4 | `UX-ADMIN-AGENTS-012` | P2 |
| 5 | `UX-ADMIN-AGENTS-013` | P2 |
| 6 | `UX-ADMIN-AGENTS-014` | P2 |
| 7 | `UX-ADMIN-AGENTS-015` | P2 |
