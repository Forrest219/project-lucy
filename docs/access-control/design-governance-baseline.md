# Lucy 权限模型设计方案

| 元数据 | 内容 |
|---|---|
| 文档类型 | Design（权限模型方案） |
| 版本 | v1.1 |
| 撰写日期 | 2026-06-22；v1.1 更新 2026-06-22：§3.3 末尾澄清「实现细化采用 schema whitelist 而非 4 字段 blacklist」，登记白名单覆盖范围 |
| 基于材料 | `docs/lucy-platform-goal-checklist.md`、`docs/project-overview.md`、`webui/config/access.yaml`、`docs/design-agent-permissions.md v1.2`、`webui/docs/07-mcp-auth-proxy-spec.md`、`webui/server/proxy/acl.ts`、`webui/server/admin/agents.ts`、`webui/src/lib/types.ts`、`webui/src/pages/admin/AgentDetail.tsx`、`webui/src/pages/admin/AgentList.tsx`、`inbox/spec-audit-2026-06-21.md`、`inbox/spec-remediation-plan-2026-06-21.md`、`inbox/security-write-path-builder-contract-2026-06-21.md` |
| 落位 | `docs/access-control/design-governance-baseline.md`（由 `docs/access-governance-design.md` 迁入域档案；根路径留跳转桩） |
| 适用范围 | product-lucy 权限治理闭环：runtime ACL、admin 写入路径、迁移与防回退、长期演进 |
| 读者 | thinker / builder / reviewer / PM |

---

## 0. 结论摘要（TL;DR）

Lucy 的权限模型已经在 2026-06-21 的 spec-audit/remediation-plan 推动下，从「legacy `users[].allow`」过渡到 v1.2 `role-first`。**截至 2026-06-22，runtime（proxy ACL + audit）、admin API、admin UI、前端类型、测试都已对齐 v1.2**——这是已经落地的事实，不是设计目标。

本方案回答的不是「如何切到 role」，而是三个尚未收敛的问题：

1. **角色模板还不够用**——目前 `access.yaml` 只有 `kx_readonly` 一个 role，P0 闭环后需要一套预置 role 模板（dev / readonly / wiki-only / guard 等），让管理员不需要手写 YAML 就能覆盖 80% 的常见场景。
2. **runtime 端 policy 表达力不够**——role selector 只能 `schema + names|prefix`，不支持列级、行级、跨 schema 限定；当未来要支持 PII 表脱敏、租户隔离时不能继续靠 selector 顶。
3. **Drift guard 还有一处空缺**——`lint-spec.mjs` 已落地接入 release gate，但不检查 §3.1 模板库引入的新不变量（yaml 不得出现 `role-template` 指针字段）。详见 §3.3。

因此本方案在「现状基线」之上，提出 **3 个增量层**（Role 模板库 / Policy 表达式 / Drift guard），并明确每层的边界、失败语义与验收条件。

**2026-06-22 执行决策**：

- DC1：本轮接受 30 秒 TTL 撤销延迟，不实施 `POST /api/admin/_reload`。
- DC2：本轮不暴露 token `expires_at` UI。
- DC3：确认 5 个预置 Role Template：`kx_readonly`、`superstore_readonly`、`wiki_only`、`guard_test`、`dev_superstore`。

---

## 1. 现状基线（事实快照，2026-06-22）

### 1.1 事实源与组件

