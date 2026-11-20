# P1-58 D7：已授权覆盖索引与首批边界

委托人2026-11-20明确授权纳入两条索引。当前首批实现已在既有audit.sqlite监听前初始化路径加入`idx_al_agent_window_cover(user_id,ts,token_hash_prefix,tool,outcome,eval_mark,args_summary,tables,client_ip)`和`idx_al_ts_token(ts,token_hash_prefix)`；`CREATE INDEX IF NOT EXISTS`，不新增表／列、不改KTX。

原型实验：独立2CPU／4GiB，500 Agent／1500凭据，500万历史／100万30日行；无新增索引首次7d约13.8秒、热14d／30d约4.27／5.01秒；单索引约2.95／3.19／3.18秒，仍未全面满足3秒预算；两索引7d／14d／30d约1.81／1.22／1.54秒。构建约47秒、索引约580MB＋270MB。实验只说明选型依据，不是完整F58 PASS。

首批保留已实现的两索引及真实旧库重入／数据保持单元验证。完整候选三档冷热预算、dbstat逐项体积、初始化与持续写入代价、固定窗口历史增长和改前对照按委托人分批决议延期第二批，未计PASS，预算不变。本次不发布、不上线。
