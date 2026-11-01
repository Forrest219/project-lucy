# 共享开发 QA 基准线：Codex 交叉审阅

- 审阅方式：本机 Codex CLI，`codex exec -s read-only`，只读，第 1 轮未改 Spec／Plan 正文（修订由实施代理落地）。
- 对象：`lucy-20261101-shared-dev-qa-baseline` Spec／Plan。
- 原始摘录：`inbox/codex-review-shared-dev-qa-baseline-round1.txt`（可删工作副本）。

## 第 1 轮

对象是 Spec v0.1 与 Plan v0.1。结论：**退回修订，不定稿。** 阻塞 0，高 4（R1–R4），中 3（R5–R7），低 0。

1. **R1｜高｜文档定稿与落地闭口混用** — 全部 SC 与「定稿后才生成 Manifest」循环。
2. **R2｜高｜SC-09 冒烟不完整** — 缺目录断言、eval 入口占位；默认 `npm run eval`→`:7878` 风险。
3. **R3｜高｜缺 `admin reindex`** — 文件对齐不足以证明运行时对齐。
4. **R4｜高｜B／C 禁令不可打假混包** — 需白名单 + sha256 + 拒收反例。
5. **R5｜中｜Manifest 正本落 inbox** — 应改持久受控位置。
6. **R6｜中｜伪代码覆盖 enabled_tables 与 C 增量冲突**。
7. **R7｜中｜lint 只看 exit 0 会吞掉本对 WARN**。

已核对无问题（第 1 轮）：分层方向、禁止整包复制表述、Plan 五类小节、索引落位、闭口形态、密钥原则、实施范围受控。

**定稿条件（第 1 轮）**：必须关闭 R1–R7。

## 第 1 轮后修订（代理落地 → Spec／Plan v0.2）

| 项 | 处理 |
|---|---|
| R1 | 闭口拆 SC-D／SC-L／SC-M；Plan 验收分档 |
| R2 | Spec §7.2 固定必选冒烟步骤 1–6 + 失败判据（步骤 7 后在 v0.3 明确为推荐）；禁止默认 `:7878` eval 为必选 |
| R3 | 伪代码与冒烟含 `admin reindex` + scope／检索断言 |
| R4 | 白名单 + sha256 + 混包／secrets／未知文件拒收；SC-L02–L04 |
| R5 | 正本改坚果云 `lucy-mcp/07-共享开发B层/MANIFEST.md`；runbook 改 S1 必选 |
| R6 | §4.4 合并规则 + `reset-to-b-only`；比较只投影 B 必选 |
| R7 | SC-D08 要求对本对文件无 WARN／无 fail／无新增豁免 |

## 第 2 轮

对象是 Spec／Plan v0.2。结论：**退回修订。** R1–R5、R7 闭合；**R6 未完全闭合**。新发现：**N1 高**（同步后目标哈希／遗留 B 文件）、**N2 低**（步骤 7 必选口径冲突）。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| R6 | §4.4 引入 `Machine.B_optional_retained`；Manifest 关开关不自动删 retained；伪代码同步；反例写明 |
| N1 | Align 增加目标树白名单 sha256 + 管理 glob 遗留拒收；SC-L04／SC-M02 |
| N2 | §7.2 明确步骤 1–6 必选、步骤 7 推荐；SC-L06／审阅对照同步 |

## 第 3 轮

对象是 Spec／Plan v0.3。Codex CLI `codex exec -s read-only`。结论：**可定稿。** 阻塞 0，高 0。R6／N1 闭合；N2 执行合同闭合（审阅记录「7 步必选」措辞已在本轮更正）。R1–R5／R7 仍闭合。A／B／C 与禁止整包升格仍成立。

低项已在 S0 收尾处理：Plan P1／S0 轮次文字、本记录 R2 对照行。

**定稿声明：** 文档合同可定稿。可以按 Plan **完成 S0 后进入 S1**；**开发落地（改本机 `ktx.yaml`／私有语义／生成 Manifest 正本）须另授权**。本结论不表示基线已落地、三机已对齐或可上线。