| 组件 | 文件 | 职责 | 状态 |
|---|---|---|---|
| 权限事实源 | `webui/config/access.yaml` | role / agent / token hash / default deny / known tools | git tracked，30s TTL 热加载 |
| Runtime 鉴权 | `webui/server/proxy/identity.ts` | Bearer → userId + sha256 哈希匹配 | 已实现 v1.2 |
| Runtime 授权 | `webui/server/proxy/acl.ts` | role / selector / tool / connection 裁决；暴露 `resolveEffectivePermissionsForAdmin` / `previewRolePermissionsForAdmin` | 已实现 v1.2 |
| Runtime 审计 | `webui/server/proxy/audit.ts` | access_log + permission_snapshots + revoked_tokens | 已实现 v1.2 |
| Admin API | `webui/server/admin/{agents,tokens,audit,mcp-tools}.ts` | role-first CRUD、dryRun、version 乐观锁、config_change_log | 已实现 v1.2 |
| Admin UI | `webui/src/pages/admin/{AgentList,AgentDetail,NewToken,Audit,ConfigAudit,AuditSources}.tsx` | role 下拉、effective permissions、dryRun → save 二段式 | 已实现 v1.2 |
| 类型 | `webui/src/lib/types.ts` | `Agent / Role / EffectivePermissionsPreview / AuditLogEntry / ConfigAuditEntry` | 已对齐 |
| fs-safe | `webui/server/fs-safe.ts` | 路径白名单（`webui/config` 已加入），`..` 穿越拒绝 | 已实现 v1.2 |
| Onboarding | `webui/src/pages/Onboarding.tsx` | 5 步上线检查，step 5 跳 admin agents，无 allow 暴露 | 已对齐 |

### 1.2 已落实的 v1.2 关键约束

- **新建 Agent 强制 role**：`POST /api/admin/agents` 拒绝 `agent.allow`（`LEGACY_ALLOW_READONLY`），拒绝缺 role（`ROLE_REQUIRED`），role 不存在 / selector 匹配 0 source / 含 `tools: ["*"]` 一律 `INVALID_ROLE`。
- **PATCH 仅允许 name/note/enabled/role**：拒绝 `allow`/`tokens`/`id`；重新启用 legacy wildcard Agent 必须先迁移 role（`LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`）；设 role 时自动 `delete allow`。
- **撤销优先于 YAML 删除**：`DELETE` Agent 先批量写 `revoked_tokens (reason='agent_deleted')`，再写 yaml。
- **DryRun 是默认**：`POST/PATCH` 默认 `dryRun:true`，必须显式 `dryRun:false` 才落盘；写 `ktx.yaml` 同理（包 B）。
- **Config 写审计**：`agent_create` / `agent_patch` / `agent_delete` / `enabled_tables_update` / `token_create` / `token_revoke` 全部进 `config_change_log`（actor=`local-admin`）；`ktx.yaml` / `access.yaml` 写盘 fail-closed。
- **Token 明文不落盘**：仅 `POST .../tokens` 响应一次返回；audit / config_change_log 的 old/new summary 禁止包含明文。
- **runtime fail-closed**：role 不存在 / selector 0 source / `tools: ["*"]` / 表 role 缺 connections → ACL 拒绝，不回退 allow。

### 1.3 与 v1.2 spec 的剩余缺口（基于实际代码与 spec 字符串对齐）

| 缺口 | 性质 | 风险 | 处置 |
|---|---|---|---|
| 角色模板只有一个 `kx_readonly` | 产品缺口 | 新建 Agent 必须从 `roles:` 自定义；管理员手写 selector 易错 | 本方案 §3 增量 1 |
| 没有列级 / 行级权限 | runtime 表达力 | KX 财务域 PII 列、未来租户隔离不能用 | 本方案 §3 增量 2（明确非目标） |
| 没有主动 reload proxy | 撤销延迟 | 30s TTL 内旧 token 仍可用；明确告知用户（已有 toast） | 已落 v1.2 文案；A4 待产品确认 |
| `?reload=true` 后端未实装 | 撤销延迟 | PATCH enabled=false / token revoke 不能立刻生效 | DC1 已决策：本轮接受 30 秒 TTL，`_reload` 延期 |
| ~~`lint:spec` 未实现~~ | — | — | 已于 2026-06-21 由 `scripts/lint-spec.mjs`（commit ec5f561/e7695ca/84f21f2，285 行）落地；`package.json` 第 15 行 `lint:spec` 与 `.github/workflows/lucy-release.yml` 第 34 行 `spec-and-webui` job 均已接入，exit code 非 0 即 fail release（见 §3.3 衔接说明）。**待 §3.1 落地后做一次回归验证**：模板展开落盘的仍是普通 yaml role，且 accessRolePolicy 仍覆盖模板写入路径。 |

