# Cases — copy-fake-success

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| `UAT-COPY-R0` | 环境与探针自检 | 必做 | 探针 R0 | 非回环 HTTP、`isSecureContext=false`、无 `navigator.clipboard`；阳性对照往返＝true |
| `UAT-COPY-01` | 已发布 bundle 的共享 helper 真实写入 | 必做 | 探针 UAT-COPY-01 | 3 个载荷读回全部等于载荷；helper 自报 `ok:true` 必须有读回支撑 |
| `UAT-COPY-02` | 各复制入口点击探针 | 必做 | 探针 UAT-COPY-02 | 每个可点入口 `REAL`；`FAKE-SUCCESS`／`SILENT`／`HONEST-FAILURE` 一律 FAIL |
| `UAT-COPY-03` | 登记表门禁：新增复制入口必须登记 | 必做 | `npm --prefix webui run lint:copy-surfaces`；`npx vitest run scripts/__tests__/lint-copy-surfaces.test.ts` | 15 个调用点与登记表一致；绕过 helper 直接用 `navigator.clipboard`／`execCommand` 即红灯 |
| `UAT-COPY-04` | 公网演示实例只读复核（可选） | 可选 | 探针 `--base`／`--creds` 指向公网实例 | 与 01／02 同判据；需公网凭据，否则 BLOCKED |

## UAT-COPY-R0

### 前置

- 本机 demo Docker 已起（`compose-lucy-1` healthy），WebUI 映射 `55176`。
- 用本机**局域网 IP** 访问（不是 `127.0.0.1`）。凭据文件见 fixtures。

### 步骤

1. 以局域网 IP 登录 `POST /api/auth/login`，取得会话。
2. 打开 `/admin/version`，读 `window.isSecureContext` 与 `navigator.clipboard`。
3. **阳性对照**：用 `focus()+select()+execCommand("copy")`（由真实点击触发）写入哨兵串，再在输入框里真实粘贴读回。

### 期望

- 登录 200；`isSecureContext=false`；`navigator.clipboard` 不存在。
- 阳性对照读回＝哨兵串。（证明「粘贴读回」这套方法能看见真实复制；否则探针不可信，整套 BLOCKED。）

### 清理

无。

## UAT-COPY-01

### 前置

R0 PASS。

### 步骤

1. 从已发布页面取 `index-*.js`，在其中找到 `clipboard-*.js` 并用动态 `import()` 取出 `copyTextToClipboard`（按函数体含 `writeText` 识别，不依赖压缩后的导出名）。
2. 对载荷 `ascii-40hex`、`cjk-multiline`、`long-3k`：先写哨兵，再由真实点击触发 helper，记录 helper 返回值与 `execCommand` 调用瞬间的选区，最后粘贴读回。

### 期望

- 读回等于载荷。helper 返回 `{ok:true}` 而读回不等 → `FAKE-SUCCESS`（FAIL）。
- 该用例覆盖 manifest 中全部 15 个调用点的共同根（所有入口都经同一 helper）。

### 清理

页面内注入的辅助节点测后自动移除。

## UAT-COPY-02

### 前置

R0 PASS；demo 有至少一个带 Token 的 Agent；`/connections/test` 有可测连接。

### 步骤

对下列入口，逐个：先写哨兵 → 真实点击入口 → 读 Toast／状态文案新增行 → 粘贴读回 → 判定。

| 入口 | 触达方式 | 期望读回 |
|---|---|---|
| 版本信息：复制构建提交 | `/admin/version` | 页面 `title` 里的 40 位构建提交 |
| 新建 Token：复制 Token 明文 | 签发请求打桩 → 生成 | 打桩 Token |
| 新建 Token：复制当前配置 | 同上 | 含 `Bearer <打桩 Token>` |
| Agent 详情：复制 Token hash | Agent 详情 → Token 标签 → 技术详情 | `/api/admin/agents` 返回的 `hash` |
| 审计对账：复制表排行全文 | `/admin/audit-reconciliation` | 非空且不是哨兵（按钮禁用 → NOT-RUN） |
| 概览：复制 MCP 配置 | `/overview` | 非空且含 `mcp` |
| 连接测试：复制命令 | `/connections/test` 点重新测试 | 面板里的命令文本 |
| 连接测试：复制 Log | 同上 | 非空且不是哨兵 |

登记为 `helper-only` 的入口（审计 ID／触达表清单、行策略表身份、连接概览路径、启用表路径、接入向导第 6 步、撰写说明、信任列用户 ID）因 demo 数据或页面状态不可达而不点击，**必须在跑次写明原因**；其可信度完全由 01 承载。

### 期望

- 每个可点入口 `REAL`。
- 不得出现 `FAKE-SUCCESS`／`SILENT`／`HONEST-FAILURE`。

### 清理

测后删除打桩路由（浏览器进程随探针退出）；未写入任何真实 Token。

## UAT-COPY-03

### 前置

无需运行实例。

### 步骤

1. `npm --prefix webui run lint:copy-surfaces`
2. `cd webui && npx vitest run --maxWorkers=1 scripts/__tests__/lint-copy-surfaces.test.ts`

### 期望

- 门禁通过，并打印登记的文件数与调用点数。
- 单测含反例：未登记新调用、调用数漂移、过期登记、绕过 helper、`helper-only` 缺原因、非法 coverage 值。
- **门禁不证明复制可用**；它保证「每个复制入口都在名单里，名单上的 `click` 入口都要被 02 点到」。

### 清理

无。

## UAT-COPY-04（可选）

### 前置

公网演示实例凭据（只写路径，见 fixtures）；实例为明文 HTTP。

### 步骤

`node scripts/uat/copy-button-fake-success-probe.mjs --base http://124.222.172.229:5174 --creds <凭据文件>`。公网实例上新建 Token 的签发请求同样打桩；**连接测试步骤会真跑 `ktx connection test`**，跑前确认可接受。

### 期望

同 01／02。凭据缺失或文件结构不符 → `BLOCKED`，不得降级为手工口述。

### 清理

无。
