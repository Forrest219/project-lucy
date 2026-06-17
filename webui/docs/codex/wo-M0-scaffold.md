# 工单 M0 · 脚手架与安全基座

> 先读 [README.md 总纲](README.md)（环境 + 全局护栏 + DoD），本工单只列增量。

## codex 直投 prompt
```
工作目录：/Users/forrest/Projects/project-lucy/webui（先确认 cwd 切到这里）。
先读 docs/codex/README.md 与 docs/02-arch-spec.md。
任务：完成 M0 脚手架与 fs-safe 安全基座（见本工单）。
约束：严守 docs/codex/README.md §2 全局护栏；写入只经 fs-safe；仅绑 127.0.0.1。
完成后跑 npm test 并贴结果，按 DoD 收尾，然后停下交回，不要继续 M1。
```

## 目标
搭起前后端可跑的最小骨架，并先把**写入安全网关**做扎实——它是后续所有写操作的唯一闸门。

## 必读
`02-arch-spec.md §1(技术栈) §2(目录骨架) §3.1(fs-safe) §4(脚手架计划)`；`01-architecture.md §7(安全模型)`。

## 交付文件
```
package.json  tsconfig.json  tsconfig.node.json  vite.config.ts
index.html  server/index.ts  server/fs-safe.ts  server/project.ts(占位)
src/app/main.tsx  src/app/App.tsx  src/lib/apiClient.ts
server/__tests__/fs-safe.test.ts
```

## 实现步骤
1. `npm init`，装依赖（见 arch-spec §1）：react/vite/ts、fastify、yaml、gray-matter、diff、@tanstack/react-query、react-hook-form、zod、react-router-dom、vitest、supertest、tsx、concurrently。
   - ⚠️ **M0 不引入 Tailwind/shadcn**：M0 只需 health 占位页，使用 vanilla CSS。Tailwind/shadcn 推迟到 M1 首个真实组件；届时按锁定版本一次性接通，避免 M0 留死配置。
2. scripts：`dev`=`concurrently "vite" "tsx watch server/index.ts"`、`build`=`vite build`、`test`=`vitest run`。
3. `vite.config.ts`：`server.proxy['/api'] → http://127.0.0.1:5174`。
4. `server/index.ts`：Fastify + **统一错误 envelope 钩子**（`{ok:false,error:{code,message}}`）+ `GET /api/health` 返回 `{ok:true,data:{status:'ok'}}` + `listen({host:'127.0.0.1',port:5174})`。
5. `server/fs-safe.ts`：按 arch-spec §3.1 实现 `resolveWritable / safeWrite / assertReadable`。白名单 `semantic-layer .ktx-ui wiki`、黑名单 `.ktx/secrets raw-sources .git`；realpath 破符号链接，`path.relative` 含 `..` 即拒。
6. `src/lib/apiClient.ts`：fetch 封装，**先判 `ok===false` 抛错**，再返回 `data`（ADR-09）。
7. `src/app`：最小 React 壳 + 一个调 `/api/health` 的占位页，验证 proxy 通。

## 约束（本里程碑重点）
- fs-safe 是后续唯一写闸，接口要稳定；黑名单优先于白名单。
- 错误 envelope 形态此处定型，后续工单复用。

## 自验
```bash
npm run dev          # 浏览器能见 health 占位页
npm test             # fs-safe 用例全绿
```
fs-safe 必测用例：
- 写 `semantic-layer/x.yaml` ✅；写 `wiki/a.md` ✅；写 `.ktx-ui/b.json` ✅
- 写 `.ktx/secrets/p` ❌；写 `raw-sources/r` ❌；写 `.git/c` ❌
- `semantic-layer/../.ktx/secrets/p`（穿越）❌
- 符号链接指向 secrets ❌
- 读 `.ktx/secrets/**` 经 `assertReadable` ❌

## DoD
> ⚠️ **M0 例外**：总纲 §3 的「真实数据冒烟」自 **M1** 起适用——M0 尚无数据读取能力。M0 的冒烟 = `npm run dev` 起前后端 + `/api/health` 返回 `{ok:true}`。

总纲 §3 其余各项 + 上述 fs-safe 用例全绿 + `npm run dev` 起前后端 + `/api/health` 通。完成后**停下交回**。
