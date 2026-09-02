@AGENTS.md

# PrivCircle — codebase index

Private, optionally password-protected collaborative code rooms. Pick a path, share the
URL, edit together in real time. No accounts, no room listing endpoint, no E2E encryption —
privacy is **server-enforced**.

Stack: Next.js 16 (App Router) · React 19 · TypeScript strict · CodeMirror 6 · Yjs ·
Hocuspocus 4.6 · Redis (ioredis) · PostgreSQL (Drizzle) · Argon2id · jose JWT · Zod 4.
Deployed on Vercel Fluid Compute; local dev runs a second standalone Hocuspocus server.

## Layout

| Path | What lives there |
| --- | --- |
| [app/](app/) | App Router pages, API routes, client components, CSS modules. `not-found.tsx`, `error.tsx`, `global-error.tsx`, `robots.ts`, and `sitemap.ts` live at the root — the room segment sits at `/` and would otherwise swallow every single-segment URL under a `200`. |
| [lib/](lib/) | All server logic: auth, storage, realtime, security, validation |
| [lib/documents/](lib/documents/) | Temporary room files: blob adapter, metadata store, cleanup |
| [db/](db/) | Drizzle client + PostgreSQL schema (Lifetime rooms only) |
| [drizzle/](drizzle/) | Generated SQL migrations + snapshots |
| [server/dev-realtime.ts](server/dev-realtime.ts) | Standalone Hocuspocus for `npm run dev` |
| [tests/](tests/) | Vitest unit/integration; `tests/e2e/` is Playwright |
| [scripts/check-env.mjs](scripts/check-env.mjs) | Env validation, runs as `prebuild` |

