#!/usr/bin/env bash
# 安装 Lucy 本机夜间任务（commit / pull+push / 平滑升级）的 launchd LaunchAgent。
#
# 默认：只把渲染后的 plist 写到 ~/Library/LaunchAgents/，不注册。
#   bash scripts/launchd/install-nightly-sync-upgrade-launchd.sh --bootstrap   # 写入并注册
#   bash scripts/launchd/install-nightly-sync-upgrade-launchd.sh --uninstall   # 注销并删除 plist
#
# 环境变量：
#   LUCY_NIGHTLY_LAUNCHD_LABEL   默认 com.lucy.nightly-sync-upgrade
#   LUCY_NIGHTLY_LAUNCHD_HOUR    默认 3
#   LUCY_NIGHTLY_LAUNCHD_MINUTE  默认 0
#   LUCY_NIGHTLY_LOG_DIR         默认 ~/Library/Logs/lucy-nightly
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${LUCY_NIGHTLY_LAUNCHD_LABEL:-com.lucy.nightly-sync-upgrade}"
HOUR="${LUCY_NIGHTLY_LAUNCHD_HOUR:-3}"
MINUTE="${LUCY_NIGHTLY_LAUNCHD_MINUTE:-0}"
LOG_DIR="${LUCY_NIGHTLY_LOG_DIR:-$HOME/Library/Logs/lucy-nightly}"
PLIST_TEMPLATE="$ROOT/scripts/launchd/com.lucy.nightly-sync-upgrade.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI_DOMAIN="gui/$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

render_plist() {
  sed \
    -e "s|__LABEL__|$LABEL|g" \
    -e "s|__ROOT__|$ROOT|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    -e "s|__HOUR__|$HOUR|g" \
    -e "s|__MINUTE__|$MINUTE|g" \
    "$PLIST_TEMPLATE" > "$PLIST_DEST"
  plutil -lint "$PLIST_DEST"
}

case "${1:-}" in
  "")
    render_plist
    echo "Plist written: $PLIST_DEST (NOT bootstrapped; re-run with --bootstrap)"
    ;;
  --bootstrap)
    render_plist
    launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "$GUI_DOMAIN" "$PLIST_DEST"
    launchctl enable "$GUI_DOMAIN/$LABEL"
    echo "Bootstrapped $LABEL; daily at $(printf '%02d:%02d' "$HOUR" "$MINUTE")"
    echo "Run now: launchctl kickstart $GUI_DOMAIN/$LABEL   Logs: $LOG_DIR"
    ;;
  --uninstall)
    launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST_DEST"
    echo "Uninstalled $LABEL"
    ;;
  -h|--help)
    sed -n '2,13p' "$0"
    ;;
  *)
    echo "usage: $0 [--bootstrap|--uninstall|--help]" >&2
    exit 64
    ;;
esac
