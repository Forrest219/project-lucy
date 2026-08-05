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

## UX-ADMIN-AGENTS-009: 「待修复」KPI 与默认列表脱节，数字来自参考模板

Status: Fixed
Route: `/admin/roles`
Area: Role list metrics, needs-repair filter
Severity: P1
Reported: 2026-08-04

### Feedback
四个 KPI 中「待修复」看不出修什么；默认页看不到待修复对象。

### Evidence
- 浏览器核查 `http://127.0.0.1:55176/admin/roles`：默认筛选「全部正式 Role」，列表仅 `demo_readonly`；KPI「待修复」= 4。
- 切筛选「待修复」后出现 4 张卡，全部带 `参考模板` + `待修复`（`lucy_r1_exact_readonly` / `kx_readonly` / `superstore_readonly` / `dev_superstore`）。
- `GET /api/admin/roles`：正式 Role `demo_readonly` 的 `invalid=false`；4 个 invalid 均为 `source=template`。

### Expected
- KPI「待修复」只统计正式 Role（`source=yaml && invalid`）。
- 「待修复」筛选与 KPI 对齐，默认不把模板解析失败算作正式运维故障。
- Metric 可点击切换筛选；模板 invalid 在「参考模板」筛选中通过 badge + 诊断可见。

### Browser Check
1. Open `/admin/roles` with only template invalid roles.
2. Verify KPI「待修复」= 0 while formal list shows healthy roles.
3. Switch to「参考模板」and verify invalid templates still show `待修复` diagnosis.
4. Click KPI「待修复」and verify filter aligns with formal-only repair set.

### Notes
Mapped to Spec 76 / `wo-202608-08`. Revises Spec 59 §7.2 needs-repair counting.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-010: Header 参考模板说明在默认页冗余

Status: Fixed
Route: `/admin/roles`
Area: PageHeader description
Severity: P2
Reported: 2026-08-04

### Feedback
「参考模板仅用于低频创建辅助」冗余；默认页看不到角色模板。

### Evidence
- Header description 含该从句；默认列表无模板卡片；模板仅出现在筛选「参考模板」。

### Expected
Header 只说明正式 Role 职责与 `access.yaml`；模板说明下沉到模板筛选空态或新建次级入口。

### Browser Check
1. Open `/admin/roles`.
2. Verify header description does not mention「参考模板仅用于低频创建辅助」.
3. Switch to「参考模板」and verify template context still discoverable.

### Notes
Mapped to Spec 76 / `wo-202608-08`. Revises Spec 59 §7.1.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-011: KPI/筛选主语偏 Agent，状态条重复冗余

Status: Fixed
Route: `/admin/roles`
Area: Metrics, filters, status strip
Severity: P1
Reported: 2026-08-04

### Feedback
「正在服务 Agent / 未被 Agent 使用」串台到 Agent；状态条「当前：1 个正式 Role · … · 4 个待修复 · 6 个参考模板」冗余且不适合当前页。

### Evidence
- KPI/filter 使用 Agent 主语文案；`role-status-strip` 复读 KPI 并展示参考模板总数。

### Expected
- 主术语改为 Role 主语：`使用中` / `未引用`。
- 删除默认状态条；筛选非默认时最多显示「当前筛选」弱提示。

### Browser Check
1. Open `/admin/roles`.
2. Verify metrics/filters use `使用中` / `未引用`.
3. Verify default page has no status strip repeating KPI + template count.
4. Verify visible primary labels no longer use `正在服务 Agent` / `未被 Agent 使用`.

### Notes
Mapped to Spec 76 / `wo-202608-08`. Revises Spec 59 §7.2–7.4. Do not use `已启用` without lifecycle field.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-012: Role 卡片缺少标题-内容字段标签

Status: Fixed
Route: `/admin/roles`
Area: Role card content structure
Severity: P2
Reported: 2026-08-04

### Feedback
`demo_readonly` 卡片只有内容没有字段标题，全靠用户猜。

### Evidence
- Card shows bare description, bare tool chips, source/connection counts without labels like `描述` / `数据范围`.

### Expected
Card fields labeled: `描述`、`数据范围`、`允许的 MCP 工具`、`引用 Agent`（及本轮时间字段）。

### Browser Check
1. Open `/admin/roles`.
2. Locate `demo_readonly`.
3. Verify each content block has a visible field label.

### Notes
Mapped to Spec 76 / `wo-202608-08`.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-013: 「正式 Role」「正在服务 Agent」badge 连读歧义

