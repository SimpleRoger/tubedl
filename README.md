# tubedl

pnpm workspace monorepo deployed on Railway. React + Vite frontend (`@workspace/youtube-feed`) with an Express API backend (`@workspace/api-server`), PostgreSQL via Drizzle ORM, and OpenAI integration.

## Stack

- **Monorepo**: pnpm workspaces
- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4
- **Backend**: Express 5 + TypeScript
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Deployment**: Railway (`bubbly-spirit` project)

## Structure

```
tubedl/
├── artifacts/
│   ├── youtube-feed/     # React + Vite frontend (@workspace/youtube-feed)
│   ├── api-server/       # Express API server (@workspace/api-server)
│   ├── mobile/           # Mobile app
│   └── mockup-sandbox/   # UI sandbox
├── lib/
│   ├── api-spec/         # OpenAPI spec + Orval codegen config
│   ├── api-client-react/ # Generated React Query hooks
│   ├── api-zod/          # Generated Zod schemas
│   └── db/               # Drizzle ORM schema + DB connection
├── scripts/              # Utility scripts
├── railpack.json         # Railpack build config (Python + Node)
└── pnpm-workspace.yaml   # pnpm workspace + catalog versions
```

## Local Development

```bash
pnpm install
pnpm --filter @workspace/youtube-feed dev   # frontend on :5173
pnpm --filter @workspace/api-server dev     # backend on :3000
```

## Required Environment Variables

| Variable | Service | Description |
|---|---|---|
| `PORT` | youtube-feed, api-server | Port to listen on (Railway injects this) |
| `BASE_PATH` | youtube-feed | Vite base path (e.g. `/`) |
| `DATABASE_URL` | api-server, db | PostgreSQL connection string |
| `YOUTUBE_API_KEY` | api-server | YouTube Data API v3 key |

Set these in Railway under each service's **Variables** tab.

## Deployment (Railway)

Project: **bubbly-spirit** — auto-deploys from `main` branch on GitHub.

Services:
- `@workspace/youtube-feed` — React frontend
- `@workspace/api-server` — Express API
- `@workspace/db` — database migrations
- `@workspace/api-spec`, `@workspace/api-client-react`, `@workspace/api-zod` — library builds

---

## Deployment Issues & Fixes

A record of the problems hit when first deploying this monorepo to Railway.

### 1. Railpack didn't detect pnpm

**Symptom:** `sh: pnpm: not found` during build.

**Cause:** Railway uses Railpack for auto-detection. The repo has both a `requirements.txt` (Python) and a `package.json` (Node), so Railpack detected Python only and skipped Node/pnpm installation entirely.

**Fix:** Added `"packageManager": "pnpm@11.8.0"` to the root `package.json` to hint at Node, and created `railpack.json` at the repo root to explicitly declare both runtimes:

```json
{
  "packages": { "node": "22", "pnpm": "10" },
  "steps": {
    "install": { "commands": ["pip install -r requirements.txt"] },
    "build": { "commands": ["pnpm install --frozen-lockfile", "pnpm --filter @workspace/youtube-feed build"] }
  }
}
```

Also set `RAILPACK_CONFIG_FILE=railpack.json` as a Railway environment variable on the `@workspace/youtube-feed` service, because Railway was loading a cached `railpack-plan.json` and ignoring our config file.

### 2. Railpack auto-injects `pnpm install` before source is copied

**Symptom:** `ERR_PNPM_NO_PKG_MANIFEST  No package.json found in /app`

**Cause:** Even after pnpm was installed, Railpack auto-added `pnpm install` to the install step, which runs before the source code is copied into `/app`. So there was no `package.json` present when pnpm ran.

**Fix:** Attempted to override the `build` step in `railpack.json` to move `pnpm install` after the copy step. Railpack continued to auto-inject it into the install step regardless of config. Abandoned Railpack for this service.

### 3. Switched to Dockerfile to bypass Railpack

**Fix:** Created `artifacts/youtube-feed/Dockerfile` (inside the service watch path so Railway detects changes) and set `RAILWAY_DOCKERFILE_PATH=artifacts/youtube-feed/Dockerfile` as a Railway environment variable.

The Dockerfile needed to live inside `artifacts/youtube-feed/` specifically — placing it at the repo root caused Railway to report "no changes detected in watch paths" and skip the build.

### 4. pnpm 10 build script approval (`ERR_PNPM_IGNORED_BUILDS`)

**Symptom:** `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.27.3`

**Cause:** pnpm 10+ requires explicit approval to run postinstall scripts. `onlyBuiltDependencies` in `pnpm-workspace.yaml` and `package.json` was not sufficient — pnpm still blocked esbuild's postinstall.

**Fix:** Used `pnpm install --frozen-lockfile --ignore-scripts` to skip all postinstall scripts. esbuild still works because Vite resolves the native binary from `@esbuild/linux-x64` directly, without needing the postinstall to run.

### 5. Alpine Linux musl incompatibility

**Symptom:** Would have caused rollup/lightningcss/tailwind builds to fail because the `pnpm-workspace.yaml` overrides exclude all musl variants (`@rollup/rollup-linux-x64-musl: '-'` etc).

**Fix:** Switched the Dockerfile base image from `node:22-alpine` (musl) to `node:22-slim` (Debian/glibc) so the glibc native binaries install correctly.

### 6. `PORT` and `BASE_PATH` required at build time

**Symptom:** `Error: PORT environment variable is required but was not provided.`

**Cause:** `vite.config.ts` reads `process.env.PORT` and `process.env.BASE_PATH` at config load time — even during `vite build`, not just `vite dev`. Both must be present when the build step runs.

**Fix:** Added `ENV PORT=5173` and `ENV BASE_PATH=/` to the Dockerfile before the build step. Railway overrides `PORT` at runtime with its own injected value.

### Final working Dockerfile

```dockerfile
FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@11

COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts

ENV PORT=5173
ENV BASE_PATH=/

RUN pnpm --filter @workspace/youtube-feed build

EXPOSE 5173

CMD ["pnpm", "--filter", "@workspace/youtube-feed", "dev"]
```
