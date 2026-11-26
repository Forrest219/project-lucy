# UAT-SUITE-PUBLIC-ENTRY-STATIC — 公共首页与静态公开接口隔离

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-PUBLIC-ENTRY-STATIC` / v1.0 |
| 日期 | 2026-11-24 |
| 总账 / 合同 | **P1-84**／REQ-030-105 · [Spec](../../../../specs/lucy-20261124-public-entry-static-isolation-spec.md) SC-01–SC-08（SC-09＝OQ-6 可选） |
| 目标 | 对照臂复证入口越线；最终臂混压下公共入口按类可用；至少一臂主路径成功成交；运行时证明公开路径未进重工作 |
| 运行环境 | **强制 scale**；本机隔离 Docker＋真实 KTX／规模夹具＋**事件循环臂必做**（OQ-2＝A）＋真实前台浏览器 |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md)。当前 **NOT RUN** |

## 来源与定位

承接 Spec v1.0（终稿已确权；开发未授权）：诊断 Gate 已完成（`inbox/p184-diag-20261124`）；OQ-2＝A；OQ-1／OQ-7 已冻结；正式套件仍 NOT RUN。不替代 P1-75／81／82。

| 套件 | 本套件不重复 |
|---|---|
| P1-75 展示读／503 | 不认领 `/api/sources` 全合同 |
| P1-82 容量 | 不重验配额数值 |
| P1-81 假活 | 不要求入口失败触发自愈 |
| P1-21 livez | 只做分列，不改探针合同 |

## 全真性

- **强制 scale**；lean 上开跑规模断言记 `BLOCKED`。
- 事件循环臂必做（OQ-2 已裁定＝A）。
- 禁止假延迟中间件、桩上游、手工只堵测试路由。
- 改前＝基线镜像或 feature-off 对照臂；改后＝最终臂；同一夹具／序列。
- `GET /` 须真实前台浏览器＋`primaryReady`；与 API 分列。
- 预算＝客户端发送→首字节／完成；保留全部超时与慢样本；报告 P50／P95／P99／max。
- 手工 `docker restart` 不计恢复。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-PES-R0、01、02、03、04、04b、05、06、06b（条件）、07、08 | UAT-PES-09（OQ-6 延期）；UAT-PES-10（help，OQ-5 不纳入） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 基线臂（配对跑次） | R0／01 |
| 最终臂（配对跑次） | R0＋02–08（含 04b；06b 条件触发） |
| 改公开 handler／品牌缓存／让出调度 | 全套必做 |

## 当前边界

- Docker 单实例；不分进程（OQ-2＝A）。
- INDEX：**NOT RUN**（诊断 Gate ≠ UAT PASS）。
