# 用例

> 现值：改前 [2026-11-19 repro](runs/2026-11-19-codex-docker-repro.md) 02 FAIL；改后 [2026-11-20 verify](runs/2026-11-20-cursor-docker-verify.md) R0／01–09 **PASS**（INDEX＝PASS）。修复合同 [Spec v0.2](../../../../specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md)。WebUI 认读 ack 由 Spec SC-10 组件测试覆盖，本套件默认不跑浏览器、不写 demo 口令进证据。

| 编号 | 操作 | 产品期望 |
|---|---|---|
| UAT-SNC-R0 | 核对候选镜像与宿主 `schema-structure.ts`、`catalog-assets.ts`、`acl.ts`、`index.ts`、`source-name-registry.ts` 哈希一致；启动**独立** Lucy＋MySQL；创建 `weather.city`、`ods.city` 并各插入一行；真实 bootstrap 管理员；合成 Agent Bearer 调 MCP | 关键代码相同、服务可用、凭据不出现在证据；候选 digest／gitSha／dirty 留档 |
| UAT-SNC-01 | 扫描 weather → validate／upload → 启用 `weather.city`；MCP tools/list、catalog、begin、read、query | `city` 可用；`COUNT(city.id)=1` |
| UAT-SNC-02 | **不手改 YAML**再扫 ods → validate／upload → 启用两表；查 ack 后重放五条 MCP，并分别查 weather／ods | 生成键为 `ods_city`（非裸 `city`）；validate／upload 成功；`policyRuntimeAck=true`、`runtimeAck=true` 且无 `source_map_compile_failed`；不重启；五路径成功；两表 COUNT 各 1；改前 FAIL 转 PASS |
| UAT-SNC-03 | 建立 Role／overlay／已保存查询夹具（指向 `city` 与 `ods_city`）；重扫并覆盖上传两 Schema；重放查询 | 物理表→短名不漂移；夹具不被改写；查询仍成交（≠ 2026-11-19 临时改名对照） |
| UAT-SNC-04 | 在 02 健康态上手改 ods 候选为裸 `city`；validate＋upload；比对目标文件／上传记录摘要；重放合法 MCP | `valid=false` 含 `DUPLICATE_SOURCE_NAME`、双方物理表与建议；upload 400；磁盘／发布记录不变；既有 MCP 仍可用 |
| UAT-SNC-05 | 同 Connection 预置合法 `ods_city` 占用后，使 `ods.city` **无**有效旧映射再分配（如先清 ods Manifest 再扫，或另表占用 `ods_city`）；上传启用并查两表 | 新分配 `ods_city_2`；最终无冲突；两表可查 |
| UAT-SNC-06 | 两 Schema 裸 `city` 候选锁外均可过；并发 upload | 锁内只让一个成功，另一明确失败；无半份 release／journal；最终无新增冲突；既有 MCP 不受影响 |
| UAT-SNC-07 | 磁盘注入旧 `city` 冲突；调用启用表保存（及可达的连接写入路径）；再 API 修复并保存；不重启 | 失败时 `written`／HTTP 可兼容，但 `policyRuntimeAck=false`、`runtimeAck=false`，`policyRuntimeIssues` 含 `source_map_compile_failed:*`；修复后 ack 与五路径恢复 |
| UAT-SNC-08 | ≥六组互不相同旧短名冲突；逐份唯一化上传；保留每步 `sourceNameConflicts` | 无关旧冲突不阻断；候选自身冲突仍拒；冲突数下降；最后编译／ack／查询恢复。完整清单以 `sourceNameConflicts[]` 为准 |
| UAT-SNC-09 | 汇总脱敏证据、清理状态；更新 INDEX／跑次 | 无凭据泄漏；全必做 PASS 才改 INDEX＝PASS，否则 FAIL／BLOCKED；隔离容器／网络／私有目录已清理 |

扫描：`POST /api/connections/hive-1/schema-structure`；校验／上传：`POST /api/catalog/assets/validate|upload`；启用表：`PUT /api/connections/hive-1/enabled-tables`。MCP 走 Lucy Proxy `/mcp`，不直连 KTX。

执行：

```bash
SNC_IMAGE=project-lucy:demo \
  python3 scripts/uat/reproduce-source-shortname-conflict.py --mode verify
```

`--mode repro` 保留改前缺陷复现。本页不得把设计写成已跑结果；判定只看 `runs/` 与 INDEX。
