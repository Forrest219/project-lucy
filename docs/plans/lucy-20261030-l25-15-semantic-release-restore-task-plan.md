# L25-15 落地 Task：语义发布历史版本与整批恢复

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实现 Task / v1.1 |
| 日期 | 2026-10-30 |
| 状态 | **波次 A–F 运行代码已落地，第二轮按 Plan v0.11 的 S1–S6 退出条件收口，SRR 仍未执行**。设计合同仍是 Spec v0.11 / Plan v0.11。证据见 [实现记录](../reviews/2026-10-30-l25-15-implementation-evidence.md) |
| 授权边界 | 2026-10-30 用户授权制定本 Task，以实现 L25-15 的实现收口。授权按下方波次 A–F 写代码和对应测试。**不授权** S7、浏览器验证、移动窄屏、镜像构建、部署、推送、客户交付、修改 KTX、把 SRR-01–SRR-24 标成已通过 |
| 验收 | 每波以 Plan 该阶段退出条件的自动化证据为退出。测试通过不等于 SRR 验收通过。SRR 状态保持未执行，直到实施记录写下初态、输入和实际输出 |
| 合同 | [Spec v0.11](../specs/lucy-20261027-v0p25-semantic-release-restore-spec.md) · [Plan v0.11](2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md) · [第 4 轮复核](../reviews/2026-10-30-l25-15-implementation-ready-review.md) |
| 文件名说明 | 本文件是**落地 Task**（授权 + 波次拆分），不是主 Spec 的那份 Plan——那份是已冻结的 [Plan v0.11](2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md)，沿用存量文件名，不改名。本 Task 按「新 Plan 唯一文件名」规则取 `lucy-YYYYMMDD-<slug>-plan.md` 形态，slug 取 Task 自身的日期与身份 |

## 目标

把已定稿的整批恢复按 Plan S1–S6 落到 WebUI。收口指：正式写入口有批次前快照，恢复 API 与发布历史 UI 可用，保留和恢复包有上限，本地回归与文档回写完成。客户交付不在本 Task。

## 开工前置

- Spec／Plan v0.11 已定稿。写入口清单以 Spec §2.2 为准。再发现正式内容写点时，先改清单再编码。
- 锁以 Spec §5.2.1 为准。快照、promoting 与 journal 接在 `3b7e8d32` 已经盖住的临界区内部、首个正式写入之前。不得把释放点提前到 reindex 返回时。`semantic_restore` 锁留到自身终态之后。
- v0.10「S1–S7 不得触及 `semantic-assets.ts` 锁生命周期、外部工作项是唯一保障」不作开工指令。
- 提交前重读基线，并拒绝与 `promoting`／`reindexing`／`terminalAuditPending=true` 的批次重叠。
- `writeSourceYamlImport` 先进入发布窗口再接快照。`applyConnectionIdChange` 只做互斥，不生成可恢复快照。纯手动 reindex 不生成内容快照。
- L25-11 的 V01–V22 仍未执行。本 Task 不把 `3b7e8d32` 写成 L25-11 验收通过，也不改 L25-16 的 G31 登记。

## 波次

顺序固定。后一波不得先于前一波进入可运行构建。波次 A 不开放恢复提交。

| 波次 | Plan | 依赖 | 这一波交付 | 退出 |
|---|---|---|---|---|
| A | S1 | 无 | `semantic-release-snapshot/v1`、写入口对照表接线、promoting 与 snapshotId、journal 不提前终结、发布记录保留保护 | 要求快照的入口有写前失败零写入测试。连接 ID 变更只有互斥。手动 reindex 无内容快照。批量发布释放点仍在终态之后 |
| B | S2 | A | 预检、CAS、`semantic_restore` 提交、三态幂等、镜像写集分离、语义删除集合与六类启动对账、三个恢复 API | 临时内容根与临时 KTX 兄弟视图上的恢复闭环有 hash、范围和状态证据 |
| C | S3 | B | 发布历史里的整批恢复抽屉、`webui_restore` 筛选与 CSV、「生效待确认」投影、只读恢复包导出入口 | 组件与 API 测试通过。不以组件测试代替浏览器验收 |
| D | S4 | B；排在 C 之后 | 20 个 / 30 天 / 512 MiB、orphan、持久 lease、只读 ZIP 四项上限、崩溃后对账 | 容量边界、活跃 lease、损坏披露和故障恢复测试通过。无恢复包上传 |
| E | S5 | A–D | 定向测试、`lint:spec`、`lint:terminology`、`lint:ia-boundary`、webui test、webui build、`e2e:real:verify`、`git diff --check` | 实现层证据归档。`e2e:real:verify` 不生成 SRR 证据。失败与既有基线分开记录 |
| F | S6 | E | API 说明、术语、手册、覆盖矩阵和 Spec／Plan 状态回写 | 文档与实现一致。未执行和 blocked 项保持原状态 |

波次 C 的文案使用术语标准里的既有词。新术语先登记再出现在 UI。表身份、路径、格式名、ID 和 digest 加 `translate="no"`。

## 收口

实现收口同时满足：

1. 波次 A–F 的退出条件都有命令、提交和环境记录。
2. Spec §2.2 的快照入口都已接线；连接 ID 变更与手动 reindex 保持清单里的例外。
3. 锁释放点仍在 `3b7e8d32` 的终态之后。
4. SRR-01–SRR-21、SRR-23、SRR-24 有实现层证据，或在实施记录里保持 `not_run` 并写明缺什么。
5. SRR-22 保持 `blocked_environment` / `blocked_delivery`。

实现收口不关闭客户交付，也不把 SRR 未留证的条目改成通过。

## 验收

本 Task 的验收分两层，互不替代：

| 层 | 判据 | 状态 |
|---|---|---|
| 实现层 | 每波以 Plan 该阶段的退出条件为准，命令、提交与环境记录在实现记录里 | 见实现记录 |
| 功能层 | SRR-01–SRR-24 按各自证据层实际执行并通过 | **全部未执行**；SRR-22 保持 `blocked_environment` / `blocked_delivery` |

实现层的通过**不**关闭功能层，也不关闭客户交付。`e2e:real:verify` 只校验已有证据结构，不生成也不伪造 SRR 证据。

## 完成定义

本 Task 在下列条件下算完成：

1. Plan S1–S6 的退出条件逐项有可复核证据，落在实现记录里。
2. 写入口、恢复服务、发布历史 UI、保留与恢复包、审计与故障处理按 Spec 落地，文档与实现一致。
3. S5 的命令清单已跑完并如实归档；**全量失败分开写「本功能回归」与「既有基线」**，不只摘通过项。
4. 提交只含本功能获授权文件，排除无关工作区改动。
5. 未执行与 blocked 项保持原状态，不因实现完成而改写。

客户交付（SRR-22、amd64 镜像、现场验收）**不在**本完成定义内；本 Task 完成不等于客户交付通过。

## 风险

- 波次 A 若把快照放在发布锁外面，会绕开已经关上的临界区。
- 波次 B 若在 reindex 返回时放锁，或把 journal 在写盘后立刻终结，终态审计会落在锁外。
- 波次 B 若用 absent 目标代替语义删除集合，Manifest 原地删表会走错索引模式。
- 波次 D 若让恢复包复用维护包的 16 MiB 上限，或开放上传，会放宽只读合同。
- 波次 E 的全量失败不得只摘通过项。
