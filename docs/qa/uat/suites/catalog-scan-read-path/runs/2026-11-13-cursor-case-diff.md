# Run — 2026-11-13 — case-diff

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN` |
| Cases | `UAT-SCAN-CASE-01`、`UAT-SCAN-DIFF-01` |
| Agent | Cursor |
| 环境 | `compose-lucy-1`；WebUI `http://127.0.0.1:55176`；`gitSha=ea4ef839195ac4e1b053977dd3a4bccdcd545f96`。工作区 tip 在此之后还有 `aa559a1c`，本跑次镜像未包含 |
| 命令 | `node scripts/uat/run-zhaomin-local-gaps.mjs case` |
| 总判定 | **FAIL** |

| Case | 结果 | 证据 |
|---|---|---|
| UAT-SCAN-CASE-01 | **FAIL** | 库 `uat_case_pair` 表为 `Foo`／`foo`／`only_one`。连接 `uat-case-mwep648v` `executionRuntimeAck=true`。请求 `Foo` 返回 **200**，`columnCount=4`，`tableCount=2`，`namesOnly=false`。期望是 400 且文案含「对应多张表」，不得把两张表的字段合成一份。对照 `only_one` 为 200、`columnCount=1`。无口令明文 |
| UAT-SCAN-DIFF-01 | **FAIL** | 同连接 `GET table-structure-diff?schema=uat_case_pair&tables=only_one,missing_tbl` 返回 200。`only_one` **status=ok**。`missing_tbl` **status=error**，`reason=QUERY_FAILED`。期望缺表为 `not_in_library` |

测后连接已删，`ktx.yaml` 无该 id，`uat_case_pair` 已删除。未 `docker restart`。
