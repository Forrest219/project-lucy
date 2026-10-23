# 人工 GUI E2E 清单（WorkBuddy + Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 版本 | v1.1 / 2026-10-18 |
| 口径 | Spec R4 v4 方案 A：GUI 永远人工执行；客户 GO 仍 required；raw pack 字段对 verifier 透明，禁止字段重写 |
| 对应登记 | `docs/qa/real-e2e-clients.yaml`（`execution: manual`） |

## 0. 使用约定

- 自动化 runner **不**驱动本清单；结果写入 `results/manual/<product>.json`（run-scoped，由 verifier 直读 raw 校验），并汇总进 release evidence 的 `manualClients`。
- 每个产品独立 Token；MCP 配置从本 run 的 WebUI 复制，禁止改连 demo 栈或 `:7878`。
- 问句只使用本 run gold 登记表中的**问题文本**，不得打开 `checker/gold.json` 看答案。
- `execution` 与 `transport` 必须原样写 `"manual"` 与 `"gui"`；verifier 看到 `"automated"`/`"cli"` 直接 `manual_wrong_execution` / `manual_wrong_transport`。assembly 不会改写这两个字段。
- `operator` 不允许空白字符；`completedAt` 必须是合法 ISO 时间，必须在 `run.createdAt` 之后、不得在当前时刻 5 分钟之后；任何 2040 类未来时间戳一律 `manual_future_timestamp` 失败。
- 每一步必须独立附带一份证据文件：`evidencePath`（相对 run 根的 `results/manual/...json`）+ `evidenceSha256`（64 位十六进制）。verifier 在 read 时再算 SHA256，对不上即 `manual_step_evidence_hash_mismatch`。

## 1. 每产品必做（WorkBuddy / Cursor Agent GUI 各一份）

| 步骤 | 操作 | 通过标准 | 必含证据 |
|---|---|---|---|
| M-01 | 导入本 run MCP（含 Bearer） | 客户端能列出 Lucy 工具，无鉴权错误 | 工具列表截图 / JSON 导出 |
| M-02 | 用 finance Agent 问「最近 28 天获客成本…」 | 金额与口径正确；服务端有对应 query + trace | 服务端 trace + 客户端回答 |
| M-03 | 用 sales Agent 问 finance Wiki 原文 | 明确拒绝；无 finance canary | 拒绝截图 + 审计 trace |
| M-04 | 停用/吊销 Token 后再问 | 全通道拒绝 | 拒绝截图 + Token 状态截图 |
| M-05 | 导出问询包 / 核对访问日志 | 明确上报与推断记录分开；候选关联不冒充已确认关联；客户端名不被改写 | 导出包 + 访问日志 |

## 2. 结果文件形状

```json
{
  "product": "workbuddy",
  "execution": "manual",
  "transport": "gui",
  "status": "passed",
  "operator": "<real name>",
  "completedAt": "2026-10-18T11:00:00.000Z",
  "runId": "<current run id>",
  "productVersion": "<optional>",
  "notes": "<free text>",
  "steps": [
    { "id": "M-01", "passed": true, "evidencePath": "results/manual/workbuddy-M-01-tools.json", "evidenceSha256": "<64-hex>" },
    { "id": "M-02", "passed": true, "evidencePath": "results/manual/workbuddy-M-02-finance.json", "evidenceSha256": "<64-hex>" },
    { "id": "M-03", "passed": true, "evidencePath": "results/manual/workbuddy-M-03-wiki-deny.json", "evidenceSha256": "<64-hex>" },
    { "id": "M-04", "passed": true, "evidencePath": "results/manual/workbuddy-M-04-token-revoke.json", "evidenceSha256": "<64-hex>" },
    { "id": "M-05", "passed": true, "evidencePath": "results/manual/workbuddy-M-05-export.json", "evidenceSha256": "<64-hex>" }
  ],
  "artifact": { "path": "results/manual/workbuddy.json", "sha256": "<sha256 of this file's raw bytes>" }
}
```

约束：

- 步骤必须正好 5 条、`M-01`→`M-05` 一次、顺序固定；任何缺失、重复或乱序 → `manual_bad_steps`。
- 任一 `steps[].passed=false` → 顶层 `status` 必须是 `"failed"`；否则 → `manual_forged_top_passed`。
- 缺文件 → verifier `missing_pack`（blocked，不可 GO）。
- 顶层 `artifact.sha256` 若写了，必须是 64 位 hex；verifier 不会拿它和文件字节 SHA 比对（自指 SHA 在 JSON 里不可能成立）。**真实的篡改检测来自** verifier 用其重新读取的 raw 字节 SHA 与 assembly 阶段记录的 `evidence.manualClients[i].artifact.sha256` 比对，文件一旦被改 → `manual_artifact_hash_mismatch`。
- `runId` 必须等于本次 run；不同 / 缺失 → `manual_wrong_run` / `manual_empty_run`。
