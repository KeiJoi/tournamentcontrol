import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { TournamentService } from "../db/repositories.js";
import type { Organizer, Session, SessionPrincipalType } from "../db/types.js";

const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const weakKeys = new Set(["password", "password123", "123456789", "qwertyuiop", "letmein", "tournament", "ffxiv"]);

export interface AuthConfig { serverAccessPassword: string; masterAdminPassword: string; sessionSecret: string; }
export interface AuthenticatedPrincipal { session: Session; organizer: Organizer | null; }
export interface IssuedSession { accessToken: string; expiresAt: string; organizer: Organizer | null; }

export class AuthenticationError extends Error {}
export class ValidationError extends Error {}

export class AuthService {
  public constructor(private readonly tournaments: TournamentService, private readonly config: AuthConfig) {}

  async createOrganizer(serverAccessPassword: string, userKey: string): Promise<IssuedSession> {
    this.assertServerPassword(serverAccessPassword);
    assertStrongUserKey(userKey);
    const lookupDigest = this.digest(userKey);
    if (this.tournaments.organizers.findByLookupDigest(lookupDigest)) throw new ValidationError("That user key is already in use.");
    const keyHash = await argon2.hash(userKey, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    let organizer: Organizer;
    try {
      organizer = this.tournaments.transaction(() => {
        const created = this.tournaments.organizers.create({ id: randomUUID(), keyHash, keyLookupDigest: lookupDigest, keyPrefix: userKey.slice(0, 4) });
        this.tournaments.bracket.appendAuditEvent({ id: randomUUID(), organizerId: created.id, tournamentId: null, eventType: "ORGANIZER_CREATED", payloadJson: "{}", createdAt: created.createdAt });
        return created;
      });
    } catch (exception) {
      if (isUniqueConstraint(exception)) throw new ValidationError("That user key is already in use.");
      throw exception;
    }
    return this.issueSession("ORGANIZER", organizer);
  }

  async loginOrganizer(serverAccessPassword: string, userKey: string): Promise<IssuedSession> {
    this.assertServerPassword(serverAccessPassword);
    const organizer = this.tournaments.organizers.findByLookupDigest(this.digest(userKey));
    if (!organizer || organizer.revokedAt || !(await argon2.verify(organizer.keyHash, userKey))) throw new AuthenticationError("Invalid credentials.");
    this.tournaments.organizers.touch(organizer.id);
    return this.issueSession("ORGANIZER", organizer);
  }

  loginMaster(masterAdminPassword: string): IssuedSession {
    if (!this.safeEqual(masterAdminPassword, this.config.masterAdminPassword)) throw new AuthenticationError("Invalid credentials.");
    return this.issueSession("MASTER", null);
  }

  authenticate(accessToken: string, expectedType: SessionPrincipalType): AuthenticatedPrincipal {
    const session = this.tournaments.sessions.findActiveByTokenDigest(this.digest(accessToken));
    if (!session || session.principalType !== expectedType) throw new AuthenticationError("Invalid session.");
    const organizer = session.organizerId ? this.tournaments.organizers.findById(session.organizerId) : null;
    if (expectedType === "ORGANIZER" && (!organizer || organizer.revokedAt)) {
      this.tournaments.sessions.revoke(session.id);
      throw new AuthenticationError("Invalid session.");
    }
    this.tournaments.sessions.touch(session.id);
    return { session, organizer: organizer ?? null };
  }

  logout(accessToken: string, expectedType: SessionPrincipalType): void {
    const principal = this.authenticate(accessToken, expectedType);
    this.tournaments.sessions.revoke(principal.session.id);
  }

  csrfToken(accessToken: string): string { return createHmac("sha256", this.config.sessionSecret).update(`master-csrf:${accessToken}`, "utf8").digest("base64url"); }
  verifyCsrfToken(accessToken: string, csrfToken: string): boolean {
    const actual = Buffer.from(this.csrfToken(accessToken)); const expected = Buffer.from(csrfToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private issueSession(principalType: SessionPrincipalType, organizer: Organizer | null): IssuedSession {
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
    this.tournaments.sessions.create({ id: randomUUID(), tokenDigest: this.digest(accessToken), principalType, organizerId: organizer?.id ?? null, expiresAt });
    return { accessToken, expiresAt, organizer };
  }
  private assertServerPassword(value: string): void { if (!this.safeEqual(value, this.config.serverAccessPassword)) throw new AuthenticationError("Invalid credentials."); }
  private digest(value: string): string { return createHmac("sha256", this.config.sessionSecret).update(value, "utf8").digest("base64url"); }
  private safeEqual(value: string, expected: string): boolean {
    const valueDigest = createHmac("sha256", this.config.sessionSecret).update(value, "utf8").digest();
    const expectedDigest = createHmac("sha256", this.config.sessionSecret).update(expected, "utf8").digest();
    return timingSafeEqual(valueDigest, expectedDigest);
  }
}

function isUniqueConstraint(exception: unknown): boolean {
  return exception instanceof Error && exception.message.includes("UNIQUE constraint failed");
}

function assertStrongUserKey(userKey: string): void {
  if (userKey.length < 20 || userKey.length > 256 || weakKeys.has(userKey.toLowerCase()) || /^(.)\1+$/.test(userKey)) throw new ValidationError("User key does not meet security requirements.");
  const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((pattern) => pattern.test(userKey)).length;
  if (characterClasses < 3) throw new ValidationError("User key does not meet security requirements.");
}
