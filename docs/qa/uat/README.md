# Lucy UAT（测试台唯一 SOT）

| 元数据 | 内容 |
|---|---|
| 定位 | **测试台唯一 SOT**：客户场景复现／回归 UAT（用例 + fixtures + 跑次）；供 Cursor／Claude 交叉验证 |
| 判定真源 | [`INDEX.md`](INDEX.md)（套件总表 + 最近跑次结果） |
| 用例真源 | `suites/<suite>/cases.md`（步骤／期望）；`fixtures.md`（环境）；`runs/`（某次证据） |
| 非定位 | 不替代功能 Spec 收口（开发台）；不替代产品线总账（需求台）；不替代发布取证整包；绿灯 ≠ 可上线 |
| 三台规则 | [`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」；勾连 [`e2e-ledger.md`](../../governance/e2e-ledger.md) |
| 约定 | [`CONVENTIONS.md`](CONVENTIONS.md) |
| 辅助脚本 | 仓库 `scripts/uat/`（种子／矩阵／ledger lint；**不是**判定 SOT） |
| 密钥 | **只写凭据文件路径**；禁止把密码写入本树、inbox、截图说明或回复 |
| 旧目录 | [`docs/uat/`](../../uat/README.md) 已降为**历史归档／重定向**，不得当作现行测试台或新开用例落点 |

## 树

```text
docs/qa/uat/
  README.md                 ← 你在这里（唯一入口说明）
  INDEX.md                  ← 套件总表与最近跑次（判定 SOT）
  CONVENTIONS.md            ← 编号、判定、交叉验证约定
  templates/                ← suite / cases / fixtures / run-record
  suites/<suite>/
    suite.md
    cases.md                ← 用例剧本
    fixtures.md
    runs/YYYY-MM-DD-*.md    ← 跑次证据
```

## 当前套件（与 INDEX 对齐）

- [Core Availability](suites/core-availability/suite.md)：P1-61／62／63；F61／F62／F63模块验收，R-CAV为既有P1-13组合补充；当前NOT RUN。

| Suite ID | 总账 | 主题 |
|---|---|---|
| `UAT-SUITE-BEGIN-ZERO-BINDING` | P1-60 | 零绑定 N／B／D 单一矩阵，G1–G6／D6 轮次、正式发布控制、RC1 既有客户端及画像任务补偿（v0.2-draft，NOT RUN） |
| `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE` | P1-58／P1-59 | 角色权限与 Agent 单维／组合 2×、5× 负载，冲突恢复与纯 MCP 共存 |
| `UAT-SUITE-SOURCE-AMBIGUITY` | P0-3 | 表级歧义门闩（拦得住） |
| `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` | P0-3 | 表级歧义纯 MCP 逃生（死路基线／优化后翻绿） |
| `UAT-SUITE-CALIBER-BINDING` | P0-1 | 问题类型口径绑定 |
| `UAT-SUITE-FIELD-EXPOSURE` | P0-A | Source 字段暴露裁剪 |
| `UAT-SUITE-ANSWER-VERIFIABILITY` | P0-4 | 答复可核对块 |
| `UAT-SUITE-EMPTY-NEXT-STEP` | P0-5 | 空结果下一步指导 |
| `UAT-SUITE-CATALOG-SEMANTICS` | P0-2 | Catalog 业务语义暴露 |
| `UAT-SUITE-CONN-RELOAD` | P1-15 | 连接写后执行层热重载 |
| `UAT-SUITE-CATALOG-SCAN` | P1-16／P1-20 | 库内扫表／外部目录读字段 |
| `UAT-SUITE-ACCESS-MAP` | P1-17／**P1-19** | 访问关系图空桑基；P1-19 词表／UAT-04 |
| `UAT-SUITE-ROLES-AGENT-PERF` | P1-13 | Roles／Agent 页性能体感 |
| `UAT-SUITE-EVENT-LOOP-RELIEF` | P1-21 | 重读路径与存活探针 |
| `UAT-SUITE-COPY-FAKE-SUCCESS` | P1-40 | 复制按钮假成功看守（明文 HTTP 下剪贴板读回） |
| `UAT-SUITE-BUTTON-FEEDBACK` | P1-42 | 下载／保存／导出按钮成功反馈真实性看守（真实浏览器收文件＋真实 4xx） |
| `UAT-SUITE-OPS-CONCEPTS` | P1-11 | 概念运维工具（Ops MCP） |
| `UAT-SUITE-QUESTION-BUDGET` | P1-12 | 问询预算默认阈值 60／300 |
| `UAT-SUITE-BUDGET-AUDIT` | P1-14 | 问询预算复盘审计字段 |
| `UAT-SUITE-ROW-POLICY` | **P1-28** | 行级隔离：十几人 × 一批表 × 不同行范围 |

**最近结果与跑次指针以 [`INDEX.md`](INDEX.md) 为准**；本表不复制 PASS／FAIL 句。P1-12／14 等套件判定以 INDEX 当次跑次为准。

## 第一性原则

见 [`CONVENTIONS.md`](CONVENTIONS.md)「第一性原则」：**全真用例；禁止 CR 冒充 UAT；做不到全真须向委托人独立授权后才能降级。**

## 交叉验证（Claude／其他 Agent）

1. **只做全真对抗复测**（跑 Docker／WebUI／脚本／API）；**不要**做 code review 交差。  
2. 只改 `runs/` 追加证据，或改 `INDEX.md` 最近跑次；**不要改** `cases.md` 期望除非合同变更并记下原因。  
3. 复现前先读该套件 `fixtures.md`，再跑 `cases.md` 步骤；对抗时可**新建**用例（新 connectionId／种子），测后清理。  
4. 判定只用 `PASS`／`PASS WITH GAP`／`FAIL`／`SKIPPED`／`BLOCKED`（见 `CONVENTIONS.md`）。  
5. 发现与 `cases.md` 不符：在当次 `runs/*.md` 写 FAIL 与日志摘录，另开缺陷；勿静默改期望。  
6. 全真做不到 → 跑次标 `BLOCKED`，**报告委托人申请独立授权**；未授权不得用 CR／纯 mock 主张验证。  
7. **新开客户场景 UAT**：只在本树建 suite；禁止再往 `docs/uat/` 写新用例当测试台。

## 本地模拟数据授权

本机 demo Docker 允许生成／销毁前缀为 `uat_`／`e2e_conn_reload` 的库与表，以及临时连接 id 前缀 `uat-reload-`／`uat-scan-`。测后必须清理临时连接；宽表种子库可保留供反复跑。
