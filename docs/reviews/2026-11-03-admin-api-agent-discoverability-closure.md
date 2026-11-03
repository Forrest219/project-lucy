# Admin API Agent 可发现性 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-03（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261103-admin-api-agent-discoverability-spec.md`](../specs/lucy-20261103-admin-api-agent-discoverability-spec.md)（收口后 **v0.4**） |
| Plan | [`docs/plans/lucy-20261103-admin-api-agent-discoverability-plan.md`](../plans/lucy-20261103-admin-api-agent-discoverability-plan.md) |
| 审阅 | [`docs/reviews/2026-11-03-codex-review-admin-api-agent-discoverability.md`](2026-11-03-codex-review-admin-api-agent-discoverability.md) |
| 台账号 | 无 |
| 层级 | **功能合同** |
| 结论 | **SC-01–SC-20 全部关闭。** 本条收口**不表示可上线**——浏览器 E2E、Docker 重建、客户交付、MCP `lucy_ops_*` 开通工具不在本条出口 |
| 授权 | 同会话用户批准定稿后落地；2026-11-03 用户要求收口 |
| 实现提交 | `10577964`（`feat(admin-api): 公开 OpenAPI 与开通人体工程学，便于脚本发现契约`） |

---

## 一、出口矩阵（逐条 SC → 用例）

**证据等级：本机自动化（vitest）＋ 本地文档门禁。** 无 CI job 证据，无客户环境证据。

| SC | 结果 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | `admin-openapi-discoverability.test.ts`「SC-01 public OpenAPI lists exactly the D2 operations and the live router」 |
| SC-02 | 通过 | 同文件「SC-02 declares login, issue, revoke, role PATCH and per-operation dryRun」 |
| SC-03 | 通过 | 同文件「SC-03 required mode without a session returns AUTH_REQUIRED for a real route」 |
| SC-04 | 通过 | 同文件「SC-04 wrong methods are 405 for anonymous and signed-in callers, and CSRF still wins」 |
| SC-05 | 通过 | 同文件「SC-05 a signed-in caller gets 404 for an unknown admin path」 |
| SC-06 | 通过 | 同文件「SC-06 unknown paths are 404 without a session, and public/auth modes stay intact」 |
| SC-07 | 通过 | `admin-tokens.test.ts`「SC-07 duplicate label returns a non-sensitive existingToken」 |
| SC-08 | 通过 | `admin-agents.test.ts`「SC-08 missing id or name returns expected and a nested agent example」 |
| SC-09 | 通过 | 同文件「SC-09 preview omits after and still returns gate」 |
| SC-10 | 通过 | 同文件「SC-10 fixture A…」「SC-10 fixture B…」 |
| SC-11 | 通过 | `admin-tokens.test.ts`「SC-11 expires_in 365d matches the fixed t0 preset」 |
| SC-12 | 通过 | 同文件「SC-12 accepts equal expiry fields and rejects a conflict」 |
| SC-13 | 通过 | 同文件「SC-13 rejects expires_in 7d」 |
| SC-14 | 通过 | 同文件「SC-14 gates clientConfigs on a configured MCP endpoint」 |
| SC-15 | 通过 | 同文件「SC-15 omits clientConfigs unless includeClientConfigs is true」 |
| SC-16 | 通过 | `admin-agents.test.ts`「SC-16 confirmed create returns after and a failed write does not」 |
| SC-17 | 通过 | `admin-openapi-discoverability.test.ts`「SC-17 OpenAPI states the owner gate…」 |
| SC-18 | 通过 | Spec／Plan／`docs/README.md`／`docs/plans/README.md` 状态段逐字一致；本 Spec／Plan 未引入 `lint:spec-docs` 新增阻塞 |
| SC-19 | 通过 | `admin-tokens.test.ts`「SC-19 dryRun shares resolve_expiry and skips mint plus endpoint failures」 |
| SC-20 | 通过 | `token-renewal-closure.test.ts`「SC-20 omits dryRun to renew for real and dryRun true leaves expires_at unchanged」 |

**实测（2026-11-03 复跑）**：对本 Spec SC 标题过滤后 **4 文件 / 32 条全绿**（另 71 条 skipped）。全文件跑时 `admin-agents.test.ts` 另有 1 条与本 Spec 无关的 `?range=30d` 既有失败，**不计入本条出口**。

## 二、残余（不阻塞收口）

1. 浏览器 E2E、Docker 重建、客户环境——按闭口层级不在本条出口。
2. `lucy_ops_token_issue`／`lucy_ops_agent_apply`——后续衔接，不在本条出口。
3. 仓库 `lint:spec-docs` 仍可能因**无关**未跟踪／错名 prompt 文件告警或阻塞；与本 Spec／Plan 无关。
4. `admin-agents` 的 `range=30d` 用例失败——用量窗口既有问题，非本条 SC。

## 三、复现命令

```bash
cd webui
npx vitest run \
  server/__tests__/admin-openapi-discoverability.test.ts \
  server/__tests__/admin-tokens.test.ts \
  server/__tests__/admin-agents.test.ts \
  server/__tests__/token-renewal-closure.test.ts \
  -t 'SC-01|SC-02|SC-03|SC-04|SC-05|SC-06|SC-07|SC-08 missing|SC-09 preview|SC-10 fixture|SC-11 |SC-12 |SC-13 |SC-14 |SC-15 |SC-16 confirmed|SC-17 |SC-19 |SC-20 omits' \
  --maxWorkers=1
```

## 四、不在本次收口里

- 上线、镜像、客户交付、发布取证。
- 帮助手册补写（另批；不构成本条 SC）。
