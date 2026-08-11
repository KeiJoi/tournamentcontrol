# Architecture

Tournament Control is an npm-workspace monorepo. `apps/server` owns persistence, authorization, transitions, retention, and WebSocket fan-out. `apps/web` is a public, unauthenticated read-only bracket viewer. `apps/dalamud` is an authenticated operator client. `packages/shared` contains API/domain contracts shared by Node clients only; the C# plugin consumes the documented JSON API rather than TypeScript packages.

The server uses Express for REST and the `ws` package for standards-based WebSockets. This deliberately avoids Socket.IO so the C# client can use `ClientWebSocket`. SQLite is the source of truth: every mutation authorizes and validates input, commits a transaction, then publishes an event. Clients reconcile using the tournament revision, not local authority.

The initial domain supports `SINGLE_ELIMINATION` and statuses `SETUP`, `ACTIVE`, `COMPLETED`, and `CANCELLED`. New formats should be implemented behind format-specific bracket services without changing public identity or authorization semantics.

Single-elimination seeding and progression live in the server-only `domain` module. The layout is deterministic and game-neutral: it accepts arbitrary contestant names and seeded identities, rounds to the next power of two, places standard seeds to separate top seeds, and resolves byes server-side. Controllers only select a winning contestant; they never calculate advancement.

## Deployment

Render runs the Node server with a persistent database at `/var/data/vat-tournaments.sqlite`. Development uses `DATABASE_PATH`. The web app can be deployed separately or served behind the same public base URL; it only calls public GET endpoints. Secrets are environment-only.