---

## 2. 设计原则

### 2.1 三条不可让步

1. **事实源单一**：权限事实源是 `access.yaml`（git tracked）+ `audit.sqlite`（runtime 事实）。任何 P1/P2 增量不得引入第三份事实源（例如外部 IAM、单独策略文件）。这与 `design-agent-permissions §6.4.8` 一致。
2. **Runtime 失败 closed**：role / selector / tool / connection 任一解析失败，必须 fail-closed，禁止回退历史 `users[].allow`。这是 v1.2 的硬规则。
3. **Admin 写入必须经 dryRun → save 二段式**：admin API 与 UI 都不允许「一次调用直接落盘 + 强提示」。dryRun 返回 diff / proposedYaml，用户确认后才二次调用 dryRun:false。这与现有 `/api/sources` 的 dryRun 约定一致。

### 2.2 三条治理边界

1. **不重写 proxy 裁决逻辑**：admin/UI 只能复用 `acl.ts` 的 `resolveEffectivePermissionsForAdmin` / `previewRolePermissionsForAdmin`，不得新写第二套解析。
2. **不引入新鉴权层**：WebUI 仍绑 `127.0.0.1`，admin 路由不引入登录（与 ADR-05、`design-agent-permissions §1.2` 一致）。
3. **不读取 / 不写入 `.ktx/secrets`**：连接密码、admin token 明文始终在 secrets 目录，admin/UI 只看 metadata。

### 2.3 三条演进边界

1. **角色模板与 role 实例分离**：模板（preset）是 `access.yaml.roles.<id>` 的预置方案，由产品维护；role 实例是 yaml 中的实际定义。两者不能合一，否则升级时会覆盖客户自定义。
2. **Policy 表达式升级必须可回退**：列级 / 行级权限的解析如果新增字段，必须保证 `access.yaml` 缺新字段时行为退化到「表级全 deny」而非「表级全 allow」（fail-closed）。
3. **Drift guard 必须非阻断可演进，但仅限「既有字段新增校验」场景**：lint 加新规则时，对已存在 yaml 配置先以 warning 形式给适配窗口，再升级为 fail。**这条不适用于「新增功能自带的新字段约束」**——例如 §3.1 Role 模板库落地时新增的「yaml 中不得出现 `role-template` / `templateId` 等指针字段」（详见 §3.3），不存在需要兼容的历史数据，可以从第一天就是 fail。

---

## 3. 增量层设计

### 3.1 增量 1：Role 模板库（P1，约 3 天）

**目标**：让管理员在 `/admin/agents/new` 下拉里就能选到覆盖 80% 场景的角色，不必手写 `access.yaml`。

**预置模板（产品决定，最低集）**：

| Role id | description | tools | connections | selectors |
|---|---|---|---|---|
| `kx_readonly` | KX 财务数据只读问答 | `kx_catalog, sl_query, sl_read_source, entity_details` | `mysql-aliyun` | `dataforai.kx_*` 6 表 |
| `superstore_readonly` | Superstore 零售只读 | `kx_catalog, sl_query, sl_read_source, entity_details` | `mysql-aliyun` | `dataforai.superstore_orders` + dim |
| `wiki_only` | 仅访问 wiki / context | `wiki_search, wiki_read, dictionary_search, discover_data` | （无） | （无） |
| `guard_test` | 安全 attack 工具，无数据权限 | `entity_details` | （无） | （无） |
| `dev_superstore` | 开发者模板：superstore 全表 + wiki + discover | 同上 + `discover_data, dictionary_search` | `mysql-aliyun` | superstore 全表 |

**实现要点**：

- 模板本体是 `webui/server/admin/role-templates.ts` 中的 `ROLE_TEMPLATES: Record<string, RoleTemplate>` 常量，**不写 `access.yaml`**——避免升级时覆盖客户自定义。
- `GET /api/admin/roles` 现状返回 yaml 中已存在的 role + selector preview。增量增加 `?includeTemplates=true`（默认 true）返回「yaml 中 role + 模板」合并去重列表，`source` 字段标识 `yaml` 或 `template`。
- 新建 Agent 时，UI 下拉展示 yaml role 与模板；选模板时，后端把模板展开为完整 YamlRole 写入 `access.yaml`，**不再保留 `role-template:` 字段**——避免新事实源。

