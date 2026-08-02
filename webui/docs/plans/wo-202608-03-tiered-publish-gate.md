# 202608-03 Tiered Publish Gate Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-03 Tiered Publish Gate。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/23-semantic-asset-publish-export-spec.md`
- `docs/46-eval-yaml-exchange-and-result-archive-spec.md`
- `docs/64-tiered-publish-gate-spec.md`
- `server/semantic-assets.ts`
- `server/eval/cases.ts`
- `server/eval/suite-schema.ts`
- `src/components/semantic-assets/SemanticAssetPublishDrawer.tsx`
- `src/__tests__/semantic-asset-publish.test.tsx`
- `server/__tests__/api.semantic-assets.publish.test.ts`

目标：在 semantic asset publish 中增加 P0 / P1 / P2 分级 gate 和 emergency override evidence。不要用单一总通过率处理所有风险。

## Scope

1. 新建 `server/publish-gate.ts`。
2. 扩展 Eval Case 读取模型，支持 `risk_tier` / `risk_tags`，保持旧 case 兼容。
3. 实现 static declaration first、dynamic promotion second。
4. 扩展 semantic validate / publish response，返回 `PublishGateResult`。
5. P0 fail blocks publish。
6. P1 threshold 默认 90%。
7. P2 warning 不阻断。
8. Emergency override API / helper 要求双 approver、reason、expiresAt、rollbackPlan。
9. Override 写 Trace / Evidence event，并生成 follow-up case metadata。
10. 新增测试：
    - `server/__tests__/publish-gate.test.ts`
    - 更新 publish API / UI tests。
11. 新增自检脚本：`../scripts/verify-202608-publish-gate.mjs`。

## Implementation Notes

- 关键词只能作为 signal，不能单独提升 P0。
- 动态提升要结合 `access.yaml` deny 标签、semantic-layer tags、source classification、measure risk metadata。
- 不要让前端自行计算 gate decision；前端只展示后端结果。
- UI 复用现有 publish drawer、validation panel、diff panel。
- Override 在单管理员部署中仍需两个 approver 字段；是否允许同一 actor 由 spec 后续决定，MVP 默认不允许。

## Acceptance Criteria

- P0 failed -> publish blocked。
- P1 89% under 90% -> publish blocked。
- P2 only failed -> publish warning, not block。
- Override missing second approver -> rejected。
- Valid override writes evidence event。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/publish-gate.test.ts server/__tests__/api.semantic-assets.publish.test.ts src/__tests__/semantic-asset-publish.test.tsx
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-publish-gate.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] P0 cannot be bypassed without override evidence.
- [ ] P1 / P2 are not collapsed into one score.
- [ ] Frontend display is not a second source of gate truth.
- [ ] Override event is append-only.
