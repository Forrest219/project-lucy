# Role 权限配置：MCP 工具 / 表范围批量选择 UX 优化

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role 权限配置批量选择 UX 优化 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-25 |
| 撰写人 | Cursor Composer |
| 委托人 | xingchen |
| 基于材料 | 浏览器实测 `http://127.0.0.1:55176/admin/roles/new`；`webui/src/pages/admin/RoleDetail.tsx`；既有批量选择参考 `webui/src/pages/connections/TableWhitelist.tsx`；术语 `webui/docs/00-product-terminology-standard.md` |
| 适用范围 | 仅规划「允许的 MCP 工具」「可访问的表范围」选择交互优化；确认后再进入编码 |
| 输出位置 | `docs/plans/2026-08-25-role-permission-bulk-select-ux.md` |

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 Role 新建/编辑的「权限配置」中，让「允许的 MCP 工具」与「可访问的表范围 → 指定表名」支持全选/取消全选，并在候选 >10 时可用搜索快速定位，避免逐条滚动勾选。

**Architecture:** 保持现有 checkbox 清单 + `TagInput` 回退结构；在清单上方补齐与「启用表范围」一致的批量工具条与本地过滤。优先抽一个小组件复用于工具与表，避免两处逻辑分叉。不改 ACL / `access.yaml` 语义。

**Tech Stack:** React、Vitest + Testing Library、既有 `pl-btn` / `pl-input` 样式。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

| 概念 | UI 主术语 | 英文辅助 | 禁止文案 |
|---|---|---|---|
| Role MCP Tool Allow-list | 允许的 MCP 工具 | allowed MCP tools | Tools（裸露） |
| Role Table Selector | 可访问的表范围 | table scope | Table Selectors（裸露） |
| Bulk select all | 全选 | select all | Select All（无中文） |
| Bulk clear selection | 取消全选 | clear selection | Deselect All（无中文）、清空（过宽） |
| Filter candidates | 筛选 | filter | Search（无中文主标签） |

说明：启用表范围页现用「全选 / 反选」。本需求明确要「取消全选」（清空当前可选候选上的勾选），与「反选」语义不同；本期采用用户要求的「全选 / 取消全选」，不引入「反选」，以免两套批量语义并存。

---

## 1. 浏览器验证结论（2026-08-25）

实测路径：`/admin/roles/new` → Tab「权限配置」。

### 1.1 允许的 MCP 工具

| 观察项 | 实测结果 |
|---|---|
| 控件形态 | 固定高度滚动 checkbox 清单（`max-h-56` ≈ 224px），非多选下拉 |
| 候选数量 | **20** 个工具（可勾选 14，全局禁止禁用 6） |
| 可视窗口 | `clientHeight≈222` / `scrollHeight≈860`，约可见 4–5 项，其余须滚动 |
| 批量按钮 | **无**「全选 / 取消全选 / 反选」 |
| 搜索/筛选 | **无** |
| 辅入口 | 下方 `TagInput`（「输入工具名后回车」） |

### 1.2 可访问的表范围

| 观察项 | 实测结果 |
|---|---|
| 前置交互 | 「+ 添加表范围」后：连接 / Schema 为原生 `<select>`；模式为「指定表名」checkbox 清单 |
| `demo-mysql` / `dataforai` | 3 张表 |
| `aliyun` / `chatbi` | **8** 张表；清单 `max-h-40` ≈ 160px，略溢出需滚动 |
| 批量按钮 | 仅有「+ 添加表范围」「删除」；**无**全选/取消全选 |
| 搜索/筛选 | **无** |
| 辅入口 | `TagInput` + 高级「按前缀匹配」 |

### 1.3 与用户表述的对齐

用户说的「下拉菜单」在实测中对应两类控件：

1. **表范围**里的连接 / Schema 原生下拉（单选，非痛点核心）。
2. **工具 / 表名**的窄高滚动 checkbox 面板——体感像「挤在小下拉里逐个点」，超过约 10 项后成本陡增。

问题成立：**缺批量操作 + 缺过滤 + 可视高度过小**。MCP 工具侧（20 项）已可稳定复现；表侧在当前 demo 数据下为 3/8 张，但控件形态相同，候选一旦变多会同样卡。

---

## 2. 问题根因（代码）

主文件：`webui/src/pages/admin/RoleDetail.tsx`

- 工具清单：约 L876–913，`mcpTools.map` → checkbox，无 toolbar。
- 表名清单：约 L1112–1138，`tableCandidates.map` → checkbox，无 toolbar。
- 既有可复用参考：`webui/src/pages/connections/TableWhitelist.tsx` 的 `whitelist-batch-actions`（全选/反选 + 已选计数）。

新建与编辑共用 `RoleDetail`，改一处两边生效。

---

## 3. 推荐方案（最小、对齐现网）

### 3.1 交互（工具与「指定表名」一致）

每个候选 checkbox 清单上方增加工具条：

1. **已选摘要**：`已选 {n}/{m}`（`m` = 当前可勾选候选数；工具侧排除 `globalDenied`）。
2. **全选**：勾选当前过滤结果中全部可勾选项。
3. **取消全选**：取消当前过滤结果中全部可勾选项的勾选（不清掉过滤框；不删除清单外已选手动 Tag）。
4. **筛选框**（候选数 ≥ 10 时显示，或始终显示以降低分支）：按 name / description（工具）或表名（表）本地过滤。

