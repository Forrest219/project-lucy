# Spec 174 缓存失效与权限一致性接线矩阵

| 字段 | 内容 |
|---|---|
| 日期 / 版本 | 2026-10-13 / v1.1（e189346重评） |
| 状态 | Code-reviewed inventory；hook/测试待Cursor实施 |
| 权威合同 | [Spec174 v1.2](../174-webui-entry-performance-spec.md) §3–4/7/9 |
| 执行工单 | [WO-20261013-174 v1.2](wo-20261013-webui-entry-performance.md) T1/T3/T5 |

本表是接线清单，不代表缓存失效已实现。接单时以checkout代码复核，每行补最终hook函数、querykey、测试路径/用例和结果；未覆盖行不能关闭G2。

本表从stash7653746提取并按当前代码复核，仍为18行；既有表结构准备/角色多选/审计变更纳入对应行，不另设第二套写入链路。

## 符号与约束

- D：当前语义/Manifest摘要；P：权限展示/Agent引用；C：连接/project/启用范围；L：live-schemas/健康任务配置代次；A：动态Agent/Token统计响应；U：当前WebUI登录账户边界。
- 服务端每次**真实修改前**begin屏障，落盘后通知，finally失效；失败可能部分写入同样通知。access外层屏障保持到policy commit/ack及rollback终结，内部safeWrite通知不能提前解屏障。
- 客户端先递增affected query epoch、取消旧请求，最终无论成功/失败都核对/失效。逻辑key见 `webui/src/lib/queryKeys.ts`；`['admin','agents']`目前硬编码，需清点。auth scope包装后所有invalidate使用同一builder，不能只改useQuery。
- 不因“目录”关键字对history备份、sidecar、临时上传、secret进行全盘失效；不读取secret内容进行指纹。

## 实际入口与测试要求

