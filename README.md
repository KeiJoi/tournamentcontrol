# Tournament Control

Tournament Control is a generic single-elimination tournament system for venue operators. It combines an authoritative Node/SQLite service, a live public bracket website, and a Dalamud controller plugin for fast in-game event operation.

The SQLite/Node backend is authoritative. Clients render and control committed server state; they do not own tournament state.

    Public spectator ----\
    Dalamud controller --- HTTPS/WebSocket ---> Node / Express ---> SQLite persistent disk
    Master admin web UI --/                         |
                                                Compiled React public/admin UI

## Components

- apps/server — Express, ws, explicit SQLite migrations, authentication, bracket logic, backups, retention, and the production HTTP server.
- apps/web — React/Vite public bracket at /t/:publicCode and system-owner UI at /admin/master.
- apps/dalamud — .NET 10 / Dalamud API 15 controller, opened with /tourney.
- packages/shared — versioned TypeScript API and WebSocket contracts.

## Prerequisites and local development

- Node.js compatible with npm 11.6.2.
- .NET 10 SDK and a configured Dalamud API 15 development environment for plugin builds.
- For production, one Render Node web service and one attached persistent disk.

1. Copy .env.example to .env. Its values are fake development-only placeholders; replace them locally.
2. Run npm install.
3. Run npm run dev:server.
4. Run npm run dev:web.

Never commit .env, SQLite databases, backups, credentials, user keys, session tokens, or production secrets.

## Environment variables

| Variable | Purpose |
| --- | --- |
| PORT | HTTP port; Render supplies this. |
| NODE_ENV | development, test, or production. |
| PUBLIC_BASE_URL | Public HTTPS origin used in generated short URLs. |
| DATABASE_PATH | Development SQLite path; production must be /var/data/vat-tournaments.sqlite. |
| SERVER_ACCESS_PASSWORD | Shared server-access password for organizer creation/login. |
| MASTER_ADMIN_PASSWORD | Separate system-owner password for /admin/master. |
| SESSION_SECRET | High-entropy HMAC secret; use a unique production value. |
| RETENTION_DAYS | Completed/cancelled retention period; default 30. |
| SQLITE_BACKUP_COUNT | Rolling SQLite snapshot count; default 7. |

## User keys, controllers, and public URLs

Create an organizer by supplying the server-access password and a strong user-selected key. The server stores an Argon2id hash plus a keyed lookup digest, never the plaintext key.

User keys are shared credentials, not individual accounts. Anyone with the valid server credential and that shared user key can control the organizer’s tournaments. Treat both values like operational secrets, distribute them only to trusted staff, and revoke an organizer through master administration if necessary.

Public short URLs such as /t/K72MXQ are read-only. They do not expose organizer identity, keys, audit records, or control operations.

## Tournament workflow

1. Authenticate in the plugin and deliberately create an organizer if the selected key is new.
2. Create a tournament with any venue name, game name, event name, and event date.
3. Add entrants individually or in bulk, reorder seeds, or randomize server-side.
4. Start the bracket. Single elimination supports arbitrary counts and resolves byes automatically.
5. Use the live controller to call players and manually select match winners.
6. Share the public short URL with spectators; it updates after database commits.

The product is venue-neutral. Its default web theme is slime-inspired, but neither the server nor plugin assumes a particular venue or game.

## Callout configuration

Callout templates are local Dalamud plugin settings and are never stored in Node/SQLite. Callouts must be manually triggered by the operator; they never auto-send when a match becomes ready.

- Supported channels are Shout (/shout) and Yell (/yell) only.
- <1> and <2> substitute the first and second contestants in the selected match.
- Default line 1: WILL <1> and <2> COME ON DOWN!
- Default line 2: You are the next victims in this tournament!
- Default delay: 2 seconds, configurable from 0.5 to 10 seconds.
- Empty lines are skipped, and duplicate/rapid sends are locally guarded.

## SQLite storage, retention, and backups

SQLite is the source of truth. Every connection uses foreign keys, WAL mode, and a busy timeout; ordered migrations run automatically at startup.

