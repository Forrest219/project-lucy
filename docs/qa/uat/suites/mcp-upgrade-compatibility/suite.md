# UAT-SUITE-MCP-UPGRADE-COMPATIBILITY — MCP 升级兼容底线与全真用户旅程

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` |
| 总账 ID | **P1-53**／REQ-030-074 |
| 目标 | 每次客户候选出包与升级都证明：真实 Agent 既有问数主路径功能零回归、权限不放宽，且用户端到端耗时同时满足绝对上限与相对不回退 |
| 合同回链 | [Spec](../../../../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)；[Plan](../../../../plans/lucy-20261118-mcp-upgrade-compatibility-plan.md)；[事故错题](../../../../lessons/2026-11-16-source-ambiguity-gate-deadlock.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 全真性

真实 Agent 接收自然语言，经 Public MCP、Lucy、真实数据库形成最终答案；直连 MCP 仅作确定性对照。禁止 mock 数据库、预置答案、绕过 ACL、直连 KTX `:7878`、以健康检查或 Code Review 代替。

**本任务不重建 Docker。** 不执行 `demo:upgrade`、`docker build`、容器或卷重建；只复用现有匹配实例。没有目标 PRE／候选／真实客户端时，对应项 `BLOCKED`，不得造假 PASS。

## 必做／可选

| Lane | 必做 | 可选 |
|---|---|---|
| 通用候选 | UAT-COMPAT-R0、01–12；release profile 要求的自动真实 Agent 客户端；手工 WorkBuddy／Cursor 按发布合同提供证据 | 无 |
| 客户实例 | R0、01–12 中实例适用全集＋09 的实际会员收入基线；既有 Token、同一 Public MCP URL、PRE／POST／回滚后 | 无。实例声明不支持的既有能力须在 PRE 前以合同排除，不得看到 POST FAIL 后删题 |

所有声明必做项都必须 PASS。客户升级放行**不接受** `PASS WITH GAP`；缺基线、样本不足、环境不可比、必做客户端缺失、NOT RUN 或 BLOCKED 均阻止放行。

## 样本与耗时

- 确定性 MCP：每场景每版本至少 20 个有效样本，nearest-rank P95。
- 真实 Agent：每场景、每必需客户端、每版本至少 3 次；所有尝试保留，以中位数做相对判定。
- 拒绝 P95≤500ms／P99≤2s；简单单表查询 P95≤5s；复杂多表／多库 P95≤30s；Agent 每轮端到端≤120s。
- 相对 MCP：P95 增幅>20% 且>50ms 为 FAIL；Agent：中位数增幅>20% 且>2s 为 FAIL。
- 任一绝对上限越线直接 FAIL；缺 PRE 基线不做 `baseline-seed` PASS。

## 私有基线与公开证据

私有基线含重放所需原始参数，存 Git、inbox、构建上下文与公共交付包之外，目录 0700、文件 0600；不含 Token、Session ID、数据库密码和原始业务行。公开 runs／evidence 只含 case ID、版本身份、摘要、指标名、行列计数、耗时、重试和判定，不含过滤原值。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改 MCP 门禁、权限、口径绑定、会话、查询编译、运行时、题库或 Agent 接入 | 通用全集 |
| 客户候选出包 | 通用全集＋发布校验器反向测试 |
| 客户升级前 | 实例 PRE 全集；未 PASS 不升级 |
| 候选演练／升级后 | 同基线 POST 全集 |
| 回滚后 | 同一基线再验，证明业务恢复而非只恢复镜像 |

## 当前判定

**NOT RUN**。当前只有合同与测试台登记，没有执行器落地或全真跑次；终稿未确权、开发未授权。≠ 可上线。
