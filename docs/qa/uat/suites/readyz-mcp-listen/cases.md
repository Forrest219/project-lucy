# Cases — UAT-SUITE-READYZ-MCP-LISTEN

| ID | 标题 | 期望摘要 |
|---|---|---|
| UAT-RML-R0 | 环境门禁 | Web／MCP 端口已知；可高频采样；Bearer 或匿名 initialize 路径明确 |
| UAT-RML-01 | 首次 readyz 200 ⇒ MCP initialize | 从启动前连续采样；首次 readyz 200 时立即 initialize 必须成功 |
| UAT-RML-02 | 三次独立冷启动 | 重复 RML-01 共 3 次；任一次首次失败即 FAIL |
| UAT-RML-03 | Ready 后管理主路径 | 首次 Ready 后登录或 `GET /api/project` 成功（≤5s） |
| UAT-RML-04 | 反代形态（可选） | 经本地反代首次 initialize；用于对照 502；直连结果仍以 01／02 为准 |

---

## UAT-RML-01 — 首次 Ready 即 MCP 可用

### 步骤

1. 停止候选容器；冷启动（可保留同卷）。
2. 每 50–100ms 采样 `/api/readyz`；并行或紧接对 MCP 端口发 `initialize`。
3. 记录：首次 readyz 200 的时间戳、该时刻前后各一次 initialize 结果。

### 期望

- MCP listen 完成前，readyz 不得 200（SC-01）。
- 首次 readyz 200 时 initialize 成功（SC-02）。
- **改前基线可 FAIL**（前方：readyz 200 后 1ms hang up／反代 502）。

### 禁止

- 用第二次 initialize 成功覆盖第一次失败。
