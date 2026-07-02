# 权限治理优化执行计划（plan）

| 元数据 | 内容 |
|---|---|
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-22 |
| 适用范围 | inbox/access-governance-design-2026-06-22.md §4 的 10 项 P0/P1 工作 |
| 关联材料 | inbox/cio-briefing-access-governance-2026-06-22.html（业务汇报版） |
| 读者 | PM / tech lead / reviewer |

---

## 1. 总览

10 项工作的并行度分布：

| 阶段 | 时间窗 | 性质 | 串/并行 | 工作项 |
|---|---|---|---|---|
| 阶段 A 回归验证 | W26 D1-D2 | 必先做 | 全部串行（同一代码库） | #1、#2 |
| 阶段 B 模板库主线 | W26 D2-D5 | 核心交付 | 串行 | #7、#6（lint 用例） |
| 阶段 C 治理配套 | W26 D4 - W27 D3 | 增强项 | 三组并行 | #3、#4、#5 |
| 阶段 D 文档闭环 | W27 D3 - W27 D5 | 收尾 | 串行 | #8、#9、#10 |

W26 = 2026-06-23 至 2026-06-29；W27 = 2026-06-30 至 2026-07-06。

---

## 2. 阶段 A：回归验证（W26 D1-D2，2 天）

**目标**：确认 v1.2 role-first 在最新代码下没有静默回归，为后续 P1 工作打基线。

| 序 | 工作项 | 文件 | 验收 | 阻塞？ |
|---:|---|---|---|---|
| A1 | 跑全量 admin 测试，确认 #1 矩阵覆盖 | `webui/server/__tests__/admin-agents.test.ts`、`admin-tokens.test.ts` | `npm test -- admin` 全绿；若缺覆盖，按 design-agent-permissions §7 矩阵补 | 是：#7 模板库依赖 admin 写入路径稳定 |
| A2 | 跑 proxy ACL 测试矩阵，确认 #2 fail-closed 覆盖 | `webui/server/__tests__/kx-acl.test.ts`、`mcp-proxy-acl.test.ts` | role 不存在 / selector 0 source / `tools:["*"]` / 缺 connections / 全局 deny 命中 五类全绿 | 是：#7 模板预览依赖 previewRolePermissionsForAdmin |

并行策略：A1 与 A2 不同文件，可分配给 2 个 reviewer 并行跑；任一不绿就停下补测试，不进阶段 B。

---

## 3. 阶段 B：模板库主线（W26 D2-D5，3-4 天）

**目标**：交付 §3.1 角色模板库（5 个预置模板 + UI 集成 + 模板字段 lint）。这是 P1 的核心交付物。

| 序 | 工作项 | 文件 | 验收 | 阻塞？ |
|---:|---|---|---|---|
| B1 | 设计 5 个预置模板常量 + 类型 | `webui/server/admin/role-templates.ts`（新增）、`webui/src/lib/types.ts`（新增 `RoleTemplate` 类型） | 类型导出；模板展开函数纯函数单测 | — |
| B2 | admin API 暴露 `GET /api/admin/roles?includeTemplates=true` | `webui/server/admin/agents.ts`（扩展）、`webui/server/__tests__/admin-roles.test.ts`（新增） | 返回 `source: yaml\|template` 字段；合并去重；template 含 description | 阻塞 B3 |
| B3 | admin UI 新建弹窗支持选模板；后端把模板展开落盘 | `webui/src/pages/admin/AgentList.tsx`、`webui/server/admin/agents.ts` | `git diff access.yaml` 只新增 role 与 allow，无 `role-template` 字段 | 阻塞 B4 |
| B4 | 给 `accessRolePolicy` 加 role-template 字段校验 | `scripts/lint-spec.mjs`（扩展 accessRolePolicy 函数） | `npm run lint:spec` exit 1 当且仅当 yaml 含指针字段；新增单测覆盖 4 种字段（`role-template` / `templateId` / `templateRef` / `_template`） | 阻塞 #6 |

并行策略：B1 可与 A1/A2 并行（不同模块），但 B2-B4 串行。B2 不阻塞 B3 的 UI 改动（前端可先用 mock）。B4 是 #6 工作项的真正实施点。

---

## 4. 阶段 C：治理配套（W26 D4 - W27 D3，可与 B 部分重叠）

