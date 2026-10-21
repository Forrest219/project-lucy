# syntax=docker/dockerfile:1.7
#
# Multi-arch build contract.
#
# The release workflow (`.github/workflows/lucy-release.yml`) builds this image
# with `docker buildx` for both `linux/amd64` and `linux/arm64`. The customer's
# default hardware is x86_64 (AMD) — `linux/amd64` is therefore the primary
# platform. `linux/arm64` is published alongside for Apple Silicon / AWS Graviton
# developers who use the same chart in dev.
#
# FROM must use TARGETPLATFORM (not BUILDPLATFORM). Binding BUILDPLATFORM made
# cross-builds label the image as amd64 while installing arm64 ELFs (or the
# reverse) — confirmed on customer-amd64 offline packages. Cross-arch builds
# rely on QEMU/buildx; arm64 hosts may build customer amd64 packages this way
# provided G1-G4 gates pass (esp. the ELF arch gate). See the customer amd64
# offline delivery spec v0.3+.
# Plain docker build / compose do not always inject TARGETPLATFORM — callers
# must pass it (compose files and demo/rebuild scripts do).
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:22-bookworm-slim

ARG KTX_VERSION=0.16.0
# Lucy product version (customer-facing). Independent of bundled KTX.
# Keep in sync with repo-root VERSION; customer image tags use this, not KTX.
ARG LUCY_VERSION=2.0.0
# TARGETARCH is exposed so future architecture-specific steps (e.g. fetching a
# KTX binary release) can branch on it without changing the rest of the file.
ARG TARGETARCH=amd64
# Optional single mirror. Empty uses scripts/runtime/docker-build-mirrors.sh:
# try the official source with a short timeout, then Tsinghua, Aliyun, and
# Tencent Cloud. A non-empty value uses only that source.
# PyPI index URL. ktx's bundled uv reads UV_INDEX_URL from the process
# environment (managedRuntimeUvEnv). Examples:
#   UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple/
#   UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
ARG UV_INDEX_URL=
# Debian mirror HOST only. The image's /debian path is kept, so
# APT_MIRROR=mirrors.tuna.tsinghua.edu.cn stays mirrors.tuna.../debian.
ARG APT_MIRROR=
# npm registry host, without a scheme. Example: registry.npmmirror.com
# Mirror choices are build-time only. The shipped image keeps no mirror config.
ARG NPM_REGISTRY=

ENV NODE_ENV=production \
    LUCY_VERSION=${LUCY_VERSION} \
    LUCY_BUNDLED_KTX_VERSION=${KTX_VERSION} \
    UV_INDEX_URL=${UV_INDEX_URL} \
    KTX_PROJECT_ROOT=/data/lucy \
    LUCY_WEBUI_HOST=0.0.0.0 \
    LUCY_WEBUI_PORT=5174 \
    LUCY_PROXY_HOST=0.0.0.0 \
    LUCY_PROXY_PORT=7879 \
    LUCY_PROXY_UPSTREAM_HOST=127.0.0.1 \
    LUCY_PROXY_UPSTREAM_PORT=7878 \
    KTX_TELEMETRY_DISABLED=1 \
    POSTHOG_DISABLED=1

WORKDIR /app

# python3/make/g++ : fallback compile for native addons (better-sqlite3 via node-gyp)
# when prebuild-install cannot reach GitHub release assets (restricted networks).
COPY scripts/runtime/docker-build-mirrors.sh /tmp/docker-build-mirrors.sh
RUN sh /tmp/docker-build-mirrors.sh apt-install bash ca-certificates curl git tini python3 make g++

RUN sh /tmp/docker-build-mirrors.sh npm install -g "@kaelio/ktx@${KTX_VERSION}"

# StarRocks / MySQL-protocol engines may reject SET SESSION max_execution_time (P0-1/P0-2).
COPY scripts/runtime/patch-ktx-mysql-starrocks-compat.js /tmp/patch-ktx-mysql-starrocks-compat.js
RUN node /tmp/patch-ktx-mysql-starrocks-compat.js && rm /tmp/patch-ktx-mysql-starrocks-compat.js

