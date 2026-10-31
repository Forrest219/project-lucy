# 行权限视图呈现修订 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 授权 | PM 于 2026-11-01 选定收口范围：本条与「新建角色默认只读问答工具」同批收口 |
| 对象 | [行权限视图呈现修订](../specs/lucy-20261030-row-policy-view-presentation-spec.md) v0.3；[配套 Plan](../plans/2026-10-30-lucy-row-policy-view-presentation-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-18 全部关闭，阻塞 0。**本条收口不表示可上线。** 功能编号待 PM 指派 |

## 出口

本条闭口层级声明的出口：SC-01–SC-18 的自动化用例，加 `npm run lint:terminology`。

不在本条出口：浏览器点击验收与移动窄屏验证、镜像构建与部署、客户环境验证、真实实例写入；**父 Spec（行策略模板与按表反查）的 RTV-01–RTV-08 不在本条出口**。

验收断言原文见主 Spec §7，自动化证据落点见主 Spec §7.1，本文件不重复抄写，只给结论与本次实测。

## 这次跑过的测试

```bash
cd webui && npx vitest run --maxWorkers=1 \
  src/__tests__/row-policy-view.test.tsx \
  src/__tests__/row-policy-dnf-preview.test.tsx \
  server/__tests__/p1-row-policy-views.test.ts
```

**3 个文件 / 59 条通过。** SC-18 由仓库根目录 `npm run lint:terminology` 关闭（退出码 0）。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | 页面测试「点表只打开详情，清单请求不带当前表三参数」 |
| SC-02 | 通过 | 页面测试「深链三参数只打开详情，三个清单筛选控件为空」 |
| SC-03 | 通过 | 页面测试「切到仅受限表时当前表三参数保留，表筛选框不显示当前表名」 |
| SC-04 | 通过 | 页面测试「可见值来自本地镜像，URL 存原文，请求参数才 trim」 |
| SC-05 | 通过 | 页面测试「空筛选的徽章与句子不与无授权、快照不可用混用」 |
| SC-06 | 通过 | 页面测试「清除筛选去掉整组清单筛选，当前表三参数保留」 |
| SC-07 | 通过 | 页面测试「清单是数据网格，选中行 aria-current，列表按钮 aria-label 是三元组」 |
| SC-08 | 通过 | 页面测试「四态 grantStatus 显示四句话，编译失败不写无授权」＋ 服务端 `p1-row-policy-views.test.ts`「清单授予列的 grantStatus」 |
| SC-09 | 通过 | 页面测试「两个受限分支仍是两个 arm，分支之间看得见「或」」＋ `row-policy-dnf-preview.test.tsx`「predicateLayout=stacked」 |
| SC-10 | 通过 | 页面测试「没有模板也没有内联条件的角色不显示编写方式徽章」 |
| SC-11 | 通过 | 页面测试「角色与 Agent 各有授权摘要只读深链」 |
| SC-12 | 通过 | 页面测试「全体 Agent 都是全部行时先给一句统一结论，展开后仍逐个渲染」＋ DNF 预览测试「collapseUniformAllRows」两条与默认态断言 |
| SC-13 | 通过 | 页面测试「快照默认折叠但仍在 DOM，模板入口是 secondary 按钮」 |
| SC-14 | 通过 | 页面测试「复制表身份调用 copyTextWithToast，参数是三元组」 |
| SC-15 | 通过 | 页面测试「页面只读：没有保存／删除／预演，既有 row-policy-view-* id 仍在」＋ 五个新 test id 已登记进 `docs/qa/selector-contract.md`（该文件现存 22 处 `row-policy-view-*` 登记） |
| SC-16 | 通过 | 页面测试「当前表不在筛选结果中时详情仍渲染并说明」 |
| SC-17 | 通过 | 页面测试「边界句原文不变」＋ DNF 预览测试「carries the fixed boundary sentence」 |
| SC-18 | 通过 | 仓库根目录 `npm run lint:terminology` 退出码 0 |

## 残余，不打回本条

- `npm run e2e:selector-contract` 当前整体为红，报 **201 条**（1260 个实现内静态 testid、237 个模板化、1407 条契约、189 处 Spec 引用）。逐条核对后：**没有一条指向本轮实现的 `RowPolicyView.tsx` 或 `row-policy-view-*`**，全部来自与本轮无关的既有组件。该门禁不属本条出口，但「本轮三个实现文件无告警」这一条已实测确认。
- 浏览器点击验收、Playwright 与移动窄屏验证未做，按 Plan §5 的证据要求不在默认范围内。
- 父 Spec（行策略模板与按表反查）的 RTV-01–RTV-08 仍未执行；本条只收呈现修订，不动父 Spec 的语义与授权代数。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。本条收口不表示可上线，也不构成客户包验收。
