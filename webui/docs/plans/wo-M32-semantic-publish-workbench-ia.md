# M32 Semantic Publish Workbench IA Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename and restructure the current `/review` experience into a focused `语义发布` module with two second-level pages: `发布工作台` and `发布记录`.

**Architecture:** This is an IA and workflow refactor over the existing Review page and semantic asset publish APIs. Keep the existing validate, publish, export, and reindex primitives, but expose them through user-facing publish language: publish automatically rebuilds the KTX index, while manual reindex remains a visible recovery action.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Sonner Toast, Fastify, existing semantic asset APIs, existing CSS utility layer, Vitest, Testing Library, Supertest.

**Source Spec:** [../35-semantic-publish-workbench-ia-spec.md](../35-semantic-publish-workbench-ia-spec.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/23-semantic-asset-publish-export-spec.md`
- `webui/docs/24-yaml-delivery-runbook-spec.md`
- `webui/docs/29-connection-semantic-boundary-automation-spec.md`
- `webui/docs/35-semantic-publish-workbench-ia-spec.md`

Inspect these implementation files:

- `webui/src/app/App.tsx`
- `webui/src/pages/Review.tsx`
- `webui/src/components/PageHeader.tsx`
- `webui/src/components/semantic-assets/SemanticAssetPublishDrawer.tsx`
- `webui/src/components/semantic-assets/SemanticAssetExportButton.tsx`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/types.ts`
- `webui/src/lib/apiClient.ts`
- `webui/server/index.ts`
- `webui/server/semantic-assets.ts`
- `webui/server/ktx.ts`
- `webui/src/app/app.css`

Inspect these tests:

- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/review.test.tsx`
- `webui/src/__tests__/semantic-asset-publish.test.tsx`
- `webui/server/__tests__/api.semantic-assets.publish.test.ts`
- `webui/server/__tests__/api.semantic-assets.reindex.test.ts`

Non-negotiable boundaries:

- Do not move database connection, Schema, or Schema Manifest editing into `语义发布`.
- Do not move table semantic editing out of `语义层维护`.
- Do not move Wiki editing out of `业务文档`.
- Do not create `待发布变更`, `索引生效`, or `资产包` as second-level navigation items.
- Do not run `ktx ingest`.
- Do not edit `ktx.yaml`.
- Do not read, print, parse, or commit `.ktx/secrets/**`.
- Keep `/review` backward-compatible through redirect or equivalent navigation handling.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请实现 `webui/docs/35-semantic-publish-workbench-ia-spec.md`。

交付：

1. 左侧导航一级菜单从 `审阅与校验` 改为 `语义发布`。
2. 二级菜单只保留 `发布工作台` 与 `发布记录`。
3. `/publish/workbench` 承载当前 `/review` 的发布工作台能力，`/review` 兼容跳转到该页面。
4. `/publish/history` 展示 WebUI 发起的发布记录、Reindex 状态、错误和当前快照动作。
5. 发布工作台中 `强制重建索引` 常驻可见；`发布并重建索引` 仅在 `pending files > 0` 且通过校验门禁后高亮可用。
6. Drawer 内提交主按钮文案为 `发布并重建索引`。
7. 资产包导出保留为辅助动作 `导出当前快照 (.zip)`，不得成为二级菜单；v0.1 只导出当前时点全量快照。
8. 更新前后端测试、术语 lint、浏览器验证。

收尾说明必须列出修改文件、验证命令和结果。

## Task 1: Navigation And Route Contract

**Files:**

- Modify: `webui/src/app/App.tsx`
- Modify: `webui/src/__tests__/app-shell.test.tsx`
- Modify: `webui/src/__tests__/review.test.tsx` if route wrappers need updating

**Step 1: Add failing navigation test**

In `app-shell.test.tsx`, add assertions:

```ts
expect(screen.getByText("语义发布")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "发布工作台" })).toHaveAttribute("href", "/publish/workbench");
expect(screen.getByRole("link", { name: "发布记录" })).toHaveAttribute("href", "/publish/history");
expect(screen.queryByText("审阅与校验")).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "变更审阅" })).not.toBeInTheDocument();
```

Expected before implementation: FAIL because the current navigation still renders `审阅与校验 / 变更审阅`.

**Step 2: Add route compatibility test**

Add a route test that opens `/review` and expects the workbench content or a redirect target equivalent to `/publish/workbench`.

Expected before implementation: FAIL.

**Step 3: Update App routes**

In `App.tsx`:

- Replace the navigation group label with `语义发布`.
- Add two second-level links: `/publish/workbench`, `/publish/history`.
- Route `/publish/workbench` to the workbench page.
- Route `/publish/history` to the history page.
- Route `/review` to redirect to `/publish/workbench`.

Do not add second-level items for `待发布变更`, `索引生效`, or `资产包`.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS.

## Task 2: Publish Workbench Page Copy And Action Layout

**Files:**

- Modify or rename: `webui/src/pages/Review.tsx`
- Optional create: `webui/src/pages/publish/PublishWorkbench.tsx`
- Modify: `webui/src/__tests__/review.test.tsx`
- Modify: `webui/src/app/app.css` if layout needs dedicated classes

**Step 1: Add failing workbench copy test**

Assert the page renders:

```ts
expect(screen.getByRole("heading", { name: "发布工作台" })).toBeInTheDocument();
expect(screen.getByText("查看并发布当前待生效的语义资产", { exact: false })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "校验变更" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "强制重建索引" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传语义资产" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "导出当前快照 (.zip)" })).toBeInTheDocument();
const publishCta = screen.queryByRole("button", { name: "发布并重建索引" });
if (publishCta) {
  expect(publishCta).toBeDisabled();
}
expect(screen.queryByText("变更审阅与校验")).not.toBeInTheDocument();
expect(screen.queryByText("Validate changed")).not.toBeInTheDocument();
```

Expected before implementation: FAIL.

**Step 2: Update page header**

Use this copy:

```text
Breadcrumb: 语义发布 / 发布工作台
Title: 发布工作台
Description: 查看并发布当前待生效的语义资产，系统将在发布后自动重建 KTX 索引。
```

**Step 3: Update action labels**

Use this order:

```text
校验变更
强制重建索引
上传语义资产
导出当前快照 (.zip)
表目录
```

If the final publish action only exists inside `SemanticAssetPublishDrawer`, rename that Drawer submit or success-path copy to communicate `发布并重建索引`.

Workbench publish CTA rules:

- With zero pending files: do not render `发布并重建索引` as an enabled highlighted CTA.
- With pending files but no successful validate gate: keep the CTA disabled or visually secondary.
- With `pending files > 0` and validate gate passed: enable/highlight `发布并重建索引`.
- Drawer submit CTA always uses `发布并重建索引`, and Drawer validation controls whether it can submit.

**Step 4: Keep empty state useful**

When there are zero changed files, show:

```text
暂无待发布变更
你仍可以上传语义资产，或在已有 YAML 由 CLI/Git 更新后强制重建索引。
```

Manual reindex must stay visible.

**Step 5: Run focused test**

Run:

```bash
npm test -- --run src/__tests__/review.test.tsx
```

Expected: PASS.

## Task 3: Manual Reindex History Recording

**Files:**

- Modify: `webui/server/index.ts`
- Modify: `webui/server/semantic-assets.ts` or create a small sidecar helper if cleaner
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/server/__tests__/api.semantic-assets.reindex.test.ts`

**Step 1: Add failing backend test**

Extend `api.semantic-assets.reindex.test.ts`:

```ts
const reindexRes = await request(app.server)
  .post("/api/semantic-assets/reindex")
  .send({})
  .expect(200);

const historyRes = await request(app.server)
  .get("/api/semantic-assets/releases")
  .expect(200);

expect(historyRes.body.data.records[0]).toMatchObject({
  trigger: "webui_manual_reindex",
  actor: expect.any(String),
  reindex: { ok: true, exitCode: 0 }
});
expect(historyRes.body.data.records[0].id).toBe(reindexRes.body.data.id);
```

Expected before implementation: FAIL because manual reindex currently returns a result but does not create release/history records.

**Step 2: Implement lightweight history record**

Either reuse the semantic asset release sidecar or add a compatible record type. Minimum shape:

```ts
{
  id: "idx_YYYYMMDD_HHMMSS_mmm_xxxxxxxx",
  createdAt,
  actor: "local-admin",
  trigger: "webui_manual_reindex",
  status: "published" | "reindex_failed",
  connectionIds: [],
  files: [],
  changedSources: [],
  validation: { ok: true, results: [] },
  reindex: { ok, exitCode, stdout, stderr }
}
```

Keep old release rows readable.

History scope for M32:

- Record WebUI-triggered normal publish releases.
- Record WebUI-triggered `强制重建索引` actions.
- Do not require external CLI/Git manual reindex runs to write to WebUI history in v0.1.

**Step 3: Ensure locking semantics**

Manual reindex must not run while publish reindex is actively locked if the existing publish lock can be checked. If lock reuse is too large for M32, return a clear `409 REINDEX_IN_PROGRESS` when a publish lock exists.

**Step 4: Run backend tests**

Run:

```bash
npm test -- --run server/__tests__/api.semantic-assets.reindex.test.ts server/__tests__/api.semantic-assets.publish.test.ts
```

Expected: PASS.

## Task 4: Publish History Page

**Files:**

- Create: `webui/src/pages/publish/PublishHistory.tsx`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Create or modify: `webui/src/__tests__/publish-history.test.tsx`
- Modify: `webui/src/app/App.tsx`

**Step 1: Add failing page test**

Mock `GET /api/semantic-assets/releases` with two records:

- A normal WebUI publish with `status: "published"`.
- A manual reindex with `trigger: "webui_manual_reindex"` and `reindex.ok: false`.

Assert:

```ts
expect(screen.getByRole("heading", { name: "发布历史与审计" })).toBeInTheDocument();
expect(screen.getByText("WebUI 发布")).toBeInTheDocument();
expect(screen.getByText("WebUI 强制重建索引")).toBeInTheDocument();
expect(screen.getByText("成功")).toBeInTheDocument();
expect(screen.getByText("失败")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "查看 Diff" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "下载当前快照" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "查看错误" })).toBeInTheDocument();
```

Expected before implementation: FAIL.

**Step 2: Implement page**

Page header:

```text
语义发布 / 发布记录

发布历史与审计
查看历史发布批次、Reindex 执行结果及当前版本快照。
```

Table columns:

```text
发布时间 | 触发方式 | 操作人 | Reindex 状态 | 动作/快照
```

Trigger labels:

| Record | UI label |
|---|---|
| normal semantic asset publish | `WebUI 发布` |
| manual reindex | `WebUI 强制重建索引` |
| unknown / legacy | `系统` |

Reindex labels:

| State | UI label |
|---|---|
| `reindex.ok === true` | `成功` |
| `reindex.ok === false` | `失败` |
| `status === "reindexing"` | `进行中` |
| no reindex | `未执行` |

**Step 3: Add row actions**

Minimum v0.1:

- `查看 Diff`: opens or expands diff if `record.diff` exists.
- `查看错误`: expands stderr / validation issue details if reindex failed.
- `下载当前快照`: exports the current full asset snapshot. Do not implement historical per-release snapshot archive in M32.

**Step 4: Run focused test**

Run:

```bash
npm test -- --run src/__tests__/publish-history.test.tsx src/__tests__/app-shell.test.tsx
```

Expected: PASS.

## Task 5: Semantic Asset Drawer Copy

**Files:**

- Modify: `webui/src/components/semantic-assets/SemanticAssetPublishDrawer.tsx`
- Modify: `webui/src/__tests__/semantic-asset-publish.test.tsx`

**Step 1: Add failing copy assertions**

Assert:

```ts
expect(screen.getByRole("heading", { name: "发布语义资产" })).toBeInTheDocument();
expect(screen.getByText("发布成功后将自动重建 KTX 索引", { exact: false })).toBeInTheDocument();
expect(screen.getByTestId("semantic-asset-publish-submit")).toHaveTextContent("发布并重建索引");
```

Expected before implementation: FAIL if existing copy still says `发布 Schema Manifest + Semantic Overlay` or submit is only `发布语义层`.

**Step 2: Update copy**

Use:

```text
Title: 发布语义资产
Description: 走 staging 验证门禁；发布成功后将自动重建 KTX 索引，让 Agent / MCP 读取最新语义资产。
Submit: 发布并重建索引
```

Keep technical terms wrapped with translation defense where already established.

**Step 3: Run focused test**

Run:

```bash
npm test -- --run src/__tests__/semantic-asset-publish.test.tsx
```

Expected: PASS.

## Task 6: Full Verification And Browser Smoke

**Files:**

- No source changes unless tests reveal issues.

**Step 1: Run focused suite**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/review.test.tsx \
  src/__tests__/publish-history.test.tsx \
  src/__tests__/semantic-asset-publish.test.tsx \
  server/__tests__/api.semantic-assets.reindex.test.ts \
  server/__tests__/api.semantic-assets.publish.test.ts
```

Expected: PASS.

**Step 2: Run terminology lint**

Run:

```bash
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: PASS.

**Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS. Vite chunk-size warnings are acceptable unless new warnings are introduced.

**Step 4: Browser smoke**

Open the running WebUI and verify:

```text
/publish/workbench
```

Expected:

- Left nav shows `语义发布`.
- Only two second-level items appear: `发布工作台`, `发布记录`.
- Workbench header says `发布工作台`.
- Actions show `校验变更`, `强制重建索引`, `上传语义资产`, `导出当前快照 (.zip)`.
- Clicking `强制重建索引` reaches terminal success/failure UI.
- Clicking `上传语义资产` opens Drawer with submit copy `发布并重建索引`.

Open:

```text
/publish/history
```

Expected:

- Page title `发布历史与审计`.
- Release rows render with Reindex 状态.
- Error rows expose stderr or validation issues.

Open:

```text
/review
```

Expected:

- Redirects to, or renders equivalently to, `/publish/workbench`.

## Completion Checklist

- [ ] Sidebar group is `语义发布`.
- [ ] Second-level nav contains exactly `发布工作台` and `发布记录`.
- [ ] `/review` compatibility works.
- [ ] No user-visible `审阅与校验`, `变更审阅`, `Validate changed`, or `发布并 reindex` remains in this module.
- [ ] Manual reindex is visible with zero changed files.
- [ ] Manual reindex writes a history record.
- [ ] Publish workbench only enables/highlights `发布并重建索引` after pending files exist and validate gate passes.
- [ ] Drawer submit CTA is `发布并重建索引`.
- [ ] Publish path copy says publish rebuilds KTX index.
- [ ] Publish history v0.1 lists WebUI-originated actions; external CLI/Git write-back is out of scope.
- [ ] Snapshot export downloads the current full asset snapshot; historical per-release snapshots are out of scope.
- [ ] Asset package export is an auxiliary action, not a nav item.
- [ ] Tests and build pass.
