# 工单 M3 · 保存写回与 validate

> 先读 [README.md 总纲](README.md)。依赖：M2 完成。**首次真正落盘**——务必走 fs-safe。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/02-arch-spec.md(§3.3 ktx)、docs/03-api-spec.md。
任务：M3 落盘写回 + ktx sl validate + Review 页（见本工单）。
关键约束：写入只经 fs-safe；ktx 用 execFile 参数数组不用 shell；dryRun 默认 true，必须显式 false 才落盘。
使用已确认的 validate 写法：`ktx sl validate <短表名> --connection-id <conn>`；成功 0，找不到 source / compose 失败 1。
完成后 npm test 贴结果，按 DoD 收尾，停下交回。
```

## 目标
把 M2 的 proposed YAML 安全写回磁盘，写后自动 `ktx sl validate`，并提供 Review 页复盘本次改动。

## 必读
`02-arch-spec.md §3.3(ktx.ts) §3.4(diff)`；`03-api-spec.md`（PUT dryRun:false / validate / diff / validate-changed）；`01-architecture.md §9`（ktx CLI 风险）。

## 交付文件
```
server/ktx.ts              # validateSource(execFile)
server/diff.ts             # 增 changedFiles(git diff 限白名单目录)
src/pages/Review.tsx       # 改动文件列表 + 文件级 diff + 一键校验 + 建议 git 命令
server/__tests__/ktx.test.ts
server/__tests__/api.save.test.ts   # supertest: dryRun 不落盘 / 落盘 / secrets 403
```

## 实现步骤
1. `ktx.ts validateSource`：`execFile('ktx',['sl','validate',table,'--connection-id',conn],{cwd:projectRoot,timeout:60000})`，返回 `{ok,exitCode,stdout,stderr,issues?}`。CLI 不存在 → `KTX_CLI_ERROR`（区别 `VALIDATION_FAILED`）。`table` 是 ktx source 短名，不是 `schema.table`。
2. `PUT ...?dryRun=false`：applyPatch→serialize→**经 `safeWrite` 落盘**→自动 validate→返回 `{written:true,validation,changedFiles}`。**dryRun 默认 true，缺省不落盘。**
3. `diff.ts changedFiles`：`git diff --name-status` 限定 `semantic-layer/ wiki/ .ktx-ui/`；非 git 仓库回退会话写入记录。
4. `POST /api/validate-changed`：对本次会话改动的表批量 validate。
5. Review 页：改动文件列表 + 文件级 diff（DiffViewer 复用）+ 一键校验 + 展示建议命令 `git diff` / `git status`（**不自动提交**）。

## 约束（重点）
- 写盘前必经 fs-safe；写 `.ktx/secrets` / `raw-sources` 必 403。
- ktx 调用用 `execFile`（非 `exec`），杜绝 shell 注入。
- 绝不自动 `git commit` / `git add`。

## 自验
```bash
npm run dev
# 编辑 yihe_poc_demo 某表描述 → Save → 文件落盘 → 自动 validate 通过 → Review 页见改动
git -C /Users/forrest/Projects/project-lucy diff --stat   # 能看到 webui 改动
npm test   # dryRun 不落盘 / 落盘 / secrets 403 / ktx 封装 用例绿
```

## DoD
总纲 §3 全项 + 读→编辑→diff→保存→validate 全链路通 + secrets/raw-sources 写入被拒 + 无自动 commit。完成后**停下交回**。
