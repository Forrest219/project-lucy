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
# rely on QEMU/buildx; customer amd64 packages must be built on amd64 native.
# Plain docker build / compose do not always inject TARGETPLATFORM — callers
# must pass it (compose files and demo/rebuild scripts do).
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:22-bookworm-slim

ARG KTX_VERSION=0.16.0
# TARGETARCH is exposed so future architecture-specific steps (e.g. fetching a
# KTX binary release) can branch on it without changing the rest of the file.
ARG TARGETARCH=amd64

ENV NODE_ENV=production \
    LUCY_BUNDLED_KTX_VERSION=${KTX_VERSION} \
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

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git tini \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@kaelio/ktx@${KTX_VERSION}"

# StarRocks / MySQL-protocol engines may reject SET SESSION max_execution_time (P0-1/P0-2).
COPY scripts/patch-ktx-mysql-starrocks-compat.js /tmp/patch-ktx-mysql-starrocks-compat.js
RUN node /tmp/patch-ktx-mysql-starrocks-compat.js && rm /tmp/patch-ktx-mysql-starrocks-compat.js

RUN ktx admin runtime install --yes --feature core

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY webui/package.json webui/package-lock.json ./webui/
RUN cd webui && npm ci --include=dev

COPY . .

# Default runtime seed must be customer-safe only (customer-config.example).
# Never copy repo-root semantic-layer / wiki / skills / webui/config — those may
# contain internal test DBs and private ACL. Demo stacks override
# LUCY_TEMPLATE_ROOT to examples/*/project-template instead.
RUN cd webui && npm run build \
  && cd /app \
  && mkdir -p /app/project-template/webui /app/project-template/semantic-layer /app/project-template/skills /app/project-template/wiki \
  && cp customer-config.example/ktx.yaml /app/project-template/ktx.yaml \
  && cp -R customer-config.example/semantic-layer/. /app/project-template/semantic-layer/ \
  && cp -R customer-config.example/wiki/. /app/project-template/wiki/ \
  && cp -R customer-config.example/webui/config /app/project-template/webui/config \
  && touch /app/project-template/skills/.gitkeep \
  && mkdir -p /data/lucy

VOLUME ["/data/lucy"]

EXPOSE 5174 7879

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD /app/scripts/docker-healthcheck.sh

ENTRYPOINT ["tini", "--", "/app/scripts/docker-entrypoint.sh"]
