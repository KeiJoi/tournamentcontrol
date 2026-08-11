import { randomBytes, randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { z } from "zod";
import { AuthService, AuthenticationError, ValidationError } from "./auth/auth-service.js";
import type { TournamentService } from "./db/repositories.js";
import type { Organizer, Tournament } from "./db/types.js";
import { BracketError, BracketService } from "./domain/bracket-service.js";

interface AppDependencies { auth?: AuthService; tournaments?: TournamentService; publicBaseUrl?: string; onBracketUpdated?: (state: ReturnType<BracketService["state"]>) => void; }
const userKeySchema = z.string().trim().min(1).max(256);
const credentialSchema = z.object({ serverAccessPassword: z.string().min(1).max(1024), userKey: userKeySchema });
const masterCredentialSchema = z.object({ masterAdminPassword: z.string().min(1).max(1024) });
const editTournamentSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  venueName: z.string().trim().min(1).max(200).optional(), gameName: z.string().trim().min(1).max(200).optional(),
  tournamentName: z.string().trim().min(1).max(200).optional(), eventDate: z.iso.datetime().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), "At least one editable field is required.");
const revisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() });
const createTournamentSchema = z.object({ venueName: z.string().trim().min(1).max(200), gameName: z.string().trim().min(1).max(200), tournamentName: z.string().trim().min(1).max(200), eventDate: z.iso.datetime() });
const masterActionSchema = z.object({ confirmation: z.string().min(1).max(128) });
const masterAuditQuerySchema = z.object({ organizerId: z.string().min(1).max(128).optional(), tournamentId: z.string().min(1).max(128).optional(), limit: z.coerce.number().int().min(1).max(250).optional() });
const masterLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const controllerLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const masterCookieName = "tournament_master_session";
const masterSessionLifetimeMs = 8 * 60 * 60 * 1000;

