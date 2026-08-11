# API and real-time protocol

All JSON uses camelCase and ISO-8601 UTC timestamps. Public endpoints are read-only, beginning with `GET /api/public/tournaments/:shortCode`; their tournament representation excludes organizer IDs and all credentials. Controller endpoints live under `/api/controller`; master endpoints live under `/api/master` with separate authorization middleware.

## Authentication endpoints

- `POST /api/controller/organizers` accepts `{ serverAccessPassword, userKey }`, creates a unique organizer, and returns `{ accessToken, expiresAt, organizer }`.
- `POST /api/controller/sessions` accepts the same credentials and returns an organizer session. `DELETE /api/controller/sessions/current` revokes the bearer session.
- `POST /api/master/sessions` accepts `{ masterAdminPassword }` and sets an HttpOnly, `Secure`, `SameSite=Strict` master-session cookie. Its response includes a non-secret CSRF token; `DELETE /api/master/sessions/current` requires that cookie and `X-CSRF-Token`.

Controller requests use `Authorization: Bearer <opaque-token>`. Master web requests use the HttpOnly cookie, never a browser-readable bearer token. Tokens are short-lived opaque credentials backed by server-side session rows. Only the create/login endpoints receive passwords or user keys.

`GET /api/controller/tournaments` lists only the authenticated organizer's tournaments. `PATCH /api/controller/tournaments/:id` requires organizer ownership and `{ expectedRevision, ...editableFields }`; unauthorized IDs return not-found rather than disclosing ownership. `GET /api/master/session` is a minimal master-session verification endpoint and cannot be accessed with an organizer token. Master administration additionally exposes safe organizer summaries, organizer tournament lists, filtered audit events, revoke/restore operations, and confirmed tournament deletion. Mutating endpoints require `X-CSRF-Token`; revoke/restore requires the organizer ID as confirmation, and deletion requires the public code.

## Bracket controller endpoints

Authenticated organizers manage setup contestants through `/api/controller/tournaments/:id/contestants`, seed ordering via `PUT .../seeds` or `POST .../seeds/randomize`, and start with `POST .../start`. Result and correction endpoints are `POST .../matches/:matchId/result` and `.../correction`. Every mutation includes `expectedRevision` and returns the authoritative tournament, contestants, and matches. A stale write returns `409` with the current bracket state; unsafe corrections that would silently invalidate completed descendants also return `409`.

Controller mutations include `expectedRevision`. A successful response returns the committed resource and new revision; a stale write returns `409 Conflict` with enough current revision information for a client to refresh. Input is validated with Zod and errors use a stable `{ error: { code, message } }` envelope.

WebSocket connections use the standard RFC 6455 protocol at `/ws`. After authentication/subscription is implemented, event payloads will be `{ type, tournamentId, revision, occurredAt, data }`. The server emits only after a successful database commit. Clients must reconnect and refetch on gaps or unknown revisions.

## WebSocket protocol

`/ws` uses versioned JSON contracts from `@tournament-control/shared`. A client sends a version-1 subscribe message containing a public code and receives a complete `tournament.snapshot`; this snapshot is the recovery mechanism after reconnects or revision gaps. Controller clients may include an organizer opaque access token in the message data and it is verified server-side. The hub sends heartbeat pings every 30 seconds, terminates dead peers, and removes subscriptions on close. Post-commit controller mutations publish `tournament.updated` (or `tournament.completed`) snapshots carrying the authoritative revision. Invalid/authentication failures are `error` messages.
