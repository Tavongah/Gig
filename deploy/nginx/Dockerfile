# Nginx + built admin dashboard
FROM node:20-alpine AS admin-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace @gigflow/admin --workspace @gigflow/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin
ARG VITE_API_URL=https://api.example.com/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace @gigflow/shared && npm run build --workspace @gigflow/admin

FROM nginx:1.27-alpine
RUN apk add --no-cache curl
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 80 443 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:8080/health || exit 1
