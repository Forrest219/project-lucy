# project-lucy Spec 审计整改计划

| 项 | 内容 |
|---|---|
| 文档类型 | 正式整改计划 |
| 生成日期 | 2026-06-21 |
| 基于材料 | `inbox/spec-audit-2026-06-21.md` |
| 适用范围 | project-lucy spec / WebUI / semantic-layer / skills / eval / access governance 整改 |
| 原则 | 先关安全写路径，再同步事实源，再补长期治理规范 |

## 1. 整改目标

本轮整改目标不是继续新增零散设计文档，而是建立可维护的事实源闭环：

1. 关闭会造成越权或配置漂移的写入路径风险。
2. 让当前实现状态、API、数据模型、domain 资产有唯一可查事实源。
3. 用自动化检查防止 spec、代码、skills、eval 资产再次漂移。
4. 在事实源稳定后，再补 semantic-layer / wiki / skills 的作者规范。

本计划采纳 Claude Code Opus 二次审阅意见：访问治理 admin 写入路径可重新创建全权 Agent，应按 P0 安全风险处理，优先级高于纯文档同步。

## 2. P0：立即整改

### P0-1 关闭 Admin 写入路径的过度授权

问题：

- 当前 `webui/server/admin/agents.ts` 新建 / patch Agent 仍以 legacy `allow` 为主。
- `webui/src/lib/types.ts` 的 `CreateAgentBody` / `AgentPatch` 允许 `tables/tools = ["*"]`。
- 这会通过 WebUI/API 重新签发全权 Agent，与 `design-agent-permissions.md v1.2` 的 role-first 模型冲突。

整改动作：

1. 后端 `POST /api/admin/agents` 改为强制 `role`，不再接受新建 `allow`。
2. 后端 `PATCH /api/admin/agents/:userId` 只允许 `name`、`note`、`enabled`、`role`，拒绝修改 legacy `allow`。
3. 对历史 `users[].allow` 仅只读展示；若同时存在 `role` 和 `allow`，UI 显示迁移告警。
4. 禁止通过 admin API 写入 `tables:["*"]` 或 `tools:["*"]`；历史配置仅兼容读取。
5. 前端 `AgentList` / `AgentDetail` / `NewToken` 改为展示 role、effective permissions、permission snapshot，而不是主编辑 allow。

验收标准：

- 新建 Agent 只能选择已有 role，例如 `kx_readonly`。
- `git diff webui/config/access.yaml` 中新用户只有 `role`，不新增 `allow`。
- 通过 API 传入 `allow` 或 `["*"]` 返回 400。
- legacy `lisi` 可读但不可通过 UI 复制成新全权 Agent。
- 相关测试覆盖 `POST`、`PATCH`、UI 显示和拒绝路径。

建议测试：

- `webui/server/__tests__/admin-agents.test.ts`
- `webui/src/__tests__/agent-detail.test.tsx`
- 新增 role-first 创建/拒绝 wildcard 的后端测试。

### P0-2 配置写入补审计与输入校验

问题：

- `PUT /api/connections/:connId/enabled-tables` 直接写 `ktx.yaml`，缺 dryRun/diff、输入校验和审计记录。
- `webui/config/access.yaml` 写入也需要更清晰的审计策略，特别是 role/token/enable 变更。

整改动作：

1. `PUT /api/connections/:connId/enabled-tables` 支持 `dryRun`，默认 dryRun。
2. enabled table 输入必须符合 `schema.table` 或当前项目约定格式；拒绝空字符串、路径字符、重复项。
3. 写入前返回 old/new diff；前端保存前必须展示确认。
4. 写入成功后记录 config audit，至少包含 actor、本地 session、文件、字段、old count、new count、timestamp。
5. Access governance 写入也记录同类 config audit；token 明文永不入日志。

验收标准：

- 白名单保存前能看到 diff。
- 非法 enabled table 被 400 拒绝。
- `.ktx/secrets`、`raw-sources`、`.git` 仍不可读写。
- 可查询最近配置变更记录，至少本地文件存在或 audit SQLite 有表。

建议落点：

- `webui/server/index.ts`
- `webui/server/project.ts`
- `webui/server/fs-safe.ts`
- `webui/server/admin/audit.ts` 或新增 `webui/server/admin/config-audit.ts`
- `webui/src/pages/connections/TableWhitelist.tsx`

