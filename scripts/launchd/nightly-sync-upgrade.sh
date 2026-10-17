#!/usr/bin/env bash
# Lucy 本机夜间任务：①提交未提交改动 ②pull --rebase + push ③平滑升级本机 Docker 中的 Lucy。
#
# 由 launchd 每天 03:00 调用（见 scripts/launchd/com.lucy.nightly-sync-upgrade.plist，
# 安装脚本 scripts/launchd/install-nightly-sync-upgrade-launchd.sh）。
# 升级复用 scripts/demo/rebuild-demo-lucy.sh → scripts/upgrade/upgrade-lucy.sh（保留 /data/lucy、
# preserve 快照校验、健康检查），本脚本只在其外层加：镜像回滚 tag、volume 备份、失败回滚。
#
# 安全约束：
#   - 只 `git add -A`（遵守 .gitignore），提交前对暂存区做密钥扫描（gitleaks 优先，否则正则 + 体积上限），
#     命中即中止提交 / push / 升级；日志只写 文件:行号:规则，不写命中内容。
#   - 不 force push、不 reset --hard、不改写已推送历史；rebase 冲突即 `git rebase --abort` 并停止。
#   - 与其他 agent（Claude Code 等）共用本仓库：存在 index.lock / rebase / merge / cherry-pick 时跳过；
#     有文件在最近 N 分钟内改过时也跳过提交（视为有人正在编辑）。
#   - 同一时刻只允许一个实例（锁目录）。
#   - 兼容 stock macOS bash 3.2（不用 readarray / mapfile / 负数下标 / 关联数组）。
#
# 用法：
#   bash scripts/launchd/nightly-sync-upgrade.sh [--dry-run] [--git-only|--upgrade-only] [--force-upgrade]
#     --dry-run        不改 index、不 commit、不 rebase、不 push、不动容器；只做检查、fetch、push --dry-run
#                      和 Docker 只读预检（Docker 未运行时不启动它）
#     --git-only       只做 ①②
#     --upgrade-only   只做 ③（仍要求工作区干净）
#     --force-upgrade  即使 HEAD 与上次成功升级的提交相同也升级
#
# 环境变量（plist 里可覆盖）：
#   LUCY_NIGHTLY_LOG_DIR            默认 ~/Library/Logs/lucy-nightly
#   LUCY_NIGHTLY_COMPOSE_FILE       默认 deploy/compose/docker-compose.demo.yml（本机在用的 compose 项目 "compose"）
#   LUCY_NIGHTLY_ALLOWED_BRANCHES   空格分隔的分支白名单；空 = 当前检出的任意分支
#   LUCY_NIGHTLY_QUIET_MINUTES      默认 15；有改动文件在这么多分钟内被修改则跳过提交
#   LUCY_NIGHTLY_MAX_FILE_BYTES     默认 5242880（5 MiB）；单个暂存文件超过即中止
#   LUCY_NIGHTLY_MAX_FILES          默认 300；一次暂存文件数超过即中止
#   LUCY_NIGHTLY_DOCKER_TIMEOUT     默认 300 秒；等待 Docker Desktop 就绪
#   LUCY_NIGHTLY_PROXY              默认 http://127.0.0.1:7890；直连失败且该端口在监听时，git 网络操作重试一次走代理
#   LUCY_NIGHTLY_KEEP_BACKUPS       默认 7；inbox/backups/nightly 下保留的 volume 备份数
#   LUCY_NIGHTLY_NOTIFY             默认 1；失败时发 macOS 通知
set -Euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DRY_RUN=0
DO_GIT=1
DO_UPGRADE=1
FORCE_UPGRADE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --git-only) DO_UPGRADE=0 ;;
    --upgrade-only) DO_GIT=0 ;;
    --force-upgrade) FORCE_UPGRADE=1 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
  shift
done

