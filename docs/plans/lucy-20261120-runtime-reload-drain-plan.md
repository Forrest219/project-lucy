# MCP执行层热重载在途保护与统一截止 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.1-draft |
| 日期 | 2026-11-20 |
| 状态 | S4｜阶段:S4｜v0.1。Codex CLI终稿确权通过；开发授权已获得；实现已落地，组件与真实shell回归通过；候选6本机Docker排空／拒绝／恢复及直接CLI定向已验证，完整F69矩阵仍有缺口；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| 授权边界 | 已批准核心可用性CA-00–09；本增量须先正式入账并完成Codex终审G2。运行代码按M白名单；不push／发布／改客户环境，不改KTX |
| 验收 | 配对Spec SC-01–12；真实MCP/HTTP/实际KTX进程与恢复；完整R-CAV另记 |
| 功能编号 | P1-69／REQ-030-090；不入核心分母 |

**Goal:** 保护正常短MCP在途、明确新请求拒绝与同身份恢复，并让60秒截止约束真实重载执行。

**Architecture:** 由现有reload controller／supervisor owner消费MCP-specific可逆屏障与真实settle集合，不新建并行调度器；独立于不可逆整实例DRAINING。现有requestId/digest回执、授权代次、预算／审计及配置事实沿用。

**Tech Stack:** Node22、TypeScript、Vitest、stock macOS bash3.2兼容脚本、单实例本机Docker／真实MySQL／KTX。

## 目标

保护已受理的正常短MCP查询，给切换新请求明确可达的重试路径，保持真实执行、回执与权限代次一致，并使用统一60秒截止。

## 开工前置

1. M入当前产品线总账与REQ，落配对Spec/Plan及索引、core-availability SC用例并完成Codex只读终审；记录G2。
2. 冻结基线及共享接缝owner；CA-05热点不写reload文件，CA-06不写预算/审计算法；index.ts或entrypoint公共接缝由M串行整合。
3. 现有Spec191与P1-63具名边界一致；终审确认20秒排空、60秒总截止、立即可重试拒绝、超时实际owner处置和无same-digest skip。

## Task R1：真实MCP工作登记与可逆准入屏障

**Files:** `webui/server/runtime/mcp-process-work.ts`、`webui/server/proxy/mcp-proxy.ts`；既有／经M允许新建的MCP lifecycle测试。

1. 先写反例：重载窗口新RPC仍被上游受理；客户端断连／handler异常但upstream未close仍被误退票；reload等全局HTTP计数自等。
2. 在首个await前原子检查整实例phase＋reload barrier并登记MCP-specific实际settle；闲置GET/SSE不占业务计数。
3. 返回原transport可呈现的503/EXECUTION_RUNTIME_RELOADING及显式重试提示；handler、upstream、response gate全部结束才退休。
4. 验同一Token恢复原问题和原授权收紧屏障，另一agent复核。不能放宽budget或缓存陈旧权限。

## Task R2：复用原owner，统一调用deadline

**Files:** `webui/server/ktx-mcp-reload.ts`、`webui/server/admin/mcp-runtime-reload.ts`、`webui/server/runtime/mcp-process-work.ts`。

1. 先写排空20秒超时不stop、调用排队/前置耗时计入60秒、后续各阶段不重置、late receipt不串单的反例。
2. controller确认能力与原single-flight后持屏障等待MCP真实settle；超时失败且stop=0，现有未加载配置继续stale。
3. 60秒总deadline贯穿排空≤20、stop+释放≤10、start≤20、verify≤10；每步取剩余预算，不新增无界队列。
4. CLI兜底复用相同原语；不吞同digest手动请求，不新增自动去重；真实配置核验复用已有verifyConfigLoaded，不把TCP成功当配置加载。

## Task R3：supervisor实际截止与TERM竞争

**Files:** `scripts/runtime/docker-entrypoint.sh`及`docker-entrypoint.test.mjs`；admin reload请求／回执结构按需增补。

1. 先用真实shell＋stub child反例证明旧代码能在Node超时后继续重启、过期未消费请求迟到执行。
2. 请求附可验证统一expiration；消费前后校验，过期不stop；stop/start/wait共用剩余预算，真实child终态可核对。
3. caller超时与owner仍活动分别记：未真实结束不能释放slot/barrier；迟到结果只完成原requestId/digest，不覆盖新请求。
4. TERM优先，取消自己的未消费请求；已消费让原关停owner接管，finally不得恢复SERVING或重开授权。

## 验证与真实Docker验收

串行运行：

```sh
cd webui
npx vitest run --maxWorkers=1 server/__tests__/ktx-mcp-reload.test.ts server/__tests__/mcp-runtime-reload.test.ts server/__tests__/source-shortname-runtime-ack.test.ts server/__tests__/mcp-proxy-execution-stale.test.ts server/__tests__/process-drain.test.ts
```

根目录：

```sh
node --test scripts/runtime/docker-entrypoint.test.mjs
npm --prefix webui run typecheck
```

按Spec SC-01–12执行真实10秒在途＋自动/手动重载、>20秒排空失败不stop、切换503与同Token恢复、权限收紧、启动/存储/核验失败及3阶段TERM竞争；记录实际Node/KTX PID、requestId/digest、工作终态和恢复。组件替身不替代真实KTX Docker。

## 浏览器验证

不适用：不改变用户可见 WebUI 表面；本方案不改WebUI交互；服务器原错误信封由既有呈现承接。若实际改动涉及页面、保存反馈、Toast或新的可见状态，增补真实前台浏览器即时计时，API耗时分列；缺证不得签相应面PASS。不做移动窄屏。

## 完成定义

SC逐项证据真实，原短在途只执行一次，新请求可重试且同身份原问题恢复；真实执行与caller截止分别证明；所有↓补偿有证据。M同次登记Spec头部及已有镜像、测试台run/INDEX与e2e；完整F61/F62/F63/R-CAV和客户readyz根因未覆盖项保留。功能合同收口不表示可上线。

## 风险与控制

- 禁用全局process-drain计数作为reload排空，避免等待当前保存/重载HTTP的自等死锁。
- 不以Promise.race超时当真实工作结束；真实owner未终结时保持slot及必要屏障，显式记录并按旧requestId reconcile。
- 不为保护短在途放宽吊销/授权代次；配置已保存与执行已加载分别报告。
- 不扩大为任意长查询/任意内核I/O零中断；旧失败保留，不自动重放。
- 共享宿主诊断/长跑独占资源锁，构建/采样不能污染正式无profiler性能窗。