# K8s upgrade contract: run as UID 10001 to match legacy PVC ownership (.git).
RUN groupadd -g 10001 lucy \
  && useradd -u 10001 -g 10001 -m -d /home/lucy -s /bin/bash lucy

# uv bootstrap for `ktx admin runtime install`: ktx pins uv 0.11.21 and would
# download it from GitHub release assets, which are unreachable on some
# corporate/restricted networks (objects.githubusercontent.com timeouts).
# Pre-place the binary at the documented air-gapped path so ktx skips the
# download; fall back to the gh-proxy mirror when github.com is blocked.
# Use the musl static build: the glibc build segfaults under qemu-user
# cross-arch emulation (uncaught target signal 11, verified 2026-09-27 on
# Apple Silicon + Docker Desktop), which blocks customer amd64 builds on
# arm64 hosts. Static musl uv runs identically on glibc bookworm.
ARG UV_VERSION=0.11.21
RUN set -eux; \
  case "${TARGETARCH}" in \
    arm64) uv_asset="uv-aarch64-unknown-linux-musl" ;; \
    amd64) uv_asset="uv-x86_64-unknown-linux-musl" ;; \
    *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  uv_dir="/home/lucy/.ktx/runtime/uv/${UV_VERSION}"; \
  mkdir -p "${uv_dir}"; \
  if ! curl -fsSL --max-time 60 -o /tmp/uv.tar.gz \
      "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${uv_asset}.tar.gz"; then \
    curl -fsSL -o /tmp/uv.tar.gz \
      "https://gh-proxy.com/https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${uv_asset}.tar.gz"; \
  fi; \
  tar xzf /tmp/uv.tar.gz -C "${uv_dir}" --strip-components=1; \
  chmod 755 "${uv_dir}/uv"; \
  rm /tmp/uv.tar.gz; \
  chown -R lucy:lucy /home/lucy/.ktx

RUN sh /tmp/docker-build-mirrors.sh ktx-runtime

COPY package.json package-lock.json ./
RUN sh /tmp/docker-build-mirrors.sh npm ci --include=dev

COPY webui/package.json webui/package-lock.json ./webui/
RUN sh /tmp/docker-build-mirrors.sh npm --prefix /app/webui ci --include=dev

COPY . .

# Default runtime seed must be customer-safe only (customer-config.example).
# Never copy repo-root semantic-layer / wiki / skills / webui/config — those may
# contain internal test DBs and private ACL. Demo stacks override
# LUCY_TEMPLATE_ROOT to examples/*/project-template instead.
# Bake product version into the WebUI bundle (sidebar) and keep ENV for /api/health.
# Stamp the source commit before the bundle build so the sidebar and /api/health
# read the same identity. The stamp is a file, not an environment variable.
# Declared here, after the install layers, so a new commit does not rebuild apt,
# npm, or the KTX runtime. Do not copy these into ENV.
ARG LUCY_GIT_SHA=
ARG LUCY_GIT_DIRTY=
RUN rm -f /tmp/docker-build-mirrors.sh \
  && node scripts/release/lucy-build-revision.mjs \
  && cd webui \
  && LUCY_VERSION="${LUCY_VERSION}" VITE_LUCY_VERSION="${LUCY_VERSION}" npm run build \
  && cd /app \
  && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki \
  && cp customer-config.example/ktx.yaml /app/project-template/ktx.yaml \
  && cp -R customer-config.example/config/semantic-layer/. /app/project-template/semantic-layer/ \
  && cp -R customer-config.example/config/wiki/. /app/project-template/wiki/ \
  && cp -R customer-config.example/webui/config /app/project-template/webui/config \
  && touch /app/project-template/skills/.gitkeep \
  && mkdir -p /data/lucy \
  && chown -R lucy:lucy /app /data/lucy /home/lucy

ENV HOME=/home/lucy

USER 10001:10001

VOLUME ["/data/lucy"]

EXPOSE 5174 7879

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD /app/scripts/runtime/docker-healthcheck.sh

ENTRYPOINT ["tini", "--", "/app/scripts/runtime/docker-entrypoint.sh"]