LOG_DIR="${LUCY_NIGHTLY_LOG_DIR:-$HOME/Library/Logs/lucy-nightly}"
COMPOSE_FILE="${LUCY_NIGHTLY_COMPOSE_FILE:-deploy/compose/docker-compose.demo.yml}"
ALLOWED_BRANCHES="${LUCY_NIGHTLY_ALLOWED_BRANCHES:-}"
QUIET_MINUTES="${LUCY_NIGHTLY_QUIET_MINUTES:-15}"
MAX_FILE_BYTES="${LUCY_NIGHTLY_MAX_FILE_BYTES:-5242880}"
MAX_FILES="${LUCY_NIGHTLY_MAX_FILES:-300}"
DOCKER_TIMEOUT="${LUCY_NIGHTLY_DOCKER_TIMEOUT:-300}"
PROXY_URL="${LUCY_NIGHTLY_PROXY:-http://127.0.0.1:7890}"
KEEP_BACKUPS="${LUCY_NIGHTLY_KEEP_BACKUPS:-7}"
NOTIFY="${LUCY_NIGHTLY_NOTIFY:-1}"
BACKUP_REL="inbox/backups/nightly"
STATE_FILE="$LOG_DIR/last-upgraded-commit"
LOCK_DIR="$LOG_DIR/.lock"
GIT_DIR_ABS="$(git rev-parse --absolute-git-dir)"
TODAY="$(date +%Y-%m-%d)"

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/nightly-$(date +%Y%m%d-%H%M%S)$([ "$DRY_RUN" -eq 1 ] && echo -dryrun).log"
if [ -t 1 ]; then
  exec > >(tee -a "$LOG_FILE") 2>&1
else
  exec >>"$LOG_FILE" 2>&1
fi

