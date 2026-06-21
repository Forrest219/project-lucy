FROM node:22-bookworm-slim

ARG KTX_VERSION=0.13.0

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

RUN ktx admin runtime install --yes --feature core

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY webui/package.json webui/package-lock.json ./webui/
RUN cd webui && npm ci --include=dev

COPY . .

RUN cd webui && npm run build \
  && cd /app \
  && mkdir -p /app/project-template/webui \
  && cp -R AGENTS.md CLAUDE.md README.md ktx.yaml.example semantic-layer skills wiki evals lucy-skills /app/project-template/ \
  && cp ktx.yaml.example /app/project-template/ktx.yaml \
  && cp -R webui/config /app/project-template/webui/config \
  && mkdir -p /data/lucy

VOLUME ["/data/lucy"]

EXPOSE 5174 7879

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD /app/scripts/docker-healthcheck.sh

ENTRYPOINT ["tini", "--", "/app/scripts/docker-entrypoint.sh"]
