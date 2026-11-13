# Cases — UAT-SUITE-ROLES-AGENT-PERF

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo healthy；可登录 |
| UAT-PERF-ROLES-01 | Roles 列表页冷进可就绪 | 浏览器＋Network | Spec D8／RPB-W2 | 列表可见；单次 roles 列表 API；无 per-role 详情风暴 |
| UAT-PERF-AGENT-01 | Agent 冷进不预拉 Roles | 浏览器＋Network | Spec D9／RPB-W4 | 冷进页无 `/api/admin/roles` |
| UAT-PERF-AGENT-02 | 新建弹窗再拉 Roles | 浏览器＋Network | Spec D9 | 打开新建后才出现 roles 列表请求 |
| UAT-PERF-ROLES-02 | Roles 列表 API 墙钟 | 已登录 API | Spec RPB-W3 | 记录耗时与角色条数；demo 下应远快于「秒级卡顿」 |
| UAT-PERF-BASELINE-01 | 发布取证 runner（可选） | 脚本 | `perf:release-baseline` | 可选；不代替必做浏览器项 |

---

## UAT-R0 — 环境门禁

### 步骤

1. `docker compose -f deploy/compose/docker-compose.demo.yml ps` → lucy／demo-db healthy  
2. `curl -sS http://127.0.0.1:55176/api/health` → `ok`；记录 `gitSha`／`lucyVersion`  
3. 用 fixtures 凭据文件登录 WebUI（只写路径，不写密码）

### 期望

可进管理面；容器 `gitSha` 含 P1-13 落地提交 `755fc706` 或其后继。

---

## UAT-PERF-ROLES-01 — Roles 列表页冷进可就绪

### 前置

UAT-R0 PASS。建议先清 Network 记录或新开标签。

### 步骤

1. 管理员登录后打开 `/admin/roles`  
2. 等待列表主表／角色行可见（primary-ready）  
3. 记录 Network：`/api/admin/roles` 与 `/api/admin/roles/` 详情类请求次数与耗时

### 期望

- 页面出现角色列表（至少一行或诚实空态，非长时间空白卡死）  
- 列表装载路径：**1** 次列表 `GET /api/admin/roles`（允许 query）；**0** 次为拼列表而发的 `GET /api/admin/roles/:id`  
- 记录 `primaryReady`／列表 API 墙钟作证据（demo 参考 ≤500ms 量级；超标记 FAIL 并摘录）

### 清理

无。

---

## UAT-PERF-AGENT-01 — Agent 冷进不预拉 Roles

### 前置

UAT-R0 PASS；新开标签或硬刷新；**不要**先打开新建弹窗。

### 步骤

1. 打开 `/admin/agents`（或导航等价入口）  
2. 等待 Agent 列表主区可见  
3. 在弹窗打开前检查 Network：是否出现 `/api/admin/roles`

### 期望

- Agent 列表可读  
- 冷进完成前 **无** `GET /api/admin/roles`（含 `includeTemplates=false`）

### 清理

无。

---

## UAT-PERF-AGENT-02 — 新建弹窗再拉 Roles

### 前置

UAT-PERF-AGENT-01 同页；Network 可继续监听。

### 步骤

1. 点击「新建 Agent」／等价 CTA 打开弹窗  
2. 观察是否出现 `GET /api/admin/roles?includeTemplates=false`（或等价列表接口）  
3. 弹窗内角色选择控件可加载（或诚实加载中→可选）

### 期望

- 打开弹窗后 **允许且应出现** Roles 列表请求  
- 仍不应出现 per-role 详情风暴拼下拉

### 清理

关闭弹窗即可；勿保存无关 Agent。

---

## UAT-PERF-ROLES-02 — Roles 列表 API 墙钟

### 前置

已登录会话 cookie／Bearer 可用（浏览器同源或已登录后 `fetch`）。

### 步骤

1. 对 `GET /api/admin/roles`（可含 `includeTemplates=false`）测 3 次墙钟（可含 1 次 warm）  
2. 记录响应 `data.roles.length` 与 p95／max

### 期望

- `ok: true`；角色数组可解析  
- demo 夹具下不应出现多秒级卡顿（对照修复前「秒级」反馈）；摘录实测 ms  
- 参考门禁：RPB-W3 API ≤200ms（夹具）；本机 demo 若略超须在跑次说明负载，不得静默改合同

### 清理

无。

---

## UAT-PERF-BASELINE-01 — 发布取证 runner（可选）

### 步骤

```bash
npm run perf:release-baseline -- --tier ci-small --skip-build \
  --output inbox/perf-baselines/uat-roles-agent
```

需要 Roles 浏览器墙钟时用 `--tier release-medium`（更慢）。

### 期望

脚本非 CR；`status=pass` 或失败原因写入跑次。本项 **SKIPPED** 不影响必做项总判定，但若跑了失败须在备注披露。
