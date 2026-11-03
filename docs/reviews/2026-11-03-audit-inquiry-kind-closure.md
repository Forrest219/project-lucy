# 访问日志问询种类与访问等级 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-03（Asia/Shanghai） |
| 授权 | 同会话用户批准 C 类功能闭口 |
| 对象 | [Spec v0.4](../specs/lucy-20261102-audit-inquiry-kind-spec.md)；[Plan v0.4](../plans/lucy-20261102-audit-inquiry-kind-plan.md) |
| 结论 | **功能合同收口。** SC-01–SC-25 有本机自动化证据。**本条收口不表示可上线。** 功能编号无 |

## 这次跑过的测试

同会话 Inquiry-kind batch（**68 条 / 6 文件全绿**）。问询记录 UI 列／筛选项另由 Batch1 `admin-audit-turns.test.tsx` 覆盖。

```bash
cd webui && npx vitest run --maxWorkers=1 \
  server/__tests__/admin-audit.test.ts \
  server/__tests__/proxy-audit.test.ts \
  server/__tests__/audit-inquiry-kind.test.ts \
  server/__tests__/audit-inquiry-serial.test.ts \
  server/__tests__/access-grade.test.ts \
  src/__tests__/audit.test.tsx
```

不在本条出口：浏览器走查、Playwright、窄屏、镜像、客户环境。

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| SC-01 | 通过 | `audit-inquiry-kind.test.ts`（已上报 → `real`） |
| SC-02 | 通过 | 同上（会话建立推断 → `session_visit`） |
| SC-03 | 通过 | 同上（未上报／查数等级） |
| SC-04 | 通过 | `admin-audit.test.ts`（默认列表排除会话访问） |
| SC-05 | 通过 | `audit-inquiry-kind.test.ts`（种类筛选枚举） |
| SC-06 | 通过 | 同上（已上报 + 会话建立前缀仍为 real） |
| SC-07 | 通过 | `admin-audit.test.ts`（覆盖计数） |
| SC-08 | 通过 | 同上（种类筛选在分页前） |
| SC-09 | 通过 | `audit-inquiry-kind.test.ts` / CSV 字段 |
| SC-10 | 通过 | `access-grade.test.ts`（工具 → 等级映射） |
| SC-11 | 通过 | `admin-audit.test.ts`（默认排除连接级） |
| SC-12 | 通过 | 同上（`accessGrade=query`） |
| SC-13 | 通过 | `audit-inquiry-kind.test.ts`（调用 CSV + 导出包） |
| SC-14 | 通过 | `audit.test.tsx`（筛选项 DOM） |
| SC-15 | 通过 | `audit.test.tsx`（会话访问抽屉） |
| SC-16 | 通过 | `audit-inquiry-kind.test.ts`（非法枚举 fail-closed 为缺省） |
| SC-17 | 通过 | 回归：使用概况 KPI 测试未改（同批 admin 套件） |
| SC-18 | 通过 | 术语标准 §4.7 + `lint:terminology`（过程记录，非本条阻塞项） |
| SC-19 | 通过 | `audit-inquiry-serial.test.ts`（跨 Agent 发号） |
| SC-20 | 通过 | 同上（重建／重启稳定号） |
| SC-21 | 通过 | `audit-inquiry-kind.test.ts`（流水号一致与空号） |
| SC-22 | 通过 | 同上（CSV 列与关联键） |
| SC-23 | 通过 | `audit.test.tsx` / serial（搜索与复制流水号） |
| SC-24 | 通过 | `audit-inquiry-serial.test.ts`（补号排序与事务） |
| SC-25 | 通过 | `audit-inquiry-kind.test.ts`（推断簇种类与查数等级） |
