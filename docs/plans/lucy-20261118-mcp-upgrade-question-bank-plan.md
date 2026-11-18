# MCP 升级兼容多场景题库 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | **v1.0** / 2026-11-19 |
| 状态 | **v1.0。终稿确权（委托人 2026-11-19 批准对抗复审修订并定稿）。开发未授权（明示暂不开发）。测试台共享 NOT RUN。未授权不改执行器、权限、数据与运行代码。≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md`](../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md) **v1.0** |
| 父门禁 | [P1-53 v1.1](../specs/lucy-20261118-mcp-upgrade-compatibility-spec.md)（加载／digest／判定／D27；**不**创建题库内容） |
| 总账 | **P1-54**／REQ-030-075；P0 底线题库＋配置合同；不入核心分母 |
| 授权边界 | **终稿确权 ≠ 开发授权**。Task 1 起须另发开发授权。本条只改：`mcp-upgrade-journeys.yaml` **内容**、CompatConfigProfile 描述／应用／还原脚本、题库契约测。**不得**：改 P1-53 放行阈值；实现判定器／发布接线（归 P1-53）；改客户生产 Role；实现 P1-49 heal；打开产品默认 proven 开关。构建／部署／出包另授权 |
| 验收 | Spec SC-01–SC-24；缺匹配配置＝BLOCKED 不删题 |

## 目标

1. 交付 journeys.yaml **内容**（与 Spec §4／§5／identities 一一映射）与 digest 输入。
2. 交付 CompatConfigProfile 应用／备份／还原（含 frozen W0 负例 Role、双连接编排、字段差分、W1／W2 放行）。
3. 契约测覆盖 D7a／分母／gov filters 映射／禁 admin；全真与三维交 P1-53。

## 归属（对 P1-53；B13）

| 产物 | 本条（P1-54） | 父条（P1-53） |
|---|---|---|
| `mcp-upgrade-journeys.yaml` 题面／oracle／identities／mapsTo | **Create／维护** | Consume／Validate／digest |
| CompatConfigProfile 应用／还原脚本 | **Create／维护** | 调用 `applyCompatConfigProfile`＋指纹门禁 |
| `mcp-compatibility.mjs` 判定／三维／证据聚合 | 不负责 | **Create** |
| 真实 Agent 执行／PRE／POST | 不负责 | **Create** |

本条 schema **不**复用 `scripts/e2e/lib/mainline-scenarios.mjs` 形状。

## 开工前置

1. Spec／本 Plan **v1.0 终稿确权**已落盘。
2. 开发授权另发；当前只文档。
3. 秘密只从受保护路径读。
4. 不默认重建 Docker；缺环境／缺配置指纹＝BLOCKED。
5. 通用车道不启用产品默认 proven；不把行隔离成交塞进 demo profile。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 文档定稿（本轮完成） | 状态同句；lint close-layer 通过 |
| **1** | （须授权）CompatConfigProfile：连接／语义引用、frozen W0 Role、无 query Role、表 A／B、字段差分、双连接编排、W1／W2 放行；应用／还原 | 指纹稳定；还原失败即停；未用 admin；未改正式 lucy_ops_reader 当作永久负例 |
| 2 | （须授权）写入 `scripts/e2e/contracts/mcp-upgrade-journeys.yaml`（内容）；identities；§5 映射；gov→filters[] | 缺题／缺 identity／错映射 FAIL |
| 3 | （须授权）独立 oracle（baseline／SQL／deny／privacy） | 自报数字不通过 |
| 4 | （须授权）契约负例测 | 见下 |
| 5 | **交 P1-53**：由其加载 YAML、算 digest、跑 Agent／PRE／POST | 本条不重写执行器 |

### 步骤 4 失败测试（授权后）

```js
test("missing CompatConfigProfile fingerprint => BLOCKED");
test("COMPAT-02 missing QB-BIZ-02c or 02d => FAIL");
test("deny case without tools/call evidence => FAIL");
test("QB-ACL-02c bound to healable lucy_ops_reader => FAIL");
test("W0 mcpControls filters contain gov.* => FAIL");
test("W1/W2 missing any allowed gov window knob => FAIL");
test("QB-DB-01 identity lucy_admin => FAIL");
test("region vocabulary 华东/西南 in fixture => FAIL");
test("agent self-reported number cannot replace oracle");
test("fixture restore failure stops subsequent cases");
test("QB-ACL-03b-gate expects row_policy_upstream_unproven not row isolation success");
```

Run（登记名，开发后写入 test-layers）：`node --test scripts/e2e/__tests__/mcp-upgrade-question-bank.test.mjs`

## 浏览器验证

不适用：本题库与配置资产包验证真实 Agent／MCP／Lucy 配置，不改变 WebUI 页面、路由或浏览器交互。

## 验收

- SC-01–SC-24 有证据；配置前置与 D7a 不可跳过。
- 全真与三维以 P1-53 为准。

## 完成定义

1. profile 脚本＋YAML 内容＋契约测落地（仅开发授权后）。
2. 缺配置保持 BLOCKED；未宣称全部通过。
3. 无秘密进 Git；状态镜像同步。
4. 本条收口 ≠ P1-53 已实现 ≠ 可出包。

## 风险

| 风险 | 处理 |
|---|---|
| 有题无配置 | D19；父 D27 BLOCKED |
| P1-49 翻面 02c | frozen Role（D8a） |
| 行隔离撞 proven | 通用车道 03b-gate＋放弃成交隔离 |
| Plan 与 P1-53 撞 YAML | 归属表；父 Plan 改为 Consume |
| Agent 跟 SOP 查 ops_tokens | OPS-05 钉 ops_calls；OPS-05b 承接 |
| 夹具未还原 | 失败即停 |
