---
last_mapped_commit: 6d075c5e67e12a028a845bd113940e927aaa73c4
last_mapped_at: 2026-09-29
---
# Technology Stack

**Analysis Date:** 2026-09-29

## Languages

**Primary:**

- TypeScript 5.9.3 (strict mode) — all server and client code in `app/`, `components/`, `lib/`, `context/`, `types/`, `scripts/`
- TSX / JSX — React components in `app/**/*.tsx` and `components/**/*.tsx`
- CSS — Tailwind utility classes plus `app/globals.css` (Tailwind entry)

**Secondary:**

- Prisma Schema Language — `prisma/schema.prisma`
- Dockerfile + Docker Compose — `Dockerfile`, `docker-compose.yml`
- GitHub Actions YAML — `.github/workflows/deploy.yml`
- PostCSS config in JS — `postcss.config.js`

No Python, Go, Java, or shell scripts are present. `scripts/dedupeContacts.ts` is TypeScript.

## Runtime

**Environment:**

- Node.js 22 — pinned as `node:22-bookworm-slim` in `Dockerfile:1` (3-stage build); local dev verified on v22.20.0
- React Server Components / App Router runtime — Next.js server runtime, with `export const runtime = "nodejs"` forced on `app/api/scan/route.ts:37` (needed for `pg`/Prisma driver adapter and `amqplib`)
- `NODE_OPTIONS="--max-old-space-size=4096"` set at `Dockerfile:29` for the build stage
- No `engines` field in `package.json` — Node version is only enforced via the Docker base image. `README.md:34` claims "Node.js 18.18+" and is stale.

**Ports:**

- Dev: `4000` — `package.json:6` (`next dev --port 4000`)
- Prod: `4111` — `package.json:8` (`next start --port 4111`), `Dockerfile:70` (`EXPOSE 4111`), `docker-compose.yml:11`
- Note: `Dockerfile:50` sets `ENV PORT=3000` while also `EXPOSE 4111`. In `output: "standalone"` mode the `PORT` env at runtime is what `server.js` binds; the standalone output is launched via `CMD ["node", "server.js"]`. Treat 4111 as the contract (compose maps it) and verify before changing either.

**Package Manager:**

- npm 10.9.3
- Lockfile: present — `package-lock.json` (npm CI enforced in `Dockerfile:13-18`, which hard-fails if the lockfile is missing)
- No pnpm/yarn/bun lockfiles in the repo

## Frameworks

**Core:**

- Next.js 15.5.26 — App Router only (no `pages/` directory). `output: "standalone"` in `next.config.ts:10` for a slim container image. `experimental.serverActions.bodySizeLimit: "10mb"` in `next.config.ts:4-8` to allow large image/spreadsheet uploads through Server Actions.
- React 18.3.1 / React DOM 18.3.1 — NOT React 19. Components rely on React 18 client-component behavior.
- next-auth 4.24.15 (Auth.js v4 line) — Credentials provider only, JWT session strategy. Config is duplicated in two places: `lib/auth.ts` and `app/api/auth/[...nextauth]/route.ts`. Route protection via `withAuth` in `middleware.ts`.

**Data:**

- Prisma 7.10.0 (CLI, devDependency) + `@prisma/client` 7.10.0
- `@prisma/adapter-pg` 7.10.0 — driver adapter, used in `lib/prisma.ts:10-12`
- `pg` 8.23.0 — the underlying PostgreSQL client
- PostgreSQL (provider declared in `prisma/schema.prisma:12`)

**AI:**

- `openai` 4.104.0 — official Node SDK. Used in `lib/extractCard.ts` and `app/api/profile/enrich/route.ts`.

**Messaging:**

- `amqplib` 2.2.0 — RabbitMQ producer client, `lib/rabbitmq.ts` + `lib/queue/profileCollection.ts`

**Frontend libraries:**

