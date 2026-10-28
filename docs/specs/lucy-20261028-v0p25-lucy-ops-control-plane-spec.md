# Lucy v0.25 运维控制面 MCP（lucy_ops）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v1.1-dev-ready** |
| 日期 / 目标版本 | 2026-10-28 首版 / 2026-10-29 v1.1 / 目标 v0.25 |
| 功能编号 / 优先级 | **L25-16** / P1（可交付开发的范围是 W-A，见 §7） |
| 状态 | **W-A 已授权实现**（2026-10-29 PM：交给 Claude Code 落地 S1–S4）。W-B 仍不可交付开发，S5 不得开始。本授权不产生验收证据，VOPS-01–78 仍未执行。 |
| 评审状态 | 第 1–7 轮 Codex 结论保留在 §8.2（第 5–7 轮均为「不可交付开发」）。**第 8 轮未进行。** 2026-10-29 PM 直签关闭 W-A 设计门禁：失败重放与 attempt 审计两条伪代码已改到与正文一致；D7 已确认；G34 定为「同库同事务 + 文件写窗口的最小恢复协议」。未经第 8 轮独立复审这一事实保留，不把直签写成 Codex 复审通过。 |
| 决策来源 | 2026-10-28 PM 拍板 D1–D5。2026-10-29 PM 批准本修订：D7 确认；G34 = 同库同事务 + 文件写窗口最小恢复协议；可交付开发范围 = W-A；D8 仍未决，W-B 不进入本版实现 |
| 本版修订 | v1.0 及以前各轮见 §8.2。**v1.1（2026-10-29，PM 批准）**：① C5 失败且在本次 `execSet` 内的成员进入新 attempt 认领，不再落入「已认领未终结」；② attempt 级审计按**本 attempt 成员**收敛，operation 记录仍按全集聚合；③ 连接表整批全成或全拒，部分成功只存在于源表导入的组间；④ G34 定案为幂等存储与审计行同库同事务，另加文件写窗口的最小恢复协议；⑤ 控制面首期不接受 `deleteManifest` / `deleteOverlays`；⑥ 可交付开发范围收窄为 W-A。缺口仍为 G1–G38，验收仍为 VOPS-01–78（全部未执行）。 |
| 需求来源 | 2026-10-28 客户口头需求：「提个小需求，做个可以批量运维的接口」；客户为技术全面的 Agent 工程师，明确不走 WebUI |
| 实施主体 | Lucy；复用既有 Proxy / Admin / 语义资产服务层，不修改 KTX 源码 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：跨模块产品视图落 `docs/`；访问权限域交叉引用 `docs/access-control/` |

> 本文件是**设计基线**。2026-10-29 PM 已单独授权实现，范围只限 W-A（Plan S1–S4 与对应测试）。S5、S8、语义发布、只读巡检不在授权内。授权不产生验收证据，VOPS 未实际执行前不得改成通过。不授权提交、推送、镜像、部署。

---

## 1. 需求来源与判断

### 1.1 客户原话

> 提个小需求，做个可以批量运维的接口。

### 1.2 PM 判断（结论）

客户要的不是「一个新的批量功能」，而是**一个能被 Agent 直接调用的控制面接口**——把当前只能从 WebUI 点击、且一次只能操作一个对象的运维动作，收敛成「一次调用处理一批对象」的编程接口。

该判断由两条客户事实共同锁定：

1. **不走 WebUI** ⇒ 排除 UI 交互优化类需求（批量勾选、批量按钮）。
2. **Agent 工程师** ⇒ 交付物的最终消费者是 Agent，不是人。交付形态为 MCP 工具，且必须能让「配置人员用自己的 Agent 做运维」成立。

**形态方向可判定；分歧在「运维对象」。** 本 Spec 用「等价于 WebUI 管理动作」作为范围定义与验收标准：每个控制面工具对应一个 WebUI 动作 + 一条既有 REST 端点，行为（校验、权限、审计）必须一致。

### 1.3 本期边界

**包括**：以 MCP 工具形式暴露既有 WebUI 管理动作的读与写；批量语义；控制面授权模型（含委托语义）；控制面审计。

**不包括**：

- 不新增业务运维动作，不新增 WebUI 页面；
- 不改变数据面查询语义、行级策略语义与角色语义；
- 不把「批量」实现为「绕过人工确认的直写」；
- 不代替 L25-11 的能力建设，二者是「能力」与「调用通道」的关系。

### 1.4 与既有能力的关系

L25-11 语义资产批量维护（P0-3）已具备语义层的批量校验、发布与恢复能力，但定位是 WebUI 驱动的业务流程，**不是可编程入口**。本 Spec 与它的关系是：**复用其服务层与批量语义，为其补一条 Agent 可调用的通道**。二者不重复建设。

---

## 2. 现状基线（证据）

### 2.1 两条互相独立的身份平面

| 平面 | 载体 | 身份 | 权限维度 | 典型持有人 |
|---|---|---|---|---|
| 管理员平面 | `webui/config/admins.yaml` | `owner` \| `operator` | 登录会话 + `requireOwner` 分级 | 人类配置/运维人员 |
| Agent 平面 | `webui/config/access.yaml` | `users[].tokens` + `role` | `allow.tools` / `allow.connections` / `allow.tableSelectors` | MCP 客户端 |

- 管理员平面鉴权：`webui/server/auth/guard.ts:73`（`requireWebuiAuthHook`）、`:140`（`requireOwner`）。
- Agent 平面鉴权：`webui/server/proxy/identity.ts:302`（`identifyRequestDetailed`），Bearer token 哈希匹配（`:306-354`），支持吊销（`:316`）与过期（`:219`）。
- Agent 平面 role 结构：`webui/server/proxy/identity.ts:45`（`RoleAllow`）、`:53`（`RoleConfig`）、`:59`（`UserConfig`）。
- `access.yaml` 的修改本身受管理员会话保护（`/api/admin/agents` 路由在全局 `requireWebuiAuthHook` 之下，`webui/server/index.ts:748`）。

**⚠️ schema 副本有三份，不是两份（R12）**：

| 副本 | 位置 | 使用方 |
|---|---|---|
| 运行时代理侧 | `webui/server/proxy/identity.ts:45,53,59` | Proxy 鉴权与授权判定 |
| 管理侧 | `webui/server/admin/agents.ts:91,108` | Agent / 角色管理界面读写 |
| **角色路由侧** | `webui/server/admin/access-config.ts:48,92,103` | `webui/server/admin/roles.ts:18-34` 从此导入类型 |

**且角色保存路径会拒绝未知 `allow` 键**：`webui/server/admin/roles.ts:498-502` 对 `allow` 的键做白名单校验，不在 `connections`/`tableSelectors`/`tools`/`source_scope` 之列的键一律返回 `allow.<key> is not allowed`。→ **新增 `allow.ops` 必须同时扩展该白名单**，否则控制面授权无法通过正式角色保存路径落盘。

**关键缺口**：Agent 平面的 role 语义是「能查什么」，没有「能改什么」「能管哪些对象」的表达能力；且不存在「代表某个人操作」的委托概念。两点均由 D1 方案 C 补齐（§3.2）。

### 2.2 MCP 工具面现状：控制面不存在

- 工具分类只有三态：`export type ToolClass = "AbsoluteDeny" | "DataPlane" | "Meta"`（`webui/server/proxy/acl.ts:54`）。
- `classifyTool()` 对未登记工具 **fail-closed 直接判 `AbsoluteDeny`**（`webui/server/proxy/acl.ts:110-114`）。
- 代理实际注册 13 个工具 + 条件注册 `lucy_begin_question`（`webui/server/proxy/mcp-proxy.ts:1160-1175`）。其中唯一有写副作用的是 `lucy_begin_question`（仅写审计关联）。
- 已知工具全集 24 个（`webui/server/admin/mcp-tools.ts:13-38`），写类为零。
- 审计侧另有分类落点：`webui/server/proxy/audit-classification.ts`（`EventType` 含 `audit_management`）；用量侧 `webui/server/proxy/usage-classification.ts:130-138`（`classifyUsage` 对非协议、非评测探针的行归 `default_usage`）。
- 静态检查 `scripts/lint-spec.mjs:297` 要求「AbsoluteDeny + unclassified fail closed（must match webui/server/proxy/acl.ts）」，并对 `access.yaml` role 的未分类工具直接 fail（`:329`）。

**⚠️ 既有 MCP 入口有四处会挡住控制面工具（R06），必须一并改，否则工具装不上也调不到**：

| 位置 | 现状 | 对控制面工具的后果 |
|---|---|---|
| `webui/server/proxy/acl.ts:118-121` | `absoluteDenyOrUnclassifiedReason` 对非 DataPlane/Meta 返回 `tool_unclassified` | 新工具被判未分类 → 在 `allowedToolNames`（`:2259`）被过滤，**不进 `tools/list`** |
| `webui/server/proxy/acl.ts:2264-2266` | `tool.startsWith("lucy_")` 要求 `wildcardTables \|\| capabilities.length > 0` | `lucy_ops_*` 命中该分支 → **纯运维 Agent 没有数据面能力时看不到工具** |
| `webui/server/proxy/acl.ts:2259` 附近 | `!policy.knownTools.has(tool)` 即过滤 | 须在 `defaults.known_tools` 登记 |
| `webui/server/proxy/acl.ts:2902-2904` | 全局 `deny_tools` 检查 | **控制面判权必须同样执行这条门禁**，不得因独立判权而绕过 |

**结论：控制面在当前架构中没有落点，不是「加一个路由」的量级。**

### 2.3 现有批量能力盘点（全平台仅两处）

| 能力 | 端点 | 状态 |
|---|---|---|
| 语义资产批量维护 | `/api/semantic-assets/scopes\|check\|operations\|plans\|publish\|reindex`（`webui/server/semantic-batch-routes.ts`） | 基础模块与生产接线已落地；**Codex 独立审阅结论为「退回」**（1 阻塞 + 5 高 + 2 中）；V01–V22 全部未执行，Wave 0b 未解锁，客户交付 `blocked_delivery` |
| Wiki 访问批量 | `/api/wiki/access/batch/preview\|commit\|batches/:operationId`（`webui/server/index.ts:1355,1377,1400`） | 成熟；上限 100 篇（`webui/server/wiki-access-batch.ts:53`） |

两处都提供本 Spec 可直接复用的范式：**preview → commit 两段式 + digest/CAS + 异步任务查询**。

### 2.4 首期涉及域的单对象接口现状

| 域 | 现有单点端点 | 现状要点 |
|---|---|---|
| 语义发布 | `/api/semantic-assets/*` | 已有批量（见 §2.3）；`assetKind: "publish"` 在 `webui/server/semantic-assets.ts:2640`；**批量发布强制携带预览时的 `planDigest`**（`:2266-2290`，缺失即抛 `SEMANTIC_PLAN_DIGEST_MISMATCH`） |
| 启用表范围 | `PUT /api/connections/:connId/enabled-tables`（`webui/server/index.ts:1779-1827`） | **已自带 dryRun**（`dryRun !== false` 默认为 true，`:1786`）；写入 `ktx.yaml`；跨阶段屏障 `withDisplayWriteBarrier(["C","D","P","L"])`（Spec 174 §3.2：ktx.yaml 写入 → catalog 重载 → 策略提交）；审计 `changeType: "enabled_tables_update"`、`assetKind: "governance"`、`targetId: connId` |
| Schema 移除 | `/api/connections/:connId/schemas/remove` | 同写 `ktx.yaml`；审计 `changeType: "schema_remove"`、`targetId` 为 `${connId}:${schema}`（`webui/server/project.ts:967-969`） |
| 源表导入 | `POST /api/sources/:conn/:schema/:table/import`（`webui/server/index.ts:929`） | **已自带 dryRun**（`:930`）；`previewSourceYamlImport` / `writeSourceYamlImport` 随后 `validateSource` + `createTableYamlVersionSnapshot` 建版本快照 |
| 校验 | `POST /api/sources/:conn/:schema/:table/validate`；`POST /api/validate-changed` | 单表；语义批量已统一到 `runSemanticTableCheck`（L25-11 §1.4 D8），新增控制面工具须复用同一实现，不得自建合法性规则 |
| **版本回滚（R14）** | `POST /api/sources/:conn/:schema/:table/versions/:versionId/restore` | **只读草稿，不落盘**：路由只调 `restoreTableYamlVersionDraft`（`webui/server/table-yaml-history.ts:412-426`）返回 `{key, restoredFromVersionId, rawYaml, diff}`；WebUI 随后调用 import 才保存。**控制面不得直接包装该端点当写操作** |

**⚠️ 连接配置有两处来源（R15）**：`ktx.yaml` 与 `webui/config/hive-connections.yaml`（`webui/server/hive/config.ts:31-32`）。本 Spec 首期**只支持 KTX 来源连接**；Hive 来源连接在 preview 阶段返回稳定拒绝码 `ops_connection_origin_unsupported`，不得默认扩展 Hive 交付范围。

### 2.5 可直接复用的地基

| 机制 | 现状 | 位置 |
|---|---|---|
| 幂等键 | `recordConfigChange` 原生支持 `idempotencyKey` | `webui/server/admin/audit.ts:749` |
| 审计字段 | 支持 `actorType` / `source` / `operation` / `assetKind` / `writeStatus` / `errorReason` / `targetId` | 同上 |
| 资产分类 | `ConfigAuditAssetKind = governance \| semantic \| wiki \| eval \| publish \| skill`，缺省 `governance` | `webui/server/admin/audit.ts:278-279` |
| 审计写封装 | `auditedWriteFile(projectRoot, relPath, content, auditIntent, options)`，支持 `requireIntent` 两段式 | `webui/server/admin/config-audit-write.ts:272` |
| **审计唯一性约束（R10）** | 配置审计表对 `idempotency_key` 执行 `ON CONFLICT(idempotency_key) DO NOTHING` | `webui/server/admin/audit.ts:802` |
| **发布协调器真实 API（S01）** | `withPublishCoordinator(kind, fn, options)`；**可重入**（`isInsidePublishCoordinator()`）；窗口被占用时**抛 `PublishCoordinatorBusyError`，不排队** | `webui/server/publish-coordinator.ts:302-329` |
| **ktx.yaml 写锁（R07）** | `withKtxYamlWriteLock(fn)` 是 ktx.yaml 写的**唯一互斥**（进程内队列，单进程）；既有顺序为 `withKtxYamlWriteLock → withDisplayWriteBarrier → 写` | `webui/server/ktx-yaml-write-lock.ts`；`webui/server/project.ts:445-452` |
| 显示写屏障 | `withDisplayWriteBarrier(scopes, fn)`，`DISPLAY_SCOPES = ["D","P","C","L"]`；**只做计数与代际，不是互斥** | `webui/server/display-generation.ts:18,72-95` |
| **共享 Manifest 文件模型（R11）** | 源表导入按 Schema 读取**整份 schema YAML**，取 `tables` map，`doc.setIn(["tables", table], ...)` 改一张表后 `serialize(doc)` 输出**整份文件** → **同 Schema 多表共享同一文件** | `webui/server/semantic-layer.ts:862-897` |
| 角色分级 | `owner` \| `operator` | `webui/config/admins.yaml.example` |

---

## 3. 控制面设计

### 3.1 工具分类扩展

在 `webui/server/proxy/acl.ts:54` 的 `ToolClass` 增加第四态 `ControlPlane`：

- `ControlPlane` 工具**不是** `DataPlane`，不参与数据面行级策略强制过滤（它们不读业务数据）；
- `ControlPlane` 工具**不得**被 `defaults.deny_tools` 之外的任何隐式配置放开，必须与 `allow.ops` 显式绑定；
- 未登记工具仍 fail-closed（`classifyTool` 默认分支不变）。

**连带必须改的既有分支（R06）**：

1. `absoluteDenyOrUnclassifiedReason`（`acl.ts:118-121`）：`ControlPlane` 态返回 `undefined`，不得再被判 `tool_unclassified`；
2. `allowedToolNames`（`acl.ts:2259` 附近）：新增 `ControlPlane` 分支——**可见性只取决于 `allow.ops` 授予，不要求数据面能力**；且必须**先于** `lucy_` 前缀分支判定，避免 `lucy_ops_*` 被误要求数据面能力；
3. `defaults.known_tools` 登记全部控制面工具；
4. 全局 `deny_tools`（`acl.ts:2902-2904`）在控制面判权路径中**同样执行**。

### 3.2 授权模型（D1 = C 混合，已拍板）

**核心设计：身份与授权分离，委托补齐「代表谁」。**

三部分组成：

1. **身份**：Bearer token → `identifyRequestDetailed` → `users[].id`；角色经 `resolveRoleIds` 解析（`acl.ts:1463`）。
2. **授权**：`role.allow.ops` —— 控制面工具清单 + 受管对象范围（与 `allow.tools` 数据面维度完全独立，互不影响）。
3. **委托**：`users[].delegated_from` —— 可选，指向 `admins.yaml` 中的管理员 id；用于 owner-only 类操作与「配置人员用自己的 Agent 运维」的权限继承。

#### 3.2.1 `access.yaml` schema（新增维度）

```yaml
roles:
  config_ops:
    description: 运维控制面角色
    permission_model_version: 2
    allow:
      # —— 数据面维度（既有，语义不变）——
      tools:
        - lucy_catalog
        - lucy_query
      connections:
        - demo-mysql
      # —— 控制面维度（新增）——
      ops:
        - tools:
            - lucy_ops_semantic_publish
            - lucy_ops_connection_tables
          asset_kinds: [publish, governance]
          connections: [demo-mysql]     # 连接域约束；缺省 = 不允许任何连接域目标
        - tools:
            - lucy_ops_status
          asset_kinds: [governance]
          instance_scope: read_only     # 实例级只读

users:
  - id: config_agent
    enabled: true
    tokens:
      - hash: "sha256:..."
        label: ops
    role: config_ops
    delegated_from: zhangsan            # 可选：委托人（admins.yaml 的 admin id）
```

> **多角色只能经 `roles` 表达**：`role` 与 `roles` 同时非空时 `resolveRoleIds` 直接返回 `role_resolution_failed:role_and_roles`（`acl.ts:1469-1471`），该 Agent 的全部权限解析失败，表现为「工具不可见」而非配置报错。管理侧保存时必须给出明确校验错误（VOPS-47）。

