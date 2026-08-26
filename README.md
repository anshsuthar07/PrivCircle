# PrivCircle

PrivCircle is a minimal private collaborative code room: choose a path, optionally add a password, share the URL with your circle, and edit together in real time.

The server—not the browser—enforces room passwords. Protected pages do not initialize CodeMirror, Yjs, or a WebSocket until a password grant has been issued. There is no room-listing endpoint.

## What is implemented

- Next.js 16 App Router, TypeScript, CodeMirror 6, Yjs, and `y-codemirror.next`
- Hocuspocus 4.6 WebSockets with Redis cross-instance synchronization
- Optional Argon2id room passwords (`19 MiB`, 2 iterations, parallelism 1)
- Fifteen-minute, room-bound WebSocket access tokens kept in browser memory
- Random `HttpOnly`, `SameSite=Strict` anonymous session grants
- Atomic global two-participant leases in Redis
- `1h`, `24h`, and `7d` inactivity rooms stored only in Redis
- Lifetime metadata and binary Yjs snapshots stored durably in PostgreSQL
- Redis cache rehydration from PostgreSQL for Lifetime rooms
- Debounced persistence after 2 seconds, with a maximum 10-second interval
- Shared cursors, presence count, language selection, Yjs undo/redo, copy link, and local word wrap
- Origin checks, CSP/security headers, request and WebSocket limits, and Redis rate limits

Lifetime means there is no application-controlled expiry. A Lifetime room remains until it is manually removed, the PostgreSQL database is deleted, or the provider/storage plan intervenes. It is durable storage, not a guarantee of permanent preservation.

## Persistence model

```text
Expiring room: Browser ↔ Hocuspocus ↔ Redis (metadata + Yjs state + TTL)

Lifetime room: Browser ↔ Hocuspocus ↔ Redis active cache
                                      ↕ debounced binary snapshots
                                  PostgreSQL source of truth
```

Expiring-room passwords and documents are never written to PostgreSQL. Lifetime documents are stored as one binary Yjs snapshot per room, not as plaintext or one row per keystroke.

## Run locally

Requirements: Node.js 22, Docker Desktop, and npm.

```bash
docker compose up -d --wait
npm install
```

Copy `.env.example` to `.env.local`. The example already points at the local Docker services:

```dotenv
REDIS_URL=redis://127.0.0.1:56379
DATABASE_URL=postgresql://private_share:private_share@127.0.0.1:55432/private_share
ROOM_TOKEN_SECRET=use-a-random-secret-with-at-least-32-characters
SESSION_PEPPER=use-a-different-random-secret
APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:1234
REALTIME_PORT=1234
```

Apply the PostgreSQL migration and start both the web and local realtime servers:

```bash
npm run db:migrate:local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The local web server runs on port `3000`, Hocuspocus on `1234`, Redis on `56379`, and PostgreSQL on `55432`.

## Deploy to Vercel

1. Create a Vercel project from this repository and use Node.js 22 with Fluid Compute enabled. `vercel.json` configures Fluid Compute and the Hobby plan's 300-second WebSocket function duration.
2. Add a Neon PostgreSQL database and an Upstash Redis database.
3. Set `DATABASE_URL`, `REDIS_URL`, `ROOM_TOKEN_SECRET`, `SESSION_PEPPER`, and `APP_ORIGIN` in Vercel. Use a pooled Neon URL, encrypted `rediss://` Upstash URL, and independent random secrets of at least 32 characters.
4. Do not set `NEXT_PUBLIC_WS_URL` in Vercel. The browser derives `wss://<current-host>/api/ws/<room>` so preview deployments remain same-origin.
5. For migrations, optionally set `DIRECT_DATABASE_URL` to Neon's direct connection string, then run `npm run db:migrate` once before serving traffic. Runtime traffic continues to use pooled `DATABASE_URL`.
6. Native WebSockets are currently a Vercel public-beta feature. Connections are pinned to a function instance for at most five minutes on Hobby; the client reconnects automatically and Redis keeps instances converged.

`APP_ORIGIN` should be the canonical production origin. Same-origin preview URLs are also accepted by comparing the request origin, while cross-site POSTs and WebSockets are rejected.

## Commands

```bash
npm run check:env   # validate configuration without printing secrets
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # unit + Redis/PostgreSQL + two-instance realtime tests
npm run test:e2e    # isolated-browser collaboration tests
npm run build       # production Next.js build
npm run verify      # complete non-browser verification suite
npm run db:generate # generate migrations after schema changes
npm run db:migrate  # apply migrations
```

The integration and browser tests expect the Docker services to be running. They verify Redis-only expiry, PostgreSQL binary persistence and cascade deletion, Redis cache recovery, separate Hocuspocus-instance convergence, no pre-auth collaboration socket, simultaneous editing, and the concurrent participant limit.

GitHub Actions repeats migration, type, lint, integration, production-build, and Playwright checks on every push and pull request.

## Security notes

- Access tokens, cookies, passwords, request bodies, and Yjs updates are not logged.
- Password hashes never leave the server.
- The WebSocket token is sent in the Hocuspocus authentication frame, never in a URL.
- Redis and PostgreSQL failures fail closed; there is no in-memory authorization fallback.
- Room pages and room metadata use `no-store`/`noindex` controls.
- A room URL is an identifier. Only the optional password is an additional authentication factor.
- The service provides server-enforced privacy, not end-to-end encryption.

## Operational limits

- Documents are capped at a 1 MiB encoded Yjs snapshot.
- A room supports two distinct anonymous participants; reconnects retain the same seat while their lease remains valid.
- Lifetime means no application-controlled expiry. Provider quotas, manual database removal, or project deletion can still remove data.
- Vercel Hobby WebSockets reconnect at the function-duration boundary, so Redis and PostgreSQL—not function memory—remain authoritative.

The MVP intentionally has no accounts, public discovery, uploads, chat, profiles, or dashboard.
