# 连接服务器地址编辑 Implementation Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.4.3 功能合同已收口（2026-11-03）**。服务端见 [`docs/reviews/2026-11-01-connection-endpoint-edit-closure.md`](../reviews/2026-11-01-connection-endpoint-edit-closure.md)；UX 见 [`docs/reviews/2026-11-03-connection-endpoint-edit-ux-closure.md`](../reviews/2026-11-03-connection-endpoint-edit-ux-closure.md)。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261101-connection-endpoint-edit-spec.md`](../specs/lucy-20261101-connection-endpoint-edit-spec.md) **v0.4.3** |
| 审阅 | 服务端 r1–r3（2026-11-01）；UX：[`docs/reviews/2026-11-02-codex-review-connection-endpoint-edit-dialog.md`](../reviews/2026-11-02-codex-review-connection-endpoint-edit-dialog.md) |
| 授权边界 | **v0.4 仅 UX**：将失效的 inline Drawer 换为 Tableau 对齐的居中 `EditConnectionDialog`；重开 SC-11–14／22；新增 SC-24–SC-27。**不**改服务端 endpoint API／门禁／回滚／presence；**不**改 connection id／schemas／enabled_tables／ACL；**不**要求浏览器 E2E／移动窄屏；**不**做 Host 旁常驻入口 |
| 验收 | Spec SC-11–14／22／24–27（本轮）；SC-01–10／15–21／23 保持已关闭 |

**Goal:** 连接概览「更多 → 编辑连接」打开居中 Dialog，可改服务器地址；不再掉到页底内联表单。

**Architecture:** 保留已落地的 `POST /api/connections/:connId/endpoint`。前端废除 `EditConnectionDrawer` 的 `pl-drawer-root`／裸 `pl-drawer` 壳，改为 `EditConnectionDialog`（`pl-modal-backdrop` + `pl-modal-panel`，对齐 `RenewTokenDialog`／Tableau Edit Connection dialog）。入口仍在连接卡「更多」。

**Tech Stack:** React、`pl-modal-*`（或 Radix Dialog Portal）、既有 Vitest 组件测、Fastify API（只读复用）。

## Global Constraints

- 回滚基线 = 持锁后 `oldText` / 旧 secret 字节（服务端已落地，本轮不改）
- Dialog 必须 `aria-modal` + 生产类 `pl-modal-backdrop`／`pl-modal-panel`；禁止页底内联与未定义 drawer 类
- submitting 期间全部关闭入口禁关（Esc／遮罩／关闭／取消）
- 成功 Toast 禁止「问数已切到新库」「权限已恢复」；须断言 Toast 参数
- PageHeader 与 Dialog 分范围 primary 计数
- 编辑冲突不复用新建主按钮文案
- 收口前必须删除旧 Drawer 文件与旧测试路径

---

## 1. 目标

1. 落地 Spec v0.4.3 §9 Dialog 呈现。
2. 关闭 SC-11–14／22／24–27。
3. 不回归服务端已关闭 SC。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec v0.4.3 + Plan v0.4.3 经 Codex r1–r4 定稿 | **满足** |
| P2 | 开发授权（2026-11-02「定稿后进入开发」） | **满足** |
| P3 | 服务端 v0.3 收口记录仍有效 | **满足** |

## 3. 文件地图（v0.4）

| 文件 | 职责 | SC |
|---|---|---|
| `webui/src/components/connections/EditConnectionDialog.tsx` | **新建**：居中 Dialog；预填／预览／保存／冲突／submitting 全入口禁关 | SC-11／12／22／24–27 |
| `webui/src/components/connections/EditConnectionDrawer.tsx` | **本轮收口前删除**（过程 re-export 可选，不得残留到勾销） | SC-24／26 |
| `webui/src/pages/connections/ConnectionOverview.tsx` | 入口改挂 `EditConnectionDialog`；lazy import 路径更新 | SC-11／13 |
| `webui/src/__tests__/edit-connection-dialog.test.tsx` | **新建／迁入**；删除 `edit-connection-drawer.test.tsx` | SC-11–13／22／24–27 |
| `webui/docs/00-product-terminology-standard.md` | 补齐 New terms 六行（含「编辑预览」） | SC-14 |
| `webui/src/components/admin/RenewTokenDialog.tsx` | 壳层参考（只读） | — |
| `webui/src/app/app.css` | 确认 `pl-modal-*` 已有；**不**新造 `pl-drawer-root` | SC-24 |
| 服务端 `project.ts`／API／gate／fs-safe | **本轮不改** | 已关闭 SC |

## 4. 任务

### Task 0–5: 服务端与旧 Drawer（已完成）

- [x] 见 v0.3 收口记录；**不得**用旧 Drawer 组件测冒充 v0.4 Dialog 通过

### Task 6: RED — Dialog 组件合同

