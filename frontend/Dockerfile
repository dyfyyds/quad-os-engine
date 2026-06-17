FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# 国内网络：使用 npmmirror 镜像源，避免 registry.npmjs.org 连接重置（ECONNRESET）
RUN npm config set registry https://registry.npmmirror.com \
  && npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
