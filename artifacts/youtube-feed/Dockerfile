FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@11

COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts

ARG VITE_API_URL
ENV PORT=5173
ENV BASE_PATH=/
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @workspace/youtube-feed build

EXPOSE 5173

CMD ["pnpm", "--filter", "@workspace/youtube-feed", "dev"]
