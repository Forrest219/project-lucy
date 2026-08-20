# Database Connection Operations Runbook Spec

> **产品边界更新（Spec 124 · 2026-08-20）**：WebUI **新建连接**已完成设计（`webui/docs/124-connection-create-admin-spec.md`）。本文档下文「WebUI 不负责新建物理数据库连接 / 不在 WebUI 实现新建连接表单」等 Non-Goal 在 **Spec 124 实现落地前仍为现行事实**；实现后须按 Spec 124 §5.5 / §8.3 修订本节目标、非目标与手册要求。密码持久态仍为 `file:` 引用；本文件描述的手工 `ktx.yaml` + secrets 路径保留为高级 / 灾备路径。

| 元数据 | 内容 |
|---|---|
| 文档名称 | Database Connection Operations Runbook Spec |
| 文档类型 | Product / Docs / Operations / Governance Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy Help Center 系统手册、数据库接入模块、客户 headless 配置包、Agent 访问治理配置 |
| 架构决议 | 系统手册必须显性说明：WebUI 不负责新建物理数据库连接；新增连接由运维在 `ktx.yaml` 与 secret 文件中完成，WebUI 只管理已声明连接的连通测试、Schema、表白名单、YAML 资产和本地 Catalog 状态 |
| 事实源 | `docs/SYSTEM_HANDBOOK.md`、`ktx.yaml.example`、`customer-config.example/ktx.yaml`、`webui/config/access.yaml`、`docs/customer-deployment-guide.md`、`docs/admin-guide.md` |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/24-yaml-delivery-runbook-spec.md`、`docs/design-db-connection.md`、`docs/design-schema-onboarding.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

近期 StarRocks 连接咨询暴露出一个手册缺口：设计文档已明确 WebUI 不做新建连接，但系统手册的“数据库接入”章节只说连接信息来自 `ktx.yaml`，没有把边界翻译成运维人员可执行的操作指引。

本规格要求把“新增数据库连接”写成通用运维 runbook，而不是只服务某个固定产品。目标连接可以是 MySQL、PostgreSQL、Doris、StarRocks，或后续通过 KTX 支持的其它只读数据源；手册应按连接形态说明配置字段、secret 注入、测试、扫描 / manifest、白名单、ACL 和 Agent smoke。

本规格作出以下决议：

1. 系统手册必须在 `3.2 数据库接入` 开头显性声明 WebUI 边界。
2. 新增连接的事实源是 `ktx.yaml`，凭据事实源是 `.ktx/secrets/`、环境变量或 Docker secrets；WebUI 不读取、不编辑、不展示密码内容。
3. WebUI 可以给已有连接添加 Schema、维护 `enabled_tables`、执行连通测试、上传 YAML、刷新本地 Catalog，但不创建 host / port / user / password 级连接。
4. 手册必须同时覆盖本地开发路径和客户 Docker / `customer-config/` 路径。
5. 手册必须给出通用连接配置模板，并用示例矩阵说明原生 MySQL、PostgreSQL、MySQL wire OLAP（Doris / StarRocks）的差异。
6. 新增连接后必须同步 Agent role / ACL；否则连接在 `ktx.yaml` 中存在，也不会对 MCP token 可见。

## 2. 目标与非目标

### 2.1 目标

| 目标 | 说明 |
|---|---|
| 显性产品边界 | 运维用户不再误找 WebUI 的“新建连接”按钮 |
| 通用连接 runbook | 覆盖 MySQL、PostgreSQL、Doris、StarRocks 等连接类型，不把文档绑定到单一产品 |
| 本地与客户部署双路径 | 同时说明仓库本地路径和 Docker `/data/lucy` / `customer-config/` 路径 |
| 凭据安全 | 所有示例使用 `file:`、`env:` 或 Docker secrets，不出现明文密码 |
| Agent 可见性闭环 | 指明 `webui/config/access.yaml` role / `tableSelectors` 是 MCP 可见性的第二道开关 |
| 运维可验收 | 给出连接测试、manifest 检查、reindex、只读查询、WebUI reload、audit 排障的顺序 |

