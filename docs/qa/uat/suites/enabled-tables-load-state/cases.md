# Cases — enabled-tables-load-state

| ID | 标题 | 层级 | 期望摘要 |
|---|---|---|---|
| `UAT-ETL-R0` | 环境与健康基线 | 必做 | demo healthy；登录后启用表范围页无「缺少 Manifest」汇总、无「无效启用」；已选计数覆盖全部启用表 |
| `UAT-ETL-01` | pending 诚实加载 | 必做 | 拦 `/tables` 不 resolve → 见「正在读取表清单…」；无缺 Manifest／无效启用；不点移出 |
| `UAT-ETL-02` | error 诚实失败 | 必做 | `/tables` 500／`ok:false` → 见「表清单读取失败，请重试。」；无假阳性；移出不可达或禁用 |
| `UAT-ETL-03` | success 空表真缺 | 必做 | `/tables` 成功 `tables:[]` → 允许「缺少 Manifest」与「无效启用」 |
| `UAT-ETL-04` | 健康刷新恢复 | 必做 | 解除注入并硬刷新 → 回到 R0 基线 |
| `UAT-ETL-05` | 术语定稿 | 必做 | 可见文案为「正在读取表清单…」「表清单读取失败，请重试。」；不含「加载中／同步中」等禁用别名冒充缺 Manifest |

## UAT-ETL-R0

### 前置

- `compose-lucy-1` healthy；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881`。
- 管理员凭据仅从委托人／本地凭据读入进程，不写入仓库证据。

### 步骤

1. 登录 WebUI。
2. 打开 `/connections/enabled-tables`（视口 1920×1080）。
3. 记录页面计时与 `/api/connections/:id/tables` 网络耗时（分列）。
4. 断言无 `whitelist-missing-manifest-summary`、无「无效启用」行；已选计数覆盖连接启用表。

### 期望

健康基线 PASS 后方可进入 01–04。

## UAT-ETL-01（pending）

### 步骤

1. 在页面上下文注入：对匹配 `/api/connections/.+/tables` 的 fetch 返回永不 resolve 的 Promise（其余请求透传）。
2. 硬刷新或重新进入启用表范围页。
3. 断言出现加载文案（`whitelist-tables-loading-<connId>` 或等价可见「正在读取表清单…」）。
4. 断言无缺 Manifest 汇总、无「无效启用」。
5. **不**点击「移出无效启用」。

## UAT-ETL-02（error）

### 步骤

1. 注入：`/tables` 返回 HTTP 500 且 `ok:false`。
2. 刷新进入页。
3. 断言「表清单读取失败，请重试。」；无缺 Manifest／无效启用；移出按钮不可见或 `disabled`。
4. **不**点击移出。

## UAT-ETL-03（success empty）

### 步骤

1. 注入：`/tables` 返回 `{ ok:true, data:{ tables:[], physicalNames:{} } }`。
2. 刷新进入页。
3. 断言允许「缺少 Manifest」与「无效启用」（真缺扫描语义）。
4. **不**点击移出；测完解除注入。

## UAT-ETL-04（恢复）

### 步骤

1. 移除 fetch 注入。
2. 硬刷新启用表范围页。
3. 断言回到 R0 健康基线。

## UAT-ETL-05（术语）

### 步骤

对照 Spec Terminology／`00-product-terminology-standard.md`：跑次截图或 DOM 摘录须含定稿文案；不得用「缺少 Manifest」描述 pending／error。
