# Token 续期 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-02 |
| 授权 | 本次要求收口 Token 续期的 Spec 和 Plan |
| 对象 | [Spec v0.4](../specs/lucy-20261101-token-renewal-spec.md)；[Plan v0.4](../plans/lucy-20261101-token-renewal-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-24 有本机自动化证据。SC-25 已于 2026-11-02 拆出。**本条收口不表示可上线。** 功能编号无，不进入 v0.25 登记册 |

## 收口前改过的行为

同一次到期日、又没有 `repair: true` 时，续期现在返回 400 `EXPIRES_AT_NOT_EXTENDED`，不再当成成功写入。磁盘已经是该到期日、并且请求带了 `repair: true` 时，仍然可以补审计并 ack。这是 SC-14 和 SC-22 的合同，不是新能力。

## 这次跑过的测试

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/token-renewal-closure.test.ts \
  src/__tests__/renew-token-dialog.test.tsx \
  server/__tests__/admin-tokens.test.ts
```

收口文件与续期对话框 **25 条通过**。既有 `admin-tokens.test.ts` 在同一次收口里复跑通过，其中 6 条是续期。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | closure：hash／label／device_name／created 不变；响应无 `token`；`runtimeAck===true` |
| SC-02 | 通过 | closure：过期后 `identifyRequestDetailed` 为 `token_expired`；续期后同一明文通过，清单 `status=available` |
| SC-03 | 通过 | closure：撤销后同 label 续期 404；`revoked_tokens` 仍有该 hash |
| SC-04 | 通过 | closure：撤销表有 hash 且 YAML 残留 → 409 `TOKEN_REVOKED_NOT_RENEWABLE`，YAML 不变 |
| SC-05 | 通过 | closure：撤销表查询抛错 → 500，YAML 不变，无 `token_renew` |
| SC-06 | 通过 | closure：`delegated_from` 上 operator 403 且不落盘；owner 200 |
| SC-07 | 通过 | closure：无委托 Agent，管理员续期 200 |
| SC-08 | 通过 | closure：dryRun 200，YAML 不变，无 `token_renew`，返回 gate／proposed |
| SC-09 | 通过 | closure：近 7 日调用数 50 → `decision=warn` 且写入成功 |
| SC-10 | 通过 | closure：注入 `block` → 409，YAML 不变 |
| SC-11 | 通过 | closure：注入 `override_required`，缺 override → 409；合法 override → 200，并调用 gate trace |
| SC-12 | 通过 | closure：`changeType=token_renew`，含 actor、actorIp、targetId、label、hashPrefix、新旧 expires_at，无 `token` 字段 |
| SC-13 | 通过 | `changeTypeLabel("token_renew")` 为「续期 Token」；配置审计筛选含该选项；`redactAuditSummary` 抹掉明文 `token`、保留 hashPrefix；`agents.ts` 配置更新时间 SQL 含 `token_renew` |
| SC-14 | 通过 | closure：仍有效时缩短 → 400；同值且无 repair → 400，YAML 不变 |
| SC-15 | 通过 | closure：date-only 旧值对同一日中午 → 400 `EXPIRES_AT_NOT_EXTENDED` |
| SC-16 | 通过 | closure：2020-01-01 旧值可续到合法未来日 |
| SC-17 | 通过 | closure：缺省、空串、`permanent`、null 均可写入合法未来日 |
| SC-18 | 通过 | `renew-token-dialog.test.tsx`：打开为 today+365，仅 365d active；自定义非预设日四档都无 active |
| SC-19 | 通过 | 确认后续期列表再次 GET；Toast 为「已续期至」，无 64 位明文 |
| SC-20 | 通过 | 「30 天内到期」副题与帮助均为「续期或换签」 |
| SC-21 | 通过 | closure：ack 失败为 503，body 含磁盘 `expires_at` 与 `runtimeAck:false`；对话框失败时没有成功 Toast |
| SC-22 | 通过 | closure：同值 `repair:true` 不被「未延长」拒绝；`runtimeAck===true` 且 `token_renew` 带 `repair:true` |
| SC-23 | 通过 | closure：审计意图抛错 → 非成功，YAML 保持原到期日 |
| SC-24 | 通过 | closure：YAML 已是新值但无成功 renew 审计时，普通续期 400；repair 在审计失败时非成功；审计补齐后 200。成功断言要求存在 `token_renew`，只 ack 不算通过 |
| SC-25 | 拆出 | 术语登记与四门禁。见 [出口拆分记录](2026-11-02-functional-contract-exit-split.md) |

## 落盘清单

对照 `docs/governance/DEVELOPMENT.md`「新增 Spec / Plan 的落盘清单」：

| # | 结论 |
|---|---|
| 1 | Spec／Plan 文件名未改，编号 `lucy-20261101-token-renewal` |
| 2 | Spec §3 有核心流程伪代码 |
| 3 | Spec 有文档类型／版本／状态；Plan 有状态、授权边界、验收 |
| 4 | Plan 含目标、开工前置、验收、完成定义、风险 |
| 5 | Terminology Compliance 含规定句与 `New terms:` |
| 6 | Design System Compliance 为四段式 |
| 7 | `docs/README.md` 与 `docs/plans/README.md` 已改为 v0.4 收口 |
| 8 | 无新增命令 |
| 9 | 功能编号无；不进入 v0.25 升级台账 |
| 10 | 四门禁结果见下；本表逐条作答 |
| 11 | 闭口层级为功能合同，并写明承诺、出口、不在出口、上线关系 |

## 四门禁

过程记录，不在本条出口。仓库根目录四条命令退出码均为 0：`lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`。`lint:spec` 有两条与本条无关的既有 WARN（`chatbi_intl` 的 `paired_quiz`、`demo_readonly` 无 `permission_model_version`）。