**验收**：

- 新建 `wangwu / 王五 / dev_superstore` → `git diff access.yaml` 看到 role 与完整 allow，不出现 `role-template`。
- 删除 yaml 中已存在的 role，UI 仍能选模板；删除模板源文件不影响已写入 yaml 的 role。
- 模板里若 selector 匹配 0 source，`sourceCount=0 / invalid=true`，下拉置灰。

**非目标**：模板不提供「在线编辑后保存到 yaml」（避免产品功能膨胀）；模板不参与 runtime 裁决，只在 admin UI 暴露。

### 3.2 增量 2：Policy 表达式扩展点（P2，本版本不做实现，仅留 spec 锚点）

**现状**：`role.allow.tableSelectors` 支持 `schema + names[]` 或 `schema + prefix`，不支持：
- 列级白名单 / 黑名单
- 行级谓词（`row_filter`）
- 跨 connection 限定
- 时间窗口 / 频控

**spec 锚点**（仅文档，未来实施前需重写此节）：

```yaml
roles:
  kx_financial_pii_redact:
    allow:
      connections: [mysql-aliyun]
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names: [kx_fact_financial_amount]
          # column_policy: # 增量 2 启用
          #   deny_columns: [internal_cost, margin_raw]
          #   allow_columns_with_mask: [amount, statement_type]
          #   row_filter: "amount_type IN ('revenue', 'expense')"
      tools: [kx_catalog, sl_query, sl_read_source]
```

**演进原则**：
1. 缺 `column_policy` / `row_filter` 字段时，行为退化到「表级全 deny 列」（按 fail-closed）。
2. 解析器升级必须先扩 `acl.ts` 的 `resolveEffectivePermissions` 返回结构，并在 permission_snapshots 中记录 schema version。
3. admin UI 暂不暴露该字段（避免误用）；预留 `GET /api/admin/roles/:id/policy-schema` 返回可用字段说明，方便 Power User 在 yaml 直接编辑。

**非目标**：列级 / 行级权限 P0/P1 不实施；本节仅为后续 §6 演进留 spec 锚点。

**已验证的运行时变通方案（VIEW-as-pseudo-table，不是本节方案的提前实施）**：

不改 `acl.ts`、不新增 `row_filter` 字段，也能在表级 ACL 框架内做到「单角色只看一个数据切片」：
在物理库对目标切片建 `CREATE VIEW`，把视图当普通 source 接入 `ktx.yaml` 的
`enabled_tables` + 一份语义层 overlay，再用现有 `tableSelectors` 把角色锁定到这张
视图。2026-06-22 已按此模式验证：VIEW `dataforai.superstore_orders_huadong`
（华东区域订单）+ role `superstore_region_huadong`，经 Lucy MCP Proxy 验证非
授权区域查询返回 `table_forbidden:dataforai.superstore_orders`。

局限（记录是为了不让人误以为这是参数化方案）：每个切片需要单独建 VIEW + overlay
+ role，组合数随维度数量线性放大；不支持「一个 token 按运行时 claim 动态过滤」。
需要真正参数化的行级权限时，仍应走本节 §3.2 的 `row_filter` spec，而不是继续堆
VIEW。

### 3.3 增量 3：Role 模板与 lint 衔接（增量校验，非重新实施）

**前提**：`scripts/lint-spec.mjs`（285 行，2026-06-21 由 ec5f561/e7695ca/84f21f2 落地）的 5 类检查（`routeStatus / apiSpec / skillDependency / evalSchemaVersion / accessRolePolicy`）已全部实现，并通过 `package.json` 第 15 行 `lint:spec` 与 `.github/workflows/lucy-release.yml` 第 34 行 `spec-and-webui` job 作为 release gate。`accessRolePolicy()`（`scripts/lint-spec.mjs:225-264`）当前实现 6 条 fail 规则 + 3 条 warn 规则，覆盖 role/selector/tool 配置合法性与 legacy 迁移状态；**具体规则以脚本本体为准，本文档不重复维护清单**——避免脚本演进时文档跟着漂移（这本身就是 §2.1.1「事实源单一」原则的延伸：方案文档复述代码细节，等于给代码开了第二个事实源，和要堵的 `role-template` 字段问题是同一类风险）。

