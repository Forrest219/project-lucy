# WorkBuddy「会员收入」门闩事故：重建后能力评估与出包判定

| 元数据 | 内容 |
|---|---|
| 文档名称 | WorkBuddy 会员收入门闩事故重建后能力评估与出包判定 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-18 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | 客户截图（WorkBuddy：`source_ambiguity_gate`＋「缺少真实 Schema 证据」）；错题 [`2026-11-16-source-ambiguity-gate-deadlock.md`](../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；P1-35 Spec／ESCAPE UAT；重建容器 `gitSha=7ebedd4eb79b…`；跑次 [ESCAPE post-rebuild](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md) |
| 适用范围 | 交付用户前：该报障是否已在候选镜像具备可用能力；是否足以「输出镜像给用户试用」。**仅评估＋UAT；未新建 Spec；未改运行代码** |
| 输出位置 | `docs/reviews/2026-11-18-workbuddy-member-income-uat-capability-assessment.md` |

## 1. 一句话结论

**候选 demo 镜像上，该事故类主路径（泛化业务词＋已钉唯一表＋未限定 filter）已可用，ESCAPE 28/28＋ESC-11 同形 PASS；但客户 `finance` 真表／WorkBuddy 私有基线未跑，按 COMPAT 合同不得宣称客户出包／升级已验收。**

## 2. 报障与修复映射

| 客户现象 | 根因合同 | 修复条目 | 本波验证 |
|---|---|---|---|
| 写死 `bidm.viz_dm_hs_pl_metric_sum` 仍 `source_ambiguity_gate` | P0-3 触发不看钉选；纯 MCP 无 confirm | **P1-35** D1／D10 钉选／容错放行 | ESC-01／11 PASS |
| 候选全员「缺少真实 Schema 证据」；`usableTargets=[]` | D14 假 `schemaExists=null` | P1-35 **D5** 证据真接线＋ESC-08 H1 | ESC-08 usable 非空；ESC-11 无 Schema 假文案 |
| 宿主 confirm 仅 WorkBuddy 侧可达 | person＋attestation | 保留 403（不得伪造） | ESC-03＝403 PASS |
| 「17:27 全线收紧」 | 误归因 | 错题本已证＝词命中差异 | 本波不重开 |

## 3. 能力边界（诚实）

| 能证明 | 不能证明 |
|---|---|
| `7ebedd4e` 镜像含 P1-35（相对旧实例 `3a9f0711` 有祖先关系） | 客户 StarRocks／`finance` 语义层与 ACL 形状 |
| demo 同形：中文客户原文问句＋未限定 filter＋钉选首次成交 | WorkBuddy 真实 Agent 端到端墙钟／重试行为 |
| 硬线仍在：幽灵引用／跨连接／超上限 | `UAT-COMPAT-09` 客户私有基线（BLOCKED） |
| 夹具还原后 demo 三表目录仍健康 | 旧版 MCP 负控（`lucy-old3a9` 无 MCP 端口） |

## 4. UAT 结果摘要

| 套件 | 结果 | 跑次 |
|---|---|---|
| `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` | **PASS**（含 ESC-11） | [2026-11-18-cursor-sag-escape-post-rebuild](../qa/uat/suites/source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md) |
| `UAT-SUITE-SOURCE-AMBIGUITY`（SAG-01 v3） | **PASS** | [2026-11-18-cursor-sag-hardline-post-rebuild](../qa/uat/suites/source-ambiguity-gate/runs/2026-11-18-cursor-sag-hardline-post-rebuild.md) |
| `UAT-SUITE-MCP-UPGRADE-COMPATIBILITY` | **NOT RUN／客户层 BLOCKED** | 终稿未确权；无客户基线；本任务未宣称 PASS |

## 5. UAT 用例优化（已落地，无改代码）

1. 新增必做 **`UAT-SAG-ESC-11`**：WorkBuddy 原文问句同形出包看守。  
2. **`UAT-COMPAT-09`** 明确 Demo 层＝挂 ESC-11；客户层＝私有基线，无基线不得出包声称 PASS。  
3. fixtures 补 ESC-11 问句／filter 与夹具脚本路径。

## 6. 出包建议（给委托人）

| 场景 | 建议 |
|---|---|
| 内部／试用镜像（已知 demo 同形已绿，接受「客户真表未验」缺口） | **可以**基于本波 ESCAPE PASS 推进候选镜像试用；须书面披露缺口 |
| 对客户宣称「会员收入事故已在其环境验收」 | **不可以**——须补 COMPAT-09 客户基线或现场同参重放 |
| 再改运行代码／新建 Spec | **未授权**；本评估不构成开发授权 |

## 7. 地址

- WebUI：http://127.0.0.1:55176  
- MCP Proxy：http://127.0.0.1:57881  
