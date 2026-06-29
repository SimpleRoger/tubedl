FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg curl \
  && pip3 install --break-system-packages yt-dlp==2026.03.17 curl_cffi==0.13.0 \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11

COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts

RUN pnpm --filter @workspace/api-server build

EXPOSE 3000

CMD ["/bin/sh", "-c", "pnpm --filter @workspace/db push-force && pnpm --filter @workspace/api-server start"]
