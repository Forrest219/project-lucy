# 工单 M5 · Wiki 编辑器

> 先读 [README.md 总纲](README.md)。依赖：M3 完成。可与 M4 并行。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/03-api-spec.md(wiki 端点)。
任务：M5 Wiki 编辑器（扫描/编辑/创建 wiki/**/*.md，含 frontmatter）。
关键约束：仅写 wiki/ 经 fs-safe；frontmatter 用 gray-matter；写前 dryRun diff；key 防穿越。
完成后 npm test 贴结果，按 DoD 收尾，停下交回。
```

## 目标
列出/编辑/创建 `wiki/**/*.md`，支持 frontmatter 与正文编辑，并能从表编辑页一键创建关联 wiki。

## 必读
`03-api-spec.md`（wiki 端点）；`../README.md` Wiki Editor 章节（frontmatter 字段、适用沉淀场景）。

## 交付文件
```
server/wiki.ts             # 扫描 + frontmatter(gray-matter) 读写(经 fs-safe)
src/pages/WikiEditor.tsx
src/components/FrontmatterForm.tsx
server/__tests__/wiki.test.ts
```

## 实现步骤
1. `wiki.ts`：
   - 扫 `wiki/**/*.md` → 列表（key=相对 `wiki/` 路径，如 `global/revenue.md`）。→ `GET /api/wiki`。
   - 读单篇：gray-matter 解析 frontmatter + 正文。→ `GET /api/wiki/:key`。
   - 写：frontmatter（`summary/tags/sl_refs/refs/usage_mode`）+ markdown，经 **fs-safe** 写 `wiki/`，支持 `dryRun` 预览 diff，支持创建 `wiki/global/*.md`。→ `PUT /api/wiki/:key`。
   - `:key` 必须经 fs-safe 防穿越（`../` 拒）。
2. WikiEditor 页：左列表 + 右 FrontmatterForm + markdown 编辑 + dryRun diff + Save。
3. 从 TableEditor 一键创建关联 wiki：预填 `sl_refs` 指向当前表，跳转 WikiEditor。

## 约束（重点）
- 仅写 `wiki/`；`:key` 穿越/绝对路径必拒。
- 写前 dryRun diff，与 YAML 保存体验一致。

## 自验
```bash
npm test   # frontmatter round-trip / key 防穿越 / 仅写 wiki 用例绿
npm run dev
# 新建 wiki/global/revenue.md，填 frontmatter+正文 → diff → 保存落盘
# 从 superstore_orders 表「创建关联 wiki」→ 预填 sl_refs
```

## DoD
总纲 §3 全项 + 能创建/编辑 wiki + frontmatter 正确 + 仅写 wiki/ + key 防穿越已测。完成后**停下交回**。

---

## 🏁 全部里程碑完成后（对齐 README 验收 §400）
1.读真实 sources 2.承载 ~300 表 3.搜索/筛选/打开 4.编辑描述/grain/measures/segments/joins；role/visibility 暂不落盘
5.保存回 YAML 6.保存前 diff 7.保存后 validate 8.创建/编辑 wiki/global 9.不读 secrets 10.不写 raw-sources 11.git diff 可见