行为细则：

- 「全选」**不得**勾选 `globalDenied` 工具。
- 过滤后全选/取消全选只作用于**当前可见候选**（与启用表范围「可见行」语义一致，避免误伤未展示项）。
- 过滤清空后恢复完整清单；已选状态保留。
- 只读模板 Role：批量按钮与 checkbox 同为 disabled。
- 保留 `TagInput` 与「按前缀匹配」；不删除高级能力。

### 3.2 UI 结构（示意）

```text
允许的 MCP 工具
[ 已选 0/14 ]  [全选] [取消全选]
[ 筛选工具名…                    ]
┌ 可滚动 checkbox 清单 (可略增高 max-h) ┐
│ ☐ lucy_query …                      │
└─────────────────────────────────────┘
TagInput（手动补名）
```

表范围「指定表名」同构，`data-testid` 区分：

- `role-tools-batch-actions` / `role-tools-filter`
- `role-table-names-batch-actions-{n}` / `role-table-names-filter-{n}`

### 3.3 实现偏好

优先抽出小组件，例如：

`webui/src/components/CheckboxCandidatePicker.tsx`

Props 大致：`items: {id,label,description?,disabled?}[]`、`value: string[]`、`onChange`、`filterThreshold?: number`、`ariaLabel`、`testIdPrefix`。

`RoleDetail` 两处接入，避免复制粘贴。

### 3.4 Non-Goals

- 不改连接 / Schema 的原生 `<select>`。
- 不引入真正的 multi-select dropdown / popover 库（成本高，且与现有 checkbox 清单不一致）。
- 不改「按前缀匹配」为默认；不改 ACL 校验（仍禁止 `*`、须至少一工具等）。
- 本期不做「反选」，除非评审后要求与启用表范围完全对齐。

---

## 4. 实施任务

### Task 1: 失败测试 — 工具批量操作

**Files:**

- Modify: `webui/src/__tests__/role-detail.test.tsx`

**Step 1: 写失败测试**

覆盖：

- 权限配置 Tab 可见「全选」「取消全选」。
- 点「全选」后所有非 `globalDenied` 工具勾选；denied 仍未勾选且 disabled。
- 点「取消全选」后可勾选工具全部取消。
- 筛选输入后清单缩小；全选只影响过滤结果。

**Step 2: 跑测确认失败**

```bash
cd webui && npm test -- role-detail
```

Expected: FAIL（尚无按钮）。

### Task 2: 抽出 `CheckboxCandidatePicker` 并接到 MCP 工具

**Files:**

- Create: `webui/src/components/CheckboxCandidatePicker.tsx`
- Modify: `webui/src/pages/admin/RoleDetail.tsx`（`role-tools-field`）
- Test: `webui/src/__tests__/role-detail.test.tsx`（及可选小组件单测）

**Step 1: 最小实现**

工具条 + 可选 filter + 原 checkbox 列表；`max-h` 可调至约 `max-h-72`（仍可滚动，但少滚一点）。

**Step 2: 跑测**

```bash
cd webui && npm test -- role-detail
```

Expected: 工具相关断言 PASS。

### Task 3: 表名清单接入同一组件

**Files:**

- Modify: `webui/src/pages/admin/RoleDetail.tsx`（`role.kind === "names"` 分支）
- Modify: `webui/src/__tests__/role-detail.test.tsx`

**Step 1: 写失败测试**

- 添加表范围并有 `tableCandidates` 时出现批量按钮。
- 全选 / 取消全选更新 `names`。
- 筛选表名后批量只作用于可见项。

**Step 2: 接入组件并跑通**

```bash
cd webui && npm test -- role-detail
```

Expected: PASS。

### Task 4: 术语与回归

**Files:**

- 若 UI 新术语未登记：轻量补 `webui/docs/00-product-terminology-standard.md`（全选 / 取消全选 / 筛选）——仅当标准中完全缺失时。
- 浏览器手测：`/admin/roles/new` 与任一既有 Role 编辑页。

**验收清单**

- [ ] MCP 工具：可一键全选可勾选项、一键取消全选
- [ ] 表名：同上
- [ ] 候选 ≥10 时可筛选（工具侧实测 20，必现）
- [ ] 全局禁止工具不可被全选勾上
- [ ] 只读模板无批量写入
- [ ] `npm test -- role-detail` 通过
- [ ] 无业务代码外的无关重构

---

## 5. 建议优先级

| 优先级 | 项 | 理由 |
|---|---|---|
| P0 | 全选 / 取消全选（工具 + 表） | 直接对应投诉，改动小 |
| P0 | 工具侧筛选 | 20 项已证实滚动成本 |
| P1 | 表侧筛选（≥10 时显示） | 当前 demo 仅 8 张，但形态需就绪 |
| P2 | 略增高 `max-h` | 锦上添花，不替代批量/筛选 |

---

## 6. 成功标准（可验证）

1. 在 `/admin/roles/new` 权限配置中，MCP 工具区存在「全选」「取消全选」，且全选后可勾选数 = 非全局禁止数。
2. 添加表范围并选出 Schema 后，指定表名区同样具备批量按钮，行为正确。
3. 工具筛选「lucy」后清单仅含 `lucy_*`；此时全选不会勾选未展示项。
4. 单元测试覆盖上述行为；本计划落地前**不做代码修改**（本文件仅为 plan）。
