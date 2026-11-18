# Run — 2026-11-18 — cursor-cold-pause-off（暂停版冷启动＝COLD-07／08）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-COLD-START-SLOW-DISK` |
| 目的 | 暂停配置下首次升级／重启／主路径（对应 UAT-COLD-07／08；本跑以 `--env LUCY_INFERRED_MAINTAINER=off` 覆盖 02–05） |
| 被测镜像 | `project-lucy:p147-pause-uat`；`BUILD_REVISION=ff4762c9…-dirty`（arm64） |
| 对照镜像 | `project-lucy:old-9c78b0e3`（0.25.0） |
| 命令 | `npm run uat:cold-start -- all --new-image project-lucy:p147-pause-uat --label 2026-11-18-cold-pause-off --env LUCY_INFERRED_MAINTAINER=off --premigrate-wait-s 60` |
| 证据 | [evidence/2026-11-18-cold-pause-off/](evidence/2026-11-18-cold-pause-off/) |
| 判定 | **模拟 PASS（整体）**。暂停缓解；≠ P1-47 默认 PASS；≠ 客户现场；≠ 可上线 |

## 结果

| ID | 判定 | 要点 |
|---|---|---|
| R0 | PASS | 限速 9.3 MB/s；快照 943MB |
| 01 | PASS | 0.25.0 对照 37.1s 就绪 |
| 02（＝COLD-07） | PASS | 首次升级 114.3s；livez max／p99 **8／7** ms |
| 03（＝COLD-08） | PASS | 重启 29.5s；livez max／p99 **7／7** ms |
| 04 | PASS | 清缓存后 livez max 6ms |
| 05 | PASS | 管理员认领＋MCP initialize／tools/list |

**OVERALL: PASS**
