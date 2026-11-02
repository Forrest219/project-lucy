# 连接服务器地址编辑 · UX Dialog 补口：Codex 交叉审阅

- 审阅方式：本机 Codex CLI，`/Users/forrest/.local/bin/codex exec -s read-only --skip-git-repo-check -C /Users/forrest/GitHub/project-lucy`，只读。各轮修订由实施代理落地。
- 对象：`lucy-20261101-connection-endpoint-edit` Spec／Plan **v0.4 → v0.4.3**（UX Dialog 对齐 Tableau）。
- 原始摘录：`inbox/codex-prompt-connection-endpoint-edit-dialog-roundN.md`、`inbox/codex-review-connection-endpoint-edit-dialog-roundN.txt`（可删工作副本）。
- 上限：原定三轮；r3 要求就 UX-01／UX-10 开 **第 4 轮定向复核** 后定稿。

定稿只覆盖 UX Dialog 补口合同。服务端 SC-01–SC-10／15–21／23 仍以 [2026-11-01 收口](2026-11-01-connection-endpoint-edit-closure.md) 为准。UX SC-11–14／22／24–27 未执行。定稿不表示可上线。

## 第 1 轮

对象 **v0.4**。结论：**退回修订。** 阻塞 0，高 3，中 4，低 1（UX-01–UX-08）。

要点：testid 冒充布局；「第二套」字段断言假阳性；submitting 未盖关闭按钮；Toast mock 空过；primary 分范围不清；术语缺「编辑预览」；收口镜像缺 §12.2；旧 Drawer re-export 可残留。

## 第 1 轮后修订（→ v0.4.1）

吸收 UX-01–UX-08：真实组件、面板内外字段、全关闭入口、Toast 参数、分范围 primary、六行术语、镜像含 §12.2、收口前删旧文件。

## 第 2 轮

对象 **v0.4.1**。结论：**退回修订。** 阻塞 0，高 1，中 2，低 0。

| 编号 | 闭合 |
|---|---|
| UX-02–UX-08 | 闭合 |
| UX-01 | 部分（类名不够，须断言生产 CSS 规则） |
| UX-09 | 新：验收块 `cd webui` 重复 |
| UX-10 | 新：残留扫描 `\|\| true` 与文档误扫 |

## 第 2 轮后修订（→ v0.4.2）

CSS 文本断言 fixed／inset／居中；焦点；根目录子 shell 验收；残留分源码／文档。

## 第 3 轮

对象 **v0.4.2**。结论：**退回修订**；要求第 4 轮仅核两项。阻塞 0，高 1，中 1。

- UX-01：缺 `flex` 布局方式 → 去 flex 仍假通过
- UX-09：闭合
- UX-10：`if rg` 未处理退出码 2

## 第 3 轮后修订（→ v0.4.3）

CSS 须含 `flex`；`rg` 退出码 0／1／其他三分。

## 第 4 轮（定向）

对象 **v0.4.3**。结论：**可定稿。** UX-01／UX-10 闭合；无新高／阻塞。

**定稿条件：** 文档合同闭合。定稿 ≠ 开发授权自动完成（本会话已授权进入开发）≠ SC 已执行 ≠ 可上线。