### 2.2 非目标

| 非目标 | 理由 |
|---|---|
| 不在 WebUI 实现新建连接表单 | 当前安全边界不允许 WebUI 接管 host / port / user / password |
| 不实现 secret 管理 UI | `.ktx/secrets/**` 是硬边界，WebUI 不读写 secret 内容 |
| 不自动推断所有数据库 driver | 手册只记录当前已知稳定形态；新 driver 由 KTX 能力和后续 spec 承接 |
| 不把 StarRocks 直接升级为 release-verified | StarRocks 仍遵守 R1 P1 gated / pending live certification 约束 |
| 不把 Catalog Reload 描述成物理库扫描 | Catalog Reload 只读本地 YAML；物理扫描或 manifest 生成由 KTX ingest / 受控上传完成 |

## 3. Handbook 信息架构要求

### 3.1 `3.2 数据库接入` 开头增加边界说明

系统手册必须在页面入口表之前加入显性说明：

```markdown
> WebUI 不负责新建物理数据库连接。新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。
> WebUI 管理的是已声明连接：查看连接状态、测试连接、添加 Schema、维护表白名单、上传 YAML 资产、刷新本地 Catalog。
```

说明必须包含：

| 问题 | 手册应回答 |
|---|---|
| 我在哪里新建连接？ | 编辑 `ktx.yaml`，不是 WebUI |
| 密码放哪里？ | `file:` / `env:` / Docker secrets，不写 inline 明文 |
| WebUI 能做什么？ | 管理已声明连接 |
| 新连接什么时候对 Agent 可见？ | `ktx.yaml`、manifest / overlay、`enabled_tables`、`access.yaml` 均就绪后 |

### 3.2 新增“新增数据库连接 Runbook”小节

建议落在 `docs/SYSTEM_HANDBOOK.md` 的 `3.2 数据库接入` 内，标题为：

```markdown
#### 新增数据库连接（运维 Runbook）
```

小节必须覆盖：

1. 收集连接信息。
2. 创建 secret 文件或环境变量。
3. 编辑 `ktx.yaml`。
4. 执行 `ktx connection test`。
5. 生成或导入 manifest；运行 `ktx ingest` 前必须确认 `scan.enrichment`、LLM、embedding 外部数据流已获客户 / 数据 Owner 授权，未授权时改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
6. 维护 `enabled_tables`。
7. `ktx admin reindex --force`。
8. 同步 `webui/config/access.yaml` 的 role / ACL。
9. 通过 WebUI `/connections` 与 `/admin/audit` 验收。
10. 用 MCP token 做最小 smoke。

## 4. 通用连接配置模型

### 4.1 通用字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `driver` | 是 | KTX driver，例如 `mysql`、`postgres` |
| `engine` | 视情况 | 数据库引擎标识，例如 `doris`、`starrocks`；原生 MySQL 可省略 |
| `wire_protocol` | 视情况 | Doris / StarRocks 等使用 `mysql` wire protocol 的 OLAP 源应显式写出 |
| `readonly` | 建议 | 运维意图标记；真实只读必须由数据库账号权限保证 |
| `r1_target` | 视情况 | 仅 R1 受控目标源需要显式设置 |
| `enabled_tables` | 是 | 允许进入语义层 / Agent 暴露基础范围的表 |
| `host` | 是 | 数据库 host，不在公开文档泄露真实值 |
| `port` | 是 | 数据库端口 |
| `database` | 是 | 默认 database / catalog，具体语义以 driver 为准 |
| `username` | 是 | 只读账号 |
| `password` | 是 | 使用 `file:` 或 `env:`，禁止明文 |
| `schemas` | 是 | 已纳入治理的 Schema 列表 |

### 4.2 连接形态矩阵

