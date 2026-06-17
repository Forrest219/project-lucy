# server/

后端模块（Node + Fastify）。模块职责见 `../docs/02-arch-spec.md §3`。
所有写入必须经 `fs-safe.ts`，YAML 编辑用就地补丁（ADR-01）。
