# 202608-04 Safe Log-to-Eval Work Order

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 202608-04 Safe Log-to-Eval。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `../docs/eval-quiz-conventions.md`
- `../docs/lucy-202608-upgrade-execution-control.md`
- `docs/00-product-terminology-standard.md`
- `docs/46-eval-yaml-exchange-and-result-archive-spec.md`
- `docs/65-safe-log-to-eval-spec.md`
- `server/eval/db.ts`
- `server/eval/cases.ts`
- `server/eval/suite-schema.ts`
- `server/proxy/audit.ts`
- `src/pages/eval/CaseList.tsx`
- `src/pages/eval/CaseEditor.tsx`
- `server/__tests__/eval-cases.test.ts`
- `server/__tests__/eval-runs.test.ts`

目标：实现 Candidate Pool、Reviewer Evidence、promotion preview。日志不能直接变成正式 Eval Case。

## Scope

1. 新建 `server/eval/candidates.ts`。
2. 在 Eval SQLite 中新增 `eval_candidate` 和 `eval_candidate_review`。
3. 新增 API：
   - `GET /api/eval/candidates`
   - `POST /api/eval/candidates/extract`
   - `POST /api/eval/candidates/:id/review`
   - `POST /api/eval/candidates/:id/promote/preview`
   - `POST /api/eval/candidates/:id/promote`
4. 实现 redaction fail-closed。
5. 实现 dedup。
6. denied access log 可生成 P0 negative case candidate。
7. Promotion 必须检查 reviewer evidence。
8. UI 复用现有 Eval pages，新增 candidate tab 或轻量入口。
9. 新增测试：
   - `server/__tests__/eval-candidates.test.ts`
   - `src/__tests__/eval-candidates.test.tsx`
10. 新增自检脚本：`../scripts/verify-202608-safe-log-to-eval.mjs`。

## Implementation Notes

- Candidate 与正式 eval YAML 物理隔离。
- Promotion preview 返回 YAML diff，不立即写文件。
- P0 / P1 reviewer 必须确认 SQL 正确性、结果数据快照、业务口径、时间窗口。
- 不保存 token / secret / 个人联系方式。
- 不要把 `token`、`secret`、`api_key` 等语义词本身当作凭证泄露；只有高熵凭证字符串或已知签名格式才 fail-closed。
- 合法安全 / 计量类问题应进入 P0 security candidate 或 reviewer flow，而不是无脑 reject。
- 不让 AI actor 成为 reviewer。

## Acceptance Criteria

- high frequency log extracts candidate。
- duplicate logs merge。
- high-entropy credential string rejected。
- semantic token usage question becomes P0 security candidate。
- denied tool log becomes P0 negative case candidate。
- unreviewed promotion fails。
- reviewed promotion preview returns valid YAML diff。

## Verification

WebUI Vitest:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/eval-candidates.test.ts src/__tests__/eval-candidates.test.tsx server/__tests__/eval-cases.test.ts server/__tests__/eval-runs.test.ts
```

Root verifier:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/verify-202608-safe-log-to-eval.mjs
npm run lint:terminology
```

Browser check: not required.

## Code Review Checklist

- [ ] No unreviewed candidate can enter formal Eval.
- [ ] Redaction failure is fail-closed.
- [ ] Reviewer evidence has actor metadata.
- [ ] Negative case library preserves permission-denial semantics.
