# project-lucy Agent 开发入口

本仓库的开发治理规则见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)。
KTX 数据问答运行时上下文见 [`CLAUDE.md`](CLAUDE.md)（仅供数据问答场景，不含开发规则）。

Vibe coding 双核角色协作（thinker / builder）的角色库见 [`agents/README.md`](agents/README.md)，按需调用，非必经流程。

## 临时文件落位

默认临时文件、一次性审计输出、过程性报告落在仓库根目录 [`inbox/`](inbox/)。
`inbox/` 定位为 tmp 文件夹，进程结束后可随时删除。

项目本身的正式 spec、代码、配置、运行时上下文不属于此约定；这些文件仍按
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) 的落位规则维护。