### P0-3 更新当前状态事实源

问题：

- `docs/webui-impl-status.md`、`docs/project-overview.md`、`docs/webui-feature-map.md` 与代码和资产状态冲突。

整改动作：

1. 更新 `docs/webui-impl-status.md`：
   - 数据库接入标为已实现或部分实现，列真实 API。
   - Eval/Admin 后端 API 不再写 `—`。
   - Review API 修正为 `/api/diff`。
   - 增加测试文件列和最后验证日期列。
2. 更新 `docs/project-overview.md`：
   - 纳入 KX 财务域。
   - 修正 skills 目录结构。
   - 修正 eval/quiz 数量与路径。
   - 将 M0-M5 表述调整为历史主线，而非全部当前范围。
3. 将 `docs/webui-feature-map.md` 标记为历史缺口分析，或重写为当前缺口分析。

验收标准：

- 状态表中每个当前导航模块都有前端、后端、测试、状态。
- 新同事只读 `project-overview` 与 `webui-impl-status` 不会得到过期目录或错误模块状态。
- 不再出现数据库接入“待开发”但代码已实现的矛盾。

### P0-4 补全当前 API / Model 索引

问题：

- `webui/docs/03-api-spec.md` 和 `04-data-model.md` 仍主要覆盖 M0-M5，缺 connections、eval、admin、proxy。

整改动作：

1. 扩展 `webui/docs/03-api-spec.md`，登记当前所有 API：
   - `/api/connections*`
   - `/api/eval/*`
   - `/api/admin/*`
   - `/mcp` proxy 行为索引
2. 扩展 `webui/docs/04-data-model.md`，补 Connection、EvalDomain、EvalCase、EvalRun、MonitorConfig、Agent、Role、Audit、PermissionSnapshot。
3. 明确哪些端点是已实现、哪些是 planned/deprecated。

验收标准：

- `server/index.ts` 注册的路由在 API spec 中可查。
- `webui/src/lib/types.ts` 关键类型在 data-model spec 中可查。
- 已废弃 legacy allow 写法在 model spec 中标 deprecated。

## 3. P1：建立防漂移机制

### P1-1 新增一致性检查脚本

整改动作：

1. 新增脚本检查 `App.tsx` 路由与 `docs/webui-impl-status.md` 模块条目是否一致。
2. 检查 `server/index.ts` / route 注册与 `webui/docs/03-api-spec.md` 是否一致。
3. 检查 `skills/**/SKILL.md` dependencies 路径是否存在。
4. 检查 eval YAML `runner_schema_version` 是否与 `docs/eval-quiz-conventions.md` 兼容。
5. 检查 `webui/config/access.yaml` 是否存在 role 解析错误、selector 匹配 0 source、全局 deny 被 role allow。

验收标准：

- 本地命令可运行并输出清晰错误。
- CI 或 `npm test` 可选择性接入。
- 当前已知问题能被脚本捕获：reviewer dependency 路径、状态表漂移、eval schema 版本漂移。

建议命令：

```bash
npm run lint:spec
```

### P1-2 给旧 Review / UAT 文档增加修复状态

整改动作：

1. 更新 `docs/review-module1-agent-permissions.md`，标注已修、未修、被 v1.2 设计取代的项。
2. 更新 `docs/review-module2-eval-monitoring.md`，标注 coverage 模式、runner status、domain endpoint 等已修项。
3. 更新 UAT 文档，明确哪些是技术自检通过、哪些待人工验收。

验收标准：

- 旧 review 不再误导 Builder 处理已修复问题。
- 未修项迁移到整改计划或 issue 列表。

### P1-3 修复明显内容错误

整改动作：

1. 修复 `skills/reviewer/SKILL.md` 中 canonical table 正反例相同的问题。
2. 修复 `skills/reviewer/SKILL.md` dependency 路径，指向 `skills/domains/superstore/pitfalls.md` 或调整为相对真实路径。
3. 修复 `webui/config/access.yaml` 顶部“明文 token”过期注释。
4. 统一报告/正式文档中的路径引用，使用 `webui/src/lib/types.ts` 而非模糊 `types.ts`。

验收标准：

- skill dependency 检查通过。
- access.yaml 注释与实际 hash token 策略一致。

