# Token 默认有效期与续期：Codex 交叉审阅

- 审阅方式：本机 Codex CLI 0.163.0，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check`，只读，第 1 轮未改 Spec／Plan 正文（修订由实施代理落地）。
- 对象：初稿 `lucy-20261101-token-default-ttl-and-renewal` Spec／Plan v0.1。
- 原始摘录：`inbox/codex-review-token-default-ttl-and-renewal-round1.txt`（可删工作副本）。

## 第 1 轮

对象是 Spec／Plan v0.1。结论：**退回修订（不定稿）。** 阻塞 0，高 4（R1–R4），中 5（R5–R9），低 1（R10）。

1. **R1｜高｜撤销表检查不能是可选项** — 半失败撤销后 YAML 仍可能残留；续期必须锁内按 hash 查 `revoked_tokens`。
2. **R2｜高｜续期缺少委托 Agent 的所有者门禁** — 须继承创建路径对 `delegated_from` 的 owner 校验。
3. **R3｜高｜Gate 允许实现自行降级且无 SC** — 冻结与创建同矩阵（高流量 `warn`）；删降级出口；补 dryRun／block／override SC。
4. **R4｜高｜写／审计／runtime ack 失败合同未闭合** — 须规定各失败点状态与局部故障注入 SC。
5. **R5｜中｜审计缺 actor／展示／导出契约**。
6. **R6｜中｜「续期」允许缩短或无变化** — 相对旧到期日仅允许严格延长（另定 null／已过期规则）。
7. **R7｜中｜旧 UX Spec／索引默认 90 未纳入同步任务**。
8. **R8｜中｜闭口承诺实为两条可独立成立的承诺** — 应拆分默认 TTL 与续期。
9. **R9｜中｜落盘清单漏 `lint:spec`／`lint:ia-boundary`**。
10. **R10｜低｜续期对话框默认值 SC 验证时点写错**。

已核对无问题（第 1 轮）：默认／上限 365、四档一致、过期可续主路径、续期≠换签、Plan 授权边界挡住偷跑、形态字段与索引登记、出口未混入浏览器／Docker／客户环境。

**定稿条件（第 1 轮）**：关闭 R1–R10；关键分支映射到 SC 与 Plan 后再审。产品六项口径保留。P2 实施仍未授权。

## 第 1 轮后修订（代理落地）

| 项 | 处理 |
|---|---|
| R8 | **拆分**：`lucy-20261101-token-default-ttl-365`（默认 365）与 `lucy-20261101-token-renewal`（续期）。原合并稿 v0.1 标为已替代，不再作为实施身份 |
| R1–R7、R9–R10 | 写入续期 Spec／Plan v0.2（及默认 TTL Spec 对 R7／R9／相关 SC） |
| 索引 | `docs/README.md`／`docs/plans/README.md` 改为两条；旧 UX Spec／索引加覆盖注记 |

## 第 2 轮

对象是拆分后的默认 TTL／续期 Spec／Plan **v0.2**。Codex CLI `exec -s read-only`。原始摘录：`inbox/codex-review-token-default-ttl-and-renewal-round2.txt`。

**结论：** 默认 365 **内容终审通过**（修正 N1 编号后可定稿）；续期 **退回**。R1／R2／R5／R7–R10 闭合；续期残留 **R3（中）**、**R4（高）**、**R6（中）**；新发现 **N1（低）** SC 须从 `SC-01` 起编号。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| N1 | 两条 Spec／Plan 验收编号改为本条 `SC-01` 起 |
| R3 | 拆 SC-09 真实 warn 与 SC-10／11 注入 block／override；删除「可用 warn 替代」括号 |
| R4 | 成功判据写实为 `runtimeAck===true`；ack 失败可同值 repair；失败表与 SC-21–23 |
| R6 | 旧值解析对齐 `isTokenExpired`／date-only UTC 日终；缺省归 ABSENT；SC-14–17 |

## 第 3 轮

对象：默认 TTL v0.3、续期 v0.3。结论：**默认 TTL 可定稿**；续期退回——R4 残留（repair 可无审计成功）、SC-14 与 repair 等值冲突；低优编辑残留。摘录：`inbox/codex-review-token-default-ttl-and-renewal-round3.txt`。

## 第 3 轮后修订（续期 → v0.4）

| 项 | 处理 |
|---|---|
| R4 | repair **禁止** ack-only；每次成功路径（含 repair）必须耐久 `token_renew`；SC-24 终态审计失败夹具 |
| SC-14 | 明确仅普通续期；等值且无 repair 资格 → 400 |
| 编辑残留 | 清理 `SC-D`／`SC-R` 旧引用；默认 TTL 登记文档定稿 |

## 第 4 轮

对象：续期 Spec／Plan **v0.4**。结论：**可定稿。** repair 强制耐久 `token_renew`；SC-14 与 repair 无冲突；SC-22／24 可证伪。摘录：`inbox/codex-review-token-renewal-round4.txt`。

**定稿声明（两条）：** 默认 TTL 365（v0.3）与 Token 续期（v0.4）文档合同均已定稿。实施须另获委托人明示开工授权；不定表示功能收口或可上线。
