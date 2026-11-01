# 登录账户页 —— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261030-login-accounts-spec.md`](../specs/lucy-20261030-login-accounts-spec.md)（收口后 **v1.3**） |
| Plan | [`docs/plans/lucy-20261030-login-accounts-plan.md`](../plans/lucy-20261030-login-accounts-plan.md) |
| 台账号 | 无。不进入 v0.25 升级台账，不另派 WebUI 流水号 |
| 层级 | **功能合同** |
| 结论 | **SC-01–SC-18 全部关闭。** 本条收口**不表示可上线**——浏览器走查、移动窄屏、Docker 重建、客户交付不在本条出口 |
| 授权 | PM 2026-11-01 批准「B 档 + 形态搭车」批次 |

---

## 一、本条为什么值得单独记一笔：**Spec 状态行是过期的**

盘点阶段发现本条与 agent-roster 的 **Spec 状态行与实施 Plan 互相矛盾**：

| 来源 | 内容 |
|---|---|
| Spec 状态行（`:8`，收口前） | 「v1.2 已定稿，可交付开发。**SC-01–SC-18 仍未执行**」 |
| 实施 Plan 状态行（`:9`） | 「**v1.3：S1–S2 已落地**（2026-10-30）。**SC-01–SC-18 全部有通过记录**（组件测试、导航测试、术语检查）」 |

Plan 的 §5.1 还给出了**逐条 SC → 测试名 → 文件**的对照表，Plan 头部「验收」行也写着「SC-01–SC-18 全部通过，记录见 §5」。

**结论**：实现与验收在 2026-10-30 就已完成并留痕，**是 Spec 状态行没跟上**。按「Spec 状态行与实施 Plan 是两份独立维护的事实源，单看 Spec 会漏」的口径，本次收口把 Spec 状态行更正到与事实一致，并**按 Plan 的既有记录逐条复核**（不直接采信）。

## 二、出口矩阵结果（逐条 SC → 用例 → 文件）

**证据等级：本地自动化（vitest）＋ 本地工程门禁。** 无 CI job 证据，无客户环境证据，无浏览器实测证据。

| SC | 结果 | 证据落点（文件 → 测试名／断言要点） |
|---|---|---|
| SC-01 | 通过 | `admin-accounts-route.test.tsx`——打开旧路径后地址栏变成 `/admin/accounts`，页头是「登录账户」；登录守卫把旧路径记成 `from`；登录后回到旧路径仍落在 `/admin/accounts`（**不**只断言侧栏 `to`） |
| SC-02 | 通过 | `navigation.test.ts`——侧栏「登录账户」指向 `/admin/accounts`，旧路径不再是侧栏目标 |
| SC-03 | 通过 | `admin-accounts.test.tsx`——所有者看到页头「新建账户」，页面没有旧的常驻标题 |
| SC-04 | 通过 | `admin-accounts-oidc.test.tsx`——运维名册只有四列，没有登录方式、新建账户、管理和禁用 |
| SC-05 | 通过 | `admin-accounts.test.tsx`——开放模式保留原说明，没有「新建账户」和「管理」 |
| SC-06 | 通过 | `admin-accounts-oidc.test.tsx`——单点登录未启用时新建对话框只有四个字段，页头下一句说明 |
| SC-07 | 通过 | `admin-accounts-oidc.test.tsx`——单点登录已启用时，未勾选不出现三项，勾选后三项必填且密码可留空 |
| SC-08 | 通过 | `admin-accounts.test.tsx`——当前登录的行有标记，抽屉标题是该登录账户 id |
| SC-09 | 通过 | `admin-accounts.test.tsx`——当前登录账户的禁用与删除不可执行，且不发请求 |
| SC-10 | 通过 | `admin-accounts.test.tsx`——唯一一名启用且有本地密码的所有者：禁用、删除和降权都不可执行；两名启用所有者中只有一人有本地密码时底线落在有本地密码的那一侧；两名都有本地密码时当前人可把自己改为运维 |
| SC-11 | 通过 | `admin-accounts-oidc.test.tsx`——「移除本地密码」的七行出现条件逐行断言；允许态断言 `PATCH` body 为 `{ removeLocalPassword: true }` |
| SC-12 | 通过 | `admin-accounts.test.tsx`——删除确认在登录账户 id 一致前不发出 `DELETE`；比较五格（`xingchen`、首尾空格、首尾换行、`Xingchen`、中间换行） |
| SC-13 | 通过 | `admin-accounts.test.tsx`——接口拒绝时把接口文案留在抽屉或确认框里 |
| SC-14 | 通过 | `admin-accounts.test.tsx`——「保存密码」调用 `PATCH`，成功后显示「本地密码已更新。」 |
| SC-15 | 通过 | `admin-accounts-oidc.test.tsx`——未勾选时 `POST` 不带 `oidcBinding`；勾选并填齐三项、密码留空时 `POST` 带 `oidcBinding` 且不带 `password` |
| SC-16 | 通过 | `admin-accounts.test.tsx`——用户可见文案不含禁用词 |
| SC-17 | 通过 | `admin-accounts.test.tsx`——SC-09 的保护按钮与 SC-12 的删除确认按钮**分别**断言：可聚焦、气泡关闭时节点在 DOM、气泡文本与节点相同 |
| SC-18 | 通过 | `admin-accounts-oidc.test.tsx`——抽屉里的身份绑定四格（未启用无绑定／未启用有绑定／启用无绑定／启用有绑定） |