- Tailwind CSS 3.4.19 (devDependency) — `tailwind.config.ts` defines custom palette (`graphite`, `ivory`, `copper`, `ink`), font families bound to CSS variables, and two keyframes (`scanline`, `flipin`). Content globs cover only `app/**` and `components/**`.
- PostCSS 8.4.47 + autoprefixer 10.4.20 (devDependencies) — `postcss.config.js`
- `leaflet` 1.9.4 — map rendering in `components/ContactMap.tsx` (client-only, `"use client"`)
- `lucide-react` 0.454.0 — icon set
- `xlsx` 0.18.5 — CSV/XLS/XLSX import parsing in `app/api/scan/route.ts:8,199,205`
- `next/font/google` — Fraunces, Inter, IBM Plex Mono loaded at build time in `app/layout.tsx:2,9-26`

**Security/util:**

- `bcryptjs` 3.0.3 — password hashing. Cost factors are inconsistent: 12 in `app/api/auth/register/route.ts:50`, 10 in `app/api/auth/reset-password/route.ts:66`.
- `uuid` 14.0.2 — declared but NOT imported anywhere in application code. Task IDs use Node's `randomUUID` from `node:crypto` (`app/api/scan/route.ts:2,159`, `app/actions/profile-collection.ts:3,49`).
- `@auth/prisma-adapter` 2.11.3 — declared but NOT imported. Correct, because the JWT session strategy does not use a database adapter.

**Testing:**

- None. No test framework, no `test` script in `package.json`, no test files anywhere in the repo. `package.json` scripts are only `dev`, `build`, `start`, `lint`. Do not assume a test command exists when planning verification work.

## Key Dependencies

**Critical:**

- `next` 15.5.26 — the whole application surface; App Router + Server Actions + Route Handlers
- `openai` 4.104.0 — the product's core value. Every scan depends on an OpenAI vision call; there is no local fallback path
- `@prisma/client` 7.10.0 + `@prisma/adapter-pg` 7.10.0 — all persistence. Prisma 7 requires the driver adapter (`lib/prisma.ts:10-18`); the classic `new PrismaClient({ datasources })` form is not in use
- `next-auth` 4.24.15 — auth, session, and the `middleware.ts` token gate
- `amqplib` 2.2.0 — offloads profile enrichment to an external worker
- `pg` 8.23.0 — required by the Prisma driver adapter

**Infrastructure:**

- `bcryptjs` 3.0.3 — credential verification
- `xlsx` 0.18.5 — bulk contact import
- `leaflet` 1.9.4 — geographic directory view
- `dotenv` 17.4.2 — installed transitively (via Prisma) but imported directly by `prisma.config.ts:3` (`import "dotenv/config"`). It is NOT declared in `package.json`, so it is an undeclared direct dependency and can break on any Prisma version bump that reshuffles the tree.

## Configuration

**Environment:**

- All secrets are read via `process.env` at module or request scope. No config validation layer, no schema (Zod/Valibot) guarding required vars.
- Required vars and where they are read:
  - `DATABASE_URL` — `lib/prisma.ts:11`, `prisma.config.ts:12`
  - `OPENAI_API_KEY` — `lib/extractCard.ts:69,76`, `app/api/profile/enrich/route.ts:87,90`, `app/api/scan/route.ts:175`
  - `NEXTAUTH_SECRET` — `lib/auth.ts:93`, `app/api/auth/[...nextauth]/route.ts:73`
  - `RABBITMQ_URL` — `lib/rabbitmq.ts:7`
  - `NODE_ENV`, `PORT`, `HOSTNAME`, `APP_VERSION` — Docker/compose only
- `.env` exists in the repo root and is gitignored (`.gitignore:3-4` covers `.env*`). `docker-compose.yml:14` loads `.env.production`, which is not present in the working tree.
- `NEXTAUTH_URL` is not referenced in any source file. next-auth v4 normally needs it for callback URL construction; the code relies on request-derived origins instead.

