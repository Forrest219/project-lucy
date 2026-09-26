# WebUI 管理 Skill 文件 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI 管理 Skill 文件 Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-09-24 |
| 撰写人 | Composer |
| 委托人 | xingchen |
| 基于材料 | Spec 144；PR #38（`655f36b`，`skills/answer-style`）；Demo `/skills` 空目录核查；批准任务 T1–T7 |
| 适用范围 | Demo 灌入仓库 Skill；WebUI 对项目 `skills/` 的新建、编辑、改状态、删除与保存前校验；Demo 角色 Skill 工具授权 |
| 输出位置 | `webui/docs/147-skill-file-management-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 147 |
| 关联工单 | `webui/docs/plans/wo-202609-24-skill-file-management.md` |
| 关联页面 | `/skills`（业务上下文 / 业务 Skill） |
| 上游 Spec | Spec 144（Agent 可见性仍权威）；Spec 131 Phase 4 切片 |
| 状态 | Implemented；安全加固见 Spec 151 |
| 日期 | 2026-09-24 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：Demo 灌入、WebUI 文件管理、Demo Token Skill 工具授权 |
| v1.1 | Spec 151 加固：身份不可变、原路径保存、并发版本、显式角色授权 |

## 1. 背景

Spec 144 交付了只读「业务 Skill」页与 Agent 已发布过滤。Demo 重建后 `/skills` 为空：`.dockerignore` 排除仓库 `skills/`，demo 模板无 `skills/`，entrypoint 无法播种。PR #38 已合并 `answer-style`，仍到不了运行卷。用户需要在 WebUI 看见并管理 Skill 文件。

## 2. 目标

1. Demo 构建把仓库 `skills/` 复制进 `examples/docker-demo/project-template/skills/`；entrypoint 只补缺失文件。
2. `/skills` 支持新建、编辑、改状态、删除；写入项目 `skills/`。
3. 保存前校验：无法解析或缺少合法 `name` 拒绝；已发布无 `eval_cases` 允许保存并展示校验未通过。
4. Demo 角色 `demo_readonly` 授权 `lucy_skill_read`、`lucy_skill_search`；已有卷幂等补丁。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| Eval 门禁、调用仪表盘、客户端导出 | Spec 131 / 132 / 134 |
| Role 页勾选 Skill | 仍用 frontmatter `roles_allowed` |
| `.cursor/skills/` 进入 Hub | 配置作者 Skills，非问答运行时 |
| 改发布工作台 | Skill 状态仍是 frontmatter |
| 客户镜像携带仓库 Skill | `.dockerignore` 与客户模板 `.gitkeep` 不变 |

## 4. 行为

### 4.1 Demo 灌入（T1）

- 作者源：仓库根 `skills/`。
- 构建前复制到 `examples/docker-demo/project-template/skills/`（不含 `.cursor/skills/`）。
- `sync_template_tree` 只补缺失文件，不覆盖卷内已改文件。
- 客户默认模板仍 `touch skills/.gitkeep`。

### 4.2 文件路径（T2–T5）

- 新建：`skills/<domain>/<name>.md`。
- `domain`、`name`：小写字母、数字、连字符、下划线；拒绝 `..`、绝对路径、写出 `skills/`。
- 编辑：`domain`、`name` 只读，始终写回原 `relativePath`；普通保存不得移动文件。
- 重命名：显式新建新 Skill，确认后删除旧 Skill，不提供隐式搬移。
- 更新、删除：携带 `expected_version`；过期返回 `409 skill_write_conflict`。
- 删除：确认后删除入口文件。

### 4.3 校验（T6）

- 保存前 `parseSkillMarkdown` + `validateSkill`。
- 解析失败或无合法 `name`：HTTP 400，不写盘。
- 已发布且无 `eval_cases`：写盘成功，响应带 `validation.valid === false`。

### 4.4 状态与 Agent

- 状态字段仍是 frontmatter `status`。
- Agent 可见性沿用 Spec 144 `canAccessSkill`。
- 授权事实源、同角色闭合与通道能力沿用 Spec 151；新建默认无人可见。

### 4.5 Demo 工具（T7）

- 模板 `demo_readonly.allow.tools` 增加 `lucy_skill_read`、`lucy_skill_search`。
- 平滑升级：entrypoint 对已有 `/data/lucy/webui/config/access.yaml` 幂等补丁（已有则不重复）。

## 5. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md` §3 与 §4.10。

新增 UI 动作：新建 Skill、保存 Skill、删除 Skill。禁止「技能」「技巧」「Scale」。

## 6. 静态验收

| ID | 断言 |
|---|---|
| SC-147-01 | 复制步骤在临时目录生成 `skills/answer-style/SKILL.md`；`.dockerignore` 仍含 `skills/`；客户 `Dockerfile` 仍 `.gitkeep` |
| SC-147-02 | 缺 `name` 或 domain/name 含 `..` 时创建拒绝；合法创建写入 `skills/<domain>/<name>.md` |
| SC-147-03 | 更新写回原文件；`domain` / `name` 不一致返回 `skill_identity_immutable`，不得搬移 |
| SC-147-04 | 删除后 GET 404；loader 不再返回该 URI |
| SC-147-05 | `published` 且角色匹配时 `canAccessSkill` 放行；`draft` → `skill_not_published`；`deprecated` → `skill_deprecated` |
| SC-147-06 | 已发布无 `eval_cases` 保存成功且 `validation.valid === false`；损坏 frontmatter 保存失败 |
| SC-147-07 | demo 模板与幂等补丁后 YAML 含两工具且各一次 |
| SC-147-08 | `cd webui && npm run lint:terminology`；Skill 管理相关 vitest 通过 |

浏览器与 Demo 重建验收不在静态门禁内。
