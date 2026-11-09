# NakamuraProject — API 서버 + 웹 정적 파일을 컨테이너 하나로.
# 1GB 서버에서는 빌드하지 않는다: PC 에서 빌드해 deploy/server/push-image.sh 로 보낸다.

FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
# 빈 DB 로 처음 띄우면 content/*.json 을 넣는다 (CONTENT_DIR)
COPY content content
RUN npm run build -w @nakamura/web && npm prune --omit=dev

FROM node:26-bookworm-slim
# git · openssh-client: DB → git 내보내기(GIT_REMOTE 가 있을 때) / tini: 신호 전달
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8081 \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist \
    CONTENT_DIR=/app/content
USER node
VOLUME ["/data"]
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+(process.env.BASE_PATH||'').replace(/\/$/,'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/server/src/index.ts"]
