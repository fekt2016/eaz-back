FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund \
  && npm cache clean --force

COPY . .

EXPOSE 4000

CMD ["node", "src/server.js"]
