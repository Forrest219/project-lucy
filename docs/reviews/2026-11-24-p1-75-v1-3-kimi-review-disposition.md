# P1-75 v1.3 扩容 Kimi 评审处置

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-75 v1.3 扩容 Kimi 评审处置 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Claude |
| 委托人 | xingchen |
| 基于材料 | [Kimi 评审报告](2026-11-24-p1-75-v1-3-all-pages-no-503-kimi-review.md)（BLOCK，R-01 至 R-20）；P1-75 Spec v1.4、Plan v1.3、UAT v1.3 |
| 适用范围 | 逐条记录 R-01 至 R-20 的处置位置，供终稿确权与开发授权前复核 |
| 输出位置 | `docs/reviews/2026-11-24-p1-75-v1-3-kimi-review-disposition.md` |

## 结论

BLOCK 全部接受。20 条意见均已在 Spec v1.4、Plan v1.3、UAT v1.3 及联动文档中处置。本文只记设计层处置，**不含开发授权**，处置完成不等于 UAT PASS，也不等于可上线。

## 逐条处置

| 编号 | 级别 | 处置 | 落点 |
|---|---|---|---|
| R-01 | BLOCK | 采纳。§2.4 改为 v1.4 起取消 4 秒 503，无视图请求内等待 10 秒后 `pending`；Plan 旧 V1／V2／B3 条目标注为 v1.2 现状基线，v1.4 判定见 X1 | Spec §2.4；Plan 100／V1／V2 |
| R-02 | BLOCK | 采纳。附录 A 列出全部 8 个 `DisplayBusyReason` 与 `PROBE_QUEUE_*`；自动探测归 A，主动探测归 D | Spec 附录 A，OQ-4 决议 |
| R-03 | BLOCK | 采纳。附录 A 登记 `AUTH_CONFIG_UNAVAILABLE`、`STORE_UNAVAILABLE`、`META_AUDIT_*`、`RECONCILIATION_*` 等；未登记 503 判失败，X1 自动对账 | Spec 附录 A、§2.5 判定规则 1 |
| R-04 | BLOCK | 采纳。A 类只约束页面业务读，`readyz stuck` 归 B；P1-81 §3 失败定义纳入越宽限降级 200（只改文档，已落地看门狗对齐须另行授权） | Spec §2.5 判定规则 3；P1-81 §3、v0.2-r1 |
| R-05 | BLOCK | 采纳。服务条件加入 `principalScope`＋权限版本；响应写出前复核；新增 10-F（跨身份）、10-H（在途撤权） | Spec §2.5.1；UAT 10-F／10-H |
| R-06 | MAJOR | 采纳。新增 09-F 关闭降级对照臂；对照臂未复现则标 `BLOCKED`；X2 要求 A3 结论评审 | UAT 09-F；Plan X2／X6 |
| R-07 | MAJOR | 采纳，二次复核后补全。B 类上限：排空 20 秒、重载 60 秒、`write_pending` 暂定 180 秒、`warming_up` 暂定 120 秒；`ACCESS_RECOVERY_REQUIRED` 无时间上限（只能管理员显式恢复），改归 C 类；UAT 判 B 类超限 `FAIL` | Spec 附录 A；UAT 09 判定 7 |
| R-08 | MAJOR | 采纳。矩阵源加入 PO-01／PO-02，补详情页并取消页签上限，由非作者复核者对账；记录 `/admin/accounts` 与 `/admin/admins` 差异 | Spec §2.5 覆盖矩阵；Plan X0 |
| R-09 | MAJOR | 采纳。每窗分母与样本下限、逐格内容正确性、`pending` 无数据字段、09-E 逐对象判定 | UAT 09 窗口表与判定 2／3 |
| R-10 | MAJOR | 采纳，二次复核后补全。09-F 改为三臂：改前臂证明负载判别力，最终候选关闭降级臂以 A 类 503 为零且内容正确为合格；09 增加宿主隔离条件（关闭清单 A2）；X6 开跑前核对 | UAT 09 宿主隔离、09-F；Plan 开工前置 5、X6 |
| R-11 | MAJOR | 采纳。P1-82 加指针：SC-04 的 503 构造按 P1-75 附录 A 改读，本条范围与已实现部分不变 | P1-82 v0.2-r1 |
| R-12 | MAJOR | 采纳。启用表范围页在 `stale`／`pending` 下不触发缺 Manifest／无效启用判定，新增 10-G | Spec §2.5.1 边界 3；UAT 10-G |
| R-13 | MAJOR | 采纳。10-D 加安全注入约束：独立实例与数据卷、注入前冻结摘要、撤除后无需重启恢复 | UAT 10 安全注入约束 |
| R-14 | MAJOR | 采纳。删去「SC-01–08 合同与证据不变」，改写为 08-B 旧证据只保留历史意义、须按新口径重跑 | Spec 头部扩容修订；UAT 08 说明；INDEX |
| R-15 | MAJOR | 采纳。OQ-3 关闭为字段集合冻结；交互合同与术语登记升级为 X3／X5 前置门槛 | Spec OQ-3；Plan 开工前置、X3／X5 |
| R-16 | MAJOR | 采纳。宽限改为元数据 120 秒、全量摘要 180 秒，分别对应 `metadata_overdue`／`digest_overdue` | Spec §2.5.1、附录 A |
| R-17 | MAJOR | 采纳。「根因」改为「候选机制」，唯一结论等 close-checklist A3 证据 | Spec §2.5「根因优先」 |
| R-18 | MAJOR | 采纳。P3 画像行补写；手动刷新挂 09-D；P2／P4 补偿挂 SC-09／10 | Spec 画像表；UAT 09-D |
| R-19 | MINOR | 采纳。INDEX 只保留范围与结果，授权说明回到开发台 | INDEX 第 13 行 |
| R-20 | MINOR | 采纳。Plan 头部镜像 Spec 状态；总账头部版本升至 v2.64，需求池升至 v0.164 | Plan 头部；总账；需求池 |