#### 3.2.2 判定规则（Normative）

1. **工具域声明**：每个控制面工具声明自己的 `managed_asset_kinds` 与 `connection_scoped`（是否绑定连接）。
2. **工具准入**：工具必须出现在 `role.allow.ops[].tools` 中；`ops.tools` **不允许 `*`**（与 `allow.tools` 的 `*` 禁令一致，`scripts/lint-spec.mjs:296`）。
3. **grant 并集语义**：一个工具可出现在多条 grant 中；判定逐条匹配，**任一条满足即放行**。用户可持多个角色（`resolveRoleIds`），**多角色的 ops grant 同样取并集**，与数据面工具的多角色语义一致。仅走 `user.allow` 旧式直配的（`hasLegacyDirectAllow`）用户**不获得任何 ops 授权**。
4. **逐对象完整匹配（R03 / N02，Normative）**：判定必须**逐条 grant**、**逐个对象**进行；对任一目标对象，**必须存在一条 grant 自身同时满足**全部三项，该对象才被授权：① 工具在 `g.tools` 内；② `g.asset_kinds` 覆盖该工具的适用域集合；③ 工具为 `connection_scoped` 时，`g.connections` 存在且覆盖**该对象所在的连接**。
   - **禁止跨 grant 拼接**：不得用 A grant 的域配 B grant 的连接。
   - **禁止要求单条 grant 覆盖整批**：grant A 只授予连接 A、grant B 只授予连接 B 时，**两个对象各自被其自身完整匹配的 grant 授权**，合并调用必须放行。判定结果按对象保存，不得以「是否有单条 grant 覆盖全部目标」作为放行条件。
   - 域词汇**复用 `ConfigAuditAssetKind`**（`governance | semantic | wiki | eval | publish | skill`），不新增枚举，使授权与审计分类同源。
   - `connection_scoped` 的 `g.connections` **缺省即拒绝**（fail-closed），不回落为「全部允许」。
   - 判定结果必须能区分三种不匹配原因（工具未授予 / 域不覆盖 / 连接不覆盖），便于排障。
   - **单对象退化**：批量只有 1 个对象时，与该对象相关的完整匹配规则完全一致。
5. **实例级只读**：`instance_scope: read_only` 仅允许实例级只读工具（状态、治理总览、审计查询），不得用于任何写类工具。
6. **委托校验**：owner-only 类操作额外要求 `user.delegated_from` 能解析为 `admins.yaml` 中 `role === "owner"` 且 `enabled` 的管理员；否则拒绝。
7. **委托不放大**：委托只用于**提升到 owner-only 操作**与审计归因，不得扩大 `allow.ops` 中已声明的域与连接范围。
8. **⚠️ 委托的管理面门禁（R04，Normative）**：下列**管理面动作必须 `requireOwner`**，不得由 operator 完成——

   | 动作 | 说明 |
   |---|---|
   | 设置 / 修改 / 撤销 `delegated_from` | 委托本身是提权通道，其授予必须与 owner-only 能力同级 |
   | 为已有 owner 委托的 Agent 签发 Token | 否则 operator 可借委托链取得 owner 能力 |
   | 修改 / 授予任何含 owner-only 工具的 role | 同上 |
   | 修改 Agent 的 `role` / `roles` / `allow.ops` | 影响控制面可达范围 |

   现状缺口：`webui/server/admin/tokens.ts` **全文无 `requireOwner`**，且 `:408` 注释「plaintext never written anywhere except the HTTP response」、`:452` 返回 `token: plainToken`。上述门禁必须补齐并纳入负向验收（VOPS-34）。**首期不开放 owner-only 工具不能替代该门禁的补齐**——委托与 Token 面是独立于工具开放范围的既有入口。
9. **审计归因**：`actor` 记 Agent id（`users[].id`）；`actorType` 记控制面来源（G2）；`delegated_from` 写入审计的 `source` 或新增字段，使「谁授权、谁执行」双主体可查。

#### 3.2.3 为什么不是 A / B

- **A（复用 Agent 平面直接加 tools）**：把「能改什么」塞进语义为「能查什么」的平面，且 `access.yaml` 泄露即等于长期管理员凭证。
- **B（复用管理员平面）**：MCP 为 Bearer 协议、无会话，需新增管理员 Token 的签发/吊销/到期/owner-only 范围机制。
- **C（选定）**：共享 token ≠ 共享全部权限；委托语义让「配置人员用自己的 Agent 运维」在权限上成立。

### 3.3 工具清单与 WebUI 等价映射

**本版可交付开发（W-A）**

| 工具 | 等价 WebUI 动作 | 复用端点 | 原子性 |
|---|---|---|---|
| `lucy_ops_connection_tables` | 数据库接入 / 启用表范围 / 移除 Schema（只改 `ktx.yaml`，不删语义文件） | `PUT /api/connections/:connId/enabled-tables`、`/api/connections/:connId/schemas/remove` | 整批全成或全拒 |
| `lucy_ops_source_import` | 表语义编辑 / 版本回滚 | `POST /api/sources/:conn/:schema/:table/import`（restore 经 import 写服务，R14） | 组内全成或全败，组间部分成功 |

**保留在 Spec、本版不实现（W-B）**

| 工具 | 等价 WebUI 动作 | 复用端点 | 说明 |
|---|---|---|---|
| `lucy_ops_semantic_publish` | Catalog + 发布工作台 | `/api/semantic-assets/*` | 整批阻断。D8 与 L25-11 未关闭前不进入实现 |

**后续期（不在首期，工具清单待需求审查时确认是否保留）**

| 工具 | 等价 WebUI 动作 | 复用端点 |
|---|---|---|
| `lucy_ops_status` | 系统概览 / 版本信息 | `/api/health`、`/api/project`、`/api/admin/mcp-runtime/status` |
| `lucy_ops_access_summary` | 授权摘要 | `/api/admin/authorization-summary/agent/:userId`、`/role/:roleId` |
| `lucy_ops_access_map` | 访问关系图 | `/api/admin/access-map` |
| `lucy_ops_governance_overview` | 治理总览 | `/api/admin/governance/{overview,denials,agents,roles,tokens}` |
| `lucy_ops_audit_search` | 访问日志 / 审计 | `/api/admin/audit`、`/api/admin/audit/sources`、`/api/admin/audit/turns` |
| `lucy_ops_config_audit` | 配置审计 | `/api/admin/config-audit`、`/api/admin/config-audit/export.csv` |
| `lucy_ops_catalog_scan` | Catalog 资产巡检 | `/api/connections`、`/api/catalog/assets`、`/api/sources` |
| `lucy_ops_call_monitor` | 调用监控 | `/api/ops/call-monitor` |
| `lucy_ops_row_policy_view` | 行策略反查 | `/api/admin/row-policy/views/tables` |
| `lucy_ops_role_apply` | 角色列表 / 角色详情 | `/api/admin/roles`、`/api/admin/roles/:roleId` |
| `lucy_ops_row_policy_apply` | 行策略模板 | `/api/admin/row-policy/templates`、`/validate` |
| `lucy_ops_agent_apply` | Agent 列表 / 详情 | `/api/admin/agents`、`/api/admin/agents/:userId/tokens` |
| `lucy_ops_token_issue` | 凭证 / 新建凭证 | `/api/admin/tokens`、`/api/admin/agents/:userId/tokens` |
| `lucy_ops_admin_apply` | 登录账户（owner-only） | `/api/admin/admins` |
| `lucy_ops_wiki_access_apply` | Wiki 访问授权 | `/api/wiki/access/batch/*`（已有批量） |
| `lucy_ops_skill_publish` | 业务 Skill | `/api/skills/{preview,reload}` |

### 3.4 明确不工具化的动作（D4：已采纳）

以下动作即使有等价 WebUI 入口，也**不**提供控制面工具：

- bootstrap 首个所有者管理员；
- 管理员口令修改；
- SMTP / 通知凭据写入；
- 品牌 Logo / 品牌设置；
- OIDC 绑定 / 解绑；
- MCP 执行层重载（会打断进行中的会话）。

理由：高危、不可逆、或与「批量运维」目标无关。**D4 已采纳本清单**（2026-10-28 PM 拍板），可在需求审查时挑战。

### 3.5 命名与入参约定

- 工具名前缀统一 `lucy_ops_`；写类以 `_apply` / `_publish` / `_import` 结尾。
- 批量入参统一为 `{ targets: [...], dry_run: boolean }`；`dry_run=true` 等价于 preview。
- 写类必须携带 `idempotency_key`；缺失则拒绝执行（不自动生成，避免 Agent 无意重复）。
- commit 类调用必须携带 `plan_id` 与 `confirm_digest`；`confirm_digest` 必须等于计划的 `planDigest`。
- 输出统一信封 `{ ok, data | error }`，与既有 WebUI API 一致。

---

## 4. 写语义合同

### 4.1 preview → commit（D3，已拍板）

所有写类工具保留两段式：先 preview 产出变更清单与计划摘要，再 commit 提交。**不提供跳过人工复核的直写旁路。**

**语义发布同样两段式（R05）**：其 commit **必须**消费 preview 产出的 `validationId` / `plan` 与 `planDigest`，不得在 commit 内重新生成确认依据。既有实现即如此——批量发布在发布窗口内重建计划并与操作者确认的 `planDigest` 比对，缺失即抛 `SEMANTIC_PLAN_DIGEST_MISMATCH`（`webui/server/semantic-assets.ts:2266-2290`）。

理由：既有两处批量均为该范式；`enabled-tables` 与 `sources/:import` 端点本身也已内置 `dryRun`（`webui/server/index.ts:1786`、`:930`）。

若后续确认为高阶自动化开放旁路，须以独立的、带范围与有效期约束的确认凭证实现，并单独评审。

### 4.2 幂等与键模型（R08、R10）

**两层键，互不复用（Normative）**：

| 键 | 构造 | 稳定性 | 用途 |
|---|---|---|---|
| 业务幂等键 `operation_key` | `hash(idempotency_key, toolName)` | **跨重放稳定** | 标识一次逻辑操作 |
| 业务幂等键 `target_key` | `hash(idempotency_key, toolName, target_id)` | **跨重放稳定** | 标识一次逻辑操作中的单个目标 |
| 审计事件键 `audit_key` | `hash(<业务键>, attempt)` | **每次尝试唯一** | 配置审计行的唯一性 |

**为什么必须分层**：`config_change_log` 对 `idempotency_key` 执行 `ON CONFLICT(idempotency_key) DO NOTHING`（`webui/server/admin/audit.ts:802`）。若把业务幂等键直接写进该列，重放时的第二条审计行会被**静默丢弃**，失败痕迹之后无法追加成功记录。因此：

- **业务幂等记录**存于**独立存储**（非配置审计表），字段含 `operation_key` / `target_key` / `status` / `plan_digest` / `actor` / `tool_name` / `result`；
- **状态取值**（五态，Normative）：
  | 状态 | 含义 | 可否重放 | 审计写法 |
  |---|---|---|---|
  | `pending` | 已认领，效果未发生或未确认 | 可 | 写 `pending` 审计 |
  | `succeeded` | 效果已确认生效 | 复用原结果 | 写 `committed` 审计 |
  | `failed` | 效果未发生且已确认无残留 | 可 | 写 `failed` 审计 |
  | `recovery_required` | **有残留效果且状态不可判定**，已阻断相关读写 | **否**（须先恢复） | **保留 `pending` 审计，不得写 `failed`**（Q02） |
  | `pending_activation` | 已被发布受理但生效未确认（`activationStatus != confirmed`） | 由 release 终态收敛 | **保留 `pending` 审计，不得写 `committed`**（Q01） |
- **配置审计行**的 `idempotency_key` 列填 **`audit_key`**（含 attempt），因此每次尝试都能落一行，重放不会被去重。

**⚠️ operation 级状态机与聚合规则（Q02 / F6-01，Normative）**：五态不只用于 target 级记录，**operation 级幂等记录同样使用这五个状态**。全 Spec **只允许一个聚合函数** `aggregateOperationState(members)`，§6.2 的 C4（重入分派）、C7.2（终结）与恢复收敛段**必须共用它**，不得各自另写一套判定——第 6 轮审阅确认此前存在两套不一致的优先级。

**⚠️ 状态词汇必须统一：执行态 vs 持久态（F7-07，Normative）**：全 Spec 只有两个层次，**不得混用**：

| 层次 | 取值 | 用途 |
|---|---|---|
| **持久态**（写入幂等存储与审计） | `pending` / `succeeded` / `failed` / `recovery_required` / `pending_activation` | 聚合、终结、恢复判定的**唯一**依据 |
| **执行态**（仅存在于单次调用的内存中） | `claimed` | 表示「本 attempt 已认领、正在执行」，**不落库** |

- `claimed` **不是**持久态：target 被认领时，**持久态写 `pending`** 且 `attempt = <本次 attempt 号>`；执行态 `claimed` 只用于本次调用内决定谁进效果执行；
- 此前残留的 `skipped` / `reused` **一律废止**——不得出现在伪代码、持久化字段或验收断言中；
- **聚合函数只接受持久态**。若聚合时成员仍处于执行态 `claimed`，说明 §6.2 C6 未能把该成员收敛为终态或非终态，属实现缺陷 → 抛错 → `ops_state_corrupt`，**不得**当作 `pending` 或 `succeeded` 兜底。

**聚合输入的两类成员必须先分开**：operation 的成员集合是**原计划全集 `plan.perTarget`**，其中每个成员带一个 `attempt` 标记（`null` = 从未被任何 attempt 认领执行）。聚合时：

- **从未执行**（持久态 `pending` 且 `attempt == null`）的成员按 `pending` 参与聚合（尚未执行，不是失败）；
- **已认领未终结**（持久态 `pending` 且 `attempt != null`）的成员按 `pending` 参与聚合，但**恢复流程必须优先处理它们**；
- 其余成员按各自持久态参与聚合。

**聚合规则（唯一实现，按优先级从上到下）**：

| operation 状态 | 聚合条件 | 是否终态 | 重入行为 |
|---|---|---|---|
| `recovery_required` | **任一**成员处于 `recovery_required` | 否 | **禁止新 attempt**，必须走恢复流程（§6.2 收敛顺序 3/4） |
| `pending_activation` | 无 `recovery_required`，但**任一**成员处于 `pending_activation` | 否 | **禁止新 attempt**，必须走 release 终态收敛 |
| `failed` | 无上述两类，**且全部成员均为终态**（`succeeded` / `failed`），其中**至少一个为 `failed`** | **是** | 允许以新 attempt 重试失败成员（旧 attempt 终结保留） |
| `succeeded` | **全部**成员均为 `succeeded` | **是** | 复用原结果，直接返回 |
| `pending` | 其余情形（尚有成员未执行，或已认领未终结） | 否 | 若仍有活跃执行 → busy；否则先恢复已认领未终结者，再允许提交尚未执行的成员 |

**⚠️ 「存在未终结成员时不得转失败终态」（F6-01，Normative）**：`failed` 终态的前提是**全部成员已终结**。若一个成员 `failed` 而另一个成员仍 `pending`（未执行或已认领未终结），operation 必须是 `pending`——**不得**转 `failed`，否则剩余成员的合法提交路径会被关闭。

**⚠️ 未知状态显式拒绝（Normative）**：成员状态出现五态之外的值（含 `null` / `undefined` / 拼写错误）时，`aggregateOperationState` **必须抛错**并让调用方返回稳定原因码 `ops_state_corrupt`，**不得**静默落入「当作 failed 重试」。重入分派同样适用：未识别的 operation 状态一律按**最保守分支**处理（拒绝），不得进入新 attempt。

**⚠️ operation 记录与 attempt 审计分开终结（Normative）**：operation **记录**只有在**原计划全部成员**都取得终态时才终结。任一成员仍在 `pending` / `recovery_required` / `pending_activation`，operation 记录就不是终态。这**不**推迟本 attempt 的审计行：本 attempt 的成员若已全部终态，该 attempt 的 operation 级审计行按本 attempt 的结果收敛，即使全集里还有未执行成员。

**非终态必须持久化，不得只停留在内存（Q02，Normative）**：`pending_activation` 与 `recovery_required` **不是**「什么都不做」，必须留下可恢复的凭据：

- target 级幂等记录必须写入 `state` / `release_id` / `effect_phase` / `attempt` / `audit_id`，使进程重启后仍能判定该目标处于非终态；
- 其 `auditId` 对应的审计行保持 `pending`，**既不写 `committed` 也不写 `failed`**；
- operation 级记录必须持久化聚合状态与**未终结目标清单**（含 `release_id`），它是恢复流程的唯一依据；
- 恢复流程或 release 终态查询完成后，才把对应目标收敛到终态，并**按 `auditId` 更新既有审计行**（同键重插会被 `ON CONFLICT(idempotency_key) DO NOTHING` 静默丢弃，见 `webui/server/admin/audit.ts:802`）。

**「终态」的定义（Normative）**：**只有 `succeeded` 与 `failed` 是终态**。`pending` / `recovery_required` / `pending_activation` 均**不得**写失败审计、**不得**终结、**不得**使 operation 被当作可重试失败（Q01 / Q02）。

**⚠️ operation 与 attempt 的审计关系（F7-06，Normative）**：**一次调用 = 一个 attempt = 1 条 operation 级审计 + N 条 target 级审计**（§4.4）。同一逻辑 operation 的多个 attempt 各有各的 operation 级审计行（`audit_key` 含 attempt）。禁止把一条 operation 审计行挂到全集完成才终结。

- **attempt 审计按本 attempt 的成员收敛，不按全集聚合。** 本 attempt 成员全部 `succeeded` → 该行 `committed`；全部终态且至少一个 `failed` → 该行 `failed`；留有 `recovery_required` / `pending_activation` / 已认领未终结 → 该行保持 `pending`，由收敛路径按 `auditId` 更新。只提交 B 且 B 成功时，B 这一行是 `committed`，即使 A 此前失败、operation 记录因此是 `failed`。
- **operation 记录按全集聚合**（上表）。全集未终态时 operation 记录保持 `pending`，允许下一 attempt 补交未执行成员或重放失败成员。`recovery_required` 与 `pending_activation` 才禁止新 attempt；普通 `pending` 不禁止。
- **attempt 之间不得互相改写对方的审计行。**
- 新 attempt 只能在上一 attempt 没有未终结认领时开启（§6.2 C4.1）。因此不会出现「旧 attempt 的审计仍 pending，又开了新 attempt」。分次提交时，已结束的 attempt 审计已经按该 attempt 的成员写成终态。

