# 新建角色默认业务问答与工具勾选速查 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.1** |
| 日期 / 目标版本 | 2026-11-04 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P1**（访问治理 · 角色工具默认能力） |
| 状态 | **v0.1 功能合同已收口（2026-11-04）**。SC-01–SC-12 全部关闭，证据见 [`docs/reviews/2026-11-04-role-create-business-qa-defaults-closure.md`](../reviews/2026-11-04-role-create-business-qa-defaults-closure.md)。**本条收口不表示可上线**——浏览器 E2E、Docker 重建、客户交付不在本条出口 |
| 决策来源 | 2026-11-04 产品确认：新建角色默认应为「业务问答」（查数 + Wiki / Skill 通道），纯「只读查询」无法发挥 Lucy 价值；帮助内角色×工具矩阵列名「建模配置」本轮保留 |
| 需求来源 | `/admin/roles/new?tab=tools` 默认与「自定义 MCP 工具」分类观感；帮助需给出可扫读的职责矩阵 |
| 实施主体 | WebUI 角色草稿默认值、工具预设按钮与匹配文案、术语标准、`docs/SYSTEM_HANDBOOK.md` 帮助章节与 FAQ；不改 ACL 编译器、不改既有角色 YAML |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | **取代** [新建角色默认只读问答工具 Spec](lucy-20261030-role-create-readonly-defaults-spec.md) 中「默认工具集合 = `READONLY_QA_PRESET`」与对应引导 / 预设匹配文案。**沿用**该 Spec 已收口的：dirty 基线与空权限审阅基线分离、空可授予工具就地阻断、编辑 / 复制不自动补齐、候选失败不丢草稿。通道工具授权仍按角色显式列举（`CONTEXT_TOOL_NAMES` / `acl.ts` `CONTEXT_TOOLS`）；本条不重开 Spec 170 的「隐式始终可用」争议 |
| 实施计划 | [`docs/plans/lucy-20261104-role-create-business-qa-defaults-plan.md`](../plans/lucy-20261104-role-create-business-qa-defaults-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：新建角色默认预选「业务问答」工具全集（查数只读问答 + Wiki / Skill 通道）；帮助提供角色×工具勾选速查矩阵；管理员可一键切回「只读问答」窄集。
- 本条出口：SC-01–SC-12（组件 / 纯函数 / 帮助契约测试）。
- 不在本条出口：浏览器 E2E、移动窄屏、Docker 重建、客户环境、存量角色回填、运行时隐式授予 Wiki / Skill、控制面 `lucy_ops_*` 授权模型变更。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| Business QA Preset | 业务问答 | 业务问答预设 | 只读问答 + 知识库（作本按钮主术语）、查数+Wiki（作主按钮名） | 预设 = `READONLY_QA_PRESET` ∪ `CONTEXT_TOOL_NAMES`；新建角色默认；不含 `sl_validate` / `lucy_ops_*` |
| Role Tool Grant Matrix | 角色工具勾选速查 | 工具×角色矩阵 | MCP 权限矩阵（作帮助 H4 主标题） | 帮助 H4；深链 `role-tool-grant-matrix` |
| Modeling Config Role | 建模配置 | 语义建模（允许同义说明） | 数据建模、DBA（作本列主术语） | 矩阵列：含 `sl_validate` 的语义配置职责；**不是**数据库物理建模 |

沿用：「只读问答」（`READONLY_QA_PRESET` 窄集）、允许的 MCP 工具、可访问的表、角色。  
Forbidden：把「业务问答」写成隐式免勾选 Wiki / Skill；把 `lucy_ops_*` 并进业务问答默认；用「建模配置」表示运维控制面。

实施时把上表写入术语标准 Role 术语区，并修正「新建角色默认预选只读问答」旧句。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 预设仍用次级按钮（`pl-btn--secondary`），不以主按钮表达选中态
- [x] 工具 ID 与 `MCP` 继续 `notranslate` / `translate="no"`
- [x] 不新增一级 Tab / 向导；帮助矩阵落在既有访问治理章节
- [x] 空工具页内 `role="alert"` 阻断行为沿用既有 Spec

### Exceptions (If Any)

- None.

### Follow-up Needed

- None.

---

## 1. 问题与证据

1. 新建角色默认只有查数工具（`READONLY_QA_PRESET`），不含 Wiki / Skill。管理员若不再进工具页，业务 Agent 无法按口径与 SOP 发挥 Lucy 价值。
2. 「自定义 MCP 工具」分组把查数、知识、运维混在同一折叠区；缺一份按**职责**勾选的帮助矩阵。
3. 2026-11-04 产品确认：默认应为「业务问答」；矩阵列「建模配置」本轮保留。

## 2. 目标与范围

### 2.1 目标

- 新建 Role：默认工具 = **业务问答**全集。
- 工具页：主预设「业务问答」；保留「只读问答」作为收窄一键。
- 帮助：角色工具勾选速查矩阵与 FAQ 与上述默认一致。

### 2.2 本次范围

1. 新增常量 `BUSINESS_QA_PRESET`（或等价命名）：`READONLY_QA_PRESET` ∪ `CONTEXT_TOOL_NAMES`；**唯一事实源**在 `webui/src/lib/rolePermissionDraft.ts`；新建草稿只复制该常量，禁止另抄名单。
2. `matchingPresetName`：集合精确等于业务问答 →「业务问答」；精确等于只读问答 →「只读问答」；否则 `null`。**不再**把「只读问答 + 任意通道子集」显示为「当前与只读问答一致」。
3. `RoleToolGrants`：预设按钮「业务问答」（戳印业务问答全集）与「只读问答」（戳印窄集）；全选行为不变。
4. 基本信息引导、空工具提示改为指向「业务问答」。
5. `SYSTEM_HANDBOOK`「角色工具勾选速查」与 FAQ：新建默认 = 业务问答列；矩阵列含只读查询 / 业务问答 / 建模配置 / 运维控制。
6. 回归：编辑 / 复制不自动补齐；空工具阻断；dirty / 审阅基线分离沿用。

### 2.3 边界

- 不改 API、YAML schema、ACL 编译、`allow.ops`。
- 不回填存量角色。
- 不默认选表 / 连接 / 行策略。
- 不把 `sl_validate`、探索辅助工具、`lucy_ops_*` 纳入业务问答默认。
- 不实现 Spec 170「通道隐式始终可用」；通道仍须角色显式列举（本默认即显式写入草稿）。

## 3. 默认能力与矩阵契约

### 3.1 业务问答默认集合

唯一事实源：`BUSINESS_QA_PRESET` = `READONLY_QA_PRESET` ∪ `CONTEXT_TOOL_NAMES`。不写死工具个数。

| 组成部分 | 常量 | 说明 |
|---|---|---|
| 查数只读问答 | `READONLY_QA_PRESET` | catalog / read / query / explain / freshness / begin / continue |
| 知识通道 | `CONTEXT_TOOL_NAMES` | `wiki_search`、`wiki_read`、`lucy_skill_search`、`lucy_skill_read` |

不含：`sl_validate`、`entity_details`、探索辅助、`lucy_ops_*`、AbsoluteDeny 工具。

「默认业务问答」只表示工具预选，**不承诺**未配表即可查数；表范围与行策略仍按原契约。

### 3.2 帮助矩阵（角色工具勾选速查）

帮助 H4 标题：**角色工具勾选速查**；深链 `/help?section=role-tool-grant-matrix`（已在 `SECTION_ID_CONTRACT` 登记则保持）。

图例：`●` 建议开 · `○` 按需 · `—` 不要开。

列职责（本轮冻结命名）：

| 列 | 含义 |
|---|---|
| 只读查询 | 仅查数；页面「只读问答」戳印 |
| 业务问答 | 查数 + Wiki；有已发布 Skill 时含 Skill；**新建默认** |
| 建模配置 | 语义配置职责；建议含 `sl_validate` |
| 运维控制 | 仅 `lucy_ops_*`；不得与查询角色默认混绑 |

矩阵行与「怎么用」短说明须与实现预设一致；探索辅助工具可收为脚注，不要求默认勾选。

### 3.3 文案

| 位置 | 文案 |
|---|---|
| 基本信息引导 | 已默认启用业务问答工具，请选择可访问的表；如需调整工具，可前往「允许的 MCP 工具」。 |
| 空工具阻断 | 请至少选择一个 MCP 工具。常规场景可选择「业务问答」。 |
| 预设一致 | 当前与业务问答一致 / 当前与只读问答一致 |

## 4. 核心流程（伪代码）

```text
# 常量（rolePermissionDraft.ts）
READONLY_QA_PRESET = [...查数只读问答工具]
CONTEXT_TOOL_NAMES = [wiki_search, wiki_read, lucy_skill_search, lucy_skill_read]
BUSINESS_QA_PRESET = READONLY_QA_PRESET ∪ CONTEXT_TOOL_NAMES

matchingPresetName(tools):
  set = unique(tools)
  if set == set(BUSINESS_QA_PRESET): return "业务问答"
  if set == set(READONLY_QA_PRESET): return "只读问答"
  return null

进入新建或放弃修改 (mode == create):
  pristine.tools = copy(BUSINESS_QA_PRESET)
  baseline = copy(pristine)          # dirty 基线
  draft = copy(pristine)
  # 审阅 impact 基线仍为空权限草稿（沿用 20261030 Spec）

戳印「业务问答」: draft.tools = copy(BUSINESS_QA_PRESET)
戳印「只读问答」: draft.tools = copy(READONLY_QA_PRESET)

保存:
  既有首因校验…
  if grantable(tools).length == 0:
    定位工具 Tab；页内 alert；零写请求；return
  dryRun → Drawer → 确认；payload.tools == draft.tools（不补回已取消项）

编辑 / 复制:
  不自动写入 BUSINESS_QA_PRESET
```

## 5. 验收标准

以 Vitest + Testing Library / jsdom 与帮助契约测试为主；不要求浏览器。

**2026-11-04 实施记录**：S1–S3 已按 Plan 落地。证据见 [收口记录](../reviews/2026-11-04-role-create-business-qa-defaults-closure.md)。

| ID | 标准 | 状态 | 证据 |
|---|---|---|---|
| SC-01 | `BUSINESS_QA_PRESET` 等于 `READONLY_QA_PRESET` ∪ `CONTEXT_TOOL_NAMES`，且不含 `sl_validate` / `lucy_ops_*` | 通过 | `role-permission-draft.test.ts` |
| SC-02 | 新建页默认工具芯片集合 = `BUSINESS_QA_PRESET`；初始无脏栏；连接 / 表为 0 | 通过 | `role-detail.test.tsx` RD-01 |
| SC-03 | 工具页显示「当前与业务问答一致」；基本信息引导含「业务问答」 | 通过 | RD-01 / RD-10 |
| SC-04 | 无需再点预设即可 dryRun；Drawer「新增 MCP 工具」含业务问答全集 | 通过 | RD-02 |
| SC-05 | 点「只读问答」后集合 = `READONLY_QA_PRESET`，显示「当前与只读问答一致」；`sl_validate` 不在集合中 | 通过 | `role-tool-grants.test.tsx` |
| SC-06 | 点「业务问答」戳印替换（非并集）；含四通道工具；不含 `sl_validate` | 通过 | `role-tool-grants.test.tsx` |
| SC-07 | `matchingPresetName`：仅业务问答全集 → 业务问答；仅只读全集 → 只读问答；只读+部分通道 → `null` | 通过 | `role-permission-draft.test.ts` |
| SC-08 | 取消任一默认工具后保存不补回；放弃修改恢复业务问答全集 | 通过 | RD-03 / RD-04 |
| SC-09 | 清空可授予工具后保存就地阻断；提示指向「业务问答」 | 通过 | RD-05 |
| SC-10 | 编辑 / 复制既有窄工具角色不自动补齐业务问答全集 | 通过 | RD-07 |
| SC-11 | 帮助手册含「角色工具勾选速查」、深链 id `role-tool-grant-matrix`，且正文写明新建默认 = 业务问答 | 通过 | `help.test.ts` |
| SC-12 | 术语标准含「业务问答」「角色工具勾选速查」「建模配置」；禁用旧「新建默认只读问答」作现值 | 通过 | `00-product-terminology-standard.md` |

未执行：浏览器 / Playwright / 窄屏、镜像、部署、客户交付、真实实例写入——不在本条出口。

## 6. 非目标

- 不改变 AbsoluteDeny 与控制面 `allow.ops` 裁决
- 不新增「建模配置」「运维控制」一键预设按钮（本轮仅帮助矩阵列；预设按钮只有业务问答 / 只读问答 / 全选）
- 不把帮助矩阵做成可交互权限模板系统
- 不修改 Spec 150 Tab 信息架构以外的导航

## 7. 风险与回退

| 风险 | 缓解 |
|---|---|
| 默认多勾 4 个通道工具，审阅摘要变长 | Drawer 仍逐项列出；文案说明通道不扩表权 |
| 与 Spec 170「通道隐式可用」文档漂移 | 本条显式：仍须列入角色；默认写入即满足列举 |
| 旧测试锁死「只读问答」默认 | Plan 任务统一改引用 `BUSINESS_QA_PRESET` |

回退：前端恢复新建复制 `READONLY_QA_PRESET` 并还原文案即可。已保存角色不随回退删工具。

## 8. 落盘清单自检

| # | 要求 | 本条 |
|---|---|---|
| 1 | Spec 路径与编号 | `docs/specs/lucy-20261104-role-create-business-qa-defaults-spec.md` |
| 2 | 核心流程（伪代码） | §4 |
| 3 | 元数据含文档类型 / 版本 / 状态 | 头部表 |
| 4 | Plan 五类小节 | 同编号 Plan 已落盘 |
| 5 | Terminology Compliance 形状 | 本节含 `This feature follows` 与 `New terms:` |
| 6 | Design System Compliance 四段式 | 本节 |
| 7 | 登记 `docs/README.md` | 同次改动 |
| 8 | 新命令 / CI | 无 |
| 9 | 功能编号 | 无 |
| 10 | 机器门禁 | 落盘后执行 |
| 11 | 闭口层级 | 文首 |
| 12 | 无裸写作废状态句 | 已自查 |
