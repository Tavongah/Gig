# Nginx + admin + Expo mobile web + marketing site
FROM node:22-bookworm-slim AS admin-build
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

FROM node:22-bookworm-slim AS mobile-web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace @gigflow/mobile --workspace @gigflow/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/mobile ./apps/mobile
ARG EXPO_PUBLIC_API_URL=https://api.example.com/v1
ARG EXPO_PUBLIC_WEB_URL=https://app.example.com
ARG EXPO_PUBLIC_SUPPORT_EMAIL=info@duts.tech
ARG EXPO_PUBLIC_SUPPORT_PHONE=
ARG EXPO_PUBLIC_FIREBASE_API_KEY=
ARG EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
ARG EXPO_PUBLIC_FIREBASE_PROJECT_ID=
ARG EXPO_PUBLIC_FIREBASE_APP_ID=
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_WEB_URL=$EXPO_PUBLIC_WEB_URL \
    EXPO_PUBLIC_SUPPORT_EMAIL=$EXPO_PUBLIC_SUPPORT_EMAIL \
    EXPO_PUBLIC_SUPPORT_PHONE=$EXPO_PUBLIC_SUPPORT_PHONE \
    EXPO_PUBLIC_FIREBASE_API_KEY=$EXPO_PUBLIC_FIREBASE_API_KEY \
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=$EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN \
    EXPO_PUBLIC_FIREBASE_PROJECT_ID=$EXPO_PUBLIC_FIREBASE_PROJECT_ID \
    EXPO_PUBLIC_FIREBASE_APP_ID=$EXPO_PUBLIC_FIREBASE_APP_ID \
    NODE_OPTIONS=--max-old-space-size=3072 \
    CI=1
RUN npm run build --workspace @gigflow/shared \
  && cd apps/mobile \
  && npx expo export --platform web --output-dir dist-web

FROM node:22-bookworm-slim AS marketing-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/marketing/package.json ./apps/marketing/
RUN npm ci --workspace @gigflow/marketing --include-workspace-root
COPY tsconfig.base.json ./
COPY apps/marketing ./apps/marketing
ARG PUBLIC_SITE_URL=https://www.duts.tech
ARG PUBLIC_APP_URL=https://app.duts.tech
ARG PUBLIC_SUPPORT_EMAIL=info@duts.tech
ARG PUBLIC_SUPPORT_PHONE=+12036769717
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL \
    PUBLIC_APP_URL=$PUBLIC_APP_URL \
    PUBLIC_SUPPORT_EMAIL=$PUBLIC_SUPPORT_EMAIL \
    PUBLIC_SUPPORT_PHONE=$PUBLIC_SUPPORT_PHONE
RUN npm run build --workspace @gigflow/marketing

FROM nginx:1.27-alpine
RUN apk add --no-cache curl
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/html/admin
COPY --from=mobile-web-build /app/apps/mobile/dist-web /usr/share/nginx/html/app
COPY --from=marketing-build /app/apps/marketing/dist /usr/share/nginx/html/marketing
EXPOSE 80 443 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:8080/health || exit 1
