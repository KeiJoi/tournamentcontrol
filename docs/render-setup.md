# Render production setup

Tournament Control runs as one Node web service with one persistent SQLite disk. The Node server builds and serves the React public/admin application, REST API, and WebSockets; do not create a separate static-site service.

## Create the service

1. Create a Render **Web Service** from this repository. Use the included `render.yaml` Blueprint or configure it manually.
2. Set the production branch to `main`, the build command to `npm ci && npm run build`, and the start command to `npm run start --workspace=@tournament-control/server`.
3. Attach a **1 GB Persistent Disk** at `/var/data`.
4. Set the service to one instance. SQLite with an attached disk intentionally does not support horizontal scaling.

## Environment variables

Set these in the Render dashboard. Keep passwords and `SESSION_SECRET` secret; do not put them in Git, `render.yaml`, frontend variables, or build arguments.

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | Final HTTPS origin, such as `https://tournaments.example.com` |
| `DATABASE_PATH` | `/var/data/vat-tournaments.sqlite` |
| `SERVER_ACCESS_PASSWORD` | Unique secret server-access password |
| `MASTER_ADMIN_PASSWORD` | Separate unique master-admin password |
| `SESSION_SECRET` | Unique high-entropy secret |
| `RETENTION_DAYS` | `30` unless a different policy is required |
| `SQLITE_BACKUP_COUNT` | `7` unless a different retention count is required |

Render supplies `PORT`; the server reads it and binds `0.0.0.0`. It creates `/var/data` if needed, refuses a production database path outside the persistent mount, enables WAL/foreign keys/busy timeout, applies migrations, runs startup retention cleanup, then exposes `/health` and `/ready`. Neither endpoint reveals secrets or filesystem paths.

## Domain, HTTPS, and operations

Add the custom domain in Render, follow its DNS instructions, wait for HTTPS, then set `PUBLIC_BASE_URL` to that exact `https://` origin and redeploy. HTTPS is required in production because controllers authenticate and the master session uses secure cookies.

Redeploying restarts the single process; the `/var/data` disk preserves the database and its SQLite WAL state. Graceful shutdown stops the HTTP/WebSocket service and closes SQLite. Startup and daily SQLite-consistent snapshots are written to `/var/data/backups/`; the service retains the configured rolling count. The disk is not a backup strategy—schedule independent backups and test restore into a separate service. Never copy only the primary database file from a live WAL database.

If migration or database open fails, treat the service as not ready and investigate the generic Render logs without adding sensitive values to logging. See [deployment details](deployment-render.md) for the architecture and recovery notes.
