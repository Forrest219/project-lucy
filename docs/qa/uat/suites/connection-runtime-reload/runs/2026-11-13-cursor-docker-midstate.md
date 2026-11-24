# Run — 2026-11-13 — cursor-docker-midstate

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CONN-RELOAD` |
| Agent | Cursor |
| 环境 | WebUI `http://127.0.0.1:55176`；容器 `compose-lucy-1`；`lucyVersion=0.30.0`；`gitSha=ea4ef839195a` |
| 开始／结束 | 2026-11-13（同日会话） |
| 总判定 | **PASS** |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | PASS | lucy／demo-db healthy；capability `idle`；`activation=current` |
| UAT-CONN-RELOAD-C01 | PASS | `verify-ktx-reload-lifecycle.sh --container` → **PASSED: 25 checks**（含 VERIFY-191-C01 canary）；日志 `inbox/uat-verify-191-c01-*.log` |
| UAT-CONN-RELOAD-E2E-02 | PASS | `npm run e2e:live:connection-reload` → E2E-MCP-02 **2.7s** |
| UAT-CONN-RELOAD-E2E-07 | PASS | 同命令 → E2E-CON-07 **8.9s**；`executionRuntimeAck` 路径绿；**2 passed** |
| UAT-CONN-RELOAD-01 | PASS | 由 E2E-07 与 C01 覆盖；未使用 `docker restart` |
| UAT-CONN-EDIT-01 | SKIPPED | 本跑次未单独做 Edit |
| UAT-CONN-RELOAD-02 | SKIPPED | 可选失败可观测 |

## 备注

- 是否使用 `docker restart`：**否**
- 清理：live-e2e 与 verify 脚本自行清理 canary／临时连接
- 登录文件：`/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（live-e2e 默认）
