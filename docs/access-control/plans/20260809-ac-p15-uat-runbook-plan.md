# AC-P1.5 UAT / Runbook 路径 D 自动化测试计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1.5 UAT / Runbook Path D 自动化计划 |
| 文档类型 | Checklist |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `uat-ac-p15.md`；`runbook-row-policy.md` 路径 D；Spec 100；环境 `lucy-ac-p1-by01` |
| 适用范围 | Gate C 前：Admin API + Playwright 模拟用户操作；证据落 `inbox/20260809-ac-p15-uat/` |
| 输出位置 | `docs/access-control/plans/20260809-ac-p15-uat-runbook-plan.md` |

> **For Agent:** 执行脚本 `scripts/ac-p15-uat-runbook.mjs`；完成后更新 `uat-ac-p15.md` / Runbook 签字栏（自动化项）。

---

## 0. 目标

在已运行的 Docker 集成环境中，用 **Admin API（控制面）+ Playwright（WebUI 用户操作）** 完成 AC-P1.5 UAT 与 Runbook 路径 D，不依赖 Vitest mock 作为唯一证据。

## 1. 环境

| 项 | 值 |
|---|---|
| Compose project | `lucy-ac-p1-by01` |
| WebUI | `http://127.0.0.1:55176` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` |
| 默认 proven | 启动时以 `docker-compose.ac-p1-by01-proven-off.yml` 或 env `false` 为准；MCP 注入抽检再临时置真 |
| 证据目录 | `inbox/20260809-ac-p15-uat/` |

前置：

```bash
# 源码 bind-mount 下：重建前端 + 重启 lucy 以加载最新 server
cd webui && npm run build
docker restart lucy-ac-p1-by01-lucy-1
# 等待 healthy 后再跑脚本
```

## 2. Fixture（脚本创建 / 清理）

| 对象 | 用途 |
|---|---|
| Role `demo_readonly`（已有） | `row_access: all` → OR/EffectiveRowGrant=TRUE |
| Agent `acp15_uat_agent` | 绑定 `demo_readonly`；演练 constraints |
| Token `acp15-uat-T1`（可选） | MCP 抽检；结束 revoke |

约束字段：`superstore_orders.region`（demo overlay 已有 columns）。

## 3. 用例矩阵

### 3.1 Admin API（模拟保存 / dryRun / 恢复）

| ID | 步骤 | 期望 |
|---|---|---|
| UAT-A1 | dryRun 合法 constraints `region eq East` | 200；diff 含 constraints；capability `finalRows.kind=scoped` + `protected` + summary |
| UAT-A2 | dryRun=false 保存 | `runtimeAck===true` + `policyVersion` |
| UAT-A3 | GET Agent 权限预览 | FinalRows scoped；文案禁止「行级取数已生效」出现在成功声称语境 |
| UAT-A4 | dryRun mixed names | 400 `constraints_source_not_in_capability`；YAML 不变 |
| UAT-A5 | dryRun 不可满足 | 400 `final_rows_unsatisfiable` |
| UAT-A6 | Role PATCH `constraints` | 400（Role forbidden） |
| UAT-A7 | `constraints: null` 清除 | `runtimeAck`；constraints 消失；FinalRows 回 TRUE/`all` |
| RB-D1…D3 | 同 A4/A5/A2 — Runbook 路径 D 误配→修复 | 见上 |

### 3.2 Playwright WebUI（模拟用户）

| ID | 步骤 | 期望 |
|---|---|---|
| UI-1 | 打开 `/admin/agents/acp15_uat_agent` | Constraints 编辑器可见；含「不表示行级取数已生效」 |
| UI-2 | 添加源约束 → 填 connection/schema/names/field/value → 保存确认 | 确认框含 FinalRows；保存成功依赖 runtimeAck |
| UI-3 | 权限预览 tab | FinalRows / protected / constraints= 可见；无虚假「已生效」成功态 |
| UI-4 | 截图 | `screenshots/*.png` |

### 3.3 MCP 抽检（可选，proven 门禁）

| ID | 步骤 | 期望 |
|---|---|---|
| MCP-1 | proven=false：`lucy_query` | `row_policy_upstream_unproven` |
| MCP-2 | 未包装 `lucy_read_source` | `row_policy_requires_wrapped_tool` |

## 4. 执行命令

```bash
# 仓库根
node scripts/ac-p15-uat-runbook.mjs
# 环境变量可选：
#   ACP15_WEBUI_BASE=http://127.0.0.1:55176
#   ACP15_SKIP_UI=1          # 仅 API
#   ACP15_SKIP_MCP=1         # 跳过 MCP 抽检
```

退出码：0=全绿；非 0=有失败（见 `00-results-summary.json`）。

## 5. 证据文件

| 文件 | 内容 |
|---|---|
| `00-results-summary.json` | 用例 pass/fail |
| `api/*.json` | 每次 Admin/MCP 响应 |
| `screenshots/*.png` | Playwright |
| `09-process-and-conclusion.md` | 过程结论（供签字） |

## 6. 成功标准

- UAT-A1…A7 全 PASS  
- UI-1…UI-3 全 PASS（或 `ACP15_SKIP_UI` 时书面豁免）  
- MCP-1 PASS（默认 proven=false）  
- 无残留 `acp15_uat_agent` constraints（清理到无约束或删除 Agent）  
- Non-Claim：release notes 文件存在且不含 Dynamic RLS / TokenScope 行收紧声称（脚本静态检查）

— 完
