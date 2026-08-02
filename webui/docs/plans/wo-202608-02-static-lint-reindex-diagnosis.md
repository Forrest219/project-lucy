# 202608-02 Static Lint And Reindex Diagnosis Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-02 Static Lint And Reindex Diagnosis。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/04-data-model.md`
- `docs/23-semantic-asset-publish-export-spec.md`
- `docs/29-connection-semantic-boundary-automation-spec.md`
- `docs/63-static-lint-reindex-diagnosis-spec.md`
- `server/semantic-layer.ts`
- `server/semantic-assets.ts`
- `server/ktx.ts`
- `server/__tests__/semantic-assets.validate-gate.test.ts`
- `server/__tests__/api.semantic-assets.reindex.test.ts`

目标：实现 deterministic semantic-layer static lint 和 Reindex 失败诊断。只生成 patch draft / impact diff，不自动写入。

## Scope

1. 新建 `server/semantic-lint.ts`。
2. 实现规则：`SL001` 至 `SL006`。
3. 新增 `POST /api/semantic-lint`。
4. 新增或扩展 `POST /api/semantic-assets/reindex/diagnose`。
5. 为 Reindex stderr/stdout 解析常见错误：YAML parse、missing source、Unknown column、join target missing。
6. Patch draft 只返回文本和 diff，不写磁盘。
7. 写入 Trace / Evidence Kernel。
8. 新增测试：
   - `server/__tests__/semantic-lint.test.ts`
   - `server/__tests__/semantic-assets.reindex-diagnosis.test.ts`
9. 新增自检脚本：`../scripts/verify-202608-static-lint.mjs`。

## Implementation Notes

- 不要手改 `_schema/*.yaml`。
- 不要复用 naive YAML dump；读取分析可以 parse，写入草稿只生成文本，不触发保存。
- Rule severity 必须映射 P0 / P1 / P2。
- Reindex diagnosis 不应把 embedding provider warning 当作 hard failure。
- UI 如需接入，复用现有 validation panel / diff viewer。

## Acceptance Criteria

- manifest / overlay mixed fixture 被判 P0。
- missing grain fixture 被判 P1。
- cyclic join fixture 被判 P0。
- patch draft 包含 `requiresOwnerApproval: true`。
- patch draft 不包含写命令、不包含 `_schema` 目标写入。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/semantic-lint.test.ts server/__tests__/semantic-assets.reindex-diagnosis.test.ts server/__tests__/semantic-assets.validate-gate.test.ts server/__tests__/api.semantic-assets.reindex.test.ts
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-static-lint.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] No auto write from patch draft.
- [ ] No `_schema` artificial extension.
- [ ] Lint issues include file path and line when available.
- [ ] Trace event is written for lint / diagnosis runs.
