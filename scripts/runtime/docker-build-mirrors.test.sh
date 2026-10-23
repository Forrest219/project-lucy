#!/bin/sh
# Host selection for the image build. No network and no package install.
set -eu

script=$(CDPATH= cd -- "$(dirname "$0")" && pwd)/docker-build-mirrors.sh

expect_eq() {
  name=$1
  got=$2
  want=$3
  if [ "$got" != "$want" ]; then
    echo "$name" >&2
    echo "got:" >&2
    printf '%s\n' "$got" >&2
    echo "want:" >&2
    printf '%s\n' "$want" >&2
    exit 1
  fi
}

unset APT_MIRROR NPM_REGISTRY UV_INDEX_URL || true

expect_eq "default apt hosts" "$(sh "$script" hosts apt)" "deb.debian.org
mirrors.tuna.tsinghua.edu.cn
mirrors.aliyun.com
mirrors.cloud.tencent.com"

expect_eq "default npm registries" "$(sh "$script" hosts npm)" "https://registry.npmjs.org
https://registry.npmmirror.com
https://mirrors.cloud.tencent.com/npm/"

expect_eq "default pypi indexes" "$(sh "$script" hosts pypi)" "https://pypi.org/simple
https://pypi.tuna.tsinghua.edu.cn/simple/
https://mirrors.aliyun.com/pypi/simple/
https://mirrors.cloud.tencent.com/pypi/simple/"

expect_eq "pinned apt host" "$(APT_MIRROR=mirrors.example.test sh "$script" hosts apt)" "mirrors.example.test"
expect_eq "pinned npm registry" "$(NPM_REGISTRY=registry.example.test sh "$script" hosts npm)" "https://registry.example.test"
expect_eq "pinned pypi index" "$(UV_INDEX_URL=https://pypi.example.test/simple/ sh "$script" hosts pypi)" "https://pypi.example.test/simple/"

expect_eq "official apt timeout" "$(sh "$script" seconds apt deb.debian.org)" "180"
expect_eq "domestic apt timeout" "$(sh "$script" seconds apt mirrors.aliyun.com)" "300"
expect_eq "pinned apt timeout" "$(APT_MIRROR=mirrors.example.test sh "$script" seconds apt mirrors.example.test)" "0"
expect_eq "official npm timeout" "$(sh "$script" seconds npm https://registry.npmjs.org)" "120"
expect_eq "domestic npm timeout" "$(sh "$script" seconds npm https://registry.npmmirror.com)" "600"
expect_eq "official pypi timeout" "$(sh "$script" seconds pypi https://pypi.org/simple)" "180"

echo "docker-build-mirrors.test: ok"