**实测（2026-11-01 复跑）**：`admin-accounts-route.test.tsx` / `navigation.test.ts` / `admin-accounts.test.tsx` / `admin-accounts-oidc.test.tsx` —— **4 文件 / 62 条全绿**。

## 三、工程门禁（2026-11-01 实测）

| 门禁 | 结果 |
|---|---|
| `npm run lint:terminology` | exit 0（1094 files scanned） |
| `npm run lint:spec` | exit 0 |
| `npm run lint:ia-boundary` | exit 0 |
| `npm run lint:version` | exit 0（`VERSION=0.20.0`） |
| `npm run lint:handbook-baseline` | exit 0（baseline aligned with VERSION=0.20.0） |
| `npm run lint:handbook-coverage` | exit 0（26 nav entries covered） |
| `npm run lint:handbook-anchors` | exit 0（108 anchor links · 120 TOC sections · 129 headings） |
| `npm --prefix webui run build` | exit 0 |
| `node scripts/lint-spec-docs.mjs` | **exit 0**（343 files scanned，898 baseline exemptions）——Plan §5.1 记的「`lint:spec-docs` 仍因仓库里已有的三份他人文档 exit 1」**已过期**，该门禁今日通过 |

## 四、残余

1. **浏览器走查、移动窄屏验证未执行**——按 Spec「闭口层级」**不在本条出口**，不构成收口阻塞。
2. **`SEC-03-V05` 与 `SEC-04-V11` 的选择器已按 S2 改完，但 e2e 未在本轮跑**——这两个编号属企业安全 real-e2e 线（另一 Spec），不是本条承诺。
3. **「组件测试通过不等于这一页已经在运行中的容器里改版」**（Plan 原话）——Docker 重建与客户交付不在本条出口。

## 五、不在本次收口里

- **Docker 重建、客户交付、客户环境验证**——本条收口**不表示可上线**，也不构成客户包验收。
- **整库旅程、跨模块故障演练、证据等级**——归发布取证层（该层目前**没有承载本轮已收口功能的已执行 Spec**——形态搭车后有 2 份交付／构建契约类声明了该层，但均未执行，见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md) §五）。

## 六、复现命令

```bash
cd /Users/forrest/GitHub/project-lucy/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 \
  src/__tests__/admin-accounts-route.test.tsx \
  src/__tests__/navigation.test.ts \
  src/__tests__/admin-accounts.test.tsx \
  src/__tests__/admin-accounts-oidc.test.tsx
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。
