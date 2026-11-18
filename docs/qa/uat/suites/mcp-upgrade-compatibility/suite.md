# UAT-SUITE-MCP-UPGRADE-COMPATIBILITY — MCP 升级兼容底线与全真用户旅程

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` |
| 总账 ID | **P1-53**／REQ-030-074（升级放行＝P0 底线；不入核心分母） |
| 目标 | 每次客户候选出包与升级都证明：真实 Agent 既有问数主路径功能零回归、权限不放宽，且 MCP 耗时满足绝对／相对硬门；Agent 墙钟达目标或具备 D16a 审计例外 |
| 合同回链 | [Spec v0.2-draft](../../../../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)；[Plan](../../../../plans/lucy-20261118-mcp-upgrade-compatibility-plan.md)；[事故错题](../../../../lessons/2026-11-16-source-ambiguity-gate-deadlock.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 全真性

真实 Agent 接收自然语言，经 Public MCP、Lucy、真实数据库形成最终答案；直连 MCP 仅作确定性对照。禁止 mock 数据库、预置答案、绕过 ACL、直连 KTX `:7878`、以健康检查或 Code Review 代替。

**双入口**：出包＝`certifyCandidate`（通用包）；升级＝`certifyInstanceUpgrade`（实例 PRE／POST）。二者不得互相冒充 PASS。

**环境（Spec D20／D21）**：门禁生命周期允许按 Runbook 部署被测候选与通用车道合成夹具（用后还原）；禁止错 digest／mock 凑绿。起草或缺授权阶段缺匹配环境记 `BLOCKED`。

## 必做／可选

| Lane | 必做 | 可选 |
|---|---|---|
| 通用候选（`certifyCandidate`） | UAT-COMPAT-R0、01–12；release profile／`mcp-compat-clients.yaml` 要求的自动真实 Agent；手工 WorkBuddy／Cursor 按发布合同；COMPAT-09 **Demo 层**（ESC-11） | 无 |
| 客户实例（`certifyInstanceUpgrade`） | R0、实例适用 01–12＋09 **客户基线**；既有 Token、同一 Public MCP URL、快照 ID、PRE／POST／`ROLLBACK_VERIFY` | 无。实例声明不支持的既有能力须在 PRE 前以合同排除，不得看到 POST FAIL 后删题 |

功能／权限必做项都必须 PASS，**不接受** `PASS WITH GAP`。缺基线、样本不足、环境不可比、必做客户端缺失、NOT RUN 或 BLOCKED 均阻止对应入口放行。Agent 墙钟仅允许 Spec D16a 有限例外。

## 样本与耗时

- 确定性 MCP：每场景每版本至少 20 个有效样本，nearest-rank P95。
- 真实 Agent：每场景、每必需客户端、每版本至少 3 次；所有尝试保留，以中位数做相对判定。
- MCP 拒绝 P95≤500ms／P99≤2s；简单单表 P95≤5s；复杂多表／多库 P95≤30s（硬拦）。
- Agent 每轮端到端目标 ≤120s；越线须 D16a 审计且 MCP 对照仍绿。
- 相对 MCP：P95 增幅>20% 且>50ms 为 FAIL；Agent：中位数增幅>20% 且>2s 为 FAIL。
- 缺 PRE 基线／快照 ID 不做 `baseline-seed` PASS。

## 私有基线与公开证据

私有基线含重放所需原始参数与**数据快照 ID**，存 Git、inbox、公共交付包之外，目录 0700、文件 0600；不含 Token、Session ID、数据库密码和原始业务行。公开 runs／evidence 只含 case ID、版本身份、摘要、指标名、行列计数、耗时、重试和判定，不含过滤原值。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改 MCP 门禁、权限、口径绑定、会话、查询编译、运行时、题库或 Agent 接入 | 判定器负例＋事故同形子集（D23）；合并前建议通用全集 |
| 客户候选出包 | **`certifyCandidate` 全量**＋发布校验器反向测试 |
| 客户升级前 | 实例 PRE 全集；未 PASS 不升级 |
| 候选演练／升级后 | 同基线 POST 全集 |
| 回滚后 | `ROLLBACK_VERIFY` 同一基线再验 |

## 当前判定

**NOT RUN**。Spec／Plan **v0.2-draft**（审阅修订已落入）；无执行器落地或全真跑次；终稿未确权、开发未授权。≠ 可上线。
