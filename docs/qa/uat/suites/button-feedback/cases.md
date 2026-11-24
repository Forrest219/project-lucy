# Cases — button-feedback

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| `UAT-BTN-R0` | 环境与登录自检 | 必做 | 探针 R0 | 管理员登录 200；否则整套 BLOCKED（退出码 2） |
| `UAT-BTN-01` | Wiki：下载已保存版本 | 必做 | `npm run uat:button-feedback` | 收到非空 `.md`，文件名与文档一致 |
| `UAT-BTN-02` | 表编辑器：导出 YAML | 必做 | 同上 | 收到非空 `.yaml`，文件名＝`conn-schema-table.yaml` |
| `UAT-BTN-03` | 评测用例：下载 Eval YAML | 必做 | 同上 | 收到非空 `.yaml`；界面「已准备」只在文件到手后出现 |
| `UAT-BTN-04` | 连接：下载 Manifest | 必做 | 同上 | 收到非空 `.yaml`；「已开始下载」只在文件到手后出现 |
| `UAT-BTN-05` | 审计：导出 | 必做 | 同上 | 收到非空 `.csv` |
| `UAT-BTN-06` | 审计：导出审计证据包 | 必做 | 同上 | 收到非空 `.zip` |
| `UAT-BTN-07` | 审计对账：导出对账证据包 | 必做 | 同上 | 收到非空文件；**若服务端真实拒绝（409），界面必须说明原因，不得只留给浏览器下载栏** |
| `UAT-BTN-08` | 配置审计：导出 CSV | 必做 | 同上 | 收到非空 `.csv` |
| `UAT-BTN-09` | 发布记录：导出 CSV | 必做 | 同上 | 收到非空 `.csv` |
| `UAT-BTN-10` | 目录：批量下载语义维护包 | 必做 | 同上 | 选中一张表后，下载链接给出非空 `.zip` |
| `UAT-BTN-S01` | 新建 Token：真实签发成功 | 必做 | 同上 | 服务端 200；成功屏显示 Token 明文；`runtimeAck=true` 时**不得**出现「运行态未确认」警示 |
| `UAT-BTN-S02` | 新建 Token：同标签再次签发（真实 4xx） | 必做 | 同上 | 服务端真实 `409 TOKEN_LABEL_TAKEN`；界面报错，**不得**进入成功屏 |
| `UAT-BTN-G1` | 登记门禁：新增下载入口必须登记，裸 API 下载链接禁用，裸 `fetch` 必读 `.ok`，服务端写入必处理回滚 | 必做 | `npm --prefix webui run lint:button-feedback`；`npx vitest run scripts/__tests__/lint-button-feedback.test.ts` | 16 个触发点与登记表一致；B1–B5 无违规；单测含「删除 Agent 回滚仍报成功」的原始写法反例 |

## NOT-RUN 清单（登记表里 `coverage: not-run`，原因写在登记表）

| 入口 | 原因 | 补跑条件 |
|---|---|---|
| 目录：批量校验后下载 CSV 报告 | 需先运行批量校验任务得到报告链接，会占用校验队列 | 维护窗内运行一次批量校验 |
| 引导：下载编写说明 | 引导流程已完成的实例不再渲染该入口 | 全新实例走引导第 2／5 步 |
| 评测运行详情：下载 JSON／MD | Demo 没有评测运行记录 | 先产生一次评测运行 |
| 发布记录：导出恢复包 | Demo 没有已发布版本 | 先完成一次发布 |
| 语义资产导出按钮（组件） | 组件已导出但没有页面挂载，用户没有入口 | 挂载后补用例，或删除该组件（须另行决定） |

## UAT-BTN-R0

### 步骤

1. `POST /api/auth/login` 用凭据文件里的管理员登录。

### 期望

- 登录 200；否则探针以退出码 2 结束，不产生任何判定。

## UAT-BTN-01 … UAT-BTN-10

### 步骤

1. 打开入口所在页面（路径见登记表 `route`）。
2. 监听浏览器 `download` 事件，点击入口。
3. 读下载文件大小、文件名、前 200 字节（只判断是否是 `{"ok":false…` 错误体，不落盘内容）；同时读界面新出现的 Toast／文案。

### 期望

- 判定按 suite.md「判定口径」。`HONEST-FAILURE` 须在备注里写明失败原因与是否环境造成。

### 清理

- 无（只读下载；`UAT-BTN-10` 会在服务端产生一个导出任务记录，随其自身过期策略清理）。

## UAT-BTN-S01 / S02

### 步骤

1. 选一个已有 Agent；打开 `/admin/agents/:id/tokens/new`，标签 `uat-btn-probe-<时间戳>`，点「生成 Token」。
2. 记录服务端响应与页面：是否进入成功屏、是否显示 `token-runtime-unconfirmed` 警示。
3. 回到新建页，用**同一标签**再点一次「生成 Token」。
4. 记录服务端响应与页面：是否仍停在表单并有错误提示。

### 期望

- S01：`200` + 明文可见；`runtimeAck=true` ⇒ 无警示（`runtimeAck≠true` ⇒ 必须有警示）。
- S02：真实 `409 TOKEN_LABEL_TAKEN`；界面有错误提示；成功屏不出现。

### 清理（强制）

- 吊销 S01 签发的 Token：`DELETE /api/admin/agents/:id/tokens/:label`，**不带 JSON content-type**（否则 Fastify 400）。吊销失败＝整轮 FAIL，并打印标签请人工吊销。

## UAT-BTN-G1

### 步骤

1. `npm --prefix webui run lint:button-feedback`。
2. `npx vitest run scripts/__tests__/lint-button-feedback.test.ts`（在 `webui/`）。

### 期望

- 门禁 PASSED，打印基线「16 个下载触发点、4 处裸 fetch、8 处 writeAccessYaml 调用」；单测全过，含对原始缺陷写法的反例。
