# r6 同候选30分钟组合验证

**最终独立严格判定：FAIL（诊断采集缺口）；证据完整性VALID。** 生产者原始结果为`PASS WITH GAP`，不改写。业务、性能及完整审计闭包通过；一次审计进度采集超时、两次同路漏采仍保留，不签完整组合PASS。原r3／r4 FAIL及r5受控中止记录保留。

实际自然窗为北京时间2026-11-20 **19:19:52.795332至19:49:52.795332**，1800秒、150秒间隔、12／12完整变更周期。候选镜像`sha256:ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f`，Node22.23.5／KTX0.16.0，本机隔离Docker与合成MySQL；1247镜像源码hash一致，360项集成回归、最终CLI代码终审及r6短校准独立审计已通过。

原负载／正确性／性能／ACL／预算／审计门槛不变。20万初始合成历史审计、67历史用户、12合法身份、每轮3000增量（第0轮不追加），三个探针与普通HTTP各1Hz，普通MCP合计每5秒；无持续CPU profiler。拒绝仍计失败分母，仅精确P1-69所有者闭环及同身份／同session／原问题恢复、预算单票据与唯一真实执行证明齐备时可映射合同内重载拒绝。

自然窗后的逐条恢复、I/O故障控制、收敛和审计取证单列。恢复取证总量上限300秒／并发2，依据短校准产能核算；单RPC180秒与产品原预算不变，不放宽自然窗验收。全部后置阶段已结束，本任务两个容器、网络、卷均确认不存在，私有夹具移除、worker为0。

| 项目 | 原始／独立结果 |
|---|---|
| 三个探针 | 各1800／1800自然成功；0失败、漏发、截尾。livez p99／max＝268.09／836.00ms；readyz p99＝270.22ms，原门槛通过 |
| 普通HTTP | 1800／1800自然成功，真实payload全部正确；p50／p95／p99／max＝24.51／180.04／798.37／1264.57ms，全在3秒内 |
| 普通MCP | 360计划／实际＝328成功＋32精确重载503；0漏发／在途／截尾，失败分母保留；非预期业务失败0 |
| MCP全终态延迟 | p50／p95／p99／max＝4266.52／11676.30／18299.43／20127.65ms；328成功对应4356.09／12297.88／18299.43／20127.65ms |
| 重载拒绝闭环 | 32次均经独立owner／server rejectedAt／截止及释放绑定；同Token、身份、session、原问题显式恢复成功，预算calls＝attempts＝1、唯一实际query及有效同用户关联成立；没有自动重放或删除失败 |
| 完整审计 | 一致备份233481条原始行全部唯一有效同用户关联，79用户／67历史用户／233000合成历史行，无孤儿、重复、错属、缺turn或水位缺口；合成输入不冒充真实RPC |
| 故障控制／清理 | 120秒FIFO实际进程终结、单在途及fresh恢复通过；资源清理全部true；独立双hash与临时解压数据库删除通过 |

`audit-progress-214`在自然窗t＝1070秒发起，实际12052.76ms后以`owned process deadline; actual owned group absent after bounded 2s cleanup grace`失败。后台进度路计划360、实际358、成功357、失败1、漏采2；215／216因单在途占用漏采。它不是业务MCP调用，也不能因最终审计闭合抹去。独立验证器保留`diagnostic-collection-error`，按冻结规则严格FAIL／退出1。原始记录不足以区分当时是SQLite等待、Docker启动／通信还是宿主调度，不能凭超时文本指定产品根因。

后续只读发现时间相邻的远端ticket `58398c0918654952`／Node23229仅有`complete:false`，没有远端group终结回执；尚无ticket与该采集请求的唯一ID映射，不能据近时序断言同一命令。冻结远端guard先求值`sys.stdin.buffer.read()`，再进入`communicate(...,timeout=8)`，输入EOF等待不受这段8秒计时覆盖，独立源级复核确认此工具缺口。故本机PGID回收不能代签远端8秒结束，另记输入截止与操作关联GAP；最终整容器删除证明当前无该任务残留，不回补当时缺失的终态。此处不认定EOF就是该次超时根因，也不修改旧工具、候选或严格FAIL。

正式证据：[生产者原summary](2026-11-20-codex-followup-r6-1800-artifacts/summary.json) · [完整原始档案](2026-11-20-codex-followup-r6-1800-artifacts/raw-evidence.tar.gz) · [独立重算与SQL](2026-11-20-codex-followup-r6-1800-artifacts/independent-review.json) · [实际调用／退出1](2026-11-20-codex-followup-r6-1800-artifacts/independent-invocation.json) · [验证器](2026-11-20-codex-followup-r6-1800-artifacts/independent-verifier.py) · [一致备份](2026-11-20-codex-followup-r6-1800-artifacts/audit-evidence.sqlite.gz) · [双hash与cutoff](2026-11-20-codex-followup-r6-1800-artifacts/audit-evidence.json) · [候选清单](2026-11-20-codex-followup-r6-1800-artifacts/candidate-manifest.json) · [三工具冻结](2026-11-20-codex-followup-r6-1800-artifacts/source-freeze.json) · [全部附件hash](2026-11-20-codex-followup-r6-1800-artifacts/files.sha256)。

复现先校验附件hash，解压原始档案得到`run/`，把备份gzip复制入`run/`。验证器使用原调用记录中的1800秒／150秒／200000／3000／同候选ID／`--allow-reload-contract`及对应候选清单、`run/source-freeze.json`；仅调整本地路径，不改输入字节、参数或判据。解压临时数据库须删除。

FUP-01规模／时长／12周期及FUP-03本跑次性能、合法任务已有证据；FUP-06实际FIFO与最终审计闭包通过，在线进度采集仍GAP。范围仅本轮核心工程组合，不自动签完整F69／F70／F61／F62／F63／R-CAV、WebUI、发布或客户交付通过。剩余同镜像定向故障用例另行补验；任何实际运行修复会触发新候选验证。