- [x] 新建 `edit-connection-dialog.test.tsx`；删除 `edit-connection-drawer.test.tsx`
- [x] 断言覆盖 Spec §9.2／§9.3（modal 类、CSS `flex` 合同、字段归属、primary、冲突、Toast、submitting 禁关）
- [x] RED→GREEN 同轮完成（旧 Drawer 已删除）

### Task 7: GREEN — `EditConnectionDialog` + 概览挂载

- [x] 实现 `EditConnectionDialog.tsx`（`pl-modal-backdrop` + `pl-modal-panel`）
- [x] ConnectionOverview lazy 改为 Dialog；清除 Drawer 引用
- [x] 删除 `EditConnectionDrawer.tsx` 与旧测；源码 `rg` 零命中
- [x] 术语标准补齐「编辑预览」；New terms 六行齐全
- [x] 组件测 7/7；`connection-overview.test.tsx` 50/50

### Task 8: 文档镜像与收口记录

- [ ] 定稿／授权开发／收口各次转换：同句更新 Spec 头部、§12.2、SC 表标注、Plan 头部、`docs/README.md`、`docs/plans/README.md`
- [ ] 收口时挂新证据链接；标明 §12.1 不冒充 Dialog
- [ ] `npm run lint:spec-docs`

## 5. 验收

从**仓库根**连续执行（各步失败即停；子 shell 隔离 `cd`）：

```bash
set -e
( cd webui && npx vitest run \
  src/__tests__/edit-connection-dialog.test.tsx \
  src/__tests__/connection-overview.test.tsx )
( cd webui && npm run lint:terminology )
npm run lint:spec-docs

# 残留：旧文件必须不存在（失败＝未删净）
test ! -e webui/src/components/connections/EditConnectionDrawer.tsx
test ! -e webui/src/__tests__/edit-connection-drawer.test.tsx

# 残留：源码旧符号／导入必须零命中
# rg 退出码：0＝有命中→失败；1＝无匹配→通过；其他＝扫描错误→失败
set +e
rg -n "EditConnectionDrawer|edit-connection-drawer" webui/src
rg_ec=$?
set -e
if [ "$rg_ec" -eq 0 ]; then
  echo "FAIL: source still references Drawer" >&2
  exit 1
fi
if [ "$rg_ec" -ne 1 ]; then
  echo "FAIL: rg scan error (exit $rg_ec)" >&2
  exit 1
fi

# 文档允许提及旧名（禁令／迁移说明）；只做存在性抽查，失败不阻断收口
set +e
rg -n "EditConnectionDrawer|pl-drawer-root" \
  docs/specs/lucy-20261101-connection-endpoint-edit-spec.md \
  docs/plans/lucy-20261101-connection-endpoint-edit-plan.md \
  docs/reviews/2026-11-01-connection-endpoint-edit-closure.md \
  >/dev/null
doc_ec=$?
set -e
# doc_ec 0/1 均可；仅扫描错误告警
if [ "$doc_ec" -ne 0 ] && [ "$doc_ec" -ne 1 ]; then
  echo "WARN: doc rg scan error (exit $doc_ec)" >&2
fi
```

可选回归（不阻塞 UX 收口，若改到共享类型再跑）：

```bash
( cd webui && npx vitest run \
  server/__tests__/project.connection-endpoint-update.test.ts \
  server/__tests__/api.connection-endpoint-update.test.ts )
```

浏览器 / docker 不在本轮出口。

## 6. 完成定义

- Task 6–8 勾销；SC-11–14／22／24–27 有通过记录
- 旧 Drawer 文件与测试路径已删除
- 服务端已关闭 SC 未被本轮改坏（若跑了可选回归）
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| jsdom 假阳性布局 | 生产类名硬门禁；禁 drawer 类；禁 style mock |
| 页底唯一表单逃过「第二套」检查 | SC-26：面板内唯一＋面板外为零 |
| 关闭按钮绕过 submitting | SC-27 全入口 |
| Toast mock 空过 | 断言调用参数 |
| 双实现残留 | 收口前删除＋rg |
| 状态镜像漂移 | Task 8 同句更新含 §12.2 |

## 8. Changelog

| 版本 | 变更 |
|---|---|
| v0.1–v0.3 | 服务端＋旧 Drawer；功能合同收口 |
| v0.4 | UX Dialog 补口：Task 6–8；对齐 Tableau；禁页底内联 |
| v0.4.1 | 吸收 Codex r1 UX-01–UX-08：取证、禁关、Toast、primary 分范围、术语六行、删除旧文件、镜像含 §12.2 |
| v0.4.2 | 吸收 Codex r2：CSS 规则文本断言；焦点；根目录可跑验收块；残留扫描分源码／文档 |
| v0.4.3 | 吸收 Codex r3：CSS 须含 `flex`；`rg` 退出码 0／1／其他三分 |
