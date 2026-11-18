# P0 Wave B UAT（CALIBER-02／EXPOSURE-02）— Cursor＋Claude

| 治理字段 | 内容 |
|---|---|
| 状态 | 执行进度以本文件原Task勾选和已有跑次为准；本次仅补齐文档形态，未复跑本计划业务验收，当前候选结果待验。 |
| 授权边界 | 仅本计划既有Task所列范围，原审批和禁止项见正文；本次文档治理修订不新增运行代码、提交、部署或发布授权。 |

> 委托人 2026-11-14 批准：优先 Wave B；过时夹具可升级。Cursor 写用例／夹具／brief／验收；Claude 全真安装夹具并执行。

**Goal:** 关闭 P0-1／P0-A 测试台 `PASS WITH GAP` 中「缺夹具未验 fail-closed」部分；INDEX 升为更紧结果（至少可选用例不再因缺夹具 BLOCKED）。

**Architecture:** 仓库内版本化夹具 YAML → Claude 拷入 demo volume／经 semantic-assets publish／reindex 生效 → MCP 全真跑 CALIBER-02／EXPOSURE-02 → 强制清理 → Cursor 改 INDEX／e2e。

## 分工

| 角色 | 做 | 不做 |
|---|---|---|
| Cursor | 升级 cases／fixtures；Plan＋brief；验收 INDEX／e2e／lint | 不伪造跑次 |
| Claude | 安装夹具；全真 MCP；写 runs；清理 | 不改 Spec 合同；不改产品代码；不写 secret |
| 委托人 | 已批准夹具写入 demo volume | — |

## 范围

| Suite | 必做本波 | 备注 |
|---|---|---|
| CALIBER-BINDING | R0／R0-UPGRADE／**CALIBER-02** | CALIBER-01 可选冒烟（夹具清理后） |
| FIELD-EXPOSURE | R0／R0-UPGRADE／**EXPOSURE-02** | 测后必 cleanup；EXPOSURE-01 可选冒烟 |

SAG-02／其它 P0 套件：**不做**。

## Tasks

- [x] T0 委托人批准 Wave B＋夹具升级
- [x] T1 Cursor：夹具 YAML＋cases／fixtures.md＋Plan／brief
- [x] T2 Claude：安装 → 执行 → 清理 → 写 `…-p0-wave-b.md` 跑次（CALIBER PASS；EXPOSURE BLOCKED）
- [x] T3 Cursor：验收 → INDEX／e2e／总账／lint；登记 GAP-UAT-P0-A-EXPOSURE

**≠ 可上线；禁止 docker restart 伪装修复（夹具生效用 publish／reindex）。**

## 目标（治理补齐）

验证CALIBER-02/EXPOSURE-02并关闭缺夹具的证据缺口。

## 开工前置（治理补齐）

先核对Wave B夹具写入授权、R0/R0-UPGRADE及publish/reindex路径，预留cleanup。

## 验收（治理补齐）

核对安装、全真执行、清理的完整链路；按原Tasks保留CALIBER PASS与EXPOSURE BLOCKED，不新增成功结论。

## 完成定义（治理补齐）

两套有真实runs，INDEX/e2e按实际判定；GAP-UAT-P0-A-EXPOSURE及清理结果保留可追。

## 风险（治理补齐）

暴露台账可能影响KTX装载；publish/reindex失败停表上报，禁止docker restart伪装修复。