| 连接形态 | 推荐配置形态 | 说明 |
|---|---|---|
| MySQL | `driver: mysql`，默认端口 `3306` | 原生 MySQL；`engine` 通常可省略 |
| PostgreSQL | `driver: postgres`，默认端口 `5432` | Schema 语义按 PostgreSQL 处理 |
| Doris | `driver: mysql`、`engine: doris`、`wire_protocol: mysql` | MySQL wire protocol OLAP 源；R1 目标源需 `readonly: true`、`r1_target: true` |
| StarRocks | `driver: mysql`、`engine: starrocks`、`wire_protocol: mysql` | MySQL wire protocol OLAP 源；当前仍是 gated support，需证据后才能写 release-verified |

### 4.3 通用模板

```yaml
connections:
  <connection-id>:
    driver: <mysql|postgres>
    engine: <optional-engine>
    wire_protocol: <optional-wire-protocol>
    readonly: true
    enabled_tables:
      - <schema>.<table_or_view>
    host: <DB_HOST>
    port: <DB_PORT>
    database: <DATABASE>
    username: <READONLY_USERNAME>
    password: file:<ABSOLUTE_PROJECT_OR_CONTAINER_PATH>/.ktx/secrets/<connection-id>-password
    schemas:
      - <schema>

setup:
  database_connection_ids:
    - <connection-id>
```

如果是客户 Docker / headless 配置包，`password` 路径应优先使用容器内路径：

```yaml
password: file:/data/lucy/.ktx/secrets/<connection-id>-password
```

## 5. 操作流程规格

### 5.1 本地开发路径

系统手册必须给出本地开发命令：

```bash
cd <PROJECT_ROOT>
mkdir -p .ktx/secrets
printf '%s' '<DB_PASSWORD>' > .ktx/secrets/<connection-id>-password
ktx --project-dir <PROJECT_ROOT> connection test <connection-id>

# 生成 manifest 前必须确认 scan.enrichment / LLM / embedding 外部数据流已获授权。
# 未授权时不要执行 ingest，改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
ktx --project-dir <PROJECT_ROOT> ingest <connection-id>
ktx --project-dir <PROJECT_ROOT> admin reindex --force
ktx --project-dir <PROJECT_ROOT> sl validate <source-name> --connection-id <connection-id>
```

### 5.2 Docker / customer-config 路径

系统手册必须给出客户部署命令：

```bash
docker compose exec lucy mkdir -p /data/lucy/.ktx/secrets
docker compose exec -T lucy sh -c 'cat > /data/lucy/.ktx/secrets/<connection-id>-password' < ./<connection-id>-password
docker compose restart lucy
docker compose exec lucy ktx --project-dir /data/lucy connection test <connection-id>

# 生成 manifest 前必须确认 scan.enrichment / LLM / embedding 外部数据流已获授权。
# 未授权时不要执行 ingest，改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
docker compose exec lucy ktx --project-dir /data/lucy ingest <connection-id>

docker compose exec lucy ktx --project-dir /data/lucy admin reindex --force
docker compose exec lucy ktx --project-dir /data/lucy sl validate <source-name> --connection-id <connection-id>
```

如果使用 bind mount：

```text
customer-config/ktx.yaml  -> /data/lucy/ktx.yaml
customer-config/.ktx/secrets/ -> /data/lucy/.ktx/secrets/
```

### 5.3 WebUI 验收路径

新增连接写入并重启 / reload 后，系统手册必须要求在 WebUI 验收：

| 页面 | 验收点 |
|---|---|
| `/connections` | 新连接可见，driver / engine / Schema / enabled table 数量正确 |
| `/connections/test` 或连接卡片 | 连通测试成功；失败时展示可诊断原因 |
| `/connections/whitelist` | 只出现本地 manifest 中可选表；白名单与 `enabled_tables` 对齐 |
| `/admin/roles` 或 `access.yaml` | role 已授权新连接和目标表 |
| `/admin/audit` | MCP smoke 的 allow / deny 记录可追溯 |

