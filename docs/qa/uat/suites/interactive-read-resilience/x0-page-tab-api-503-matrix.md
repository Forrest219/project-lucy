# P1-75 X0 页面 × 二级 Tab × 首读 API × 503 原因矩阵（草稿）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-75 X0 页面 × 二级 Tab × 首读 API × 503 原因矩阵（草稿） |
| 文档类型 | Other（UAT 覆盖矩阵草稿；SC-09／UAT-READ-RES-09 分母来源） |
| 版本 | v0.1-draft |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Aide |
| 委托人 | xingchen |
| 基于材料 | `webui/src/app/navigation.ts`（27 个侧栏入口）；[`06-navigation-ia.md`](../../../../../webui/docs/06-navigation-ia.md)；`webui/src/app/App.tsx` 路由表；`webui/src/pages/**` 与 `webui/src/components/WikiEditView.tsx` 中 `role="tablist"`／分段控件静态检索；`webui/src/lib/displayQueryOptions.ts`；[`UAT-SUITE-PAGE-OPEN`](../page-open-exceptions/suite.md) PO-01／PO-02 及[2026-11-18 跑次](../page-open-exceptions/runs/2026-11-18-cursor-page-open-after-fix.md)；[P1-75 Spec v1.4 §2.5／附录 A](../../../../specs/lucy-20261123-interactive-read-resilience-spec.md) |
| 适用范围 | Plan X0：为 X1 判定器升级与 X6 全矩阵混压冻结覆盖清单。**草稿**：未经非作者复核者对账，不得作为 09 分母封存 |
| 输出位置 | `docs/qa/uat/suites/interactive-read-resilience/x0-page-tab-api-503-matrix.md` |

## 0. 状态与闸门

- **状态：草稿。待非作者复核者对账后方可进入 X1。** 复核者由委托人指定；对账内容见 §5。缺格或未解释的多余格判 `BLOCKED`。
- 本文件只登记覆盖清单。「首读 API」「可能 503 原因码」两列标「候选」或「待核」的内容均来自前端静态检索与 Spec 附录 A，**尚未经服务端出口实测核对**；X0 的另一半工作（对账附录 A 与 `webui/server` 全部 503 出口）尚未做。
- 不改导航：本表只读取 `navigation.ts`，不增删改任何菜单项或 tab。
- 取消 PO-02 的 6-tab 上限：已知 `tablist` 与分段控件全部逐格列出。
- 开发授权已获得（2026-11-24，见 Spec 授权边界）；本草稿 ≠ X0 完成、≠ UAT PASS、≠ 可上线。

| 复核签收 | 内容 |
|---|---|
| 复核者（非作者） | 待委托人指定 |
| 复核日期 | 待填 |
| 结论 | 待填（对账通过／存在差集） |

## 1. 摘要

| 分区 | 说明 | 行数 |
|---|---|---|
| A 侧栏 | `navigation.ts` 全部 27 个入口（含每个已知 tab／分段控件逐格） | 45 |
| B 非侧栏路由 | `App.tsx` 中非侧栏、非重定向的页面路由（含带参数详情页占位行） | 45 |
| C 重定向兼容路由 | 仅核对落点，不计 503 分母 | 8 |
| **合计** | | **98** |

- 侧栏入口 27 个；加 `/help` 为 28 个，而 2026-11-18 PO-01 报告写「共 27 个路由（含 `/help`）」，**差 1，须复核者对账**（见 D-05）。
- 其中二级 tab／分段控件逐格行 60 行；带参数详情页占位行（待真实 id，PO-03）7 行（含其 tab 行）；原因码或类别仍「待核」的行 40 行。
- 页内 Tab 清单来自 `role="tablist"`／`pl-segmented-control` 静态检索，**`06-navigation-ia.md` 只登记访问日志两个 tab**，其余需复核者以真实 DOM 逐页核对（含条件渲染的 tab）。

## 2. 图例

**全页通用（G，每一行隐含，不逐行重复）：** 鉴权读 `/api/auth/status` 的 `AUTH_STATE_UNAVAILABLE`／`AUTH_CONFIG_UNAVAILABLE`（C）；生命周期 `SERVICE_DRAINING`（B）、`warming_up`（B）。`readyz` 的 `stuck` 属 B 类自愈入口，不计页面读失败。

