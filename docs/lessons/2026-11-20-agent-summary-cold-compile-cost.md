# 错题：名册传输变轻不代表权限冷编译变轻

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-20 |
| 标签 | `gate-gap` `ux-regression` `contract-stack` `sev-med` |
| 环境 | P1-66 同构 Docker，Lucy 2 CPU／4 GiB；真实编译 BAL-K1，71 Agent、15,240 capability |
| 相关 | [P1-66 Spec](../specs/lucy-20261120-agent-roster-summary-projection-spec.md) · [执行记录](../qa/uat/suites/agent-roster-summary/runs/2026-11-20-codex-p166-docker.md) |
| 状态 | open；热读已改善，冷构建与整套性能门槛未闭合 |

## 1. 症状与影响

原 roster 8,420,953 B，摘要 36,372 B；改后热态摘要 p95 82.35ms，摘要＋statistics 不 parse 完整权限 payload。但改前、改后各五次独立权限快照冷读均超过 10s 请求预算；改后首次前台导航／统计也超过 1,000／2,000ms 原预算。不能以小响应或热缓存截图宣称整项性能 PASS。

## 2. 复现要点

真实编译权限夹具，保持完整旧接口和现有预热器；每次失效后读取摘要，超时仍计失败，等已启动构建结束、verified 后才执行下一次独立失效。不得连续失效叠加构建，不得用等待恢复的时间扩大客户端预算。

## 3. 根因

投影仅减少展示数据与完整 JSON 的热解析；为保持旧 API，同一槽仍须先生成和序列化完整权限。BAL-K1 改后启动测得 policy 初始化约 41.36s、displayReady 约 83.63s，两项成本都仍存在。

校准 CPU 采样定位到字段目录的反复读取／构建：`row-policy-catalog.ts` 的 `cachedCatalogEntry` 每次调用 `buildCachedCatalog`，只写入 map，没有读取命中结果。`loadPhysicalColumnsWithProvenance` 是主要非 runtime 调用热点。采样比例不等于墙钟占比；该热点尚未通过修复 A/B 证明能消除全部冷时延，不据此推定旧 109 的唯一根因。

## 4. 为何漏检

只测小权限或已热命中的列表，无法暴露编译成本。浏览器若仅等待已有 DOM 行和缓存统计值，也可能把旧数据误认为本轮读取完成。本轮已改为等待当前导航／ID／窗口的真实响应并核对页面，再计算 ready。

## 5. 举一反三

- 投影优化须分别量化传输、热解析、冷编译、启动预热和内存峰值；任一未过的必做门槛继续记 FAIL。
- 多副本规模必须保留每人的权限宽度、真实 OR／AND 图和完整字节下限，不能只保留账号数。
- 在未知新鲜性边界前，禁止把全局 map 命中直接接回授权编译；必须先明确源文件、overlay、连接、启用表、generation、provenance 和失败恢复的依赖。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 完成 P1-66 六组及兼容／故障／MCP 验证 | 批次A完成，其余暂停 | 分批决议见Spec v0.3；原矩阵FAIL保留 |
| 评审构建批次内字段目录复用方案 | 未开 | 先补设计和新鲜性／fail-closed 验收；当前 v0.2 明确不改 Proxy 编译算法，登记不构成开发授权 |
| 以真实冷样本证明后续改善 | 未开 | 复用同宽度夹具，不能仅展示热态收益 |

## 7. 证据指针

正式 API／browser／逐人规模证据归档到上述 run 配套 artifacts。过程 CPU 采样在 `inbox/p166-implementation-20261120/cold-compile-callers.json`，不作为唯一永久证据。
