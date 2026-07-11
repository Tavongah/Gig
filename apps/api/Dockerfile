# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace @gigflow/shared --workspace @gigflow/api --include-workspace-root

FROM deps AS build
# prisma.config.ts reads DATABASE_URL during `prisma generate`; no DB exists at image build time.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build --workspace @gigflow/shared
RUN npm run prisma:generate --workspace @gigflow/api
RUN npm run build --workspace @gigflow/api

FROM base AS runner
ENV NODE_ENV=production
RUN apk add --no-cache wget
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/
COPY --from=build /app/apps/api/scripts ./apps/api/scripts

WORKDIR /app/apps/api
EXPOSE 4000

CMD ["sh", "scripts/start.sh"]
