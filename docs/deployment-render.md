# Render deployment

Tournament Control is deployed as one Render Node web service with one 1 GB persistent disk. SQLite is intentionally single-instance: the Node service, WebSocket hub, migrations, and database all run in that one service.

## Create the service

1. Push this repository to a Git provider and create a Render **Web Service** from it, or create it from the included `render.yaml` Blueprint.
2. Select the Node runtime. Use build command `npm ci && npm run build` and start command `npm run start --workspace=@tournament-control/server`.
3. Attach a **1 GB Persistent Disk** and mount it at `/var/data`.
4. Set `NODE_ENV=production`, `DATABASE_PATH=/var/data/vat-tournaments.sqlite`, `RETENTION_DAYS=30`, and `SQLITE_BACKUP_COUNT=7`.
5. Set `PUBLIC_BASE_URL` to the final public HTTPS origin, for example `https://tournaments.example.com`. Set `SERVER_ACCESS_PASSWORD`, `MASTER_ADMIN_PASSWORD`, and a unique high-entropy `SESSION_SECRET` as Render secret environment variables. Do not put any of these values in source control, `render.yaml`, Vite variables, or build arguments.

Render provides `PORT`; the service reads it automatically. The server serves the compiled React spectator and master-admin app itself, so no second static-site service is required. `/health` answers liveness and `/ready` answers readiness after database open/migration has completed; both return only a generic status.

## Database, startup, and redeploys

At production startup the application refuses any database path other than `/var/data/vat-tournaments.sqlite`. It creates the mounted directory if needed, enables SQLite foreign keys, WAL, and a 5-second busy timeout, then applies ordered migrations before binding the HTTP port. This prevents a successful-looking deployment with a database accidentally created in Render's ephemeral filesystem. A SQLite backup-API snapshot is taken at startup and every 24 hours under `/var/data/backups/`; only the configured rolling count is kept.

The process handles `SIGTERM` and `SIGINT`: it terminates WebSocket clients, stops accepting HTTP requests, closes the SQLite connection, and exits. A redeploy restarts this one process; the persistent disk keeps the SQLite database and WAL files. Run only one instance. Horizontal scaling, multiple regions, and concurrent services are intentionally unsupported because a persistent disk is attached to one instance and SQLite is not the shared database for that topology.

## Domain and HTTPS

After the service is healthy, add a custom domain in Render and point its DNS record according to Render's instructions. Configure `PUBLIC_BASE_URL` with that exact HTTPS origin and redeploy. Render terminates TLS for the public service; use HTTPS in production so controller credentials and HttpOnly secure master-session cookies are protected in transit. Do not use a non-HTTPS public origin.

## Backups and operations

The disk is durable across normal deploys, not a substitute for backups. Schedule regular Render disk/database backups appropriate to the event value and test restoring a copy into a separate service. Before copying a live SQLite database, use a SQLite-consistent backup method (such as `VACUUM INTO` or the SQLite backup API); do not rely on copying only the main `.sqlite` file while WAL mode is active. Keep backups access-controlled because they contain organizer hashes and session-token digests, even though they never contain plaintext passwords or user keys.

Use Render logs only for generic lifecycle diagnostics. The application must not log credentials, session tokens, hashes, lookup digests, or database filesystem details.
