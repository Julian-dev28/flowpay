FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./
RUN npm install -g pnpm@9.14.2 && pnpm install --frozen-lockfile

COPY . .
RUN pnpm -F @flowpay/tx-submitter build

WORKDIR /app/services/tx-submitter
EXPOSE 3002

CMD ["node", "dist/worker.js"]
