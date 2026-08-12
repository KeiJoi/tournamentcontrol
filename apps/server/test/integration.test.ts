import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/auth-service.js";
import { openDatabase } from "../src/db/database.js";
import { TournamentService } from "../src/db/repositories.js";
import { BracketService } from "../src/domain/bracket-service.js";
import { RealtimeHub } from "../src/realtime.js";

const directories: string[] = [];
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const databases: ReturnType<typeof openDatabase>[] = [];
const credentials = { serverAccessPassword: "integration-server-password", masterAdminPassword: "integration-master-password", sessionSecret: "integration-session-secret-that-is-long-enough" };
const userKey = "Aster!Comet2026-Integration";
const otherUserKey = "Beryl!Orbit2026-Integration";

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function authorization(token: string) { return { Authorization: `Bearer ${token}` }; }
function nextMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), 5_000);
    socket.on("message", function listener(raw) {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === "error") { clearTimeout(timeout); socket.off("message", listener); reject(new Error(`WebSocket error: ${JSON.stringify(message.data)}`)); return; }
      if (message.type !== type) return;
      clearTimeout(timeout); socket.off("message", listener); resolve(message);
    });
  });
}
async function connect(port: number, code: string, token?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(socket); await once(socket, "open");
  const snapshot = nextMessage(socket, "tournament.snapshot");
  socket.send(JSON.stringify({ version: 1, type: "subscribe", data: { tournamentCode: code, ...(token ? { accessToken: token } : {}) } }));
  await snapshot;
  return socket;
}

