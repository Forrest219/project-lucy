# Run — 2026-11-13 — mysql-version-matrix

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN`／`UAT-SCAN-MYSQL-VER` |
| Agent | Cursor（委托人批准矩阵自 5.7 起） |
| 环境 | lucy `compose-lucy-1`；WebUI `http://127.0.0.1:55176`；叠加 `docker-compose.uat-mysql-matrix.yml` |
| 开始／结束 | 2026-11-13 |
| 总判定 | **PASS WITH GAP**（8.0＋8.4 PASS；**5.7 BLOCKED**＝本机 Docker 拉镜像走代理 `127.0.0.1:7890` 拒绝，无本地 `mysql:5.7` 缓存） |

| Case / 档 | 版本（实测） | 结果 | 证据摘要 |
|---|---|---|---|
| mysql-8.4-demo | **8.4.13**（`demo-db`） | PASS | 宽表 ≥80（库内已 200）；live-schemas／namesOnly／单表 columns=6；`executionRuntimeAck=true`；无 restart |
| mysql-8.0 | **8.0.46**（本地 tag `mysql:8.0` → `uat-mysql80`） | PASS | 新种 80 表；同上全真 API 路径绿；测后 remove |
| mysql-5.7 | （目标 `mysql:5.7` amd64） | **BLOCKED** | `docker compose up uat-mysql57` 拉镜像失败：registry 经 `docker.m.daocloud.io` → `127.0.0.1:7890` connection refused；本机无 5.7 缓存 |

## 命令

```bash
bash scripts/uat/run-mysql-version-matrix.sh
```

日志：`inbox/uat-mysql-matrix-20261113-131058.jsonl`、`inbox/uat-mysql-matrix-run.log`

## 解除 5.7 BLOCKED

1. 修复 Docker 拉取代理（或关闭失效的 `127.0.0.1:7890`），使 `docker pull --platform linux/amd64 mysql:5.7` 成功；或  
2. 预先 load 本机已有的 `mysql:5.7` 镜像后重跑矩阵脚本。

**未**用 CR／跳过主张 5.7 已验证。