**为什么本节仍然存在**：现有 `accessRolePolicy` 检查的是「role/selector/tool 配置是否合法」，**不**检查「role 是否携带了不该有的元字段」。而 §3.1 明确写了「展开后不再保留 `role-template:` 字段——避免新事实源」。这是一条新不变量，目前 `lint-spec.mjs` 里没有任何规则在守这条线。如果不补，模板功能上线后完全可能在某次重构里悄悄把 `role-template:` 字段写回 yaml（例如「记住用户选的是哪个模板」这种很自然的工程冲动），且没有任何自动检查会拦住。这正是 drift guard 该管的事。

**新增规则（`accessRolePolicy` 增量）**：

> `webui/config/access.yaml` 的 `roles.<id>` 块、user 块、以及 role 顶层，任何出现 schema 之外的非标字段（如 `role-template`、`templateId`、`templateRef`、`_template` 等）一律 `fail`。理由：模板必须保持「展开即落盘、不留指针」，否则产生第二事实源，违反 §2.1.1。

**演进边界**：这条规则不存在需要兼容的历史数据（模板功能本身就是 §3.1 新引入），所以**从第一天就是 fail**，无需 warning 过渡。这与 §2.3.3 的「既有字段新增校验需要适配窗口」不冲突——那条边界针对的是「已存在配置的新校验」，这里是「新增功能自带的新约束」。

**实现约束**：

- 复用 `scripts/lint-spec.mjs` 同一脚本、同一 `accessRolePolicy` 函数、同一 release gate job。**不新建 lint 脚本、不新建 CI workflow step、不引入 `--skip-*` 本地跳过 flag**——避免产生第二份校验路径，违反 §2.1.1 单一事实源原则。
- 字段白名单应基于现有 schema（`YamlRole` / `YamlUser` / `YamlToken` / `defaults` 的已知子键），明确列出允许集合；不在集合内的字段一律 fail，并把字段名原样写进 error message 便于定位。
- 验收用例：用模板创建 Agent → 落盘 yaml 中**不**出现 `role-template` / `templateId` → 人工或脚本往 yaml 加一行 `role-template: foo` → `npm run lint:spec` 退出码 = 1。

**实现细化（v1.1 登记）**：本规则以「schema whitelist」形式落地，而非「4 字段 blacklist」。原因：(1) §3.3 原文用「如 ... 等」措辞，约束本体是「schema 之外的非标字段」，「role-template / templateId / templateRef / _template」仅为举例；(2) blacklist 留有 `template` / `template_id` / `presetId` / `sourceTemplate` 等绕过口，挡不住真实漂移意图；(3) `access.yaml` 是权限事实源，未知字段不被 runtime 使用却可能被人误以为有效，在权限系统里 fail-closed 是合理策略；(4) 未来新增字段（如 `metadata`）需同步更新 schema / 类型 / runtime 或 admin 语义 / spec / lint 白名单五处，是治理成本而非风险。`scripts/lint-spec.mjs` 当前以 `YamlRole` / `YamlUser` / `YamlToken` / `defaults` 已知子键为白名单，当前覆盖 top-level / role / role.allow / selector / user / user.allow / token / defaults 八个块。

---

## 4. 剩余 P0/P1 工作清单（明确可执行）

