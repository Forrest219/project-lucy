# 新建角色默认业务问答与工具勾选速查 Plan

| 元数据 | 内容 |
|---|---|
| 文档版本 / 日期 | **v0.1** / 2026-11-04 |
| 目标版本 / 优先级 | 不绑定产品版本号 / **P1**。功能编号无 |
| 主 Spec | [`docs/specs/lucy-20261104-role-create-business-qa-defaults-spec.md`](../specs/lucy-20261104-role-create-business-qa-defaults-spec.md) |
| 状态 | **v0.1 功能合同已收口（2026-11-04）**。SC-01–SC-12 关闭。证据见 [`docs/reviews/2026-11-04-role-create-business-qa-defaults-closure.md`](../reviews/2026-11-04-role-create-business-qa-defaults-closure.md)。本条收口不表示可上线 |
| 授权边界 | 授权实施本 Plan 全部分项、SC-01–SC-12 验收与 Spec／索引／术语同步；不含浏览器 E2E、Docker 重建、git commit、客户交付 |
| 验收 | 以主 Spec §5 SC-01–SC-12 为准 |
| 实施主体 | `rolePermissionDraft.ts`、`RoleToolGrants.tsx`、`RoleDetail.tsx`、术语标准、SYSTEM_HANDBOOK（已部分对齐）、相关 Vitest |

## 1. 目标

新建角色默认预选业务问答工具全集；工具页提供「业务问答」「只读问答」戳印；帮助矩阵与 FAQ 与默认一致；沿用空工具阻断与 dirty／审阅基线分离。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | 主 Spec v0.1 已落盘且用户批准推进收口 | 满足（2026-11-04） |
| P2 | 不扩大 ACL／ops 授权模型 | 满足 |
| P3 | 保护工作区无关改动 | 实施时遵守 |

## 3. 文件落点

| 路径 | 改动 |
|---|---|
| `webui/src/lib/rolePermissionDraft.ts` | 新增 `BUSINESS_QA_PRESET`；改 `matchingPresetName` / `PresetName` |
| `webui/src/components/RoleToolGrants.tsx` | 预设按钮「业务问答」「只读问答」 |
| `webui/src/pages/admin/RoleDetail.tsx` | 新建默认、引导与空工具文案 |
| `webui/docs/00-product-terminology-standard.md` | 登记新术语；修正新建默认旧句 |
| `docs/SYSTEM_HANDBOOK.md` | 确认矩阵／FAQ（已基本对齐，按需微调） |
| `webui/src/__tests__/role-permission-draft.test.ts` | SC-01 / SC-07 |
| `webui/src/__tests__/role-tool-grants.test.tsx` | SC-05 / SC-06 |
| `webui/src/__tests__/role-detail.test.tsx` | SC-02–SC-04 / SC-08–SC-10；夹具补 Skill 工具 |
| `webui/server/__tests__/help.test.ts` | SC-11（深链与手册句子） |

## 4. 分阶段实施

### S1 常量与匹配

1. 导出 `BUSINESS_QA_PRESET = [...READONLY_QA_PRESET, ...CONTEXT_TOOL_NAMES]`。
2. `matchingPresetName`：先精确匹配业务问答，再精确匹配只读问答；去掉「忽略通道仍算只读问答」逻辑。
3. 纯函数测试绿。

### S2 UI 与新建默认

1. `newCreateDraft.tools = [...BUSINESS_QA_PRESET]`。
2. `RoleToolGrants`：业务问答 + 只读问答按钮；匹配提示跟 `PresetName`。
3. 引导／空工具文案改「业务问答」。
4. 组件测试夹具补 `lucy_skill_*`；改写 RD 描述块为业务问答默认。

### S3 文档与收口

1. 术语标准写入 New terms。
2. 帮助断言 SC-11。
3. 跑聚焦 Vitest + `lint:terminology`（相关）+ `lint:spec-docs`（本 Spec／Plan）。
4. 写收口记录；Spec／Plan／`docs/README.md`／`docs/plans/README.md` 状态改「已收口」。

## 5. 验收

| 项 | 命令 |
|---|---|
| SC-01 / SC-07 | `npx vitest run src/__tests__/role-permission-draft.test.ts` |
| SC-05 / SC-06 | `npx vitest run src/__tests__/role-tool-grants.test.tsx` |
| SC-02–04 / SC-08–10 | `npx vitest run src/__tests__/role-detail.test.tsx` |
| SC-11 | `npx vitest run server/__tests__/help.test.ts`（或追加断言后跑） |
| 形态 | `npm run lint:spec-docs`（本编号无新增阻塞） |

不跑 Docker；不跑浏览器 E2E 作为本 Plan 出口。

## 6. 完成定义

- SC-01–SC-12 关闭（SC-12 以术语标准行存在 + lint 相关通过为准）
- Spec／Plan／索引镜像同一句现值
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 旧测试锁死只读默认 | 一律改引 `BUSINESS_QA_PRESET` |
| 夹具缺 Skill 工具导致匹配失败 | mcp-tools mock 补齐四通道 |
| 与 Spec 170 文档漂移 | Spec 已冻结：仍显式列举；默认写入即满足 |
