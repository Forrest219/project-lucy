# Run — 2026-11-13 — case-diff rerun

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN` |
| Cases | `UAT-SCAN-CASE-01`、`UAT-SCAN-DIFF-01` |
| Agent | Cursor |
| 环境 | `npm run demo:upgrade`（`BUILDPLATFORM=linux/arm64`，保留 volume）之后。WebUI `http://127.0.0.1:55176`。`gitSha=3aa402c9bd657cbf7e72a68b6fa271540da29690`，`gitDirty=true`。`aa559a1c` 是该 sha 的祖先 |
| 命令 | `node scripts/uat/run-zhaomin-local-gaps.mjs case` |
| 总判定 | **PASS** |

| Case | 结果 | 证据 |
|---|---|---|
| UAT-SCAN-CASE-01 | **PASS** | 库 `uat_case_pair` 含 `Foo`／`foo`／`only_one`。连接 `uat-case-mwepu1d7`，`executionRuntimeAck=true`。请求 `Foo` 返回 **400** `READ_FAILED`，「表名「Foo」对应多张表，无法读取字段。」`columnCount=null`。对照 `only_one` 为 200，`columnCount=1`，`namesOnly=false`。无口令明文 |
| UAT-SCAN-DIFF-01 | **PASS** | `GET table-structure-diff?schema=uat_case_pair&tables=only_one,missing_tbl` 返回 200。`only_one` **status=ok**。`missing_tbl` **status=not_in_library** |

测后连接已删，`ktx.yaml` 无该 id，`uat_case_pair` 已删除。未 `docker restart`。

相对 [2026-11-13-cursor-case-diff](2026-11-13-cursor-case-diff.md)：上一跑次镜像 `ea4ef839` 上这两条为 FAIL。本跑次容器已包含按表读取。外部目录 live 仍未跑。