## 4. P2：补齐治理规范

P2 只在 P0/P1 完成后推进，避免在事实源仍漂移时继续制造新文档。

### P2-1 语义层 Source 质量规范

建议落点：`docs/semantic-layer-source-spec.md`

内容范围：

- 每个 source 的必填字段：owner、grain、qualified table、freshness、default segment、wiki_refs、eval_refs。
- measures / segments / joins 的质量标准。
- overlay / manifest 修改边界。
- validate 与 reindex 要求。

### P2-2 Wiki 作者规范

建议落点：`docs/wiki-authoring-spec.md`

内容范围：

- frontmatter 必填字段。
- `sl_refs` / `refs` / `tags` 规范。
- wiki 与 CLAUDE.md / skills references 的边界。
- stale 判定与 review 流程。

### P2-3 Skills 作者规范与 Skill 管理设计

建议落点：

- `docs/skills-authoring-spec.md`
- `docs/design-skill-management.md`

内容范围：

- `SKILL.md` frontmatter 必填字段。
- dependencies 路径校验。
- eval_coverage / last_pass_rate 维护方式。
- WebUI Skill 管理最小范围：索引、只读预览、dependency lint、diff 编辑、eval coverage 展示。

### P2-4 Domain Index

建议落点：`docs/domain-index.md`

内容范围：

- 每个 domain 的 semantic sources。
- 对应 wiki、skills、eval、quiz。
- owner、状态、最近 validate/reindex、最近 eval run。

## 5. 推荐执行顺序

| 顺序 | 工作项 | 优先级 | 依赖 |
|---:|---|---|---|
| 1 | Admin 写入路径强制 role，拒绝 wildcard allow | P0 | 无 |
| 2 | enabled-tables / config 写入补 dryRun、校验、审计 | P0 | 无 |
| 3 | 更新状态事实源和项目总览 | P0 | 1-2 可并行 |
| 4 | 扩展 API / Model 索引 | P0 | 1-3 |
| 5 | 新增 spec 一致性检查脚本 | P1 | 3-4 |
| 6 | 旧 review/UAT 增加修复状态 | P1 | 3 |
| 7 | 修复 skill dependency、access 注释、reviewer 文案 | P1 | 可并行 |
| 8 | 补 semantic-layer/wiki/skills/domain 规范 | P2 | 5 后推进 |

## 6. 完成定义

本轮整改完成必须满足：

1. 不能通过 WebUI/Admin API 创建全权 Agent。
2. `ktx.yaml` 白名单写入有校验、预览和审计。
3. `docs/webui-impl-status.md` 与当前导航/API/测试状态一致。
4. `docs/project-overview.md` 反映 KX 与 superstore 当前真实资产。
5. 当前 API 与数据模型有统一索引。
6. spec 一致性检查脚本能捕获至少 3 类已知漂移。
7. 旧 review 文档不再把已修问题当作未修阻塞项。

## 7. 风险提示

- 访问治理涉及安全边界，改动后必须跑 proxy ACL、admin agents、audit 相关测试。
- `ktx.yaml` 写入属于治理类变更，修改实现前应按 `docs/DEVELOPMENT.md` 的计划流程执行。
- 不要在整改中修改 `.ktx/secrets/` 或读取 secret 内容。
- 不要把开发治理规则复制进 `CLAUDE.md`；运行时上下文与开发规则继续分离。

---

## 8. 2026-06-21 执行状态更新

已按 thinker 建议拆包执行：

| 工作项 | 状态 | 产物 |
|---|---|---|
| 低风险状态/文案修复 | 已执行 | `docs/webui-impl-status.md`、`docs/project-overview.md`、review/UAT 状态更新、`skills/reviewer/SKILL.md`、`webui/config/access.yaml` |
| P0 安全写路径契约 | 已补齐 builder 前置契约，尚未改代码 | `inbox/security-write-path-builder-contract-2026-06-21.md` |
| `lint:spec` 防漂移 | 已补齐 builder 前置方案，尚未实现脚本 | `inbox/spec-lint-plan-2026-06-21.md` |

安全写路径包在 `security-write-path-builder-contract` 落地前不应直接交 builder 修改代码；当前可交付 builder 的是低风险状态/文案修复包。
