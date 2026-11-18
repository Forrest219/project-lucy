# UAT-SUITE-REBUILD-PROBE-BUDGET — 满量重建下探针预算

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| 总账 ID | **P1-47**／REQ-030-068（前方报告 **P0-01**） |
| 目标 | 看守满量推断重建负载下 livez／readyz 超客户 3s 预算与尾延迟；不得靠放宽超时或缩小数据关单 |
| 合同回链 | [Spec](../../../../specs/lucy-20261118-rebuild-probe-budget-spec.md) SC-01–SC-10；前方报告 §3.1 F／§4.1 P0-01；可与 [`UAT-SUITE-COLD-START-SLOW-DISK`](../cold-start-slow-disk/suite.md) 共用限速台但**本套件聚焦满量重建稳态**；暂停交付见 [接力 Plan](../../../../plans/lucy-20261118-p147-pause-uat-relay-plan.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 全真性

真实容器、真实 blkio 限速（建议读写 30MB/s、读 300／写 100 IOPS）、真实满量推断夹具、真实 HTTP 探针。**禁止** CR 冒充；**禁止**缩小到「少量推断」宣称关单。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-RPB-R0、UAT-RPB-01、UAT-RPB-02、UAT-RPB-03（**默认配置**关单）；**出包评估另加** UAT-RPB-08（客户指纹判别）、UAT-RPB-09（同镜像 ≥3 次独立冷启动全绿） | UAT-RPB-04（真实 K8s 摘端点；默认 BLOCKED）；UAT-RPB-05／06／07（**暂停配置**交付缓解；PASS 不关默认 FAIL） |

## 门槛

| 项 | 值 |
|---|---|
| 客户观察器 | timeout 3s；连续失败 &lt; 6 |
| 重启稳态 120s | livez max ≤ 1000ms、p99 ≤ 400ms；readyz p99 ≤ 1500ms；全 200 |
| 首次升级窗口 | 可沿用 P1-39 放宽（max ≤ 2000／p99 ≤ 1000），须在跑次注明 |
| 出包多跑 | 同镜像默认配置 **3／3** RPB-01–03 PASS；单次 PASS 不算可出镜像 |
| 指纹分型 | 「客户同形未解」＝持续 ≥1.5s 停顿／health 抖动；「残余单尖峰」＝偶发 max 越线但 p99 达标且 maxStreak＝0 — 后者仍记 RPB-01 FAIL，但不得写成 11-17 同形未修 |

## 边界

- 前方仅**部分复现**（1 次超时）；改前基线允许记录「偶发超预算」为 FAIL／GAP，关单须达标。
- 不替代 P1-45／P1-46。
- INDEX：**NOT RUN**。
