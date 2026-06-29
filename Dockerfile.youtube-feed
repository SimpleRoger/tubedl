FROM node:22-alpine

WORKDIR /app

RUN npm install -g pnpm@10

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/youtube-feed build

EXPOSE 5173

CMD ["pnpm", "--filter", "@workspace/youtube-feed", "dev"]
