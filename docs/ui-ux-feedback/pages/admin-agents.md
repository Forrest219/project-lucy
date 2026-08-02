# Agent Admin Feedback

本页记录 `/admin/agents`、`/admin/agents/:userId`、`/admin/roles` 与访问治理 Agent / Role 管理相关 UI/UX 反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

## UX-ADMIN-AGENTS-001: 顶部指标偏配置清单，缺少真实使用观测

Status: Verified
Route: `/admin/agents`
Area: Agent list metrics, Agent card usage summary
Severity: P1
Reported: 2026-08-02

### Feedback
`Token 数` 和 `Agent 数` 的关系不清楚；`7d denied` 含义和数据来源不清楚。相比单独展示拒绝数，管理员更需要看到最近访问的 Agent / Token 数量、调用次数等真实用户使用信息。

### Evidence
- User feedback on `/admin/agents`: top metrics showed `Agent 数`、`启用数`、`Token 数`、`7d denied`.
- Browser/API check confirmed `/api/admin/agents` already exposes `stats.callsLast7d`、`stats.deniedLast7d`、`lastSeen` and per-token `last_used`.

### Expected
顶部指标优先表达近期使用，而不是只表达静态配置：

- `Agent 数`
- `活跃 Token`
- `近 7 天调用`
- `近 7 天拒绝`

PageHeader 或卡片可以保留 `配置 Token`，但必须明确它是配置数量，不代表最近真实访问。`近 7 天拒绝` 必须使用中文完整标签，并在 hint 中说明来自 `access_log` / `outcome=denied`。

### Browser Check
1. Open `/admin/agents`.
2. Verify the metric grid contains `活跃 Token`、`近 7 天调用`、`近 7 天拒绝`.
3. Verify visible text no longer contains `7d denied`.
4. Verify PageHeader or card distinguishes `配置 Token` from `活跃 Token`.
5. Verify each Agent card shows `最近访问`、`近 7 天 X 次调用`、`X 个活跃 Token`、`X 次拒绝`.

### Notes
2026-08-02 已落地 M55 spec/plan 和实现：`webui/server/admin/agents.ts` 增加 `activeTokensLast7d` 与 summary；`webui/src/pages/admin/AgentList.tsx` 改为 usage-aware metrics；相关测试和 build 已通过。2026-08-02 Docker 重建后浏览器复核通过：指标区显示 `活跃 Token`、`近 7 天调用`、`近 7 天拒绝`，未再出现 `7d denied`；列表同时区分 `配置 Token` 与 `活跃 Token`，Agent card 展示最近访问、近 7 天调用、活跃 Token 和拒绝次数。

## UX-ADMIN-AGENTS-002: Agent 列表中的 role 不可发现其设置位置

Status: Verified
Route: `/admin/agents`
Area: Agent card role summary, Role navigation
Severity: P1
Reported: 2026-08-02

### Feedback
`Demo Agent` 中显示 `role: demo_readonly`，但用户找不到 role 的设置位置。

### Evidence
- Browser check before fix confirmed `/admin/agents` list rendered `role: demo_readonly` as plain text.
- Role setup actually exists at `/admin/roles/demo_readonly` and Agent detail can select role, but list page did not reveal that role is a manageable object.

### Expected
Agent card 中 role id 必须作为可导航的配置对象展示：

- visible label 使用 `角色：demo_readonly`
- `demo_readonly` 链接到 `/admin/roles/demo_readonly`
- role id 使用 `translate="no"` 和 `notranslate`
- Agent card 还应提供 `查看权限` 入口到 Agent 权限预览

### Browser Check
1. Open `/admin/agents`.
2. Locate `Demo Agent`.
3. Verify the card uses `角色：demo_readonly`.
4. Click `demo_readonly`; verify navigation reaches `/admin/roles/demo_readonly`.
5. Return to `/admin/agents`; verify `查看权限` links to the Agent permissions tab.

