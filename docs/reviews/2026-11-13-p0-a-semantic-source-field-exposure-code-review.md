# P0-A Semantic source field exposure · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（Wave A Task 2） |
| 实现主体 | Cursor coder（R4，2026-11-08） |
| 实现 commit | `49c845ce`（`field-exposure.ts`、发现面裁剪、B1 发布门禁、Strat-B barrier、工作台接线）；`91a9dfc3`（`mcp-proxy.ts`／`acl.ts` 接线，与 P0-2／P0-3 共享插入点） |
| 对象 | Spec／Plan **v0.7**；SC 证据见 [证据审计](2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md) |
| 复测 | 见下「复测基线」→ **5 files / 75 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— 主路径对齐 Spec v0.7 D0–D26 与 SC-01–SC-30；**D20 先授权再暴露**、**D26 四透传首期 fail-closed** 有源码锁与自动化。本轮复测与证据审计一致（75/75）。残余仅为验收债／诚实披露（SC-25 live-KTX 残差；四透传载荷取证待办）。**本 CR 不表示可上线**／不做发布取证。

## 复测基线

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/field-exposure.test.ts \
  server/__tests__/field-exposure-acl-hook.test.ts \
  server/__tests__/field-exposure-proxy-sc04-sc06.test.ts \
  server/__tests__/field-exposure-sc12-sc13.test.ts \
  src/__tests__/field-exposure-workbench-sc13.test.tsx \
  --reporter=dot
```

| 项 | 结果 |
|---|---|
| Test Files | **5 passed** |
| Tests | **75 passed / 0 failed** |
| 时长 | ~2.6s |

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| D20 先对象授权，再业务暴露 | `authorizeAndRewrite`（`acl.ts`）在连接／表授权完成后调用 `validateQueryFieldsAgainstExposure`；越权保持原 ACL 码（SC-18；`field-exposure-acl-hook.test.ts`） |
| D10／D11 查数 fail-closed | 未暴露列 → `field_not_exposed`；台账／代次／期望故障 → `field_exposure_unavailable`（SC-04／05／06；proxy loopback 上游＝0） |
| D21 发现面统一读取器 | `loadExposureSet` + discovery trim／examples 改写（SC-03／07／21）；`lucy_catalog` 表列表不变、examples 裁（SC-12） |
| D23／D25 执行代次与期望集合 | `ServingGeneration` 绑定、`expectedSetRequired`、损坏／代次不匹配 → unavailable（SC-23–28） |
| B1 发布门禁与 Strat-B | `field-exposure-publish.ts`、共享索引突变 barrier（SC-16／17／25／26） |
| D24 三态与未裁剪不硬拒 | `unconfigured`／`full_expose`／`trimmed`；SC-29 |
| D26 四透传首期合同 | `resolvePassthroughScope`（空抽取→`INSTANCE_WIDE`）；`admitPassthroughFieldExposure` 挂 **tableTouching** 与 **sensitiveMetadata** 两路径（SC-30 插入点锁）；触及 trimmed／unavailable → 上行前拒绝、零上游 |
| D26 fail-closed 与兼容对照 | 逐工具 trimmed 拒绝 +「已过 ACL + 空作用域」零上游；实例无 trimmed 时不新增拒绝（SC-30） |
| 工作台／草稿边界 | 保存未发布不生效；pending `field_exposure`（SC-13；组件 + Proxy 对照） |
| 术语与 reason code | SC-14；`field_not_exposed`／`field_exposure_unavailable` 分码 |

## Findings

### F-R1 [nit] SC-25 CLOSED*：无 live KTX MCP 往返

与 [证据审计](2026-11-13-semantic-source-field-exposure-sc-evidence-audit.md) 一致：进程内执行代次探针已断言 OPEN 代语义；**未**跑真实 KTX 上游消费。不挡本轮 PASS；上线前须书面登记或补 live 证据。

### F-R2 [nit] D26／RES-07：四透传载荷仍「取证待办」

合同已闭合为首期 trimmed fail-closed + SC-30；**不宣称 A1 全入口闭环**（Spec D26）。载荷不含字段名时可在取证后解除阻断——属产品后续决策，非实现偏离。

### F-R3 [nit] commit `91a9dfc3` 与 P0-2／P0-3 共享 Proxy 差分

本条 CR 审查以 `field-exposure*.ts` 与五文件 vitest 为主；共享接线已 spot-check 暴露检查相对 ACL 的顺序，不替代 P0-2／P0-3 各自实现 CR。

### F-R4 [nit] SC-15「既有测试全绿」为环境态

acl-hook 锁插入点与不调用 `validateProtectedLucyQueryArgs` 全球门禁；不单列环境全绿断言，与证据审计 CLOSED* 口径一致。

## 对 Spec D／重点合同的裁定

| 范围 | 裁定 |
|---|---|
| D20 授权序（SC-18） | **接受** |
| 查数／explain 同源暴露拒（SC-04／06） | **接受** |
| D26 四透传必经路径 + INSTANCE_WIDE 空抽取（SC-30） | **接受** |
| 发现面与查数 digest 一致（SC-07） | **接受** |
| fail-closed（半通／原文透传／越权码改写） | **接受**（SC-22；D20；上行前断言） |
| SC-01–SC-30 | **接受**（与证据审计一致；含 SC-25* 残差披露） |

## 下一步

1. 可选：SC-25 live-KTX 或四透传载荷取证单独立项（RES-07）。  
2. Wave A 其余条目按 [治理优化 Plan](../plans/lucy-20261113-p0-governance-optimization-plan.md) 独立落盘 CR。  
3. **不得**宣称可上线。
