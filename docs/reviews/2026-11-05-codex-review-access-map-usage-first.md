# 访问关系图使用量优先呈现：对抗审阅

- 审阅方式：本机 Codex CLI（`codex exec -s read-only --skip-git-repo-check -C …`）。
- 上限：几何稿曾三轮；**故事线合并后另计三轮**（本文件续记）。
- 摘录：`inbox/codex-review-access-map-usage-first-*.txt`、`inbox/codex-review-access-map-usage-first-story-roundN.txt`。

定稿不表示可上线。本条**不要求 Docker 重建**。

## 几何稿三轮（v0.1–v0.3）

见历史摘录 round1–3（无故事线合并）。曾「可定稿附条件」；其后委托人合并 S1–S9，须重审。

## 定稿后补强（v0.3.1–v0.3.3，非 Codex）

故事线、S6–S9、筛选／对账写入 Spec，未重开 Codex → 触发下列「故事线合并后」轮次。

## 故事线合并后 · 第 1 轮（v0.3.3）

结论：**退回修订。** 阻塞 0，高 4，中 2。摘录：`inbox/codex-review-access-map-usage-first-story-round1.txt`。

| ID | 级别 | 摘要 | → v0.4 |
|---|---|---|---|
| F01 | 高 | \|E\| 对筛选后表总数 | §1.8 E／P；SC-26 |
| F02 | 高 | focus≠agent；须重投影 | §5.1.1；SC-22 |
| F03 | 高 | 折叠藏热表 | §5.8；SC-27 |
| F04 | 高 | SC-25 只比个数 | SC-25／26 ID 集 |
| F05 | 中 | 交互最低条矛盾 | §1.7 持久 vs 预览；SC-28 |
| F06 | 中 | 跨页实时同步过宽 | D25 深链对照 |

## 故事线合并后 · 第 2 轮（v0.4）

结论：**退回修订。** 高 2（F07、F04 残留）、中 1（F06）。摘录：story-round2.txt。

| ID | 处置（→ v0.4.1） |
|---|---|
| F07 | D26／D27；§5.1.1 scope 路径投影 vs focus；SC-30 |
| F04 | SC-26 预写期望 P；双侧漏数失败 |
| F06 | §1.8 深链参数映射；SC-29 |

## 故事线合并后 · 第 3 轮（v0.4.1）

结论：**可定稿（附条件）。** 阻塞 0，高 0，中 1（F06）。摘录：story-round3.txt。

## 第 3 轮后补丁（→ v0.4.2 定稿）

| 项 | 处理 |
|---|---|
| F06 | §1.8／D25：`view=calls`、agent→`user`、inquiryKind 须进 Audit 请求；SC-29 验请求生效；Plan 授权改 `Audit.tsx` |

**定稿条件：** 故事线合并后三轮完成；F06 已补。状态＝**可交付开发**。不 Docker 重建。定稿不表示 SC 已执行或可上线。
