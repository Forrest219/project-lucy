# ADR — AC-P1.5 后路线图冻结（单机部署优先）

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1.5 后路线图冻结决策 |
| 文档类型 | ADR |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `design-upgrade.md` v1.1.2 §1.3 / §7 / §8；WO-59/60/61 Gate C 已交付；2026-08-09 产品讨论（不处理同 Agent 多 Token / 多租户；优先单机部署体验） |
| 适用范围 | 访问权限升级域在 **AC-P0 / AC-P1 / AC-P1.5 交付之后**的后续开波禁令与优先事项；约束 Spec / Plan / Release notes 口径 |
| 输出位置 | `docs/access-control/adr-post-p15-roadmap-freeze.md` |
| 状态 | **已批准（2026-08-09，xingchen）** |

---

## 0. 状态与裁决

| 项 | 内容 |
|---|---|
| 状态 | **已批准** |
| 本批准生效前提 | AC-P0 / AC-P1 / AC-P1.5 Gate C 均已签字（WO-59 / WO-60 / WO-61） |
| 本批准授权 | 将访问权限升级主线标为**收束**；后续以单机部署落地与体验补齐为优先 |
| 本批准**不**授权 | 开 TokenScope、Dynamic RLS / 多租户 claim、AC-P2+ 整包、或任何「看起来像下一权限波次」的 runtime 大改 |
| 冲突裁决 | 与本文冲突的「下一步做 TokenScope / Dynamic RLS / P2+」口头计划或草稿 Spec → **以本文为准**，须先修订本文或另批推翻 |
| 禁止依据 | `feasibility-row-acl.SUPERSEDED.md`；不得把 SUPERSEDED L2 动态声明当作开工理由 |

**一句话：** 静态权限主线（Capability → Row Policy → Agent Constraints）已交付；**当前不处理**同 Agent 多 Token 行域分化、也不处理多租户 Dynamic RLS；把精力放在**单机部署能力用满**，覆盖绝大多数企业内网实际体验。

---

## 1. 背景

访问权限升级按设计分波已完成：

| 波次 | 交付要点 | Gate C |
|---|---|---|
| AC-P0 | Capability 合成、工具三分级、EffectivePolicy、版本迁移 | 2026-08-09 |
| AC-P1 | `scoped` + `row_policy`、行授予 OR、强制谓词载体 | 2026-08-09 |
| AC-P1.5 | Agent Constraints、`FinalRows = Grant AND Constraints` | 2026-08-09 |

`design-upgrade.md` §7 将 **AC-P2+**（Active Role、Dynamic claim、CLS、DB 原生 RLS）标为冻结；WO-61 将 **TokenScope** 钉为本波 ≡ TRUE（O-P15-1）。P1.5 Gate C 后若无书面冻结，路线图易再次漂移为「继续做权限波次」。

产品确认（xingchen，2026-08-09）：

- **不**处理「同 Agent 多 Token」不同行域场景；
- **不**处理多租户 / Dynamic RLS 场景；
- **优先**补齐单机部署能力与体验，足以服务绝大多数企业客户。

---

## 2. 决策（Normative）

### 2.1 冻结项（默认不做）

| ID | 议题 | 决策 | 说明 |
|---|---|---|---|
| F1 | **TokenScope**（Token 级行收紧） | **不做** | `TokenScope ≡ TRUE` 保持；Token 只鉴权、不改变行域 |
| F2 | **同 Agent 多 Token 不同行域** | **不做** | 需要隔离时用**多个 Agent**（各配 Constraints），不引入 Token 第二权限面 |
| F3 | **Dynamic RLS / Dynamic claim / 多租户** | **不做** | 无产品级多租户 / SSO claim 事实源前禁止开波 |
| F4 | **AC-P2+ 整包** | **不立项** | Active Role、CLS、DB 原生 RLS、Dynamic claim 等**禁止**捆成一波；将来若做须**按议题另立 WO** |
| F5 | 对外声称 | **禁止** | Release notes / 销售 / 文档不得声称 Dynamic RLS、多租户隔离、TokenScope 行收紧、DB 原生 RLS「已交付」 |

### 2.2 当前优先（允许做，且不算新权限波次）

下列工作**不属于** AC-P2 / TokenScope / Dynamic RLS，可在无新 Gate A 的前提下按运维与产品体验推进：

