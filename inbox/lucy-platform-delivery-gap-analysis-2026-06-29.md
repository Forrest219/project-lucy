# Lucy 平台交付差距分析（架构师复核）

| 元数据 | 内容 |
|---|---|
| 复核日期 | 2026-06-29 |
| 复核对象 | `inbox/lucy-platform-progress-audit-2026-06-29.md` |
| 复核方式 | 3 路并行代码/文档证据核查（API spec vs 实现、goal-checklist 验收标准 vs 代码、客户交付材料现状） |
| 结论 | 审计基本属实；差距是「收尾」级别，不是「补功能」级别 |

## 1. 复核结论：赞同审计，附 3 点修正 + 1 点补充

**赞同**：审计核心判断准确——当前不能判定 release-ready，但根因是 spec 漂移、文档状态滞后、验收证据缺口，**不是代码缺失**。逐条核查证据扎实（详见第 2 节）。

**修正 1 — P0 实际只有 1 项，工作量被审计的并列呈现方式夸大**
审计把"`lint:spec` 失败"和"Node 22/24 ABI 不一致"都列为高优先级风险，但后者只影响本机开发环境的 `npm --prefix webui test`：CI（`.github/workflows/lucy-release.yml`）固定用 Node 22 + 全新 `npm ci`，不受本机 ABI 污染。真正阻断 CI release gate 的只有 `webui/docs/03-api-spec.md` 缺 4 行端点条目，修复成本是分钟级。

**修正 2 — Skill management 应比其余 4 个 partial 项优先级更高**
其余 4 个 partial 项（Semantic layer、Wiki、MCP endpoint、Business eval）UI/API 已实现，缺口是"验收证据"或"生命周期管理细节"。Skill management 经核查 `webui/src/app` 下**没有任何 Skill Editor 路由或组件**，管理方式纯靠文件系统编辑 `skills/` 目录——这是 5 项中唯一的**真实功能缺口**，不应和其他 4 项同等级排队。

**修正 3 — `webui-feature-map.md` 的风险被低估**
该文档仍标记 `/admin/agents`、`/admin/audit`、`/eval/cases`、`/eval/runs`、`/eval/monitor` 等为"缺失"，但 `webui/src/app/App.tsx` 中这些路由和页面组件均已存在且有测试覆盖。这份文档目前的实际风险是**误导后续 agent 重复劳动或低估完成度**，应尽快重写或标记历史态，而不只是"建议处理"。

**补充 — 审计未回答用户真正要问的问题："能不能交付客户？"**
`inbox/customer-delivery-email-draft-2026-06-23.md` 和 `inbox/customer-docker-deployment-test-2026-06-23.md` 显示已做过一轮"模拟客户工程师视角"的本机 Docker 验证（Pass），release artifact 打包脚本（`scripts/release-artifacts.mjs`）能产出 source bundle、SBOM、客户向文档。这比审计文档呈现的口径更接近"已具备一次性交付能力"——但这次验证是本机模拟，**从未在当前 `lint:spec` 红灯状态后真正走完整 CI release workflow**，`release-package` job 在 CI 中实际没跑到过。"本机一次性验证 Pass" ≠ "CI release gate 可重复产出可信 artifact"，这是交付客户前最关键、但审计完全没提到的一环。

## 2. 关键证据核查摘要