## 6. ACL 与 Agent 可见性

新增连接后，手册必须明确说明 Agent 可见性由两层配置共同决定：

1. `ktx.yaml`：连接、Schema、`enabled_tables`。
2. `webui/config/access.yaml`：role 的 `allow.connections`、`tableSelectors`、`tools`。

示例：

```yaml
roles:
  <role-id>:
    description: <role-description>
    allow:
      connections:
        - <connection-id>
      tableSelectors:
        - connection: <connection-id>
          schema: <schema>
          names:
            - <table_or_view>
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
```

手册必须指出：如果 `ktx.yaml` 已配置连接但 role 未授权，MCP 调用会按 fail-closed 策略拒绝，常见 reason 包括 `unknown_or_forbidden_connection:<connection>` 或 `table_forbidden:<table>`。

## 7. 排障要求

系统手册必须补充新增连接常见失败的诊断表：

| 症状 | 首查位置 | 处理 |
|---|---|---|
| WebUI 看不到连接 | `ktx.yaml`、`KTX_PROJECT_ROOT`、容器挂载路径 | 确认实际运行时读取的是目标配置根 |
| 连通测试失败 | host / port / 网络 / 只读账号 / secret 文件路径 | 在容器内跑 `ktx connection test`，不要只在宿主机验证 |
| 提示缺失 Manifest | `semantic-layer/<conn>/_schema/<schema>.yaml` | 跑 `ktx ingest` 或上传受控 manifest，再刷新本地 Catalog |
| 白名单表不可选 | manifest 未包含目标表 | 检查 manifest 内容和 `enabled_tables` 拼写 |
| Agent 看不到连接 | `webui/config/access.yaml` role | 同步 `connections` 与 `tableSelectors`，等待缓存刷新或重启 Proxy |
| 查询被拒 | `/admin/audit` decision reason | 按 `table_forbidden`、`raw_query_forbidden`、`tool_forbidden` 分类处理 |

## 8. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Term | UI 主术语 | 说明 |
|---|---|---|
| Physical Database Connection | 物理数据库连接 | 用于区分 `ktx.yaml` 中的真实数据库连接与 WebUI 已声明连接管理能力 |
| Operations Runbook | 运维 Runbook | 面向运维人员的可执行步骤集合 |
| Connection Shape | 连接形态 | 用于描述 MySQL、PostgreSQL、MySQL wire OLAP 等配置差异 |

术语要求：

- `Connection` 继续使用 `连接`。
- `Schema`、`Manifest`、`Catalog` 保留英文。
- `Read-only` 统一为 `只读` 或 `预期只读`。
- 不把 WebUI 的 `添加 Schema` 描述成“新增连接”。
- 不把 `Catalog Reload` 描述成“扫描数据库”或“触发 ingest”。

## 9. 验收标准

### 9.1 文档验收

- `docs/SYSTEM_HANDBOOK.md` 在 `3.2 数据库接入` 开头显性声明 WebUI 不新建物理数据库连接。
- 手册包含通用新增连接 runbook，不只描述 StarRocks。
- 手册覆盖至少 MySQL、PostgreSQL、Doris、StarRocks 四种连接形态。
- 手册包含本地开发和 Docker / customer-config 两套路径。
- 手册包含 ACL / Agent 可见性步骤。
- 所有示例不包含真实 host、username、password、token。

### 9.2 Help Center 验收

- Help API TOC 能解析新增小节。
- `/help` 可以搜索或定位“新增数据库连接”“物理数据库连接”“WebUI 不负责新建物理数据库连接”。
- 新增锚点稳定，不因编号变化导致 Help Center 跳转失效。

### 9.3 技术验收

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/help.test.ts
npm test -- --run src/__tests__/help-center.test.tsx
cd /Users/zhangxingchen/Projects/project-lucy
npm run lint:spec
```

如仅改文档且测试环境缺少依赖，应至少运行 `npm run lint:spec` 并人工检查 Help TOC 渲染。
