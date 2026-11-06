# Role 目录绑定连接卡呈现 Implementation Plan

> **For agentic workers:** 实施前确认用户已授权改 `webui/src`。推荐 `superpowers:subagent-driven-development` 或 `executing-plans` 按任务推进。步骤用 checkbox 跟踪。

**Goal:** 把「启用目录绑定」从页底高级设置挪到连接卡上的「跟随此连接的启用表」，保持整角色 `names`／`catalog_bound` 二选一语义。

**Architecture:** 只改 `RoleTableGrants` 呈现与确认状态机；草稿形状继续用 `rolePermissionDraft` 的 `scope.mode`。不改 Proxy ACL 编译。Spec 150／131 仅加呈现指针。

**Tech Stack:** React、TypeScript、Vitest、React Testing Library、既有 `pl-*` 样式。

## Global Constraints

- 不改 Spec 131 编译代数；不引入连接级混用或 Schema 级跟随。
- 不恢复 prefix UI；不改 dryRun／保存主干。
- 术语：概念名「启用目录绑定」；控件名「跟随此连接的启用表」。
- 本 Plan 收口不表示可上线；浏览器／镜像／部署不在授权内除非用户另授。
- 提交／推送仅在用户明确要求时执行。

---

| 元数据 | 内容 |
|---|---|
| 文档版本／日期 | **v0.2**／2026-11-04 |
| 目标版本／优先级 | 不绑定产品版本号／**P2**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261104-role-catalog-bound-connection-card-ux-spec.md`](../specs/lucy-20261104-role-catalog-bound-connection-card-ux-spec.md)（**v0.2 功能合同已收口**） |
| 权威语义 | Spec 131（catalog_bound 编译）；Spec 150（三编辑面／保存）。本 Plan **不改**其授权代数 |
| 状态 | **v0.2 功能合同已收口（2026-11-04）**。S0–S3 已落地；SC-01–SC-12 关闭。实施记录见 [`docs/reviews/2026-11-04-role-catalog-bound-connection-card-ux-implementation-notes.md`](../reviews/2026-11-04-role-catalog-bound-connection-card-ux-implementation-notes.md)。本条收口不表示可上线 |
| 授权边界 | 已授权：落盘文档、改 `webui/src` 呈现与相关测试、selector-contract、收口登记。**未授权**：`git commit`／`git push`、浏览器正式走查、手册长文、镜像与部署 |
| 验收 | 主 Spec §8 SC-01–SC-12；证据见实施记录 |
| 实施主体 | Lucy WebUI `webui/src` |
| 待拍板 | **已关闭**（D1–D8） |

---

## 1. 目标

1. 连接卡承载跟随开关；移除高级设置中的目录绑定入口。
2. 进入／退出跟随确认清空明确表与行级策略（语义 A）。
3. `lucy_admin`／`grantAllConnections` 全连接特例不变。
4. SC-01–SC-12 可被自动化打假。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.1 落盘且 D1–D8 冻结 | **满足**（2026-11-04） |
| P2 | 用户明确授权改 `webui/src` | **满足**（2026-11-04「批准继续收口」） |
| P3 | 基线测试可跑：`role-table-grants.test.tsx`、`role-detail.test.tsx` | 开工时确认 |

## 3. 文件落点

### 3.1 预计修改

| 路径 | 改动 | 阶段 |
|---|---|---|
| `webui/src/components/RoleTableGrants.tsx` | 连接卡＋跟随开关；移除高级设置目录绑定；确认文案按 Spec | S1–S2 |
| `webui/src/__tests__/role-table-grants.test.tsx` | SC-01–SC-07 等 | S1–S2 |
| `webui/src/__tests__/role-detail.test.tsx` | 摘要、保存校验、行级策略禁用、旧「启用目录绑定」断言迁移 | S2–S3 |
| `webui/src/components/RoleRowPolicyPanel.tsx` | 禁用说明指向「关闭跟随／指定表」（若仍写「关闭启用目录绑定」则对齐） | S3 |
| `webui/src/pages/admin/RoleDetail.tsx` | 仅当校验／摘要文案硬编码依赖旧控件时微调 | S3 |
| `docs/qa/selector-contract.md` | 新 test id；`table-grants-advanced` 改注或删除 | S3 |
| `webui/docs/150-role-permission-configuration-structure-spec.md` | §5.1 入口句指向主 Spec | 文档（可与落盘同批） |
| `webui/docs/131-lucy-admin-catalog-bound-role-spec.md` | §6 呈现注记指向主 Spec | 文档（可与落盘同批） |

### 3.2 不改

- `webui/server/proxy/acl.ts` 与 catalog_bound 编译路径。
- `rolePermissionDraft` 的 `catalog_bound`／`names` 序列化形状（除非发现与 Spec 冲突的 bug，另开）。
- SYSTEM_HANDBOOK／帮助中心长文。
- Agent 高权限警示文案（已有独立 Spec）。

### 3.3 建议 test id（实施可微调，须登 selector-contract）

| test id | 用途 |
|---|---|
| `table-grants-connection-card-<connectionId>` | 单连接卡容器 |
| `table-grants-follow-enabled-<connectionId>` | 「跟随此连接的启用表」开关 |
| `table-grants-scope-confirm` | 进入／退出确认 alertdialog（可复用现有 aria-label 区） |
| `catalog-bound-scope-note` | 保留页级说明 |
| `table-grants-tree` | 仅 `names` 态 |
| `table-grants-manual-connections` | 可废弃或改为卡列表容器；若废弃须改测试与 selector-contract |

---

## 4. 分阶段实施

### S0 文档指针（可与 Spec 落盘同批，无需 P2）

1. Spec 150 §5.1：将「位于高级设置」改为「入口呈现以 [`lucy-20261104-role-catalog-bound-connection-card-ux-spec`](../specs/lucy-20261104-role-catalog-bound-connection-card-ux-spec.md) 为准；语义仍为 catalog_bound」。
2. Spec 131 §6：注记 Admin UI 可见入口以本主 Spec 为准。

**出口：** 指针写入；无代码。

### S1 连接卡指定表态＋跟随入口（需 P2）

1. 先写失败测试：高级设置内「启用目录绑定」不再存在；连接卡上有「跟随此连接的启用表」。
2. 重构 `RoleTableGrants`：`names` 态按连接渲染卡；卡头含跟随开关；卡内保留表树。
3. 点击跟随 → 确认对话框（Spec 文案）；取消／确认行为按伪代码。

**出口：** SC-01–SC-04。

### S2 跟随态连接纳入／退出

1. `catalog_bound` 态：无表树；卡上开关改 connections；零连接退出确认。
2. `grantAllConnections` 特例。
3. 更新 `role-table-grants`／相关 e2e 若锁死旧文案（e2e 不在本条强制出口；若 CI 红则最小修复断言）。

**出口：** SC-05–SC-07、SC-09（组件层）。

### S3 行级策略、摘要、selector、术语

1. 行级策略禁用文案对齐；摘要「目录绑定」。
2. selector-contract；`lint:terminology`。
3. 定向回归：`role-detail.test.tsx`、`role-permission-structure` e2e 仅在已授权且环境具备时跑。

**出口：** SC-08、SC-10–SC-12。

### S4 收口登记（实施完成后）

1. 主 Spec／本 Plan 状态改为功能合同已收口；写 reviews 实施笔记（若仓库惯例需要）。
2. 更新 `docs/README.md`／`docs/plans/README.md` 镜像状态句。

**出口：** 文档状态与证据指针；**仍写**本条收口不表示可上线。

---

## 5. 验收

验收正文是主 Spec §8 SC-01–SC-12。本 Plan 不另起 SC 编号。

建议命令（实施阶段）：

```bash
npm --prefix webui test -- src/__tests__/role-table-grants.test.tsx src/__tests__/role-detail.test.tsx
npm --prefix webui run lint:terminology
npm run lint:spec-docs
```

## 6. 完成定义

- [x] SC-01–SC-12 有自动化或约定文档证据
- [x] 无高级设置目录绑定入口回潮
- [x] 草稿序列化与 Spec 131 字段语义一致
- [x] 索引状态句与 Spec／Plan 头部一致
- [x] 未越权做手册／镜像／推送

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 既有测试／e2e 锁死「启用目录绑定」checkbox | S1 先改测再改 UI；e2e 最小改断言 |
| 退出跟随时行级策略残留 | 确认路径显式清空；与现网 confirmScopeChange 对齐 |
| 空高级 settings 残留空 `<details>` | D4：无内容则移除折叠 |
| 管理员仍找「启用目录绑定」词 | 确认次句／页说明可保留概念名；手册另工单 |

## 8. 落盘清单自检

| # | 项 | 本条 |
|---|---|---|
| 1 | 与 Spec 同编号 `-plan.md` | 是 |
| 2 | 状态／授权边界／验收 | 头部表 |
| 3 | 目标／开工前置／验收／完成定义／风险 | §1–§2、§5–§7 |
| 4 | 索引登记 | `docs/plans/README.md` |
| 5 | 未把发布取证写入功能出口 | 是 |
