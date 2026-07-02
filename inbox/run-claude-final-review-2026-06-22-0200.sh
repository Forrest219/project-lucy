#!/usr/bin/env zsh
set -u

PROJECT_DIR="/Users/forrest/Projects/project-lucy"
TARGET_MD="$PROJECT_DIR/inbox/ktx-mcp-usage-improvement-plan-2026-06-21.md"
REPORT_MD="$PROJECT_DIR/inbox/claude-final-review-ktx-mcp-usage-2026-06-22-0200.md"
LOG_FILE="$PROJECT_DIR/inbox/claude-final-review-2026-06-22-0200.log"
RUN_AT_LABEL="2026-06-22 02:00:00 Asia/Shanghai"
CLAUDE_BIN="/Users/forrest/.local/bin/claude"

export PATH="/Users/forrest/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$PROJECT_DIR" || exit 1

if [[ "${1:-}" == "--wait" ]]; then
  WAIT_SECONDS="$(python3 - <<'PY'
from datetime import datetime
from zoneinfo import ZoneInfo

target = datetime(2026, 6, 22, 2, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
now = datetime.now(ZoneInfo("Asia/Shanghai"))
print(max(0, int((target - now).total_seconds())))
PY
)"
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] scheduled for $RUN_AT_LABEL; sleeping ${WAIT_SECONDS}s" >> "$LOG_FILE"
  sleep "$WAIT_SECONDS"
fi

STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S %Z %z')"
TMP_OUT="$(mktemp /tmp/claude-final-review-ktx-usage.XXXXXX.md)"
TMP_ERR="$(mktemp /tmp/claude-final-review-ktx-usage.XXXXXX.err)"

PROMPT='请以终审 reviewer 角色，只读审阅 /Users/forrest/Projects/project-lucy/inbox/ktx-mcp-usage-improvement-plan-2026-06-21.md。

请同时参考：
- /Users/forrest/Projects/project-lucy/docs/DEVELOPMENT.md
- /Users/forrest/Projects/project-lucy/docs/project-overview.md
- /Users/forrest/Projects/project-lucy/webui/docs/07-mcp-auth-proxy-spec.md
- /Users/forrest/Documents/my_vault/00_Inbox/ktx_mcp_usage_review_2026-06-21.md
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/mcp/context-tools.ts
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/sl/tools/sl-read-source.tool.ts
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/ingest/tools/warehouse-verification/entity-details.tool.ts
- /Users/forrest/projects/ktx/ktx/packages/cli/src/context/ingest/tools/warehouse-verification/sql-execution.tool.ts

只读审阅，不要修改文件。

请重点判断：
1. 是否仍有把 KTX 上游职责误落到 project-lucy 的风险。
2. A4 proxy cache 的 cache key / ACL / audit 约束是否足够防止跨权限泄漏。
3. A2 运行时约定是否可能牺牲数据问答正确性。
4. 是否应把 A4 先写成 ADR，再进入代码实现。
5. 是否遗漏了现有 webui/server/proxy 或 eval 框架已支持的能力。

输出格式必须包含：
1. 总体结论：通过 / 有条件通过 / 不通过。
2. Findings：按严重程度列出问题，每条包含文档位置、问题、建议修改。
3. 共识与争议矩阵：逐项评价 A0、A1、A2、A3、A4、A5 以及“不建议做的事”。
   - 对你接受且 Codex 临时自审也接受的内容，标记为【双方接受，可进入开发/前置活动】。
   - 对你反对、要求重大修改，或与 Codex 临时自审不一致的内容，标记为【有争议，待 Forrest 仲裁】。
   - 对可以做但必须先补 ADR/计划/人工确认的内容，标记为【有条件接受，先补前置条件】。
4. 最终开发闸门：列出哪些事项可以进入开发、哪些必须留给 Forrest 仲裁。
5. 如果无阻塞问题，请给出可落盘的简短修订建议。'

{
  echo "[$STARTED_AT] starting Claude Code Opus final review"
  echo "target: $TARGET_MD"
} >> "$LOG_FILE"

"$CLAUDE_BIN" -p --model opus --permission-mode bypassPermissions \
  --add-dir /Users/forrest/Documents/my_vault/00_Inbox \
  --output-format text "$PROMPT" > "$TMP_OUT" 2> "$TMP_ERR"
STATUS=$?
ENDED_AT="$(date '+%Y-%m-%d %H:%M:%S %Z %z')"

{
  echo "# Claude Code Opus 终审记录"
  echo
  echo "| 项 | 值 |"
  echo "|---|---|"
  echo "| 计划执行时间 | $RUN_AT_LABEL |"
  echo "| 实际开始时间 | $STARTED_AT |"
  echo "| 实际结束时间 | $ENDED_AT |"
  echo "| 退出码 | $STATUS |"
  echo "| 目标文档 | $TARGET_MD |"
  echo
  if [[ "$STATUS" -eq 0 ]]; then
    cat "$TMP_OUT"
  else
    echo "## 终审失败"
    echo
    echo "Claude Code 未能完成终审，错误输出如下："
    echo
    echo '```text'
    cat "$TMP_ERR"
    echo '```'
    echo
    echo "建议：额度或外部状态恢复后，重跑本脚本："
    echo
    echo '```bash'
    echo "zsh $PROJECT_DIR/inbox/run-claude-final-review-2026-06-22-0200.sh"
    echo '```'
  fi
} > "$REPORT_MD"

{
  echo
  echo "---"
  echo
  echo "## 9. Claude Code Opus 终审结果（自动追加）"
  echo
  echo "| 项 | 值 |"
  echo "|---|---|"
  echo "| 计划执行时间 | $RUN_AT_LABEL |"
  echo "| 实际开始时间 | $STARTED_AT |"
  echo "| 实际结束时间 | $ENDED_AT |"
  echo "| 退出码 | $STATUS |"
  echo "| 完整终审记录 | \`inbox/claude-final-review-ktx-mcp-usage-2026-06-22-0200.md\` |"
  echo
  if [[ "$STATUS" -eq 0 ]]; then
    echo "Claude Code Opus 终审已完成。以下为终审原文："
    echo
    cat "$TMP_OUT"
  else
    echo "Claude Code Opus 终审未完成。错误输出："
    echo
    echo '```text'
    cat "$TMP_ERR"
    echo '```'
  fi
} >> "$TARGET_MD"

{
  echo "[$ENDED_AT] finished with status $STATUS"
  echo "report: $REPORT_MD"
} >> "$LOG_FILE"

rm -f "$TMP_OUT" "$TMP_ERR"
exit "$STATUS"