describe("full tournament integration", () => {
  it("runs a 13-player tournament through live updates, restart, isolation, and retention", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tournament-integration-")); directories.push(directory);
    const databasePath = join(directory, "tournaments.sqlite"); const database = openDatabase(databasePath); databases.push(database);
    const tournaments = new TournamentService(database, 30); const auth = new AuthService(tournaments, credentials);
    const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
    const realtime = new RealtimeHub(auth, (code) => { const tournament = tournaments.tournaments.findByPublicCode(code); return tournament ? new BracketService(tournaments).state(tournament.id) : undefined; });
    const app = createApp({ auth, tournaments, publicBaseUrl: "http://localhost", onBracketUpdated: (state) => realtime.publish(state) }); const server = createServer(app); servers.push(server); realtime.attach(websocketServer);
    server.on("upgrade", (incoming, socket, head) => { if (new URL(incoming.url ?? "/", "http://localhost").pathname !== "/ws") return socket.destroy(); websocketServer.handleUpgrade(incoming, socket, head, (webSocket) => websocketServer.emit("connection", webSocket, incoming)); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve())); const port = (server.address() as { port: number }).port;

    const health = await request(server).get("/health"); expect(health.status).toBe(200);
    const createdOrganizer = await request(server).post("/api/controller/organizers").send({ serverAccessPassword: credentials.serverAccessPassword, userKey }); expect(createdOrganizer.status).toBe(201);
    const controllerA = createdOrganizer.body.accessToken as string;
    const controllerBLogin = await request(server).post("/api/controller/sessions").send({ serverAccessPassword: credentials.serverAccessPassword, userKey }); expect(controllerBLogin.status).toBe(200); const controllerB = controllerBLogin.body.accessToken as string;
    const otherOrganizer = await request(server).post("/api/controller/organizers").send({ serverAccessPassword: credentials.serverAccessPassword, userKey: otherUserKey }); expect(otherOrganizer.status).toBe(201);

    const createdTournament = await request(server).post("/api/controller/tournaments").set(authorization(controllerA)).send({ venueName: "The Vat", gameName: "Deathroll", tournamentName: "Test Deathroll", eventDate: "2026-08-15T19:00:00.000-05:00" });
    expect(createdTournament.status).toBe(201); const tournamentId = createdTournament.body.tournament.id as string; const publicCode = createdTournament.body.tournament.publicCode as string;
    let revision = createdTournament.body.tournament.revision as number;
    for (let index = 1; index <= 13; index++) { const added = await request(server).post(`/api/controller/tournaments/${tournamentId}/contestants`).set(authorization(controllerA)).send({ expectedRevision: revision, displayName: `Player ${index}` }); expect(added.status).toBe(201); revision = added.body.tournament.revision; }
    let state = (await request(server).get(`/api/controller/tournaments/${tournamentId}/state`).set(authorization(controllerA))).body;
    const reversed = state.contestants.map((item: { id: string }) => item.id).reverse();
    let mutation = await request(server).put(`/api/controller/tournaments/${tournamentId}/seeds`).set(authorization(controllerA)).send({ expectedRevision: revision, contestantIds: reversed }); expect(mutation.status).toBe(200); revision = mutation.body.tournament.revision;
    mutation = await request(server).post(`/api/controller/tournaments/${tournamentId}/seeds/randomize`).set(authorization(controllerA)).send({ expectedRevision: revision }); expect(mutation.status).toBe(200); revision = mutation.body.tournament.revision;
    mutation = await request(server).post(`/api/controller/tournaments/${tournamentId}/start`).set(authorization(controllerA)).send({ expectedRevision: revision }); expect(mutation.status).toBe(200); state = mutation.body; revision = state.tournament.revision;
    expect(state.matches.some((match: { status: string }) => match.status === "BYE")).toBe(true);
    const publicBefore = await request(server).get(`/api/public/tournaments/${publicCode}`); expect(publicBefore.status).toBe(200); expect(publicBefore.body.tournament.organizerId).toBeUndefined(); expect(publicBefore.body.contestants).toHaveLength(13);

    const controllerSocketA = await connect(port, publicCode, controllerA); const controllerSocketB = await connect(port, publicCode, controllerB); const spectatorSocket = await connect(port, publicCode);
    const ready = state.matches.find((match: { status: string }) => match.status === "READY") as { id: string; player1Id: string };
    const updateA = nextMessage(controllerSocketA, "tournament.updated"); const updateB = nextMessage(controllerSocketB, "tournament.updated"); const publicUpdate = nextMessage(spectatorSocket, "tournament.updated");
    mutation = await request(server).post(`/api/controller/tournaments/${tournamentId}/matches/${ready.id}/result`).set(authorization(controllerA)).send({ expectedRevision: revision, winnerId: ready.player1Id }); expect(mutation.status).toBe(200); state = mutation.body;
    await Promise.all([updateA, updateB, publicUpdate]);
    const stale = await request(server).post(`/api/controller/tournaments/${tournamentId}/matches/${ready.id}/result`).set(authorization(controllerB)).send({ expectedRevision: revision, winnerId: ready.player1Id }); expect(stale.status).toBe(409); expect(stale.body.current.tournament.revision).toBe(state.tournament.revision);

    while (state.tournament.status === "ACTIVE") {
      const current = state.matches.find((match: { status: string }) => match.status === "READY") as { id: string; player1Id: string } | undefined;
      expect(current).toBeDefined();
      mutation = await request(server).post(`/api/controller/tournaments/${tournamentId}/matches/${current!.id}/result`).set(authorization(controllerA)).send({ expectedRevision: state.tournament.revision, winnerId: current!.player1Id }); expect(mutation.status).toBe(200); state = mutation.body;
    }
    expect(state.tournament.status).toBe("COMPLETED"); expect(state.tournament.completedAt).toBeTruthy(); expect(state.tournament.expiresAt).toBeTruthy();
    const publicCompleted = await request(server).get(`/api/public/tournaments/${publicCode}`); expect(publicCompleted.status).toBe(200); expect(publicCompleted.body.champion).toBeTruthy();
    for (const query of [{ q: "Test Deathroll" }, { venueName: "The Vat" }, { gameName: "Deathroll" }, { eventDate: "2026-08-15T19:00:00.000-05:00" }]) { const listing = await request(server).get("/api/controller/tournaments").query(query).set(authorization(controllerA)); expect(listing.status).toBe(200); expect(listing.body.tournaments.some((item: { id: string }) => item.id === tournamentId)).toBe(true); }
    expect((await request(server).get(`/api/controller/tournaments/${tournamentId}/state`).set(authorization(otherOrganizer.body.accessToken))).status).toBe(404); expect((await request(server).patch(`/api/public/tournaments/${publicCode}`).send({})).status).toBe(404);

    const setup = tournaments.tournaments.create({ id: randomUUID(), organizerId: createdOrganizer.body.organizer.id, publicCode: "SETUP2", venueName: "The Vat", gameName: "Deathroll", tournamentName: "Setup survives", eventDate: "2026-08-16T19:00:00.000Z" });
    const active = tournaments.tournaments.create({ id: randomUUID(), organizerId: createdOrganizer.body.organizer.id, publicCode: "ACTIVE2", venueName: "The Vat", gameName: "Deathroll", tournamentName: "Active survives", eventDate: "2026-08-16T19:00:00.000Z", status: "ACTIVE" });
    const cancelled = tournaments.tournaments.create({ id: randomUUID(), organizerId: createdOrganizer.body.organizer.id, publicCode: "CANCEL2", venueName: "The Vat", gameName: "Deathroll", tournamentName: "Cancelled expires", eventDate: "2026-08-16T19:00:00.000Z" }); tournaments.cancelTournament(cancelled.id, 0, "2020-01-01T00:00:00.000Z");
    expect(tournaments.cleanupExpired("2026-08-20T00:00:00.000Z")).toBeGreaterThanOrEqual(1); expect(tournaments.tournaments.findById(setup.id)).toBeDefined(); expect(tournaments.tournaments.findById(active.id)).toBeDefined(); expect(tournaments.tournaments.findById(tournamentId)).toBeDefined();

    for (const socket of sockets.splice(0)) socket.terminate(); websocketServer.close(); await new Promise<void>((resolve) => server.close(() => resolve())); servers.splice(servers.indexOf(server), 1); database.close(); databases.splice(databases.indexOf(database), 1);
    const reopenedDatabase = openDatabase(databasePath); databases.push(reopenedDatabase); const reopenedService = new TournamentService(reopenedDatabase, 30); const reopenedAuth = new AuthService(reopenedService, credentials);
    expect(reopenedService.tournaments.findById(tournamentId)?.status).toBe("COMPLETED"); expect((await reopenedAuth.loginOrganizer(credentials.serverAccessPassword, userKey)).organizer?.id).toBe(createdOrganizer.body.organizer.id);
  }, 30_000);
});
