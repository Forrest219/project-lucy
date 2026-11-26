# Fixtures — UAT-SUITE-PUBLIC-ENTRY-STATIC

| 项 | 要求 |
|---|---|
| 规模档 | **强制 scale**（`npm run demo:upgrade:scale` 或等价隔离栈＋`uat:scale-baseline` 退出 0） |
| 候选 | 基线镜像 digest＋最终镜像 digest；或同镜像 `LUCY_PUBLIC_ENTRY_FASTPATH=0/1`（名称以实现为准）对照臂 |
| 凭据 | 隔离栈管理员口令／Token；路径记入跑次（脱敏）；禁止提交密钥 |
| 事件循环臂（基线） | 机制鉴别可用 `LUCY_OPS_STEP_UAT=1` 的 `POST /api/admin/ops-step-uat/sync-section`（`Atomics.wait`，`holdMs≤10000`）；**仅限基线臂**，用后须关闭该开关。禁止 `setTimeout` 假堵路由 |
| 事件循环臂（最终） | **生产重工作臂**：H1 冷槽／并发展示构建＋scale 档审计读／导出；**不得**用注入器；基线无法复现越线时按 cases R0 判 BLOCKED |
| MCP 臂 | 复用 P1-75／P1-82 多 Session 语义工具；压力期内任一时刻至少一条在途；真实 KTX |
| 认证负例 | 隔离栈内造错密／跨站／吊销／存储失败夹具；脱敏留证；既有回归文件见 cases 04b |
| Runner | 已建设（开发授权后）：`scripts/uat/public-entry-static.mjs`＋`npm run uat:public-entry-static`（子命令：probe／login-probe／mcp-arm／display-arm／injector-arm／judge；浏览器冷开 `scripts/uat/public-entry-static-browser.mjs`，真实前台 Chrome，从 webui 目录以 playwright-core 启动）；判定器 `public-entry-static-lib.mjs`（单测 `npm run uat:public-entry-static:test`） |
| 对照臂开关 | 同镜像 `LUCY_PUBLIC_ENTRY_FASTPATH=0` 关闭品牌公开读缓存（实现名，branding.ts `fastPathEnabled`）；缺省＝开 |
| 展示臂 | 冷槽或并发展示构建（可选叠加） |
| 探测 | 独立进程；客户端计时；≥1 Hz；JSONL 原始账本入 `runs/evidence/` |
| 浏览器 | 桌面 Chromium；默认 1920×1080；有头或可证前台焦点 |
| 清理 | 只清本套件实验 Agent／Token／临时品牌变更；还原 branding；记录清理回执 |
| 端口 | 跑次写明 WebUI／MCP 实际映射端口 |

诊断 Gate 输出目录建议：`inbox/p184-diag-<日期>/`（tmp；含账本哈希与候选身份）。