### Notes
2026-08-02 M55 已将 role id 改为 link，并新增 `查看权限` 入口。2026-08-02 Docker 重建后浏览器复核通过：Agent card 显示 `角色：demo_readonly`，role id 链接到 `/admin/roles/demo_readonly` 且带 `translate="no"` / `notranslate`；`查看权限` 链接到 `/admin/agents/demo_agent?tab=permissions`。

## UX-ADMIN-AGENTS-003: 列表直接展示完整 MCP 工具清单，信息价值低且边界解释不清

Status: Verified
Route: `/admin/agents`, `/admin/roles/:roleId`
Area: Agent card permissions summary, Role permissions preview
Severity: P2
Reported: 2026-08-02

### Feedback
`3 个源 · 6 个工具` 中 `6 个工具` 的显示意义不大；它实际对应“允许的 MCP 工具”，但当前列表页没有看到限制 MCP 工具的设置位置或生效机制，看起来像永远是 6 个工具。

### Evidence
- Browser/API check confirmed demo 环境中两个 Agent 都绑定 `demo_readonly`，所以都显示 6 个工具。
- Code check confirmed `role.allow.tools` 确实会经 `allowedToolNames` 过滤 `tools/list`，并经 ACL `check` 拦截未授权 `tools/call`。

### Expected
Agent 列表不默认展开完整 `Tool scope`。工具权限应转移到 role / 权限详情中解释：

- Agent card 默认展示授权源数量和 `查看权限` 入口。
- Role list 使用 `允许的 MCP 工具：N 个`，而不是裸 `N 个工具`。
- Role detail 明确说明：允许的 MCP 工具会过滤 `tools/list`，并拦截未授权 `tools/call`。
- MCP tool name、`tools/list`、`tools/call` 均需翻译防御。

### Browser Check
1. Open `/admin/agents`.
2. Verify Agent card no longer shows a full line like `Tool scope：connection_list, ...`.
3. Open `/admin/roles/demo_readonly`.
4. Verify Role detail shows `允许的 MCP 工具`.
5. Verify the page explains filtering `tools/list` and intercepting unauthorized `tools/call`.
6. Verify tool names and protocol identifiers use translation defense.

### Notes
2026-08-02 M55 已从 Agent card 移除默认完整 `Tool scope`，并在 Role list/detail 补充 `允许的 MCP 工具` 与 runtime boundary 说明。后续 code review 发现翻译防御缺口并已修复。2026-08-02 Docker 重建后浏览器复核通过：Agent card 不再显示完整 `Tool scope` 或 6 个工具清单；Role 权限预览显示 `允许的 MCP 工具`，说明过滤 `tools/list` 并拦截未授权 `tools/call`；MCP tool name 和协议标识均带 `translate="no"` / `notranslate`。

## UX-ADMIN-AGENTS-004: Demo smoke 内部文案暴露在产品列表主信息中

Status: Verified
Route: `/admin/agents`
Area: Agent card note, demo template copy
Severity: P3
Reported: 2026-08-02

### Feedback
`P0 demo smoke token; not for production.` 这句话对普通用户来说冗余、突兀，像内部测试说明。

### Evidence
- Browser check before fix confirmed `Demo Agent` card directly展示该 note。
- Demo template `examples/docker-demo/project-template/webui/config/access.yaml` 和 `examples/postgres-demo/project-template/webui/config/access.yaml` carried the old English smoke note.

### Expected
生产 UI 不在列表主信息中展示研发 smoke 文案。Demo template note 使用产品化中文：

```text
Demo 烟测账号，请勿用于生产。
```

如 note 只是内部提示，列表页应弱化或隐藏，详情页仍可编辑和查看。

### Browser Check
1. Open `/admin/agents` in demo environment.
2. Locate `Demo Agent`.
3. Verify visible list card no longer shows `P0 demo smoke token; not for production.`
4. Verify demo template note is productized if shown.

### Notes
2026-08-02 M55 已更新 docker/postgres demo template note，并从 Agent list card 移除 note 默认展示。2026-08-02 Docker 重建后浏览器复核通过：`Demo Agent` 列表卡片不再展示 `P0 demo smoke token; not for production.`。

