# 访问关系图闲置授权文案与边悬停：设计审阅

- 审阅方式：本机 Codex CLI（经 `~/.local/bin/codex` → TaiShanNet `127.0.0.1:7890` 定向代理 wrapper），`codex exec -s read-only --skip-git-repo-check -C …`。
- 对象：`lucy-20261105-access-map-idle-grant-copy` Spec／Plan。
- 摘录：`inbox/codex-prompt-access-map-idle-grant-copy-roundN.md`、`inbox/codex-review-access-map-idle-grant-copy-roundN.txt`。
- 上限：三轮。

定稿只覆盖设计合同。定稿不表示开发已授权。本条收口不表示可上线。

## Codex／代理可达性

| 时间 | 结果 |
|---|---|
| ~01:57–02:04 UTC | 直连失败（TaiShanNet 当时未通或未走 wrapper 效果） |
| ~02:12+ | TaiShanNet `7890` 可用；既有 `~/.local/share/codex-proxy/codex` wrapper 注入 `HTTP(S)_PROXY`；正式第 2 轮成功 |

说明：zsh `codex()` 与 PATH 上的 wrapper 已指向 TaiShanNet，**无需另装第二套代理脚本**；升级 npm `@openai/codex` 后若 symlink 被覆盖，重跑 `~/.local/share/codex-proxy/install.sh`。

## 第 1 轮（代审，v0.1）

结论：**退回修订。** 阻塞 0，高 3，中 3，低 2（F01–F08）。→ 修订为 **v0.2**（详见历史段落；已闭合）。

## 第 2 轮（正式 Codex，v0.2）

结论：**退回修订。** 阻塞 0，高 1，中 1，低 1。摘录：`inbox/codex-review-access-map-idle-grant-copy-round2.txt`。

已闭合：F01–F05、F07–F08、N1；F06 部分闭合。

残留：

1. **F09｜高** — 访问面 `unavailable` 时边可仍为 `normal` 且调用空，固定「有调用」+「调用 0 次」不诚实。
2. **F10｜中** — SC 未打假三段顺序、禁止项、括注、多可见面旧词。
3. **F11｜低** — 缺伪代码豁免（`pseudocode` lint）。

## 第 2 轮后修订（→ v0.3）

| 项 | 处理 |
|---|---|
| F09 | D9／§5.3：`accessOk` prop；降级结论与数字行；禁冒充调用；SC-08、SC-15 |
| F10 | SC-03–SC-07／SC-09–SC-14 扩充顺序、禁止项、括注、title／口径／测试文件／ops |
| F11 | 增加「伪代码豁免」节 |

## 第 3 轮（正式 Codex，v0.3）

结论：**可定稿（附条件）。** 阻塞 0，高 0，中 0，低 2。摘录：`inbox/codex-review-access-map-idle-grant-copy-round3.txt`。

已闭合：F09、F10（主体）、F11。

残留（不退回）：

1. **F12｜低** — SC-08／SC-12 对降级负向（无括注、title 无调用数字）写得不够硬。
2. **F13｜低** — Plan 缺「目标」「风险」类小节（`plan-parts`）。

## 第 3 轮后补丁（定稿）

| 项 | 处理 |
|---|---|
| F12 | SC-08／SC-12 补降级负向断言句 |
| F13 | Plan 补「目标」「风险」小节 |

**定稿条件：** 正式 Codex 三轮完成；F09–F13 已处理。定稿不表示开发已授权，也不表示 SC 已执行。本条收口不表示可上线。

**代理备忘：** Codex 走 `~/.local/bin/codex` → TaiShanNet `127.0.0.1:7890`；需 TaiShanNet 运行。npm 升级后重跑 `~/.local/share/codex-proxy/install.sh`。
