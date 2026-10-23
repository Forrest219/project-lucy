#!/bin/sh
# Build-time apt / npm / PyPI attempts.
# An explicit APT_MIRROR, NPM_REGISTRY, or UV_INDEX_URL uses only that source.
# When unset, the official source is tried with a short timeout, then
# Tsinghua, Aliyun, and Tencent Cloud. NPM has no Tsinghua registry;
# npmmirror is the Aliyun npm endpoint.
set -u

usage() {
  echo "usage: docker-build-mirrors.sh hosts apt|npm|pypi" >&2
  echo "       docker-build-mirrors.sh seconds apt|npm|pypi <source>" >&2
  echo "       docker-build-mirrors.sh apt-install <package>..." >&2
  echo "       docker-build-mirrors.sh npm <npm args>..." >&2
  echo "       docker-build-mirrors.sh ktx-runtime" >&2
  exit 2
}

apt_hosts() {
  if [ -n "${APT_MIRROR:-}" ]; then
    printf '%s\n' "$APT_MIRROR"
  else
    printf '%s\n' deb.debian.org
    printf '%s\n' mirrors.tuna.tsinghua.edu.cn
    printf '%s\n' mirrors.aliyun.com
    printf '%s\n' mirrors.cloud.tencent.com
  fi
}

npm_registries() {
  if [ -n "${NPM_REGISTRY:-}" ]; then
    printf '%s\n' "https://${NPM_REGISTRY}"
  else
    printf '%s\n' https://registry.npmjs.org
    printf '%s\n' https://registry.npmmirror.com
    printf '%s\n' https://mirrors.cloud.tencent.com/npm/
  fi
}

pypi_indexes() {
  if [ -n "${UV_INDEX_URL:-}" ]; then
    printf '%s\n' "$UV_INDEX_URL"
  else
    printf '%s\n' https://pypi.org/simple
    printf '%s\n' https://pypi.tuna.tsinghua.edu.cn/simple/
    printf '%s\n' https://mirrors.aliyun.com/pypi/simple/
    printf '%s\n' https://mirrors.cloud.tencent.com/pypi/simple/
  fi
}

attempt_seconds() {
  kind=$1
  value=$2
  case "$kind" in
    apt)
      if [ -n "${APT_MIRROR:-}" ]; then
        echo 0
      elif [ "$value" = "deb.debian.org" ]; then
        echo 180
      else
        echo 300
      fi
      ;;
    npm)
      if [ -n "${NPM_REGISTRY:-}" ]; then
        echo 0
      elif [ "$value" = "https://registry.npmjs.org" ]; then
        echo 120
      else
        echo 600
      fi
      ;;
    pypi)
      if [ -n "${UV_INDEX_URL:-}" ]; then
        echo 0
      elif [ "$value" = "https://pypi.org/simple" ]; then
        echo 180
      else
        echo 600
      fi
      ;;
    *)
      usage
      ;;
  esac
}

run_within() {
  secs=$1
  shift
  if [ "$secs" = 0 ]; then
    "$@"
  else
    timeout "$secs" "$@"
  fi
}

note() {
  echo "docker-build-mirrors: $*" >&2
}

apt_sources_path() {
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then
    echo /etc/apt/sources.list.d/debian.sources
  else
    echo /etc/apt/sources.list
  fi
}

apt_cleanup_failed() {
  apt-get clean >/dev/null 2>&1 || true
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/partial || true
  rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock \
    /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock || true
}

apt_attempt() {
  host=$1
  secs=$2
  shift 2
  src=$(apt_sources_path)
  cp "$LUCY_APT_SOURCES_ORIG" "$src"
  if [ "$host" != "deb.debian.org" ]; then
    sed -i "s|deb.debian.org|${host}|g" "$src"
  fi
  if ! run_within "$secs" sh -c 'rm -rf /var/lib/apt/lists/*; apt-get update && apt-get install -y -d --no-install-recommends "$@"' lucy-apt "$@"; then
    return 1
  fi
  apt-get install -y --no-install-recommends "$@"
  rm -rf /var/lib/apt/lists/*
}

apt_install() {
  src=$(apt_sources_path)
  LUCY_APT_SOURCES_ORIG=/tmp/lucy-apt.sources.orig
  cp "$src" "$LUCY_APT_SOURCES_ORIG"
  ok=0
  # shellcheck disable=SC2046
  for host in $(apt_hosts); do
    secs=$(attempt_seconds apt "$host")
    note "apt $host"
    if apt_attempt "$host" "$secs" "$@"; then
      ok=1
      break
    fi
    note "apt failed for $host"
    apt_cleanup_failed
  done
  rm -f "$LUCY_APT_SOURCES_ORIG"
  [ "$ok" = 1 ]
}

npm_exec() {
  ok=0
  for registry in $(npm_registries); do
    secs=$(attempt_seconds npm "$registry")
    note "npm $registry"
    if [ "$secs" = 0 ]; then
      if npm "$@" --registry="$registry"; then
        ok=1
        break
      fi
    elif timeout "$secs" npm "$@" --registry="$registry" --fetch-retries=1 --fetch-timeout=20000; then
      ok=1
      break
    fi
    note "npm failed for $registry"
  done
  [ "$ok" = 1 ]
}

ktx_runtime() {
  version=${KTX_VERSION:-}
  [ -n "$version" ] || {
    echo "docker-build-mirrors: KTX_VERSION is required" >&2
    return 1
  }
  ok=0
  for index in $(pypi_indexes); do
    secs=$(attempt_seconds pypi "$index")
    note "pypi $index"
    rm -rf "/home/lucy/.ktx/runtime/${version}"
    if [ "$index" = "https://pypi.org/simple" ]; then
      inner='unset UV_INDEX_URL; ktx admin runtime install --yes --feature core'
    else
      inner="export UV_INDEX_URL='$index'; ktx admin runtime install --yes --feature core"
    fi
    if run_within "$secs" su lucy -s /bin/bash -c "$inner"; then
      ok=1
      break
    fi
    note "pypi failed for $index"
    rm -rf "/home/lucy/.ktx/runtime/${version}"
  done
  [ "$ok" = 1 ]
}

cmd=${1:-}
[ -n "$cmd" ] || usage
shift

case "$cmd" in
  hosts)
    kind=${1:-}
    case "$kind" in
      apt) apt_hosts ;;
      npm) npm_registries ;;
      pypi) pypi_indexes ;;
      *) usage ;;
    esac
    ;;
  seconds)
    [ $# -eq 2 ] || usage
    attempt_seconds "$1" "$2"
    ;;
  apt-install)
    [ $# -gt 0 ] || usage
    apt_install "$@"
    ;;
  npm)
    [ $# -gt 0 ] || usage
    npm_exec "$@"
    ;;
  ktx-runtime)
    ktx_runtime
    ;;
  *)
    usage
    ;;
esac
