# Thinker 审阅：Spec 审计与整改计划是否可交付 Builder

| 项 | 内容 |
|---|---|
| 文档类型 | Thinker 审阅意见 |
| 生成日期 | 2026-06-21 |
| 审阅方式 | Claude Code `opus` + 临时 thinker agent |
| 审阅对象 | `inbox/spec-audit-2026-06-21.md`、`inbox/spec-remediation-plan-2026-06-21.md` |
| 工具限制 | 只读核对，未修改被审阅文件 |

## 1. 总体判定：有条件可交付

整改计划结构清晰、排序合理，且两个最高优先级安全前提均与代码一致、属实：

- P0-1 前提属实：`webui/server/admin/agents.ts` 的 `YamlUser` 只有 `allow`，没有 `role` 字段；`POST` / `PATCH` 直接接受 `allow.tables/tools` 且无拒绝 `["*"]` 的校验；`access.yaml` 中被禁用的 `lisi` 正是 `allow:{tables:["*"],tools:["*"]}` 模板。
- P0-2 前提属实：`webui/server/index.ts` 的 `PUT /api/connections/:connId/enabled-tables` 直接 `safeWrite(ktx.yaml)`，无 dryRun、无 diff、无审计，输入仅 `Array.isArray(enabledTables) ? : []`，零格式校验。

但 P0-1 与 P0-2 这两个最高风险项尚未达到“builder 可无歧义执行”的标准：它们缺少新增 API 契约、数据模型迁移语义、输入校验语义，以及一个会导致 `access.yaml` 数据丢失的回写风险说明。文档同步类和文案修复类现在可交付；安全类必须先补齐再交付。

## 2. 已达标项

- **P0-3 状态事实源更新**：目标文件明确，audit 已逐条列出过期字符串，builder 可照单执行。
- **P1-3 内容错误修复**：`skills/reviewer/SKILL.md` 正反例/依赖路径、`access.yaml` 过期注释，均为定点小改。
- **P1-2 旧 review/UAT 加修复状态**：范围与目标文件清楚。
- **P2 全部**：明确声明 P0/P1 完成后再做，定位正确，可后置。
- **整体排序与 DoD**：依赖关系基本正确，大部分可验证。

## 3. 反对意见

### 3.1 阻塞：P0-1 的 role 基础设施契约缺失

计划要求“新建强制 role / UI 展示 effective permissions / permission snapshot”，但缺可执行契约：

- 缺“列出可选 role”的 API。`access.yaml` 的 `roles.kx_readonly` 只被运行时 `acl.ts` 读取；admin 侧 `YamlAccessConfig` 没有 `roles` 字段。
- 缺“effectivePermissions / snapshot”的 admin API。相关函数存在于 `webui/server/proxy/acl.ts`，但以 `Identity` 为入参，仅在 proxy 链路使用；admin 路由没有 effective-permissions / roles 端点。

阻塞原因：builder 无法确定性构建创建表单，要么重复实现 role 解析，要么自创端点。

证据路径：

- `webui/server/admin/agents.ts`
- `webui/server/proxy/acl.ts`
- `webui/config/access.yaml`

### 3.2 阻塞：P0-1 会触发 `access.yaml` 回写数据丢失风险

`writeAccessYaml` 当前靠 `{...config}` 把 `parse()` 出来的 `roles:`、`defaults:` 块顺带保留下来。一旦 builder 按计划改造类型与写入逻辑，容易在 typed 重建时静默丢掉整个 `roles:` 段，直接破坏运行时 ACL。

计划缺少“写入必须无损保留 `roles` / `defaults`”的要求或验收。

### 3.3 阻塞：legacy allow 的迁移语义未定义

计划说“同时存在 role 和 allow 时显示迁移告警”，但 `acl.ts` 的解析是 role 优先，有 role 即忽略 allow。

未定义的问题：

- 给老用户加 role 后是否剥离 `allow`？
- 是否允许 `role + allow` 并存落盘？
- 如果并存，运行时是否告警？

阻塞原因：builder 不知道写成什么样算“对”，`git diff` 验收也无法判定。

### 3.4 阻塞：PATCH 仍可重新启用 legacy 全权 Agent

当前 DoD 只说“不能通过 WebUI/Admin API 创建全权 Agent”，但 `PATCH` 仍可能把 `lisi` 这种 `allow:{*,*}` 用户重新 `enabled:true`。

整改计划必须明确：

- 拒绝启用 effective 为 legacy 通配的 Agent；或
- 强制其先迁移到 role。

否则写路径越权风险没有真正关闭。

### 3.5 阻塞：P0-2 审计表 schema 与 actor 身份未定义

