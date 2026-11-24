# P1-11 概念注册表 Lucy Ops 控制面 · Code Review（Cursor Agent）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实现 code review（**不是** Spec） |
| 日期 | 2026-11-13 |
| 评审人 | Cursor Agent（W1 Task W1-1） |
| 实现主体 | Cursor coder（R4，2026-11-09） |
| 实现 commit | `2ca5f939`（`concepts-adapter`／`concepts-read`／`concepts-recovery-fence`／`ops-tools` 接线＋`ops-concepts.test.ts`；复用 `scripts/concepts/**`） |
| 对象 | Spec／Plan **v0.5**；SC 关闭证据见 Spec §7（2026-11-09 功能合同收口） |
| 复测 | `cd webui && npx vitest run ops-concepts --reporter=dot` → **20 passed / 0 failed**；`npm run concepts:test` → **29 passed / 0 failed**（2026-11-13 Cursor 复核） |

## 结论

**PASS（实现层）** —— 主路径对齐 Spec v0.5 **D1–D23** 与 **SC-01–SC-22**；Ops 六工具经 `allow.ops`＋两段式写、`runOpsCommit` 与 P1-10 纯计算核心共用；本轮复测 **20＋29** 与功能合同层证据一致。残余仅为验收债／nits（见 Findings）。**本 CR 不表示可上线**／不做发布取证。

## 已对齐（摘要）

| 项 | 证据 |
|---|---|
| D1／D2 主交付面＝Ops MCP | 六工具登记于 `CONTROL_PLANE_TOOLS`；无本版 WebUI（SC-10 豁免） |
| D4／D13–D17 两段式写＋计划载荷 | preview→commit；`targets` 客户端覆盖拒绝；`OPS_EMPTY_PLAN`（SC-12／15／20） |
| D7／SC-11 单一纯计算核心 | `S5 service⇄pure` 对照 `planScan`；`concepts:test` 29/29 |
| D11–D12／SC-17 根解析 | `rejectConceptRootOverrides`；`resolveOpsConceptContentRoot`（代码审查；见 F-R1） |
| D14–D16／SC-08 scan 单组 batch | `buildPlan` 单 `concepts` 组；`planChangeType` 三分 |
| D15／SC-16 只读不建目录 | `read-only does not create concepts/` |
| D18／SC-19 realpath 围栏 | `concepts:test` symlink 拒写 |
| D21／SC-21 恢复栅栏 | `concepts-recovery-fence`；list／show／scan 阻断 |
| D19／SC-07 无效果失败 | 缺概念 set_canonical；`concepts/` 仍 absent |
| D20／SC-20 计划一致性 | summary 篡改 → `ops_concept_request_mismatch` |
| D23／SC-22 后像核验 | `verifyConceptPlanAfterImages` 失败关闭 |
| D3／SC-05–06 问数正交 | `no_ops_agent`；`lucy_ops_reader_agent` 拒 concept 工具 |
| D6／SC-09 问数热路径不变 | 语义＋wiki 指纹夹具；`check-ask-path-invariant` 探测 |
| SC-01／05／06 授权 | grant／无 grant 用例 |
| SC-03／04 人审权威 | set_canonical＋rescan；reject 不复活 |
| SC-18 read_only 禁写 commit | `concept_reader` 实例 scope |

## Findings

### F-R1 [nit] SC-17 无专用 vitest 断言 `ops_concept_root_override_forbidden`

`rejectConceptRootOverrides` 已在读／写入口接线；功能合同层 2026-11-09 以 Spec 登记＋代码审查关闭。若需硬锁回归，可补单测，不挡本轮 PASS。

### F-R2 [nit] SC-02「缺 summary／非法 binding」无独立 Ops 用例名

SC-07 覆盖「缺概念＋无磁盘效果」；`concepts:test` 覆盖纯计算校验。未单列「空 summary」Ops 路径，不挡本轮 PASS。

### F-R3 [nit] SC-10／SC-13／SC-14 偏合同／登记证据

SC-10＝交互豁免；SC-13＝`control-plane.ts` 登记（无独立 parity 测）；SC-14＝交付文档口径（CLI 急救）。与 Spec §7 关闭表一致，不挡 PASS。

### F-R4 [nit] SC 证据分两层复测

实现 CR 本轮显式复跑 **ops-concepts（20）** ＋ **`concepts:test`（29）**；未再跑全仓 `vitest`／E2E。不挡功能合同层 SC 映射。

## 对 Spec D／SC 的裁定

| 范围 | 裁定 |
|---|---|
| Ops 六工具＋`allow.ops`（D1–D4） | **接受** |
| 纯计算核心复用（D7／SC-11） | **接受** |
| 恢复栅栏与两段式写（D13–D23） | **接受** |
| 问数热路径正交（D6／SC-09） | **接受** |
| SC-01–SC-22 | **接受**（与 Spec §7 关闭表＋本轮复测一致） |

## 下一步

1. W1 其余 P1 条目按 [landed 收口 Plan](../plans/lucy-20261113-landed-middev-closure-batch-plan.md) 独立落盘 CR。  
2. 可选：补 SC-17 根覆盖单测（F-R1）。  
3. **不得**宣称可上线。