**目标**：交付 #3 / #4 / #5 三项治理增强。

| 序 | 工作项 | 文件 | 验收 | 与 B 关系 |
|---:|---|---|---|---|
| C1 | Onboarding step 5 失败原因细分（#3） | `webui/src/pages/Onboarding.tsx` | 4 类细分：无 Agent / 无 token / Agent 全 disabled / 全是 legacy allow | 可与 B3 并行 |
| C2 | `POST /api/admin/_reload` 端点 + 默认触发（#4） | `webui/server/admin/reload.ts`（新增）、`webui/server/proxy/identity.ts`、`webui/server/__tests__/reload.test.ts` | 撤销后 ≤2s 旧 token 401；product 需拍板 A4 | 独立，可与 B 并行；需 A4 决策 |
| C3 | `config_change_log` CSV 导出（#5） | `webui/server/admin/config-audit.ts` | `GET /api/admin/config-audit/export.csv` 流返回；header 含 `Content-Disposition`；与 audit 导出对齐 | 独立 |

并行策略：C1/C2/C3 互不依赖，可分配给 3 个 builder 同时推进；C2 需在动手前向产品确认 A4（30s TTL 是否可接受）——若产品要求主动 reload 优先，C2 提前到 W26 D2。

---

## 5. 阶段 D：文档与沟通闭环（W27 D3 - W27 D5，2-3 天）

**目标**：把 inbox 文档迁 docs/、更新项目总览、关闭 audit 异议。

| 序 | 工作项 | 文件 | 验收 |
|---:|---|---|---|
| D1 | 把 `inbox/access-governance-design-2026-06-22.md` 迁 `docs/access-governance-design.md`（#8） | `docs/access-governance-design.md` | inbox 文件留 `已迁移` 标签或删除 |
| D2 | 更新 `docs/project-overview.md §10`（#8） | `docs/project-overview.md` | 第 1 项后追加 P0-1 已闭环 + 引用新 doc |
| D3 | 在 `docs/access-governance-design.md` 第二节补 §3.2 spec 锚点迁移（#9） | `docs/access-governance-design.md` | 文档节存在 |
| D4 | 关闭 Opus §8.1 异议：项目周报 / issue 评论回写（#10） | issue tracker / 周报 | 异议状态 closed |

并行策略：D1-D2 串行（D2 依赖 D1 的新路径）；D3 可与 D1 并行；D4 串行末尾。

---

## 6. 关键依赖图

```
A1 ──┐
     ├── A2 ──► B1 ──► B2 ──► B3 ──► B4 ──► (#6 验收)
                              │
                              └── C1（并行）
     │
     └── C2（需 A4 决策） ──────► C3（并行）

B 全部完成 ──► D1 ──► D2 ──► D4
                  │
                  └── D3（并行）
```

---

## 7. 决策前置项（动手前必须解决）

| 序 | 决策点 | 决策人 | 不决的后果 | 截止 |
|---:|---|---|---|---|
| DC1 | A4：30s TTL 撤销延迟是否可接受 | 产品 / CIO | C2 推迟到 W27 中后期 | W26 D2 |
| DC2 | A6：`expires_at` UI 暴露时机 | 产品 | NewToken 不动；不影响 P1 闭环 | W26 D4 |
| DC3 | 5 个预置模板是否够用 | 产品 / PM | 可能补加模板 → 推迟 W27 验收 | W26 D3 |

---

## 8. 风险与回退

| 风险 | 触发条件 | 回退策略 |
|---|---|---|
| 模板库 UI 改动阻塞现有创建流 | 新建 Agent 流程回归 | feature flag `admin.roleTemplates.enabled=false` 退回到只显示 yaml role |
| lint 新规则误伤历史 yaml | `npm run lint:spec` 在 #6 验收时 exit 1 | 临时只对新角色 fail、对历史 warn；24h 内提交补丁改回 fail |
| `_reload` 端点引发缓存一致性问题 | 撤销后行为异常 | 默认关闭，仅在 UI 显式 `?reload=true` 触发；保留 TTL 路径 |

---

## 9. 完成定义（Plan 级）

- 阶段 A-D 全部走完
- 10 项工作项全部验收通过
- DC1-DC3 决策全部落地
- 文档迁移完成 + 项目总览更新
- 一周内无新增 P0/P1 issue

— 完