**⚠️ operation 记录与 attempt 记录分离（Normative）**：operation 记录（业务幂等存储）保存**全集**状态与成员清单；attempt 记录保存**本次范围**（`execSet` / `groupIds`）、本次 attempt 号、该 attempt 的 `auditId` 与成员结论。二者**不共用一行**：operation 记录回答「整个逻辑操作走到哪一步」，attempt 记录回答「这一次尝试做了什么」。

**认领先于效果（R08 / G34，Normative）**：本 attempt 的 operation 认领、operation 审计行、本次待执行 target 的认领与 target 审计行，必须在 `audit.sqlite` 的**同一次** `db.transaction()` 里提交，然后才允许产生文件效果。事务提交前崩溃或回滚：本 attempt 不留下幂等行，也不留下审计行。事务覆盖不到业务文件写（`writeKtxYaml` 与语义目录写入是文件系统写）。文件已改而终态未写入时，走 §6.2 的最小恢复协议，不得把文件写说成事务的一部分。

**崩溃后必须有可执行的收敛路径（N07，Normative）**：幂等记录必须持久化 `before` / `after` / `effect_phase`（`none` / `written` / `activated`）/ `attempt` / `auditId`。重启或重试时按 §6.2 的收敛顺序判定：复用、补记、组回滚或阻断，**不得静默重跑**。认领竞争（两个并发请求同键）必须由存储层原子保证只有一个进入执行，另一个得到冲突或复用结果。

### 4.3 原子性与重放（D3，按工具分三种）

失败痕迹的规则三种工具相同：失败目标保留原因码与阶段；重放复用该目标的 `target_key`，不产生重复副作用；重放成功**追加**一条 target 级审计（`writeStatus: committed`，`audit_key` 含新 attempt），**不覆盖**首次失败行。

**三种原子性（Normative，2026-10-29 PM 确认）**：

| 工具 | 原子性 | 原因 |
|---|---|---|
| `lucy_ops_connection_tables` | **整批全成或全拒** | 全部 KTX 连接配置都在同一份 `ktx.yaml`。一次合并写就是一个原子组，组内不能报告部分成功 |
| `lucy_ops_source_import` | **组内全成或全败，组间部分成功可重放** | 写集相交的目标合成一个原子组；写集不相交的组互不阻断 |
| `lucy_ops_semantic_publish` | **整批阻断** | 沿用 L25-11 的 planDigest CAS。本版不交付开发，合同保留供 W-B 解锁后使用 |

**重放的正确顺序（R09，Normative）**：commit 时**先定位并核验已有幂等记录**，对已 `succeeded` 的目标直接返回原结果；**只有尚未执行的目标**才做基线比较与计划有效性检查。已成功目标改变了自身基线，若先做全量基线检查，原请求重试会被自己的变更阻断，永远到不了复用分支。连接表没有「组内部分成功后再重放其余连接」：整批失败则整批重放，整批成功则整批复用。

**⚠️ 源表导入的同写集原子组（D7，已确认）**。源表导入的写集存在跨目标的共享文件：

- Manifest 文件 `semantic-layer/<conn>/<schema>.yaml` —— 同连接同 Schema 多表共享；
- **Overlay 文件 `semantic-layer/<conn>/<table>.yaml` 路径中不含 Schema**（`webui/server/overlay.ts:74`）—— 同连接不同 Schema 的同名表也写同一文件；
- 版本快照与历史索引 `.ktx-ui/table-yaml-history/` —— **全局单一索引文件**，跨组共享。

因此：

- **写集有交集的目标构成一个原子组**：组内目标要么全部成功、要么全部失败（共享文件不可部分回滚）；
- **组间**仍为部分成功可重放；
- 组内任一目标失败时，整组目标标记为失败并给出共享文件的失败原因，**不得报告「部分成功」**；
- **失败子集重放必须保持组完整性**：重放子集须覆盖组的全部未成功成员，不得只重放组内一部分；
- 组级回滚**不得整份回滚全局历史索引**，只回滚本组条目；
- 组的身份必须由**实际写集交集**决定（§6.3），不得只用 Schema 近似。

D7 已由 PM 于 2026-10-29 确认。连接表不使用「组间部分成功」：它的写集是同一份 `ktx.yaml`，整批就是一个原子组。

### 4.4 审计粒度

- 一次调用 = **1 条 operation 级**审计（`targetId` 为空）+ **N 条 target 级**审计（每目标每次尝试一条）；
- 写类在 claim 时写 `writeStatus=pending`，效果确认后转 `committed`，失败转 `failed`；
- 只读类不写配置审计，但沿用访问日志链路；
- 归因：`actor` = Agent id，`actorType` = 控制面来源（G2 新增值），`delegated_from` 记录委托人，使「谁授权、谁执行」双主体可查；
- **审计计数范围（N07，Normative）**：「1 条 operation 级 + N 条 target 级」指**控制面自己发起的**那一条 operation 级与每目标每尝试一条 target 级。底层复用服务（如语义发布）自身发出的审计行**不计入该 N**，但必须通过 `targetId` / `operation` / `source` 可关联到本次 operation 级记录，否则「1+N」无法核对；
- **底层服务审计必须贯穿受信操作者上下文（R13）**：`webui/server/semantic-assets.ts:2637-2644` 当前把 `actorType: "ui_admin"` 与 `source: "publish_workbench_api"` **硬编码为字面量**。控制面包装必须让底层服务接受并贯穿受信操作者上下文，否则底层仍会留下 `ui_admin` 来源记录，VOPS-22 不成立。相关服务审计模块与前端类型中的封闭枚举一并同步。

### 4.5 写路径协调与锁顺序（R07、R10、R11、R15）

**锁顺序固定，不得颠倒（Normative）**：

```
1. withKtxYamlWriteLock(...)        ← ktx.yaml 写的唯一互斥（进程内队列，单进程）
2. withDisplayWriteBarrier(...)     ← 跨阶段可见性屏障（只做计数与代际，不是互斥）
3. withPublishCoordinator(...)      ← 仅语义发布类写；可重入；占用即抛 busy，不排队
```

该顺序与既有实现一致（`webui/server/project.ts:445-452`：`withKtxYamlWriteLock → withDisplayWriteBarrier → 写`）。

**规则**：

1. **锁内完成全链**：重读 → 基线比较 → 补丁生成 → 写入 → catalog 重载 → 策略提交，**全部在同一把 ktx 写锁内**。基线比较在锁外做无意义（检查后仍可被并发改写）。
2. **ktx.yaml 一次合并写**：`ktx.yaml` 承载全部 KTX 来源连接配置。批量改 N 个连接必须**一次合并写入**，不得对同一文件做 N 次 read-modify-write。合并写须在锁内逐连接复算基线，检测到外部修改即整批拒绝。
3. **显示写屏障整批一次**：`ktx.yaml` 写入类操作必须整批在**一个** `withDisplayWriteBarrier(["D","P","C","L"])` 窗口内完成。若逐目标各开一窗，中间态会被 catalog 与策略层看到。
4. **发布协调窗口**：落入既有 5 类写入口（单表保存、Manifest 上传、批量导入、手动 reindex、角色/行策略保存）的控制面写必须进入 `withPublishCoordinator` 同一窗口。**但语义发布是例外——它不得由控制面外层持有该窗口**（见规则 12）。
5. **两种锁的占用语义必须区分（N10）**：`withKtxYamlWriteLock` 是**进程内 Promise 队列**（`webui/server/ktx-yaml-write-lock.ts`），占用时**排队等待**；`withPublishCoordinator` 占用时**抛 busy、不排队**（`publish-coordinator.ts:322-326`）。控制面对前者为「等待（受总超时约束）」，对后者为「拒绝 + 稳定 busy 原因码」，不得用同一句表述。
6. **旧入口必须纳入同一临界区（N05）**：`PUT /api/connections/:connId/enabled-tables` 当前直接调用 `auditedWriteFile`（`webui/server/index.ts:1817-1818`），`writeSourceYamlImport` 只包了显示写屏障（`webui/server/semantic-layer.ts:950`）。这些入口必须进入同一 `withKtxYamlWriteLock`，否则批量服务持锁期间旧入口仍可交错，**互斥承诺不成立**。锁内复用既有 `writeKtxYaml` 必须走其已有的 `lockHeld: true` 路径（`webui/server/project.ts:445`），不得持锁再取锁（自等待）。
7. **协调器 kind 必须合法（N09）**：`PublishEntryKind` 当前只接受六种既有值（`publish-coordinator.ts:34-41`）。控制面**复用既有 kind**（源表导入 `batch_import`，语义发布 `semantic_table_save`）；若要新增 kind，须把枚举、相关测试一并列入修改清单。
8. **写集原子组（R11 / N04）**：组的身份由**实际写集交集**决定（§6.3）——Manifest 按连接+Schema，Overlay 路径不含 Schema 故同连接同名表也共享，历史索引为全局单一文件。组内失败即整组失败；组级回滚只回滚本组条目，不整份回滚全局索引。
9. **失败目标的半写禁止**：源表导入失败时不得留下半写状态——须有目标级/组级回滚，或明确标记为 pending 且在恢复完成前**阻断相关读写**。
10. **连接来源边界（R15）**：首期仅支持 KTX 来源连接；Hive 来源在 preview 阶段返回 `ops_connection_origin_unsupported`。
11. **restore 必须走 import 写服务（R14）**：`action=restore` 的语义是「读取指定版本候选 → 预检 → 确认后调用 import 写服务落盘」，**不得**直接包装只返回草稿的 restore 端点当写操作。
12. **⚠️ 语义发布的发布窗口由底层独占持有，控制面不得外层再取同一把锁（F5-01，Normative）**：`withPublishCoordinator` 的可重入判断**只存在于它自己这一层**——`isInsidePublishCoordinator()` 仅在 `publish-coordinator.ts:307-310` 被检查；而底层发布路径调用的是**低阶** `acquirePublishCoordinatorLock`（`publish-coordinator.ts:239-264`），该函数**不检查重入上下文**，直接尝试创建锁文件（`semantic-assets.ts:1505` → `acquirePublishLock(projectRoot, ...)`）。因此：
    - 控制面**不得**在语义发布外层套 `withPublishCoordinator`——底层取锁会因锁文件已存在而失败，抛 `PUBLISH_IN_PROGRESS`（`semantic-assets.ts:2249-2257`），**正常发布会被自己的外层锁拒绝**；
    - 发布窗口由**底层发布入口独占持有**，其覆盖范围是「文件提升 + 后台 reindex 执行期间」——锁在 `reindexImpl` 返回（或抛错）时由 `finally` 释放（`webui/server/semantic-assets.ts:2692-2694`），这正是低阶 API 存在的理由；
    - ⚠️ **覆盖范围止于 reindex 返回（F6-08）**：终态摘要核验（`semantic-assets.ts:2718`）、终态审计（`:2743`）、`published` 记录（`:2764`）、恢复日志完成（`:2779`）**都发生在锁释放之后**。因此**不得**宣称「发布窗口覆盖整个发布生命周期」；该缺口**登记为 W-B 对 L25-11 的依赖**，须由 L25-11 维护者证明关闭后，控制面才可依赖该排他性；
    - 控制面的语义发布**不得**自行持锁，但**必须**依赖底层在窗口内重建计划并比对 `planDigest`（`semantic-assets.ts:2266-2290`）这一 CAS 保护；
    - 若未来确需控制面包住整个发布生命周期，必须改造底层提供**显式的所有权移交入口**（把已持有的 holder 传入发布路径），不得靠外层再取同一把锁实现。
13. **⚠️ 旧 Schema 移除入口的写集超出 `ktx.yaml`，必须纳入同一临界区（F5-04，Normative）**：`POST /api/connections/:connId/schemas/remove` 接受 `deleteManifest` / `deleteOverlays`（`webui/server/index.ts:1955-1971`），而 `removeSchema` 的实际写集**包含 Manifest 与 Overlay 文件删除**——且这些删除发生在 `writeKtxYaml` **返回之后**（`webui/server/project.ts:947-962`），即在 ktx 写锁**之外**。因此：
    - 旧 REST 入口必须进入同一把 `withKtxYamlWriteLock`。它若删除 Manifest / Overlay，还要取得发布窗口并保留文件前像（§6.3）；
    - **控制面不接受这两个删除字段**，传入即 `ops_schema_content_delete_unsupported`；
    - 旧入口改造完成前，不得宣称批量导入与 Schema 移除互斥。
14. **⚠️ 版本历史裁剪必须纳入组事务（F5-05，Normative）**：源表导入的版本快照走 `createTableYamlVersionSnapshot`，该函数在写入新快照后**立即裁剪**超限旧版本——`pruneVersions` 会 `safeRemove` 掉被裁剪版本的快照文件（`webui/server/table-yaml-history.ts:279-294`），且**裁剪发生在索引写盘之前**（同文件 `:333-334`）。若组内后续成员失败而仅回滚索引条目，被裁剪的快照内容**已不可恢复**。因此组级事务必须**延迟裁剪至组终结之后**，或把被裁剪快照及其索引前像一并纳入组恢复日志；不得在组内成员尚未全部确认前执行裁剪。

### 4.6 失败与重试

- 失败必须返回可定位信息：失败目标 id、失败阶段、失败原因码；
- 批量中不得因单项失败而丢弃其余已完成项的结果；
- 整体超限或前置校验失败时，整批拒绝并说明原因；
- **占用语义分离（N10）**：ktx 写锁占用为**等待**（受总超时约束）；发布协调窗口占用为**拒绝**并返回稳定 busy 原因码（含占用方信息）。
- **⚠️ 结果分类以 `result.kind` 为准，不以 `result.ok` 为准（Q01）**：目标结果分四类——`succeeded` / `failed` / `pending_activation` / `recovery_required`（定义见 §6.2）。**只有 `failed`（明确失败且确认无残留效果）触发组回滚**；`pending_activation`（发布已受理、生效未确认）与 `recovery_required`（有残留或状态不可判定）**既不回滚也不终结**，保留 `pending` 审计等待收敛。实现不得以 `ok:false` 表达「受理中」或「待恢复」。
- **⚠️ 异常不得等同于失败（F5-03）**：组执行、取锁与审计写入抛出的异常必须逐组捕获；效果前异常按稳定失败处理，效果后异常进入核验 / 回滚 / 恢复分支；一个组的异常不得中断后续组，已完成组的结果不得丢弃。

---

## 5. 必须补齐的缺口清单