`@/*` maps to the repo root ([tsconfig.json](tsconfig.json#L23)); mirrored in
[vitest.config.ts](vitest.config.ts#L7).

## Two storage tiers

Everything hinges on `ExpirationPolicy` (`"1h" | "24h" | "7d" | "lifetime"`) in
[lib/types.ts](lib/types.ts#L1-L8):

- **Expiring rooms** live *only* in Redis — metadata, Argon2 hash, and the Yjs document all
  carry a TTL. Never written to PostgreSQL. A tombstone key outlives the room by 24 h so an
  expired path returns `410` instead of `404`.
- **Lifetime rooms** are durable in PostgreSQL (`lifetime_rooms` + `lifetime_documents`,
  one binary Yjs snapshot per room, cascade delete). Redis acts as an active cache with a
  **bounded 7-day idle TTL** (`LIFETIME_CACHE_SECONDS`) so it cannot grow without limit;
  [lookupRoom()](lib/storage/rooms.ts#L68) rehydrates it from PostgreSQL on a miss and
  every read or write refreshes the window.

Redis key namespace is centralized in [lib/storage/keys.ts](lib/storage/keys.ts) —
`privcircle:{path,room,document,expired,grant,presence,rate}:…`.

[lib/storage/rooms.ts](lib/storage/rooms.ts) is the heart of persistence: reserve → create →
load/store/touch, with a Lua compare-and-delete for reservation release, rollback of a
half-created Lifetime room, and a 1 MiB snapshot cap in
[storeDocument()](lib/storage/rooms.ts#L265).

## The access chain

Three distinct credentials, deliberately separated:

1. **Session cookie** — random 32 bytes, `HttpOnly` / `SameSite=Strict`, `__Host-` prefixed in
   production. Stored server-side only as SHA-256(token ‖ `SESSION_PEPPER`).
   [lib/auth/session.ts](lib/auth/session.ts)
2. **Grant** — Redis record binding a session hash to a `participantId` for one room.
   Created on room creation, or on a successful password check.
   [lib/auth/grants.ts](lib/auth/grants.ts)
3. **Access token** — 15-minute HS256 JWT, audience `privcircle-realtime`, bound to
   `roomId` + `path` + `participantId`. Kept in browser memory only, and delivered in the
   Hocuspocus auth frame — never in a URL. [lib/auth/tokens.ts](lib/auth/tokens.ts)

Password hashing is Argon2id at 19 MiB / t=2 / p=1, with
[verifyDummyPassword()](lib/auth/password.ts#L27) equalizing timing for nonexistent rooms.

### Routes

| Route | Behavior |
| --- | --- |
| [POST /api/rooms](app/api/rooms/route.ts) | Create. Two budgets: `create-attempt` 40/h counts every request, `create` 10/h is *peeked* before reserving and only *charged* once a room exists — a rejected or colliding request never spends it. Reserve-then-create with retry on generated paths. **No GET handler — rooms are never listable.** |
| [GET /api/rooms/[path]](app/api/rooms/%5Bpath%5D/route.ts) | Safe metadata only (`passwordRequired`, `expiration`, `expiresAt`). 60/min. |
| [POST …/auth](app/api/rooms/%5Bpath%5D/auth/route.ts) | Password → grant + access token. Dual rate limit: 30/10 min global, 5/10 min per room. |
| [POST …/access](app/api/rooms/%5Bpath%5D/access/route.ts) | Token refresh from an existing grant; `401 PASSWORD_REQUIRED` if the room is protected and no grant exists. |
| [GET/POST …/documents](app/api/rooms/%5Bpath%5D/documents/route.ts) | List active files; initiate an upload (server-generated key + scoped blob token). |
| [POST …/documents/[id]/complete](app/api/rooms/%5Bpath%5D/documents/%5BdocumentId%5D/complete/route.ts) | Finalize: `head()` the object for its true size, then mark ready. |
| [GET …/documents/[id]/download](app/api/rooms/%5Bpath%5D/documents/%5BdocumentId%5D/download/route.ts) | 302 to a presigned URL. No `Origin` required (navigation); `SameSite=Strict` cookie carries it. |
| [DELETE …/documents/[id]](app/api/rooms/%5Bpath%5D/documents/%5BdocumentId%5D/route.ts) | Uploader-only early removal. |
| [GET /api/cron/documents](app/api/cron/documents/route.ts) | Reclaims expired files. Bearer `CRON_SECRET`, takes no caller input. |
| [GET /api/ws/[path]](app/api/ws/%5Bpath%5D/route.ts) | WebSocket upgrade via `@vercel/functions`, `maxDuration: 300`, 1 MiB payload cap. |

Every mutating route checks [isTrustedOrigin()](lib/security/origin.ts) and caps bodies at
2 KiB via [readSmallJson()](lib/http.ts#L37). Errors funnel through
[serviceError()](lib/http.ts) — Redis/PostgreSQL failures **fail closed** with `503`;
there is no in-memory authorization fallback. Each call passes a `scope` so the failure is
logged; the response body stays uninformative.

## Persistence has to be able to report failure

Yjs converges participants with each other and says nothing about whether the server stored the
result. A 1 MiB room that can no longer be saved keeps syncing perfectly between two live tabs and
then reverts on reload, so [lib/realtime/messages.ts](lib/realtime/messages.ts) carries that out of
band: `storeDocument()` throws a typed `DocumentTooLargeError`, the Database extension broadcasts a
stateless `persistence` message, and the client shows a banner and stops claiming "Synced".

## Temporary files

A second, independent lifetime sits alongside rooms: files expire 24 hours after upload
regardless of the room's retention. Bytes go browser → Vercel Blob directly; only metadata
reaches Neon.

[lib/documents/blob.ts](lib/documents/blob.ts) mints an upload token scoped to one exact
object key with the 300 MiB ceiling baked in, so the storage service rejects a
redirected or oversized upload on its own. Keys are
`rooms/<roomId>/<documentId>/<sanitized-name>` — the UUID directory is what makes them
unguessable, and [filenames.ts](lib/documents/filenames.ts) reduces a filename to one
inert segment first.

[lib/documents/store.ts](lib/documents/store.ts) evaluates every expiry against the
**database** clock (`now()`), so listing, download, and cleanup cannot disagree. Note
`room_documents.room_id` has **no foreign key** — expiring rooms live only in Redis and
have no PostgreSQL row.

[lib/documents/cleanup.ts](lib/documents/cleanup.ts) deletes the object before the row,
which is what makes it idempotent: a failed row delete is retried next pass, and deleting
an already-missing object succeeds. Driven by a daily Vercel cron plus an opportunistic
Redis-locked sweep on room activity.

## Realtime

[lib/realtime/server.ts](lib/realtime/server.ts) builds one Hocuspocus configuration shared by
both the Vercel route and the dev server. `onAuthenticate` re-checks origin, the
`x-privcircle-room-path` header, JWT claims against `documentName`, and room existence before
claiming a seat. The Redis extension keeps instances converged; the Database extension maps
fetch/store onto `loadDocument`/`storeDocument`. Debounce 2 s, max 10 s.

[lib/realtime/presence.ts](lib/realtime/presence.ts) enforces the **group seat limit**
(`ROOM_CAPACITY` in [lib/types.ts](lib/types.ts) — 10 by default, from
`NEXT_PUBLIC_ROOM_CAPACITY` so the server's ceiling and the interface's promise cannot drift)
with Lua over a Redis sorted set: 75 s leases keyed `participantId:socketId`, so a reconnect keeps
its seat while distinct participants are counted, not sockets. Client heartbeats every 25 s
([RealtimeEditor.tsx:283](app/%5BroomPath%5D/RealtimeEditor.tsx#L283)) refresh the lease.

## Client flow

[RoomClient.tsx](app/%5BroomPath%5D/RoomClient.tsx) is a phase machine —
`loading → locked | granted | expired | unavailable | error`. The critical property: the editor
is a `lazy()` import that only mounts in `granted`, so **CodeMirror, Yjs, and the WebSocket are
never initialized before a grant exists**.

[RealtimeEditor.tsx](app/%5BroomPath%5D/RealtimeEditor.tsx) owns the whole editor lifecycle in one
effect: Y.Doc + `HocuspocusProvider` + CodeMirror with `yCollab`. **Its dependencies must stay
referentially stable** — `getAccessToken` is deliberately ref-backed in
[RoomClient.tsx](app/%5BroomPath%5D/RoomClient.tsx) because a changing identity tears the whole
editor down. The status label is derived once by `deriveConnectionState()` rather than written by
the individual provider callbacks, which fire in no guaranteed order. Language is a shared
`Y.Map("settings")` value (all participants switch together); word wrap is local
`localStorage`. Compartments handle live reconfiguration. Presence counts distinct awareness
`user.id`s.

[CreateRoomForm.tsx](app/components/CreateRoomForm.tsx) (create/join toggle) and
[ui/controls.tsx](app/components/ui/controls.tsx) (Button, FormField, TextInput, PasswordInput,
custom Select, InfoTooltip, SwitchField, StatusMessage) carry the design system. Styling is CSS
modules over tokens in [app/globals.css](app/globals.css) — no CSS framework.

Path rules ([lib/path-policy.ts](lib/path-policy.ts)) are shared client/server: 3–64 chars,
`[a-zA-Z0-9_-]`, lowercased, with a reserved-word list. Password policy
([lib/password-policy.ts](lib/password-policy.ts)) is 8–128 chars with letter + number + special,
so the form's live checklist and the server's Zod refinement agree.

## Commands

```bash
docker compose up -d --wait   # Redis :56379, PostgreSQL :55432
npm run db:migrate:local
npm run dev                   # web :3000 + realtime :1234 (concurrently)

npm run verify                # check:env → typecheck → lint → test → build
npm test                      # vitest; needs Docker services up
npm run test:e2e              # Playwright, serial, chromium only
npm run db:generate           # after editing db/schema.ts
```

A room holds 300 MB of files in total (`maxRoomDocumentBytes()`), the same as the per-file
ceiling, so one maximum-size upload is a room's whole allowance.

Required env: `REDIS_URL`, `DATABASE_URL`, `ROOM_TOKEN_SECRET` (≥32), `SESSION_PEPPER` (≥32,
must differ), `APP_ORIGIN`. `NEXT_PUBLIC_WS_URL` is **local-only** — in production the browser
derives `wss://<host>/api/ws/<room>` so preview deployments stay same-origin.

## Conventions worth keeping

- Secrets, tokens, passwords, request bodies, and Yjs updates are never logged. That rule is now
  enforced by [lib/observability.ts](lib/observability.ts) rather than by logging nothing at all:
  only an error's class, message, and stack are emitted, redacted for credential-bearing URLs and
  bearer tokens, and repeated failures (a Redis reconnect loop) are throttled to one line per scope
  per interval.
- Redis and PostgreSQL singletons hang off `globalThis` to survive HMR and warm functions
  ([lib/redis.ts](lib/redis.ts), [db/index.ts](db/index.ts)) — a module-local one reopens a pool on
  every reload against a connection budget that is not generous.
- Room activity slides the retention window at most once per 30 s
  (`TOUCH_INTERVAL_MS` in [lib/realtime/server.ts](lib/realtime/server.ts)); a disconnect always
  flushes. Doing it per change was the largest single source of Redis traffic.
- Rate-limit subjects are hashed IPs, never raw ([lib/security/rate-limit.ts](lib/security/rate-limit.ts#L18)).
- All room responses are `no-store` + `noindex`; security headers and CSP live in
  [next.config.ts](next.config.ts).
- User-facing strings live in [lib/ui-labels.ts](lib/ui-labels.ts) and are unit-tested for
  wording — "Saving…" must not claim unsynced work is saved.
- All room-scoped endpoints authorize through the single
  [authorizeRoomRequest()](lib/auth/room-access.ts) helper. Never add a second check.
- `npm run db:migrate:local` goes through [scripts/migrate-local.mjs](scripts/migrate-local.mjs),
  which clears `DIRECT_DATABASE_URL` and refuses non-local hosts — drizzle-kit auto-loads
  `.env`, so calling drizzle-kit directly migrates **production**.
- Lint runs with `--max-warnings=0` across `app lib db server tests scripts` and every config file.

## Also in this working directory

[../mouse_jiggler.py](../mouse_jiggler.py) — unrelated standalone script (Windows `ctypes`
cursor/scroll jiggler, 20 s interval).
