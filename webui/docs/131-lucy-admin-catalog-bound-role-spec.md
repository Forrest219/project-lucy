# Lucy Admin Catalog-Bound Role Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Admin Catalog-Bound Role Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-02 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `lucy_admin` Spec 与实现计划；`docs/access-control/design-upgrade.md` ADR-AC-06/G9；`webui/docs/15-role-admin-spec.md`；`webui/docs/98-access-control-p0-runtime-spec.md`；`webui/docs/07-mcp-auth-proxy-spec.md` |
| 适用范围 | 预置运维数据面 Role `lucy_admin` 与 `allow.source_scope: catalog_bound` 编译语义、安全治理、Admin UI、验收 |
| 输出位置 | `webui/docs/131-lucy-admin-catalog-bound-role-spec.md` |
| 关联 WO | `webui/docs/plans/wo-202609-01-lucy-admin-catalog-bound.md` |
| 冲突裁决 | 与 design-upgrade 冲突 → design-upgrade（含 ADR-AC-07）；实现与本文冲突 → 本文 |

---

## Terminology Compliance

本功能遵循 `webui/docs/00-product-terminology-standard.md`。

| Canonical Term | UI 主术语 | 禁止混淆 |
|---|---|---|
| Lucy Admin Role | Lucy 运维数据面角色 | WebUI 所有者、登录管理员、超管（作本 Role 主称） |
| Catalog Bound Scope | 启用目录绑定 | `tables: ["*"]`、静默 prefix 扩权、全连接通配 |

Protected DOM：`lucy_admin`、`source_scope`、`catalog_bound`、Role ID、connection id、tool name。

---

## 1. 背景与目标

### 1.1 问题

AC-P0 将 Role 表授权钉在显式 `tableSelectors.names`（v2 禁 `prefix`），避免语义层变化静默扩权。实战中，平台运维需要在**已纳入的连接**内随 `enabled_tables` / source map 增长自动获得表访问权；否则每加一张启用表都要改 `access.yaml`，不符合运维习惯。

### 1.2 目标

1. 提供预置参考模板与推荐正式 Role id：`lucy_admin`。
2. 引入显式字段 `allow.source_scope: catalog_bound`：在**已声明** `allow.connections` 内，授权对象 = source map ∩ `enabled_tables`。
3. 同连接新启用表经策略重编译后进入能力集，且必须产生可观测 `policy_scope_expanded`。
4. 新 connection **不**自动进入；AbsoluteDeny 与 `tools: ["*"]` 仍拒绝。
5. 明确与 **WebUI Admin（控制面登录账户）** 正交，不得混称为同一「管理员」。

### 1.3 成功标准

| ID | 标准 |
|---|---|
| SC-01 | `lucy_admin` + `catalog_bound` + 非空 connections 可编译；Agent 可访问该连接下全部 enabled sources |
| SC-02 | 同连接新增 enabled 表并重编译后无需改 names；出现 `policy_scope_expanded` |
| SC-03 | 未写入 `allow.connections` 的新连接无 capability / 连接拒 |
| SC-04 | `tools: ["*"]` 或 AbsoluteDeny 工具 → 编译/保存失败 |
| SC-05 | UI/手册不把 `lucy_admin` 称为 WebUI 所有者或登录管理员 |
| SC-06 | 既有 `names` / v1 `prefix` Role 零回归 |

---

## 2. Non-Goals

- 裸 `connections: ["*"]` / `tables: ["*"]` / Role `tools: ["*"]`
- 登录 WebUI 即自动获得 MCP 全库 Token
- 绕过 AbsoluteDeny（`sl_*` / `sql_execution` / `memory_ingest*` 等）
- 恢复 v2 `prefix` 选择器
- Dynamic RLS / TokenScope 加权
- 客户生产 `access.yaml` **强制**预置 `lucy_admin` Agent
- `catalog_bound` 下的 `row_access: scoped`（AC-P0 恒 `all`）

---

## 3. 信息模型

### 3.1 YAML

```yaml
roles:
  lucy_admin:
    description: 平台运维数据面（非 WebUI 登录账户）
    permission_model_version: 2
    allow:
      connections:
        - demo-mysql
      source_scope: catalog_bound
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
        - kx_catalog
        - connection_list
        - wiki_search
        - wiki_read
        - entity_details
        - dictionary_search
        - discover_data
```

### 3.2 字段语义

| 字段 | 语义 |
|---|---|
| `allow.source_scope` | 缺省 / 省略 = 现行 `tableSelectors` 路径。唯一合法显式值：`catalog_bound` |
| `allow.connections` | `catalog_bound` 时**必填且非空**；新连接必须人工加入 |
| `allow.tableSelectors` | `catalog_bound` 时必须缺省或空数组；与 `catalog_bound` 并存 → 编译失败 |
| `allow.tools` | 显式工具名列表；禁止 `*`；不得含 AbsoluteDeny / 未分类工具 |
| `permission_model_version` | `catalog_bound` **要求**为 `2` |

### 3.3 预置交付

| 形态 | 行为 |
|---|---|
| Reference Role Template `lucy_admin` | 恒存在于 `role-templates.ts`；工具集 = 代码分类表并集 `DATA_PLANE_TOOLS ∪ META_TOOLS`（排除 AbsoluteDeny）；不直接写入客户 `access.yaml` |
| Demo / docker 项目模板 | 可种子化正式 Role `lucy_admin`（带 demo connection） |
| 客户包 | 默认不自动落盘；运维从参考模板「复制为正式 Role」并填 connections；**允许**以模板同名 id `lucy_admin` 提升为正式 yaml Role（仅禁止与已存在 yaml Role 撞名） |

模板展开时 `connections` 可为占位空列表；保存前必须填入至少一个合法 connection，否则 dryRun/保存失败。

