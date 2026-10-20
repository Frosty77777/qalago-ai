# syntax=docker/dockerfile:1
# Production image for the UI: static build served by unprivileged nginx, which also proxies
# /api to the backend so the browser sees a single origin. Build context: frontend/
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Leave empty for the same-origin setup below. Public keys (2GIS map, Google client ID) are
# NOT baked in: the UI reads them at runtime from /api/config.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
