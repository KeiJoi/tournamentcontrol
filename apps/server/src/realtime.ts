import { WebSocket, WebSocketServer } from "ws";
import { realtimeMessageSchema } from "@tournament-control/shared";
import type { IncomingMessage } from "node:http";
import type { AuthService } from "./auth/auth-service.js";
import type { BracketState } from "./domain/bracket-service.js";

export class RealtimeHub {
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  public constructor(private readonly auth: AuthService, private readonly snapshot: (code: string) => BracketState | undefined) {}
  attach(server: WebSocketServer): void {
    server.on("connection", (socket: WebSocket, _request: IncomingMessage) => {
      this.subscriptions.set(socket, new Set()); let alive = true;
      socket.on("pong", () => { alive = true; }); socket.on("close", () => this.subscriptions.delete(socket));
      socket.on("message", (raw) => {
        let parsed: unknown; try { parsed = JSON.parse(raw.toString()); } catch { return this.error(socket, "INVALID_MESSAGE"); }
        const parsedMessage = realtimeMessageSchema.safeParse(parsed); if (!parsedMessage.success) return this.error(socket, "INVALID_MESSAGE");
        const data = parsedMessage.data.data;
        if (data && typeof data === "object" && "accessToken" in data) { try { this.auth.authenticate(String((data as { accessToken: string }).accessToken), "ORGANIZER"); } catch { return this.error(socket, "UNAUTHORIZED"); } }
        if (data?.toString() === "ping") socket.send(JSON.stringify({ version: 1, type: "pong" }));
        if (data && typeof data === "object" && "tournamentCode" in data) { const code = String((data as { tournamentCode: string }).tournamentCode); const subscriptions = this.subscriptions.get(socket)!; if (!subscriptions.has(code) && subscriptions.size >= 32) return this.error(socket, "SUBSCRIPTION_LIMIT"); const state = this.snapshot(code); if (!state) return this.error(socket, "NOT_FOUND"); subscriptions.add(code); socket.send(JSON.stringify(snapshotMessage(state))); }
      });
      const heartbeat = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 30_000); socket.on("close", () => clearInterval(heartbeat));
    });
  }
  publish(state: BracketState): void { const message = JSON.stringify({ ...snapshotMessage(state), type: state.tournament.status === "COMPLETED" ? "tournament.completed" : "tournament.updated" }); for (const [socket, codes] of this.subscriptions) if (codes.has(state.tournament.publicCode) && socket.readyState === WebSocket.OPEN) socket.send(message); }
  private error(socket: WebSocket, code: string) { socket.send(JSON.stringify({ version: 1, type: "error", data: { code } })); }
}
export function snapshotMessage(state: BracketState) {
  const { id: _id, organizerId: _organizerId, ...tournament } = state.tournament;
  const final = state.matches.find((match) => !match.nextWinnerMatchId); const winner = final?.winnerId ? state.contestants.find((item) => item.id === final.winnerId) : undefined;
  return { version: 1, type: "tournament.snapshot", tournamentCode: state.tournament.publicCode, tournamentId: state.tournament.id, revision: state.tournament.revision, data: { tournament, contestants: state.contestants.map(({ tournamentId: _tournamentId, ...item }) => item), rounds: state.rounds.map(({ tournamentId: _tournamentId, ...item }) => item), matches: state.matches.map(({ tournamentId: _tournamentId, ...item }) => item), champion: winner ? { id: winner.id, displayName: winner.displayName, seed: winner.seed } : null } };
}
