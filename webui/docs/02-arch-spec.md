# 02 · 技术规格

模块契约、目录骨架、脚手架计划与测试策略。配合 [01-architecture.md](01-architecture.md) 阅读。

## 1. 技术栈（基线）

```text
Frontend  : React 18 + Vite 5 + TypeScript 5
UI        : M0 使用 vanilla CSS；Tailwind CSS + shadcn/ui 从 M1 首个真实组件起接入
状态       : @tanstack/react-query + react-hook-form + zod
路由       : react-router-dom
Backend   : Node ≥20（本机 v24.14）+ Fastify 4
YAML      : yaml (Document/CST API)  ← 关键
Frontmatter: gray-matter
Diff      : diff (jsdiff)
校验       : child_process.execFile → ktx CLI
进程       : concurrently (dev)
测试       : vitest + @testing-library/react + supertest(后端)
```
> 上表为**基线/下限与方向**，不强锁次/补丁版本。M0 lockfile 实际解析为 React 19 / Vite 8 / TypeScript 6 / Fastify 5 / React Router 7。M0 仅验证 health 壳；M1/M2 必须把路由、TanStack Query、react-hook-form/zod 作为兼容性验收点。若出现兼容问题，优先按 lockfile 当前版本修复；只有阻塞时再回退大版本。

## 2. 目标目录骨架

```text
webui/
  README.md                # 产品 MVP 方案（已存在，事实源）
  docs/                    # 本架构交付物
  package.json
  tsconfig.json  tsconfig.node.json
  vite.config.ts           # /api → http://127.0.0.1:5174 proxy
  index.html
  src/
    app/                   # 入口、路由、Provider、布局
    pages/                 # Catalog / TableEditor / JoinEditor / WikiEditor / Review
    components/            # DiffViewer / YamlPreview / StatusBadge / shadcn 封装
    lib/                   # apiClient / types / zod schema / queryKeys
  server/
    index.ts               # Fastify 启动 + 路由 + 错误 envelope
    project.ts             # 项目根解析 / ktx.yaml / 连接&schema 列表
    semantic-layer.ts      # YAML 扫描/读取/就地补丁/序列化
    wiki.ts                # markdown + frontmatter 读写
    ktx.ts                 # ktx CLI 封装 + validate 结果解析
    fs-safe.ts             # 写入网关（白/黑名单 + 防穿越）
    diff.ts                # proposed↔disk diff / git diff
    completion.ts          # 完成度计算（纯函数）
    model.ts               # 共享类型（与 src/lib/types 对齐或共享）
```

## 3. 模块契约

### 3.1 `fs-safe.ts`（写入网关，最高优先级）
```ts
const ALLOW = ['semantic-layer', 'wiki', '.ktx-ui'];
const DENY  = ['.ktx/secrets', 'raw-sources', '.git'];

// 解析+校验，非法路径抛 ForbiddenPathError；返回安全绝对路径
function resolveWritable(projectRoot: string, relPath: string): string;
function safeWrite(projectRoot: string, relPath: string, content: string): void; // 经 resolveWritable
function assertReadable(projectRoot: string, relPath: string): string;           // 拒 secrets
```
规则见 [01 §7]。所有写操作**必须**经 `safeWrite`，禁止模块内直接 `fs.writeFile`。

### 3.2 `semantic-layer.ts`（YAML 就地补丁，核心）
```ts
listSources(projectRoot): SourceSummary[]            // 扫描 _schema/*.yaml，逐表汇总+完成度
readSource(projectRoot, conn, schema, table): { model: TableModel; rawYaml: string }
applyPatch(doc: Document, table: string, patch: TablePatch): Document  // 就地改 CST，不重建
serialize(doc: Document): string                     // doc.toString()，保留注释/顺序/引号
```
**硬约束**：编辑流程为 `parseDocument(file) → 定位 tables[table] 节点 → 在节点上增删改 → toString()`。
- 人工描述写 `descriptions.human`，保留既有 `descriptions.ai`（ADR-03）；
- 不删除模型未覆盖的未知键（ADR-01）；
- `grain/measures/segments` 不写 `_schema/<schema>.yaml`，写 `semantic-layer/<conn>/<source>.yaml` overlay（ADR-10）；
- `role/visibility/tags` 暂不写入正式 YAML：当前 ktx compose 不支持 `visibility`，已有列不能用 overlay 覆盖 `role`。

