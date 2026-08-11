# Tournament Control contributor guide

## Commands

- `npm install` — install Node workspaces.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` — validate the Node monorepo.
- `npm run dev:server` / `npm run dev:web` — run development services.
- `dotnet build apps/dalamud/TournamentControl.Dalamud.csproj` — build the plugin where Dalamud dependencies are available.

## Layout

- `apps/server`: authoritative Express, SQLite, and WebSocket service.
- `apps/web`: public read-only React bracket UI.
- `apps/dalamud`: controller plugin and local preferences.
- `packages/shared`: versioned API contracts and domain types only; never server secrets.
- `docs`: architectural decisions; update the relevant document with behavior changes.

## Invariants

- SQLite is the only tournament source of truth. Validate, transact, then broadcast.
- Public routes are read-only. Controller routes require server-password proof and a user key; master routes require the separate master password.
- Never expose, persist, log, or bundle plaintext server/admin passwords or user keys. Hash user keys with Argon2id.
- State changes require an expected tournament revision and must increment it atomically.
- Completed/cancelled tournaments expire; setup/active tournaments never expire automatically.
- Plugin callout templates are local configuration. Callouts are operator initiated only; no repeating automated chat messages.

## Rules

- Keep controllers thin and validate external input with Zod.
- Use standards-based `ws`, not Socket.IO.
- Add tests alongside server and UI behavior. Do not commit `.env`, SQLite files, builds, or `bin/obj`.
- Consult current Dalamud API 15 documentation/SamplePlugin before implementing game API calls.