| ID | 优先事项 | 成功标准（示例） |
|---|---|---|
| P1 | 单机 / 内网部署路径跑顺 | Compose / 安装文档可复现；健康检查与降级 banner 可理解 |
| P2 | proven 按环境运维启用（可选） | 目标环境显式变更 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`；默认真值仍为 false；可回滚 |
| P3 | 真实 `access.yaml` 落地 | Role `scoped` + Agent `constraints` 覆盖企业常见职责包；Admin dryRun → 保存 → MCP 抽检闭环 |
| P4 | 体验与可运维性 | Runbook 演练、错误文案、配置误操作恢复；不为「新权限模型」开 Spec |

### 2.3 将来重新开波的硬条件（须另批）

| 议题 | 最低开工条件 |
|---|---|
| TokenScope | 存在**不可**用「拆成两个 Agent」替代的生产用例：同一 Agent 身份下多 Token **必须**不同行域；且书面接受 Token 成为第二收窄面 |
| Dynamic RLS / 多租户 | 产品范围明确包含多租户或 SSO claim；租户边界与身份事实源已设计；另立 WO + Gate A（新契约） |
| CLS / Active Role / DB RLS | 各自有独立业务驱动与威胁模型；**禁止**借「P2+」名义打包开工 |
| op 扩展（`ne` / 范围比较） | 有明确字段过滤需求；仍属**静态** `access.yaml` 模型，可另立小 WO，**不**等于 Dynamic RLS |

未满足上表条件而发起的 Spec / runtime PR，评审应 **BLOCK**，并引用本文。

---

## 3. 决策依据

### 3.1 主线已闭合设计目标

- G3（capability 无笛卡尔）→ AC-P0  
- G4（行授予 OR + 人级 Constraints AND）→ AC-P1 + AC-P1.5  
- 工具三分级、canonical key、编译提交、强制谓词 fail-closed → 已交付  

在「一人一 Agent、配置期静态权限」产品形态下，**企业内网单机部署的核心授权故事已经完整**。继续做 TokenScope / Dynamic RLS 不是「补缺口」，而是换产品形态。

### 3.2 TokenScope 边际价值低

- 设计原意：多 Token **只鉴权、同权**；人级收紧挂在 Agent Constraints。  
- 同 Agent 多 Token 不同行域可用 **多个 Agent** 表达，模型更简单、审计更清晰。  
- TokenScope 会新增 schema、编译、Admin、旁路矩阵与「Token 当第二权限系统」的误用面，ROI 不足。

### 3.3 Dynamic RLS / 多租户无产品前提

- `design-upgrade.md` §1.1 / §1.3 明确与 Dynamic 多租户解耦；202608 亦不做 Dynamic RLS。  
- 当前无稳定租户 claim / Admin SSO 作为请求级事实源。  
- 半套 ABAC 易导致对外误声称「多租户隔离」，安全与合规风险高于收益。

### 3.4 AC-P2+ 整包会制造路线图混乱

- Active Role、CLS、DB RLS、Dynamic claim 驱动力不同。  
- 整包开波稀释 Gate 纪律，重复「设计未冻却已开工」的历史风险。  
- 正确姿势：需要哪块、单独立项；默认继续冻结。

### 3.5 单机部署优先的产品判断

产品确认：当前客户价值主要来自**可部署、可配置、可审计的单机 / 内网体验**，而非多租户平台能力。  
故资源应投向 proven 运维、真实配置落地与体验补齐，而非新权限代数。

---

## 4. 后果与文档义务

| 义务 | 说明 |
|---|---|
| 域 README | §1 / §5 必须指向本文；波次表不得暗示「下一步默认 P2 / TokenScope」 |
| WO-61 等收尾文 | 「下一步 TokenScope」须改为「见本 ADR；默认不做」 |
| 新 WO | 权限域新开波须引用本文；若触及 F1–F4，须先修订本文或产品书面推翻 |
| Release notes | 继续遵守 Non-Claim（无 Dynamic RLS / TokenScope / 多租户隔离） |
| `design-upgrade.md` | 本文**不替代** v1.1.2 设计正文；对「P1.5 之后是否开 P2」的执行裁决以本文为准 |

---

## 5. 审核记录

| 项 | 签名 | 日期 | 结论 |
|---|---|---|---|
| 决策正文 | Cursor Agent（起草） | 2026-08-09 | 提交批准 |
| **产品批准** | **xingchen** | **2026-08-09** | **批准**（确认：不处理同 Agent 多 Token / 多租户；优先单机部署能力补齐） |

— 完
