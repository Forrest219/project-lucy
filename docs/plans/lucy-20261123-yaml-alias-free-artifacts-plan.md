# YAML 产物禁 alias 治理 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v0.1 |
| 日期 / 功能编号 | 2026-11-23 / P1-76／REQ-030-097 |
| 状态 | S1｜v0.1 草案。已登记，终稿未确权，开发未授权；待评审。 |
| 授权边界 | 当前起草与登记。实现（统一写出口、调用点替换、静态门禁）需待 Spec 终稿确权并获得开发授权后执行。 |
| 验收 | 功能验收见 [Spec](../specs/lucy-20261123-yaml-alias-free-artifacts-spec.md) SC-01–SC-05；测试台 not_registered，验收由单测、静态门禁与一次真实 KTX 对照验证承载。 |
| 关联 | [Spec](../specs/lucy-20261123-yaml-alias-free-artifacts-spec.md) · [总账 P1-76](lucy-20261107-lucy-0-30-feature-inventory-pool.md) |

## 目标

消除「YAML 序列化别名超 KTX 读取上限（`maxAliasCount=100`）导致拒读」的整类风险：写入侧统一防别名出口、存量调用点替换、静态门禁防回归。根因实证见 Spec §1。

## 开工前置

1. Spec 终稿确权（Codex CLI 终审或委托人明示）。
2. 开发授权（本 Plan 获批）。
3. 存量基线：对约定树（`config/semantic-layer/`、`customer-config/`、`examples/`、`webui/config/`、根 `*.yaml`）扫描 anchor／alias 语法，确认基线为 0 命中并留档（SC-03 的对照基线）。

## 实施阶段

### 阶段 0 · 基线与清单冻结

- 跑存量 alias 扫描，记录 0 命中基线（脚本产物落 inbox 或 reviews）。
- 冻结写盘点清单（grep 复核，实施时以当时 HEAD 为准）：

| 文件 | 行号（2026-11-23 HEAD） | 用途 |
|---|---|---|
| `webui/server/project.ts` | 2571／3311／3489 | 探针连接写、access.yaml 迁移写 |
| `webui/server/admin/access-config.ts` | 307 | access.yaml 应用写 |
| `webui/server/admin/access-roles-agent-concurrent-edit.ts` | 189／201 | 并发编辑提案序列化 |
| `webui/server/admin/agents.ts` | 335／1232 | Agent 创建／提案写 |
| `webui/server/admin/tokens.ts` | 513／631／831 | Token 生命周期写 |
| `webui/server/admin/roles.ts` | 1254 | Role 提案写 |
| `webui/server/auth/admins-store.ts` | 373 | 管理员状态写 |
| `webui/server/catalog-reload.ts` | import 处 | 语义层写（stringifyYaml） |

### 阶段 1 · 统一写出口（SC-01）

- 新增 `webui/server/yaml-safe.ts`：导出 `stringifySafe(value, options?)`，内部 `stringify(value, { ...options, aliasDuplicateObjects: false })`；`lineWidth: 0` 等既有选项由调用方透传。
- 单测：构造含共享引用的嵌套对象（>100 处复用），断言输出无 `&`/`*` 语法；默认 `parse` 读回语义相等。

### 阶段 2 · 调用点替换与回归（SC-02）

- 阶段 0 清单全部改为 `stringifySafe`；保留每处既有选项。
- 回归：`webui` 既有单测套件全绿（重点：access-config／agents／tokens／roles 的 dryRun／确认写／版本冲突用例）；再跑 `npm run lint:spec-docs` 与相关 root contract 测试。
- 真实冒烟：demo 栈上经 Admin API 做一次 Role dryRun＋确认写，读回 `access.yaml` 确认无 alias、策略编译正常（`policy_degraded` 日志为零）。

### 阶段 3 · 静态门禁（SC-03）

- 新增门禁脚本（建议 `scripts/lint/yaml-alias-gate.mjs`，或作为 `lint:spec-docs` 新规则）：扫描约定树静态 YAML，正则锚 `^\s*-?\s*&[A-Za-z0-9_-]+` 与 `^\s*-?\s*\*[A-Za-z0-9_-]+`（排除注释与字符串值需用简易状态机或逐文件 `parse`＋别名计数）；命中即 FAIL 并打印文件与行号。
- 存量基线 0 误报验证；样例注入验证判 FAIL；挂 `package.json` 脚本与 PR CI 候选入口（接 CI 另按治理确认）。

### 阶段 4 · 真实对照与登记（SC-04／SC-05）

- 在 demo 容器（KTX 0.16.0）复跑 Spec §1 实验：`>100` 别名 manifest `ktx status` 拒识对照组、`aliasDuplicateObjects: false` 版本读取实验组；记录输出。
- 登记：总账／REQ／`docs/README.md`／`docs/plans/README.md` 镜像同句更新；造数三件套（`seed-scale-access.mjs`／`seed-scale-wiki-skills.mjs`／`seed-scale-audit-rows.mjs`）在阶段 0 清单旁声明：字符串模板生成、无别名风险，不在替换范围。

## 回滚

- 阶段 1–2 为纯重构（序列化选项加固），回滚＝还原 diff；无数据迁移。
- 阶段 3 门禁先以「警告模式」跑一个窗口再转硬门禁，若存量出现命中，先修存量再转硬。

## 不做

不改 KTX 源码；不放宽读取侧 `maxAliasCount`；不引入 merge key；不覆盖 markdown-frontmatter（gray-matter）与 JSON（Spec §5 边界）。

## 完成定义

- SC-01–SC-05 全部通过，证据齐备：统一出口单测、调用点替换回归跑次、静态门禁跑次（含 0 误报基线与注入判 FAIL）、真实 KTX 对照验证记录。
- Spec／Plan／总账／REQ／两处索引镜像状态同句更新到实现后阶段。
- 存量与新增 YAML 产物在门禁下 0 anchor／alias；demo 栈 Admin 写路径冒烟无 `policy_degraded`。
- 本条收口不表示可上线；不接发布取证。
