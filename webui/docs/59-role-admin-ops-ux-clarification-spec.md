# Role Admin Ops UX Clarification Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin Ops UX Clarification Spec |
| 文档类型 | Product / UX / IA / Terminology / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/admin/roles`、`/admin/roles/:roleId`、`/admin/agents`、`/admin/agents/:userId` |
| 关联工单 | `webui/docs/plans/wo-M57-role-admin-ops-ux-clarification.md` |
| 事实来源 | 2026-08-02 用户反馈、浏览器核查 `http://127.0.0.1:55176/admin/roles`、`GET /api/admin/roles`、`webui/src/pages/admin/RoleList.tsx`、`webui/src/pages/admin/RoleDetail.tsx`、`webui/server/admin/roles.ts`、`webui/server/admin/role-templates.ts`、`webui/server/proxy/acl.ts` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`webui/docs/15-role-admin-spec.md`、`webui/docs/42-page-header-standardization-spec.md`、`webui/docs/57-agent-admin-usage-observability-and-role-discoverability-spec.md` |

## 1. Background

2026-08-02 对 `/admin/roles` 的浏览器核查确认，当前 Role 列表页已经能列出 YAML role、template role、invalid warning 和 Agent 引用关系，但页面心智偏“模板清单”，没有很好服务访问治理运维的核心问题：

1. 哪些 role 正在影响 Agent 的数据和 MCP 工具访问。
2. 哪些 role 当前不可正常解析，需要修复。
3. 哪些 role 已经落盘到 `access.yaml`，具备正式配置和审计含义。
4. 模板到底只是参考，还是会被当成可运行 role 使用。

当前页面的主要问题：

- Header 右上角 `1 YAML role / 6 template / 4 invalid` 与 KPI 和 summary 重复。
- 顶部 KPI `YAML role / Template / Invalid / 被引用` 是技术分类计数，缺少业务和运维解释。
- 筛选器选项 `YAML / Template / Invalid` 对用户不透明，不知道是在按来源、可用性还是风险筛选。
- 筛选器下方 `1 yaml · 6 template · 4 invalid` 是重要状态，却以弱文本展示。
- `template` 与 `invalid` badge 都贴在 role id 后，用户容易把“模板”误认为“错误态”。
- `lucy_r1_exact_readonly` 描述中的 `exact 6-tool controlled data service surface` 是模板内部设计语言，不适合作为列表主描述。
- `复制为 YAML Role` 在列表页作为主按钮，会放大模板心智；但 role 是低频、高责任配置，每次设置通常有特殊目的，应该由管理员明确创建和审阅。

## 2. Product Truth

Role 不是高频配置对象。每个 Role 都代表一个 Agent 可访问的数据源、表范围和 MCP 工具边界，通常服务于明确的业务目的、测试目的或审计责任。因此 `/admin/roles` 的默认心智必须是“正式角色权限的可服务状态”，不是“预设模板选择器”。

Template 的正确定位：

- Template 是低频辅助材料，只用于帮助管理员从一个参考权限边界起步。
- Template 不应成为列表页的主 KPI。
- Template 不应和正式 YAML role 平铺同权展示，除非用户主动查看参考模板。
- Template 复制必须表达为“基于此模板创建正式 Role”，并经过新 role id、diff、dryRun 和人工确认。
- Template 的 invalid 不等同于线上 Agent 角色故障，除非已有 Agent 实际引用或创建流程依赖它。

`待修复` 与 `已停用` 必须分开：

- `待修复` 是异常状态：配置或模板无法解析为有效权限边界，例如 `role_resolution_failed:*`。
- `已停用` 是人为生命周期状态：配置本身可以合法，但管理员主动关闭，不允许分配或运行。
- 当前数据模型没有 role-level `enabled` / `disabled` 字段，因此不得把 `invalid` 翻译成 `已停用`、`禁用` 或 `停用中`。

## 3. Goals