---

## 4. 编译代数

### 4.1 输入

对 `source_scope: catalog_bound` 的 Role，Policy Compilation Input 在既有 `access.yaml` + source map 之外，**还读取** `ktx.yaml` 各 connection 的 `enabled_tables`（用于该 Role 的 source 过滤）。

`policyVersion` 输入为：

```text
policyVersion = sha256(
  accessConfigDigest
  || sourceMapVersion
  || toolClassificationVersion
  || enabledTablesDigest
)
```

其中 `enabledTablesDigest = sha256(规范化 connections → enabled_tables)`。仅改 `enabled_tables`（不改 semantic YAML / access.yaml）时，`commitEffectivePolicy` 必须使 `policyVersion` 变化。

### 4.2 SourcesGrantedBy(catalog_bound)

```text
SourcesGrantedBy(r) =
  { e ∈ SourceMap |
      e.connectionId ∈ r.allow.connections
      ∧ e.physicalTable ∈ EnabledTables(e.connectionId) }
```

- `EnabledTables(conn)` 来自 `ktx.yaml` `connections.<conn>.enabled_tables`（规范化后与 `physicalTable` 比较）。
- 匹配 0 个 source → `role_resolution_failed:<roleId>`（与 selector 0-hit 一致）。
- 每个 source 的 `rowGrant = { kind: "all" }`。
- Capability 合成仍为 `(r.allow.tools ∩ DataPlane) \ AbsoluteDeny × SourcesGrantedBy(r)`（Spec 98 §5），**禁止** tools×sources 笛卡尔在 Role 外再放大。

### 4.3 与 names / prefix 的关系

| 模式 | 授权意图落点 | 语义层新增表 |
|---|---|---|
| `names` | access.yaml 显式名单 | **不**扩权 |
| v1 `prefix` | access.yaml 前缀谓词 | 可扩权，须 `policy_scope_expanded` |
| `catalog_bound` | access.yaml 显式 `source_scope` + connections；对象解析靠 source map ∩ enabled_tables | 同连接可扩权，须 `policy_scope_expanded`；**新连接不扩权** |

`catalog_bound` **不是** `tables: ["*"]`，也**不是**恢复 v2 `prefix`。

### 4.4 扩权可观测性

重编译后，若某可扩权 Role（`catalog_bound` 或 v1 `prefix`）相对上次 committed runtime 的 **canonical source key 集合**出现新增 key，必须：

1. 在 EffectivePolicy **原子切换成功之后**写 `config_change_log`：`change_type=policy_scope_expanded`，`target_id=<roleId>`；
2. 服务端日志含 `policy_scope_expanded`。

比较对象是 source key **集合差**（不是仅计数）：同计数下替换高敏表也能检出扩权。

---

## 5. 安全治理

1. **AbsoluteDeny**：代码基线不可解除；`lucy_admin` 工具列表不得包含 AbsoluteDeny / 未分类工具；lint 与编译双重拒绝。
2. **高权限警示**：Role 详情、从模板创建、Agent 绑定到含 `catalog_bound` 或 id=`lucy_admin` 的 Role 时，UI 展示「高权限运维数据面」警示；文案不得写成 WebUI「所有者 / 登录管理员」。
3. **Token**：不建议为 `lucy_admin` 签发无过期长期 Token；创建 Token 流至少提示建议设置过期时间（不强制改 Token 数据模型）。
4. **客户高敏环境**：可不创建该正式 Role；参考模板仍只读可见。
5. **控制面 / 数据面分离**：WebUI Admin 鉴权（`admins.yaml`）不得自动映射为 MCP Agent `lucy_admin`。

---

## 6. Admin UI / API

- `GET /api/admin/roles` 合并返回模板 `lucy_admin`（`source=template`）。
- Role 编辑：`source_scope` 可选 `（默认：指定表名）` / `catalog_bound（启用目录绑定）`。
- 选 `catalog_bound` 时：隐藏或禁用 tableSelectors 编辑；保存 payload 不得带非空 `tableSelectors`。
- Preview / dryRun 必须展示当前匹配的 source 数量与列表摘要（复用 effective permissions）。
- `permission_model_version` 对新建含 `catalog_bound` 的 Role 强制为 `2`。

---

## 7. 手册与运维

`SYSTEM_HANDBOOK`「Agent 可见性与 ACL 同步」须说明：

- `names` Role：同连接新表仍要改 `tableSelectors`。
- `lucy_admin` / `catalog_bound`：同连接新表写入 `enabled_tables` 并完成语义层 + 策略重编译即可；**新连接仍必须**写入 `allow.connections`。

---

## 8. 验收映射

| SC | 测试锚点（实现 WO） |
|---|---|
| SC-01 | `kx-acl` / `admin-roles`：catalog_bound 命中 enabled sources |
| SC-02 | 策略重编译 + `policy_scope_expanded` |
| SC-03 | 第二连接未声明 → deny |
| SC-04 | lint + compile 拒绝 `*` / AbsoluteDeny |
| SC-05 | 术语 lint / Role UI 文案断言 |
| SC-06 | 既有 ACL 矩阵绿 |

---

## 9. 文档交叉引用

| 文档 | 补丁要点 |
|---|---|
| `design-upgrade.md` | ADR-AC-07；G9 脚注 |
| Spec 15 | `source_scope`、模板、UI 互斥与警示 |
| Spec 98 | catalog_bound 编译规则；enabled_tables 读取 |
| Spec 07 §5.1.3 | 旁注指向本文；禁止等同 `tables:["*"]` |
| 术语标准 | Lucy Admin Role / Catalog Bound Scope |
| SYSTEM_HANDBOOK | ACL 同步例外说明 |