| 编号 | 缺口 | 位置 | 说明 |
|---|---|---|---|
| G1 | `ToolClass` 缺控制面态 | `webui/server/proxy/acl.ts:54` | 新增 `ControlPlane`；`classifyTool` 同步 |
| G2 | 审计无 Agent 操作者类型 | `webui/server/admin/audit.ts:279` | 现为 `ui_admin \| batch_job \| system \| anonymous`；不补则 MCP 写只能被记成 `ui_admin` 或 `batch_job`，归因失真 |
| **G3** | **access schema 三份副本 + 角色保存白名单** | `proxy/identity.ts:45,53,59`；`admin/agents.ts:91,108`；`admin/access-config.ts:48,92,103`；`admin/roles.ts:498-502` | 三份副本必须同步；`roles.ts` 的 `allow` 键白名单必须放行 `ops`，否则控制面授权无法通过正式角色保存路径落盘 |
| G4 | 第二个工具注册表 | `webui/config/access.yaml.example` `defaults.known_tools` | 与代码侧 `classifyTool` 独立，漏改则行为不一致；`scripts/lint-spec.mjs:329` 会 fail |
| G5 | 审计事件类型归类 | `webui/server/proxy/audit-classification.ts` | 明确控制面调用归 `tool_call` 还是 `audit_management`，并与四轴状态对齐 |
| **G6** | **用量分类适用性待验证**（原表述已按 R16 收窄） | `webui/server/proxy/usage-classification.ts:130-138` | `classifyUsage` 对未知工具兜底归 `default_usage`，**不会**导致调用量消失；本项改为**验证**现有计量与嵌套 `targets` 参数是否被正确归类（尤其 eval 探针判定），而非新增分类 |
| G7 | 术语未登记 | `webui/docs/00-product-terminology-standard.md` §3 / §4.6 | 新概念跨模块，须进 §3 全局固定术语表 |
| G8 | 静态检查未扩展 | `scripts/lint-spec.mjs:297-329` | 需与 acl.ts 保持一致，并新增 `allow.ops` 的 schema 校验（禁 `*`、域词汇、连接缺省 fail-closed、`role`/`roles` 互斥） |
| **G9** | **委托语义缺失** | `admin/agents.ts:91`、`admin/access-config.ts:48`、`proxy/identity.ts:59` | 需新增 `delegated_from` 字段与解析逻辑；三份副本同步 |
| **G10** | **`ktx.yaml` 批量合并写缺失** | `webui/server/index.ts:1779-1827` | 首期硬约束；单文件 N 次 read-modify-write 会丢改动 |
| **G11** | **整批显示写屏障缺失** | `webui/server/display-generation.ts:88` | 首期硬约束；逐目标各开窗口会让 catalog 看到中间态 |
| **G12** | **MCP 发现与判权路径未接控制面**（R06） | `proxy/acl.ts:118-121,2259,2264-2266,2902-2904` | 四处分支必须改，否则工具不进 `tools/list`、被 `lucy_` 前缀误要求数据面能力、全局 deny 被绕过 |
| **G13** | **委托与 Token 的 owner 门禁缺失**（R04） | `webui/server/admin/tokens.ts`（无 `requireOwner`） | 委托签发/撤销、Token 签发、role 赋权、Agent 变更必须 owner-only |
| **G14** | **业务幂等与审计键未分层**（R10） | `webui/server/admin/audit.ts:802` | `ON CONFLICT(idempotency_key) DO NOTHING` 使同键第二行被丢弃；需独立幂等存储 + 含 attempt 的审计事件键 |
| **G15** | **底层服务审计硬编码来源**（R13；**适用阶段限定为 W-B**） | `webui/server/semantic-assets.ts:2637-2644` | `actorType`/`source` 为字面量；需贯穿受信操作者上下文，并同步 `semantic-batch-audit.ts` 与 `webui/src/lib/types.ts` 的封闭枚举。**仅在 W-B（语义发布）范围内生效**：W-A 的两个工具族不走发布服务，不得因此阻塞 W-A 先行（D5）。VOPS-22 按此拆为公共归因 / W-A 归因 / W-B 归因三段证据责任 |
| **G16** | **共享写集的组级语义缺失**（R11、D7、N04） | `webui/server/semantic-layer.ts:862-897`、`webui/server/overlay.ts:74`、`webui/server/table-yaml-history.ts:14-16` | 组身份须由实际写集交集决定；Overlay 路径不含 Schema、历史索引为全局单一文件；需组级预检、组级回滚与组完整性重放 |
| **G17** | **旧写入口未纳入同一临界区**（N05） | `webui/server/index.ts:1817-1818`、`webui/server/semantic-layer.ts:950` | `enabled-tables` 与 `writeSourceYamlImport` 需进入同一 `withKtxYamlWriteLock`；锁内复用 `writeKtxYaml` 须走 `lockHeld: true` 路径避免自等待 |
| **G18** | **幂等与 pending 审计无恢复协议**（N07） | `webui/server/admin/audit.ts:802,830` | 同尝试内按 `auditId` 更新而非重插；幂等记录须持久化 `before`/`after`/`effect_phase`/`attempt`/`auditId`；定义各崩溃点的核验与收敛顺序 |
| **G19** | **协调器 kind 与锁占用语义未界定**（N09、N10） | `webui/server/publish-coordinator.ts:34-41`、`webui/server/ktx-yaml-write-lock.ts` | 控制面须复用既有合法 kind；ktx 锁（排队）与协调窗口（抛 busy）的占用语义须分别定义 |
| **G20** | **发布受理态与通用编排的结果分类冲突**（Q01） | `webui/server/semantic-assets.ts:2615-2619`、`webui/server/semantic-release-status.ts:29` | 通用编排以 `result.ok` 二值判定成败；语义发布受理态为 `ok:false + pending`，会被误判为运行失败并触发整组撤销。须引入**四类结果分类**（成功 / 明确失败 / 待生效 / 需恢复），只有「明确失败」触发回滚 |
| **G21** | **operation 级状态机与五态持久化缺失**（Q02） | Spec §4.2、§6.2 | 五态只落在 target 级；operation 级无聚合规则、无重入穷尽分派，非终态只 `continue` 而不落库，进程重启后无从判定 |
| **G22** | **语义发布实际影响集字段误用**（Q03） | `webui/server/semantic-batch-service.ts:820-828`、`webui/server/semantic-assets.ts:2988-2996` | 底层 `candidates` 只含本批候选，**完整影响集是 `effectiveTargets`**（= candidates ∪ unrelatedDiskChanges）。误用 `candidates` 会漏授权「其他待生效磁盘变更」，形成越权发布；且底层类型无 `groups` / `perTarget`，须由适配器自行构造 |
| **G23** | **语义发布锁所有权自冲突**（F5-01） | `webui/server/publish-coordinator.ts:239-264,307-310`、`webui/server/semantic-assets.ts:1505` | 低阶取锁 API 不检查重入上下文；控制面外层 `withPublishCoordinator` 会让底层取锁失败并抛 `PUBLISH_IN_PROGRESS` |
| **G24** | **执行子集未绑定 attempt**（F5-02） | Spec §6.2 C3/C4 | 认领先于子集与组完整性校验；`recoverPending` 未接收执行子集，恢复可能执行本次未请求的对象；非法子集还会遗留 pending operation |
| **G25** | **组执行缺异常边界**（F5-03） | `webui/server/publish-coordinator.ts:319-323` | `executeGroup` 与取锁、审计调用均可能抛异常；现无逐组 try/catch，后续组被中断、已完成结果无法按合同返回 |
| **G26** | **旧 Schema 移除写集超出临界区**（F5-04） | `webui/server/index.ts:1955-1971`、`webui/server/project.ts:947-962` | Manifest / Overlay 删除发生在 ktx 写锁之外，与批量导入无互斥 |
| **G27** | **版本历史裁剪未纳入组事务**（F5-05） | `webui/server/table-yaml-history.ts:279-294,333-334` | 超限裁剪在组内成员确认前 `safeRemove` 旧快照，组失败后不可恢复 |
| **G28** | **`scope → check → validationId → plan` 转换步骤缺失**（F5-06）——**已由 G30 取代**：该转换**本身不可实现**，check 产物没有 validationId | `webui/server/semantic-batch-routes.ts:318-333`、`webui/server/semantic-assets.ts:2931-2937` | 批量 check 返回的是 `{operationId, taskId, scopeId, status:"queued"}`，**不是 validationId**；读计划要求 `snapshot.batch` 存在。**第 6 轮确认该路径不可实现**，语义发布改为消费既有 staged 批次（见 G30 与 §6.4） |
| **G29** | **计划 TTL 与幂等重放优先级冲突**（F5-07） | `webui/server/semantic-assets.ts:2195-2223,2657-2658` | 底层幂等查询先于快照读取，成功受理后删除快照；「计划过期即拒」与「重放先复用既有 operation」相互矛盾 |
| **G30** | **批量校验不产出可发布计划**（F6-03） | `webui/server/semantic-batch-routes.ts:318-333`、`webui/server/semantic-batch-tasks.ts:59-79,335-379`、`webui/server/index.ts:2192-2216`、`webui/server/semantic-assets.ts:1096-1152` | check 只产出校验报告与任务记录（**无 validationId、无 batch 快照**）；batch 快照由**维护包 staging** 路径创建，且需候选内容/摘要/目标前像等完整输入。控制面**不得**把 check 产物当计划，也不得凭空构造 validationId |
| **G31** | **发布窗口不覆盖终态核验与持久化**（F6-08） | `webui/server/semantic-assets.ts:2692-2694`（锁释放）、`:2718`（摘要核验）、`:2743`（终态审计）、`:2764`（`published`）、`:2779`（日志完成） | 锁在 `reindexImpl` 返回时释放，**早于**终态证据持久化；不得宣称发布窗口覆盖整个发布生命周期。登记为 W-B 对 L25-11 的依赖 |
| **G32** | **语义内容删除与发布窗口不相交**（F6-09） | `webui/server/index.ts:1955-1971`、`webui/server/project.ts:947-962` | 删除 Manifest / Overlay 只持 ktx 写锁，而语义发布与后台索引取的是发布协调窗口，二者互不相干，可交错删除正在被发布的文件 |
| **G33** | **非终态缺少收敛入口**（F6-01） | `webui/server/index.ts:2409-2422`（release 状态查询只返回记录） | 五态中两种非终态只「拒绝新 attempt」而无收敛路径：须补恢复扫描入口、release 终态回写入口、排他所有权与审计更新 |
| **G34** | **幂等认领与审计绑定的事务边界（F6-07，已定案）** | `webui/server/admin/audit.ts:802-807`、`:835-861`；`webui/server/project.ts:440-460` | **2026-10-29 PM 定案 = (a) + 最小恢复协议。** 幂等存储与 `config_change_log` 同在 `audit.sqlite`，本 attempt 的认领与审计插入走同一次 `db.transaction()`。业务文件写是文件系统写，不在该事务内。文件已改而终态未落库时，按 §6.2 恢复顺序核验，不得宣称文件写与审计行原子提交 |
| **G35** | **执行态与持久态未分离**（F7-07） | Spec §4.2、§6.2 | `claimed`（执行态）此前被写入持久态与聚合输入；`skipped` / `reused` 为废止残留。须分离两层词汇，聚合只接受持久态，未知值 → `ops_state_corrupt` |
| **G36** | **既有成员状态在续跑时被覆盖**（F7-01） | Spec §6.2 C5 | C5 只处理 `succeeded`，其余既有记录被无条件改为「未执行」，抹掉失败痕迹并让全集聚合出错。须完整恢复既有持久态 / attempt / result / audit 绑定 |
| **G37** | **语义发布执行集与通用规则冲突**（F7-02） | `webui/server/semantic-assets.ts:2991-2996` | 完整影响集含非批次 refs 的附带磁盘变更；按参数收窄会导致组不完整。须分离 `requestedRefs` 与 `effectiveExecutionSet`，执行集固定为整个已确认原子组 |
| **G38** | **staged 批次归属阻断 Agent 消费**（F7-03） | `webui/server/semantic-assets.ts:2941-2950`、`webui/server/index.ts:2188-2216`、`webui/server/security/request-actor.ts:64-80` | 批次 actor/instance 强校验 + staging 走管理员身份 ⇒ Agent 无权消费；补齐方式属产品决策，登记为 D8 |

---

## 6. 核心流程（伪代码）

### 6.1 控制面工具调用判定

```text
function invokeControlPlaneTool(toolName, args, request):
  # 1. 分类：未登记 → fail-closed
  cls = classifyTool(toolName)                # acl.ts:110
  if cls == "AbsoluteDeny":
      return deny("tool_absolute_deny:" + toolName)
  if cls != "ControlPlane":
      return deny("tool_not_control_plane:" + toolName)   # 误路由防护

  # 2. 全局禁用（与数据面同一条门禁，不可绕过）
  if policy.denyTools.has(toolName):
      return deny("tool_forbidden_global")    # acl.ts:2902-2904

  # 3. 身份：Bearer → token hash → user
  idRes = identifyRequestDetailed(request)
  if not idRes.ok:
      return deny(idRes.reason)
  actor = idRes.identity.userId
  user  = lookupAccessUser(actor)
  if user is None or user.enabled is False:
      return deny("ops_agent_disabled")

  # 4. 角色解析：role 与 roles 不得同时声明
  roleRes = resolveRoleIds(user)              # acl.ts:1463-1477
  if not roleRes.ok:
      return deny(roleRes.reason)             # role_resolution_failed:role_and_roles
  roleIds = roleRes.roleIds
  delegatedFrom = user.delegated_from

  # 5. 授权：控制面维度独立（allow.ops 与 allow.tools 互不影响）
  grants = []
  for roleId in roleIds:
      grants += lookupRole(roleId).allow.ops or []
  if grants is empty:
      return deny("ops_not_granted:" + toolName)

  # 6. 对象范围解析：身份 → 受管对象；缺身份/歧义 → 失败，不猜默认
  targets = resolveTargets(args.targets)
  if targets is invalid:
      return deny("ops_target_unresolvable")

  # 7. 逐对象完整匹配（禁止跨 grant 拼接；禁止要求单条 grant 覆盖整批）
  toolKinds = tool.managedAssetKinds
  targets = resolveTargets(args.targets)
  if targets is invalid:
      return deny("ops_target_unresolvable")

  authorized = {}                       # 逐对象保存授权裁决
  for t in targets:
      reasons = []
      matchedForTarget = false
      for g in grants:                  # 逐条 grant 判定
          if toolName not in g.tools:
              reasons += "tool_not_listed"; continue
          if not (g.asset_kinds ⊇ toolKinds):
              reasons += "kind_not_covered"; continue
          if tool.connectionScoped:
              if g.connections is absent or empty:
                  reasons += "connection_scope_absent"; continue   # fail-closed
              if t.connectionId not in g.connections:
                  reasons += "connection_out_of_scope"; continue
          matchedForTarget = true       # 该对象由这一条 grant 完整覆盖
          break
      if not matchedForTarget:
          return deny("ops_grant_unmatched:" + t.id, detail=reasons)
      authorized[t.id] = true
  # 说明：不同对象可由不同 grant 分别授权（各自完整匹配），这是允许的；
  #       被禁止的是「用 A grant 的域配 B grant 的连接」这种拼接。

  # 8. 委托：owner-only 操作额外校验委托人（委托不放大域与连接范围）
  if tool.ownerOnly:
      principal = resolveAdmin(delegatedFrom)
      if principal is None or principal.role != "owner" or not principal.enabled:
          return deny("ops_owner_delegation_required")

  # 9. 写类前置
  if isWriteTool(toolName):
      if args.dry_run == true:
          # preview 必须走 §6.2 的持久化流程，返回可提交的 planId / confirm_digest
          return runPreview(toolName, targets, args, actor, delegatedFrom, authorized)
      if args.idempotency_key is None:
          return deny("ops_idempotency_key_required")
      if args.plan_id is None:
          return deny("ops_plan_id_required")
      if args.confirm_digest is None:
          return deny("ops_confirm_digest_required")

  return runCommit(toolName, targets, args, actor, delegatedFrom, authorized)
```

### 6.2 通用批量编排（两级认领 → 计划对象再授权 → 组级状态机 → 统一终结）

