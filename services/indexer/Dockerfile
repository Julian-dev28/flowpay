FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY services/indexer/package.json ./services/indexer/
RUN pnpm install --frozen-lockfile

COPY services/indexer/ ./services/indexer/
RUN pnpm -F @flowpay/indexer build

CMD ["node", "services/indexer/dist/main.js"]
