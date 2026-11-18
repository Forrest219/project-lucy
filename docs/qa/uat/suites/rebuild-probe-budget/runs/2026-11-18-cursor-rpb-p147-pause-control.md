# Run — 2026-11-18 — cursor-rpb-p147-pause-control（暂停开关对照实验）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| Agent | Cursor |
| 环境 | 本机 Docker Desktop（arm64）；blkio 读写 30MB/s、读 300／写 100 IOPS、2 核；`drop_caches`；快照 `lucy-uat-cold-snap-old`（20 万行／67 用户）；两次运行同一镜像、同一预迁移卷、同样注入 67 个用户近期行 |
| 被测构建 | `project-lucy:p147-pause`：修订 `6cc0029cfda213270dfee3b797681d542430a663-dirty`（含 P1-45／46／47 与暂停开关的工作树，**未提交**）；arm64 本机构建 |
| 变量 | 唯一差别：被测容器是否带 `LUCY_INFERRED_MAINTAINER=off`（`--env`，只作用于限速的被测容器，不作用于注入阶段） |
| 命令 | A：`node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:p147-pause --label 2026-11-18-p147-pause-off --premigrate-wait-s 60 --env LUCY_INFERRED_MAINTAINER=off`；B：同命令去掉 `--env`，label `…-pause-on`。证据：[evidence/2026-11-18-p147-pause/](evidence/2026-11-18-p147-pause/) |
| 门槛 | RPB-01：livez max ≤ 1000ms、p99 ≤ 400ms；readyz p99 ≤ 1500ms；客户 3s 观察器连续失败 < 6 |

| 对照 | 开关 | 总判定 | 就绪 | livez max／p99 | livez 样本 ≥1.5 秒 | readyz p99 | 客户 streak |
|---|---|---|---|---|---|---|---|
| A 暂停 | `off` | **PASS**（R0／01／02／03） | 30.6s | **11ms／9ms** | **0／119** | 10ms | 0 |
| B 不暂停（默认） | 未设 | **FAIL**（RPB-01） | 24.6s | **2662ms／2662ms** | **37／42**（中位数 1972ms） | 15ms | 0 |

## 结论

- **根因确认**：同镜像、同夹具，只切换后台补算维护器，livez 从「每约 3 秒一次 1.5–2.7 秒停顿」变成全程 ≤11ms。持续停顿来自维护器的重建，而不是启动、探针路径或其他后台任务。
- B 复现了 r2（max 2968ms、38／42 个样本 ≥1.5 秒），说明 r2 不是偶发。
- 该开关**不是修复**：默认配置（开）下 RPB-01 仍 FAIL。它是运维逃生阀，也是诊断手段。
- 暂停的代价见评估文档：审计页问询分组／编号不再随新调用更新；`inferredRebuild` 状态如实返回 `paused: true`、`complete: false`。
- **未回答**：停顿在重建内部具体是哪一段（WAL 检查点、写片提交 fsync、`access_log_sources` 冷读）。开关只证明来源是维护器，不区分段落；OQ-2 的手段选择仍需分段计时。

## 限制

- 候选为工作树 dirty 的 arm64 本机构建；限速台只是模拟；RPB-04（真实 K8s 端点）仍 BLOCKED。
- 暂停配置下的 PASS 不能写成 P1-47 PASS：它没有让重建本身变快，只是不跑重建。
- ≠ 可上线。