| 缩写 | 原因码（Spec 附录 A） | 类别 |
|---|---|---|
| DSB-R | `DISPLAY_SNAPSHOT_BUSY`／`metadata_overdue`、`digest_overdue`、`build_wait_timeout`、`build_capacity`、`generation_changed`、`context_mismatch`、`reconcile_failed`（持续越过 D_max 转 `DISPLAY_RECONCILIATION_FAILED`，拟，X1 冻结） | A（越界核验错误型转 C） |
| DSB-W | `DISPLAY_SNAPSHOT_BUSY`／`write_pending` | B（暂定上限 180 秒） |
| RT-R | `EXECUTION_RUNTIME_RELOADING`、`EXECUTION_RUNTIME_NOT_LOADED` | B（至多 60 秒） |
| PQ | `PROBE_QUEUE_FULL`、`PROBE_QUEUE_TIMEOUT` | `purpose=automatic` 为 A；`purpose=manual` 为 D |
| AUD-C | `AUDIT_UNAVAILABLE`、`META_AUDIT_STORE_UNAVAILABLE`、`META_AUDIT_WRITE_FAILED`、`config_audit_unavailable`、`skill_audit_unavailable` | C |
| SEC-C | `AUTH_STATE_UNAVAILABLE`、`SECURITY_STORE_UNAVAILABLE`、`STORE_UNAVAILABLE`、`RECONCILIATION_READ_REFUSED`、`RECONCILIATION_SECURITY_STORE_UNAVAILABLE` | C |
| CFG-C | `AUTH_CONFIG_UNAVAILABLE`、`ERR_QUERY_ARTIFACT_KEY_MISSING` | C |
| KTX-R | `KTX_CLI_ERROR`（读取路径；用户主动测试、验证、重建动作为 D） | C |
| ARG-C | `ACCESS_RECOVERY_REQUIRED` | C |
| QB-C | `question_budget_unavailable`（MCP 问数路径，非页面读） | C |
| 待核 | 前端检索未发现已登记 503 出口，须 X0 对账 `webui/server` 后确认「无」或补登记；**不等于该页不会 503** | — |

「自动探测？」：页面加载或 tab 切换自动发起、会进入探测队列的请求（Spec §2.5 OQ-4）。

## 3. 矩阵

### 3.1 A 侧栏路由（`navigation.ts`）

