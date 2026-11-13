# Lucy UAT 项目（可反复复现）

| 元数据 | 内容 |
|---|---|
| 定位 | **测试台 SOT**：客户场景复现／回归 UAT（用例 + fixtures + 跑次）；供 Cursor／Claude 交叉验证 |
| 非定位 | 不替代功能 Spec 收口（开发台）；不替代产品线总账（需求台）；不替代发布取证整包；绿灯 ≠ 可上线 |
| 三台规则 | [`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「端到端三台账」；勾连 [`e2e-ledger.md`](../../governance/e2e-ledger.md) |
| 目录 | 本文档树；种子与辅助脚本见仓库 `scripts/uat/` |
| 密钥 | **只写凭据文件路径**；禁止把密码写入本树、inbox、截图说明或回复 |

## 树

```text
docs/qa/uat/
  README.md                 ← 你在这里
  INDEX.md                  ← 套件总表与最近跑次
  CONVENTIONS.md            ← 编号、判定、交叉验证约定
  templates/                ← suite / cases / fixtures / run-record
  suites/
    connection-runtime-reload/
    catalog-scan-read-path/
    access-map-sankey-empty/
```

## 当前套件

| Suite ID | 主题 | 对应缺陷／合同 |
|---|---|---|
| `UAT-SUITE-CONN-RELOAD` | 连接写后执行层热重载 | Spec 191；连接创建→supervisor 重载 |
| `UAT-SUITE-CATALOG-SCAN` | 库内扫表读法 | Spec `lucy-20261111-catalog-scan-read-path` |
| `UAT-SUITE-ACCESS-MAP` | 访问关系图空桑基 | Spec `lucy-20261113-access-map-sankey-empty-fix`；P1-17 |
| `UAT-SUITE-EVENT-LOOP-RELIEF` | 重读路径与存活探针 | P1-21／REQ-030-042。INDEX＝PASS（可选 LOOP-05 BLOCKED） |

## 第一性原则

见 [`CONVENTIONS.md`](CONVENTIONS.md)「第一性原则」：**全真用例；禁止 CR 冒充 UAT；做不到全真须向委托人独立授权后才能降级。**

## 交叉验证（Claude／其他 Agent）

1. **只做全真对抗复测**（跑 Docker／WebUI／脚本／API）；**不要**做 code review 交差。  
2. 只改 `runs/` 追加证据，或改 `INDEX.md` 最近跑次；**不要改** `cases.md` 期望除非合同变更并记下原因。  
3. 复现前先读该套件 `fixtures.md`，再跑 `cases.md` 步骤；对抗时可**新建**用例（新 connectionId／种子），测后清理。  
4. 判定只用 `PASS`／`PASS WITH GAP`／`FAIL`／`SKIPPED`／`BLOCKED`（见 `CONVENTIONS.md`）。  
5. 发现与 `cases.md` 不符：在当次 `runs/*.md` 写 FAIL 与日志摘录，另开缺陷；勿静默改期望。  
6. 全真做不到 → 跑次标 `BLOCKED`，**报告委托人申请独立授权**；未授权不得用 CR／纯 mock 主张验证。

## 本地模拟数据授权

本机 demo Docker 允许生成／销毁前缀为 `uat_`／`e2e_conn_reload` 的库与表，以及临时连接 id 前缀 `uat-reload-`／`uat-scan-`。测后必须清理临时连接；宽表种子库可保留供反复跑。
