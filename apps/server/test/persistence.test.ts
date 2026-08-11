import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { TournamentService } from "../src/db/repositories.js";

const temporaryDirectories: string[] = [];
const openDatabases: ReturnType<typeof openDatabase>[] = [];
function databaseUnderTest() {
  const directory = mkdtempSync(join(tmpdir(), "tournament-control-"));
  temporaryDirectories.push(directory);
  const database = openDatabase(join(directory, "test.sqlite"));
  openDatabases.push(database);
  return { database, service: new TournamentService(database) };
}
afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const timestamp = "2026-08-11T12:00:00.000Z";
function organizer(service: TournamentService, id = "organizer-1") {
  return service.organizers.create({ id, keyHash: "$argon2id$test", keyLookupDigest: `digest-${id}`, keyPrefix: "test", now: timestamp });
}
function tournament(service: TournamentService, overrides: Partial<Parameters<TournamentService["tournaments"]["create"]>[0]> = {}) {
  return service.tournaments.create({ id: "tournament-1", organizerId: "organizer-1", publicCode: "ABC123", venueName: "Venue", gameName: "FFXIV", tournamentName: "Test Cup", eventDate: timestamp, now: timestamp, ...overrides });
}

describe("SQLite persistence", () => {
  it("migrates an empty database and enables required connection settings", () => {
    const { database } = databaseUnderTest();
    const tableNames = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => (row as { name: string }).name);
    expect(tableNames).toEqual(expect.arrayContaining(["schema_migrations", "organizers", "tournaments", "contestants", "rounds", "matches", "match_events", "audit_events"]));
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  });

  it("persists organizers without plaintext key fields", () => {
    const { service } = databaseUnderTest();
    const created = organizer(service);
    expect(created.keyHash).toBe("$argon2id$test");
    expect(service.organizers.findByLookupDigest("digest-organizer-1")?.id).toBe("organizer-1");
    service.organizers.revoke("organizer-1", "2026-08-12T12:00:00.000Z");
    expect(service.organizers.findById("organizer-1")?.revokedAt).toBe("2026-08-12T12:00:00.000Z");
  });

  it("performs tournament CRUD with optimistic revision updates", () => {
    const { service } = databaseUnderTest(); organizer(service);
    const created = tournament(service);
    expect(service.tournaments.findByPublicCode("abc123")?.id).toBe(created.id);
    const updated = service.tournaments.update(created.id, 0, { tournamentName: "Renamed" }, "2026-08-12T12:00:00.000Z");
    expect(updated).toMatchObject({ tournamentName: "Renamed", revision: 1 });
    expect(service.tournaments.update(created.id, 0, { venueName: "Stale" })).toBeUndefined();
    expect(service.tournaments.delete(created.id)).toBe(true);
    expect(service.tournaments.findById(created.id)).toBeUndefined();
  });

  it("enforces globally unique public codes", () => {
    const { service } = databaseUnderTest(); organizer(service);
    tournament(service);
    expect(() => tournament(service, { id: "tournament-2", publicCode: "abc123" })).toThrow(/UNIQUE constraint failed/);
  });

  it("cascades deletion through bracket and event records", () => {
    const { database, service } = databaseUnderTest(); organizer(service); const created = tournament(service);
    service.bracket.createContestant({ id: "contestant-1", tournamentId: created.id, displayName: "Älice Ω", seed: 1, status: "ACTIVE" }, timestamp);
    service.bracket.createRound({ id: "round-1", tournamentId: created.id, roundNumber: 1, name: "Round 1" });
    service.bracket.createMatch({ id: "match-1", tournamentId: created.id, roundId: "round-1", position: 1, player1Id: "contestant-1", player2Id: null, winnerId: null, loserId: null, status: "PENDING", nextWinnerMatchId: null, nextWinnerSlot: null, createdAt: timestamp, updatedAt: timestamp, completedAt: null });
    service.bracket.appendMatchEvent({ id: "match-event-1", tournamentId: created.id, matchId: "match-1", eventType: "MATCH_CREATED", payloadJson: "{}", createdAt: timestamp });
    service.bracket.appendAuditEvent({ id: "audit-event-1", organizerId: "organizer-1", tournamentId: created.id, eventType: "TOURNAMENT_CREATED", payloadJson: "{}", createdAt: timestamp });
    service.tournaments.delete(created.id);
    for (const table of ["contestants", "rounds", "matches", "match_events", "audit_events"]) expect(database.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
  });

  it("rolls back all mutations in a failed multi-step transaction", () => {
    const { service } = databaseUnderTest(); organizer(service);
    expect(() => service.transaction(() => { tournament(service); throw new Error("simulated failure"); })).toThrow("simulated failure");
    expect(service.tournaments.findById("tournament-1")).toBeUndefined();
  });

  it("retains setup and active tournaments regardless of age", () => {
    const { service } = databaseUnderTest(); organizer(service);
    tournament(service, { id: "setup", publicCode: "SETUP1" });
    tournament(service, { id: "active", publicCode: "ACTIVE1" });
    service.tournaments.update("active", 0, { status: "ACTIVE" }, timestamp);
    expect(service.cleanupExpired("2099-01-01T00:00:00.000Z")).toBe(0);
    expect(service.tournaments.findById("setup")).toBeDefined();
    expect(service.tournaments.findById("active")).toBeDefined();
  });

  it("expires completed tournaments only after their expiration", () => {
    const { service } = databaseUnderTest(); organizer(service); tournament(service);
    expect(service.completeTournament("tournament-1", 0, timestamp)?.expiresAt).toBe("2026-09-10T12:00:00.000Z");
    expect(service.cleanupExpired("2026-09-01T00:00:00.000Z")).toBe(0);
    expect(service.cleanupExpired("2026-09-11T00:00:00.000Z")).toBe(1);
  });

  it("expires cancelled tournaments only after their expiration", () => {
    const { service } = databaseUnderTest(); organizer(service); tournament(service);
    expect(service.cancelTournament("tournament-1", 0, timestamp)?.expiresAt).toBe("2026-09-10T12:00:00.000Z");
    expect(service.cleanupExpired("2026-09-11T00:00:00.000Z")).toBe(1);
  });
});