## UX-ADMIN-AGENTS-005: Role 列表指标和 Header 统计偏技术清单，缺少运维意义

Status: Verified
Route: `/admin/roles`
Area: Role list header, metrics, status summary
Severity: P1
Reported: 2026-08-02

### Feedback
`YAML role`、`Template`、`Invalid`、`被引用` 四个 KPI 过于简单且偏技术分类，不具备业务含义和运维意义；右上角 `1 YAML role / 6 template / 4 invalid` 与页面内容重复；筛选器下方 `1 yaml · 6 template · 4 invalid` 虽然是重要状态，但展示区域过小、不明显。

### Evidence
- Screenshot: ../assets/admin-agents/UX-ADMIN-AGENTS-005-008-role-list.png
- Browser check before M57 confirmed `/admin/roles` 同时展示 Header badges、顶部 KPI 和弱 summary，且 KPI 使用 `YAML role`、`Template`、`Invalid` 等技术标签。

### Expected
`/admin/roles` 默认应表达正式 Role 的运维状态，而不是模板清单：

- Header 不展示重复计数 chips。
- 顶部指标使用 `正式 Role`、`正在服务 Agent`、`待修复`、`未被 Agent 使用`。
- `参考模板` 不作为默认 KPI。
- 重要状态 summary 应升级为明显状态条，使用中文业务语义。

### Browser Check
1. Open `/admin/roles`.
2. Verify Header no longer shows `YAML role`、`template`、`invalid` count chips.
3. Verify metric cards are `正式 Role`、`正在服务 Agent`、`待修复`、`未被 Agent 使用`.
4. Verify visible text no longer contains the weak summary pattern `N yaml · N template · N invalid`.
5. Verify the page shows a visible Chinese status strip with formal Role, Agent usage, repair, and reference-template counts.

### Notes
2026-08-02 M57 已落地 Role Admin 运维心智改版。Docker 重建后浏览器复核通过：默认页显示 `正式 Role / 正在服务 Agent / 待修复 / 未被 Agent 使用`，Header 重复 badges 已删除，旧英文 KPI 和弱 summary 未再出现。

## UX-ADMIN-AGENTS-006: Role 筛选器使用裸枚举值，用户无法理解业务含义

Status: Verified
Route: `/admin/roles`
Area: Role list filter
Severity: P1
Reported: 2026-08-02

### Feedback
筛选器中的 `YAML`、`Template`、`Invalid`、`被引用` 不知道在说什么，缺少业务含义和运维意义。

### Evidence
- Screenshot: ../assets/admin-agents/UX-ADMIN-AGENTS-006-role-filter.png
- Browser check before M57 confirmed filter options used raw source/status wording: `YAML`、`Template`、`Invalid`、`被引用`。

### Expected
筛选器必须使用管理员要完成的运维判断，而不是后端枚举名：

- `全部正式 Role`
- `正在服务 Agent`
- `待修复`
- `未被 Agent 使用`
- `参考模板`

筛选控件的 accessible label 应说明筛选对象，例如 `筛选角色范围`。

### Browser Check
1. Open `/admin/roles`.
2. Open the role filter.
3. Verify filter options are `全部正式 Role`、`正在服务 Agent`、`待修复`、`未被 Agent 使用`、`参考模板`.
4. Verify visible options no longer contain naked `YAML`、`Template`、`Invalid`.
5. Verify the select has an accessible label equivalent to `筛选角色范围`.

### Notes
2026-08-02 M57 已将 filter 语义改为中文运维口径。Docker 重建后浏览器复核通过：筛选器选项和 accessible label 均符合预期。

## UX-ADMIN-AGENTS-007: Role 状态标签和颜色没有区分参考模板、待修复与停用

Status: Verified
Route: `/admin/roles`, `/admin/roles/:roleId`
Area: Role badges, warning diagnosis, role detail permission preview
Severity: P1
Reported: 2026-08-02

### Feedback
以 `lucy_r1_exact_readonly` 为例，`template`、`invalid` 的标识很有意义，颜色也好，但需要是有业务含义和运维意义的中文；`template` 看起来每个框都是红色的；同时需要明确 `待修复` 与 `禁用` / `已停用` 是否同义。