| 审计声称 | 核查结果 | 证据 |
|---|---|---|
| API spec 缺 4 个 Admin Audit 端点 | 确认 | spec 文档 `webui/docs/03-api-spec.md` 只列 3 个；代码 `webui/server/admin/audit.ts:486,777,886,952` 已实现全部 4 个 |
| `lint:spec` 是真实 CI 阻塞项 | 确认 | `.github/workflows/lucy-release.yml` 中 `spec-and-webui` job 是 `business-eval-catalog`/`ktx-diff-audit`/`docker-smoke` 的 `needs` 前置 |
| Node ABI 问题影响 CI | 不成立，仅影响本机 | CI 固定 Node 22 + 全新 `npm ci`；审计文档本身也承认"CI 理论上不受本机 ABI 污染影响" |
| Skill management 缺 WebUI 管理能力 | 确认 | `webui/src/app` 内无任何 `*[Ss]kill*` 路由/组件，仅文件系统操作 `skills/` 目录 |
| `webui-feature-map.md` 过期 | 确认 | 文档标"缺失"的 Admin/Eval 路由在 `App.tsx` 中均已实现并有测试 |
| MCP Client Matrix 口径不一致 | 确认 | `goal-checklist.md` 称 5 客户端已于 2026-06-24 人工验收；`docs/version-matrix.md` 仍写 cloud-hosted agent "not verified" |
| Access governance 30s revoke 延迟是遗留缺口 | 不成立，是既定决策 | `docs/access-governance-design.md` DC1（2026-06-22）已明确决策本轮接受 30s TTL，非待修项 |

## 3. TODO（按交付优先级分级）

### P0（交付前必须，预计 ~10 分钟改动 + 1 次 CI 全流程验证）
- [ ] 补 `webui/docs/03-api-spec.md` 中缺失的 4 个端点：`GET /api/admin/audit/:id/sources`、`GET /api/admin/audit/turns`、`GET /api/admin/audit/turns/:turnId`、`POST /api/admin/audit/conversation-turns/purge`，使 `npm run lint:spec` 回绿。
- [ ] spec 回绿后，**打 tag 或手动 `workflow_dispatch` 跑一次完整 `lucy-release.yml`**，确认 `release-package` job 真正产出 artifact（这是当前从未在红灯修复后验证过的环节，是交付客户前的硬性前提）。

### P1（交付前应该做）
- [ ] 统一本机开发 Node 版本指引（建议直接定为 Node 22，与 CI 对齐，避免新 agent/新人再次复现 ABI 报错），并在 README 或 webui/docs 中记录。
- [ ] 重写或标记历史态：`docs/webui-feature-map.md`、`webui/docs/codex/progress.md`，避免继续误导后续读者低估完成度。
- [ ] 统一 `docs/version-matrix.md` 与 `goal-checklist.md` 的 MCP client 验收口径，避免对客户的对外宣称前后矛盾。

### P2（可在客户首轮试用期间并行推进，不阻塞首次交付）
- [ ] Semantic layer / Wiki：补齐 reindex 闭环、KTX wiki 检索命中的验收证据，把 partial 升级为 verified。
- [ ] MCP endpoint management：补端点生命周期管理（启停/状态），当前仍是运维脚本形态。
- [ ] Business eval：在客户向文档中明确"完整 LLM/agent eval 依赖外部环境"具体意味着什么（是否需要客户自带模型 key），避免客户期望落差。

### P3（明确为后续版本，不阻塞首次交付，但要写进客户预期管理材料）
- [ ] Skill management 的 WebUI 编辑器/版本化/eval 回归闭环。当前用文档说明文件系统操作方式替代，并在客户沟通材料中注明"已知限制，下一版本计划"。

### 风险记录（无需修复，但需要在客户沟通中显式提及）
- Access governance 30s 权限撤销 TTL 是 DC1（2026-06-22）的既定权衡决策，非临时缺口。建议在客户合同/SLA 沟通材料中主动说明，避免客户事后因未被告知而产生信任问题。

## 4. 总体判断

当前差距属于"收尾"而非"补功能"：核心实现（Docker/KTX runtime、WebUI 治理工作台、Auth/ACL/Audit、Eval 管理、demo 数据库、release CI、客户交付文档）均已落地。真正阻塞交付的硬性前提只有两件事：**修复 spec 漂移** + **在 CI 绿灯状态下完整跑通一次 release workflow**。预计 1-3 个工作日可达到"可控发布给客户试用"状态；Skill management 的 WebUI 化是唯一应当推迟到下一版本、但需要提前向客户说明的功能性缺口。
