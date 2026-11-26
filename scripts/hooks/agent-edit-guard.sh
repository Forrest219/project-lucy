#!/usr/bin/env bash
# Shared PreToolUse (Edit|Write) guard for Claude Code & Codex CLI.
# Compatible with stock macOS bash 3.2 under UTF-8 locales (uses ${file_path}).

set -u

if ! command -v jq >/dev/null 2>&1; then
  echo "[agent-edit-guard] info: jq not installed; skipping hook." >&2
  exit 0
fi

file_path="$(jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
[ -z "${file_path}" ] && exit 0

emit_msg() {
  jq -n --arg msg "$1" '{systemMessage: $msg}'
}

case "${file_path}" in
  */CLAUDE.md|*/AGENTS.md|*/ktx.yaml|*/semantic-layer/*)
    emit_msg "⚠️ 修改 ${file_path} 属于治理文件（CLAUDE.md/AGENTS.md/ktx.yaml/semantic-layer），按 docs/governance/DEVELOPMENT.md 应先走 Plan Mode（EnterPlanMode）。"
    ;;
  */webui/server/proxy/*|*/webui/config/data-qa-instructions.md)
    emit_msg "⚠️ 修改 MCP Proxy 热路径（${file_path}）：请先核对错题本 docs/lessons/ 中 2026-11-16（歧义门闩纯 MCP 逃生）、2026-11-19（零绑定 begin）、2026-11-22（预算粘连隔离）与 2026-11-23（握手延迟），确保主路径可用性优先且不引入同步阻塞。"
    ;;
  */webui/server/admin/audit.ts|*/webui/server/display-snapshot.ts|*/webui/server/admin/agents.ts|*/webui/server/admin/roles.ts|*/webui/server/index.ts|*/webui/server/runtime/*)
    emit_msg "⚠️ 修改稳定性/事件循环高危路径（${file_path}）：请先核对错题本 2026-11-17（禁止启动/轮询全索引同步扫描）、2026-11-20（AbortSignal 真实取消与 MCP 在途排空）与 2026-11-23（写屏障与名册 503）。"
    ;;
  */webui/server/schema-structure*.ts|*/webui/server/catalog-show.ts|*/webui/src/lib/prepareSchemaStructure.ts)
    emit_msg "⚠️ 修改表结构读取/批处理路径（${file_path}）：请先核对错题本 2026-11-13（真实 KTX 拒绝 DESC，替身不得偏宽松）与 2026-11-19（FDE 5 缺陷：禁止单表 deferred 静默假成功与无总账 ID 的 it.skip）。"
    ;;
  */webui/src/app/App.tsx|*/webui/src/pages/admin/Audit.tsx)
    emit_msg "⚠️ 修改前端高危面（${file_path}）：请先核对错题本 2026-11-18（合并行缺字段空值防护与 RouteChunkBoundary 错误分流），文本筛选框须用 useUrlMirroredField 通过 lint:url-driven-input。"
    ;;
  */.github/workflows/*|*/scripts/gates/*|*/deploy/k8s/*)
    emit_msg "⚠️ 修改 CI/门禁/交付配置（${file_path}）：改后请运行 npm run test:ci-workflow-contracts 校验 DAG、ci-required 与 root-test-registry 契约。"
    ;;
esac

exit 0