### 3.3 `ktx.ts`（CLI 封装）
```ts
type ValidationResult = { ok: boolean; exitCode: number; stdout: string; stderr: string; issues?: Issue[] };
validateSource(projectRoot, conn, schema, table): Promise<ValidationResult>;
// 实现：execFile('ktx', ['sl','validate', table, '--connection-id', conn],
//        { cwd: projectRoot, timeout: 60_000 })  ← 无 shell，参数数组
```
> 已确认：`sourceName` 是 ktx 列表里的短 `name`（本项目等于表名，如 `accrual_demo`），不是 `schema.table`，也不要带 `conn/` 前缀。成功退出码 0；找不到 source 或 compose/validate 失败退出码 1。若未来出现同 connection 下重名表，后端必须先检测冲突并拒绝自动 validate。

### 3.4 `diff.ts`
```ts
previewDiff(oldText, newText, filePath): UnifiedDiff   // jsdiff，保存前预览
changedFiles(projectRoot): FileDiff[]                  // git diff --name-status 限定白名单目录
```

### 3.5 `completion.ts`
```ts
computeCompletion(model: TableModel): 'not_started'|'partial'|'done'|'validation_failed'
```
算法见 [04-data-model.md §4]。纯函数，单测覆盖四态边界。

### 3.6 `project.ts`
```ts
resolveProjectRoot(opts): string                      // --project > env > 向上查 ktx.yaml
readProject(root): { root; connections: ConnectionInfo[]; schemas: string[] }
// ConnectionInfo 不含 password 值，仅 { id, driver, passwordSource: 'file'|'inline'|'env' }
```

## 4. 脚手架计划（交给实现者 / 特工队）

> 本架构阶段**不写实现代码**。以下为待执行的初始化步骤清单，作为 M0 第一批任务（见 `codex/wo-M0-scaffold.md`）。

1. `npm init` + 安装上述依赖；配置 `package.json` scripts：
   - `dev` = `concurrently "vite" "tsx watch server/index.ts"`
   - `build` = `vite build`；`start` = `node dist-server/index.js`
2. `vite.config.ts`：`server.proxy['/api'] → http://127.0.0.1:5174`。
3. M0 不初始化 Tailwind/shadcn；M1 首个真实组件再按锁定版本接入样式系统。
4. `server/index.ts` 最小可跑：`/api/health`、`/api/project`、错误 envelope 中间件、`listen 127.0.0.1:5174`。
5. `src/app` 路由壳 + 五个空页面占位。

## 5. 测试策略

| 层 | 工具 | 重点 |
| --- | --- | --- |
| YAML 就地补丁 | vitest | round-trip 不破坏 `"on"` 引号/注释/key 顺序；写 `human` 不动 `ai`；不删未知键 |
| fs-safe | vitest | 白/黑名单、`..` 穿越、符号链接逃逸全部拒绝（安全回归用例） |
| completion | vitest | 四态边界 |
| API | supertest | 错误 envelope 形态；dryRun 不落盘；secrets 路径 403 |
| 前端 | RTL | error envelope 被正确处理（不渲染脏数据，呼应 ADR-09） |
| 端到端冒烟 | 手动/脚本 | 读→编辑→diff→保存→validate 全链路（用 yihe_poc_demo 真实表） |

## 6. 非目标（本规格不覆盖）

登录鉴权、多人协同、云部署、自动 git commit/PR、任意 SQL 控制台、血缘图谱、独立版本历史。

---
_架构设计 by Claude (architect) · 2026-06-15_
