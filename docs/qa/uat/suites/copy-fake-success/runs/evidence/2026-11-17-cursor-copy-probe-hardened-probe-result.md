# 探针原始输出：2026-11-17 cursor-copy-probe-hardened

> 由 `npm run uat:copy-probe` 生成的 `probe-result.md` 原样留档（Token 明文已脱敏）。判定摘要见同名跑次文件。

# 复制按钮假成功探针结果（2026-11-17T13:54:05.406Z）

- 被测实例：`http://192.168.3.46:55176`（构建 `79db4352bf25`）
- R0：PASS（isSecureContext=false，Clipboard API=false，阳性对照往返=true）
- 总判定：**PASS**

## UAT-COPY-01 共享 helper

| 载荷 | helper 自报 | execCommand 调用 | 粘贴读回 | 判定 |
|---|---|---|---|---|
| helper:ascii-40hex | {"ok":true} | [{"ret":true,"selection":"c84e6d7d1a5bdc43891fac51159f49dc9b7b2b45","ctrl":"c84e6d7d1a5bdc43891fac51159f49dc9b7b2b45"}] | "c84e6d7d1a5bdc43891fac51159f49dc9b7b2b45" | **REAL** |
| helper:cjk-multiline | {"ok":true} | [{"ret":true,"selection":"表排行\n第二行 中文 | tab\t结尾","ctrl":"表排行\n第二行 中文 | tab\t结尾"}] | "表排行\n第二行 中文 | tab\t结尾" | **REAL** |
| helper:long-3k | {"ok":true} | [{"ret":true,"selection":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…(6039 chars) | "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…(3000 chars)" | **REAL** |

## UAT-COPY-02 入口点击

| 子用例 | 入口 | 界面说已复制 | 界面说失败 | 剪贴板确有内容 | 判定 |
|---|---|---|---|---|---|
| UAT-COPY-02a | 版本信息：复制构建提交 | true | false | true | **REAL** |
| UAT-COPY-02b | 新建 Token：复制 Token 明文 | true | false | true | **REAL** |
| UAT-COPY-02c | 新建 Token：复制当前配置 | true | false | true | **REAL** |
| UAT-COPY-02d | Agent 详情：复制 Token hash | true | false | true | **REAL** |
| UAT-COPY-02i | 审计：复制问询 ID（CopyableId） | true | false | true | **REAL** |
| UAT-COPY-02j | 审计：复制触达表清单 | true | false | true | **REAL** |
| UAT-COPY-02e | 审计对账：复制表排行全文 | true | false | true | **REAL** |
| UAT-COPY-02f | 接入向导／概览：复制 MCP 配置 | true | false | true | **REAL** |
| UAT-COPY-02g | 连接测试：复制命令 | true | false | true | **REAL** |
| UAT-COPY-02h | 连接测试：复制 Log | true | false | true | **REAL** |

## 登记表对照（全部复制入口）

| 文件 | 入口 | 登记覆盖 | 本次点击 | 未点击原因 |
|---|---|---|---|---|
| src/pages/admin/VersionInfo.tsx | 版本信息：复制构建提交 | click | 是 |  |
| src/pages/admin/NewToken.tsx | 新建 Token：复制 Token 明文 | click | 是 |  |
| src/pages/admin/NewToken.tsx | 新建 Token：复制当前配置 | click | 是 |  |
| src/pages/admin/AgentDetail.tsx | Agent 详情：复制 Token hash | click | 是 |  |
| src/pages/admin/Audit.tsx | 审计：复制事件／问询 ID（CopyableId） | click | 是 |  |
| src/pages/admin/Audit.tsx | 审计：复制触达表清单 | click | 是 |  |
| src/pages/admin/AuditReconciliation.tsx | 审计对账：复制表排行全文 | click | 是 |  |
| src/pages/admin/RowPolicyView.tsx | 行级策略：复制表身份 | helper-only | 否 | 需要已配置行策略的表行 |
| src/pages/connections/ConnectionOverview.tsx | 连接概览：复制路径（缺失 Manifest 提示） | helper-only | 否 | 仅在存在缺失 Manifest 警告时出现 |
| src/pages/connections/TableWhitelist.tsx | 启用表：复制 Manifest 路径 | helper-only | 否 | 仅在空态提示出现 |
| src/components/connections/ConnectionTestResultPanel.tsx | 连接测试：复制命令 | click | 是 |  |
| src/components/connections/ConnectionTestResultPanel.tsx | 连接测试：复制 Log | click | 是 |  |
| src/pages/Onboarding.tsx | 接入向导／概览：复制 MCP 配置 | click | 是 |  |
| src/components/onboarding/Step6ConnectAgent.tsx | 接入向导第 6 步：复制提示／Token／配置 | helper-only | 否 | 已完成接入的实例 /onboarding 跳转到概览，向导步骤不可达 |
| src/components/onboarding/AuthoringHowTo.tsx | 接入向导：复制撰写说明 | helper-only | 否 | 已完成接入的实例向导步骤不可达 |
| src/components/audit-trust/CredentialPrincipalCell.tsx | 审计信任列：复制用户 ID（仅失败时提示） | helper-only | 否 | 无审计行；该控件无成功态，失败才提示 |

## 真实数据与清理

- 种子查询：{"mcp":"http://192.168.3.46:57881/mcp","status":200,"isError":false,"preview":"{\"answer_verifiability\":{\"schema_version\":\"1\",\"sources\":[{\"connectionId\":\"demo-m"}
- 探针 Token：Agent `demo_agent` 标签 `uat-copy-probe-1794923632394` 已吊销（HTTP 200）