计划要求审计包含 `actor / 本地 session`，但 WebUI/admin API 是本地无鉴权接口，没有可用 actor 身份来源；新表 schema、是否复用 `admin/audit.ts` 的 `getAuditDb` 也未定义。

阻塞原因：验收“audit SQLite 有表”不可测。

### 3.6 阻塞：P0-2 enabled-table 校验语义未定

“符合 `schema.table` 或当前项目约定格式”过于含糊。

必须决定：

- 只做字符串正则校验；还是
- 必须与已扫描的 `_schema/*.yaml` 实际存在表交叉校验。

接受未知表与拒绝未知表是行为级决策，builder 必须先有明确答案。

### 3.7 接近阻塞：dryRun 默认值变更未作为原子项

现有 `PUT enabled-tables` 无 dryRun，前端 `TableWhitelist.tsx` 期望直接落盘。改为“默认 dryRun”会打断当前保存流程。

计划应把“后端默认 dryRun + 前端两段式 diff/confirm 保存”写成同一验收项。

### 3.8 应修：运行时 fail-closed 未纳入前置验证

计划默认 runtime ACL 正确，只改 admin。但审计报告已经指出“proxy fail-closed 行为未验证”。

在 admin 强制 role 前，应先确认 `acl.ts` / `mcp-proxy.ts` 的 role 解析链确实 fail-closed，并把它写入验收。

### 3.9 轻微：文档类验收不可机检

P0-3/P0-4 的验收较主观。建议把 audit 中列出的具体过期字符串绑定为 builder checklist，作为唯一判据。

## 4. 必须补齐后才能交付的修改清单

针对 P0-1 / P0-2：

1. 定义 P0-1 的 API 契约：
   - `GET /api/admin/roles`，或在 agents 响应内联可选 role 列表。
   - 暴露 effectivePermissions/snapshot 的端点。
   - 明确复用 `acl.ts` 的 role 解析能力，不重写一套。
   - `POST/PATCH` 的新请求体：`role` 必填，不再接受 `allow`。
   - `allow` 或 `["*"]` 的错误码与 400 行为。
2. 明确 admin 类型扩展与无损回写约束：
   - admin 侧 `YamlUser` 加 `role`。
   - `YamlAccessConfig` 加 `roles`。
   - 验收增加 `git diff` 不得删除/改写 `roles:` 与 `defaults:`。
3. 定义 legacy allow 迁移语义：
   - 加 role 时是否剥离 allow。
   - 是否拒绝 role+allow 并存落盘。
   - 给出唯一答案与 diff 验收。
4. 补全安全 DoD：
   - PATCH 不得启用 effective 为 legacy 通配的 Agent，或要求其先迁移。
   - 增加对应拒绝测试。
5. 定义 P0-2 审计契约：
   - 表名、字段 DDL。
   - 是否复用 `getAuditDb`。
   - 本地无鉴权下 actor 的取值规则。
   - token 明文禁入日志。
6. 定义 P0-2 校验语义：
   - enabled-table 是否必须存在于已扫描 `_schema`。
   - 明确拒绝空串、路径字符、重复、未知表等规则。
7. 把 dryRun 契约变更做成原子项：
   - 后端默认 dryRun。
   - 前端两段式保存。
   - 同一验收覆盖，避免保存功能回归。
8. 增加前置验证项：
   - 改 admin 前，核对 `acl.ts` role 解析 fail-closed 是否符合 `design-agent-permissions.md v1.2`。

## 5. 可后置建议

- **P1-1 一致性脚本**：目标清楚，但缺输出格式、退出码、静态解析方法。它本身需要小 spec，可后置。
- **P2 全部治理规范**：保持主题清单即可，不进入本次 builder 交付。
- **P0-4 API/Model 索引时序**：应在 P0-1/P0-2 的新端点定稿后再写，否则追移动目标。
- **路径精确化**：把 `types.ts` 统一写成 `webui/src/lib/types.ts`。

## 6. 最小补救版本

建议拆成两个 builder 包：

### 6.1 立即可交付包

范围：

- P0-3 状态文档更新。
- P1-2 旧 review/UAT 加状态。
- P1-3 reviewer 文案/依赖、access.yaml 注释、路径统一。

这些无 API/安全契约依赖，现在就能交付 builder。

### 6.2 暂缓包

范围：

- P0-1 Admin 写入路径安全。
- P0-2 `ktx.yaml` / config 写入 dryRun、校验、审计。

补齐第 4 节的 8 项契约前，不建议让 builder 动 `agents.ts`、`acl.ts`、`index.ts` 写路径，否则容易产生三个具体回归：

1. 静默丢 `roles:` 段。
2. `PATCH` 重新启用 `lisi`。
3. dryRun 默认值改变导致前端保存功能回归。
