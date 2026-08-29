# Lucy Fast Smoke 与全量 Smoke 自动化测试任务设计升级规范

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Fast Smoke 与全量 Smoke 自动化测试任务设计升级规范 (Smoke Test Design Upgrade Spec) |
| 文档类型 | Spec |
| 版本 | v2.0 |
| 撰写日期 | 2026-08-29 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Lucy 最新升级功能集（Spec 124/127/130/131/132/134/135/136、PR #25 部署许可、CFO v2 Executive POC、实时 Catalog Auto-reload）、`docs/test-layers-and-release-gates.md`、`docs/qa/lucy-webui-e2e-test-suite.md`、`webui/docs/00-product-terminology-standard.md` |
| 适用范围 | Lucy 本地开发、PR 门禁（Fast Smoke）、Nightly 构建、版本发布及客户镜像交付（Full Smoke） |
| 输出位置 | `docs/qa/smoke-test-design-upgrade-spec.md` |

---

## 1. 背景与目标

Lucy 升级后支持了 **Governed Skill 体系、企业部署许可激活码、全局 Token 看板与访问治理、发布工作台状态机流水线、开箱向导与实时 Catalog Auto-reload、监控 P95 复合指标与审计高密排版、CFO v2 多币种损益引擎** 等核心特性。
原有基于早期单机形态的冒烟测试体系（`smoke:p0` / `smoke:p1:release-readiness`）已无法完整覆盖上述新功能，容易产生测试盲区与假 PASS。

本规范定义了全新的分层冒烟机制：
1. **Fast Smoke (Tier 0 / L1)**：耗时 ≤ 45 秒，面向本地提交前自检与 PR CI 阻塞门禁，零重型容器依赖，覆盖规范合规、元数据校验、L1 UI Selector 契约及轻量进程握手；
2. **Full Smoke (Tier 1 / L2-L4)**：耗时 2~5 分钟，面向发版与客户交付验证，打通多数据源容器、License 激活、Token 设备上下文、真实 MCP 动态注入、发布变更回归及真实 Agent E2E。

---

## 2. Fast Smoke (快速冒烟) 规范

### 2.1 任务阶段编排

```text
Fast Smoke 执行流水线:
[Phase 1 规范与安全] ➔ [Phase 2 核心元数据解析] ➔ [Phase 3 WebUI 快速契约] ➔ [Phase 4 进程级握手]
```

- **Phase 1: 静态规范与安全基线**
  - `npm run lint:spec`：检查 Spec 路由与接口一致性；
  - `npm run lint:terminology` & `lint:ia-boundary`：违禁词 0 命中与 IA 边界守门；
  - `npm run security:baseline`：Token 哈希与安全基线；
  - `npm run smoke:p0:delivery-isolation`：镜像排除项静态检查。
- **Phase 2: 新功能元数据与配置解析**
  - Skill 元数据扫描：校验 Frontmatter 结构、版本语义与依赖有效性；
  - 许可激活码解析：验证 License 解码器、指纹与签名规则；
  - 配置包结构验证：`headless-config-smoke` 语法及依赖校验。
- **Phase 3: WebUI 核心路由与 Selector 契约**
  - 运行 Playwright Headless 12 条 L1 核心用例（覆盖 `/publish/workbench`、`/connections`、`/onboarding`、`/admin/access/tokens`、`/admin/audit`、`/admin/usage`、`/wiki` 及全页翻译防御）。
- **Phase 4: 本地轻量服务启动与 MCP 握手**
  - 启动隔离端口的 WebUI/Proxy 实例；
  - 验证 `/api/health` 与 `/api/license/status` 信封；
  - 执行 MCP `initialize` 握手并验证动态 `instructions` 注入；
  - 执行 `tools/list` 断言工具集清单正确。

### 2.2 产物契约
输出机器证据：`inbox/fast-smoke-evidence.json`。

---

## 3. Full Smoke (全量冒烟) 规范

### 3.1 七大门禁矩阵

1. **Gate 1: 容器与多数据源运行时 (Container & Multi-DB Runtime)**：Docker 构建、MySQL/PG/CFO Executive POC 多币种演示栈。
2. **Gate 2: 企业许可与访问治理闭环 (License & Access Governance Loop)**：有效/失效激活码注入、Token 设备上下文、Forced Predicate SQL 拦截与 Hot Store 落盘。
3. **Gate 3: 治理型 Skill 运行时注入 (Governed Skill Runtime)**：真实 MCP 协议会话、动态 Prompt 透传、工具调用与 A/B 评测归因。
4. **Gate 4: 开箱向导与连接生命周期 (Setup Assistant & Connection Lifecycle)**：Onboarding 向导、启动 Catalog Auto-reload、Schema 移除级联验证。
5. **Gate 5: 发布工作台闭环与变更触发回归 (Publish Stepper & Change Regression)**：`+N/-M` 行级统计、Quiet Validation、同步索引推进、`post_save_hook` 触发 `gate_tier: smoke` 回归。
6. **Gate 6: 监控审计与冷热工件存储 (Observability & Audit Storage)**：P95 响应时间、高密 Audit 抽屉渲染、Cold Store 工件归档。
7. **Gate 7: 多引擎认证与真实 Agent E2E (Multi-Dialect & Agent E2E)**：StarRocks/Doris 认证、Spider2 多表探针、本地 Hermes/moz 智能体 100% 准确率实跑。

### 3.2 产物契约
输出机器证据：`inbox/p1-release-readiness-evidence.json`。

---

## 4. 命令体系映射

| 级别 | 常用命令 | 目标耗时 | 用途 |
|---|---|---|---|
| Tier 0 | `npm run smoke:fast` | ≤ 45s | 本地开发 / PR 准入门禁 |
| Tier 1 | `npm run smoke:full` | ≤ 5min | 发版候选 / Nightly / 客户交付验证 |
