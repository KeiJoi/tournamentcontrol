import "dotenv/config";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createPersistence } from "./db/persistence.js";
import { AuthService } from "./auth/auth-service.js";
import { BracketService } from "./domain/bracket-service.js";
import { RealtimeHub } from "./realtime.js";

const config = readConfig();
const persistence = openPersistence();
const auth = new AuthService(persistence.tournaments, { serverAccessPassword: config.SERVER_ACCESS_PASSWORD, masterAdminPassword: config.MASTER_ADMIN_PASSWORD, sessionSecret: config.SESSION_SECRET });
const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false });
const realtime = new RealtimeHub(auth, (code) => { const tournament = persistence.tournaments.tournaments.findByPublicCode(code); return tournament ? new BracketService(persistence.tournaments).state(tournament.id) : undefined; });
const app = createApp({ auth, tournaments: persistence.tournaments, publicBaseUrl: config.PUBLIC_BASE_URL, onBracketUpdated: (state) => realtime.publish(state) });
const webAssets = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webAssets)) {
  app.use(express.static(webAssets, { index: false, maxAge: config.NODE_ENV === "production" ? "1h" : 0 }));
  app.get("/{*path}", (request, response, next) => request.path.startsWith("/api/") || request.path === "/health" || request.path === "/ready" ? next() : response.sendFile("index.html", { root: webAssets }));
}
app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error." } }));
const server = createServer(app);
realtime.attach(webSocketServer);
server.on("upgrade", (request, socket, head) => {
  try { if (!request.url || new URL(request.url, "http://localhost").pathname !== "/ws") return socket.destroy(); }
  catch { return socket.destroy(); }
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => webSocketServer.emit("connection", webSocket, request));
});
server.listen(config.PORT, "0.0.0.0", () => console.info(`Tournament Control server listening on port ${config.PORT}`));

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const client of webSocketServer.clients) client.terminate();
  webSocketServer.close();
  server.close(() => { persistence.close(); process.exit(0); });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("uncaughtException", () => { console.error("Fatal server error."); shutdown(); });
process.once("unhandledRejection", () => { console.error("Fatal server error."); shutdown(); });

function openPersistence() {
  try { return createPersistence(config.DATABASE_PATH, config.RETENTION_DAYS, undefined, config.SQLITE_BACKUP_COUNT); }
  catch { console.error("Database initialization failed."); process.exit(1); }
}
