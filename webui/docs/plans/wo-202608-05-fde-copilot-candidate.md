# 202608-05 FDE Copilot Candidate Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-05 FDE Copilot Candidate。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/04-data-model.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `docs/56-table-semantic-workbench-online-editing-actionbar-version-history-spec.md`
- `docs/66-fde-copilot-candidate-spec.md`
- `server/semantic-layer.ts`
- `server/overlay.ts`
- `server/proxy/audit.ts`
- `src/pages/TableEditor.tsx`
- `src/__tests__/table-editor.test.tsx`
- `server/__tests__/semantic-layer.read.test.ts`

目标：实现 deterministic-first FDE Copilot candidate engine，并在表语义工作台展示候选建议。只生成 patch preview，不自动写入。

## Scope

1. 新建 `server/fde-copilot/candidates.ts`。
2. 新增 API：
   - `POST /api/fde-copilot/candidates`
   - `POST /api/fde-copilot/candidates/:id/patch-preview`
   - `POST /api/fde-copilot/candidates/:id/dismiss`
3. 从 manifest、overlay、audit summary、historical SQL hash 生成 candidates。
4. 支持 candidate types：dimension、measure、join、segment、conflict warning。
5. 无证据 candidate 进入 `unverified candidate` 隔离区。
6. Patch preview 只能指向 overlay。
7. TableEditor / semantic workbench 复用现有辅助维护区域展示。
8. 新增测试：
   - `server/__tests__/fde-copilot-candidates.test.ts`
   - 更新 `src/__tests__/table-editor.test.tsx`
9. 新增自检脚本：`../scripts/verify-202608-fde-copilot.mjs`。

## Implementation Notes

- MVP 不调用真实外部 LLM。
- 不写 semantic-layer 文件。
- 不改 `_schema/*.yaml`。
- 不把历史 SQL 频率直接当作标准口径。
- UI 不新建大页面，不引入卡片嵌套卡片。
- Candidate primary CTA 只能是 `预览 Diff` 或 `标记已处理`，不能是 `自动应用`。

## Acceptance Criteria

- repeated SQL evidence creates candidate。
- no-evidence guess becomes `unverified candidate`。
- P0 policy conflict creates conflict warning。
- patch preview writes no file。
- patch target is overlay only。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/fde-copilot-candidates.test.ts src/__tests__/table-editor.test.tsx server/__tests__/semantic-layer.read.test.ts
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-fde-copilot.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] No automatic semantic-layer write.
- [ ] Candidate has evidence refs and confidence.
- [ ] Low confidence candidate is visibly isolated.
- [ ] Patch preview cannot target `_schema`.
