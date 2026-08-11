import type Database from "better-sqlite3";
import type { AuditEvent, Contestant, CreateOrganizerInput, CreateTournamentInput, Match, MatchEvent, Organizer, Round, Session, Tournament, UpdateTournamentInput } from "./types.js";

const now = () => new Date().toISOString();
const organizerColumns = "id, key_hash AS keyHash, key_lookup_digest AS keyLookupDigest, key_prefix AS keyPrefix, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt";
const tournamentColumns = "id, organizer_id AS organizerId, public_code AS publicCode, venue_name AS venueName, game_name AS gameName, tournament_name AS tournamentName, event_date AS eventDate, format, status, revision, created_at AS createdAt, updated_at AS updatedAt, started_at AS startedAt, completed_at AS completedAt, cancelled_at AS cancelledAt, expires_at AS expiresAt";
const contestantColumns = "id, tournament_id AS tournamentId, display_name AS displayName, seed, status, created_at AS createdAt, updated_at AS updatedAt";
const roundColumns = "id, tournament_id AS tournamentId, round_number AS roundNumber, name";
const matchColumns = "id, tournament_id AS tournamentId, round_id AS roundId, position, player1_id AS player1Id, player2_id AS player2Id, winner_id AS winnerId, loser_id AS loserId, status, next_winner_match_id AS nextWinnerMatchId, next_winner_slot AS nextWinnerSlot, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt";
const sessionColumns = "id, token_digest AS tokenDigest, principal_type AS principalType, organizer_id AS organizerId, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt, revoked_at AS revokedAt";

