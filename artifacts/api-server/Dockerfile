FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@11

COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @workspace/api-server build

EXPOSE 3000

CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
