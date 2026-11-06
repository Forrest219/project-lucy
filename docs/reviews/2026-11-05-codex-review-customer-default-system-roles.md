# 客户默认系统正式 Role：Codex 交叉审阅

- 审阅方式：本机 Codex CLI 0.163.0，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，经本机 `127.0.0.1:7890` 代理；只读。各轮修订由实施代理落地。
- 对象：`lucy-20261105-customer-default-system-roles` Spec／Plan。
- 原始摘录：`inbox/codex-prompt-customer-default-system-roles-roundN.md`、`inbox/codex-review-customer-default-system-roles-roundN.txt`（可删工作副本）。
- 上限：三轮（用户指定）。

定稿只覆盖这份设计合同。**可交付开发 ≠ 功能合同已收口 ≠ 可上线。**

## 第 1 轮

对象是 Spec／Plan **v0.1**。结论：**退回修订**。阻塞 1，高 2，中 2。

| ID | 级别 | 摘要 |
|---|---|---|
| R01 | 阻塞 | 149／D22／术语／SC-11 绝对值与例外冲突；SC-07 易假绿 |
| R02 | 高 | ensure「成功」未映射 `connectionWrite×readiness` |
| R03 | 高 | ACL 写盘缺原子／失败／恢复边界 |
| R04 | 中 | Agent／Token／静态 reader 口径不一致 |
| R05 | 中 | SC-08 字符串存在性；非目标保护不足 |

### 第 1 轮后 → v0.2

闭合文档例外、状态表、启动写盘草合同、Agent 口径、结构 SC；修订 149／D22／术语。

## 第 2 轮

对象是 **v0.2**。结论：**退回修订**。R01／R02／R04 已闭合；残留：

| ID | 级别 | 摘要 |
|---|---|---|
| N01 | 高 | 启动写入须过恢复门禁，不可绕过 |
| N02 | 中 | 四分支允许变更集合与字节／语义口径须统一进 SC |

### 第 2 轮后 → v0.3

§3.3 恢复准入、§3.3.1 比较表、SC-11／12。

## 第 3 轮

对象是 **v0.3**。结论：**小修订后定稿**。N01 已闭合；N02 小残留 + Plan 自包含／恢复 API 准确写法。

### 第 3 轮后补丁 → v0.4（定稿）

| 项 | 处理 |
|---|---|
| SC-06 | ensure 前后 users 全字段语义相等；不新增／改绑系统 Role；既有绑定保留 |
| §4.2／149 SC-11 | 统一指向 §3.3.1 语义／字节口径 |
| Plan | 展开落点与验收；写明 `readAccessRecoveryState` + `assertAccessWritesAllowed(state)` |
| 状态 | Spec／Plan／索引 → **可交付开发** |

**定稿条件：** Codex 三轮已完成；第 3 轮最小补丁已写入 v0.4。可实施配对 Plan。不表示 SC 已执行、不表示功能合同已收口、不表示可上线。
