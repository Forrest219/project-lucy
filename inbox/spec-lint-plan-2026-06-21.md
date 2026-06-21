# `lint:spec` 防漂移检查方案

| 项 | 内容 |
|---|---|
| 文档类型 | Builder 前置方案 |
| 生成日期 | 2026-06-21 |
| 目标命令 | `npm run lint:spec` |
| 状态 | 已实现首版脚本；不阻塞 P0 安全写路径 |

## 1. 目标

`lint:spec` 用来捕获 project-lucy 中最容易反复出现的事实源漂移：

- WebUI 路由已实现但状态表仍写待开发。
- API 已注册但 API spec 未登记。
- Skill dependency 指向不存在路径。
- Eval YAML schema version 与约定不兼容。
- access role selector / wildcard 配置违反安全规则。

## 2. 命令与退出码

建议命令：

```bash
npm run lint:spec
```

建议脚本：

```text
scripts/lint-spec.mjs
```

2026-06-21 已落地：

- 根目录 `package.json` 增加 `npm run lint:spec`。
- 首版脚本路径为 `scripts/lint-spec.mjs`。
- 当前策略：FAIL 退出码为 1；脚本自身异常退出码为 2；WARN 只提示不阻断。
- 当前允许保留的 warning：superstore eval `runner_schema_version: v1.3`、enabled legacy allow user `zhangsan`、disabled legacy wildcard user `lisi`。
- 2026-06-21 复核后增强：`api-spec` 扫描范围已包含 `webui/server/proxy/*`；`route-status` 同时解析 `<Route path>` 和 nav `to:`；`access-role-policy` 对 enabled legacy allow user 输出 warning。

退出码：

| Exit code | 含义 |
|---:|---|
| 0 | 全部通过 |
| 1 | 发现 spec drift 或配置错误 |
| 2 | lint 脚本自身异常，如文件不可读、解析器错误 |

输出格式：

```text
[spec-lint] FAIL route-status
  docs/webui-impl-status.md: database connection marked 待开发 but /connections route exists

[spec-lint] FAIL skill-dependency
  skills/example-broken/SKILL.md: dependency ../missing/reference.md not found

[spec-lint] PASS eval-schema-version
```

## 3. 检查项

### 3.1 route-status

输入：

- `webui/src/app/App.tsx`
- `docs/webui-impl-status.md`

检查：

- 从 `App.tsx` 提取固定导航路由和 `<Route path=...>`。
- 从 `webui-impl-status.md` 提取模块行。
- 若路由存在但状态为 `⬜ 待开发`，失败。
- 若状态为 `✅ 已实现` 但前端文件不存在，失败。

首批必须覆盖：

- `/connections`
- `/connections/whitelist`
- `/connections/test`
- `/eval/cases`
- `/eval/runs`
- `/eval/monitor`
- `/admin/agents`
- `/admin/audit`

### 3.2 api-spec

输入：

- `webui/server/index.ts`
- `webui/server/admin/*.ts`
- `webui/server/eval/*.ts`
- `webui/docs/03-api-spec.md`

检查：

- 提取 `app.get/post/put/patch/delete` 路由字符串。
- 检查是否在 `webui/docs/03-api-spec.md` 或后续 current API index 中出现。
- P0 阶段允许生成 warning，不阻断；当 API index 补全后改为 fail。

首批 warning 白名单：

- `/api/admin/*`
- `/api/eval/*`
- `/api/connections/*`

这些是当前已知缺口，直到 API spec 补齐前输出 warning。

### 3.3 skill-dependency

输入：

- `skills/**/SKILL.md`

检查：

- 解析 YAML frontmatter。
- 对 `dependencies:` 每个相对路径，按 SKILL.md 所在目录解析。
- 文件不存在则 fail。
- `dependencies` 为空不失败，但 warning。

### 3.4 eval-schema-version

输入：

- `docs/eval-quiz-conventions.md`
- `evals/*/eval/*-eval-cases.yaml`

检查：

- 读取 conventions 当前版本。
- 读取 eval YAML 的 `metadata.runner_schema_version`。
- 若版本低于 conventions 声明的当前 schema，warning 或 fail 由配置决定。

首批规则：

- `runner_schema_version: v1.3` 输出 warning。
- 缺失 `safety_contract` 输出 fail。
- 缺失 `metadata.paired_quiz` 或等价配对信息输出 warning。

### 3.5 access-role-policy

输入：

- `webui/config/access.yaml`
- `semantic-layer/**/*.yaml`

检查：

- `roles.*.allow.tools` 不得包含 `*`。
- role 引用的 tool 不得命中 `defaults.deny_tools`。
- 含 `tableSelectors` 或 table-touching tools 的 role 必须有非空 `allow.connections`。
- 每个 selector 必须匹配至少一个 semantic-layer source。
- `users[].role` 必须引用存在的 role。
- `users[]` 同时有 `role` 和 `allow` 输出 warning，后续 role-first 完成后改 fail。
- enabled user 若 legacy `allow.tables/tools` 含 `*` 输出 fail。
- disabled legacy wildcard user 输出 warning，提示不得通过 PATCH 直接启用。

## 4. 配置

建议可选配置：

```json
{
  "apiSpecPath": "webui/docs/03-api-spec.md",
  "statusPath": "docs/webui-impl-status.md",
  "evalSchemaMode": "warn",
  "allowApiSpecWarnings": true
}
```

配置落点：

```text
scripts/lint-spec.config.json
```

## 5. 首批验收

实现首版 `lint:spec` 后，必须能捕获或报告以下已知历史问题：

1. `docs/webui-impl-status.md` 将已实现的 `/connections` 标为待开发。
2. skill dependency 指向不存在路径时输出 fail；`skills/reviewer/SKILL.md` 的历史错误路径已修复，当前应输出 pass。
3. `evals/superstore/eval/superstore-eval-cases.yaml` 使用较旧 runner schema。
4. `webui/config/access.yaml` 中 disabled legacy wildcard user `lisi` 只能 warning，不能被静默视为安全。
5. `webui/docs/03-api-spec.md` 缺 `/api/eval/*` 或 `/api/admin/*` 时输出 api-spec warning。

2026-06-21 验收状态：

- route-status：PASS。
- api-spec：PASS，当前 40 个已注册 REST routes 已登记。
- skill-dependency：PASS。
- eval-schema-version：PASS + warning，superstore v1.3 仍提示 schema version older than v1.4；已补 `safety_contract`。
- access-role-policy：PASS + warning，`zhangsan` 仍是 enabled legacy allow user，disabled legacy wildcard `lisi` 仍提示不得无 role 启用。

## 6. 非目标

- 不做 Markdown 全文语义理解。
- 不要求一次性补齐所有 API spec。
- 不连接数据库。
- 不读取 `.ktx/secrets/`。
- 不修改任何文件，只做检查。
