FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
RUN npm install -g pnpm@9.14.2 && pnpm install --frozen-lockfile

COPY . .
RUN pnpm -F @flowpay/orchestrator build

WORKDIR /app/services/orchestrator
EXPOSE 3001

CMD ["node", "dist/server.js"]