Completed and cancelled tournaments are removed after RETENTION_DAYS. Setup and active tournaments are never removed by normal retention. SQLite-consistent snapshots run at startup and every 24 hours. Production snapshots live under /var/data/backups/ and retain the newest SQLITE_BACKUP_COUNT files. See [database notes](docs/database.md).

## Render deployment

The supported production topology is one Node web service plus one 1 GB persistent disk mounted at /var/data. The service serves the compiled React application itself, handles WebSockets on the same HTTP server, and uses /health and /ready.

Use [render.yaml](render.yaml) or follow [Render deployment](docs/deployment-render.md). Horizontal scaling is intentionally unsupported because an attached persistent disk and SQLite require a single service instance.

## Host the Tournament Server on Render

Create one Render Node Web Service from this repository’s `main` branch, use `npm ci --include=dev && npm run build` and `npm run start --workspace=@tournament-control/server`, and attach a 1 GB persistent disk at `/var/data`. Set every required secret in Render, set `DATABASE_PATH=/var/data/vat-tournaments.sqlite`, then configure a custom HTTPS domain and make `PUBLIC_BASE_URL` exactly match it. The service owns the compiled React UI, API, WebSockets, migrations, retention, and SQLite backups. Follow the complete [Render production setup](docs/render-setup.md); do not horizontally scale this SQLite deployment.

## Install the Dalamud Plugin

After GitHub Pages is enabled and the first tagged plugin release succeeds, add `https://KeiJoi.github.io/tournamentcontrol/repository.json` in `/xlsettings` → **Experimental** → **Custom Plugin Repositories**, then install **Tournament Bracket Controller** from the Plugin Installer. The entry is custom-repository based but not testing-exclusive, so no extra testing opt-in is currently needed. See [Dalamud installation](docs/dalamud-installation.md) for exact steps and [releasing](docs/releasing.md) for the maintainer workflow.

## Security

Organizer sessions are short-lived opaque tokens. Master web sessions use a separate password and an HttpOnly secure cookie with CSRF protection. SQL uses prepared statements, external inputs are validated, public APIs are read-only, and secrets must never be committed or bundled into the frontend. See [security notes](docs/security.md).

## Build and test

| Command | Purpose |
| --- | --- |
| npm run lint | Configured workspace lint/type validation. |
| npm run typecheck | TypeScript checks. |
| npm test | Server integration/unit tests and web tests. |
| npm run build | Production server, shared package, and React build. |
| dotnet test apps/dalamud.tests/TournamentControl.Dalamud.Tests.csproj --configuration Release | Test isolated callout helpers. |
| dotnet build apps/dalamud/TournamentControl.Dalamud.csproj --configuration Release | Build the plugin where Dalamud dependencies are available. |

## Manual Dalamud checklist

- [ ] Plugin loads
- [ ] /tourney opens window
- [ ] Server connection works
- [ ] Credentials save
- [ ] Tournament list loads
- [ ] Tournament creation works
- [ ] Seeding works
- [ ] WebSocket updates work
- [ ] Match winner recording works
- [ ] Call Players appears for valid matches
- [ ] <1>/<2> substitution works
- [ ] /shout sends first line
- [ ] second /shout sends after configured delay
- [ ] /yell mode works
- [ ] blank line handling works
- [ ] callout cannot double-fire rapidly
- [ ] callout does not trigger automatically
- [ ] pending second message cancels cleanly on plugin unload

## Limitations and roadmap

Current limitations: single elimination only; manual winner selection; one SQLite-backed Render instance; and live-game callouts require in-game verification. Plugin configuration uses local Dalamud storage; no OS-backed secret store is assumed.

Recommended future features: additional bracket formats, richer controller/spectator round navigation, optional organizer key-reset workflow, exportable tournament reports, audit tooling, metrics, and external backup/restore automation.

## Release documentation

- [Architecture](docs/architecture.md)
- [API and WebSocket protocol](docs/api.md)
- [Security](docs/security.md)
- [Database and backup behavior](docs/database.md)
- [Dalamud controller](docs/dalamud.md)
- [Dalamud installation](docs/dalamud-installation.md)
- [Render deployment](docs/deployment-render.md)
- [Render production setup](docs/render-setup.md)
- [Dalamud release process](docs/releasing.md)
- [Release checklist](docs/release-checklist.md)
