# 05 · 任务拆分与里程碑

按里程碑组织，每项含验收标准。可直接交 Mulan 特工队执行。
依赖关系：M0 → M1 → M2 → M3 →（M4 / M5 可并行）。

## M0 · 脚手架与基础设施
- [ ] T0.1 `npm init` + 依赖安装（见 [02 §1]），配置 scripts（dev/build/start）
- [ ] T0.2 `vite.config.ts` proxy `/api → 127.0.0.1:5174`；M0 使用 vanilla CSS，不初始化 Tailwind/shadcn
- [ ] T0.3 Fastify 最小骨架：错误 envelope 中间件、`GET /api/health`、`listen 127.0.0.1`
- [ ] T0.4 `fs-safe.ts` + 安全单测（白/黑名单、`..` 穿越、符号链接逃逸全拒）
- **验收**：`npm run dev` 起前后端；`/api/health` 通；fs-safe 安全用例全绿

## M1 · 基础壳与只读目录
- [ ] T1.1 `project.ts`：项目根解析 + 读 `ktx.yaml`（剥离 password）→ `GET /api/project`
- [ ] T1.2 `semantic-layer.ts` 扫描 + `completion.ts` → `GET /api/sources`
- [ ] T1.3 `readSource`（parseDocument→规范化）→ `GET /api/sources/:conn/:schema/:table`
- [ ] T1.4 前端 Catalog 页：列表 + connection/schema 过滤 + 表名/字段名搜索 + 状态筛选
- [ ] T1.5 前端单表只读详情 + YAML preview
- **验收**：能列出 3 张 dataforai 真实表、搜索筛选、打开只读单表；不展示任何 secrets

## M2 · 单表编辑与 diff
- [ ] T2.1 `applyPatch` 就地补丁 + `serialize`；round-trip 单测（保 `"on"`/注释/顺序/未知键）
- [ ] T2.2 `diff.ts previewDiff` + `PUT ...?dryRun=true` 返回 diff/proposedYaml
- [ ] T2.3 Table Editor 三栏布局（导航 / 表单 / preview+diff）
- [ ] T2.4 表描述、字段描述编辑（写 `descriptions.human`，保留 `ai`）
- [ ] T2.5 grain 编辑：写入 `semantic-layer/<conn>/<table>.yaml` overlay（ADR-10 已探测），保存后 validate
- **验收**：编辑后实时 diff；dryRun 不落盘；human 描述不覆盖 ai

## M3 · 保存与 validate
- [ ] T3.1 `PUT ...?dryRun=false` 经 fs-safe 写回
- [ ] T3.2 `ktx.ts validateSource`（execFile）+ `POST .../validate`
- [ ] T3.3 写后自动 validate，返回 `changedFiles`
- [ ] T3.4 Review & Validate 页：改动文件列表 + 文件级 diff + 一键校验 + 建议 git 命令（不自动提交）
- **验收**：保存→落盘→validate 全链路通；Review 页显示本次改动；secrets/raw-sources 写入被拒

## M4 · Measures / Segments / Joins
> 前置：spike 验证 yaml Document API 增删嵌套节点。ADR-10 已确认 `measures/segments` 写 overlay 可被 ktx 合并；不要写 `_schema`。
- [ ] T4.1 measures 表单 + 写入 `semantic-layer/<conn>/<table>.yaml` overlay
- [ ] T4.2 segments 表单 + 写入 `semantic-layer/<conn>/<table>.yaml` overlay
- [ ] T4.3 Join Editor：展示现有 joins、字段名候选提示、关系类型、可信度标记
- [ ] T4.4 candidate/rejected → `.ktx-ui/join-candidates.json` sidecar；confirmed 才写正式 YAML
- **验收**：confirmed join 进 YAML 且 validate 通过；candidate 只进 sidecar

## M5 · Wiki Editor
- [ ] T5.1 `wiki.ts` 扫描 + frontmatter 解析 → `GET /api/wiki`、`/api/wiki/:key`
- [ ] T5.2 frontmatter（summary/tags/sl_refs/refs/usage_mode）+ markdown 编辑 + dryRun diff
- [ ] T5.3 `PUT /api/wiki/:key` 经 fs-safe 写 `wiki/`；支持创建 `wiki/global/*.md`
- [ ] T5.4 从 Table Editor 一键创建关联 wiki
- **验收**：能创建/编辑 wiki、frontmatter 正确、仅写 `wiki/`

## 总验收（对齐原 README §验收标准）
1. 读取真实 semantic sources ✔  2. 承载 ~300 表目录 ✔  3. 搜索/筛选/打开单表 ✔
4. 编辑描述/grain/measures/segments/joins ✔；字段 `role/visibility` 暂只读或草稿，不落盘  5. 保存回 YAML ✔
6. 保存前显示 diff ✔  7. 保存后 `ktx sl validate` ✔  8. 创建/编辑 `wiki/global/*.md` ✔
9. 不读/不展示 `.ktx/secrets` ✔  10. 不写 `raw-sources` ✔  11. git diff 可见改动 ✔

## 建议执行方式
走 `/mulan-task-force`，按 M0→M5 串行交付，每个里程碑产出可验收增量。
M4/M5 启动前先做 Document API spike；ADR-10 的 ktx schema 探测已完成。

---
_架构设计 by Claude (architect) · 2026-06-15_