| 编号 | 页面 path | label | 二级 tab | 首读 API | 可能 503 原因码 | 附录 A 类别 | 自动探测？ | 备注 |
|---|---|---|---|---|---|---|---|---|
| X0-001 | `/overview` | 系统概览 | — | `/api/project`、`/api/sources`、`/api/admin/agents?view=roster&projection=summary`、`/api/admin/mcp-runtime/status`、`/api/catalog/reloads`、`/api/diff`、`/api/eval/runs/summary`（候选） | DSB-R、DSB-W、RT-R | A／B | 待核（连接探测是否在概览触发） | SC-08 四页之一；`f5e4b14d` 压力跑次概览首读 503 为 10/10 |
| X0-002 | `/ops/calls` | 调用监控 | 时间窗口：近 1 小时 | `/api/ops/call-monitor?range=1h｜24h｜7d｜30d`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | 分段控件 `role=tablist`；30 秒自动刷新属读取路径，须计入分母；默认窗口待核 |
| X0-003 | `/ops/calls` | 调用监控 | 时间窗口：近 24 小时 | `/api/ops/call-monitor?range=1h｜24h｜7d｜30d`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | 同上 |
| X0-004 | `/ops/calls` | 调用监控 | 时间窗口：近 7 天 | `/api/ops/call-monitor?range=1h｜24h｜7d｜30d`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | 同上 |
| X0-005 | `/ops/calls` | 调用监控 | 时间窗口：近 30 天 | `/api/ops/call-monitor?range=1h｜24h｜7d｜30d`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | 同上 |
| X0-006 | `/admin/usage` | 使用概况 | 使用视图：数据访问 | `/api/admin/governance/overview?hours=`、`/agents`、`/tokens`（候选） | 待核（候选：AUD-C、SEC-C） | 待核（候选 C） | 否 | `role=tablist`（页内分页 Tab）；与下方时间窗口交叉，X0 复核是否需交叉格 |
| X0-007 | `/admin/usage` | 使用概况 | 使用视图：界面使用 | `/api/admin/ui-usage/overview?hours=`（候选） | 待核（候选：AUD-C、SEC-C） | 待核（候选 C） | 否 | `role=tablist`（页内分页 Tab）；与下方时间窗口交叉，X0 复核是否需交叉格 |
| X0-008 | `/admin/usage` | 使用概况 | 时间窗口：24 小时 | 同上，参数 `hours=24｜168`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；默认 7 天（`hours=168`） |
| X0-009 | `/admin/usage` | 使用概况 | 时间窗口：7 天 | 同上，参数 `hours=24｜168`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；默认 7 天（`hours=168`） |
| X0-010 | `/admin/ops-steps` | 运维步骤 | — | `/api/admin/ops-steps`（候选） | 待核 | 待核 | 否 | — |
| X0-011 | `/connections` | 连接概览 | — | `/api/connections`、`/api/connections/:id/live-schemas?purpose=automatic`、`/api/sources`（候选） | DSB-R、DSB-W、PQ、KTX-R | A／B／C／D | 是（`purpose=automatic`） | 自动探测队列满或超时须返回最近结果或 `pending`；手动探测归 D（`purpose=manual`） |
| X0-012 | `/connections/enabled-tables` | 启用表范围 | — | `/api/connections`、`/api/connections/:id/tables`、`/api/sources`（候选） | DSB-R、DSB-W、KTX-R | A／B／C | 待核（表清单是否走探测队列） | P1-80 三态诚实；`stale`／`pending` 下危险动作不可达（交互合同 §3） |
| X0-013 | `/catalog` | 语义资产 | — | `/api/project`、`/api/sources`、`/api/catalog/reloads`、`/api/catalog/assets/uploads`（候选） | DSB-R、DSB-W、KTX-R | A／B／C | 否 | SC-08 四页之一；`/`  重定向至此 |
| X0-014 | `/wiki` | 业务 Wiki | 编辑／预览切换（条件显示）：Markdown | `/api/wiki`、`/api/wiki/directories`（候选） | DSB-R、DSB-W | A／B | 否 | `WikiEditView` `role=tablist`，仅在 `previewTab` 强制堆叠布局时出现；条件格，X0 复核触发条件 |
| X0-015 | `/wiki` | 业务 Wiki | 编辑／预览切换（条件显示）：Preview | `/api/wiki`、`/api/wiki/directories`（候选） | DSB-R、DSB-W | A／B | 否 | 同上 |
| X0-016 | `/skills` | 业务 Skill | — | `/api/skills?includeContent=false`（候选） | 待核（候选：`skill_audit_unavailable`） | 待核 | 否 | `navigation.ts` 对 `/skills/` 前缀判活，但 `App.tsx` 无 `/skills/:id` 路由：见差集 D-03 |
| X0-017 | `/publish/workbench` | 发布工作台 | — | `/api/diff`、`/api/semantic-assets/releases`、`/api/semantic-assets/scopes`（候选） | DSB-R、DSB-W、RT-R | A／B | 否 | 写入侧 `PUBLISH_COORDINATOR_BUSY` 归 D，不计读 |
| X0-018 | `/publish/history` | 发布记录 | — | `/api/semantic-assets/releases?…`（候选） | 待核 | 待核 | 否 | — |
| X0-019 | `/eval/cases` | 评测用例 | 评测域（动态分段控件，每个 domain 一格） | `/api/eval/domains`、`/api/eval/cases/:domain`（候选） | 待核 | 待核 | 否 | `role=group`，路由 `/eval/cases/:domain`；格数＝实际 domain 数，由夹具决定 |
| X0-020 | `/eval/runs` | 运行历史 | — | `/api/eval/domains`、`/api/eval/runs`（候选） | 待核 | 待核 | 否 | — |
| X0-021 | `/eval/monitor` | 趋势监控 | 时间窗口：7d | `/api/eval/domains`、`/api/eval/monitor/config`、监控数据（候选）；`days=7` | 待核 | 待核 | 否 | `role=tablist`；另有 Domain 下拉（非 tab，不入分母，X0 复核） |
| X0-022 | `/eval/monitor` | 趋势监控 | 时间窗口：30d | `/api/eval/domains`、`/api/eval/monitor/config`、监控数据（候选）；`days=30` | 待核 | 待核 | 否 | `role=tablist`；另有 Domain 下拉（非 tab，不入分母，X0 复核） |
| X0-023 | `/eval/monitor` | 趋势监控 | 时间窗口：90d | `/api/eval/domains`、`/api/eval/monitor/config`、监控数据（候选）；`days=90` | 待核 | 待核 | 否 | `role=tablist`；另有 Domain 下拉（非 tab，不入分母，X0 复核） |
| X0-024 | `/eval/field-questions` | 现场提问 | — | `/api/eval/field-questions`（候选） | 待核 | 待核 | 否 | — |
| X0-025 | `/eval/security-candidates` | 安全评测候选 | — | `/api/eval/security-candidates`（候选） | 待核 | 待核 | 否 | — |
| X0-026 | `/admin/agents` | Agent | 统计时间窗：近 7 天 | `/api/admin/agents?view=roster&projection=summary&range=`、`/api/admin/roles`、`/api/admin/agents/statistics?range=`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；名册写后首读也须覆盖 |
| X0-027 | `/admin/agents` | Agent | 统计时间窗：近 14 天 | `/api/admin/agents?view=roster&projection=summary&range=`、`/api/admin/roles`、`/api/admin/agents/statistics?range=`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；名册写后首读也须覆盖 |
| X0-028 | `/admin/agents` | Agent | 统计时间窗：近 30 天 | `/api/admin/agents?view=roster&projection=summary&range=`、`/api/admin/roles`、`/api/admin/agents/statistics?range=`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | SC-08 四页之一；默认近 30 天（`DEFAULT_AGENT_STATS_RANGE`） |
| X0-029 | `/admin/tokens` | Token 凭据 | — | `/api/admin/tokens`（候选） | 待核（候选：SEC-C） | 待核（候选 C） | 否 | — |
| X0-030 | `/admin/roles` | 角色权限 | — | `/api/admin/roles?includeTemplates=false`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | SC-08 四页之一 |
| X0-031 | `/admin/row-policies` | 行权限视图 | 表范围（分段控件）：全部表 | `/api/admin/row-policy/views/tables`（候选） | 待核 | 待核 | 否 | `role=group`，非 `tablist`；PO-02 分段控件口径含之 |
| X0-032 | `/admin/row-policies` | 行权限视图 | 表范围（分段控件）：仅受限表 | `/api/admin/row-policy/views/tables`（候选） | 待核 | 待核 | 否 | `role=group`，非 `tablist`；PO-02 分段控件口径含之 |
| X0-033 | `/admin/access-map` | 访问关系图 | 统计窗口：24h | `/api/admin/access-map?window=24h`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；标签文案以实现为准（`accessMapWindowLabel`） |
| X0-034 | `/admin/access-map` | 访问关系图 | 统计窗口：168h | `/api/admin/access-map?window=168h`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；标签文案以实现为准（`accessMapWindowLabel`） |
| X0-035 | `/admin/access-map` | 访问关系图 | 统计窗口：720h | `/api/admin/access-map?window=720h`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；标签文案以实现为准（`accessMapWindowLabel`） |
| X0-036 | `/admin/access-map` | 访问关系图 | 视图：关系图 | `/api/admin/access-map?view=map`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；`response` 存在且授权可读时才渲染 |
| X0-037 | `/admin/access-map` | 访问关系图 | 视图：数据表 | `/api/admin/access-map?view=table`（候选） | 待核（候选：AUD-C） | 待核（候选 C） | 否 | `role=tablist`；`response` 存在且授权可读时才渲染 |
| X0-038 | `/admin/audit` | 访问日志 | 访问日志视图：问询记录 | `/api/admin/audit/turns`、`/api/admin/audit/status`、`/api/admin/agents`（身份投影）（候选） | AUD-C、SEC-C、DSB-R | A／C | 否 | `role=tablist`（`Link` 路由 `?tab=turns｜calls`）；PO-02 已知 |
| X0-039 | `/admin/audit` | 访问日志 | 访问日志视图：调用流水 | `/api/admin/audit`、`/api/admin/audit/status`、`/api/admin/agents`（身份投影）（候选） | AUD-C、SEC-C、DSB-R | A／C | 否 | `role=tablist`（`Link` 路由 `?tab=turns｜calls`）；PO-02 已知 |
| X0-040 | `/admin/mcp-playground` | MCP 调试台 | 任务（`mode` 参数）：连通检查（`live-smoke`） | `/api/admin/mcp-runtime/status`、`/api/admin/mcp-playground/live-smoke`、`/api/admin/mcp-playground/acl-preview`（候选） | `unavailable`（缺稳定码）、RT-R、DSB-R | D（缺稳定码，待补）／B／A | 否 | **缺稳定原因码**：附录 A 记 `unavailable` 为 D 类，须在 X0／X1 补齐稳定码，否则按未登记判失败；标签文案待核 |
| X0-041 | `/admin/mcp-playground` | MCP 调试台 | 任务（`mode` 参数）：表访问预演（`dry-run`） | `/api/admin/mcp-runtime/status`、`/api/admin/mcp-playground/live-smoke`、`/api/admin/mcp-playground/acl-preview`（候选） | `unavailable`（缺稳定码）、RT-R、DSB-R | D（缺稳定码，待补）／B／A | 否 | 同上 |
| X0-042 | `/admin/config-audit` | 配置审计 | — | `/api/admin/config-audit`（候选） | `config_audit_unavailable`（候选） | C | 否 | — |
| X0-043 | `/admin/branding` | 品牌外观 | — | `/api/branding`（候选） | 待核 | 待核 | 否 | — |
| X0-044 | `/admin/accounts` | 登录账户 | — | `/api/admin/admins`（候选） | 待核（候选：SEC-C） | 待核（候选 C） | 否 | `06-navigation-ia.md` 路由已于 2026-11-24 由 `/admin/admins` 改为 `/admin/accounts`；`/admin/admins` 仅保留重定向 |
| X0-045 | `/admin/version` | 版本信息 | — | `/api/health`（候选） | 待核 | 待核 | 否 | — |