| 序 | 工作项 | 文件 | 验收 | 依赖 |
|---:|---|---|---|---|
| 1 | 验证 `admin-agents.test.ts` 已覆盖：POST 拒绝 allow、POST 拒绝 wildcard、POST dryRun、POST role 不存在、DELETE 触发 revoked_tokens、POST legacy wildcard 无法启用 | `webui/server/__tests__/admin-agents.test.ts` | `npm test -- admin-agents` 全绿；新增 `npm test -- admin-roles` 覆盖 role preview | acl.ts 已实现 |
| 2 | 验证 `proxy/acl.ts` fail-closed 测试矩阵已覆盖：role 不存在 / selector 0 source / `tools:["*"]` / 表 role 缺 connections / `defaults.deny_tools` 命中 | `webui/server/__tests__/kx-acl.test.ts`、`mcp-proxy-acl.test.ts` | 已绿；若不足，按 `design-agent-permissions §7` 矩阵补 | spec-audit 已列 |
| 3 | Onboarding 5 步校验补「步骤 5 失败原因细分」（无 Agent / 无 token / Agent 全 disabled / 全是 legacy allow 未迁移） | `webui/src/pages/Onboarding.tsx` | UI 提示文案明确指出缺什么 | AdminList / AgentDetail 已实现 |
| 4 | `?reload=true` 端点实施：`POST /api/admin/_reload` → proxy 重读 access.yaml 并清缓存；PATCH `enabled:false` / token revoke 默认触发 | `webui/server/admin/reload.ts`、`webui/server/proxy/identity.ts` | DC1 已决策本轮不做；后续若要求 ≤2s revoke 再实施 | 设计 v1.2 §5.3 |
| 5 | `config_change_log` 导出端点：`GET /api/admin/config-audit/export.csv`（与 audit 导出对齐） | `webui/server/admin/config-audit.ts` | CSV 流返回，header `Content-Disposition` | ConfigAudit.tsx 已存在 |
| 6 | 验证现有 `scripts/lint-spec.mjs` 的 `accessRolePolicy` 检查在 §3.1 落地后仍覆盖——模板展开后落盘的仍是普通 yaml role，理论上无需改动 lint 逻辑；并按 §3.3 新增规则补「yaml 中出现 `role-template` / `templateId` 等非标字段时 fail」的验收用例 | `scripts/lint-spec.mjs`（新增规则 + 用例）、`webui/server/admin/agents.ts`（回归） | `npm run lint:spec` 退出码 = 1 当且仅当模板指针字段存在；用模板创建 Agent 后 `git diff access.yaml` 无指针字段 | §3.1 落地 |
| 7 | Role 模板库实施 §3.1 | `webui/server/admin/role-templates.ts`、`webui/src/lib/types.ts`、`AgentList.tsx` 新建弹窗 | 选模板创建 Agent 不写 `role-template` 字段 | §3.1 |
| 8 | 文档迁移：本 inbox 文档闭环后迁 `docs/access-governance-design.md`，并更新 `project-overview §10` | `docs/access-governance-design.md`、`docs/project-overview.md` | inbox 文件删除或留 `已迁移` 标签 | §1-§5 全部 P0/P1 闭环 |
| 9 | 长期演进 §3.2 spec 锚点：仅补 `docs/access-governance-design.md` 第二节，不实现 | `docs/access-governance-design.md` | 文档节存在，代码无对应字段 | §3.2 spec 锚点 |
| 10 | 重读 `spec-remediation-plan §8` 的第一轮交付封口：低风险文案修复包已交付；本方案 1-3 完成后，回复 Opus 8.1「admin 写入路径安全项」已闭环 | 沟通产物 / issue 关闭 | spec-audit §8.1 异议关闭 | §1-§5 |

---

## 5. 验收完成定义（Definition of Done）

本方案在以下条件全部满足时视为闭环，可迁 `docs/`：

