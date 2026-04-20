# syntax=docker/dockerfile:1

FROM oven/bun:1.3.13-slim AS build

WORKDIR /app/apps/backend

COPY tsconfig.base.json /app/tsconfig.base.json
COPY apps/backend ./

RUN bun install --frozen-lockfile
RUN bun run build:js

FROM oven/bun:1.3.13-slim AS runtime

WORKDIR /app/apps/backend

COPY --from=build /app/apps/backend/package.json ./package.json
COPY --from=build /app/apps/backend/bun.lock ./bun.lock
COPY --from=build /app/apps/backend/node_modules ./node_modules
COPY --from=build /app/apps/backend/dist ./dist

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "const port = process.env.PORT || '3001'; const res = await fetch(`http://127.0.0.1:${port}/health`); if (!res.ok) process.exit(1);"]

CMD ["bun", "./dist/index.js"]
