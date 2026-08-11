# Security

There are three distinct access layers:

- Public bracket URLs (`/t/:shortCode`) are unauthenticated and read-only.
- Controller operations require proof of `SERVER_ACCESS_PASSWORD` plus a user key. The server password is configured only in the server environment. User keys identify organizers and are stored only as Argon2id hashes.
- System-owner operations require the separate `MASTER_ADMIN_PASSWORD`; they are never available through ordinary controller credentials.

## Controller sessions

Production requires HTTPS. A controller sends its server access password and user key only to the organizer-create or controller-login endpoint. The server validates them, creates a cryptographically random opaque bearer token, and stores only an HMAC-SHA-256 digest of that token in SQLite with its principal (organizer or master), expiry, and revocation state. Tokens expire after eight hours, are checked against server-side state on every controller request, and can be invalidated by logout. The raw token is returned once and is never persisted or logged.

`SERVER_ACCESS_PASSWORD` and `MASTER_ADMIN_PASSWORD` are compared as fixed-length HMAC values with a timing-safe comparison. They remain environment-only and are never written to SQLite. `SESSION_SECRET` is the HMAC key for session-token and user-key lookup digests; it must be a high-entropy environment secret and rotating it invalidates existing sessions/key lookups until a deliberate migration is provided.

Organizer user keys must be at least 20 characters and satisfy a character-diversity check; a small deny-list rejects obvious choices. They are hashed with Argon2id. A keyed HMAC lookup digest, rather than an unsalted hash, finds a possible organizer; Argon2id verification remains the final credential check. The keyed digest has a unique constraint, preventing ambiguous duplicate user keys without storing plaintext.

The threat model assumes TLS protects credentials in transit and that a stolen bearer token is usable until expiry/logout. Clients should keep tokens only in protected local configuration, never URLs, and log neither tokens nor credentials. Rate limiting remains a required deployment concern. Authentication failures are deliberately generic. Do not return hashes, raw secrets, or controller-only data from public responses.

Every state change takes an expected revision. The update must check that revision and increment it in the same SQLite transaction, returning a conflict rather than overwriting a concurrent controller. Validate all request payloads with Zod before database work.

Master sessions use a distinct `MASTER` principal and a separate login endpoint. The web login sets an HttpOnly, `Secure`, `SameSite=Strict` cookie scoped to `/api/master`; the raw session token is not returned to the browser. The login response provides a CSRF token derived from the opaque session token, and every state-changing master operation must include it in `X-CSRF-Token`. In-memory per-IP login throttling limits master-password guessing. Organizer bearer tokens cannot satisfy master middleware, and no master capability is exposed through organizer routes. The master interface serializes only a harmless key prefix plus lifecycle dates; it never returns plaintext keys, Argon2 hashes, or lookup digests.

## Operational hardening

JSON request bodies are capped at 32 KiB and Zod bounds every external string used by the API. SQL uses prepared statements, React renders text without unsafe HTML, and public/controller/master data are separated by server-side authorization. The same-origin deployment sends no permissive CORS header; security headers deny framing, MIME sniffing, referrer leakage, unnecessary browser permissions, and third-party script/object origins. WebSockets disable compression, cap message payloads at 32 KiB, and allow at most 32 subscriptions per connection. Controller authentication is rate limited to ten failures per IP per ten minutes; master authentication is limited to five. Logs intentionally use generic operational messages and must never include credentials, tokens, hashes, lookup digests, request bodies, or database paths.
