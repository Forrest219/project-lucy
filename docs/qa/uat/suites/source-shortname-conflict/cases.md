# 用例

> 现值：R0／01–03 已于 2026-11-19 按改前复现剧本执行，02 FAIL 证明缺陷；下列修复后期望及 04–09 均未执行。修复后须在同一候选镜像完整执行 R0／01–09，不得只跑临时处理或负向拒绝。

| 编号 | 操作 | 产品期望 |
|---|---|---|
| UAT-SNC-R0 | 检查候选镜像版本与 schema-structure.ts、catalog-assets.ts、acl.ts、index.ts、source-name-registry.ts 哈希；启动独立 Lucy＋MySQL，创建 weather.city、ods.city，均插入一条数据；真实引导管理员、用真实 Bearer 调 MCP | 关键代码相同、服务可用、凭据不出现在证据里；候选身份与 dirty 状态留档 |
| UAT-SNC-01 | 从 weather 扫描并经管理 API 上传生成 Manifest，保存启用表，MCP 目录／读表／聚合查询 | city 来源正确、COUNT 为 1；合法路径基线可用 |
| UAT-SNC-02 | 再从 ods 扫描，**不手工修改生成 YAML**；验证、上传并保存两张启用表；检查响应后调用 tools/list、catalog、begin、read、query，再分别查 weather.city 与 ods.city | ods 自动分配 `ods_city`；validate／upload 成功；`policyRuntimeAck=true`、`runtimeAck=true` 且无 Source Map issue；不重启容器，五条路径全部成功，两表 COUNT 各为 1；原改前 FAIL 转 PASS |
| UAT-SNC-03 | 为 weather.city 与 ods_city 建立合法 Role、overlay、已保存查询夹具；再次扫描并覆盖上传两个 Schema，重放原查询 | 有效物理表→短名映射不漂移；Role、overlay、已保存查询不被改写；原查询仍成交。2026-11-19 的 03 仅是临时处理对照，不代替本条 |
| UAT-SNC-04 | 在 02 的健康状态上，手工把 ods 候选改回裸 `city`；调用 validate 与 upload；比较目标文件和上传记录前后摘要，再重放 01 的 MCP 调用 | validate `valid=false` 且含 `DUPLICATE_SOURCE_NAME` 与冲突双方／建议；upload 400；目标文件和发布记录不变；既有合法 MCP 仍可用，不只证明“拦住” |
| UAT-SNC-05 | 在同一 Connection 预置合法 `ods_city` 占用，再扫描 ods.city；上传、启用并分别查询占用表和 ods.city | 新表确定性分配 `ods_city_2`，不覆盖既有占用；最终无冲突，两表真实可查 |
| UAT-SNC-06 | 准备两个不同 Schema 的裸 `city` 候选，使锁外校验均可基于旧快照通过；并发调用 upload；检查响应、最终文件、release／journal 与既有 MCP | 发布锁内复核只让一个候选写入，另一个明确失败；无半份发布状态，最终集合无新增冲突，既有合法 MCP 不受影响 |
| UAT-SNC-07 | 用磁盘夹具注入旧 `city` 冲突以模拟升级前资产；调用启用表保存与连接创建；随后通过 API 上传唯一短名并重新保存，全程不重启容器 | 失败时既有 `written`／HTTP 兼容语义可保留，但 `policyRuntimeAck=false`、`runtimeAck=false`，`policyRuntimeIssues` 含 `source_map_compile_failed:*`；不得被其他 ack=true 覆盖。修复后两个 ack 恢复 true，五条 MCP 路径恢复 |
| UAT-SNC-08 | 预置至少六组互不相同的旧短名冲突；逐份上传唯一短名，保留每一步 `sourceNameConflicts` 与 ack；最后一组修复后重放 MCP | 候选修复不被无关旧冲突阻断，冲突数量逐步下降；候选自身冲突仍被拒绝；最后编译、ack 与查询恢复。只证明合成六组，不冒充客户现场六对 |
| UAT-SNC-09 | 汇总原始 API／JSON-RPC、生成 YAML、磁盘摘要、策略 issue、两条 COUNT、清理状态；核对 INDEX 与跑次 | 证据可复查且无凭据；全部必做通过才可把套件改为 PASS，任一失败保持 FAIL；容器、网络、私有目录清理完成 |

扫描入口：POST `/api/connections/hive-1/schema-structure`；上传：POST `/api/catalog/assets/validate` 与 `/api/catalog/assets/upload`；保存启用表：PUT `/api/connections/hive-1/enabled-tables`。MCP 始终访问 Lucy Proxy `/mcp`，不直连 KTX。

执行入口拟沿用 `python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify`；该参数与验证步骤尚未实现，需随修复另行授权 runner 修改。当前不得把本页设计写成已跑结果。
