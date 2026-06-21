复核完成。以下为只读审核结论。

---

# 第二部分交付质量复核（commit ec5f561）

## 1. 总体结论

**达到可交付标准，无阻断项。** 第二部分（spec 漂移 lint + 当前 API/数据模型文档 + UAT/status/eval 安全契约对齐）在静态核验下自洽且与当前实现一致：

- `webui/docs/03-api-spec.md` / `04-data-model.md` 覆盖了 `webui/server/{index,admin,eval}` 实际注册的全部 REST 路由（含 `effective-permissions`、`/api/admin/roles`、eval runs/monitor 全量、connections 写路径），endpoint 总览与服务端 `git grep` 结果逐条对齐。
- `scripts/lint-spec.mjs` 五个检查（route-status / api-spec / skill-dependency / eval-schema-version / access-role-policy）对当前仓库状态按静态推演应为 PASS（+允许的 warning），与方案 §5 验收声明一致。
- 两个 eval 文件 `safety_contract` 结构一致，并与 `docs/eval-quiz-conventions.md` v1.4 约定 + `scripts/eval-runner.mjs` 实际消费字段（`forbidden_ast` / `forbid_secret_paths`）匹配，是可执行红线而非纯文案。
- `docs/webui-impl-status.md` 状态由"需安全整改/待对齐"改为"已实现"，与 role-first 写路径、proxy 实现现状一致；UAT 文档新增 §2A role-first 链路并明确将 legacy allow 链路降级为历史参考。

> 说明：受当前 don't-ask 模式限制，`node scripts/lint-spec.mjs` 与 `npm` 无法实际执行，结论基于 commit diff + `git grep` 源码静态核验，未经一次真实运行（见验证记录第 8 条限制）。

## 2. 阻断项

无。未发现阻断下一步开发或交付的缺口。

## 3. 非阻断改进（按优先级）

| 优先级 | 路径 | 问题 | 建议 |
|---|---|---|---|
| 中 | `scripts/lint-spec.mjs` `apiSpec()` (L78-82) | 扫描范围只含 `index.ts`/`admin`/`eval`，**不含 `webui/server/proxy/*`**。`/mcp`（安全关键）及未来 proxy 路由不被漂移检查覆盖——新增 proxy endpoint 不写 spec 也不会 fail（漏报盲区）。 | 将 `webui/server/proxy` 纳入 `apiSpec()` 的文件列表。 |
| 中 | `scripts/lint-spec.mjs` (L218-225) vs `inbox/spec-lint-plan-2026-06-21.md` 退出码表 | 方案声明 exit code `2` = 脚本自身异常；实现把 check 内异常 `catch` 成 `fail`→exit `1`，顶层无 exit2 路径，契约不一致。 | 实现 exit2 分支，或在方案中修订该退出码语义。 |
| 低 | `scripts/lint-spec.mjs` `apiSpec` 正则 (L84) | `(?:<[\s\S]*?>)?` 懒匹配遇含嵌套泛型 `>`（如 `Array<string>`）的注册会提前截断→该路由被静默跳过（漏报，不报错）。当前代码恰好无此写法，属潜在脆弱性。 | 改进路由提取或加注释约束注册写法。 |
| 低 | `scripts/lint-spec.mjs` `routeStatus` (L54-55) | `path="${routePath}"`（去前导斜杠）永远匹配不到实际 `path="/connections"`，当前实际仅靠 nav `to: "/route"` 命中；若删某 nav 项但保留 `<Route>` 会误报 fail，反之亦然。 | 直接解析 `<Route path=...>`，或同时匹配带斜杠形式。 |
| 低 | `evals/superstore/eval/superstore-eval-cases.yaml` (L5) | 已采用 v1.4 才有的 `safety_contract`，但 `runner_schema_version` 仍标 `v1.3`，"用新 schema 特性却声明旧版本号"轻微不自洽（当前作为允许 warning）。 | 与 runner 兼容性确认后升 v1.4，或在文件内注明保留 v1.3 的原因。 |
| 低 | `inbox/spec-lint-plan-2026-06-21.md` §4 | `scripts/lint-spec.config.json` / `allowApiSpecWarnings` / api-spec warning 白名单等均为纯文案，实现未落地（实现直接采用更严格的 fail 终态，反而更好）。 | 从方案删除或标注"未实现/已被更严格 fail 终态取代"，避免后续误解。 |
| 低 | `scripts/lint-spec.mjs` `accessRolePolicy` (L205-211) | 对"已启用、仅有 legacy `allow`、无 role"的用户（如 `zhangsan`，仍持有效 token）不产生任何提示，与 role-first 目标存在轻微张力。 | 对 enabled 且仅 `allow` 无 `role` 的用户输出 warning。 |

## 4. 验证记录

**只读读取的路径：**
- `scripts/lint-spec.mjs`（全文）
- `inbox/spec-lint-plan-2026-06-21.md`（全文）
- `webui/docs/03-api-spec.md`（全文）
- `webui/docs/04-data-model.md`（全文）
- `docs/uat-agent-permissions.md`（全文）
- `webui/config/access.yaml`（via `git show ec5f561:`）
- `evals/kx_financial/eval/kx_financial-eval-cases.yaml`（前 90 行 metadata + safety_contract）

**执行的只读命令（git/静态）：**
- `git log --oneline -5`、`git show --stat ec5f561`、`git diff --stat 33f9af6 ec5f561` — 确认 9 文件改动范围与基线对齐。
- `git diff 33f9af6 ec5f561 -- package.json webui/package.json` — 确认新增 `lint:spec` 脚本、`vitest --maxWorkers=1`。
- `git diff 33f9af6 ec5f561 -- docs/webui-impl-status.md evals/... inbox/...` — 确认状态表、eval safety_contract/paired_quiz、方案落地说明的具体改动。
- `git grep -nE 'app\.(get|post|...)'` over `index.ts`/`admin`/`eval` — 提取服务端 50 处注册，逐条比对 spec §2 endpoint 总览全部命中。
- `git grep` App.tsx 路由与 nav `to:` — 确认 routeStatus 8 条路由经 `to: "/route"` 形式命中（澄清 `path=` 去斜杠分支不生效）。
- `git ls-files evals/**-eval-cases.yaml` + `git grep runner_schema_version|safety_contract|paired_quiz` — 确认两文件均有 safety_contract/paired_quiz，kx=v1.4、superstore=v1.3。
- `git grep` `safety_contract`/`forbidden_ast`/`forbid_secret_paths` over `scripts/*.mjs` + `eval-quiz-conventions.md` — 确认 runner 实际消费且约定一致。

**核验限制：** `node scripts/lint-spec.mjs`、`npm run lint:spec`、`npm test`、`grep`/`cat` 等非 git 命令在当前 don't-ask 模式下被拒，未能实际运行 lint 取得真实退出码与输出。本结论基于源码与 diff 静态推演；建议交付前由有执行权限方跑一次 `npm run lint:spec` 确认 exit=0 且 warning 集合与方案 §5 一致，作为最终放行证据。
