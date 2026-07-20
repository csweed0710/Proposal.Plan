FROM node:20-alpine AS build
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# PDF 匯出：LibreOffice headless 轉檔＋中文字型（約多 300MB 映像，一次性成本）
RUN apk add --no-cache libreoffice font-noto-cjk
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "start"]
