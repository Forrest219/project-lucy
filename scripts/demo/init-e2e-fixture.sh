#!/usr/bin/env bash
# scripts/demo/init-e2e-fixture.sh
# 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §8
#
# 把真实项目仓库克隆到 /tmp/lucy-e2e-fixture，作为 E2E 专用项目副本。
# 真实仓库（$REAL_PROJECT）E2E 全程只读；任何写操作都由 helper 的 guard 拦截。
#
# 用法：
#   scripts/demo/init-e2e-fixture.sh [DEST] [SRC]
#   默认 DEST=/tmp/lucy-e2e-fixture, SRC=本脚本所在仓库根（不绑定任何机器路径）
#
# 本脚本只服务 browser contract fixture（development + loopback，见 webui/playwright.config.ts）。
# 真实 E2E（customer + auth required）使用独立的项目与配置，不共用本夹具。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SRC="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST="${1:-/tmp/lucy-e2e-fixture}"
SRC="${2:-$DEFAULT_SRC}"

# 安全 guard：拒绝把 fixture 放到真实项目目录或其子树
if [[ "$DEST" == "$SRC" || "$DEST" == "$SRC"/* ]]; then
  echo "[E2E-GUARD] DEST=$DEST is inside SRC=$SRC. Refusing." >&2
  exit 2
fi

# 真实仓库是 git 仓库 → 用 git clone 避免 cp 误碰未提交改动
if [[ ! -d "$SRC/.git" ]]; then
  echo "[E2E-GUARD] SRC=$SRC is not a git repository." >&2
  exit 2
fi

# 清理旧 fixture
if [[ -e "$DEST" ]]; then
  echo "[init] Removing existing $DEST"
  rm -rf "$DEST"
fi

echo "[init] Cloning $SRC -> $DEST"
git clone --depth 1 "file://$SRC" "$DEST"

# access.yaml is intentionally gitignored in the real project. Seed the
# disposable fixture from the fixture policy (role/connection/tables match
# ktx-fixture.yaml and the semantic-layer fixture manifest) so admin and ACL
# routes do not start in policy_degraded_global. The product demo example uses
# a different connection and must not be mixed into this fixture.
ACCESS_FIXTURE="$SRC/webui/tests/e2e/fixtures/data/access-fixture.yaml"
ACCESS_TARGET="$DEST/webui/config/access.yaml"
if [[ -f "$ACCESS_FIXTURE" ]]; then
  mkdir -p "$(dirname "$ACCESS_TARGET")"
  cp "$ACCESS_FIXTURE" "$ACCESS_TARGET"
  echo "[init] access.yaml seeded from E2E fixture policy"
else
  echo "[E2E-GUARD] missing $ACCESS_FIXTURE" >&2
  exit 2
fi

# 写入 E2E fixture 凭据（占位字符串，绝不读真实 .ktx/secrets/*）
mkdir -p "$DEST/.ktx/secrets"
echo "e2e-fixture-password" > "$DEST/.ktx/secrets/mysql-aliyun-password"
chmod 600 "$DEST/.ktx/secrets/mysql-aliyun-password"

# 用 SRC（真实仓库）下的 fixture 目录作为源，
# 而不是 DEST——DEST 刚 clone 完还没有我们后续 commit 的 webui/tests/e2e/* 目录。
FIXTURE_DIR="$SRC/webui/tests/e2e/fixtures/data"
if [[ -f "$FIXTURE_DIR/ktx-fixture.yaml" ]]; then
  cp "$FIXTURE_DIR/ktx-fixture.yaml" "$DEST/ktx.yaml"
  echo "[init] ktx.yaml replaced with fixture"
else
  echo "[E2E-GUARD] missing $FIXTURE_DIR/ktx-fixture.yaml" >&2
  exit 2
fi

# 注入 E2E 专用 semantic-layer fixture（只放最小可工作集合）
# A2 (M31): 4 content dirs live under the content root (default config/).
# WebUI LUCY_CONTENT_ROOT in playwright.config.ts matches this layout.
SEM_FIXTURE="$FIXTURE_DIR/semantic-layer-fixture"
SEM_TARGET="$DEST/config/semantic-layer"
if [[ -d "$SEM_FIXTURE" ]]; then
  mkdir -p "$DEST/config"
  cp -R "$SEM_FIXTURE/." "$SEM_TARGET/"
  echo "[init] semantic-layer replaced with fixture (config/semantic-layer)"
fi

# 注入 E2E 专用 wiki fixture
WIKI_FIXTURE="$FIXTURE_DIR/wiki-fixture"
WIKI_TARGET="$DEST/config/wiki"
if [[ -d "$WIKI_FIXTURE" ]]; then
  cp -R "$WIKI_FIXTURE/." "$WIKI_TARGET/"
  echo "[init] wiki replaced with fixture (config/wiki)"
fi

# 触发 catalog reload（让 WebUI 立即看到新 fixture）
echo "[init] Triggering catalog reload via $DEST ..."
(
  cd "$DEST"
  # 若 KTX CLI 或 catalog 子命令不可用则跳过；WebUI 启动时也会 reload
  if command -v ktx >/dev/null 2>&1; then
    if ktx help catalog >/dev/null 2>&1; then
      ktx catalog reload 2>&1 || true
    else
      echo "[init] ktx catalog reload unavailable; skipped"
    fi
  else
    echo "[init] ktx CLI unavailable; skipped catalog reload"
  fi
)

echo "[init] Fixture ready at $DEST"
echo "[init] Real project $SRC left untouched."
