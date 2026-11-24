# 用例

> 现值：本轮 [R1–R3 Docker／浏览器复验](runs/2026-11-20-codex-sc09-final.md) R0／01–12 **PASS**；视口断言补跑PASS，历史改前FAIL保留。合同 [Spec v0.3](../../../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md) SC-09全库类型0错误、413＋29回归通过，整包更新另行评审。WebUI必须真实前台浏览器／即时计时（12），不写凭据进证据。

| 编号 | 操作 | 产品期望 |
|---|---|---|
| UAT-SNC-R0 | 核对候选镜像与宿主 `schema-structure.ts`、`catalog-assets.ts`、`acl.ts`、`index.ts`、`source-name-registry.ts` 哈希一致；启动**独立** Lucy＋MySQL；创建 `weather.city`、`ods.city` 并各插入一行；真实 bootstrap 管理员；合成 Agent Bearer 调 MCP | 关键代码相同、服务可用、凭据不出现在证据；候选 digest／gitSha／dirty 留档 |
| UAT-SNC-01 | 扫描 weather → validate／upload → 启用 `weather.city`；MCP tools/list、catalog、begin、read、query | `city` 可用；`COUNT(city.id)=1` |
| UAT-SNC-02 | **不手改 YAML**再扫 ods → validate／upload → 启用两表；查 ack 后重放五条 MCP，并分别查 weather／ods | 生成键为 `ods_city`（非裸 `city`）；validate／upload 成功；`policyRuntimeAck=true`、`runtimeAck=true` 且无 `source_map_compile_failed`；不重启；公开路径成功（begin 按文末 P1-60 合同）；两表 COUNT 各 1；改前 FAIL 转 PASS |
| UAT-SNC-03 | 建立 Role／overlay／已保存查询夹具（指向 `city` 与 `ods_city`）；重扫并覆盖上传两 Schema；重放查询 | 物理表→短名不漂移；夹具不被改写；查询仍成交（≠ 2026-11-19 临时改名对照） |
| UAT-SNC-04 | 在 02 健康态上手改 ods 候选为裸 `city`；validate＋upload；比对目标文件／上传记录摘要；重放合法 MCP | `valid=false` 含 `DUPLICATE_SOURCE_NAME`、双方物理表与建议；upload 400；磁盘／发布记录不变；既有 MCP 仍可用 |
| UAT-SNC-05 | 同 Connection 预置合法 `ods_city` 占用后，使 `ods.city` **无**有效旧映射再分配（如先清 ods Manifest 再扫，或另表占用 `ods_city`）；上传启用并查两表 | 新分配 `ods_city_2`；最终无冲突；两表可查 |
| UAT-SNC-06 | 两 Schema 的 shared 候选在任一上传前都 validate=true；并发 upload；仅具名忙拒绝可进入窗口释放后的原候选重试 | 恰一上传成功；失败为 400／DUPLICATE_SOURCE_NAME，或具名 busy 后重试必须返回此码；非预期 5xx FAIL；失败侧无文件／上传记录／journal 推进；合法 MCP 仍可用。受控锁内时序另由 SC-04 单测证明 |
| UAT-SNC-07 | 磁盘注入旧 `city` 冲突；调用启用表保存（及可达的连接写入路径）；再 API 修复并保存；不重启 | 失败时 `written`／HTTP 可兼容，但 `policyRuntimeAck=false`、`runtimeAck=false`，`policyRuntimeIssues` 含 `source_map_compile_failed:*`；修复后 ack 与公开路径恢复（begin 按文末 P1-60 合同） |
| UAT-SNC-08 | ≥六组互不相同旧短名冲突；逐份唯一化上传；保留每步 `sourceNameConflicts` | 无关旧冲突不阻断；候选自身冲突仍拒；冲突数下降；最后编译／ack／查询恢复。完整清单以 `sourceNameConflicts[]` 为准 |
| UAT-SNC-10 | 旧 ods_zebra 指向 ods.zebra 后真实新建 ods.ods_zebra；两表一起重扫、上传、启用并分别查询 | 旧来源仍读原表的 1 行；新增来源 ods_ods_zebra 读新表的 2 行；不得只证明名称唯一 |
| UAT-SNC-11 | 真实 aux.City，分别走 namesOnly 与字段读取，再上传／启用并查询 | 自动唯一短名 aux_City，物理标识仍 aux.City，COUNT(id)=1；大小写身份不丢失 |
| UAT-SNC-12 | 真实前台浏览器登录独立 Docker，操作启用表页与连接创建 Drawer 的成功、冲突未确认、恢复成功；采集导航／保存到反馈可见和 API 耗时 | visible 且 hasFocus；ack=false 不出现无条件成功、可读展示 Source Map issue；恢复后成功；原始计时 JSON 与脱敏截图留档；禁止 mock API／DOM |
| UAT-SNC-09 | 汇总脱敏证据、清理状态；更新 INDEX／跑次 | 无凭据泄漏；全必做 PASS 才改 INDEX＝PASS，否则 FAIL／BLOCKED；隔离容器／网络／私有目录已清理 |

扫描：`POST /api/connections/hive-1/schema-structure`；校验／上传：`POST /api/catalog/assets/validate|upload`；启用表：`PUT /api/connections/hive-1/enabled-tables`。MCP 走 Lucy Proxy `/mcp`，不直连 KTX。

执行：

```bash
SNC_IMAGE=project-lucy:demo \
  python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify --browser
```

`--mode repro` 保留改前缺陷复现。本页不得把设计写成已跑结果；判定只看 `runs/` 与 INDEX。

本轮判定以新的完整 R0／01–12 跑次为准。v0.2 跑次的 PASS 只保留历史；R3 修订后不得用 HTTP 500 本身代表已通过唯一性复核。


### 当前工具面兼容（P1-60 已生效）

本夹具无有效问询上报绑定，因此 tools/list 不公开 lucy_begin_question；强制调用的精确 `begin_not_available` 为既有 P1-60 合同预期，不记成可调用工具成功。UAT 仍要求 tools/list、catalog、read、query 四条公开主路径真实成功；若 begin 公开则必须成功；其他 isError 不得豁免。此处不是对短名拒绝的降级或回避。
