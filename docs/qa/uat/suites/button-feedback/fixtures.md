# Fixtures — button-feedback

| 项 | 内容 |
|---|---|
| 实例 | 本机 demo Docker（`compose-lucy-1` healthy），WebUI 默认映射 `55176`；回环地址可用 |
| 凭据 | 管理员 URL／id／密码按行存放在仓库外的凭据文件（第 1 行 URL，第 2 行 id，第 3 行密码）；探针只读入进程，不打印、不落盘 |
| 数据前置 | 至少 1 个 Agent；1 篇 Wiki；1 个已启用表（`demo-mysql.dataforai.superstore_orders`）；至少 1 个有可读 Manifest 的 Schema；审计与配置审计页有数据（探针本身签发 Token 会产生配置审计行） |
| 真实失败来源 | S02：同标签再次签发（服务端 `TOKEN_LABEL_TAKEN`）；07：对账导出在 demo 数据下真实 `409`（不是固定前置，是当前实例行为，随数据变化） |
| 不具备的前置 | 评测运行记录、已发布版本、低权限账号：demo 没有，对应入口标 NOT-RUN |
| 清理 | S01 签发的 `uat-btn-probe-*` Token 必须吊销（探针内置，失败则整轮 FAIL） |
| 证据 | `inbox/uat-button-feedback-<日期>/probe-result.{json,md}`（临时目录）；摘要与原始结果存入 `runs/evidence/` |
