FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund \
  && npm cache clean --force

COPY . .

WORKDIR /app/src

EXPOSE 4000

CMD ["node", "server.js"]