## 仍需委托人决策

1. SC-09／10 与 X0–X6 的开发授权（本次明示不授权）。
2. 已落地的 P1-81 看门狗与展示读探针是否对齐新失败定义（本次只改文档）。
3. 已确认（2026-11-24）：`write_pending` 180 秒、`warming_up` 120 秒作为 X0 复核起点与验收上限，超限判失败，不得重开窗口或改分类，调整留变更记录；`DISPLAY_RECONCILIATION_FAILED` 命名接受，X1 冻结。设计复核通过，状态为待开发授权。
4. 降级占比上限：09 首次实测后写入变更行，在此之前只报告、不作通过条件。

## 二次复核（2026-11-24，Codex 意见＋委托人批准）

| 编号 | 意见 | 处置 |
|---|---|---|
| C-1 | 09-F 把成功的根因修复判成 `BLOCKED` | 已拆为三臂，见 R-10 |
| C-2 | `reconcile_failed` 越界处置自相矛盾 | 委托人选定：同一作用域持续 `reconcile_failed` 超过 D_max 转 C 类 503（拟 `DISPLAY_RECONCILIATION_FAILED`），非错误型降级越界仍 200；计时不被新请求重置；新增 UAT 10-J，10-I 收窄为非错误型 |
| C-3 | B 类缺上限 | 见 R-07 |
| C-4 | 200 状态模型歧义 | 统一为 `fresh`／`grace`／`stale`／`pending` 四种；后三者为降级态；`pending` 记连续待定时长；P1-81 失败判定改为 `stale`、`pending` 均计失败 |
| C-5 | 09-D／E／F 无样本下限；宿主隔离未处置 | 已补每格下限与分母、宿主隔离条件 |
| C-6 | P1-81／P1-82 联动不精确 | Plan 前置改为 P1-81 运行代码对齐并验证（另行授权）；P1-82 指针收窄为 A 类展示读故障，不含 B、C 类 |
| C-7 | `question_budget_unavailable` 误归 D | 改归 C |
