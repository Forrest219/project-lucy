# P170 r6 revision7 normal 原始证据预复核

结论：所选真实 normal 三工具分支受到原始证据支持，未发现 phase GAP 或产品失败；维持生产者 `SCOPED PASS WITH GAP` 范围。此记录不独立签预算/有效审计 SQL 闭合，待 M 授权核窗后另行补证，也不签 F70 全矩阵、UAT 或发布就绪。

取证源为 `docker-driver/r6-revision7/normal` 的实际 invocation/stdout、完整容器工程日志、各 held/original-wait/manual-release/worker-exited witness、三个原 RPC 回执和逐轮 MySQL general_log 前后快照，并非只复述 summary。实际父进程6451退出0，83.614秒；AE0 image、driver795391c7、oracles1687411e、control0ef4fae1 与 freeze 对应。

| 原工具/RPC | 真 holder（前缀） | 入口至 wait begin / end ms | 回执 ms | 独立可见业务 SQL 增量 |
|---|---|---:|---:|---:|
| lucy_query/2 | 667503b7 | 3711.183 / 4704.579 | 7140.774 | 1 |
| lucy_read_source/3 | 3151ef6a | 7.331 / 1163.482 | 2694.718 | 0 |
| lucy_explain_query/4 | c1e1cba0 | 3850.753 / 4922.411 | 5256.486 | 0 |

每次原 RPC 的 `x-lucy-operation-id` 精确等于日志 ingressOperationId，rpcId/owner/journal/release 一一匹配，固定初始资格均为入口+20000ms。实际 begin 时同 journal 仍 open/write_in_progress、真实锁仍属该 writer；原 Node5976/startTicks7239211 保持。内核快照显示真实 source fd 与 `__break_lease`，控制 holder PID 分别6495/6765/6890，均精确 `fe:01:771594` BREAKING/UNLCK 且 alive，kernel break-time45秒。三次手动解除分别在 SIGIO 后约4.075/0.469/4.237秒，均非自动到期。控制没有回写旧 target 字节/权限，原 inode771594保留；新 source/mirror SHA 各轮相同并等于 upload 收据新 SHA。

完整原始日志各有 registered→read_wait_begin→files_saved→read_wait_end(owner_settled)，saved 在 end 前；随后真实 WAL completed、原 owner lock 消失、控制 PID absent 且 leaseRows空。没有靠 sleep、原窗口重试或 summary 推定实际等待。

MySQL 原始增量逐行检查：query 唯一业务 Query 是已观测 KTX 固定单层 `select * from (<原 compiled SELECT>) as ktx_query_result limit 100`；其 inner 与回执精确相同。其余是连接、SET max_execution_time、版本元数据和读取 mysql.general_log。read_source/explain 两轮只新增日志采集/版本查询与连接终态，均无业务 Query/Execute。query HTTP200、headers order_count/amount_sum 对应4/100；read_source 原始 YAML 精确目标 source/table/count/sum；explain 是 allowed/plan_only/executed=false、requestedSources 仅原目标且无结果数据。

原始 cleanup.json 为四个自有资源 absent/privateRemoved=true/errors空，所有 host 操作 settled；本复核未另起 Docker inspect。用户原始三请求3成功/0失败，不能用后续重放替换。

实际 GAP：regular-file lease 是显式受控延迟资格化，不是自然性能；预算模式/更紧截止/配置代次/后继 owner 与全发布审计矩阵未由此 normal case 全覆盖。生产者 SQLite 收敛的前两备份 read_source/explain 链接尚未齐、第三备份均闭合，历史采集尝试保留；本轮仅看小 JSON，未解压、未执行 SQL，独立完整审计结论仍 pending。没有把122离线测试或生产者 proof 当成独立 SQL 证据。未改源、未运行测试/Docker/SQL。