```text
# ---- preview ----
function runPreview(toolName, targets, args, actor, delegatedFrom, authorized):
    plan = computePlan(targets, args)                 # 含组划分（§6.3）
    planDigest = digest(canonicalPayload(plan))       # 规范化载荷；preview 与 commit 共用同一函数
    persist(plan, planDigest, actor, toolName, expiry=30min)
    return ok({ mode: "preview",
                plan_id: plan.planId,
                confirm_digest: planDigest,             # 调用方原样带回
                per_target: plan.perTarget,
                groups: plan.groups })

# ---- commit ----
function runCommit(toolName, targets, args, actor, delegatedFrom, authorized):
    # C0. 【先定位已有 operation，再决定是否加载计划】（F6-04）
    #     计划 TTL 只约束「尚未发生任何执行」的【新提交】；
    #     已有 operation 的重放必须用其【持久化的计划对象】再授权，
    #     不得因计划过期或底层快照已删（成功受理后 semantic-assets.ts:2657-2658 删除快照）
    #     而把一次合法重放变成「找不到计划」。
    opKey = hash(args.idempotency_key, toolName)         # 业务键，跨重放稳定
    opRec = loadIdempotency(opKey)

    # C1. 计划自身校验
    if opRec is None:
        plan = load(args.plan_id)                        # 新提交才依赖本次传入的 plan_id
        if plan is None:                                 return deny("ops_plan_not_found")
        if isExpired(plan):                              return deny("ops_plan_expired")
    else:
        plan = loadPersistedPlan(opRec)                   # 已有 operation：用其持久化的计划对象
        if plan is None:                                 return deny("ops_plan_not_found")
        # 注意：此分支【不检查计划过期】——过期只拒绝尚未执行的新提交
    if digest(canonicalPayload(plan)) != plan.planDigest:
        return deny("ops_plan_digest_mismatch")
    if plan.actor != actor:                            return deny("ops_plan_actor_mismatch")
    if plan.toolName != toolName:                      return deny("ops_plan_tool_mismatch")
    if args.confirm_digest != plan.planDigest:         return deny("ops_confirm_digest_mismatch")
    if plan.blockers not empty:                        return deny("ops_plan_blocked")

    # C2. 【计划对象再授权】——提交的是 plan.perTarget，必须按当前授权重新判定（R01 / F01）
    reauth = reauthorize(toolName, plan.perTarget, actor)   # 复用 §6.1 步骤 3–8
    if reauth.denied:
        return deny(reauth.reason)                       # 权限收窄后旧计划不可提交
    if set(reauth.authorizedIds) != set(ids(plan.perTarget)):
        return deny("ops_plan_target_set_mismatch")
    if not set(ids(args.targets)).issubset(set(ids(plan.perTarget))):
        return deny("ops_plan_param_target_mismatch")     # 本次请求范围必须属于原计划（Q04）
    # 注意：再授权针对 plan.perTarget【全集】，不是本次子集——权限收窄时旧计划整体不可提交；
    #       而「只重放失败组」等合法子集不应因与全集不相等而被拒（Q04）。

    # C3. 本次执行子集与组完整性【必须在认领之前】判定（F5-02 / F7-02）
    #     ⚠️ 三个范围必须分清，不得混用：
    #       plan.perTarget = 【原计划全集】：本次请求的合法性边界，也是 operation 的成员集合
    #       execSet        = 【本次 attempt 的执行范围】：认领、恢复、幂等记录都按它
    #       opRec.execSet  = 【上一 attempt 的执行范围】：只用于恢复，不得限制新 attempt 的范围
    #     ⚠️ 子集校验必须前移到认领之前：否则非法子集会先占用 operation（留下 pending 记录），
    #        且恢复流程会按「全部未终结目标」继续，可能执行本次未请求的对象。
    execSet = selectExecutionSet(plan, args.targets)    # 校验子集属于原计划
    if not satisfiesGroupIntegrity(plan, execSet):
        return deny("ops_group_subset_incomplete")       # 不得只重放组内一部分；此时尚未认领
    # ⚠️ 语义发布的执行集例外（F7-02）：其执行集是【整个已确认原子组】（= 完整影响集），
    #    不是「计划 ∩ 参数」。原因：批次索引是整批生效的，附带磁盘变更 U 与本批候选 R 同批写入；
    #    只执行 R 会造成「组不完整」而被拒，而把 U 塞进参数又违反「参数必须属于批次 refs」的声明。
    #    语义发布已在 §6.4 完成【完整影响集】的授权确认，故此处不再按参数收窄。

    # C4. 重入分派（只决定 attempt，不在这里写库）
    #     本 attempt 的 operation / target 认领与审计行在 C5.1 的同一次事务里提交（G34）。
    if opRec is None:
        attempt = newAttempt()
    else:
        if opRec.planDigest != plan.planDigest:          return deny("ops_idempotency_conflict")
        if opRec.actor != actor:                          return deny("ops_idempotency_actor_mismatch")
        # ⚠️ 重入分派必须以【重新聚合后的状态】为准，不得直接信任持久化的 status（F7-01）：
        #    分次提交时 operation 记录的 status 可能落后于成员记录。
        opState = aggregateOperationState(membersOf(opRec))   # §4.2 唯一实现
        if opState == "succeeded":
            return ok(opRec.result)                       # 整个操作已成功，直接返回原结果
        if opState == "recovery_required":
            return deny("ops_operation_recovery_required")  # 禁止新 attempt，必须先恢复（Q02）
        if opState == "pending_activation":
            return deny("ops_operation_pending_activation")  # 禁止新 attempt，等 release 收敛（Q02）
        if opState not in ("pending","failed"):
            return deny("ops_state_corrupt")               # 未知状态显式拒绝（F6-01）
        if opState == "pending" and isActivelyExecuting(opRec):
            return deny("ops_operation_in_flight")         # 并发同键：不得进入恢复（F04）

        # C4.1 【已有 operation 的续跑】（F6-02 / F7-10）
        #      ① 先恢复【已认领未终结】的成员（若存在）——恢复**只收敛**，
        #         **绝不执行任何新的范围**；
        #      ② 否则开新 attempt：本次 args.targets 必须落在【可继续执行的成员】上，
        #         即「尚未执行（pending 且 attempt==null）」∪「已失败（failed）」；
        #         已成功的成员不得重复执行（幂等复用）。
        #      ⚠️ 合法性边界是【可继续执行的成员集合】，不是上一 attempt 的 execSet——
        #         否则「本次只提交 A、之后补交 B」与「失败成员单独重放」两条合法路径都会被误拒。
        #      ⚠️ 恢复合同（F7-10，措辞与实现必须一致）：
        #         recoverPending 返回一个信封，调用方据此决定下一步——
        #           { operation_state, recovered: [...], still_unfinished: [...],
        #             next_submit_required: bool, next_submit_hint: [...] }
        #         恢复**不执行**剩余成员；剩余成员必须由调用方**再次提交**才会执行。
        if opState == "pending":
            if hasUnfinishedClaimedTargets(opRec):
                return recoverPending(opKey, opRec, actor,
                                      execSet=unfinishedClaimedOf(opRec))   # 唯一返回路径
        eligible = idsOf(continuableMembers(opRec))    # 未执行 ∪ 已失败
        if not set(ids(args.targets)).issubset(eligible):
            return deny("ops_operation_scope_mismatch")  # 只能继续未执行或已失败的成员
        attempt = newAttempt()

    # C5. 逐对象分流：只分类，不写库（F7-01）
    toClaim = []
    for t in plan.perTarget:
        t.idempotencyKey = hash(args.idempotency_key, plan.toolName, t.id)
        prior = loadTargetRecord(t.idempotencyKey)
        if prior is not None:
            if prior.status not in PERSISTENT_STATES:
                return deny("ops_state_corrupt")
            t.state = prior.status
            t.attempt = prior.attempt
            t.result = prior.result
            t.auditId = prior.auditId
            if prior.status == "succeeded":
                continue                                   # 幂等复用，不进入 toClaim
            if prior.status in ("recovery_required","pending_activation"):
                return deny("ops_operation_recovery_required")  # 事务尚未开始，此处拒绝不留半截认领
            if prior.status == "failed":
                # 失败痕迹留在旧 attempt。本次范围内的失败成员进入新 attempt 认领。
                if t in execSet:
                    toClaim.append(t)
                continue
            # prior.status == "pending"
            if prior.attempt is not None:
                if isActivelyExecuting(prior):
                    return deny("ops_operation_in_flight")
                continue                                   # 已认领未终结：必须先恢复，不得重跑
            if t not in execSet:
                continue                                   # 从未执行且本次不提交：保持 pending / attempt=null
            toClaim.append(t)
            continue
        if t not in execSet:
            t.state = "pending"
            t.attempt = None
            continue
        toClaim.append(t)

    # C5.1 本 attempt 一次事务提交（G34 / F7-04）
    #      写入：operation 认领（planRef + execSet + attempt）、1 条 operation 审计、
    #      toClaim 中每个 target 的持久态 pending + 各 1 条 target 审计。
    #      提交前不得进入 C6。失败或提交前崩溃：全部回滚，返回 ops_claim_failed，
    #      不留本 attempt 的幂等行与审计行，不产生文件效果。
    try:
        bound = claimAttemptTransaction(opKey, attempt, actor, plan, execSet, toClaim)
    except Exception:
        return deny("ops_claim_failed")
    opAuditId = bound.opAuditId
    for t in toClaim:
        t.auditId = bound.targetAuditId[t.id]
        t.state = "claimed"                               # 执行态，不落库
        t.attempt = attempt                               # 持久态已在事务中写成 pending + 本次 attempt

    # C6. 【组级状态机】prepare → 认领 → 执行 → 确认 → 统一终结（F02）
    for g in plan.groups:
        members = [t for t in plan.perTarget if t.groupId == g.id and t.state in ("claimed","succeeded")]
        claimed = [t for t in members if t.state == "claimed"]
        if claimed is empty:
            continue                                       # 全部已成功或未执行：不再执行（Q07）

        # C6.1 组级预检：组内任一 claimed 成员不可执行 → 整组不写
        if any(not executable(t) for t in claimed):
            for t in claimed:
                t.result = Outcome.failed("ops_group_blocked", stage="group")   # 统一构造（F6-06）
                t.state = "failed"
            continue                                       # 不执行该组任何成员

        # C6.2 组级执行 + 撤销 + 核验 + 结论（同一 try 边界，F5-03 / F6-05）
        #      ⚠️ 异常边界必须覆盖【整条组内链】：执行、取锁、审计写入、组级撤销与核验、
        #      终态结论持久化。任何一段抛异常都不得让后续组中断，也不得丢弃已完成组的结果。
        #      ⚠️ 锁必须覆盖到【撤销与核验完成】——回滚不是「锁外补偿」，
        #      否则核验期间可能已有别的写入进入临界区。
        try:
            executeGroup(g, claimed)                       # 组内一次写入 / 一次合并写（锁内）

            # C6.3 组内结果【按四类判定】，不得用 result.ok 二值判定（Q01）
            #   succeeded          : 效果已确认生效
            #   failed             : 明确失败，且已确认无残留效果
            #   pending_activation : 已被受理但生效未确认 → 不得回滚、不得终结（Q01）
            #   recovery_required  : 有残留或状态不可判定 → 不得回滚、不得终结
            #   取组内最严重结果，优先级：recovery_required > pending_activation > failed > succeeded
            outcome = classifyOutcome(claimed)
            if outcome == "failed":
                rollback = rollbackGroup(g, claimed)       # 撤销 + 核验实际状态（锁内）
                if not rollback.complete:
                    markGroupRecoveryRequired(g)          # 保持恢复阻断，阻断相关读写
                    for t in claimed:
                        t.result = Outcome.recoveryRequired(keep=existingResultOf(t), detail=rollback)
                        t.state = "recovery_required"      # 不发布任何成员的终态
                    continue
                for t in claimed:
                    # 统一失败结果，不得保留此前的 ok:true（Q06）；保留原始失败细节
                    t.result = Outcome.failed("ops_group_rolled_back", stage="group_rollback",
                                             detail={ original_failure: originalFailureOf(t),
                                                      rollback: rollback })
                    t.state = "failed"
            elif outcome == "pending_activation":
                # 发布已受理、后台索引仍在跑：绝不回滚、绝不终结，等 release 终态收敛（Q01）
                for t in claimed:
                    # 保留适配器产出的 release / activation，不得被覆盖（F6-06）
                    t.result = Outcome.pendingActivation(release=releaseOf(t),
                                                         activation=activationOf(t),
                                                         keep=existingResultOf(t))
                    t.state = "pending_activation"
            elif outcome == "recovery_required":
                markGroupRecoveryRequired(g)
                for t in claimed:
                    # keep= 保留适配器产出的 release / activation 等字段（F7-05）
                    t.result = Outcome.recoveryRequired(keep=existingResultOf(t),
                                                        detail=existingResultOf(t))
                    t.state = "recovery_required"
            else:
                for t in claimed:
                    # 效果已确认才可置成功；保留既有结果字段（如 release）（F6-06）
                    t.result = Outcome.succeeded(keep=existingResultOf(t))
                    t.state = "succeeded"
        except Exception as e:
            if effectPhaseOf(g) == "none":                # 效果尚未发生 → 稳定失败
                for t in claimed:
                    t.result = Outcome.failed("ops_group_error", stage="group", detail=e)
                    t.state = "failed"
                continue                                   # 不得中断后续组
            # 效果可能已发生 → 进入核验 / 回滚 / 恢复分支，不得直接判失败
            markGroupRecoveryRequired(g)                  # 保持恢复阻断，阻断相关读写
            for t in claimed:
                t.result = Outcome.recoveryRequired(keep=existingResultOf(t), detail=e)
                t.state = "recovery_required"
            continue

    # C7. 统一终结：效果确认之后才写终态；同 attempt 按 auditId 更新（R02 / R10 / F03）
    #     只有 succeeded / failed 是终态（§4.2）；其余状态只更新进度，不终结（Q01 / Q02）
    #     ⚠️ 只结算【本 attempt 认领的成员】（t.attempt == attempt）：
    #        复用成员（此前 attempt 已成功）与范围外成员不得被再次改写（F7-01）。
    #     ⚠️ 结算写入纳入异常协议（F7-04）：审计更新 / target 终结 / operation 终结
    #        任一失败，都必须走可恢复路径，并保留已完成组的结果。
    for t in plan.perTarget where t.state in ("succeeded","failed") and t.attempt == attempt:
        try:
            if t.auditId is not None:
                updateAuditById(t.auditId,
                                writeStatus=("committed" if t.state == "succeeded" else "failed"),
                                errorReason=(t.result.code if t.result else None))
            finalizeTarget(t.idempotencyKey, t.state, t.result)
        except Exception as e:
            # 结算失败 → 该成员不得被判为终态；转入可恢复路径（不得静默吞掉）
            t.result = Outcome.recoveryRequired(keep=existingResultOf(t), detail=e)
            t.state = "recovery_required"
            markGroupRecoveryRequired(t.groupId)           # 阻断该组相关读写

    # C7.1 非终态目标：只写进度，审计行保持 pending（Q01 / Q02 / F6-01）
    for t in plan.perTarget where t.state in ("recovery_required","pending_activation","pending"):
        persistTargetProgress(t)           # 写入 state / release_id / effect_phase / attempt / audit_id
        # 审计行保持 pending：既不写 committed，也不写 failed。
        # 从未被认领的成员（attempt == null）没有审计行，不补建——它不是「尝试过但没结论」。

    # C7.2 全集聚合写 operation 记录；本 attempt 审计按本 attempt 成员收敛（F7-06）
    opState = aggregateOperationState(plan.perTarget)      # 全集，三处共用这一个函数
    attemptMembers = [t for t in plan.perTarget if t.attempt == attempt and t in toClaim]
    attemptState = aggregateOperationState(attemptMembers)
    try:
        if attemptState in ("succeeded","failed") and opAuditId is not None:
            # 只更新本 attempt 的 operation 审计。A 失败、本次只做成功的 B 时，
            # 本行是 committed，不得因为全集里还有失败成员而改成 failed。
            updateAuditById(opAuditId,
                            writeStatus=("committed" if attemptState == "succeeded" else "failed"),
                            errorReason=(None if attemptState == "succeeded" else "ops_attempt_failed"))
        if opState in ("succeeded","failed"):
            finalizeOperation(opKey, opState, summary)
        else:
            # 全集仍有未执行或非终态成员：operation 记录不终结。
            # recovery_required / pending_activation 禁止新 attempt；
            # 普通 pending 允许之后补交。本 attempt 若已终态，其审计行已在上面闭合。
            persistOperationProgress(opKey, opState, unfinishedTargetsOf(plan.perTarget))
    except Exception as e:
        return ok({ per_target: results, succeeded: n_ok, failed: n_fail,
                    pending: n_pending, groups: groupSummary,
                    warning: "ops_finalize_incomplete", detail: e })

    return ok({ per_target: results, succeeded: n_ok, failed: n_fail,
                pending: n_pending, groups: groupSummary })
```

**⚠️ 目标结果四类契约（Q01，Normative）**：`t.result` 必须落在以下四类之一。**`result.ok` 不是判定成败的唯一依据**——判定必须读 `result.kind`：

| `result.kind` | `result.ok` | 含义 | 触发组回滚 | 可终结 | 审计 |
|---|---|---|---|---|---|
| `succeeded` | `true` | 效果已确认生效 | 否 | 是 | `committed` |
| `failed` | `false` | 明确失败，且已确认**无残留效果** | **是** | 是 | `failed` |
| `pending_activation` | `null` | 已被发布受理，**生效未确认**（后台索引在跑） | **否** | **否** | 保持 `pending` |
| `recovery_required` | `null` | 有残留效果或状态不可判定 | **否** | **否** | 保持 `pending` |

> 此前把「待生效」写成 `ok:false` 会让通用编排的 `not t.result.ok` 分支把**已受理的发布**当成运行失败并整组撤销——这是第 4 轮修订引入的回归，现已由 `kind` 分类消除。**任何实现不得以 `result.ok` 单独判定成败。**

**⚠️ 唯一 Outcome 构造函数（F6-06，Normative）**：全 Spec **只允许一个** `Outcome` 构造器（`Outcome.succeeded` / `Outcome.failed` / `Outcome.pendingActivation` / `Outcome.recoveryRequired`），**不得**在别处手写结果字面量。每个分支在设置 `t.state` 的同时**必须**经该构造器设置 `t.result`，二者**不得**只改其一——否则会出现「state 说失败、result 还是上一轮的成功」这类字段不一致。

- 构造器**必须同时写入** `kind` 与 `ok`，且 `ok` 的取值由 `kind` 唯一决定（`succeeded→true` / `failed→false` / 其余→`null`）；
- `keep=` 参数用于**保留**既有结果字段（如语义发布的 `release` / `activation` / 原始失败细节），构造器**不得丢弃**它们；
- 缺少 `kind` 的结果字面量**视为实现缺陷**——预检失败、组级撤销、恢复分支、适配器产出的结果都一律走构造器。

**组级终结规则（F02，Normative）**：

- 组内任一成员**明确失败**（`kind == "failed"`）→ 该组**全部** claimed 成员不得单独发布成功终态；必须先执行组级撤销并核验；
- 组内成员处于 `pending_activation` → **既不撤销也不终结**，等待 release 终态收敛（Q01）；
- 撤销未完成或状态不可判定 → 该组标记为 `recovery_required`，**不写任何成员终态**，并**阻断该组相关读写**直到恢复完成；
- **此前已成功的成员**（幂等复用）不因同组其他成员失败而被改写，但组级撤销**不得撤销**它们的既有成功记录——撤销范围限于本次 attempt 内写入的内容。

**⚠️ 异常边界（F5-03，Normative）**：组执行、取锁与审计写入都可能抛异常（含 `PublishCoordinatorBusyError`，`webui/server/publish-coordinator.ts:319-323`）。因此：

- 每组执行必须被独立捕获，**一个组抛异常不得中断后续组**；
- 「效果前异常」（`effect_phase == none`）→ 稳定失败结果 `ops_group_error`，走正常终结；
- 「效果后异常」（`effect_phase != none`）→ **不得**判为失败，必须进入核验 / 回滚 / 恢复分支；
- 审计写入失败**不得**继续产生正式效果（否则出现无审计的效果）；
- 已完成组的结果必须保留并随本次返回交付，不得因后续组异常而丢弃（与 §4.6 一致）。

**重放子集规则（F05，Normative）**：

- 本次执行集 = **原计划** ∩ **本次参数对象**；摘要仍绑定原计划（不因子集而改写 `planDigest`）；
- **⚠️ 语义发布的执行集例外（F7-02，Normative）**：`lucy_ops_semantic_publish` 的执行集 = **整个已确认原子组**（= 完整实际影响集 `effectiveTargets`），**不是**「原计划 ∩ 本次参数」。原因：批次索引整批生效，附带的其他待生效磁盘变更与本批候选同批写入；只执行子集会造成组不完整而被拒。语义发布已在 §6.4 完成**完整影响集**的授权确认，故执行阶段不再按参数收窄。**这是本 Spec 的第二类执行集例外**（第一类是 D7 同写集原子组），必须在工具描述中写明；
- 子集必须满足**组完整性**：若子集触及某组，则该组内全部未成功成员必须在子集内；
- **此前已成功的成员**（幂等复用）**不进入**基线比较，也**不进入**效果执行。

**审计事件键与状态更新（R10 / N07 / F03）**：

- `auditKey(businessKey, attempt) = hash(businessKey, attempt)`；`attempt` 每次执行尝试递增；
- 同一次尝试内的状态变化（`pending → committed / failed`）**按 `auditId` 更新既有行**，不新插（同键再插会被 `ON CONFLICT(idempotency_key) DO NOTHING` 静默丢弃，`webui/server/admin/audit.ts:802`；按 id 更新的接口见同文件 `:830` 一带）；
- 重放（新的 attempt）**另建审计行**，保留首次失败痕迹；
- operation 与 target 的审计行都在**正式效果前**创建并绑定 `auditId`，供终结阶段按 id 更新；
- 幂等记录必须持久化 `before` / `after` / `effect_phase`（`none` / `written` / `activated`）/ `attempt` / `auditId`。

**崩溃恢复收敛顺序（R08 / N07 / F04 / F06）**：`recoverPending` 必须先取得**排他所有权**（排除仍在执行的活跃请求），再按以下顺序判定并收敛，不盲目重跑——

0. **认领事务提交前崩溃**：本 attempt 没有幂等行，也没有审计行，恢复什么都不补。认领事务提交之后才进入下面的效果核验。禁止在「审计已插入、绑定未写入」之间补行——这个窗口由同一次 `db.transaction()` 关掉（G34）。同键重插仍会被 `ON CONFLICT(idempotency_key) DO NOTHING` 丢掉（`webui/server/admin/audit.ts:802`），所以恢复更新审计只能按已绑定的 `auditId`。
0.1 **恢复范围必须绑定 attempt（F5-02）**：恢复**只处理该 attempt 持久化的 `execSet` / `groupIds`**，**不得**按「全部未终结目标」继续——否则「本次只提交 A 组、原计划含 A/B」的请求在崩溃恢复后会执行 B 组（本次未请求的对象）。未在 `execSet` 内的目标保持原状态，不参与本次恢复；
1. 全部目标已终结为 `succeeded` → 补记 operation 终态，返回原结果；
2. 部分目标已 `succeeded`、其余无副作用痕迹 → 只对未终结目标继续；
3. 已写入但未确认生效（`effect_phase = written`）→ **核验实际生效状态**（catalog / 策略 / 文件摘要）：
   - 已生效 → 补记 `committed`；
   - 未生效 → 按组回滚并记 `failed`；
   - **有残留效果且无法确认**（F06）→ **不得直接终结为可重试的 `failed`**；保持恢复状态并阻断相关读写，返回稳定原因码；
