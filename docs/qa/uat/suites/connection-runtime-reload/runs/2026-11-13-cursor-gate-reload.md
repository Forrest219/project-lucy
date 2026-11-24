# Run — 2026-11-13 — gate-reload

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CONN-RELOAD` |
| Cases | `UAT-CONN-GATE-01`、`UAT-CONN-RELOAD-02` |
| Agent | Cursor |
| 环境 | `compose-lucy-1`；WebUI `http://127.0.0.1:55176`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96` |
| 命令 | `node scripts/uat/run-zhaomin-local-gaps.mjs gate` 然后 `reload` |
| 总判定 | **PASS**（本批两条）。先前整套热重载 PASS 仍有效；本批未重跑 E2E-07／C01 |

| Case | 结果 | 证据 |
|---|---|---|
| UAT-CONN-GATE-01 | **PASS** | `POST /api/connections`，`database=hive.dw`，不带确认。409 `SAME_SERVER_DIFFERENT_DATABASE`，文案「这是另一个外部目录，不会加到已有连接。确认后将新增一张连接卡片。」id `uat-gate-mwep68dp` 未写入 `ktx.yaml` |
| UAT-CONN-RELOAD-02 | **PASS** | 把能力文件标成 `reloading` 后，用容器内 `node` 对 supervisor pid 193 发 `SIGSTOP`（镜像里没有 `kill` 可执行文件）。新建 `uat-reload-fail-mwep6qrk` 返回 **503** `EXECUTION_RUNTIME_NOT_LOADED`，「配置已保存，但执行层未加载。」`ack` 不是 true。`finally` 已 `SIGCONT` 并还原能力文件。删除连接 200，残留 0。health `ok`，`activation=current`，supervisor pid 193 仍在，能力文件回到 `idle` |

未做「确认后真的连上外部目录」。未 `docker restart`。