Status: Fixed
Route: `/admin/roles`
Area: Role card badges
Severity: P2
Reported: 2026-08-04

### Feedback
「正式 Role 正在服务 Agent」读不出义务含义，像一句复合义务。

### Evidence
- Two adjacent badges `正式 Role` + `正在服务 Agent` after role id.

### Expected
Short non-compound badges such as `正式` + `使用中`; Agent relationship expressed in `引用 Agent` field, not as a second obligation phrase.

### Browser Check
1. Open `/admin/roles`.
2. Locate `demo_readonly`.
3. Verify badges are not readable as one obligation sentence.
4. Verify usage relationship appears under `引用 Agent` or equivalent labeled field.

### Notes
Mapped to Spec 76 / `wo-202608-08`.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-014: 「复制」按钮表意不足

Status: Fixed
Route: `/admin/roles`
Area: Role card actions
Severity: P2
Reported: 2026-08-04

### Feedback
「复制」猜测是复制角色配置，但表意不够明显。

### Evidence
- Formal role card action link text is bare `复制` to `?mode=copy`.

### Expected
List action label `基于此新建` with accessible name explaining create-new-formal-role-from-this; keep `?mode=copy` route.

### Browser Check
1. Open `/admin/roles`.
2. Verify formal role actions include `基于此新建`, not bare `复制`.
3. Click it and verify still opens copy/create flow.

### Notes
Mapped to Spec 76 / `wo-202608-08`. Distinct from template detail CTA `基于此模板创建 Role`.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-015: Role 列表缺少配置时间元数据

Status: Fixed
Route: `/admin/roles`
Area: Role card metadata, roles API
Severity: P2
Reported: 2026-08-04

### Feedback
角色很重要的创建日期、最后修改日期都没有看到。

### Evidence
- UI cards have no dates; `GET /api/admin/roles` returns no `createdAt` / `updatedAt`.

### Expected
- This round: expose `configUpdatedAt` from `access.yaml` mtime; formal cards show `配置最近写入`.
- Do not fabricate per-role created date without schema support; templates show `内置参考模板`.

### Browser Check
1. Open `/admin/roles`.
2. Verify formal role card shows `配置最近写入` with a formatted timestamp.
3. Switch to templates and verify no fake created date.

### Notes
Mapped to Spec 76 / `wo-202608-08`. Per-role `createdAt` remains Non-goal until `access.yaml` schema changes.
2026-08-04 Spec 76 / wo-202608-08 已落地（Vitest + lint:terminology + build；本轮不做浏览器复核）。

## UX-ADMIN-AGENTS-016: 新建 Role 标题与副标题叠句

Status: Fixed
Route: `/admin/roles/new`
Area: Role create header
Severity: P3
Reported: 2026-08-04
Fixed: 2026-08-04（Spec 77 / wo-202608-09 Wave A；Vitest + lint + build；本轮不做浏览器复核）

### Feedback
标题「新建 Role」与副标题「新建正式 Role，…」重复；不清楚两者区别。

### Evidence
- Browser: page H1 `新建 Role`；description 以 `新建正式 Role` 开头。
- Code: `RoleDetail.tsx` create-mode `PageHeader` title/description.

### Expected
- 标题保持 `新建 Role`。
- 副标题改为职责说明（连接 / 表范围 / MCP 工具 + dryRun 确认），不以「新建正式 Role」开头。
- 「正式」仅在相对参考模板需要区分时出现。

### Browser Check
1. Open `/admin/roles/new`.
2. Verify title is `新建 Role`.
3. Verify description does not start with `新建正式 Role`.

### Notes
Mapped to Spec 77 / `wo-202608-09`. 「正式 Role」相对「参考模板」的概念仍保留在列表/badge。

## UX-ADMIN-AGENTS-017: Role 身份字段只有技术 ID，缺少中文说明心智

Status: Fixed
Route: `/admin/roles/new`
Area: Role create identity fields
Severity: P2
Reported: 2026-08-04
Fixed: 2026-08-04（Spec 77 / wo-202608-09 Wave A；Vitest + lint + build；本轮不做浏览器复核）

### Feedback
Role ID 与 Role Name 应分开；用户只需填中文名，ID 应像流水号。

### Evidence
- Form only has `Role ID` (slug regex) + `描述`.
- `access.yaml` role key is the id Agents bind to; no separate display name field.

### Expected
- Label `Role ID` → `角色标识`，hint 说明是 Agent 引用用的技术标识。
- `描述` → `说明`（中文用途主文案）。
- Do **not** default to meaningless serial ids this round.
- Optional: suggest ASCII slug from 说明 when 标识 empty; never overwrite user input.