4. 状态不可判定 → **阻断**该目标的再次提交，返回稳定原因码并要求人工/运维介入，不得静默重跑。

**恢复后的 operation 状态必须重新聚合（Q02 / F6-01，Normative）**：恢复收敛完成后，**必须调用 §4.2 的同一个 `aggregateOperationState`** 重新计算 operation 状态，不得另写一套判定：

- 存在 `recovery_required` 成员 → `recovery_required`；
- 否则存在 `pending_activation` 成员 → `pending_activation`；
- 否则**全部成员均为终态**且至少一个为 `failed` → `failed`；
- 否则全部成员均为 `succeeded` → `succeeded`；
- 其余（仍有成员 `pending`）→ `pending`，**不得**转 `failed`。

**只有 `succeeded` / `failed` 才写终态审计并终结 operation**；其余状态写进度并保留 `pending` 审计。

**⚠️ 非终态的收敛入口必须显式存在（Q02 / F6-01，Normative）**：仅「拒绝新 attempt」不构成收敛——必须同时具备：

1. **恢复扫描入口**：控制面须提供按 operation 记录扫描**非终态** operation 的机制（启动时或周期任务），逐个走 §6.2 的恢复收敛顺序；
2. **release 收敛入口**：对 `pending_activation` 的 operation，须有把 release 终态（`activationStatus` + `recoveryRequired`）回写到目标与 operation 的路径；
3. **排他所有权**：收敛动作须取得与执行同一把排他所有权，避免与活跃执行并发；
4. **审计更新**：收敛完成后按 `auditId` 更新既有审计行（不得重插，见 `webui/server/admin/audit.ts:802`）。

既有的 release 状态查询端点**只返回记录、不会回写控制面状态**（`webui/server/index.ts:2409-2422`），因此**不能**充当收敛入口——控制面必须自行实现。

**operation 状态的重入分派必须穷尽（Q02，Normative）**：§6.2 C4 的分支必须覆盖 `pending` / `succeeded` / `failed` / `recovery_required` / `pending_activation` 全部五态。`recovery_required` 与 `pending_activation` **禁止**进入新 attempt——否则会绕过恢复流程，在残留效果未核验的情况下重复写入。

**组级恢复（F04）**：恢复按**持久化的组日志**进行——先核验**整个组**的实际状态，再统一更新该组所有成员的终态、审计与 operation，核验完成前不开放该组相关读写。

### 6.3 组划分、锁与写入路径

**组划分（N04 / D7，Normative）**：组的身份必须由**实际写集的交集**决定，不能只用 Schema：

- `ktx.yaml`：全部 KTX 连接配置共享这一份文件。`lucy_ops_connection_tables` 的一批目标是**一个**原子组，整批全成或全拒；
- Manifest 文件：`semantic-layer/<conn>/<schema>.yaml` —— 同连接同 Schema 的多表共享；
- Overlay 文件：`semantic-layer/<conn>/<table>.yaml`（`webui/server/overlay.ts:74`）—— **路径中不含 Schema**，故**同连接不同 Schema 的同名表也会写同一文件**；
- 版本快照与历史索引：`.ktx-ui/table-yaml-history/`（`webui/server/table-yaml-history.ts:14-16`）—— **全局单一索引文件**。

**⚠️ 共享内容文件与共享元数据必须分开（F07，Normative）**：

- **共享内容文件**（Manifest、Overlay）决定**原子组边界**：两个目标的内容写集有交集即须合组，否则在 preview 阶段以稳定原因码拒绝；
- **共享元数据**（全局历史索引）**不参与分组判定**——否则所有需要新建版本快照的目标都会退化成一个大组，D7 的原子性边界将失去意义；但它**必须按条目隔离**：写入须与内容文件写入**串行化**，撤销只回滚本组条目，**不得整份回滚全局索引**；
- 组级回滚的范围是「本组内容文件 + 本组索引条目」，不得触及他组条目；
- 组的元数据必须持久化：组 id、成员、共享**内容**文件清单、以及本组涉及的索引条目范围。

**锁与写入路径**：

| 工具族 | 锁顺序 | 写入文件 | 生效步骤 |
|---|---|---|---|
| `lucy_ops_connection_tables` | `withKtxYamlWriteLock` → `withDisplayWriteBarrier` | `ktx.yaml`（一次合并写，整批一个原子组） | catalog 重载 → 策略提交；任一目标失败则整批不写 |
| `lucy_ops_source_import` | `withKtxYamlWriteLock`（如涉 ktx）→ `withDisplayWriteBarrier` → `withPublishCoordinator` | 语义目录文件（同组合并为单版本） | `validateSource` → 版本快照 → 索引 |
| `lucy_ops_semantic_publish` | **控制面不取发布窗口**；由底层发布入口独占持有（见 F5-01） | 语义目录文件（整批） | L25-11 既有发布链路（窗口内重建计划并比对 `planDigest`） |

**锁语义必须区分（N10）**：

- `withKtxYamlWriteLock` 是**进程内 Promise 队列**（`webui/server/ktx-yaml-write-lock.ts`）：占用时**排队等待**，不抛 busy；
- `withPublishCoordinator` 窗口被占用时**抛 `PublishCoordinatorBusyError`，不排队**（`publish-coordinator.ts:322-326`）；
- 因此控制面对两种占用给出**不同**结果：ktx 锁为等待（受总超时约束），协调窗口为拒绝（稳定 busy 原因码）。二者不得共用同一句「返回 busy」的表述。

**旧入口必须纳入同一临界区（N05，Normative）**：`PUT /api/connections/:connId/enabled-tables` 当前直接调用 `auditedWriteFile`（`webui/server/index.ts:1817-1818`），`writeSourceYamlImport` 也只包了显示写屏障（`webui/server/semantic-layer.ts:950`）。若不改造，批量服务持锁期间旧入口仍可交错写入，**互斥承诺不成立**。改造要求：

- 这些旧入口进入同一 `withKtxYamlWriteLock`；
- 锁内复用既有 `writeKtxYaml` 时必须使用其已有的 `lockHeld: true` 路径（`webui/server/project.ts:445`），**不得**在持锁状态下再次取锁（自等待）；

**协调器 kind（N09）**：`withPublishCoordinator` 的 `kind` 参数类型为 `PublishEntryKind`，当前只接受 `semantic_table_save` / `manifest_upload` / `batch_import` / `manual_reindex` / `role_policy_save` / `agent_save` 六种（`publish-coordinator.ts:34-41`）。控制面必须**复用既有合法 kind**（源表导入用 `batch_import`，语义发布用 `semantic_table_save`），或把新增 kind 及其枚举与测试列入修改清单。

**⚠️ 每个工具族的锁调用树必须唯一（F08，Normative）**：`withKtxYamlWriteLock` 是**非重入**的进程内队列（`webui/server/ktx-yaml-write-lock.ts`），持锁状态下再次取锁会**自等待**。因此：

| 工具族 | 锁调用树（唯一） | 旧服务复用方式 |
|---|---|---|
| `lucy_ops_connection_tables` | `withKtxYamlWriteLock → withDisplayWriteBarrier →（直接写 ktx.yaml）` | 锁内写 ktx.yaml 走 `writeKtxYaml(..., { lockHeld: true })`（`project.ts:445`） |
| `lucy_ops_source_import` | `withKtxYamlWriteLock → withDisplayWriteBarrier → withPublishCoordinator → writeSourceYamlImport` | 改造后的 `writeSourceYamlImport` **必须提供已持锁调用入口**，控制面不得在其内部再次取非重入锁 |
| `lucy_ops_semantic_publish` | **无控制面外层取锁**；底层发布入口独占 `acquirePublishCoordinatorLock`，覆盖「文件提升 + 后台 reindex 执行期间」（`semantic-assets.ts:1505,2692-2694`） | 复用 L25-11 既有链路，**不重复取锁**（低阶 API 不检查重入，外层再取会自冲突，见 §4.5 规则 12 / F5-01） |

规则：**最外层一次性取得全部锁**，内层服务一律走「已持锁」入口；**禁止内层重复取非重入锁**；所有基线重读与比较都在**最终互斥窗口内**完成。

**⚠️ 旧 Schema 移除入口的写集（F5-04，Normative）**：`POST /api/connections/:connId/schemas/remove` 的实际写集**不止 `ktx.yaml`**——它可删除 Manifest 与 Overlay 文件（`webui/server/index.ts:1955-1971` 接受 `deleteManifest` / `deleteOverlays`；`webui/server/project.ts:947-962` 在 `writeKtxYaml` 返回**之后**执行删除，即在 ktx 写锁**之外**）。因此：

- **控制面首期不提供语义内容删除。** `lucy_ops_connection_tables` 不接受 `deleteManifest` / `deleteOverlays`；参数里出现这两个字段即拒绝，原因码 `ops_schema_content_delete_unsupported`。Schema 移除若只改 `ktx.yaml` 里的启用范围，仍属于整批合并写；
- 旧 REST `POST /api/connections/:connId/schemas/remove` 今天仍可能删除 Manifest / Overlay，且删除发生在 `writeKtxYaml` 返回之后。该入口必须进入同一把 `withKtxYamlWriteLock`。凡实际删除语义内容文件，还要按 `withKtxYamlWriteLock → withDisplayWriteBarrier → withPublishCoordinator` 取得发布窗口，并保留文件前像。这是为了让 WebUI 旧入口不和源表导入交错，不是控制面新增删除能力；
- 改造完成前，不得宣称「批量导入与既有 Schema 移除入口互斥」。

**⚠️ 版本历史裁剪必须纳入组事务（F5-05，Normative）**：源表导入创建的版本快照会触发**保留数量裁剪**——`createTableYamlVersionSnapshot` 在写入新快照后立即调用 `pruneVersions`，后者 `safeRemove` 掉被裁剪版本的快照文件（`webui/server/table-yaml-history.ts:279-294`），且**裁剪先于索引写盘**（同文件 `:333-334`），保留上限为 5（`TABLE_YAML_VERSION_RETENTION_LIMIT`）。若组内后续成员失败，而组级回滚只恢复索引条目，**被裁剪的快照内容已不可恢复**。因此：

- 组终结（全部成员确认成功）**之前**不得执行裁剪；或
- 把「被裁剪快照文件 + 索引前像」一并纳入组恢复日志，组失败时随之恢复；
- 该要求落在 `webui/server/table-yaml-history.ts` 的写入口上，须提供**可延后裁剪**的调用入口（与 §4.5 规则 14 同源）。

### 6.4 语义发布（两段式，整批阻断）

**⚠️ 语义发布必须走通用门禁，不得旁路（F01，Normative）**：语义发布的批量语义是「整批阻断」，但**授权、再授权、幂等认领、审计与恢复合同必须与通用流程一致**。实现方式是**计划适配器**，不是第二条流程：

```text
# ---- 语义发布：适配器，把 L25-11 的 validation/plan 适配成通用计划对象 ----
function semanticPlanAdapter(args, actor):
    # 步骤 0：入参必须携带【既有 staged 批次】的 validationId（F5-06 / F6-03）
    #   ⚠️ 批量【校验】端点【不产出可发布计划】——源码事实：
    #   · check 返回 {operationId, taskId, scopeId, status:"queued"}
    #     （webui/server/semantic-batch-routes.ts:318-333）
    #   · 任务结束只写校验报告（JSON/CSV）与任务记录，任务结构里【没有 validationId】
    #     （webui/server/semantic-batch-tasks.ts:59-79, 335-379）
    #   · 真正创建 batch 快照的是【维护包 staging】路径
    #     （webui/server/index.ts:2192-2216 调用 persistSemanticBatchSnapshot），
    #     而 persistSemanticBatchSnapshot 需要候选内容、candidateDigest、planDigest、
    #     目标前像、diff 等完整输入（webui/server/semantic-assets.ts:1096-1152）
    #   ⇒ 控制面【不得】把批量 check 的产物当作可发布计划，
    #     也不得凭空构造 validationId 或自造 batch 快照。
    validationId = args.validation_id                     # 必填
    snapshot = readSnapshot(validationId)
    if snapshot is None or not snapshot.batch:
        return deny("ops_validation_snapshot_not_found")   # 读计划要求快照带 batch 段
                                                           # （webui/server/semantic-assets.ts:2931-2937）

    # 步骤 1：两个范围必须分开（F7-02）
    #   requestedRefs        = 调用方 args.targets（声明范围）
    #   effectiveExecutionSet= 批次【完整影响集】= candidates ∪ unrelatedDiskChanges（实际写入范围）
    #   两者一般**不相等**：批次索引是整批生效的，其他待生效磁盘变更会一并进入。
    #   控制面按 requestedRefs 校验「调用方声明的批次范围」，按 effectiveExecutionSet 做授权与执行。
    scope = snapshot.batch.scopeId
    requestedRefs = set(ids(args.targets))
    if not requestedRefs.issubset(set(ids(snapshot.batch.refs))):
        return deny("ops_target_out_of_batch")             # 调用方不得超出既有批次范围

    # 步骤 2：（可选）前置批量校验【只产出报告，不产出计划】
    #   校验失败可作为 preview 的 blockers，但【不得】用它的产物替换或伪造计划。
    #   task = startBatchCheck(scope)  →  taskId / operationId 均不是 validationId
    # 步骤 3：读该批次的发布计划（读计划要求快照带 batch 段）
    plan = getBatchPlan(validationId)                     # 见步骤 4 的字段口径

    # 步骤 4：解析【完整实际影响集】（Q03 / G22）
    #   底层类型 SemanticBatchPlan 的字段口径（webui/server/semantic-batch-service.ts:820-828）：
    #     candidates          = 本批次的【候选】变更
    #     unrelatedDiskChanges= 已存在的【其他待生效磁盘变更】（不属于本批次，但索引会一并生效）
    #     effectiveTargets    = candidates ∪ unrelatedDiskChanges = 【批次真正会写入的全部对象】
    #   实际返回同口径（webui/server/semantic-assets.ts:2988-2996）。
    #   ⚠️ 授权必须基于 effectiveTargets：只按 candidates 授权会漏掉
    #      【调用方无权访问的连接上的待生效磁盘变更】，形成越权发布。
    impactSet = plan.effectiveTargets
    if impactSet is empty or impactSet is None:
        return deny("ops_target_unresolvable", detail="empty_impact_set")

    # 步骤 5：影响集必须全部解析为受管对象，否则整批拒绝
    unresolvable = [x for x in impactSet if not resolveToManagedObject(x)]
    if unresolvable not empty:
        return deny("ops_target_unresolvable", detail=unresolvable)

    # 步骤 6：适配为通用计划对象
    #   ⚠️ 底层【没有】 groups / perTarget 字段（SemanticBatchPlanResponse 仅有
    #      candidates / unrelatedDiskChanges / overwriteSet / effectiveTargets /
    #      dependencies / readonlyDependencies，webui/server/semantic-assets.ts:2914-2930），
    #      因此 groups 与 perTarget 必须由适配器【自行构造】，不得假设底层已提供。
    #   语义发布为整批阻断 → 全部影响集构成【单一原子组】，不按文件拆组。
    perTarget = buildPerTargetFromImpactSet(impactSet, plan)
    return adaptToGenericPlan(plan, impactSet,
                              plan_id=validationId,        # 语义工具的 plan_id 即 validationId
                              confirm_digest=plan.planDigest,
                              groups=[singleAtomicGroup(perTarget)],   # 整批一个原子组
                              per_target=perTarget,
                              execution_set=impactSet,     # ★ 执行集 = 整个已确认原子组（F7-02）
                              actor=actor, toolName="lucy_ops_semantic_publish")

# ---- 语义发布 commit：仍走 §6.2 的通用门禁 ----
# §6.2 的 C1（计划校验）、C2（计划对象再授权）、C3（执行子集与组完整性）、
# C4/C5（两级幂等认领）、C7（统一终结）对语义工具同样适用；差异只在执行阶段：
function executeSemanticGroup(group, claimed):
    # 整批阻断：组内任一 blocker → 整组不写，非部分成功
    if group.blockers not empty:
        for t in claimed:
            t.result = Outcome.failed("ops_plan_blocked", stage="group")
        return
    # ⚠️ 锁所有权（F5-01）：控制面【不得】在外层取 withPublishCoordinator。
    #   底层发布路径调用低阶 acquirePublishCoordinatorLock（semantic-assets.ts:1505），
    #   而低阶 API 不检查重入上下文（publish-coordinator.ts:239-264），
    #   外层再取同一把锁会让底层取锁失败并抛 PUBLISH_IN_PROGRESS。
    #   发布窗口由底层独占持有，【覆盖文件提升与后台 reindex 执行期间】。
    #   ⚠️ 但覆盖范围**止于 reindexImpl 返回**：锁在 `finally` 中释放
    #   （semantic-assets.ts:2692-2694），而终态摘要核验（:2718）、终态审计（:2743）、
    #   `published` 记录（:2764）、恢复日志完成（:2779）都发生在【锁释放之后】（F6-08）。
    #   ⇒ 控制面不得宣称「发布窗口覆盖整个发布生命周期」；该缺口登记为 W-B 的 L25-11 依赖。
    #   底层在窗口内重建计划并与确认摘要比对（semantic-assets.ts:2266-2290），
    #   控制面不得绕过这一 CAS 保护。
    release = publishWholeBatch(group, idempotencyKey)     # 窗口由底层持有
    # ⚠️ 发布返回的是【受理态】，不是「已生效」（Q01）
    #   既有实现原文：「Promote succeeded — record `reindexing` and return immediately」，
    #   并显式注释 "reindexing" is NOT "已生效"（webui/server/semantic-assets.ts:2615-2619）
    #   ⚠️ release 有【两个相互独立的轴】（webui/server/semantic-release-status.ts:10-29）：
    #     recoveryRequired : 是否存在需要人工核验的未完成回滚
    #       （true | false | "unknown"，旧记录为 "unknown"）
    #     activationStatus  : 是否【已知】Agent 能读到新语义
    #       （unconfirmed | confirmed | unknown）
    #   源码明确列举的组合（semantic-release-status.ts:14-19）：
    #     reindex 失败 → recoveryRequired=false + activationStatus=unconfirmed（文件已保留）
    #     回滚失败     → recoveryRequired=true  + activationStatus=unconfirmed（文件半写）
    #     完整发布     → recoveryRequired=false + activationStatus=confirmed
    #   ⇒ 必须【先判恢复义务，再判生效状态】（F6-06）。
    for t in claimed:
        if release.recoveryRequired == true:
            # 存在未完成回滚 → 需恢复：不得回滚（回滚会二次破坏）、不得终结
            t.result = Outcome.recoveryRequired(release=release,
                                                activation=release.activationStatus,
                                                detail="release_recovery_required")
            t.state = "recovery_required"
        elif release.activationStatus == "confirmed":
            t.result = Outcome.succeeded(release=release)
            t.state = "succeeded"
        else:
            # 受理中（含 reindex 失败：文件已保留、激活未确认）：
            # ok 必须为 null（不得写 ok:false，否则会被通用编排误判为运行失败并回滚）
            t.result = Outcome.pendingActivation(release=release,
                                                 activation=release.activationStatus)
            t.state = "pending_activation"     # 保持 pending，不得记成功、不得回滚、不得终结
```

