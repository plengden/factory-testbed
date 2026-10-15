# factory-testbed image. The base is pinned by digest; bump it by PR (Dockerfile changes are class `high`).
ARG NODE_IMAGE=node:24-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Production dependencies only, exactly as locked, with install scripts disabled.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE}
ARG RELEASE=dev
ENV NODE_ENV=production \
    RELEASE=${RELEASE} \
    PORT=10000 \
    DATABASE_PATH=/data/testbed.db \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 10000
CMD ["node", "--import", "./src/instrument.ts", "src/server.ts"]
