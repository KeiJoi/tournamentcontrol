import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { openDatabase } from "../src/db/database.js";
import { TournamentService } from "../src/db/repositories.js";

const directories: string[] = [];
const databases: ReturnType<typeof openDatabase>[] = [];
const credentials = { serverAccessPassword: "server-access-password", masterAdminPassword: "master-admin-password", sessionSecret: "a-test-session-secret-that-is-long-enough" };
const organizerAKey = "Northern!Comet2026-Alpha";
const organizerBKey = "Velvet!Orbit2026-Bravo";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "tournament-auth-")); directories.push(directory);
  const database = openDatabase(join(directory, "test.sqlite")); databases.push(database);
  const tournaments = new TournamentService(database);
  const auth = new AuthService(tournaments, credentials);
  return { tournaments, auth, app: createApp({ auth, tournaments }) };
}
async function createOrganizer(app: ReturnType<typeof createApp>, userKey: string) {
  const response = await request(app).post("/api/controller/organizers").send({ serverAccessPassword: credentials.serverAccessPassword, userKey });
  expect(response.status).toBe(201);
  return response.body as { accessToken: string; organizer: { id: string } };
}
function authHeader(token: string) { return { Authorization: `Bearer ${token}` }; }
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("controller authentication and authorization", () => {
  it("rejects a wrong server password", async () => {
    const { app } = fixture();
    const response = await request(app).post("/api/controller/organizers").send({ serverAccessPassword: "incorrect", userKey: organizerAKey });
    expect(response.status).toBe(401); expect(response.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } });
  });

  it("rejects a wrong user key", async () => {
    const { app } = fixture(); await createOrganizer(app, organizerAKey);
    const response = await request(app).post("/api/controller/sessions").send({ serverAccessPassword: credentials.serverAccessPassword, userKey: organizerBKey });
    expect(response.status).toBe(401);
  });

  it("rejects a revoked organizer", async () => {
    const { app, tournaments } = fixture(); const created = await createOrganizer(app, organizerAKey);
    tournaments.organizers.revoke(created.organizer.id);
    const response = await request(app).post("/api/controller/sessions").send({ serverAccessPassword: credentials.serverAccessPassword, userKey: organizerAKey });
    expect(response.status).toBe(401);
  });

  it("scopes list and edit access to the authenticated organizer", async () => {
    const { app, tournaments } = fixture();
    const organizerA = await createOrganizer(app, organizerAKey); const organizerB = await createOrganizer(app, organizerBKey);
    tournaments.tournaments.create({ id: "a-tournament", organizerId: organizerA.organizer.id, publicCode: "ALPHA1", venueName: "A venue", gameName: "FFXIV", tournamentName: "A cup", eventDate: "2026-08-11T12:00:00.000Z" });
    tournaments.tournaments.create({ id: "b-tournament", organizerId: organizerB.organizer.id, publicCode: "BRAVO1", venueName: "B venue", gameName: "FFXIV", tournamentName: "B cup", eventDate: "2026-08-11T12:00:00.000Z" });
    const listing = await request(app).get("/api/controller/tournaments").set(authHeader(organizerA.accessToken));
    expect(listing.status).toBe(200); expect(listing.body.tournaments.map((item: { id: string }) => item.id)).toEqual(["a-tournament"]);
    const edit = await request(app).patch("/api/controller/tournaments/b-tournament").set(authHeader(organizerA.accessToken)).send({ expectedRevision: 0, tournamentName: "Attempted edit" });
    expect(edit.status).toBe(404); expect(tournaments.tournaments.findById("b-tournament")?.tournamentName).toBe("B cup");
  });

  it("keeps public APIs read-only and hides organizer IDs", async () => {
    const { app, tournaments } = fixture(); const organizer = await createOrganizer(app, organizerAKey);
    tournaments.tournaments.create({ id: "public-tournament", organizerId: organizer.organizer.id, publicCode: "PUBLIC1", venueName: "Venue", gameName: "FFXIV", tournamentName: "Public Cup", eventDate: "2026-08-11T12:00:00.000Z" });
    const publicGet = await request(app).get("/api/public/tournaments/PUBLIC1");
    expect(publicGet.status).toBe(200); expect(publicGet.body.tournament.organizerId).toBeUndefined(); expect(JSON.stringify(publicGet.body)).not.toContain(organizer.organizer.id);
    const publicMutation = await request(app).patch("/api/public/tournaments/PUBLIC1").send({ tournamentName: "Nope" });
    expect(publicMutation.status).toBe(404);
  });

  it("does not serialize passwords, keys, or server secrets", async () => {
    const { app } = fixture(); const created = await createOrganizer(app, organizerAKey);
    const serialized = JSON.stringify(created);
    expect(serialized).not.toContain(credentials.serverAccessPassword);
    expect(serialized).not.toContain(credentials.masterAdminPassword);
    expect(serialized).not.toContain(credentials.sessionSecret);
    expect(serialized).not.toContain(organizerAKey);
  });

  it("requires a distinct master session and supports organizer logout", async () => {
    const { app } = fixture(); const organizer = await createOrganizer(app, organizerAKey);
    expect((await request(app).get("/api/master/session").set(authHeader(organizer.accessToken))).status).toBe(401);
    const master = await request(app).post("/api/master/sessions").send({ masterAdminPassword: credentials.masterAdminPassword });
    const cookie = master.headers["set-cookie"]?.[0]?.split(";")[0]; if (!cookie) throw new Error("Master login did not set a cookie.");
    expect(master.status).toBe(200); expect(master.body.accessToken).toBeUndefined(); expect(cookie).toContain("tournament_master_session="); expect((await request(app).get("/api/master/session").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).delete("/api/controller/sessions/current").set(authHeader(organizer.accessToken))).status).toBe(204);
    expect((await request(app).get("/api/controller/tournaments").set(authHeader(organizer.accessToken))).status).toBe(401);
  });

  it("provides safe master administration with CSRF and destructive confirmations", async () => {
    const { app, tournaments } = fixture(); const organizer = await createOrganizer(app, organizerAKey);
    tournaments.tournaments.create({ id: "master-tournament", organizerId: organizer.organizer.id, publicCode: "MASTER1", venueName: "Venue", gameName: "Game", tournamentName: "Cup", eventDate: "2026-08-11T12:00:00.000Z" });
    const login = await request(app).post("/api/master/sessions").send({ masterAdminPassword: credentials.masterAdminPassword });
    const cookie = login.headers["set-cookie"]?.[0]?.split(";")[0]; if (!cookie) throw new Error("Master login did not set a cookie."); const csrf = login.body.csrfToken;
    const organizers = await request(app).get("/api/master/organizers").set("Cookie", cookie);
    expect(organizers.status).toBe(200); expect(JSON.stringify(organizers.body)).not.toContain(organizerAKey); expect(JSON.stringify(organizers.body)).not.toContain("keyHash"); expect(JSON.stringify(organizers.body)).not.toContain("keyLookupDigest");
    expect((await request(app).post(`/api/master/organizers/${organizer.organizer.id}/revoke`).set("Cookie", cookie).send({ confirmation: organizer.organizer.id })).status).toBe(401);
    expect((await request(app).post(`/api/master/organizers/${organizer.organizer.id}/revoke`).set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ confirmation: organizer.organizer.id })).status).toBe(200);
    expect(tournaments.organizers.findById(organizer.organizer.id)?.revokedAt).not.toBeNull();
    expect((await request(app).delete("/api/master/tournaments/master-tournament").set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ confirmation: "WRONG" })).status).toBe(400);
    expect((await request(app).delete("/api/master/tournaments/master-tournament").set("Cookie", cookie).set("X-CSRF-Token", csrf).send({ confirmation: "MASTER1" })).status).toBe(204);
    expect(tournaments.tournaments.findById("master-tournament")).toBeUndefined();
    const audit = await request(app).get("/api/master/audit-events").set("Cookie", cookie);
    expect(audit.status).toBe(200); expect(audit.body.auditEvents.some((event: { eventType: string }) => event.eventType === "TOURNAMENT_DELETED")).toBe(true);
  });

  it("returns HTTP 409 with current bracket state for stale mutations", async () => {
    const { app, tournaments } = fixture(); const organizer = await createOrganizer(app, organizerAKey);
    tournaments.tournaments.create({ id: "stale-tournament", organizerId: organizer.organizer.id, publicCode: "STALE1", venueName: "Venue", gameName: "Any", tournamentName: "Cup", eventDate: "2026-08-11T12:00:00.000Z" });
    let response = await request(app).post("/api/controller/tournaments/stale-tournament/contestants").set(authHeader(organizer.accessToken)).send({ expectedRevision: 0, displayName: "Player One" });
    expect(response.status).toBe(201);
    response = await request(app).post("/api/controller/tournaments/stale-tournament/contestants").set(authHeader(organizer.accessToken)).send({ expectedRevision: 1, displayName: "Player Two" });
    response = await request(app).post("/api/controller/tournaments/stale-tournament/start").set(authHeader(organizer.accessToken)).send({ expectedRevision: 2 });
    const match = response.body.matches.find((item: { status: string }) => item.status === "READY");
    const stale = await request(app).post(`/api/controller/tournaments/stale-tournament/matches/${match.id}/result`).set(authHeader(organizer.accessToken)).send({ expectedRevision: 2, winnerId: match.player1Id });
    expect(stale.status).toBe(409); expect(stale.body.current.tournament.revision).toBe(3);
  });
});