### Browser Check
1. Open `/admin/roles/new`.
2. Verify labels `角色标识` and `说明`.
3. Verify hint explains technical id / Agent reference purpose.

### Notes
Mapped to Spec 77 / `wo-202608-09`. `displayName` / serial schema deferred.

## UX-ADMIN-AGENTS-018: 权限字段英文标签缺少业务用途

Status: Fixed
Route: `/admin/roles/new`
Area: Role allow config labels
Severity: P2
Reported: 2026-08-04
Fixed: 2026-08-04（Spec 77 / wo-202608-09 Wave A；Vitest + lint + build；本轮不做浏览器复核）

### Feedback
Connections、MCP 工具、Table Selectors 难懂，应优先中文并提示业务用途。

### Evidence
- Labels: `Connections`, `MCP 工具`, `Table Selectors`, button `+ 添加 selector`.

### Expected
- `允许的连接` / `允许的 MCP 工具` / `可访问的表范围` + purpose hints.
- Primary button `+ 添加表范围`.

### Browser Check
1. Open `/admin/roles/new`.
2. Verify Chinese primary labels and purpose hints.
3. Verify no bare `Connections` / `Table Selectors` as primary labels.

### Notes
Mapped to Spec 77 / `wo-202608-09`. Aligns with terminology standard Connection → 连接.

## UX-ADMIN-AGENTS-019: MCP 工具与表范围以手录为主，缺少选择器

Status: Fixed
Route: `/admin/roles/new`
Area: Role allow config inputs
Severity: P1
Reported: 2026-08-04
Fixed: 2026-08-04（Spec 77 / wo-202608-09 Wave A；Vitest + lint + build；本轮不做浏览器复核）

### Feedback
MCP 工具、Table Selectors 应该用选择方式，而不是录入。

### Evidence
- Connections / MCP tools are textareas.
- Spec 15 §5.3 already required multi-select; implementation lagged.
- Candidate APIs exist: `/api/admin/mcp-tools`, `/api/connections`, `/api/connections/:id/tables`.

### Expected
- Connections and MCP tools: multi-select from candidates.
- Exact table names: multi-select tables after connection/schema.
- Global denied tools not selectable.
- Write path body shape unchanged (`connections` / `tools` / `tableSelectors`).

### Browser Check
1. Open `/admin/roles/new`.
2. Verify connection and MCP tool pickers (not textarea-only).
3. Add a table range and select tables via picker for 指定表名.

### Notes
Mapped to Spec 77 / `wo-202608-09`. Completes Spec 15 §5.3 debt.

## UX-ADMIN-AGENTS-020: table selector 的 names / prefix 难懂

Status: Fixed
Route: `/admin/roles/new`
Area: Table selector match mode
Severity: P2
Reported: 2026-08-04
Fixed: 2026-08-04（Spec 77 / wo-202608-09 Wave A；Vitest + lint + build；本轮不做浏览器复核）

### Feedback
prefix 和 names 是什么意思？有什么区别？用户难以理解。

### Evidence
- After `+ 添加 selector`, radios show English `names` / `prefix` with no purpose copy.

### Expected
- Default: `指定表名`（exact authorize listed tables）.
- Advanced: `按前缀匹配` with hint e.g. authorize tables starting with `poc_`.
- No bare English `names` / `prefix` as primary radio labels.

### Browser Check
1. Open `/admin/roles/new` and add a table range.
2. Verify Chinese match-mode labels and prefix hint.

### Notes
Mapped to Spec 77 / `wo-202608-09`. YAML field names remain `names` / `prefix` under the hood.

## UX-ADMIN-AGENTS-021: Role 列表缺少按连接 / 工具 / 表的能力筛选

Status: Fixed
Route: `/admin/roles`
Area: Role list filters
Severity: P2
Reported: 2026-08-04
Fixed: 2026-08-04（Spec 77 / wo-202608-09 Wave B；Vitest + lint + build；本轮不做浏览器复核）

### Feedback
截图中的筛选器需要同步修正，支持按 MCP 工具、Table、Connections 等关键条件筛选。

### Evidence
- Filter dropdown only: 全部正式 Role / 正在服务 Agent / 待修复 / 未被 Agent 使用 / 参考模板.
- Search placeholder: `按 role id / 描述搜索`.
- User screenshot of status filter matches runtime options.

