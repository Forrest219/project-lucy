# 客户探针事故修复：交付前 UAT 与出镜像评估

| 元数据 | 内容 |
|---|---|
| 文档名称 | 客户探针事故修复：交付前 UAT 与出镜像评估 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-18 |
| 撰写人 | Cursor（Auto） |
| 委托人 | xingchen |
| 基于材料 | 客户截图（Pod Ready=False／livez≈2.17s／readyz≈7.55s degraded／health KTX MCP 1500ms 抖动）；错题 `2026-11-17-k8s-upgrade-event-loop-readiness-timeout`；测试台 `UAT-SUITE-REBUILD-PROBE-BUDGET`／COLD／RML／IRR；镜像 `project-lucy:demo`＝`7ebedd4e` |
| 适用范围 | 决定「当前 Docker 重建镜像能否输出给用户使用」 |
| 输出位置 | `docs/reviews/2026-11-18-customer-probe-uat-ship-assessment.md` |

## 结论

**不建议输出默认配置客户镜像供用户使用。**

- 客户截图病症＝总账 **P1-39／P1-47**（伴生 P1-45／46）家族。
- 当前镜像 `7ebedd4e`：**11-17 持续秒级停顿同形已收敛**；但默认配置满量台 **不稳定**（1／4 PASS），仍有就绪后 ≈33.8s 的 **2.0–2.5s livez 单尖峰**，不过 Spec `max≤1000ms` 与出包多跑门禁（RPB-09）。
- 若必须先给用户试用：仅可走 **暂停配置** `LUCY_INFERRED_MAINTAINER=off` 的待测包，并书面说明「暂停≠根治、审计问询补算停」。

## 1. 客户反馈 ↔ 能力映射

| 截图症状 | 总账／套件 | 当前能力 |
|---|---|---|
| Pod Running 但 Ready=False；readyz 超 Helm 3s | P1-47 `UAT-RPB-01／02` | 本机限速台 readyz p99≤203ms、客户 3s 观察器 streak＝0；**尖峰仍可能逼近 3s** |
| livez≈2.17s／event loop p99≈2.2s 持续 | P1-39／47 | **非同形**：现 p99≤306ms；改前 38／42 ≥1.5s → 现 FAIL 跑仅 1 次 ≥1.5s |
| health ok↔degraded（KTX MCP 1500ms） | 错题放大项 | 空载 demo／结算后容器均为 `status=ok`；持续停顿消失后该误报应大幅减少（未单独关单） |
| 启动窗 502／MCP 未听 | P1-46 RML | 既有跑次 **PASS**（本波未重跑） |
| 重建中断覆盖 | P1-45 IRR | 既有跑次 **PASS**（本波未重跑） |

## 2. UAT 执行摘要（本波）

| 动作 | 结果 |
|---|---|
| 优化用例 | 新增 **UAT-RPB-08**（客户指纹分型）、**UAT-RPB-09**（出包前 ≥3 次多跑） |
| 默认配置多跑（同镜像 `7ebedd4e`） | **1 PASS＋3 FAIL**；FAIL 尖峰相位锁定 ≈33.8s |
| 暂停配置 | 沿用既有 PASS（livez max≈13ms）；本波未重跑 |
| 追加 confirm-r3 | **挂起／无 summary**（孤儿容器）；不计入分子 |
| INDEX | 已回写为 **FAIL／不稳定** |

正式跑次：[2026-11-18-cursor-rpb-7ebedd4e-stability](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-18-cursor-rpb-7ebedd4e-stability.md)

### 数值对照

| 时代 | livez max／p99 | ≥1.5s 形态 |
|---|---|---|
| 客户 11-17 | ≈2.17s／p99≈2.2s | 持续 |
| 改前满量（pause-uat on） | 2693／2693 | 持续 |
| 暂停 `off` | 13／9 | 无 |
| `7ebedd4e` 默认（本波） | 308～2507／193～306 | 偶发单尖峰或全绿 |

## 3. 出镜像门禁判定

| 门禁 | 判定 |
|---|---|
| 客户同形主因是否已解 | **基本已解**（RPB-08＝残余单尖峰，非持续同形） |
| 默认配置 UAT 关单 | **未过**（RPB-01／09 FAIL／不稳定） |
| 可输出默认客户镜像 | **否** |
| 可输出暂停待测包 | **有条件可以**（须 Chart／values 注入 `off`＋说明；≠ 正式关单） |
| amd64／K8s 现场 | **未验**（本波 Docker 限速台） |

## 4. 建议下一步（需你定）

1. **默认出包**：先授权定位 ≈33.8s 相位尖峰并修到 3／3 PASS，再出包。  
2. **应急试用包**：授权打带 `LUCY_INFERRED_MAINTAINER=off` 的 amd64 `*-test`，仅供受控试用。  
3. **本波未做**：改代码、新 Spec、amd64 出包、客户现网升级。

## 环境

- WebUI：`http://127.0.0.1:55176`
- MCP Proxy：`http://127.0.0.1:57881`
- 容器：`compose-lucy-1`／`project-lucy:demo`／`gitSha=7ebedd4e`／healthy