### Evidence
- Screenshot: ../assets/admin-agents/UX-ADMIN-AGENTS-005-008-role-list.png
- Browser check before M57 confirmed invalid template cards used `template`、`invalid` English badges and red card border, with raw `role_resolution_failed:*` exposed as primary warning.

### Expected
Role 状态必须区分来源、异常和生命周期：

- `source="template"` 显示为中性 `参考模板`。
- `invalid=true` 显示为 danger `待修复`，并附中文诊断。
- 红色边框只表示 `待修复`，不表示模板。
- `待修复` 表示配置无法解析为有效权限边界；不得写成 `禁用` 或 `已停用`。
- 技术原因码保留在 `技术详情` 中，并对 role id / reason code 使用翻译防御。

### Browser Check
1. Open `/admin/roles`.
2. Select `待修复`.
3. Locate `lucy_r1_exact_readonly`.
4. Verify it shows `参考模板` and `待修复`, not `template` or `invalid`.
5. Verify the card shows a Chinese diagnosis and a separate technical detail `role_resolution_failed:lucy_r1_exact_readonly`.
6. Open `/admin/roles/lucy_r1_exact_readonly`, switch to `权限预览`, and verify the same diagnosis appears without the old raw error sentence.
7. Verify `待修复` is not rendered as `禁用` or `已停用`.

### Notes
2026-08-02 M57 已将 Role badges、warning diagnosis 和 detail permission preview 统一为中文状态语义。Docker 重建后浏览器复核通过：`lucy_r1_exact_readonly` 显示 `参考模板`、`待修复`、中文权限解析诊断，技术详情带 `translate="no"` / `notranslate`，旧原始错误句未再出现。

## UX-ADMIN-AGENTS-008: 参考模板被放大为高频复制入口，弱化了 Role 的人工审阅责任

Status: Verified
Route: `/admin/roles`, `/admin/roles/:roleId`
Area: Template role description, template create CTA
Severity: P2
Reported: 2026-08-02

### Feedback
`Lucy R1 发布证据账号模板 — exact 6-tool controlled data service surface` 这句话看不懂，显示位置不好，也没有说明业务、运维含义；`复制为 YAML Role` 的用途不清楚。Role 不是高频设置对象，每次设置都有特殊目的，值得人工设置，而非提前预判。

### Evidence
- Screenshot: ../assets/admin-agents/UX-ADMIN-AGENTS-005-008-role-list.png
- Browser check before M57 confirmed template cards直接展示英文描述，并在列表页重复提供 `复制为 YAML Role` 主按钮。

### Expected
参考模板应作为低频辅助，而不是角色页默认心智：

- 模板描述用中文说明用途、权限边界和适用/不适用场景。
- 列表页模板卡片不显示重复主按钮 `复制为 YAML Role`。
- 模板详情或新建 Role 流程使用 `基于此模板创建 Role`。
- 创建说明必须强调写入 `access.yaml`、成为可编辑正式 Role，并在保存前确认 `YAML diff`。
- 默认路径仍应支持管理员手工创建 Role。

### Browser Check
1. Open `/admin/roles` and select `待修复` or `参考模板`.
2. Locate `lucy_r1_exact_readonly`.
3. Verify the description is Chinese and explains it is a Lucy R1 publishing evidence account template with controlled POC data/tool scope.
4. Verify the list card only shows `查看`, not `复制为 YAML Role`.
5. Open `/admin/roles/lucy_r1_exact_readonly`.
6. Verify the template helper says it is read-only and the CTA is `基于此模板创建 Role`.
7. Verify helper text mentions `access.yaml` and `YAML diff`.

### Notes
2026-08-02 M57 已将参考模板降级为低频创建辅助，并更新 Lucy R1 模板描述和详情 CTA。Docker 重建后浏览器复核通过：列表页不再出现 `复制为 YAML Role`，详情页显示 `基于此模板创建 Role`，说明包含 `access.yaml` 与 `YAML diff`。