**Build:**

- `next.config.ts` — standalone output, 10mb Server Action body limit, `allowedDevOrigins: ["192.168.1.196","192.168.1.200"]` for LAN device testing from phones
- `tsconfig.json` — `target: ES2017`, `strict: true`, `moduleResolution: "bundler"`, `noEmit: true`, path alias `@/*` → `./*`. Strict mode is on; do not write `any`-heavy code without acknowledging the surrounding `as any` usage in auth code
- `prisma.config.ts` — Prisma 7 config style: schema path, migrations path, datasource URL from env
- `prisma/schema.prisma` — generator output redirected to `../lib/generated/prisma`, which is gitignored (`.gitignore:9`). The Prisma client is code-generated into the repo, not into `node_modules` — run `npx prisma generate` after any schema change and before `npm run build`
- `Dockerfile` — 3 stages: (1) `npm ci` with BuildKit npm cache mount, (2) `prisma generate` + `npm run build` with a dummy `DATABASE_URL` so generation/build do not need a live DB, (3) runtime copies only `.next/standalone`, `.next/static`, and `public/`, runs as the unprivileged `node` user

**CI/CD:**

- `.github/workflows/deploy.yml` — on push to `main`:
  1. `build-and-push` (ubuntu-latest): Docker Buildx → push to GHCR as `ghcr.io/laser-power-infra/card_scanner:latest` and `:<short-sha>`, with GHA layer caching
  2. `deploy` (self-hosted, Windows PowerShell, working dir `D:/card-scanner`): `docker compose pull` → `up -d --no-deps` → prune images beyond the two most recent
- No test, lint, or typecheck stage runs in CI. `next build` typechecks as a side effect, but `next lint` is never invoked by automation.

## Platform Requirements

**Development:**

- Node.js 22 (use 22.x; `Dockerfile` is the source of truth)
- npm 10+
- A reachable PostgreSQL instance and `DATABASE_URL` in the environment
- An OpenAI API key with prepaid credit
- Optional: a RabbitMQ instance — the app degrades gracefully when `RABBITMQ_URL` is unset (`lib/rabbitmq.ts:9` returns `null`)
- Run `npx prisma generate` once after install so `lib/generated/prisma` exists
- Dev server on `http://localhost:4000`

**Production:**

- Any host that can run the standalone Node server (`CMD ["node", "server.js"]`)
- Canonical deployment path: Docker image from GHCR, run by `docker-compose.yml` on the external `infra` Docker network, port `4111`
- Requires a real `DATABASE_URL` at runtime (the build-time dummy is replaced by `docker-compose.yml`'s `env_file: .env.production`)
- Requires `NEXTAUTH_SECRET`; `OPENAI_API_KEY` required for scanning; `RABBITMQ_URL` required for enrichment
- The external RabbitMQ worker that consumes `CS-profile:collection` lives in a different repository — it is not part of this image

## Documentation Drift (verified)

`README.md` describes a materially different stack than the code. Treat the code as authoritative:

- README says Claude / Anthropic (`README.md:52-53,69`) — code calls OpenAI (`lib/extractCard.ts:1,75`)
- README says `gpt-4o-mini` and `detail: "low"`, `max_tokens: 600` (`README.md:77-80`) — code uses model `gpt-5.6-luna`, `detail: "high"`, `max_tokens: 800` (`lib/extractCard.ts:81-83,101`)
- README references MongoDB Atlas and a Python/FastAPI OCR microservice (`README.md:96-97`) — neither exists; storage is PostgreSQL via Prisma
- README references `.env.example` (`README.md:41,71`) — that file does not exist in the repo
- README says port 3000 (`README.md:47`) — dev is 4000, prod is 4111
- README's "Project structure" tree omits `lib/rabbitmq.ts`, `lib/queue/`, `middleware.ts`, `prisma/`, and the whole auth system

---

*Stack analysis: 2026-09-29*
