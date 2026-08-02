#!/usr/bin/env bash
# 安装 Lucy 定时截图库的 launchd 任务。
#
# 关联文档：docs/webui-snapshot-product.md §7（调度接口契约）、§11 验收 #10
#
# 默认行为（符合 spec "不要擅自 bootstrap"）：
#   - 只把 plist 写到 ~/Library/LaunchAgents/，不注册。
#   - 提示用户用 launchctl bootstrap 自行启用。
#
# 显式注册（用户明确要求执行安装时）：
#   bash scripts/install-snapshot-product-launchd.sh --bootstrap
#   这条命令会先 bootout（如果旧任务在）再 bootstrap（注册到 launchd gui session）。
#
# 卸载：
#   bash scripts/install-snapshot-product-launchd.sh --uninstall
#   会 bootout 并删除 plist。
#
# 环境变量（可覆盖默认）：
#   LUCY_SNAPSHOT_LAUNCHD_LABEL    默认 com.lucy.snapshot-product
#   LUCY_SNAPSHOT_LAUNCHD_HOUR     默认 2
#   LUCY_SNAPSHOT_LAUNCHD_MINUTE   默认 10
#   LUCY_SNAPSHOT_BASE_URL         默认 http://127.0.0.1:5174
#   LUCY_SNAPSHOT_OUTPUT_DIR       默认 var/screenshots
#   LUCY_SNAPSHOT_NODE_BIN         默认 /usr/bin/env node

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="${LUCY_SNAPSHOT_LAUNCHD_LABEL:-com.lucy.snapshot-product}"
HOUR="${LUCY_SNAPSHOT_LAUNCHD_HOUR:-2}"
MINUTE="${LUCY_SNAPSHOT_LAUNCHD_MINUTE:-10}"
BASE_URL="${LUCY_SNAPSHOT_BASE_URL:-http://127.0.0.1:5174}"
OUTPUT_DIR="${LUCY_SNAPSHOT_OUTPUT_DIR:-var/screenshots}"
NODE_BIN="${LUCY_SNAPSHOT_NODE_BIN:-/usr/bin/env node}"
PLIST_TEMPLATE="$ROOT/scripts/launchd/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI_DOMAIN="gui/$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/var/logs"

if [[ ! -f "$PLIST_TEMPLATE" ]]; then
  echo "ERROR: plist template not found at $PLIST_TEMPLATE" >&2
  echo "  Expected to be the reviewer-auditable plist (see docs/webui-snapshot-product.md §11 #10)." >&2
  exit 1
fi

render_plist() {
  # 在模板上做 8 处替换。NODE_BIN 路径里若含 & 需要先 escape。
  local esc_node_bin
  esc_node_bin=$(printf '%s' "$NODE_BIN" | sed 's/[&|]/\\&/g')
  sed \
    -e "s|__LABEL__|$LABEL|g" \
    -e "s|__ROOT__|$ROOT|g" \
    -e "s|__BASE_URL__|$BASE_URL|g" \
    -e "s|__OUTPUT_DIR__|$OUTPUT_DIR|g" \
    -e "s|__HOUR__|$HOUR|g" \
    -e "s|__MINUTE__|$MINUTE|g" \
    -e "s|__NODE_BIN__|$esc_node_bin|g" \
    "$PLIST_TEMPLATE" > "$PLIST_DEST"
}

usage() {
  cat <<USAGE
用法：bash scripts/install-snapshot-product-launchd.sh [--bootstrap|--uninstall|--help]

默认（无参数）：把 plist 写到 $PLIST_DEST，不注册到 launchd。
                适合 reviewer 审查与人工 rerun 场景。

  --bootstrap   在写 plist 之后，立即 launchctl bootstrap/ enable 把它注册到
                $GUI_DOMAIN（用户显式要求时才跑这条）。
  --uninstall   launchctl bootout + 删除 plist + enable --off。
  --help        打印本说明。

环境变量：见脚本顶部注释。
USAGE
}

case "${1:-}" in
  "")
    render_plist
    echo "Plist written: $PLIST_DEST"
    echo "NOT bootstrapped. To register with launchd, re-run with --bootstrap:"
    echo "  bash scripts/install-snapshot-product-launchd.sh --bootstrap"
    echo "Schedule (from plist): daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE")"
    echo "Run now (after bootstrap): launchctl kickstart -k $GUI_DOMAIN/$LABEL"
    ;;
  --bootstrap)
    render_plist
    launchctl bootout "$GUI_DOMAIN" "$PLIST_DEST" >/dev/null 2>&1 || true
    launchctl bootstrap "$GUI_DOMAIN" "$PLIST_DEST"
    launchctl enable "$GUI_DOMAIN/$LABEL"
    echo "Bootstrapped $LABEL at $PLIST_DEST"
    echo "Schedule: daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE")"
    echo "Run now: launchctl kickstart -k $GUI_DOMAIN/$LABEL"
    ;;
  --uninstall)
    if [[ -f "$PLIST_DEST" ]]; then
      launchctl bootout "$GUI_DOMAIN" "$PLIST_DEST" >/dev/null 2>&1 || true
      launchctl disable "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
      rm -f "$PLIST_DEST"
      echo "Uninstalled $LABEL and removed $PLIST_DEST"
    else
      echo "Nothing to uninstall: $PLIST_DEST does not exist."
    fi
    ;;
  --help|-h)
    usage
    ;;
  *)
    usage
    exit 64
    ;;
esac
