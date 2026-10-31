# 发版 UI 记录

每个准备打 tag 的产品版本一份记录，路径是 `docs/releases/ux/<产品版本>.md`。产品版本 `0.21.0` 的文件是 `docs/releases/ux/0.21.0.md`。

已发布的 v0.20.0 不补这份记录。目录里可以只有本说明。

## 结果块

文件开头用这四行，供 `npm run lint:release-ledger` 读取：

```text
result: passed
reasonClass: none
workspaceDirty: false
structure: green
```

| 字段 | 取值 |
|---|---|
| `result` | `passed` 或 `blocked` |
| `reasonClass` | `none`、`instance-not-ready`、`structure-blocked`、`walk-blocked` |
| `workspaceDirty` | `true` 或 `false` |
| `structure` | `green`、`red` 或 `not-run` |

`passed` 只允许 `result: passed`、`reasonClass: none`、`workspaceDirty: false`、`structure: green`。三个阻断原因类都不能被台账记成 passed。

| reasonClass | 含义 |
|---|---|
| `instance-not-ready` | 走查未开始。提交不一致、健康检查失败，或工作区是脏构建 |
| `structure-blocked` | 走查未开始。结构层失败 |
| `walk-blocked` | 走查已完成，阻断项仍开着 |

## 其余字段

产品版本、40 位构建提交、视口、走查日期、每个表面的 PASS / FAIL / N/A 与级别、失败的 `UX-<PAGE>-NNN` 与截图路径、兜底签字人、改判原因、仍接受的 P1、相对上一版的新失败 / 已关闭 / 仍开放。

可生产发布的台账用 `gates[].evidence` 指向这份文件，并设 `manual: true`。不填 CI `run`。