1. 将 `/admin/roles` 从“模板平铺列表”调整为“角色权限运维状态页”。
2. 默认聚焦正式 YAML role 和正在服务 Agent 的权限边界。
3. 将参考模板降级为低频辅助入口。
4. 用中文、业务化、运维化术语替换 `YAML / Template / Invalid / in use`。
5. 明确区分 `待修复`、`已停用`、`未被引用`、`参考模板`。
6. 让 invalid warning 从技术 reason 转换为用户可读诊断，并保留技术详情。
7. 降低 `复制为 YAML Role` 的视觉权重，改为更明确的创建动作。
8. 保持现有 ACL、dryRun、template expand 和 `access.yaml` 事实源不变。

## 4. Non-goals

- 不删除 role template 机制。
- 不改变 Lucy MCP Proxy runtime ACL 判定。
- 不改变 `access.yaml` schema。
- 不新增 role-level `enabled` 字段；本 spec 只定义如果未来出现 disabled 状态时的 UI 语义。
- 不实现 role rename、审批流或多管理员 RBAC。
- 不做移动窄屏专项验证，除非后续工单明确要求。

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Persisted Role | 正式 Role | 已落盘 Role、写入 `access.yaml` 的 Role | YAML role（作为主标签）、已启用（无 enabled 字段时） | 来源为 `source="yaml"`，存在于 `access.yaml.roles` |
| Reference Role Template | 参考模板 | 内置参考模板、Role 模板 | Template（裸露）、模板角色（暗示可直接运行） | 系统预置的只读参考配置，低频辅助创建正式 Role |
| Needs Repair | 待修复 | 权限解析失败、配置需修复 | Invalid（裸露）、禁用、已停用 | 配置无法解析为有效权限边界 |
| In Use Role | 正在服务 Agent | 被 Agent 使用、被引用 | in use、被引用（无对象） | 至少 1 个 Agent 引用该 role |
| Unused Role | 未被 Agent 使用 | 未被引用 | 空闲（可能暗示可删除） | 当前无 Agent 引用；不是错误 |
| Disabled Role | 已停用 | 人工停用 | 待修复、禁用（混同错误态） | 未来生命周期状态；当前模型没有该字段 |

Protected terms:

- `Agent`
- `MCP`
- `ACL`
- `YAML`
- `access.yaml`
- role id such as `demo_readonly`、`lucy_r1_exact_readonly`
- MCP tool names such as `lucy_query`、`wiki_read`、`connection_list`
- technical warning reason such as `role_resolution_failed:lucy_r1_exact_readonly`

包含上述专业术语、文件名、role id、tool name、错误 reason 的 DOM 节点必须使用 `translate="no"` 和 `notranslate`。

## 6. Current Behavior

### 6.1 Header

Current header:

```text
角色权限
管理 access.yaml 中的 role 模板：新建、编辑、删除、复制。每个 role 决定 Agent 可访问的数据源和 MCP 工具。
1 YAML role / 6 template / 4 invalid
从模板复制
新建 Role
```

Issues:

- 描述把 role 直接称为“模板”，削弱正式权限配置的责任感。
- Header badges 与 KPI / summary 重复。
- `从模板复制` 抢占主操作区，使模板像默认路径。

### 6.2 Metrics

Current metrics:

```text
YAML role: 1，来自 access.yaml
Template: 6，内置只读
Invalid: 4，配置需修复
被引用: 1，至少 1 位 Agent 引用
```

Issues:

- `Template` 是低频辅助对象，不应作为默认 KPI。
- `Invalid` 未说明会造成什么运维影响。
- `被引用` 比 `正在服务 Agent` 弱，不能直观表达线上影响。

### 6.3 Filters And Summary

Current filter options:

```text
全部 / YAML / Template / Invalid / 被引用
```

Issues:

- `YAML` 和 `Template` 是数据来源，不是管理员自然语言。
- `Invalid` 是技术状态，不是中文运维状态。
- summary `1 yaml · 6 template · 4 invalid` 重要但视觉过弱。

### 6.4 Role Cards

Current card example:

```text
lucy_r1_exact_readonly  template  invalid
Lucy R1 发布证据账号模板 — exact 6-tool controlled data service surface
0 个 source · 1 个 connection · 允许的 MCP 工具：6 个
role_resolution_failed:lucy_r1_exact_readonly
0 位 Agent 引用
查看
复制为 YAML Role
```

Issues:

- `template` 与 `invalid` 并列，容易产生“模板都是红色/错误”的误解。
- 英文描述不解释业务和运维用途。
- 技术 warning 直接暴露，缺少用户可读诊断。
- `复制为 YAML Role` 在列表页过于突出。

## 7. Target UX

### 7.1 Header

Target header:

```text
角色权限
管理 Agent 可访问的数据源和 MCP 工具边界。正式 Role 写入 access.yaml；参考模板仅用于低频创建辅助。
新建 Role
```

Header rules:

- 删除 header badges：不再展示 `N YAML role / N template / N invalid`。
- 主 CTA 只保留 `新建 Role`。
- `参考模板` 不放主 CTA；可作为次级链接、筛选选项或新建流程内的可选入口。

### 7.2 Top Metrics

Default metrics:

| Metric | Definition | Hint |
|---|---|---|
| `正式 Role` | `roles.filter(source === "yaml").length` | `写入 access.yaml` |
| `正在服务 Agent` | `roles.filter(usageCount > 0).length` | `至少 1 个 Agent 引用` |
| `待修复` | `roles.filter(invalid).length` | `权限解析失败，需处理后再分配` |
| `未被 Agent 使用` | valid persisted roles with `usageCount === 0` | `可检查是否保留` |

Notes:

- `参考模板` 不作为默认 KPI。
- 如果产品必须展示 template 数量，应放在状态条或参考模板入口旁：`6 个参考模板`。
- `待修复` metric 使用 danger tone；点击可切到待修复筛选。

### 7.3 Filter Bar

Replace current select with a business-oriented control.

Recommended option set:

```text
全部正式 Role
正在服务 Agent
待修复
未被 Agent 使用
参考模板
```

Filter semantics:

- `全部正式 Role`：只展示 `source="yaml"` 的 role，包含 valid / invalid / in-use / unused。
- `正在服务 Agent`：展示 `usageCount > 0` 的正式 Role。
- `待修复`：展示 `invalid=true`，包含正式 Role 和参考模板，但必须清楚标明来源。
- `未被 Agent 使用`：展示 valid persisted role 且 `usageCount=0`。
- `参考模板`：展示 `source="template"`，定位为只读参考配置。

筛选器 `aria-label` 使用 `筛选角色范围`，不要继续使用 `筛选来源`。

### 7.4 Status Summary

Replace weak text summary with a compact status strip:

```text
当前：1 个正式 Role · 1 个正在服务 Agent · 4 个待修复 · 6 个参考模板
```

Rules:

- `待修复` 使用 danger badge。
- `参考模板` 使用 neutral badge。
- summary 显示在 filter bar 下方，视觉权重高于当前 12px 弱文本。
- 数字应跟随当前数据更新，但不重复 header badges。

### 7.5 Role Card Badges

Badge copy:

| Current | Target |
|---|---|
| `yaml` | `正式 Role` or `已落盘` |
| `template` | `参考模板` |
| `invalid` | `待修复` |
| `in use` | `正在服务 Agent` |

Visual rules:

- `参考模板` 使用 neutral 或 subtle tone，不使用 warning / danger tone。
- `待修复` 使用 danger tone。
- `正在服务 Agent` 使用 success / included tone。
- 红色边框只表示 `待修复`，不表示 template。

### 7.6 User-Readable Diagnostics

Warning mapping:

| Technical reason | User-facing diagnosis | Technical detail |
|---|---|---|
| `role_resolution_failed:<roleId>` | `权限解析失败：当前配置无法生成有效的数据源 / MCP 工具边界。` | `role_resolution_failed:<roleId>` |
| unknown warning | `权限配置需检查：系统返回了未识别的校验信息。` | original warning |

Display rules:

- 列表页显示中文诊断。
- 技术 reason 放在 `技术详情` 折叠行或 muted code 节点。
- 技术 reason 必须加 translation defense。

### 7.7 Role Description Copy

`lucy_r1_exact_readonly` target description:

```text
Lucy R1 发布证据账号模板：仅允许访问 POC 数据源和 6 个受控查询工具。用于发布验收，不建议作为日常 Agent 角色。
```

Other template descriptions should follow the same pattern:

- 先说明业务用途。
- 再说明权限边界。
- 最后说明运维适用范围或限制。
- 不在列表主描述中暴露内部英文架构短语。

### 7.8 Template Actions

List page:

- Template card primary action：`查看`
- Do not show `复制为 YAML Role` as a primary button on every template card.

Template detail page:

- Show CTA：`基于此模板创建 Role`
- Helper text：

```text
创建后会写入 access.yaml，成为可编辑、可分配给 Agent 的正式 Role。保存前必须确认 YAML diff。
```

New Role flow:

- Optional secondary entry：`从参考模板开始`
- The default path remains manual role creation.

### 7.9 Disabled Role Future State

If a future spec adds role-level lifecycle, use explicit data contract:

```ts
type Role = {
  enabled?: boolean;
  disabledReason?: string;
};
```

Only then may UI show:

```text
已停用
```

`已停用` display rules:

- Neutral / muted tone.
- Not counted as `待修复`.
- Not shown for `invalid`.
- Must explain who/what disabled it if audit data exists.

## 8. Data Contract

Current API already supports most UI changes:

```ts
type Role = {
  id: string;
  description?: string;
  source?: "yaml" | "template";
  tools: string[];
  connections: string[];
  sourceCount: number;
  invalid: boolean;
  warnings: string[];
  usageCount?: number;
  users?: Array<{ id: string; name: string; enabled: boolean; tokenCount: number }>;
};
```

Frontend can derive:

- formal role count from `source === "yaml"`.
- reference template count from `source === "template"`.
- needs repair count from `invalid`.
- in-use count from `usageCount > 0`.
- unused persisted count from `source === "yaml" && !invalid && usageCount === 0`.

Recommended API usage:

- Default list query may call `/api/admin/roles?includeTemplates=false`.
- Reference template view may call `/api/admin/roles?includeTemplates=true` and filter `source="template"`.

No backend schema change is required for M57.

## 9. Accessibility And Translation Defense

- Role id, tool name, `access.yaml`, `MCP`, `Agent`, technical reason code must use `translate="no"` and `notranslate`.
- Filter control must have clear accessible label: `筛选角色范围`.
- Template CTA accessible name should include role id: `基于参考模板 lucy_r1_exact_readonly 创建 Role`.
- Danger state should not depend on border color alone; it must include visible `待修复` text and diagnosis.

## 10. Acceptance Criteria

- `/admin/roles` header no longer shows duplicate count badges.
- Header description no longer says role is primarily a template.
- Default top metrics are `正式 Role / 正在服务 Agent / 待修复 / 未被 Agent 使用`.
- `参考模板` is not a default KPI.
- Filter options are Chinese and business-oriented.
- Weak summary `N yaml · N template · N invalid` is removed or replaced by a visible status strip.
- `template` / `invalid` / `in use` are no longer visible as naked English labels.
- `待修复` is not called `禁用` or `已停用`.
- Template cards use neutral template styling; red border only communicates `待修复`.
- `lucy_r1_exact_readonly` has Chinese business / ops description.
- Template list cards do not show `复制为 YAML Role` as primary repeated CTA.
- Template detail or new role flow uses `基于此模板创建 Role` with helper text and dryRun diff expectation.
- Role list tests cover the distinction between `待修复` and future `已停用` terminology by asserting `invalid` renders as `待修复`.
- `npm run lint:terminology` passes.

## 11. Verification

```bash
cd webui
npm test -- src/__tests__/role-list.test.tsx src/__tests__/role-detail.test.tsx src/__tests__/agent-list.test.tsx
npm run lint:terminology
```

Browser check:

1. Open `/admin/roles`.
2. Confirm header duplicate badges are absent.
3. Confirm default metrics focus formal role operational state, not template count.
4. Confirm filter options are `全部正式 Role / 正在服务 Agent / 待修复 / 未被 Agent 使用 / 参考模板`.
5. Confirm `lucy_r1_exact_readonly` shows `参考模板` and `待修复` with Chinese diagnosis.
6. Confirm no visible naked `Template` / `Invalid` / `in use` remains on role cards or filters.
7. Open `lucy_r1_exact_readonly` detail and confirm the create action reads `基于此模板创建 Role`.

Mobile narrow viewport check is not required.