**⚠️ staged 批次的归属与消费合同（F7-03，Normative）**：底层读计划严格校验批次归属——`batch.actor !== context.actor` 拒绝（403「该批次属于其他操作者，不能直接消费」），并继续校验 `batch.instanceId`（`webui/server/semantic-assets.ts:2941-2950`）；而既有的 staging 入口以**管理员请求 actor** 创建批次（`webui/server/index.ts:2188-2216` 调 `actorIdFromRequest`，`webui/server/security/request-actor.ts:64-80` 返回管理员 id）。

因此本 Spec 明确：

1. **首期只允许消费「由本 Agent 身份创建」的 staged 批次**——控制面**不得**通过伪装 actor、删除底层 actor/instance 校验或以管理员身份代读来绕过归属；
2. **跨操作者 / 跨实例消费一律拒绝**（沿用底层 403 语义，转换为稳定原因码 `ops_batch_not_owned`）；
3. **由此产生的首期范围缺口**：既有 staging 路径是管理员 WebUI 流程，Agent 身份**没有**创建批次的能力 ⇒ **仅凭现有能力，W-B 的语义发布在首期不可用**。补齐方式属**产品/范围决策**，不由实现自行选择：
   - (a) 新增「Agent 身份下的 staging 能力」（扩大首期范围与身份面）；
   - (b) 定义**显式批次交接**（保留原 actor/instance 校验 + 独立授权记录 + 审计归因）；
   - (c) 由控制面以**受信委托人**身份代为 staging（须明确委托链与归因）。

   该项登记为 **D8**（见 §8），**D8 未拍板前 W-B 保持未解锁**；不得以「先按 (b) 实现再补授权」的方式带病开工。

**语义发布与通用流程的差异有五处，且必须显式声明**：

1. **原子性**：语义发布为整批阻断，其余工具族为部分成功可重放（§4.3）；
2. **计划适配**：语义发布的计划来自**既有 staged 批次**的 `validationId`，其 `confirm_digest` 即底层 `planDigest`；
3. **锁所有权**：发布窗口由**底层独占持有**，控制面不得外层再取（F5-01）；
4. **受理态**：发布返回的是受理态而非生效态，成功判定须等 release 终态（Q01）；
5. **release 双轴**：release 有 `recoveryRequired` 与 `activationStatus` **两个相互独立的轴**，必须**先判恢复义务、再判生效状态**（F6-06）。

**⚠️ 计划 TTL 与幂等重放的优先级（F5-07，Normative）**：底层语义发布的顺序是「幂等查询 → 读快照 → 发布」，且成功受理后会**删除快照**（`webui/server/semantic-assets.ts:2195-2223`、`:2657-2658`）。因此：

- **计划过期拒绝只适用于「尚未发生任何执行」的新提交**——没有任何幂等记录、且计划已超出 TTL 时才拒绝；
- **已有 operation 记录的重放**必须先定位该 operation，用其**持久化的计划对象**做再授权（§6.2 C2），再复用或恢复——**不得**因为计划已过期或快照已删而把一次合法重放变成「找不到计划」；
- 底层语义发布本身的幂等查询先于快照读取，是同一原则的既有实现（`semantic-assets.ts:2195-2223`），控制面必须与之保持一致；
- 尚未执行完的 pending operation **必须仍可恢复**，其恢复依据是 operation 记录中持久化的计划与 `execSet`，不是原始快照。

**不得**为语义发布另建一套授权、幂等或审计合同；**不得**在 commit 中先读 validation 再生成确认依据。

---

## 7. 分期路线（可交付开发的范围是 W-A）

| 期 | 范围 | 风险 | 前置 |
|---|---|---|---|
| **本版可交付开发（W-A）** | `lucy_ops_connection_tables`、`lucy_ops_source_import` | 中高（首批即含写） | 设计门禁已关闭。2026-10-29 已授权实现 S1–S4。G15、G22、G23、G28、G30、G31、G38 与 D8 不得阻塞 W-A |
| **不在本版（W-B）** | `lucy_ops_semantic_publish` | 高 | D8 拍板 + L25-11 的 B01／H01–H05 审阅通过 + G30／G31 由 L25-11 维护者关闭 |
| 后续（Phase 2） | 角色 / 行策略 / 凭证治理 | 高（owner-only 与权限变更） | W-A 验收 + 委托语义落地 + G13 门禁补齐 |
| 后续（Phase 3） | Wiki 访问、业务 Skill、评测相关读工具 | 中 | Phase 2 |

**只读巡检工具不在本版可交付开发范围内。** 它们仍列在 §3.3 的后续期，避免在对象范围未确认时把只读工具一起做成首期合同。

### 7.1 首期阻塞项：L25-11 当前状态

`lucy_ops_semantic_publish` 包装 L25-11 既有服务，因此首期受其当前状态约束。**已核实的事实（git 定序）：**

| 时间 | 提交 | 事件 |
|---|---|---|
| 10-27 15:11 | `f008490a` | 「close semantic batch spec and plan review」→ 写入 Spec 头部「评审已关闭，修订通过（2026-10-27）」 |
| 10-27 17:57 | `2e98be74` | 「implement the semantic asset batch P0 D1-D23 contract」→ 追加 §1.4 |
| 10-27 19:29 | `36e390d1` | 「record P0-1 and P0-3 codex review returns」→ **审阅结论为「退回」**（1 阻塞 B01 + 5 高 H01–H05 + 2 中 M01/M02），并将 `docs/README.md` 索引改为「设计审查退回，待修订」 |

**结论**：L25-11 的**审阅结论**是**独立审阅退回**（`docs/reviews/2026-10-27-codex-review-semantic-batch-operations-p0.md` 结论行「## 结论：退回」），Wave 0b 未解锁，客户交付保持 `blocked_delivery`。其**实现进度**按该 Spec 头部「状态」行为「**基础模块已落地；生产接线与完整一致性闭环待完成；V01–V22 全部未执行**」——审阅结论「退回」与实现已部分落地**并存**，不得据任一侧概括为「只欠验收」或「尚未开始」。

**发现的漂移（已于 2026-10-28 经 PM 授权做状态行事实对齐）**：对齐**前**，L25-11 Spec 头部「评审状态：Spec／Plan 文档评审已关闭，修订通过（2026-10-27）」与上述审阅结论**不一致**，属过期状态行。审阅 M02 本身已指出「Spec 状态、历史叙述与后续修复基线混杂」。

**状态行事实对齐（2026-10-28，PM 授权）**：L25-11 Spec 头部状态行**已按上表更正**为「独立审阅退回 + `2e98be74` 已落地但未复审」，依据见该 Spec §1.5。**（2026-10-29 实读该 Spec 头部与 §1.5 复核：§1.5 存在，且其「更正后的当前状态」与「未随之改变的项」两段与本节表述一致。）**该更正只改状态陈述，不构成 L25-11 的实质修订——冻结合同、V01–V22 状态、Wave 0b 未解锁与客户交付 `blocked_delivery` 均不变。

**该更正由 L25-11 侧维护会话于 2026-10-28 经 PM 授权完成**（记于该 Spec §1.5），**本功能不参与该更正、也不代改 L25-11 的正文与状态行**——L25-11 的实质修订仍待其维护者随修订一并处理；本功能只登记事实与依赖。

**首期处置（D5：已拍板）**：

| 工作流 | 工具 | 依赖 | 解锁条件 |
|---|---|---|---|
| **W-A，本版可交付开发** | `lucy_ops_connection_tables`、`lucy_ops_source_import` | 无 L25-11 依赖；两者均为新建批量服务 | 2026-10-29 已授权实现 S1–S4 |
| **W-B，本版不交付开发** | `lucy_ops_semantic_publish` | 包装 L25-11 既有服务 | **D8 已拍板** + **L25-11 的 B01／H01–H05 修复完成且审阅通过** + **G30／G31 已由 L25-11 维护者关闭** |

**排除项**：不得包装当前 L25-11 服务——该服务已退回且存在 1 项阻塞缺陷（B01），包装它等于把阻塞缺陷带入控制面契约。

### 7.2 首期风险

> **G15 的阶段限定（N08）**：底层发布服务审计改造（G15）只影响 W-B 的语义发布通道，**不得成为 W-A 的前置**，否则与 D5 的「W-A 先行」安排冲突。VOPS-22 的证据责任按此拆分：公共归因（S1）+ W-A 服务归因（S3/S4）+ W-B 发布归因（S5）。

| 风险 | 影响 | 缓解 |
|---|---|---|
| `ktx.yaml` 单文件承载 KTX 连接配置 | 批量写丢改动 | G10 一次合并写 + 锁内基线冲突检测 |
| 逐目标屏障导致中间态外泄 | catalog / 策略层看到半批状态 | G11 整批一个屏障窗口 |
| 控制面工具扩大 Agent 攻击面 | 越权配置、批量误改 | 独立 `allow.ops` 维度 + 显式登记 + fail-closed + 两段式 + 委托校验 + G13 门禁 |
| 审计归因失真 | 事后追责失败 | G2（控制面来源值）先于任何写类工具；**G15 仅限 W-B**，不得阻塞 W-A |
| 建于未验收且已退回的能力之上 | Phase 1 返工 | §7.1 工作流拆分 |
| 同 Schema 共享 Manifest 无法逐目标隔离 | 报告「部分成功」但文件已整体重写 | D7 原子组 + G16 组级回滚 |
| 与 Admin 平面权限割裂 | 人工与 Agent 两条路径权限不一致 | §3.2.2 规则 7/8 |
| **受理态被误判为失败（Q01）** | 已受理的发布被整组撤销，后台索引仍在跑 | 结果四分类 `kind`（§6.2）；受理态 `ok=null`、不回滚、不终结；VOPS-59 |
| **语义发布锁自冲突（F5-01）** | 正常发布被自己的外层锁拒绝，报 `PUBLISH_IN_PROGRESS` | 控制面不外层取发布窗口，窗口由底层独占持有（§4.5 规则 12）；VOPS-63 |
| **影响集漏授权（Q03）** | 无权连接上的待生效磁盘变更被一并发布 | 授权基于 `effectiveTargets`（§6.4）；VOPS-61 |
| **恢复越界（F5-02）** | 崩溃恢复执行本次未请求的对象 | 执行子集绑定 attempt 并持久化（§6.2 C3 / 恢复顺序 0.1）；VOPS-64 |

---

## 8. 决策台账

| 编号 | 决策 | 结论 | 状态 |
|---|---|---|---|
| **D1** | 控制面授权走哪条身份平面 | **C 混合**：Agent 身份 + `allow.ops` 单独授权 + `delegated_from` 委托 | ✅ 已拍板（2026-10-28） |
| **D2** | 可交付开发的范围 | **W-A：连接表配置与源表导入。** 语义发布留在 Spec，不进入本版实现 | ✅ 2026-10-29 收窄（原 2026-10-28「Phase 1 含语义发布」不再作为开工范围） |
| **D3** | 批量写语义 | preview→commit。连接表整批全成或全拒；源表导入组间部分成功；语义发布整批阻断 | ✅ 2026-10-29 按工具写成三种，不再用一条「部分成功」覆盖全部工具 |
| **D4** | §3.4 不工具化清单 | **采纳**。另：控制面首期不接受 `deleteManifest` / `deleteOverlays` | ✅ 已拍板（2026-10-28）；删除标志于 2026-10-29 明确拒绝 |
| **D5** | L25-11 阻塞处置 | W-A 不包装 L25-11。W-B 待 L25-11 审阅通过且 D8 拍板 | ✅ 已拍板（2026-10-28）；2026-10-29 起 W-B 不是可交付开发范围 |
| **D7** | **同写集原子组** | 组身份由实际写集交集决定。Overlay 路径不含 Schema，同连接不同 Schema 的同名表同属一组。历史索引是共享元数据，不参与分组。源表导入组内全成或全败、组间部分成功。连接表因共享 `ktx.yaml`，整批一个原子组 | ✅ **2026-10-29 PM 确认** |
| **G34** | 认领与审计的事务边界 | 幂等存储与审计行在 `audit.sqlite` 同一次事务中提交。文件写不在事务内，靠最小恢复协议覆盖 | ✅ **2026-10-29 PM 定案**（取 (a) + 最小恢复协议） |
| **D8** | staged 批次由谁创建、Agent 如何合法消费 | 三选一仍开放：(a) Agent 自己 staging；(b) 显式批次交接；(c) 受信委托人代为 staging | ⏳ **未决。W-B 保持关闭** |
| D6 | 后续期工具清单是否保留 | 待需求审查 | ⏳ 待 PM 裁决 |

### 8.1 需向客户确认的口径

1. W-A 的对象是连接、Schema 与源表。角色、Agent、Token 仍由 D6 决定，不阻塞 W-A。
2. 本版只交付 MCP 工具，不新增 HTTP 批量端点。
3. 本版只做写。只读巡检不在本版。
4. preview → commit 已确认。

### 8.2 交付判定台账

| 轮次 | 审阅方 | 判定 | 阻塞项 | 修订落点 |
|---|---|---|---|---|
| 第 1 轮 | Codex（read-only） | **退回修订** | R01、R02（2 项阻塞）+ R03–R16 + S01–S03 | Spec v0.4 / Plan v0.2 |
| 第 2 轮 | Codex | **需再修订** | N01 等 | Spec v0.5 / Plan v0.3 |
| 第 3 轮 | Codex | **需再修订** | F01、F02、F03 | Spec v0.6 / Plan v0.4 |
| 第 4 轮 | Codex | **需再修订** | Q01、Q02、Q03 | Spec v0.7 / Plan v0.5 |
| 第 5 轮 | Codex | **不可交付开发** | Q01（回归）、Q02、Q03、F5-01 | Spec v0.8 / Plan v0.6 |
| 第 6 轮 | Codex | **不可交付开发** | F6-01、F6-02、F6-03 + 高危 F6-04–F6-09 + 中危 F6-10 / F6-11 | Spec v0.9 / Plan v0.7 |
| 第 7 轮 | Codex | **不可交付开发** | F7-01、F7-02、F7-03 + 高危 F7-04–F7-07 + 中危 F7-08–F7-10 | Spec v1.0 / Plan v0.8 |
| 第 8 轮 | — | **未进行** | PM 于 2026-10-29 选择不开独立复审，改为直签 W-A | — |
| PM 直签 | PM | **W-A 可交付开发；W-B 不可交付开发** | 直签关闭的是已点名的伪代码冲突、D7 与 G34。D8 仍开放 | **Spec v1.1 / Plan v0.9** |

**当前交付判定**：

- **W-A 设计可交付开发。** 2026-10-29 PM 批准并授权把修订写入 Spec / Plan。D7 已确认，G34 已定为同库同事务加文件写窗口的最小恢复协议。失败重放与 attempt 审计的伪代码已与正文对齐。
- **W-B 不可交付开发。** D8 未决，L25-11 仍是审阅退回。
- **第 8 轮 Codex 复审没有做。** 本判定是 PM 直签，不是新的独立对抗审阅。
- **2026-10-29 PM 已授权实现 W-A（S1–S4）。** 该授权不产生 VOPS 证据。VOPS-01–78 仍全部未执行。S5 不得开始。

---

## 9. 验收矩阵（草案，未执行）

> 本期条目全部为草案，**状态一律为「未执行」**。子断言未全部取得直接证据前，不得将任一条目改为通过。
>
> 编号前缀为 **`VOPS-`**（非 `V-`）：本仓库的验收编号存在跨 Spec 混用风险（`docs/qa/security-findings.yaml` 的 `verifiedBy` 只接受冻结 case-catalog 中登记的 ID，别的 Spec 的 V 编号不能直接填入）。本 Spec 使用独立前缀，避免与 L25-11 的 V01–V22 等发生串号。
>
> VOPS-31–47 为首轮审阅（2026-10-28）新增，对应 R01–R16 与 S01–S03 的修订点；VOPS-48–58 为第二轮终审新增，对应 N01–N11 与六条未闭合项；VOPS-59–69 为第四、五轮审阅新增，对应 Q01–Q08 与 F5-01–F5-07 的修订点；VOPS-70–72 为第六轮审阅新增，对应 F6-01 / F6-02 / F6-06；**VOPS-73–78 为第七轮审阅新增**，对应 F7-01 / F7-02 / F7-03 / F7-06 / F7-07 / F7-10。