### 3.2 B 非侧栏路由（`App.tsx`，含详情页占位）

| 编号 | 页面 path | label | 二级 tab | 首读 API | 可能 503 原因码 | 附录 A 类别 | 自动探测？ | 备注 |
|---|---|---|---|---|---|---|---|---|
| X0-046 | `/connections/test` | 连通测试（兼容页） | — | `/api/connections`（候选） | DSB-R、KTX-R | A／C | 待核 | 已从侧栏移出，路由保留；PO-01 来源为 `navigation.ts`，此行属差集 D-01 |
| X0-047 | `/catalog/:conn/:schema/:table` | 表语义编辑 | **待真实 id**（PO-03） | `/api/sources/…`、`/api/catalog/…`（候选） | DSB-R、DSB-W、KTX-R | A／B／C | 否 | 占位行：须用夹具真实 `conn/schema/table` 回填 URL 与首读 API |
| X0-048 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 在线编辑：基础语义 | 同上（候选） | DSB-R、DSB-W | A／B | 否 | `pl-semantic-tabs` `role=tablist`；**待真实 id**（PO-03） |
| X0-049 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 在线编辑：字段 | 同上（候选） | DSB-R、DSB-W | A／B | 否 | `pl-semantic-tabs` `role=tablist`；**待真实 id**（PO-03） |
| X0-050 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 在线编辑：指标 | 同上（候选） | DSB-R、DSB-W | A／B | 否 | `pl-semantic-tabs` `role=tablist`；**待真实 id**（PO-03） |
| X0-051 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 在线编辑：分群 | 同上（候选） | DSB-R、DSB-W | A／B | 否 | `pl-semantic-tabs` `role=tablist`；**待真实 id**（PO-03） |
| X0-052 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 在线编辑：关联 | 同上（候选） | DSB-R、DSB-W | A／B | 否 | `pl-semantic-tabs` `role=tablist`；**待真实 id**（PO-03） |
| X0-053 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 变更详情视图：YAML Diff | `/api/diff`、校验接口（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；保存前预览后出现；**待真实 id**（PO-03） |
| X0-054 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 变更详情视图：YAML | `/api/diff`、校验接口（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；保存前预览后出现；**待真实 id**（PO-03） |
| X0-055 | `/catalog/:conn/:schema/:table` | 表语义编辑 | 变更详情视图：校验 | `/api/diff`、校验接口（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；保存前预览后出现；**待真实 id**（PO-03） |
| X0-056 | `/joins/:conn/:schema/:table` | 关联关系 | **待真实 id**（PO-03） | `/api/sources/…`（候选） | DSB-R、DSB-W | A／B | 否 | 占位行 |
| X0-057 | `/admin/agents/:userId` | Agent 详情 | 详情 Tab：基本信息 | `/api/admin/agents/:userId`、`/api/admin/access-write-status/:id`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；**待真实 userId**（PO-03）；权限预览走 fresh 核验，不得用降级视图 |
| X0-058 | `/admin/agents/:userId` | Agent 详情 | 详情 Tab：Token | `/api/admin/agents/:userId`、`/api/admin/access-write-status/:id`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | 同上 |
| X0-059 | `/admin/agents/:userId` | Agent 详情 | 详情 Tab：权限预览 | `/api/admin/agents/:userId`、`/api/admin/access-write-status/:id`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | 同上 |
| X0-060 | `/admin/agents/:userId` | Agent 详情 | 详情 Tab：变更预览 | `/api/admin/agents/:userId`、`/api/admin/access-write-status/:id`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | 同上 |
| X0-061 | `/admin/agents/:userId/tokens/new` | 新建 Token（Agent 内） | 客户端接入配置：Hermes | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist`；**待真实 userId**（PO-03） |
| X0-062 | `/admin/agents/:userId/tokens/new` | 新建 Token（Agent 内） | 客户端接入配置：Claude Code | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist`；**待真实 userId**（PO-03） |
| X0-063 | `/admin/agents/:userId/tokens/new` | 新建 Token（Agent 内） | 客户端接入配置：Codex | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist`；**待真实 userId**（PO-03） |
| X0-064 | `/admin/agents/:userId/tokens/new` | 新建 Token（Agent 内） | 客户端接入配置：通用客户端 | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist`；**待真实 userId**（PO-03） |
| X0-065 | `/admin/tokens/new` | 新建 Token | 客户端接入配置：Hermes | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist` |
| X0-066 | `/admin/tokens/new` | 新建 Token | 客户端接入配置：Claude Code | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist` |
| X0-067 | `/admin/tokens/new` | 新建 Token | 客户端接入配置：Codex | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist` |
| X0-068 | `/admin/tokens/new` | 新建 Token | 客户端接入配置：通用客户端 | `/api/admin/agents`、`/api/admin/mcp-endpoint`（候选） | DSB-R、`MCP_ENDPOINT_UNAVAILABLE` | A／D | 否 | `role=tablist` |
| X0-069 | `/admin/roles/new` | 新建角色 | Role 权限编辑面：基本信息 | `/api/admin/roles`、`/api/sources`（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；创建／复制模式 tab 集 |
| X0-070 | `/admin/roles/new` | 新建角色 | Role 权限编辑面：可访问的表 | `/api/admin/roles`、`/api/sources`（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；创建／复制模式 tab 集 |
| X0-071 | `/admin/roles/new` | 新建角色 | Role 权限编辑面：允许的 MCP 工具 | `/api/admin/roles`、`/api/sources`（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；创建／复制模式 tab 集 |
| X0-072 | `/admin/roles/new` | 新建角色 | Role 权限编辑面：行级策略（可选） | `/api/admin/roles`、`/api/sources`（候选） | DSB-R、DSB-W | A／B | 否 | `role=tablist`；创建／复制模式 tab 集 |
| X0-073 | `/admin/roles/:roleId` | 角色详情 | **待真实 id**（PO-03） | `/api/admin/roles/:roleId`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | 占位行；SC-08 角色权限相关 |
| X0-074 | `/admin/roles/:roleId` | 角色详情 | Role 权限编辑面：概览 | `/api/admin/roles/:roleId`、`/api/sources`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；`?tab=` 同步；**待真实 roleId**（PO-03） |
| X0-075 | `/admin/roles/:roleId` | 角色详情 | Role 权限编辑面：可访问的表 | `/api/admin/roles/:roleId`、`/api/sources`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；`?tab=` 同步；**待真实 roleId**（PO-03） |
| X0-076 | `/admin/roles/:roleId` | 角色详情 | Role 权限编辑面：允许的 MCP 工具 | `/api/admin/roles/:roleId`、`/api/sources`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；`?tab=` 同步；**待真实 roleId**（PO-03） |
| X0-077 | `/admin/roles/:roleId` | 角色详情 | Role 权限编辑面：行级策略（可选） | `/api/admin/roles/:roleId`、`/api/sources`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；`?tab=` 同步；**待真实 roleId**（PO-03） |
| X0-078 | `/admin/roles/:roleId` | 角色详情 | Role 权限编辑面：使用情况 | `/api/admin/roles/:roleId`、`/api/sources`（候选） | DSB-R、DSB-W、ARG-C | A／B／C | 否 | `role=tablist`；`?tab=` 同步；**待真实 roleId**（PO-03） |
| X0-079 | `/admin/row-policy-templates` | 行策略模板 | — | `/api/admin/row-policy-templates`（候选） | 待核 | 待核 | 否 | 页内链接进入，不在侧栏（06 §3） |
| X0-080 | `/admin/authorization-summary` | 授权摘要 | — | `/api/admin/authorization-summary`（候选） | DSB-R（候选） | 待核 | 否 | 06 称其为 Agent／Role 页只读投影；路由是否独立可达待核（差集 D-02） |
| X0-081 | `/admin/audit-reconciliation` | 访问日志对账 | 时间范围（分段控件）：近 24 小时 | `/api/admin/audit/reconciliation…`（候选） | 待核（候选：AUD-C、SEC-C） | 待核（候选 C） | 否 | `role=group`；`RECONCILIATION_*` 属 C |
| X0-082 | `/admin/audit-reconciliation` | 访问日志对账 | 时间范围（分段控件）：近 7 天 | `/api/admin/audit/reconciliation…`（候选） | 待核（候选：AUD-C、SEC-C） | 待核（候选 C） | 否 | `role=group`；`RECONCILIATION_*` 属 C |
| X0-083 | `/admin/audit-reconciliation` | 访问日志对账 | 时间范围（分段控件）：近 30 天 | `/api/admin/audit/reconciliation…`（候选） | 待核（候选：AUD-C、SEC-C） | 待核（候选 C） | 否 | `role=group`；`RECONCILIATION_*` 属 C |
| X0-084 | `/admin/audit-sources` | （兼容）访问来源 | — | `App.tsx` 挂 `AuditSources`；`06` 称重定向至 `/admin/audit` | 待核 | 待核 | 否 | 文档与路由表述不一致，差集 D-04 |
| X0-085 | `/eval/cases/:domain` | 评测用例（按域） | **待真实 domain** | `/api/eval/cases/:domain`（候选） | 待核 | 待核 | 否 | 占位行；同 `/eval/cases` 评测域分段控件 |
| X0-086 | `/eval/cases/:domain/new` | 新建评测用例 | **待真实 domain** | `/api/eval/domains`（候选） | 待核 | 待核 | 否 | 占位行 |
| X0-087 | `/eval/cases/:domain/:caseId` | 评测用例编辑 | **待真实 id**（PO-03） | `/api/eval/cases/:domain/:caseId`（候选） | 待核 | 待核 | 否 | 占位行 |
| X0-088 | `/eval/runs/:runId` | 运行详情 | **待真实 id**（PO-03） | `/api/eval/runs/:runId`（候选） | 待核 | 待核 | 否 | 占位行 |
| X0-089 | `/help` | 系统手册 | — | `/api/help/handbook` | 待核 | 待核 | 否 | 侧栏账户菜单入口；PO-01 已含 `/help` |
| X0-090 | `/login` | 登录页（未登录态） | — | `/api/auth/status` | SEC-C、CFG-C | C | 否 | 认证前页面；通用 G 项的主体；`BOOTSTRAP_NOT_PROVISIONED`／`OIDC_NOT_AVAILABLE` 归 D |

### 3.3 C 重定向兼容路由

| 编号 | 页面 path | label | 二级 tab | 首读 API | 可能 503 原因码 | 附录 A 类别 | 自动探测？ | 备注 |
|---|---|---|---|---|---|---|---|---|
| X0-091 | `/` | （重定向） | — | 由目标页覆盖：`/catalog` | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-092 | `/onboarding` | （重定向） | — | 由目标页覆盖：`/overview`（`OnboardingRedirect`） | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-093 | `/connections/whitelist` | （重定向） | — | 由目标页覆盖：`/connections/enabled-tables` | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-094 | `/sources/:conn/:schema/:table` | （重定向） | — | 由目标页覆盖：`/catalog/:conn/:schema/:table`（`SourceRouteRedirect`） | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-095 | `/review` | （重定向） | — | 由目标页覆盖：`/publish/workbench` | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-096 | `/admin/governance` | （重定向） | — | 由目标页覆盖：`/admin/usage` | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-097 | `/admin/license` | （重定向） | — | 由目标页覆盖：`/overview` | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |
| X0-098 | `/admin/admins` | （重定向） | — | 由目标页覆盖：`/admin/accounts` | — | — | 否 | 不单独计 503 分母；核对重定向落点页首读即可 |

## 4. 已知缺口与特殊行

1. **MCP 调试台**：附录 A 把 `unavailable` 记为 D 类，但**缺稳定原因码**；须由 X0／X1 补齐稳定码后，该页两个任务格才可判定，否则按未登记判失败（见 X0-040）。
2. **详情页占位行**：所有 `:id`／`:userId`／`:roleId`／`:domain`／`:conn/:schema/:table` 行均须用 09 夹具生成的真实对象回填；PO-03 在 2026-11-18 跑次未做，本矩阵不继承该缺口，但占位行未回填前判 `BLOCKED`。
3. **条件渲染的 tab**：业务 Wiki 的 Markdown／Preview 仅在强制堆叠布局出现；访问关系图「视图」tab 仅在响应存在且授权可读时渲染；Agent 详情「变更预览」带「待保存」角标。复核者须确认每种条件在夹具中可触发。
4. **交叉组合**：同一页面存在两个独立 tablist 时（使用概况「视图 × 时间窗口」、访问关系图「统计窗口 × 视图」），本表按各自一维列格，未列交叉格；X0 复核时决定是否需要交叉格（若首读 API 随两维同时变化则须补）。

## 5. 待复核项（非作者复核者对账）

| 编号 | 复核项 | 说明 |
|---|---|---|
| D-01 | `/connections/test` | `navigation.ts` 已移出，PO-01 的清单来源是 `navigation.ts`，该页是否被历史 27 项覆盖需核对；本表按 B 类列入 |
| D-02 | `/admin/authorization-summary` | `App.tsx` 有独立路由，`06-navigation-ia.md` 称其不占导航位；确认是否独立可达及首读 API |
| D-03 | `/skills/:id` | `navigation.ts` 对 `/skills/` 前缀判活，`App.tsx` 无对应路由；确认是否仅为预留前缀（无页面） |
| D-04 | `/admin/audit-sources` | `App.tsx` 挂 `AuditSources` 元素，`06` 称「重定向到 `/admin/audit`」；表述不一致，确认真实行为 |
| D-05 | PO-01 计数 | 侧栏入口 27 个＋`/help`＝28，2026-11-18 报告为「共 27」；解释差 1（去重、`/` 兼容入口或统计口径） |
| D-06 | 全部「候选」首读 API | 逐页用真实前台网络面板核对首读请求集合（含并发请求、自动刷新、`purpose=automatic`），替换候选 |
| D-07 | 全部「待核」原因码 | 对账 `webui/server` 全部 503 出口，与 Spec 附录 A 双向差集；缺登记补登记，无出口写「无」并留证 |
| D-08 | 全部 tab 清单 | 以真实 DOM 的 `[role=tab]` 与分段控件核对本表 tab 行，补漏或解释多余；页签默认值逐项核对（目前仅 Agent 统计窗口、使用概况时间窗口默认值已确认） |
| D-09 | 附录 A 暂定值 | `write_pending` 180 秒、`warming_up` 120 秒为暂定上限，X0 以实测复核（不在本草稿范围） |
| D-10 | 页面加载自动探测 | 当前仅确认 `/connections` 触发 `purpose=automatic`；其余页面（概览、启用表范围、连通测试）是否触发待核 |

## 6. 来源与更新

- 本草稿由 Aide 于 2026-11-24 基于静态检索生成，未执行任何运行代码、未跑浏览器、未改导航。
- 路由事实源：`navigation.ts`（侧栏）＋`App.tsx`（路由表）；若二者与本表不一致，以代码为准并更新本表与版本摘要。
- 矩阵版本摘要随候选封存（Spec §2.5「覆盖矩阵」）；复核通过后升 v1.0 并记录复核者。