### Expected
- Keep status filter (align wording with Spec 76 when present).
- Add capability filters: by connection, by MCP tool, by table/source.
- Search covers id / 说明 / connection / tool / table (`sourceNames` on list API).
- Status AND capability; multi-select within a capability dimension uses OR.

### Browser Check
1. Open `/admin/roles`.
2. Verify capability filter controls exist.
3. Filter by a known connection/tool/table and confirm list matches.
4. Search by tool or table name and confirm hit.

### Notes
Mapped to Spec 77 / `wo-202608-09`. Parallel to Spec 76 status/KPI work; does not replace it.

## UX-ADMIN-AGENTS-022: 「Agent 实例」命名不符用户认知

Status: Fixed
Route: `/admin/agents`
Area: Page title, sidebar nav label, breadcrumbs, back links
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 88 / `wo-202608-20`；本轮不做浏览器验证）

### Feedback
「Agent 实例」不符合用户对访问身份（Demo Agent 等）的认知；副标题重复「实例」。

### Evidence
- 浏览器 2026-08-05：侧栏与 H1 均为「Agent 实例」。
- 代码：`AgentList.tsx` title、`navigation.ts` label。

### Expected
侧栏、H1、面包屑、返回链主标签改为 **Agent**；路由仍 `/admin/agents`。

### Browser Check
1. Open `/admin/agents`.
2. Verify sidebar current item and `h1` read `Agent`, not `Agent 实例`.

### Notes
Spec 88 / `wo-202608-20`。术语 §4.5 登记 Agent Admin Page Title。

## UX-ADMIN-AGENTS-023: PageHeader count badges 与 KPI 重复

Status: Fixed
Route: `/admin/agents`
Area: PageHeader badges
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 88 / `wo-202608-20`；本轮不做浏览器验证）

### Feedback
`3 个 Agent / N 已启用 / N 配置 Token` 与下方 KPI 重复，且与 `/admin/usage`、`/admin/roles` 顶栏规范不一致。

### Evidence
- PageHeader badges：`badge-agent-total`、`badge-enabled-total`、`badge-configured-token-total`。
- 对照页无同类 count badge。

### Expected
删除 PageHeader badges；`actions` 仅保留 `新建 Agent`（primary）。

### Browser Check
1. Open `/admin/agents`.
2. Confirm no badge text matching `个 Agent` / `已启用` / `配置 Token` in PageHeader.
3. Confirm `新建 Agent` primary button remains.

### Notes
对齐 Spec 42 PageHeader 规范与 `角色权限` 页。

## UX-ADMIN-AGENTS-024: 顶部 KPI 命名未与使用概况对齐

Status: Fixed
Route: `/admin/agents`
Area: KPI metric grid
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 88 / `wo-202608-20`；本轮不做浏览器验证）

### Feedback
四 KPI 应为 `Agent 总数`、`近 7 天活跃 Token`、`近 7 天调用量`、`近 7 天拒绝`，与 `/admin/usage` 术语一致。

### Evidence
- 现网：`Agent 数`、`活跃 Token`、`近 7 天调用`（无「量」）。

### Expected
KPI 主标签与 hint 对齐术语 §4.5 / Spec 78；固定近 7 天窗口进标题。

### Browser Check
1. Open `/admin/agents` and `/admin/usage`.
2. Compare KPI primary labels for overlapping metrics.

### Notes
`近 7 天拒绝` 为列表页运维向指标，usage 无对应卡。

## UX-ADMIN-AGENTS-025: 行内「复制 MCP 配置」冗余

Status: Fixed
Route: `/admin/agents`
Area: Agent list row actions
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 88 / `wo-202608-20`；本轮不做浏览器验证）

### Feedback
每行「复制 MCP 配置」结果相同（全局 endpoint 安全模板），与系统概览重复。

### Evidence
- `buildSafeMcpConfig(endpoint)` 不区分 agent id。
- 三行均展示相同按钮。

### Expected
列表页移除行内与页级「复制 MCP 配置」；保留系统概览与详情/Token 流程。

### Browser Check
1. Open `/admin/agents`.
2. Confirm no row or page-level `复制 MCP 配置` control.

### Notes
`buildSafeMcpConfig` 仍导出供单元测试；列表 UI 不再调用。

## UX-ADMIN-AGENTS-026: 整行卡片布局导致中间空白过大

Status: Fixed
Route: `/admin/agents`
Area: Agent list layout
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 88 / `wo-202608-20`；本轮不做浏览器验证）

