# Fixtures — copy-fake-success

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://<本机局域网 IP>:55176` | **不得用 `127.0.0.1`／`localhost`**（安全上下文，无判定力）；探针按本机首个非回环 IPv4 自动拼，也可 `--base` 指定 |
| 登录凭据文件 | `/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt` | 路径 only；第 1 行 URL、第 2 行管理员 id、第 3 行密码，勿粘贴内容 |
| 容器 | `compose-lucy-1`（`project-lucy:demo`） | 端口 `55176→5174`、`57881→7879`；demo 默认绑定 `0.0.0.0`，局域网可达 |
| Agent／Token | 探针取 `GET /api/admin/agents` 里第一个带 Token 的 Agent | 复制 hash 用现有 Token；新建 Token 的签发请求在浏览器里打桩，**不写真实凭据** |
| 连接 | demo 自带 `demo-mysql` | 「连接测试」真跑 `ktx connection test`（只读） |
| 浏览器 | Playwright Chromium headless（`webui/node_modules`） | 阳性对照与粘贴读回依赖 `ControlOrMeta+V` |
| 探针入口 | `node scripts/uat/copy-button-fake-success-probe.mjs [--base …] [--creds …] [--out …]` | 退出码：0 全 REAL；1 存在假成功／静默／诚实失败；2 BLOCKED |
| 登记表 | `webui/scripts/copy-surfaces.manifest.json` | 探针按它列出全部入口与未点击原因 |
| 公网演示（可选 04） | `http://124.222.172.229:5174` | 凭据文件 `/Users/zhangxingchen/Projects/config_for_agents/ksc-lucy-webui.txt`（路径 only；使用前确认其文件结构与探针 `--creds` 约定一致，不一致则 BLOCKED） |
| 证据落点 | `inbox/uat-copy-fake-success-YYYY-MM-DD/probe-result.{json,md}` | 临时目录，可删；摘要进 `runs/` |