log() { printf '%s [nightly] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"; }
notify() {
  [ "$NOTIFY" = "1" ] || return 0
  [ "$DRY_RUN" -eq 1 ] && return 0
  /usr/bin/osascript -e "display notification \"$1\" with title \"Lucy nightly\"" >/dev/null 2>&1 || true
}
finish() {
  # $1 exit code, $2 summary
  log "RESULT exit=$1 $2"
  log "log file: $LOG_FILE"
  exit "$1"
}

# ---------- lock ----------
if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo $$ >"$LOCK_DIR/pid"
else
  old_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    log "SKIP another nightly run is active (pid $old_pid)"
    exit 0
  fi
  log "stale lock (pid ${old_pid:-?}) removed"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" && echo $$ >"$LOCK_DIR/pid"
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

# Keep 30 days of logs.
find "$LOG_DIR" -maxdepth 1 -name 'nightly-*.log' -mtime +30 -exec rm -f {} + 2>/dev/null || true

log "start root=$ROOT dry_run=$DRY_RUN git=$DO_GIT upgrade=$DO_UPGRADE force_upgrade=$FORCE_UPGRADE"

# ---------- helpers ----------
git_busy_reason() {
  [ -e "$GIT_DIR_ABS/index.lock" ] && { echo "index.lock present"; return 0; }
  [ -d "$GIT_DIR_ABS/rebase-merge" ] && { echo "rebase in progress"; return 0; }
  [ -d "$GIT_DIR_ABS/rebase-apply" ] && { echo "rebase/am in progress"; return 0; }
  [ -e "$GIT_DIR_ABS/MERGE_HEAD" ] && { echo "merge in progress"; return 0; }
  [ -e "$GIT_DIR_ABS/CHERRY_PICK_HEAD" ] && { echo "cherry-pick in progress"; return 0; }
  [ -e "$GIT_DIR_ABS/REVERT_HEAD" ] && { echo "revert in progress"; return 0; }
  [ -e "$GIT_DIR_ABS/BISECT_LOG" ] && { echo "bisect in progress"; return 0; }
  return 1
}

proxy_listening() {
  local hostport="${PROXY_URL#*://}"
  local port="${hostport##*:}"
  port="${port%%/*}"
  /usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# Run a git network command; on failure retry once through the local proxy if it is listening.
git_net() {
  if git "$@"; then return 0; fi
  # A conflict is not a network error: never retry while a rebase/merge is stopped.
  if git_busy_reason >/dev/null; then return 1; fi
  if [ -n "$PROXY_URL" ] && proxy_listening; then
    log "git $1 failed direct; retrying via local proxy"
    git -c http.proxy="$PROXY_URL" -c https.proxy="$PROXY_URL" "$@"
    return $?
  fi
  return 1
}

# Secret scan of what is staged in the index given by GIT_INDEX_FILE (or the real index).
# Prints findings as "path:line:rule" (never the matched text). Returns 1 if anything is flagged.
secret_scan_staged() {
  local flagged=0 tmp names count
  tmp="$(mktemp -t lucy-nightly-scan)"
  names="$(git diff --cached --name-only --diff-filter=ACMR)"
  count="$(printf '%s\n' "$names" | grep -c . || true)"
  if [ "$count" -gt "$MAX_FILES" ]; then
    log "SCAN too many staged files: $count > $MAX_FILES"
    flagged=1
  fi

  # 1) file names / paths
  printf '%s\n' "$names" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    base="${f##*/}"
    case "$base" in
      .env.example|.env.sample|.env.template|*.example|*.example.*) continue ;;
    esac
    if printf '%s\n' "$base" | LC_ALL=C grep -Eiq '^\.env(\..*)?$|\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn)$|^id_(rsa|dsa|ecdsa|ed25519)|^\.git-credentials$|^credentials(\.json)?$|\.tokens|secret|password|passwd'; then
      echo "$f:0:sensitive-filename"
    elif printf '%s\n' "$f" | LC_ALL=C grep -Eq '(^|/)secrets/|(^|/)\.ktx/secrets|(^|/)\.cursor/mcp\.json$'; then
      echo "$f:0:sensitive-path"
    fi
  done >>"$tmp"

  # 2) sizes (blob size in the index)
  printf '%s\n' "$names" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    sha="$(git ls-files -s -- ":(literal)$f" | awk '{print $2; exit}')"
    [ -n "$sha" ] || continue
    size="$(git cat-file -s "$sha" 2>/dev/null || echo 0)"
    if [ "$size" -gt "$MAX_FILE_BYTES" ]; then
      echo "$f:0:file-too-large(${size}B)"
    fi
  done >>"$tmp"

  # 3) content: gitleaks if available, else regex over added lines
  if command -v gitleaks >/dev/null 2>&1; then
    if ! gitleaks protect --staged --redact --no-banner >/dev/null 2>&1; then
      if ! gitleaks git --staged --pre-commit --redact --no-banner >/dev/null 2>&1; then
        echo "(staged):0:gitleaks-finding(run 'gitleaks protect --staged --redact -v' to inspect)" >>"$tmp"
      fi
    fi
  fi
  local added
  added="$(mktemp -t lucy-nightly-added)"
  git diff --cached -U0 --no-color --no-ext-diff --diff-filter=ACMR | LC_ALL=C awk '
    /^\+\+\+ / { f=$0; sub(/^\+\+\+ (b\/)?/, "", f); next }
    /^@@ / { split($3, a, ","); ln=substr(a[1], 2) + 0; next }
    /^\+/ { printf "%s\t%d\t%s\n", f, ln, substr($0, 2); ln++; next }
  ' >"$added"
  scan_rule() {
    # $1 rule name, $2 ERE, $3 flags for grep (e.g. -i)
    LC_ALL=C cut -f3- "$added" | LC_ALL=C grep -nE $3 -- "$2" | cut -d: -f1 | while read -r n; do
      line="$(sed -n "${n}p" "$added" | cut -f1,2 | tr '\t' ':')"
      echo "$line:$1"
    done >>"$tmp"
  }
  scan_rule private-key '-----BEGIN [A-Z ]*PRIVATE KEY' ''
  scan_rule aws-access-key 'A(KIA|SIA)[0-9A-Z]{16}' ''
  scan_rule github-token '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}' ''
  scan_rule api-key-sk 'sk-(ant-|proj-|live-)?[A-Za-z0-9_-]{20,}' ''
  scan_rule slack-token 'xox[abprs]-[A-Za-z0-9-]{10,}' ''
  scan_rule google-api-key 'AIza[0-9A-Za-z_-]{35}' ''
  scan_rule bearer-token '[Bb]earer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}' ''
  scan_rule jwt 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.' ''
  scan_rule url-credentials '[a-z][a-z0-9+.-]*://[^/:@[:space:]]+:[^/@[:space:]]+@' ''
  local SQ="'"
  scan_rule key-value-secret "(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|app[_-]?secret)[\"${SQ}]?[[:space:]]*[:=][[:space:]]*[\"${SQ}]?[^[:space:]\"${SQ}\$<{(]{8,}" '-i'
  scan_rule cjk-credential '(密码|口令|密钥|账号密码|令牌)[[:space:]]*(:|：|=)' ''
  rm -f "$added"

  if [ -s "$tmp" ]; then
    flagged=1
    log "SCAN flagged $(wc -l <"$tmp" | tr -d ' ') item(s) (content not printed):"
    sort -u "$tmp" | sed 's/^/  - /'
  fi
  rm -f "$tmp"
  return "$flagged"
}

# ---------- step 1+2: git ----------
GIT_OK=1   # upgrade is gated on this
git_step() {
  local branch reason upstream up_remote up_branch ahead behind changed recent
  branch="$(git symbolic-ref --quiet --short HEAD || true)"
  if [ -z "$branch" ]; then
    log "SKIP git: detached HEAD"; GIT_OK=0; return 0
  fi
  if [ -n "$ALLOWED_BRANCHES" ]; then
    case " $ALLOWED_BRANCHES " in
      *" $branch "*) ;;
      *) log "SKIP git: branch '$branch' not in LUCY_NIGHTLY_ALLOWED_BRANCHES"; GIT_OK=0; return 0 ;;
    esac
  fi
  if reason="$(git_busy_reason)"; then
    log "SKIP git: $reason (another agent may be working)"; GIT_OK=0; return 0
  fi
  log "branch=$branch head=$(git rev-parse --short HEAD)"

  # --- 1) commit ---
  changed="$(git status --porcelain --untracked-files=all)"
  if [ -z "$changed" ]; then
    log "commit: working tree clean, nothing to commit"
  else
    log "commit: $(printf '%s\n' "$changed" | grep -c .) changed path(s):"
    printf '%s\n' "$changed" | sed 's/^/  /'
    recent=""
    [ "$QUIET_MINUTES" -gt 0 ] 2>/dev/null && recent="$( { git ls-files -m; git ls-files -o --exclude-standard; } | sort -u | while IFS= read -r f; do
      [ -e "$f" ] && find "$f" -maxdepth 0 -mmin -"$QUIET_MINUTES" 2>/dev/null
    done | head -5)"
    if [ -n "$recent" ]; then
      log "SKIP git: files modified within ${QUIET_MINUTES} min (someone is editing):"
      printf '%s\n' "$recent" | sed 's/^/  /'
      GIT_OK=0; return 0
    fi
    # Stage into a throwaway copy of the index and scan it first, so a flagged run
    # never touches the real index (nothing staged, nothing reset).
    local tmp_index scan_ok n_files
    tmp_index="$(mktemp -t lucy-nightly-index)"
    cp "$GIT_DIR_ABS/index" "$tmp_index"
    scan_ok=0
    if GIT_INDEX_FILE="$tmp_index" git add -A && GIT_INDEX_FILE="$tmp_index" secret_scan_staged; then
      scan_ok=1
    fi
    n_files="$(GIT_INDEX_FILE="$tmp_index" git diff --cached --name-only | grep -c . || true)"
    rm -f "$tmp_index"
    if [ "$scan_ok" -ne 1 ]; then
      log "ABORT commit/push/upgrade: secret scan flagged changes; nothing staged or committed"
      notify "secret scan blocked nightly commit"
      GIT_OK=0
      [ "$DRY_RUN" -eq 1 ] && return 0
      return 1
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      log "DRY-RUN would commit: chore(nightly): auto-commit $TODAY ($n_files file(s)); secret scan clean"
    else
      if reason="$(git_busy_reason)"; then
        log "SKIP git: $reason appeared during scan"; GIT_OK=0; return 0
      fi
      git add -A || { log "ERROR git add failed"; GIT_OK=0; return 1; }
      if git diff --cached --quiet; then
        log "commit: nothing staged after add"
      else
        git commit -q -m "chore(nightly): auto-commit $TODAY" \
          -m "Automated by scripts/launchd/nightly-sync-upgrade.sh on $(hostname -s)." \
          || { log "ERROR git commit failed (changes left staged)"; GIT_OK=0; return 1; }
        log "committed $(git rev-parse --short HEAD) ($n_files file(s))"
      fi
    fi
  fi

  if [ "$DRY_RUN" -eq 0 ] && [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    log "STOP: working tree not clean after commit; no pull/push"
    GIT_OK=0; return 1
  fi

  # --- 2) pull --rebase + push ---
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || upstream=""
  if [ -n "$upstream" ]; then
    up_remote="${upstream%%/*}"; up_branch="${upstream#*/}"
  else
    up_remote="origin"; up_branch="$branch"
  fi
  if [ "$up_remote" != "origin" ]; then
    log "SKIP pull/push: upstream remote is '$up_remote', only origin is handled"; GIT_OK=0; return 0
  fi
  if [ "$up_branch" != "$branch" ]; then
    # e.g. a topic branch created from origin/main tracks main; never auto-push it onto another branch.
    log "SKIP pull/push: branch '$branch' tracks differently named 'origin/$up_branch'"; GIT_OK=0; return 0
  fi
  log "remote target: origin/$up_branch (upstream: ${upstream:-none})"

  git_net fetch --quiet origin || { log "ERROR git fetch failed"; GIT_OK=0; return 1; }
  if git show-ref --verify --quiet "refs/remotes/origin/$up_branch"; then
    set -- $(git rev-list --left-right --count "HEAD...origin/$up_branch")
    ahead="$1"; behind="$2"
    log "vs origin/$up_branch: ahead=$ahead behind=$behind"
    if [ "$behind" -gt 0 ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        log "DRY-RUN would: git pull --rebase origin $up_branch"
      else
        if ! git_net pull --rebase --no-autostash --quiet origin "$up_branch"; then
          if [ -d "$GIT_DIR_ABS/rebase-merge" ] || [ -d "$GIT_DIR_ABS/rebase-apply" ]; then
            git rebase --abort || true
            log "ABORT: rebase conflict on origin/$up_branch; rebase aborted, nothing pushed"
          else
            log "ABORT: git pull --rebase failed; nothing pushed"
          fi
          notify "git pull --rebase failed"
          GIT_OK=0; return 1
        fi
        log "pulled; head=$(git rev-parse --short HEAD)"
        set -- $(git rev-list --left-right --count "HEAD...origin/$up_branch")
        ahead="$1"
      fi
    fi
  else
    ahead="new-branch"
    log "origin/$up_branch does not exist yet; no pull"
  fi

  if [ "$ahead" = "0" ]; then
    log "push: nothing to push"
  else
    if [ -n "$upstream" ]; then
      push_args="origin HEAD:refs/heads/$up_branch"
    else
      push_args="-u origin $branch"
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      log "DRY-RUN would: git push $push_args (checking with push --dry-run, no -u)"
      git_net push --dry-run origin "HEAD:refs/heads/$up_branch" || { log "WARN push --dry-run failed"; GIT_OK=0; }
    else
      # never --force; a non-fast-forward rejection just fails
      git_net push $push_args || { log "ERROR git push failed"; notify "git push failed"; GIT_OK=0; return 1; }
      log "pushed to origin/$up_branch"
    fi
  fi
  return 0
}

# ---------- step 3: docker upgrade ----------
docker_ready() { docker info >/dev/null 2>&1; }

ensure_docker() {
  if docker_ready; then return 0; fi
  if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN Docker daemon not running; real run would 'open -a Docker' and wait up to ${DOCKER_TIMEOUT}s"
    return 1
  fi
  log "starting Docker Desktop (open -a Docker), timeout ${DOCKER_TIMEOUT}s"
  /usr/bin/open -a Docker || { log "ERROR open -a Docker failed"; return 1; }
  local waited=0
  while [ "$waited" -lt "$DOCKER_TIMEOUT" ]; do
    if docker_ready; then log "Docker ready after ${waited}s"; return 0; fi
    sleep 5; waited=$((waited + 5))
  done
  log "ERROR Docker not ready after ${DOCKER_TIMEOUT}s"
  return 1
}

health_port() {
  case "$COMPOSE_FILE" in
    *demo*) echo "${LUCY_DEMO_WEBUI_HOST_PORT:-55176}" ;;
    *) echo "${LUCY_WEBUI_HOST_PORT:-5174}" ;;
  esac
}

