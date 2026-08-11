import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BracketError, BracketService } from "../src/domain/bracket-service.js";
import { createSingleEliminationPlan } from "../src/domain/single-elimination.js";
import { openDatabase } from "../src/db/database.js";
import { TournamentService } from "../src/db/repositories.js";

const directories: string[] = []; const databases: ReturnType<typeof openDatabase>[] = [];
function fixture(count: number) {
  const directory = mkdtempSync(join(tmpdir(), "bracket-")); directories.push(directory); const database = openDatabase(join(directory, "test.sqlite")); databases.push(database);
  const persistence = new TournamentService(database); persistence.organizers.create({ id: "owner", keyHash: "hash", keyLookupDigest: `digest-${count}` }); persistence.tournaments.create({ id: "tournament", organizerId: "owner", publicCode: `C${count}`, venueName: "Venue", gameName: "Any Game", tournamentName: "Cup", eventDate: "2026-08-11T00:00:00.000Z" });
  const service = new BracketService(persistence); let revision = 0;
  for (let index = 1; index <= count; index++) { const state = service.add("tournament", "owner", revision, `Player ${index}`); revision = state.tournament.revision; }
  return { service, start: () => service.start("tournament", "owner", revision) };
}
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("generic single-elimination bracket", () => {
  it.each([2, 3, 5, 8, 13, 16, 17])("creates a bracket for %i entrants", (count) => {
    const { start } = fixture(count); const state = start(); const size = 2 ** Math.ceil(Math.log2(count));
    expect(state.tournament.status).toBe("ACTIVE"); expect(state.matches).toHaveLength(size - 1); expect(state.contestants).toHaveLength(count);
  });
  it("uses conventional seed separation and deterministic byes", () => {
    const plan = createSingleEliminationPlan(Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), seed: index + 1 })));
    expect(plan.matches.filter((match) => match.round === 1).map((match) => [match.player1Id, match.player2Id])).toEqual([["1", "8"], ["4", "5"], ["2", "7"], ["3", "6"]]);
    const { start } = fixture(5); const state = start(); expect(state.matches.filter((match) => match.status === "BYE").length).toBeGreaterThan(0);
  });
  it("advances winners and completes a championship", () => {
    const { start, service } = fixture(2); const started = start(); const match = started.matches.find((item) => item.status === "READY")!;
    const completed = service.recordResult("tournament", "owner", started.tournament.revision, match.id, match.player1Id!);
    expect(completed.tournament.status).toBe("COMPLETED"); expect(completed.tournament.completedAt).toBeTruthy(); expect(completed.tournament.expiresAt).toBeTruthy();
  });
  it("uses optimistic revisions", () => {
    const { start, service } = fixture(2); const started = start(); const match = started.matches.find((item) => item.status === "READY")!;
    expect(() => service.recordResult("tournament", "owner", started.tournament.revision - 1, match.id, match.player1Id!)).toThrow(BracketError);
  });
  it("randomizes server-side seed order while retaining every entrant", () => {
    const { service } = fixture(5); const before = service.state("tournament");
    const after = service.randomize("tournament", "owner", before.tournament.revision);
    expect(after.tournament.revision).toBe(before.tournament.revision + 1);
    expect(after.contestants.map((contestant) => contestant.id).sort()).toEqual(before.contestants.map((contestant) => contestant.id).sort());
    expect(after.contestants.map((contestant) => contestant.seed)).toEqual([1, 2, 3, 4, 5]);
  });
  it("supports correction and explicit downstream rollback", () => {
    const { start, service } = fixture(8); let state = start();
    const firstRound = state.matches.filter((match) => match.status === "READY");
    state = service.recordResult("tournament", "owner", state.tournament.revision, firstRound[0]!.id, firstRound[0]!.player1Id!);
    state = service.recordResult("tournament", "owner", state.tournament.revision, firstRound[1]!.id, firstRound[1]!.player1Id!);
    const semi = state.matches.find((match) => match.status === "READY" && match.roundId !== firstRound[0]!.roundId)!;
    state = service.recordResult("tournament", "owner", state.tournament.revision, semi.id, semi.player1Id!);
    const source = state.matches.find((match) => match.id === firstRound[0]!.id)!;
    expect(() => service.correct("tournament", "owner", state.tournament.revision, source.id, source.player2Id!, false)).toThrow(/Completed downstream/);
    const rolledBack = service.correct("tournament", "owner", state.tournament.revision, source.id, source.player2Id!, true);
    expect(rolledBack.tournament.status).toBe("ACTIVE"); expect(rolledBack.matches.find((match) => match.id === semi.id)?.status).toBe("READY");
  });
});
