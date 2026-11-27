# 跑次：2026-11-27 claude MIP 正式臂首次尝试（中止留证，不作判定依据）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-MCP-INQUIRY-PERF` |
| 日期／Agent | 2026-11-27／Claude（kscc） |
| 环境 | 隔离栈 `lucy-mip-uat` 重建（`project-lucy:uat-closure`＝HEAD `8b8fb83c` 转 `project-lucy:demo` 标签；卷 `down -v` 后全新 seed）；全量夹具播种完成（MySQL 1201 表／MCP-PERF 50 身份＋compat 11 身份／pool token 2026-11-27 10:18 刷新）；R0 PASS |
| 判定 | **中止／无效**（runId `mip-mwycqzh3-jcgf7h`，2920 尝试全落账但**不作收口证据**）；套件维持 **SEED_ONLY** |

## 中止原因（环境，非产品）

1. **宿主负载污染**：跑次期间宿主 load 平均 ~10（本机另一活跃 Agent 会话 ~45% CPU＋Docker VM 129%）。晚窗样本不可信。
2. **伴随稳定性哨兵 FAIL**（`inbox/mip-sentinel-1795745909196/`）：133 样本 16 violations，全部为 `event_loop_max`（5.09s／3.03s／7.89s 停顿）——与负载时段吻合；http 错误 0／登录失败 0／重启 0／自愈触发 0／p99 连续越限 2（<3 阈值）。哨兵门禁为 2026-11-26 晚新入库（1db4ce8b），基线 seed 跑次时尚不存在，其相对播种+正式臂全程负载的阈值口径待与委托人校准。
3. **指纹注记**：runner 证据的 `candidateFingerprint=git:8305c87e+dirty`（宿主工作树 HEAD 已被并行会话前移），容器实际运行 `8b8fb83c` 构建（docs/ci 差异，产品代码一致）；重跑时须以容器 `BUILD_REVISION` 为准并在跑次注明。

## 本轮聚合（仅作参考）

- 2920 尝试：correct 2318／denied 600（全部预期拒绝族）／**crash 2**（DENIAL_READONLY_OPS_WARM，负载伤亡嫌疑）。
- 未知场景级判定（judge 未产出 verdict.json 于 evidence 目录；runner exit=1）。
- C50 initialize 预算问题维持选项 2 裁定口径。

## 复跑指引（下次接续）

1. 栈与夹具已就绪（本卷未销毁；若隔日重启宿主，先 `docker compose -p lucy-mip-uat ... up -d` 并核对 R0）。
2. 红灯窗（宿主静默，含暂停其它 Agent 会话）内直接跑 runner（无需重播种）：
   `node scripts/e2e/run-mcp-inquiry-performance.mjs --trigger nightly --baseline docs/qa/uat/suites/mcp-inquiry-performance/baselines/1-lucy-mip-uat-capB-5593add992d7994a-b4bc7c6ef1c17c3b310a68da0fb89fcfef521e78.json`
   （token 文件：`/Users/zhangxingchen/Projects/.lucy-secrets/mcp-perf-tokens-uat.json` 等，env 注入见 fixtures §12。）
3. 全过线（或 C50 维持选项 2）→ 委托人具名接受 → `LATEST.json`。
4. 哨兵阈值口径（seed/正式臂全程 vs 暖态窗）先与委托人裁定再开跑。