1. `npm test -- admin-agents -- admin-tokens -- admin-audit -- admin-roles -- mcp-proxy -- kx-acl -- fs-safe` 全绿。
2. `npx tsc --noEmit` 通过。
3. `npm run smoke:p0`（含 docker smoke + demo smoke + customer smoke）通过。
4. `git diff webui/config/access.yaml` 中新增 user **只有 `role:`，无 `allow:`**。
5. 通过 `POST /api/admin/agents` 传 `agent.allow` 返回 `400 LEGACY_ALLOW_READONLY`；传 `allow.tables:["*"]` 永远不被接受。
6. legacy `lisi` 重新启用时返回 `400 LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`，UI 引导迁移。
7. `config_change_log` 包含 agent_create / agent_patch / agent_delete / token_create / token_revoke / enabled_tables_update 六类事件；token 明文绝不出现。
8. role selector 命中 0 source、role allow tools 含 `*`、role 缺 connections 时 preview 返回 400，UI 阻止保存。
9. `npm run lint:spec` 在 `.github/workflows/lucy-release.yml` 的 `spec-and-webui` job 中已经是 release gate（既有事实，非本方案新增）；exit code 非 0 时 CI fail，不允许合并。本方案的任何交付（含 §3.1 角色模板库）不得新增绕过该 gate 的路径（本地 skip flag、CI 条件跳过、单独 workflow 分支）。新增的 `role-template` 字段检查复用同一脚本，无需新建 workflow step。
10. `docs/project-overview.md` 已同步更新本节整改完成状态。

---

## 6. 长期演进锚点（不在本次实施）

### 6.1 列级 / 行级权限（增量 2）

见 §3.2。关键约束：缺新字段时行为必须 fail-closed（按 §2.3.2）。实施前需重写 §3.2 的 YAML / API / runtime 语义。

### 6.2 多管理员 / RBAC

当前假设「单本机 WebUI = 单管理员」（`design-agent-permissions §1.3 A2`）。若未来要支持多管理员（远程、SSO、团队共享 Lucy 实例），需引入：

- admin 身份层（OIDC 登录）；
- admin 操作审计 actor 字段从固定 `local-admin` 改为真实用户 id；
- role 的「可被谁修改」元数据。

这与 `lucy-platform-goal-checklist §9` 的「首版不引入多租户」一致；非 P0/P1。

### 6.3 远程 MCP 暴露 / KTX upstream 直连

当前 proxy 设计为单本机 Docker 内 KTX upstream + 对外统一 proxy 暴露（`goal-checklist §9`）。若未来要支持高级用户直连 KTX upstream（绕过 Lucy ACL），**不得**——与 goal §2「Lucy 负责权限管理」直接冲突，必须升级 goal 才能讨论。

---

## 7. 风险与未决问题

| 问题 | 当前处理 | 决策点 |
|---|---|---|
| `webui/config/` 符号链接逃逸风险（A5） | 已加入 fs-safe 白名单；测试覆盖 `..` 穿越 | 实施后跑 `npm test -- fs-safe` 验证 |
| Token 过期 `expires_at` 是否 UI 暴露（A6） | 类型已支持；NewToken 当前未显示日期选择器 | DC2 已决策：本轮不做 UI |
| `?reload=true` 主动 reload proxy 必要性（A4） | 当前 30s TTL + 文案告警 | DC1 已决策：本轮接受 TTL，主动 reload 延期 |
| 列级权限未来兼容 | §3.2 已留 spec 锚点 + fail-closed 退化规则 | 实施前重写 §3.2 |
| `role-template` 等指针字段约束 | §3.3 新增规则：模板字段从第一天就是 fail | 不需要适配窗口；§3.3 §2.3.3 已澄清 |

---

## 8. 关闭本方案的方式

本方案是 spec-audit / spec-remediation-plan / builder 契约包的**总结 + 增量**。闭环路径：

1. 团队评审本方案，重点在 §3 三个增量和 §4 的 10 项清单。
2. 评审通过后，按 §4 序号执行；每个工作项仍按 `docs/DEVELOPMENT.md` 的计划流程（Plan → Builder → Reviewer → UAT）。
3. §5 验收通过后，把本 inbox 文档迁 `docs/access-governance-design.md`；在 `docs/project-overview.md §10` 第 1 项后追加「✅ 2026-06-22 P0-1 Admin Role-First 已闭环；剩余 Role 模板库 / Policy 表达式 / lint:spec 见 `docs/access-governance-design.md`」。
4. `inbox/spec-audit-2026-06-21.md §8.1` 中 Opus 关于「admin 写入路径安全」的修正意见可在项目周报或 issue 中正式关闭。

— 完