| 行 | 当前实际写入/读取入口 | 依赖 / 客户端逻辑key | 必须测试的边界（计划用例） |
|---|---|---|---|
| IM-01 | `webui/server/fs-safe.ts::safeWrite/safeRemove`（当前writeFile直接写）；`admin/config-audit-write.ts::auditedWriteFile/auditedRemoveFile` | 按resolved目标分类D/P/C，不统一误标所有文件 | 有审计/无审计、truncate中读取、部分失败、ENOENT、落盘后audit status失败；DI-01 |
| IM-02 | `webui/server/semantic-layer.ts::writeSourcePatch` | D；sources/source/sourceVersions/joinCandidates | Manifest/overlay多文件写第二项失败；注释/unknown/mtime不变；DI-02 |
| IM-03 | `semantic-layer.ts::writeSourceYamlImport`；`index.ts` source import/restore真实提交路由 | D，若改Manifest映射则P；同IM-02 | preview/dryRun无变化，import/restore提交即时更新；DI-03 |
| IM-04 | `webui/server/catalog-assets.ts::uploadCatalogAsset`的rename（绕过safeWrite）；Spec164 prepareSchemaStructure::writeMinimalManifest复用此API | D/P/C；catalogReloads/catalogAssetUploads/sources/project/connectionTables；SchemaStructurePrep的refetch/getQueryData同新scope | rename成功但reload/history失败、preview不失效、tmp不触发成功快照；上传后真实读到表才进入启用范围；DI-04 |
| IM-05 | `webui/server/project.ts::writeKtxYaml`；`index.ts` enabled-tables的auditedWriteFile | C/D/P/L；project/sources/connectionTables/liveSchemas/health/admin agents/mcpRuntime | enabled_tables改变catalog_bound结果；content_root变化换paths与watcher；DI-05 |
| IM-06 | `project.ts::createConnection/addSchema/removeSchema/removeConnection`（当前rollbackWrittenConnection含后续audit异常） | C/D/P/L；同IM-05及reloads | 屏障跨完整事务及ktx/secret清理；SQLite无password分支；删资产部分失败；旧配置probe拒回填；DI-06 |
| IM-07 | `webui/server/admin/agents.ts`本地`writeAccessYaml`（含writeFile回滚），Spec168 applyRoleSet/agentRoleFields | P/A；sources/admin agents/admin roles及已有mcpRuntime展示 | roles[]多选/legacy兼容/双声明错误/非角色编辑不迁移；runtimeAck=false回滚；users/version/权限一致；DI-07 |
| IM-08 | `webui/server/admin/access-config.ts::writeAccessYaml`；`admin/roles.ts`调用 | P/A；同IM-07 | 角色新增/编辑/删除、多角色、约束/row policy，直接回滚后再失效；DI-08 |
| IM-09 | `webui/server/admin/tokens.ts` auditedWriteFile + commitPolicyRuntimeAck | P代次（access文件变化）/A；admin tokens/admin agents、已有runtime查询 | 创建/吊销过期信息不得被冻结；实际旧Token授权按原即时吊销合同拒绝；DI-09 |
| IM-10 | `webui/server/catalog-reload.ts::reloadCatalog/appendCatalogReload` | D/P/C（资产重扫）；catalogReloads/sources/project | sidecar追加只更新历史key，不把自身写事件反复触发语义重扫；重载失败显式错误；DI-10 |
| IM-11 | `webui/server/table-yaml-history.ts` snapshots/index/restore draft读取 | 历史key；**只读restore draft本身不失效D/P** | snapshot文件与history index不被当当前overlay；真实restore提交由IM-03覆盖；DI-11 |
| IM-12 | `webui/server/paths.ts::loadContentPaths/invalidateContentPathsCache`（已有projectRoot/env cachedKey）；外部ktx路径变化 | 全部旧root D/P/C/L；相关logic key | 不覆盖已实现cachedKey；默认config/、env、paths.content_root、legacy `.`切换，旧root不挂新key；DI-12 |
| IM-13 | `webui/server/proxy/identity.ts::resolveAccessConfigPath`；外部access/Manifest/overlay/ktx变化 | 按实际path D/P/C/L | watcher丢事件、原子替换/删除、同mtime/size、override不一致；2s/31s仅服务端窗口；DI-13 |
| IM-14 | `webui/src/lib/auth.tsx` login/logout/refresh身份改变；401 | U；全部protected query，保留public Help/branding | 同账户重登也更新authEpoch；旧fetch忽略abort，仍不回填；其他标签下一请求401不继续显示可操作旧数据；DI-14 |
| IM-15 | `webui/server/admin/agents.ts::registerAgentRoutes`读取列表 +批量context | 同批access/version/enabledTables，动态A | stats pending期间Agent被删除/启停，整批重试不拼A/B；DI-15 |
| IM-16 | `proxy/acl.ts::compileRole/loadEnabledTablesByConnection/resolveCatalogConnections`与display batch纯派生 | P读取固定enabledTables（含空集合连接）/classifier/source版本 | lucy_admin新连接自动跟随、其他wildcard拒绝；Spec170 CONTEXT_TOOLS不回退；每批≤1读取，runtime不污染；DI-16 |
| IM-17 | `webui/server/live-catalog.ts` + `index.ts` test/live-schemas +后台队列 | L；connectionLiveSchemas/connectionHealth | 同key合并独立subscriber取消；配置更新旧任务结算；refresh=1只绕过完成cache；DI-17 |
| IM-18 | `webui/server/auth/guard.ts`及各路由既有权限检查（读取） | HTTP请求身份，不在显示cache内 | cache hit/miss/inFlight attach三条路径都验证已有auth；未授权不能因复用已授权Promise拿到数据；DI-18 |

DI-01–13/15主要落 `server/__tests__/display-invalidation.test.ts`；DI-16落 `admin-permission-batch.test.ts`；DI-17落 `background-probes.test.ts/live-catalog.test.ts`；DI-14落 `src/__tests__/display-query-isolation.test.tsx`；DI-18补 `webui-admin-auth.test.ts`。若某行需独立测试文件，报告列出最终位置。

## 核心流程（伪代码）

遵循Spec174 §7：写前pending/epoch→现有落盘→失效→原audit/policy/rollback→finally失效/释放；响应序列化与客户端epoch再验证。单事务内多个底层hook可重复递增代次，但只最后一个外层屏障结束才允许构建。仅preview/历史快照变化不触发当前资产代次。

## Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。D/P/C/L/A/U与DI编号均为工程标记，不新增产品术语；错误/状态文案按Spec174。

## Design System Compliance

本矩阵不引入视觉模式；UI失效/重试表现遵循Spec174与DS20页面分区。