export class OrganizerRepository {
  public constructor(private readonly database: Database.Database) {}
  create(input: CreateOrganizerInput): Organizer {
    const timestamp = input.now ?? now();
    this.database.prepare("INSERT INTO organizers (id, key_hash, key_lookup_digest, key_prefix, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.id, input.keyHash, input.keyLookupDigest, input.keyPrefix ?? null, timestamp, timestamp);
    return this.findById(input.id)!;
  }
  findById(id: string): Organizer | undefined { return this.database.prepare(`SELECT ${organizerColumns} FROM organizers WHERE id = ?`).get(id) as Organizer | undefined; }
  findByLookupDigest(digest: string): Organizer | undefined { return this.database.prepare(`SELECT ${organizerColumns} FROM organizers WHERE key_lookup_digest = ?`).get(digest) as Organizer | undefined; }
  list(): Organizer[] { return this.database.prepare(`SELECT ${organizerColumns} FROM organizers ORDER BY created_at DESC`).all() as Organizer[]; }
  touch(id: string, timestamp = now()): void { this.database.prepare("UPDATE organizers SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL").run(timestamp, id); }
  revoke(id: string, timestamp = now()): void { this.database.prepare("UPDATE organizers SET revoked_at = ? WHERE id = ?").run(timestamp, id); }
  restore(id: string): void { this.database.prepare("UPDATE organizers SET revoked_at = NULL WHERE id = ?").run(id); }
}

export class TournamentRepository {
  public constructor(private readonly database: Database.Database) {}
  create(input: CreateTournamentInput): Tournament {
    const timestamp = input.now ?? now();
    return this.createUnchecked(input, timestamp);
  }
  private createUnchecked(input: CreateTournamentInput, timestamp: string): Tournament {
    this.database.prepare("INSERT INTO tournaments (id, organizer_id, public_code, venue_name, game_name, tournament_name, event_date, format, status, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)")
      .run(input.id, input.organizerId, input.publicCode, input.venueName, input.gameName, input.tournamentName, input.eventDate, input.format ?? "SINGLE_ELIMINATION", input.status ?? "SETUP", timestamp, timestamp);
    return this.findById(input.id)!;
  }
  findById(id: string): Tournament | undefined { return this.database.prepare(`SELECT ${tournamentColumns} FROM tournaments WHERE id = ?`).get(id) as Tournament | undefined; }
  findByPublicCode(publicCode: string): Tournament | undefined { return this.database.prepare(`SELECT ${tournamentColumns} FROM tournaments WHERE public_code = ?`).get(publicCode) as Tournament | undefined; }
  listByOrganizer(organizerId: string): Tournament[] { return this.database.prepare(`SELECT ${tournamentColumns} FROM tournaments WHERE organizer_id = ? ORDER BY created_at DESC`).all(organizerId) as Tournament[]; }
  update(id: string, expectedRevision: number, input: UpdateTournamentInput, timestamp = now()): Tournament | undefined {
    const fields = Object.entries(input).filter(([, value]) => value !== undefined);
    if (!fields.length) return this.findById(id);
    const columnMap: Record<string, string> = { venueName: "venue_name", gameName: "game_name", tournamentName: "tournament_name", eventDate: "event_date", status: "status", startedAt: "started_at", completedAt: "completed_at", cancelledAt: "cancelled_at", expiresAt: "expires_at" };
    const assignments = fields.map(([key]) => `${columnMap[key]!} = ?`).join(", ");
    const values = fields.map(([, value]) => value);
    const result = this.database.prepare(`UPDATE tournaments SET ${assignments}, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`).run(...values, timestamp, id, expectedRevision);
    return result.changes === 1 ? this.findById(id) : undefined;
  }
  delete(id: string): boolean { return this.database.prepare("DELETE FROM tournaments WHERE id = ?").run(id).changes === 1; }
  deleteExpired(retentionDays: number, nowIso = now()): number {
    return this.database.prepare(`DELETE FROM tournaments
      WHERE (status = 'COMPLETED' AND completed_at IS NOT NULL AND datetime(completed_at, '+' || ? || ' days') <= datetime(?))
         OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND datetime(cancelled_at, '+' || ? || ' days') <= datetime(?))`)
      .run(retentionDays, nowIso, retentionDays, nowIso).changes;
  }
}

export class SessionRepository {
  public constructor(private readonly database: Database.Database) {}
  create(input: Omit<Session, "createdAt" | "lastUsedAt" | "revokedAt">, timestamp = now()): Session {
    this.database.prepare("INSERT INTO sessions (id, token_digest, principal_type, organizer_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.tokenDigest, input.principalType, input.organizerId, timestamp, timestamp, input.expiresAt);
    return this.findById(input.id)!;
  }
  findActiveByTokenDigest(tokenDigest: string, timestamp = now()): Session | undefined {
    return this.database.prepare(`SELECT ${sessionColumns} FROM sessions WHERE token_digest = ? AND revoked_at IS NULL AND expires_at > ?`).get(tokenDigest, timestamp) as Session | undefined;
  }
  findById(id: string): Session | undefined { return this.database.prepare(`SELECT ${sessionColumns} FROM sessions WHERE id = ?`).get(id) as Session | undefined; }
  touch(id: string, timestamp = now()): void { this.database.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL").run(timestamp, id); }
  revoke(id: string, timestamp = now()): boolean { return this.database.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(timestamp, id).changes === 1; }
  revokeForOrganizer(organizerId: string, timestamp = now()): void { this.database.prepare("UPDATE sessions SET revoked_at = ? WHERE organizer_id = ? AND revoked_at IS NULL").run(timestamp, organizerId); }
}

export class BracketRepository {
  public constructor(private readonly database: Database.Database) {}
  createContestant(input: Omit<Contestant, "createdAt" | "updatedAt">, timestamp = now()): Contestant {
    this.database.prepare("INSERT INTO contestants (id, tournament_id, display_name, seed, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.id, input.tournamentId, input.displayName, input.seed, input.status, timestamp, timestamp);
    return this.database.prepare(`SELECT ${contestantColumns} FROM contestants WHERE id = ?`).get(input.id) as Contestant;
  }
  listContestants(tournamentId: string): Contestant[] { return this.database.prepare(`SELECT ${contestantColumns} FROM contestants WHERE tournament_id = ? ORDER BY seed`).all(tournamentId) as Contestant[]; }
  countContestants(tournamentId: string): number { return (this.database.prepare("SELECT count(*) AS count FROM contestants WHERE tournament_id = ?").get(tournamentId) as { count: number }).count; }
  findContestant(id: string): Contestant | undefined { return this.database.prepare(`SELECT ${contestantColumns} FROM contestants WHERE id = ?`).get(id) as Contestant | undefined; }
  updateContestantName(id: string, displayName: string, timestamp = now()): void { this.database.prepare("UPDATE contestants SET display_name = ?, updated_at = ? WHERE id = ?").run(displayName, timestamp, id); }
  deleteContestant(id: string): boolean { return this.database.prepare("DELETE FROM contestants WHERE id = ?").run(id).changes === 1; }
  reseed(tournamentId: string, ids: string[], timestamp = now()): void {
    this.database.prepare("UPDATE contestants SET seed = seed + 1000000 WHERE tournament_id = ?").run(tournamentId);
    const update = this.database.prepare("UPDATE contestants SET seed = ?, updated_at = ? WHERE id = ? AND tournament_id = ?");
    ids.forEach((id, index) => update.run(index + 1, timestamp, id, tournamentId));
  }
  createRound(round: Round): void { this.database.prepare("INSERT INTO rounds (id, tournament_id, round_number, name) VALUES (?, ?, ?, ?)").run(round.id, round.tournamentId, round.roundNumber, round.name); }
  listRounds(tournamentId: string): Round[] { return this.database.prepare(`SELECT ${roundColumns} FROM rounds WHERE tournament_id = ? ORDER BY round_number`).all(tournamentId) as Round[]; }
  createMatch(match: Match): void { this.database.prepare("INSERT INTO matches (id, tournament_id, round_id, position, player1_id, player2_id, winner_id, loser_id, status, next_winner_match_id, next_winner_slot, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(match.id, match.tournamentId, match.roundId, match.position, match.player1Id, match.player2Id, match.winnerId, match.loserId, match.status, match.nextWinnerMatchId, match.nextWinnerSlot, match.createdAt, match.updatedAt, match.completedAt); }
  listMatches(tournamentId: string): Match[] { return this.database.prepare(`SELECT ${matchColumns} FROM matches WHERE tournament_id = ? ORDER BY round_id, position`).all(tournamentId) as Match[]; }
  findMatch(id: string): Match | undefined { return this.database.prepare(`SELECT ${matchColumns} FROM matches WHERE id = ?`).get(id) as Match | undefined; }
  incoming(matchId: string): Match[] { return this.database.prepare(`SELECT ${matchColumns} FROM matches WHERE next_winner_match_id = ?`).all(matchId) as Match[]; }
  setMatch(id: string, value: Partial<Pick<Match, "player1Id" | "player2Id" | "winnerId" | "loserId" | "status" | "completedAt">>, timestamp = now()): void {
    const map: Record<string, string> = { player1Id: "player1_id", player2Id: "player2_id", winnerId: "winner_id", loserId: "loser_id", status: "status", completedAt: "completed_at" };
    const entries = Object.entries(value); if (!entries.length) return;
    this.database.prepare(`UPDATE matches SET ${entries.map(([k]) => `${map[k]!} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...entries.map(([, v]) => v), timestamp, id);
  }
  clearMatch(id: string, timestamp = now()): void { this.setMatch(id, { player1Id: null, player2Id: null, winnerId: null, loserId: null, status: "PENDING", completedAt: null }, timestamp); }
  setContestantStatuses(tournamentId: string, eliminatedIds: string[], timestamp = now()): void { this.database.prepare("UPDATE contestants SET status = 'ACTIVE', updated_at = ? WHERE tournament_id = ? AND status != 'WITHDRAWN'").run(timestamp, tournamentId); const stmt = this.database.prepare("UPDATE contestants SET status = 'ELIMINATED', updated_at = ? WHERE id = ?"); eliminatedIds.forEach((id) => stmt.run(timestamp, id)); }
  appendMatchEvent(event: MatchEvent): void { this.database.prepare("INSERT INTO match_events (id, tournament_id, match_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(event.id, event.tournamentId, event.matchId, event.eventType, event.payloadJson, event.createdAt); }
  appendAuditEvent(event: AuditEvent): void { this.database.prepare("INSERT INTO audit_events (id, organizer_id, tournament_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(event.id, event.organizerId, event.tournamentId, event.eventType, event.payloadJson, event.createdAt); }
  listAuditEvents(filters: { organizerId?: string; tournamentId?: string; limit?: number } = {}): AuditEvent[] {
    const where: string[] = []; const values: unknown[] = [];
    if (filters.organizerId) { where.push("organizer_id = ?"); values.push(filters.organizerId); }
    if (filters.tournamentId) { where.push("tournament_id = ?"); values.push(filters.tournamentId); }
    values.push(Math.min(filters.limit ?? 100, 250));
    return this.database.prepare(`SELECT id, organizer_id AS organizerId, tournament_id AS tournamentId, event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt FROM audit_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...values) as AuditEvent[];
  }
}

export class TournamentService {
  public readonly organizers: OrganizerRepository;
  public readonly tournaments: TournamentRepository;
  public readonly bracket: BracketRepository;
  public readonly sessions: SessionRepository;
  public constructor(private readonly database: Database.Database, private readonly retentionDays = 30) { this.organizers = new OrganizerRepository(database); this.tournaments = new TournamentRepository(database); this.bracket = new BracketRepository(database); this.sessions = new SessionRepository(database); }
  transaction<T>(work: () => T): T { return this.database.transaction(work)(); }
  completeTournament(id: string, expectedRevision: number, completedAt = now()): Tournament | undefined {
    return this.tournaments.update(id, expectedRevision, { status: "COMPLETED", completedAt, expiresAt: addDays(completedAt, this.retentionDays) }, completedAt);
  }
  cancelTournament(id: string, expectedRevision: number, cancelledAt = now()): Tournament | undefined {
    return this.tournaments.update(id, expectedRevision, { status: "CANCELLED", cancelledAt, expiresAt: addDays(cancelledAt, this.retentionDays) }, cancelledAt);
  }
  createTournamentWithAudit(input: CreateTournamentInput, auditEvent: AuditEvent): Tournament {
    return this.transaction(() => { const tournament = this.tournaments.create(input); this.bracket.appendAuditEvent(auditEvent); return tournament; });
  }
  cleanupExpired(nowIso?: string): number { return this.tournaments.deleteExpired(this.retentionDays, nowIso); }
}

function addDays(isoTimestamp: string, days: number): string {
  const timestamp = new Date(isoTimestamp);
  timestamp.setUTCDate(timestamp.getUTCDate() + days);
  return timestamp.toISOString();
}