| 编号 | 断言 | 状态 |
|---|---|---|
| VOPS-01 | 未登记工具仍 fail-closed，不因新增控制面态而放开 | 未执行 |
| VOPS-02 | `allow.ops` 未授予该工具时拒绝，deny 码可区分于数据面 | 未执行 |
| VOPS-03 | `asset_kinds` 不覆盖工具域时拒绝 | 未执行 |
| VOPS-04 | `connection_scoped` 工具在 `scope.connections` 缺省时拒绝（不回落为全允许） | 未执行 |
| VOPS-05 | 多条 grant 与多角色并集；**判定逐条进行，不跨 grant 拼接** | 未执行 |
| VOPS-06 | `allow.ops.tools` 含 `*` 时静态检查 fail | 未执行 |
| VOPS-07 | owner-only 工具在 `delegated_from` 缺失或委托人非 owner 时拒绝 | 未执行 |
| VOPS-08 | 委托只提升 owner-only，不扩大已声明的域与连接范围 | 未执行 |
| VOPS-09 | 写类缺 `idempotency_key` 时拒绝执行 | 未执行 |
| VOPS-10 | 同键同目标同计划复用结果；同键异计划冲突拒绝 | 未执行 |
| VOPS-11 | preview 产出的计划含逐目标 before/after 与 blockers | 未执行 |
| VOPS-12 | plan 过期 / digest 不符 / actor 不符 / 工具不符时 commit 拒绝 | 未执行 |
| VOPS-13 | 预览后目标被其他写入改动时冲突拒绝 | 未执行 |
| VOPS-14 | 源表导入组间部分成功：一个原子组失败不阻断写集不相交的其他组，并返回逐目标结果。连接表与语义发布不适用本条 | 未执行 |
| VOPS-15 | 失败目标可单独重放，且不产生重复副作用 | 未执行 |
| VOPS-16 | 重放成功追加 target 级审计，首次失败行不被覆盖 | 未执行 |
| VOPS-17 | `ktx.yaml` 一次合并写，多连接改动互不丢失；任一连接失败或外部修改则整批不写 | 未执行 |
| VOPS-18 | 外部修改 `ktx.yaml` 时批量写在写入前冲突拒绝 | 未执行 |
| VOPS-19 | 整批在一个显示写屏障窗口内完成，catalog 不可见中间态 | 未执行 |
| VOPS-20 | 涉及语义发布的写操作全部经过发布协调窗口，无并发穿透 | 未执行 |
| VOPS-21 | 一次调用产生 1 条 operation 级 + N 条 target 级审计 | 未执行 |
| VOPS-22 | 审计记录可区分 MCP 来源与委托人，**底层复用服务不得留 `ui_admin`**；按 G15 限定拆为三段证据：公共归因 / W-A 服务归因 / W-B 发布归因 | 未执行 |
| **VOPS-23** | **写类失败时 `writeStatus` 正确转为 `failed` 并带原因码**；**明确排除** `pending_activation` 与 `recovery_required` 两种非终态——此二者审计行保持 `pending`，不得转 `failed`（Q01 / Q02） | 未执行 |
| VOPS-24 | 只读工具不写配置审计，但进入访问日志 | 未执行 |
| VOPS-25 | 用量统计能统计到控制面工具调用，且嵌套 `targets` 不被误判为评测探针 | 未执行 |
| VOPS-26 | 控制面工具不出现在数据面行级策略强制过滤路径 | 未执行 |
| VOPS-27 | `access.yaml` 与代码侧分类判定一致，`lint:spec` 通过 | 未执行 |
| VOPS-28 | `lucy_ops_semantic_publish` 为整批阻断语义，与部分成功工具族明确区分 | 未执行 |
| VOPS-29 | 源表批量导入的失败目标不留下半写状态 | 未执行 |
| VOPS-30 | 客户 linux/amd64 环境下的真实 Agent 调用取证 | 未执行 |
| **VOPS-31** | **commit 阶段对计划内全部对象重新授权**；权限收窄后旧计划不可提交（R01） | 未执行 |
| **VOPS-32** | **ktx 写入与生效确认完成后才写 committed 审计与幂等终态**；写盘失败不留「已成功」（R02） | 未执行 |
| **VOPS-33** | **单一 grant 完整匹配**：不满足域条件的 grant 不能贡献连接范围（R03） | 未执行 |
| **VOPS-34** | **委托的签发/变更/撤销、Token 签发、role 赋权、Agent 变更均需 owner**；operator 不可借委托链取得 owner 能力（R04） | 未执行 |
| **VOPS-35** | **语义发布 commit 必须携带预览时的 planDigest**，缺失即拒绝（R05） | 未执行 |
| **VOPS-36** | **控制面工具在 `tools/list` 可见且不要求数据面能力；全局 `deny_tools` 仍生效**（R06） | 未执行 |
| **VOPS-37** | **批量写与既有连接写入口互斥**（同一 `withKtxYamlWriteLock`）；基线比较在锁内（R07） | 未执行 |
| **VOPS-38** | **幂等意图先于正式效果持久化**；崩溃后能判定并核验（R08） | 未执行 |
| **VOPS-39** | **重放复用已成功目标结果，不被自身基线变化阻断**（R09） | 未执行 |
| **VOPS-40** | **业务幂等键与审计事件键分离**；重放可追加审计行而不被 `ON CONFLICT` 去重（R10） | 未执行 |
| **VOPS-41** | **同 Schema 多表共享 Manifest**：原子组内全成或全败，失败不留半写（R11、D7） | 未执行 |
| **VOPS-42** | **角色保存路径接受并保留 `allow.ops`**；`roles.ts` 键白名单已放行（R12） | 未执行 |
| **VOPS-43** | **发布服务审计可区分控制面来源**，底层不落 `ui_admin`（R13） | 未执行 |
| **VOPS-44** | **restore 走 import 写服务**，报告成功即已落盘（R14） | 未执行 |
| **VOPS-45** | **非 KTX 来源连接在 preview 阶段返回稳定拒绝码**（R15） | 未执行 |
| **VOPS-46** | **协调窗口被占用时返回稳定 busy 原因码**，不自旋、不排队（S01） | 未执行 |
| **VOPS-47** | **`role` 与 `roles` 同时声明被明确拒绝并给出可读错误**（S02） | 未执行 |
| **VOPS-48** | **多 grant / 多角色按对象分别授权**：grant A 只授连接 A、grant B 只授连接 B 时，合并批量调用**必须放行**（N02 回归防护） | 未执行 |
| **VOPS-49** | **preview 与 commit 共用同一规范化摘要载荷**，调用方原样带回 `confirm_digest` 可通过校验（N01） | 未执行 |
| **VOPS-50** | **语义工具的 `plan_id` 与 `validationId` 映射明确**，统一 commit 门禁对语义工具同样可用（N01） | 未执行 |
| **VOPS-51** | **同写集原子组的组级状态机**：① 组内任一成员不可执行时整组不写；② 组内任一成员**明确失败**时整组撤销并统一为 `ops_group_rolled_back`；③ 撤销未完成时整组置 `recovery_required`，**不写任何成员终态**（N03 / Q01 / Q06） | 未执行 |
| **VOPS-52** | **失败子集重放保持组完整性**，不得只重放组内一部分（N03） | 未执行 |
| **VOPS-53** | **组身份按实际写集交集判定**：同连接不同 Schema 的同名表（Overlay 路径不含 Schema）必须合组或被拒（N04） | 未执行 |
| **VOPS-54** | **组级回滚不整份回滚全局历史索引**，其他组的成功记录不被撤销（N04） | 未执行 |
| **VOPS-55** | **旧写入口纳入同一写锁**：批量持锁期间 `enabled-tables` / `writeSourceYamlImport` 不可交错写（N05） | 未执行 |
| **VOPS-56** | **语义发布同键重放返回原 release**，不撞 `snapshot not found`（N06） | 未执行 |
| **VOPS-57** | **各崩溃点收敛**：效果后/审计前、target 终结前、组回滚中崩溃后，重启能判定并收敛，不静默重跑（N07） | 未执行 |
| **VOPS-58** | **锁占用语义分离**：ktx 锁排队等待、协调窗口拒绝并给 busy 原因码，两者行为与文档一致（N10） | 未执行 |
| **VOPS-59** | **发布受理态不得触发回滚或终结**：受理返回后目标保持 `pending_activation`、审计行保持 `pending`、组不撤销；仅当 `activationStatus == confirmed` 才置成功；`reindex_failed` 同样按受理态处理（保留已写文件、激活未确认）（Q01） | 未执行 |
| **VOPS-60** | **五态持久化与重入穷尽**：两种非终态在进程重启后仍可判定；`recovery_required` / `pending_activation` 的 operation 拒绝新 attempt 并分别进入恢复 / release 收敛；operation 状态按 §4.2 聚合规则计算（Q02） | 未执行 |
| **VOPS-61** | **语义发布授权覆盖完整影响集**：未授权连接上的附带待生效磁盘变更（`unrelatedDiskChanges`）必须阻断发布；`effectiveTargets` 为空或含不可解析对象时整批拒绝（Q03） | 未执行 |
| **VOPS-62** | **认领事务**：本 attempt 的 operation 认领、operation 审计、target 认领与 target 审计在同一次 `audit.sqlite` 事务中提交。事务回滚或提交前崩溃后，不存在本 attempt 的幂等行与审计行，也不产生文件效果（G34） | 未执行 |
| **VOPS-63** | **语义发布锁所有权**：真实调用链可受理、**不自报 busy**；受理后其他写入口仍被发布窗口排除（F5-01） | 未执行 |
| **VOPS-64** | **执行子集绑定 attempt**：原计划含 A/B 组、本次只提交 A 时，崩溃恢复**绝不执行 B**；非法子集被拒且**不遗留 pending operation**（F5-02） | 未执行 |
| **VOPS-65** | **异常不丢已完成结果**：认领事务失败时不留本 attempt 的 pending 行且不产生效果；效果前异常、效果后异常、终态审计更新失败、target 终结失败、operation 终结失败都不静默吞掉，不中断后续组，已完成组的结果仍返回（F5-03 / F7-04） | 未执行 |
| **VOPS-66** | **旧 Schema 移除纳入同一临界区**：批量导入持锁期间，旧移除入口不得删除其 Manifest / Overlay；该入口失败可恢复全部效果（F5-04） | 未执行 |
| **VOPS-67** | **历史版本裁剪纳入组事务**：已有 5 个版本时，组内新增版本后另一成员失败，原 5 个版本仍全部可读，索引无悬空引用（F5-05） | 未执行 |
| **VOPS-68** | **消费既有 staged 批次**：preview 的 `plan_id` 必须是**合法 staged 批次的 `validationId`**（快照存在且带 `batch` 段）；以普通 `taskId` / `operationId` 或不存在的 `validation_id` 调用**一律拒绝**；合法 `validation_id` 可读出计划并被 publish 消费（F5-06 / F6-03 / F7-09） | 未执行 |
| **VOPS-69** | **计划 TTL 与幂等重放优先级**：计划过期后，已成功的同键重放仍返回原结果；尚未执行的提交按过期拒绝；pending operation 仍可恢复（F5-07） | 未执行 |
| **VOPS-70** | **operation 状态聚合唯一且一致**：同一聚合函数在重入分派、终结与恢复后三处结果一致；存在未终结成员时**不得**转 `failed` 终态；成员状态出现五态之外的值时返回 `ops_state_corrupt` 而非当作失败重试（F6-01） | 未执行 |
| **VOPS-71** | **同一原计划可分多次提交**：原计划含 A/B 组，首次只提交 A 并成功后，operation 保持 `pending`；随后可提交 B 且**不重复执行 A**；B 成功后 operation 才终结为 `succeeded`（F6-02） | 未执行 |
| **VOPS-72** | **结果字段完整一致**：所有分支经唯一 `Outcome` 构造器产出结果，`kind` 与 `ok` 成对，重建分支使用 `keep=`。语义发布先判 `recoveryRequired` 再判 `activationStatus`。`recoveryRequired=true` 经适配器、编排、持久化与重启后，`release` 与 `activationStatus` 仍在（F6-06 / F7-05）。本条随 W-B 取证，不阻塞 W-A | 未执行 |
| **VOPS-73** | **失败成员不被抹掉**：A 失败后提交 B，A 的失败状态与失败审计行**原样保留**，operation 聚合结果为「A.failed + B.succeeded」而非把 A 当未执行（F7-01） | 未执行 |
| **VOPS-74** | **损坏状态在新认领前被拒绝**：成员持久态出现五态之外的值时，commit 返回 `ops_state_corrupt`，**不产生任何效果**（F7-01 / F7-07） | 未执行 |
| **VOPS-75** | **语义发布执行集 = 完整影响集**：授权覆盖 `R ∪ U` 时可发布；`U` 中存在未授权对象时在**认领前**即被拒绝；执行集不得被参数收窄（F7-02） | 未执行 |
| **VOPS-76** | **批次归属校验不被绕过**：跨操作者、跨实例消费 staged 批次一律拒绝（`ops_batch_not_owned`）；控制面不以管理员身份代读、不伪装 actor（F7-03） | 未执行 |
| **VOPS-77** | **分次提交的审计可解释**：只提交 A 且 A 成功时，该 attempt 的 operation 审计为 `committed`，operation 记录仍为 `pending`。再提交 B 成功后，B 的审计单独为 `committed`，A 的审计行不被改写。A 失败后再提交成功的 B：A 的审计保持 `failed`，B 的审计为 `committed`，operation 记录为 `failed`。全程无永久 `pending` 行（F7-06） | 未执行 |
| **VOPS-78** | **恢复合同自洽**：恢复 A 后的首次调用**不执行 B**（只收敛已认领未终结的成员），再次提交 B 才执行并按全集聚合（F7-10） | 未执行 |

---

## 10. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 控制面工具扩大 Agent 侧攻击面 | 越权配置、批量误改 | 独立授权维度 + 显式工具登记 + fail-closed + 两段式 + 委托校验 + G13 门禁 |
| 审计归因失真 | 事后追责失败 | **公共归因 G2 适用于全部写类工具**（控制面来源值）；**G15 仅限 W-B 的发布链路**，不得作为 W-A 写类工具的前置（与 §7 的阶段限定一致，见 §7.2） |
| 批量写语义不统一（语义发布为例外、同 Schema 原子组为收窄） | 调用方按错误心智模型操作 | 差异写进工具描述与文档；§4.3 与 D7 已显式声明 |
| 建于未验收且已退回的能力之上 | Phase 1 返工 | §7.1 工作流拆分 |
| `ktx.yaml` 单文件写竞争 | 配置丢失 | G10 合并写 + 锁内基线冲突检测 |
| 与 Admin 平面权限割裂 | 人工与 Agent 两条路径权限不一致 | §3.2.2 规则 7/8 |
| 语义发布受理态被当作成功或失败 | 误报成功，或误撤销已受理的发布 | 结果四分类 `kind`（§6.2）；只有 `confirmed` 才置成功；受理态不回滚、不终结（Q01） |
| 语义发布影响集只按候选授权 | 无权连接上的待生效磁盘变更被一并发布 | 授权基于 `effectiveTargets`；不可解析即整批拒绝（Q03） |
| 语义发布锁所有权错置 | 正常发布被自己的外层锁拒绝 | 控制面不外层取发布窗口（§4.5 规则 12、F5-01） |
| 非终态未持久化 | 进程重启后无法判定 pending / 待生效 / 需恢复 | §4.2 operation 级五态聚合 + 目标级进度持久化（Q02） |
| 恢复越界 | 崩溃恢复执行本次未请求的对象 | 执行子集绑定 attempt（§6.2 C3、恢复顺序 0.1，F5-02） |
| 旧写入口与历史裁剪游离于临界区 | 并发丢改动 / 组失败后快照不可恢复 | §4.5 规则 13/14、§6.3（F5-04 / F5-05） |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（待 G7 登记）：

- **控制面工具（Control Plane Tool）**：主术语「控制面工具」，英文辅助 `control plane tool`；指通过 MCP 暴露的、用于执行运维管理动作的工具。禁止文案：「运维接口」（把 HTTP 形态与功能概念混为一谈）、「后台接口」、「管理 API」、「运维 API」。
- **运维操作（Ops Operation）**：主术语「运维操作」，英文辅助 `ops operation`；指一次控制面工具调用所承载的、可预览可提交的管理动作。禁止文案：「批量任务」（与既有异步批量任务语义混用）、「运维脚本」。
- **运维计划（Ops Plan）**：主术语「运维计划」，英文辅助 `ops plan`；指 preview 阶段产出的逐目标变更计划与摘要。禁止文案：「预览结果」（弱化其提交前效力）、「diff 预览」。
- **受管对象（Managed Object）**：主术语「受管对象」，英文辅助 `managed object`；指控制面操作可作用的管理对象（连接、Schema、表、角色、Agent 等）。禁止文案：「目标」（与既有「目标」语义混用）、「资源」。
- **控制面授权（Ops Grant）**：主术语「控制面授权」，英文辅助 `ops grant`；指 role 上显式声明的控制面工具与受管对象范围。禁止文案：「权限」（与既有访问治理「访问权限」混用）、「授权配置」。
- **委托人（Delegating Principal）**：主术语「委托人」，英文辅助 `delegating principal`；指控制面操作所代表的管理员主体。禁止文案：「授权人」（与既有「授权」审批语义混用）、「上级」。
- **原子组（Atomic Group）**：主术语「原子组」，英文辅助 `atomic group`；指共享同一物理文件因而不可部分回滚的一组目标。禁止文案：「批次」（与既有批量批次语义混用）、「事务组」。

保留既有术语：语义发布、启用表范围、行级策略、业务 Wiki 访问权限、业务 Skill、调用监控、访问日志、配置审计。

---

## 关联文档

- [运维控制面实施 Plan](../plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md)（L25-16 实施 Plan）
- [第 1 轮独立审阅报告](../reviews/2026-10-28-codex-review-lucy-ops-control-plane.md)（结论：退回修订）
- [第 2 轮审阅报告](../reviews/2026-10-28-codex-review-lucy-ops-control-plane-round2.md)（结论：需再修订）
- [第 3 轮审阅报告](../reviews/2026-10-28-codex-review-lucy-ops-control-plane-round3.md)（结论：需再修订）
- [第 4 轮审阅报告](../reviews/2026-10-28-codex-review-lucy-ops-control-plane-round4.md)（结论：需再修订）
- [第 5 轮审阅报告](../reviews/2026-10-28-codex-review-lucy-ops-control-plane-round5.md)（结论：不可交付开发；4 项阻塞已在本版修订）
- [Lucy v0.25 语义资产批量维护 Spec](lucy-20261020-v2p5-semantic-batch-operations-spec.md)（L25-11，能力提供方；当前审阅退回）
- [L25-11 独立审阅报告](../reviews/2026-10-27-codex-review-semantic-batch-operations-p0.md)（结论：退回）
- [v2p5 行权限管理 Spec](lucy-20261022-v2p5-row-permission-management-spec.md)
- [v2p5 审计增量 Spec](lucy-20261020-v2p5-audit-increment-spec.md)
- [产品术语标准](../../webui/docs/00-product-terminology-standard.md)
- [开发治理规则](../governance/DEVELOPMENT.md)
- [WebUI MCP 鉴权代理 Spec](../../webui/docs/07-mcp-auth-proxy-spec.md)
- [访问权限域档案](../access-control/README.md)