export function createApp(dependencies: AppDependencies = {}) {
  const bracket = dependencies.tournaments ? new BracketService(dependencies.tournaments) : undefined;
  const bracketPayload = (state: ReturnType<BracketService["state"]>) => { dependencies.onBracketUpdated?.(state); return bracketResponse(state); };
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("X-Frame-Options", "DENY"); response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_request, response) => response.status(200).json({ status: "ok" }));
  app.get("/ready", (_request, response) => response.status(200).json({ status: "ready" }));

  app.get("/api/public/tournaments/:shortCode", (request, response) => {
    const parsed = z.object({ shortCode: z.string().min(1).max(16) }).safeParse(request.params);
    if (!parsed.success) return error(response, 400, "INVALID_SHORT_CODE", "Invalid tournament code.");
    const tournament = dependencies.tournaments?.tournaments.findByPublicCode(parsed.data.shortCode); if (!tournament) return error(response, 404, "TOURNAMENT_NOT_FOUND", "Tournament not found.");
    const state = bracket!.state(tournament.id); return response.status(200).json({ tournament: publicTournament(state.tournament), contestants: state.contestants.map(({ tournamentId: _tournamentId, ...item }) => item), rounds: state.rounds.map(({ tournamentId: _tournamentId, ...item }) => item), matches: state.matches.map(({ tournamentId: _tournamentId, ...item }) => item), champion: champion(state) });
  });

  app.post("/api/controller/organizers", async (request, response) => {
    const input = credentialSchema.safeParse(request.body);
    if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    if (!dependencies.auth) return error(response, 503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
    if (isLoginRateLimited(request, controllerLoginAttempts, 10)) return error(response, 429, "TOO_MANY_ATTEMPTS", "Try again later.");
    try { const session = await dependencies.auth.createOrganizer(input.data.serverAccessPassword, input.data.userKey); clearLoginAttempts(request, controllerLoginAttempts); return response.status(201).json(sessionResponse(session)); }
    catch (exception) { recordLoginFailure(request, controllerLoginAttempts); return authenticationFailure(response, exception); }
  });

  app.post("/api/controller/sessions", async (request, response) => {
    const input = credentialSchema.safeParse(request.body);
    if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    if (!dependencies.auth) return error(response, 503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
    if (isLoginRateLimited(request, controllerLoginAttempts, 10)) return error(response, 429, "TOO_MANY_ATTEMPTS", "Try again later.");
    try { const session = await dependencies.auth.loginOrganizer(input.data.serverAccessPassword, input.data.userKey); clearLoginAttempts(request, controllerLoginAttempts); return response.status(200).json(sessionResponse(session)); }
    catch (exception) { recordLoginFailure(request, controllerLoginAttempts); return authenticationFailure(response, exception); }
  });

  app.delete("/api/controller/sessions/current", (request, response) => {
    try { requireAuth(request, dependencies.auth, "ORGANIZER").auth.logout(bearerToken(request), "ORGANIZER"); return response.status(204).send(); }
    catch (exception) { return authenticationFailure(response, exception); }
  });

  app.get("/api/controller/tournaments", (request, response) => {
    try {
      const principal = requireAuth(request, dependencies.auth, "ORGANIZER");
      const query = z.object({ q: z.string().max(200).optional(), tournamentName: z.string().max(200).optional(), venueName: z.string().max(200).optional(), gameName: z.string().max(200).optional(), eventDate: z.iso.datetime().optional(), status: z.enum(["SETUP", "ACTIVE", "COMPLETED", "CANCELLED"]).optional() }).safeParse(request.query); if (!query.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
      const needle = (query.data.q ?? "").toLocaleLowerCase(); const tournaments = dependencies.tournaments!.tournaments.listByOrganizer(principal.organizer.id).filter((item) => (!needle || [item.tournamentName, item.venueName, item.gameName].some((value) => value.toLocaleLowerCase().includes(needle))) && (!query.data.tournamentName || item.tournamentName.toLocaleLowerCase().includes(query.data.tournamentName.toLocaleLowerCase())) && (!query.data.venueName || item.venueName.toLocaleLowerCase().includes(query.data.venueName.toLocaleLowerCase())) && (!query.data.gameName || item.gameName.toLocaleLowerCase().includes(query.data.gameName.toLocaleLowerCase())) && (!query.data.eventDate || item.eventDate === query.data.eventDate) && (!query.data.status || item.status === query.data.status));
      return response.json({ tournaments: tournaments.map((item) => ({ ...controllerTournament(item), playerCount: dependencies.tournaments!.bracket.countContestants(item.id) })) });
    } catch (exception) { return authenticationFailure(response, exception); }
  });
  app.post("/api/controller/tournaments", (request, response) => {
    const input = createTournamentSchema.safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; const tournament = dependencies.tournaments!.transaction(() => { let code: string | undefined; for (let attempt = 0; attempt < 10; attempt++) { const candidate = publicCode(); if (!dependencies.tournaments!.tournaments.findByPublicCode(candidate)) { code = candidate; break; } } if (!code) throw new Error("Could not allocate public code."); const created = dependencies.tournaments!.tournaments.create({ id: randomUUID(), organizerId: owner.id, publicCode: code, ...input.data }); dependencies.tournaments!.bracket.appendAuditEvent({ id: randomUUID(), organizerId: owner.id, tournamentId: created.id, eventType: "TOURNAMENT_CREATED", payloadJson: "{}", createdAt: created.createdAt }); return created; }); return response.status(201).json({ tournament: controllerTournament(tournament), publicUrl: `${dependencies.publicBaseUrl ?? ""}/t/${tournament.publicCode}` }); } catch (exception) { return authenticationFailure(response, exception); }
  });
  app.get("/api/controller/tournaments/:id/state", (request, response) => { try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; const state = bracket!.state(request.params.id); if (state.tournament.organizerId !== owner.id) return error(response, 404, "TOURNAMENT_NOT_FOUND", "Tournament not found."); return response.json(bracketResponse(state)); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); } });
  app.get("/api/controller/tournaments/:id/public-url", (request, response) => { try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; const tournament = dependencies.tournaments!.tournaments.findById(request.params.id); if (!tournament || tournament.organizerId !== owner.id) return error(response, 404, "TOURNAMENT_NOT_FOUND", "Tournament not found."); return response.json({ publicUrl: `${dependencies.publicBaseUrl ?? ""}/t/${tournament.publicCode}` }); } catch (exception) { return authenticationFailure(response, exception); } });
  app.post("/api/controller/tournaments/:id/cancel", (request, response) => { const input = revisionSchema.safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request."); try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; const tournament = dependencies.tournaments!.tournaments.findById(request.params.id); if (!tournament || tournament.organizerId !== owner.id) return error(response, 404, "TOURNAMENT_NOT_FOUND", "Tournament not found."); if (tournament.status === "COMPLETED" || tournament.status === "CANCELLED") return error(response, 400, "INVALID_TOURNAMENT_STATE", "Tournament cannot be cancelled."); const cancelled = dependencies.tournaments!.cancelTournament(tournament.id, input.data.expectedRevision); if (!cancelled) return error(response, 409, "STALE_TOURNAMENT", "Tournament changed; refresh and retry."); dependencies.tournaments!.bracket.appendAuditEvent({ id: randomUUID(), organizerId: owner.id, tournamentId: tournament.id, eventType: "TOURNAMENT_CANCELLED", payloadJson: "{}", createdAt: cancelled.cancelledAt! }); const state = bracket!.state(tournament.id); return response.json(bracketPayload(state)); } catch (exception) { return authenticationFailure(response, exception); } });

  app.patch("/api/controller/tournaments/:id", (request, response) => {
    const input = editTournamentSchema.safeParse(request.body);
    if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try {
      const principal = requireAuth(request, dependencies.auth, "ORGANIZER");
      const tournament = dependencies.tournaments!.tournaments.findById(request.params.id);
      if (!tournament || tournament.organizerId !== principal.organizer.id) return error(response, 404, "TOURNAMENT_NOT_FOUND", "Tournament not found."); if (tournament.status !== "SETUP") return error(response, 400, "INVALID_TOURNAMENT_STATE", "Only setup metadata may be edited.");
      const { expectedRevision, ...update } = input.data;
      const changed = dependencies.tournaments!.transaction(() => {
        const result = dependencies.tournaments!.tournaments.update(tournament.id, expectedRevision, update);
        if (result) dependencies.tournaments!.bracket.appendAuditEvent({ id: randomUUID(), organizerId: principal.organizer.id, tournamentId: result.id, eventType: "TOURNAMENT_EDITED", payloadJson: JSON.stringify({ revision: result.revision }), createdAt: result.updatedAt });
        return result;
      });
      if (!changed) return error(response, 409, "STALE_TOURNAMENT", "Tournament changed; refresh and retry.");
      return response.json({ tournament: controllerTournament(changed) });
    } catch (exception) { return authenticationFailure(response, exception); }
  });

  app.post("/api/controller/tournaments/:id/contestants", (request, response) => {
    const input = revisionSchema.extend({ displayName: z.string().min(1).max(200).optional(), bulkText: z.string().max(50_000).optional() }).safeParse(request.body);
    if (!input.success || Boolean(input.data.displayName) === Boolean(input.data.bulkText)) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; const state = input.data.displayName ? bracket!.add(request.params.id, owner.id, input.data.expectedRevision, input.data.displayName) : bracket!.bulkAdd(request.params.id, owner.id, input.data.expectedRevision, input.data.bulkText!); return response.status(201).json(bracketPayload(state)); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.patch("/api/controller/tournaments/:id/contestants/:contestantId", (request, response) => {
    const input = revisionSchema.extend({ displayName: z.string().min(1).max(200) }).safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.edit(request.params.id, owner.id, input.data.expectedRevision, request.params.contestantId, input.data.displayName))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.delete("/api/controller/tournaments/:id/contestants/:contestantId", (request, response) => {
    const input = revisionSchema.safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.remove(request.params.id, owner.id, input.data.expectedRevision, request.params.contestantId))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.put("/api/controller/tournaments/:id/seeds", (request, response) => {
    const input = revisionSchema.extend({ contestantIds: z.array(z.string().uuid()).max(512) }).safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.reorder(request.params.id, owner.id, input.data.expectedRevision, input.data.contestantIds))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.post("/api/controller/tournaments/:id/seeds/randomize", (request, response) => {
    const input = revisionSchema.safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.randomize(request.params.id, owner.id, input.data.expectedRevision))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.post("/api/controller/tournaments/:id/start", (request, response) => {
    const input = revisionSchema.safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.start(request.params.id, owner.id, input.data.expectedRevision))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.post("/api/controller/tournaments/:id/matches/:matchId/result", (request, response) => {
    const input = revisionSchema.extend({ winnerId: z.string().uuid() }).safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.recordResult(request.params.id, owner.id, input.data.expectedRevision, request.params.matchId, input.data.winnerId))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });
  app.post("/api/controller/tournaments/:id/matches/:matchId/correction", (request, response) => {
    const input = revisionSchema.extend({ winnerId: z.string().uuid(), rollbackDownstream: z.boolean().default(false) }).safeParse(request.body); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { const owner = requireAuth(request, dependencies.auth, "ORGANIZER").organizer; return response.json(bracketPayload(bracket!.correct(request.params.id, owner.id, input.data.expectedRevision, request.params.matchId, input.data.winnerId, input.data.rollbackDownstream))); } catch (exception) { return bracketFailure(response, exception, bracket, request.params.id); }
  });

  app.post("/api/master/sessions", (request, response) => {
    const input = masterCredentialSchema.safeParse(request.body);
    if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    if (!dependencies.auth) return error(response, 503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
    if (isLoginRateLimited(request, masterLoginAttempts, 5)) return error(response, 429, "TOO_MANY_ATTEMPTS", "Try again later.");
    try {
      const session = dependencies.auth.loginMaster(input.data.masterAdminPassword);
      clearLoginAttempts(request, masterLoginAttempts);
      response.cookie(masterCookieName, session.accessToken, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/master", maxAge: masterSessionLifetimeMs });
      return response.status(200).json({ authenticated: true, expiresAt: session.expiresAt, csrfToken: dependencies.auth.csrfToken(session.accessToken) });
    } catch (exception) { recordLoginFailure(request, masterLoginAttempts); return authenticationFailure(response, exception); }
  });
  app.delete("/api/master/sessions/current", (request, response) => {
    try { const principal = requireMaster(request, dependencies.auth, true); principal.auth.logout(principal.token, "MASTER"); response.clearCookie(masterCookieName, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/master" }); return response.status(204).send(); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.get("/api/master/session", (request, response) => {
    try { const principal = requireMaster(request, dependencies.auth); return response.json({ authenticated: true, csrfToken: principal.auth.csrfToken(principal.token) }); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.get("/api/master/organizers", (request, response) => {
    try { requireMaster(request, dependencies.auth); return response.json({ organizers: dependencies.tournaments!.organizers.list().map(masterOrganizer) }); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.get("/api/master/organizers/:id/tournaments", (request, response) => {
    try { requireMaster(request, dependencies.auth); const organizer = dependencies.tournaments!.organizers.findById(request.params.id); if (!organizer) return error(response, 404, "ORGANIZER_NOT_FOUND", "Organizer not found."); return response.json({ tournaments: dependencies.tournaments!.tournaments.listByOrganizer(organizer.id).map((item) => masterTournament(item, dependencies.tournaments!.bracket.countContestants(item.id))) }); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.post("/api/master/organizers/:id/revoke", (request, response) => {
    const input = masterActionSchema.safeParse(request.body); if (!input.success || input.data.confirmation !== request.params.id) return error(response, 400, "CONFIRMATION_REQUIRED", "Organizer confirmation is required.");
    try { const principal = requireMaster(request, dependencies.auth, true); const organizer = dependencies.tournaments!.organizers.findById(request.params.id); if (!organizer) return error(response, 404, "ORGANIZER_NOT_FOUND", "Organizer not found."); dependencies.tournaments!.transaction(() => { dependencies.tournaments!.organizers.revoke(organizer.id); dependencies.tournaments!.sessions.revokeForOrganizer(organizer.id); dependencies.tournaments!.bracket.appendAuditEvent({ id: randomUUID(), organizerId: organizer.id, tournamentId: null, eventType: "MASTER_ADMIN_OVERRIDE", payloadJson: JSON.stringify({ action: "ORGANIZER_REVOKED", masterSession: principal.session.id }), createdAt: new Date().toISOString() }); }); return response.json({ organizer: masterOrganizer(dependencies.tournaments!.organizers.findById(organizer.id)!) }); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.post("/api/master/organizers/:id/restore", (request, response) => {
    const input = masterActionSchema.safeParse(request.body); if (!input.success || input.data.confirmation !== request.params.id) return error(response, 400, "CONFIRMATION_REQUIRED", "Organizer confirmation is required.");
    try { const principal = requireMaster(request, dependencies.auth, true); const organizer = dependencies.tournaments!.organizers.findById(request.params.id); if (!organizer) return error(response, 404, "ORGANIZER_NOT_FOUND", "Organizer not found."); dependencies.tournaments!.transaction(() => { dependencies.tournaments!.organizers.restore(organizer.id); dependencies.tournaments!.bracket.appendAuditEvent({ id: randomUUID(), organizerId: organizer.id, tournamentId: null, eventType: "MASTER_ADMIN_OVERRIDE", payloadJson: JSON.stringify({ action: "ORGANIZER_RESTORED", masterSession: principal.session.id }), createdAt: new Date().toISOString() }); }); return response.json({ organizer: masterOrganizer(dependencies.tournaments!.organizers.findById(organizer.id)!) }); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.delete("/api/master/tournaments/:id", (request, response) => {
    const input = masterActionSchema.safeParse(request.body); if (!input.success) return error(response, 400, "CONFIRMATION_REQUIRED", "Tournament public-code confirmation is required.");
    try { const principal = requireMaster(request, dependencies.auth, true); const tournament = dependencies.tournaments!.tournaments.findById(request.params.id); if (!tournament) return error(response, 404, "TOURNAMENT_NOT_FOUND", "Tournament not found."); if (input.data.confirmation !== tournament.publicCode) return error(response, 400, "CONFIRMATION_REQUIRED", "Tournament public-code confirmation is required."); dependencies.tournaments!.transaction(() => { dependencies.tournaments!.bracket.appendAuditEvent({ id: randomUUID(), organizerId: tournament.organizerId, tournamentId: null, eventType: "TOURNAMENT_DELETED", payloadJson: JSON.stringify({ action: "MASTER_DELETED", deletedTournamentId: tournament.id, publicCode: tournament.publicCode, masterSession: principal.session.id }), createdAt: new Date().toISOString() }); dependencies.tournaments!.tournaments.delete(tournament.id); }); return response.status(204).send(); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  app.get("/api/master/audit-events", (request, response) => {
    const input = masterAuditQuerySchema.safeParse(request.query); if (!input.success) return error(response, 400, "INVALID_REQUEST", "Invalid request.");
    try { requireMaster(request, dependencies.auth); return response.json({ auditEvents: dependencies.tournaments!.bracket.listAuditEvents(input.data).map((event) => ({ ...event, payload: JSON.parse(event.payloadJson), payloadJson: undefined })) }); }
    catch (exception) { return authenticationFailure(response, exception); }
  });
  return app;
}

function requireAuth(request: Request, auth: AuthService | undefined, type: "ORGANIZER" | "MASTER") {
  if (!auth) throw new AuthenticationError("Authentication unavailable.");
  const principal = auth.authenticate(bearerToken(request), type);
  if (type === "ORGANIZER" && !principal.organizer) throw new AuthenticationError("Invalid session.");
  return { auth, organizer: principal.organizer as Organizer };
}
function requireMaster(request: Request, auth: AuthService | undefined, requireCsrf = false) {
  if (!auth) throw new AuthenticationError("Authentication unavailable.");
  const cookieToken = cookieValue(request, masterCookieName); const token = cookieToken ?? bearerToken(request);
  if (requireCsrf && (!cookieToken || !auth.verifyCsrfToken(token, request.header("x-csrf-token") ?? ""))) throw new AuthenticationError("Invalid request.");
  const principal = auth.authenticate(token, "MASTER");
  return { auth, token, session: principal.session };
}
function bearerToken(request: Request): string {
  const value = request.header("authorization");
  if (!value?.startsWith("Bearer ") || value.length <= 7) throw new AuthenticationError("Invalid session.");
  return value.slice(7);
}
function cookieValue(request: Request, name: string): string | undefined {
  const prefix = `${name}=`;
  return request.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}
function isLoginRateLimited(request: Request, attempts: Map<string, { count: number; resetAt: number }>, maximum: number): boolean {
  const attempt = attempts.get(request.ip ?? "unknown"); return Boolean(attempt && attempt.count >= maximum && attempt.resetAt > Date.now());
}
function recordLoginFailure(request: Request, attempts: Map<string, { count: number; resetAt: number }>): void {
  const ip = request.ip ?? "unknown"; const existing = attempts.get(ip); const now = Date.now();
  const next = !existing || existing.resetAt <= now ? { count: 1, resetAt: now + 10 * 60 * 1000 } : { ...existing, count: existing.count + 1 };
  attempts.set(ip, next);
}
function clearLoginAttempts(request: Request, attempts: Map<string, { count: number; resetAt: number }>): void { attempts.delete(request.ip ?? "unknown"); }
function sessionResponse(session: { accessToken: string; expiresAt: string; organizer: Organizer | null }) {
  return { accessToken: session.accessToken, expiresAt: session.expiresAt, organizer: session.organizer ? { id: session.organizer.id, keyPrefix: session.organizer.keyPrefix, createdAt: session.organizer.createdAt } : null };
}
function publicTournament(tournament: Tournament) {
  const { id: _id, organizerId: _organizerId, ...publicFields } = tournament;
  return publicFields;
}
function champion(state: ReturnType<BracketService["state"]>) { const final = state.matches.find((match) => !match.nextWinnerMatchId); const contestant = final?.winnerId ? state.contestants.find((item) => item.id === final.winnerId) : undefined; return contestant ? { id: contestant.id, displayName: contestant.displayName, seed: contestant.seed } : null; }
function publicCode(): string { const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; const bytes = randomBytes(6); return [...bytes].map((byte) => alphabet[byte % alphabet.length]!).join(""); }
function controllerTournament(tournament: Tournament) {
  const { organizerId: _organizerId, ...fields } = tournament;
  return fields;
}
function masterOrganizer(organizer: Organizer) { return { id: organizer.id, keyPrefix: organizer.keyPrefix ? `${organizer.keyPrefix}…` : null, createdAt: organizer.createdAt, lastUsedAt: organizer.lastUsedAt, revokedAt: organizer.revokedAt }; }
function masterTournament(tournament: Tournament, playerCount: number) { return { id: tournament.id, publicCode: tournament.publicCode, venueName: tournament.venueName, gameName: tournament.gameName, tournamentName: tournament.tournamentName, eventDate: tournament.eventDate, status: tournament.status, playerCount, createdAt: tournament.createdAt }; }
function bracketResponse(state: ReturnType<BracketService["state"]>) { return { tournament: controllerTournament(state.tournament), contestants: state.contestants, matches: state.matches }; }
function bracketFailure(response: express.Response, exception: unknown, bracket: BracketService | undefined, tournamentId: string) {
  if (exception instanceof BracketError) {
    if (exception.code === "STALE") { const current = bracket?.state(tournamentId); return response.status(409).json({ error: { code: "STALE_TOURNAMENT", message: exception.message }, current: current ? bracketResponse(current) : undefined }); }
    return error(response, exception.code === "UNSAFE" ? 409 : 400, exception.code === "UNSAFE" ? "UNSAFE_CORRECTION" : "INVALID_BRACKET_OPERATION", exception.message);
  }
  return authenticationFailure(response, exception);
}
function error(response: express.Response, status: number, code: string, message: string) { return response.status(status).json({ error: { code, message } }); }
function authenticationFailure(response: express.Response, exception: unknown) {
  if (exception instanceof ValidationError) return error(response, 400, "INVALID_USER_KEY", exception.message);
  if (exception instanceof AuthenticationError) return error(response, 401, "UNAUTHORIZED", "Unauthorized.");
  throw exception;
}
