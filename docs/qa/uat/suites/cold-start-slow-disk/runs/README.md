# 跑次

这里只放执行之后的证据，文件名 `YYYY-MM-DD-<agent>-<short>.md`。

已有跑次：[2026-11-17-cursor-docker-baseline.md](2026-11-17-cursor-docker-baseline.md)（**改前基线 FAIL**：R0／01 PASS；HEAD `7b882c7c` 的 02／03／05 `FST_ERR_HOOK_TIMEOUT` 崩溃，04 用 `--warm-start` 证明启动幸存时稳态仍卡）。改后跑次：[2026-11-18-cursor-docker-after-fix.md](2026-11-18-cursor-docker-after-fix.md)（**FAIL，差一项**：R0／01／03／04／05 PASS；02 仅 livez p99 609ms 超 400ms）。

证据归档：`runs/evidence/<日期>-<baseline|after-fix>/`（样本 CSV、结果 JSON、容器启动日志；不含密钥）。`inbox/` 是 tmp，不作为证据留存位置。