wait_health() {
  local url="http://127.0.0.1:$(health_port)/api/health" i=0
  while [ "$i" -lt 120 ]; do
    if curl -fsS --max-time 3 "$url" 2>/dev/null | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true|"status"[[:space:]]*:[[:space:]]*"ok"'; then
      return 0
    fi
    sleep 2; i=$((i + 2))
  done
  return 1
}

upgrade_step() {
  local head last image repo rollback_tag was_running services upgrade_cmd rc
  head="$(git rev-parse HEAD)"
  last="$(cat "$STATE_FILE" 2>/dev/null || true)"
  if [ "$FORCE_UPGRADE" -eq 0 ] && [ "$head" = "$last" ]; then
    log "SKIP upgrade: HEAD $(git rev-parse --short HEAD) already deployed by a previous nightly run"
    return 0
  fi
  if [ ! -f "$COMPOSE_FILE" ]; then
    log "ERROR compose file not found: $COMPOSE_FILE"; return 1
  fi
  ensure_docker || return 1

  local cfg
  cfg="$(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null)" || { log "ERROR docker compose config failed"; return 1; }
  image="$(printf '%s' "$cfg" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write((j.services.lucy&&j.services.lucy.image)||"")})')"
  services="$(printf '%s' "$cfg" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(Object.keys(JSON.parse(s).services).join(" "))})')"
  [ -n "$image" ] || { log "ERROR cannot resolve lucy image from $COMPOSE_FILE"; return 1; }
  repo="${image%:*}"
  rollback_tag="$repo:nightly-rollback"
  was_running="$(docker compose -f "$COMPOSE_FILE" ps --status running --services 2>/dev/null | grep -qx lucy && echo yes || echo no)"
  log "upgrade target: compose=$COMPOSE_FILE image=$image services=[$services] lucy_running=$was_running health_port=$(health_port)"

  if [ "$DRY_RUN" -eq 1 ]; then
    if docker image inspect "$image" >/dev/null 2>&1; then
      log "DRY-RUN would tag $image -> $rollback_tag, back up volume to $BACKUP_REL, run rebuild/upgrade, verify health, roll back on failure"
    else
      log "DRY-RUN image $image not present; first real run would build without a rollback image"
    fi
    return 0
  fi

  if docker image inspect "$image" >/dev/null 2>&1; then
    docker image tag "$image" "$rollback_tag" && log "rollback image saved: $rollback_tag ($(docker image inspect "$rollback_tag" --format '{{.Id}}' | cut -c1-19))"
  else
    rollback_tag=""
    log "no existing $image; upgrade will have no rollback image"
  fi

  case " $services " in
    *" demo-db "*)
      log "ensuring demo-db is up"
      docker compose -f "$COMPOSE_FILE" up -d --wait demo-db || log "WARN demo-db did not become healthy"
      ;;
  esac

  mkdir -p "$BACKUP_REL"
  unset BUILDX_BUILDER
  if [ "$COMPOSE_FILE" = "deploy/compose/docker-compose.demo.yml" ]; then
    upgrade_cmd="bash scripts/demo/rebuild-demo-lucy.sh --backup-dir $BACKUP_REL"
  else
    upgrade_cmd="bash scripts/upgrade/upgrade-lucy.sh -f $COMPOSE_FILE --backup-dir $BACKUP_REL"
  fi
  log "running: $upgrade_cmd"
  $upgrade_cmd
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "$head" >"$STATE_FILE"
    log "upgrade OK (head $(git rev-parse --short HEAD))"
    # prune old volume backups
    ls -1t "$BACKUP_REL"/lucy-data-*.tgz 2>/dev/null | awk -v k="$KEEP_BACKUPS" 'NR>k' | while IFS= read -r old; do rm -f "$old"; done
    return 0
  fi

  log "upgrade FAILED (exit $rc); rolling back"
  notify "Lucy upgrade failed, rolling back"
  if [ -z "$rollback_tag" ]; then
    log "ROLLBACK impossible: no previous image"; return 1
  fi
  docker image tag "$rollback_tag" "$image" || { log "ROLLBACK FAILED: cannot retag"; return 1; }
  docker compose -f "$COMPOSE_FILE" up -d --no-build --force-recreate --no-deps lucy || { log "ROLLBACK FAILED: compose up"; return 1; }
  if wait_health; then
    log "ROLLBACK OK: $image restored to previous image and healthy. /data/lucy volume was not wiped; latest backup: $(ls -1t "$BACKUP_REL"/lucy-data-*.tgz 2>/dev/null | head -1)"
  else
    log "ROLLBACK FAILED: previous image not healthy on port $(health_port)"
  fi
  return 1
}

# ---------- main ----------
overall=0
summary=""
if [ "$DO_GIT" -eq 1 ]; then
  git_step || overall=1
  summary="git_ok=$GIT_OK"
else
  if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    log "working tree not clean"; GIT_OK=0
  fi
fi

if [ "$DO_UPGRADE" -eq 1 ]; then
  if [ "$GIT_OK" -ne 1 ]; then
    log "SKIP upgrade: git step did not succeed"
    summary="$summary upgrade=skipped"
  else
    if upgrade_step; then summary="$summary upgrade=ok_or_skipped"; else overall=1; summary="$summary upgrade=failed"; fi
  fi
fi
finish "$overall" "$summary"
