# First release checklist

## Repository and security

- [ ] Confirm no .env, SQLite database, backup, credential, token, or plugin configuration file is tracked.
- [ ] Confirm .env.example contains fake values only.
- [ ] Set unique production passwords and a high-entropy SESSION_SECRET in Render; never place them in source files or Vite variables.
- [ ] Review npm audit and dotnet list package --vulnerable output and resolve actionable production findings.
- [ ] Verify public APIs remain read-only and organizer/master authentication remains separate.

## Validation

- [ ] Run npm run lint.
- [ ] Run npm test.
- [ ] Run npm run typecheck.
- [ ] Run npm run build.
- [ ] Run dotnet test apps/dalamud.tests/TournamentControl.Dalamud.Tests.csproj --configuration Release.
- [ ] Run dotnet build apps/dalamud/TournamentControl.Dalamud.csproj --configuration Release.
- [ ] Confirm `bin/Release/TournamentControl.Dalamud/latest.zip` is SDK-generated and passes `scripts/verify-dalamud-package.ps1`.
- [ ] Confirm the planned `vX.Y.Z` tag exactly matches the authoritative Dalamud `<Version>`.
- [ ] Complete the manual Dalamud checklist in the README on a non-production event.

## Render deployment

- [ ] Create one paid Node Web Service using render.yaml or the documented commands.
- [ ] Attach one 1 GB persistent disk at /var/data.
- [ ] Set DATABASE_PATH=/var/data/vat-tournaments.sqlite, NODE_ENV=production, PUBLIC_BASE_URL, retention, and backup-count values.
- [ ] Confirm /health and /ready return generic success after deployment.
- [ ] Configure a custom domain and HTTPS, then ensure PUBLIC_BASE_URL exactly matches its HTTPS origin.
- [ ] Verify /var/data/backups/ receives a SQLite-consistent backup and confirm a restore procedure on a separate environment.
- [ ] Keep one service instance only; do not enable horizontal scaling.

## Dalamud custom repository release

- [ ] Enable GitHub Pages with the **GitHub Actions** source once, and confirm the repository is public if end users need access.
- [ ] Push only a verified matching `vX.Y.Z` tag; ordinary pushes and PRs must not publish.
- [ ] Confirm the GitHub Release has the SDK-generated `TournamentBracketController-vX.Y.Z.zip` asset.
- [ ] Confirm `https://KeiJoi.github.io/tournamentcontrol/repository.json` contains valid metadata, current release URLs, the expected API level, and an updated Unix `LastUpdate` value.
- [ ] Test install and update through a separate Dalamud profile before announcing the release.

## Launch verification

- [ ] Create a test organizer and tournament using non-production shared credentials.
- [ ] Verify a public short URL opens and cannot mutate data.
- [ ] Verify two controllers reconcile a stale revision conflict safely.
- [ ] Verify completed/cancelled retention and setup/active survival using a test database.
- [ ] Verify master login, CSRF-protected revoke/restore, confirmed deletion, and audit visibility.