### Feedback
`justify-between` 整行卡片使信息左贴、操作右贴，宽屏中间大面积空白。

### Evidence
- 浏览器 CDP：cardWidth ~1608px，left/right 分区间巨大 gap。
- 用户截图：Demo Agent 行中间空白。

### Expected
改为 `pl-data-grid` 轻量表格；列：Agent、角色、最近访问、调用量、活跃/配置 Token、拒绝、操作。

### Browser Check
1. Open `/admin/agents` at ≥1280px width.
2. Verify `agent-list-table` uses `pl-data-grid`; no `agent-card-*` rows.
3. Verify columns fill table width without a large empty middle band.

### Notes
CSS：`.pl-agent-list-table` 对齐 Spec 82 轻量密度。

## UX-ADMIN-AGENTS-027: Role 列表 PageHeader 描述暴露 access.yaml

Status: Fixed
Route: `/admin/roles`
Area: Role list PageHeader
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 89 / `wo-202608-21`；本轮不做浏览器验证）

### Feedback
描述写「管理 Agent 可访问的数据源和 MCP 工具边界。正式 Role 写入 access.yaml」，与同组访问治理页面（使用概况、Agent、访问日志）的「管理/查看 + 用户动作」模式不一致，且暴露实现细节。

### Expected
描述改为：管理每个 Role 的连接、表范围与 MCP 工具授权；不提及 `access.yaml`。

### Browser Check
1. Open `/admin/roles`.
2. Verify PageHeader description matches Spec 89 §5.1.
3. Verify description does not contain `access.yaml`.

### Notes
`RoleList.tsx` PageHeader description 已更新。验证：`role-list.test.tsx`、`lint:terminology`。

## UX-ADMIN-AGENTS-028: Role 列表 KPI 可点击且「待修复」零值仍 danger 高亮

Status: Fixed
Route: `/admin/roles`
Area: Role list KPI grid
Severity: P1
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 89 / `wo-202608-21`；本轮不做浏览器验证）

### Feedback
四 KPI 为可点击筛选按钮；「待修复」卡片在 count=0 时仍使用红色 danger 样式，与 `/admin/agents` 静态概览 KPI 不一致。

### Expected
四张静态 KPI：`Role 总数` / `使用中` / `未引用` / `解析异常`；无 danger 高亮；`needsRepairCount > 0` 时显示普通 inline notice；「待修复」保留在筛选下拉。

### Browser Check
1. Open `/admin/roles`.
2. Verify KPI cards are not buttons and have no red background when count is 0.
3. Verify filter dropdown still includes「待修复」.

### Notes
`RoleList.tsx`：`pl-metric-card` 改静态 `div`；KPI testId `metric-role-count` 等。验证：`role-list.test.tsx`。

## UX-ADMIN-AGENTS-029: 新建 Role 展示无数据的「使用情况」等 Tab

Status: Fixed
Route: `/admin/roles/new`
Area: Role detail tabs (create mode)
Severity: P2
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 89 / `wo-202608-21`；本轮不做浏览器验证）

### Feedback
新建页展示「使用情况」「权限预览」空 Tab，无 Agent 引用或生效边界可展示。

### Expected
create / copy 仅展示：基本信息 · 权限配置 · 变更预览。

### Browser Check
1. Open `/admin/roles/new`.
2. Verify tab bar has exactly three tabs per Spec 89 §5.3.
3. Verify「使用情况」「生效边界」不存在。

### Notes
`RoleDetail.tsx`：`visibleTabsForMode()`。验证：`role-detail.test.tsx`。

## UX-ADMIN-AGENTS-030: 权限编辑区落在「基本配置」而「权限预览」为只读

Status: Fixed
Route: `/admin/roles/new`, `/admin/roles/:roleId`
Area: Role detail tab IA
Severity: P1
Reported: 2026-08-05
Fixed: 2026-08-05（Spec 89 / `wo-202608-21`；本轮不做浏览器验证）

### Feedback
连接 / MCP 工具 / 表范围编辑在「基本配置」，「权限预览」Tab 仅展示保存后只读边界，Tab 命名与职责颠倒。

### Expected
基本信息：角色标识、说明；权限配置：连接 / 工具 / 表范围；生效边界：只读 `effectivePermissions`。

### Browser Check
1. Open `/admin/roles/new` →「权限配置」含连接与工具编辑。
2. Open saved role →「生效边界」展示工具与 Source 列表。

### Notes
`RoleDetail.tsx` Tab 拆分与重命名。验证：`role-detail.test.tsx`。
