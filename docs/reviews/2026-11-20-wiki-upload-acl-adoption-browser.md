# P1-65 浏览器验证证据（1920×1080）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki 覆盖上传 ACL 采用浏览器证据 |
| 文档类型 | Checklist |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-20 |
| 撰写人 | Cursor |

- 路由：/wiki
- 视口：1920×1080
- 候选：`lucyVersion=0.30.0`；`gitSha=7e8ee88442c006d839e4fe13334f7fc45056d85e`；`gitDirty=true`；demo WebUI `http://127.0.0.1:55176`
- 导航／primaryReady：M1–M9／保留约 214–368 ms；见矩阵 JSON
- 原始 JSON：`inbox/uat-wua-browser-matrix-results.json`；M1-set 补跑 `inbox/uat-wua-browser-m1-set.json`；T2 `inbox/uat-wua-browser-t2.json`

## 元素结果

- E1：通过 — 页可打开；「管理访问权限」可见；可点「上传覆盖」进入预检
- E2：通过 — 选文件后出现预检；等待 preview 响应后可操作
- E3：通过 — stale／版本冲突零写入后可重预检成交（API T3＋先前 verify 抽样）；T2 客户端延迟乱序后仅末选可提交
- E4：通过 — 显式保留／采用／重设均成功落盘
- E5：通过 — M1–M9 初始「待选择（尚未确定）」且确认禁用；corrupt 采用禁用以 API／组件为准
- E6：通过 — 未选时确认禁用；选后启用；页脚确认为 primary
- E7：通过 — 当前／文件内／最终三摘要可见；未选＝待选择；选后与写入对应

## 07 矩阵

| 子例 | 结果 |
|---|---|
| M1–M9 采用上传 | PASS（真实点击） |
| M1 保留 | PASS |
| M1 重设 `set=C` | PASS（独立夹具补跑） |

## 范围说明

本证据覆盖 UAT-WUA-07 全矩阵与 12·T2。测试台记 PASS（见 gap-fill 跑次）。
