# 높이 높이 — 단일 컨테이너로 게임 정적파일 + 랭킹 API 를 함께 서빙한다.
# 서버(mini-PC)는 amd64. compose 로 서버에서 직접 빌드하므로 크로스빌드 이슈 없음.

# ── 1) 프론트(게임) 빌드 → /app/dist ──
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY public ./public
COPY src ./src
# scripts/emit-meta.ts 가 빌드 끝에 dist/meta.json 을 쓴다(서버가 og 치환에 쓰는 값).
# 빌드에 필요한 파일이므로 여기 빠지면 npm run build 가 통째로 실패한다.
COPY scripts ./scripts
RUN npm run build

# ── 2) 서버 빌드(+ 네이티브 better-sqlite3) → prod node_modules + dist ──
FROM node:22-bookworm-slim AS server
WORKDIR /app/server
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ── 3) 런타임 (slim) — 빌드산출물만 ──
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    DB_PATH=/app/data/higher.db
# server 스테이지에서 이미 amd64 로 컴파일된 better-sqlite3 포함 node_modules 그대로 복사
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/package.json ./package.json
COPY --from=server /app/server/dist ./dist
COPY --from=frontend /app/dist ./public
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "dist/index.js"]
