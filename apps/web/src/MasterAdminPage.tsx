import { FormEvent, useEffect, useState } from "react";

type Organizer = { id: string; keyPrefix: string | null; createdAt: string; lastUsedAt: string; revokedAt: string | null };
type Tournament = { id: string; publicCode: string; venueName: string; gameName: string; tournamentName: string; eventDate: string; status: string; playerCount: number; createdAt: string };
type AuditEvent = { id: string; organizerId: string | null; tournamentId: string | null; eventType: string; payload: unknown; createdAt: string };

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

export function MasterAdminPage() {
  const [password, setPassword] = useState(""); const [csrfToken, setCsrfToken] = useState<string | null>(null); const [organizers, setOrganizers] = useState<Organizer[]>([]); const [selected, setSelected] = useState<Organizer | null>(null); const [tournaments, setTournaments] = useState<Tournament[]>([]); const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]); const [message, setMessage] = useState("Checking session…"); const [loading, setLoading] = useState(false);

  useEffect(() => { void checkSession(); }, []);

  async function api(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers); if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken ?? "");
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    if (response.status === 204) return null;
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error((body.error as { message?: string } | undefined)?.message ?? "Request failed.");
    return body;
  }
  async function checkSession() {
    try { const body = await api("/api/master/session") as { csrfToken: string }; setCsrfToken(body.csrfToken); await loadOrganizers(); setMessage("Master session active."); }
    catch { setMessage("Sign in with the system-owner password."); }
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setLoading(true);
    try { const body = await api("/api/master/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ masterAdminPassword: password }) }) as { csrfToken: string }; setPassword(""); setCsrfToken(body.csrfToken); await loadOrganizers(); setMessage("Master session active."); }
    catch { setMessage("Unable to sign in."); }
    finally { setLoading(false); }
  }
  async function loadOrganizers() {
    const body = await api("/api/master/organizers") as { organizers: Organizer[] }; setOrganizers(body.organizers);
  }
  async function selectOrganizer(organizer: Organizer) {
    setSelected(organizer); setAuditEvents([]); setLoading(true);
    try { const body = await api(`/api/master/organizers/${encodeURIComponent(organizer.id)}/tournaments`) as { tournaments: Tournament[] }; setTournaments(body.tournaments); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load tournaments."); }
    finally { setLoading(false); }
  }
  async function changeRevocation(organizer: Organizer) {
    const action = organizer.revokedAt ? "restore" : "revoke";
    if (!window.confirm(`${action === "revoke" ? "Revoke" : "Restore"} this organizer? Existing controller sessions will be invalidated when revoking.`)) return;
    try { await api(`/api/master/organizers/${encodeURIComponent(organizer.id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: organizer.id }) }); await loadOrganizers(); if (selected?.id === organizer.id) await selectOrganizer({ ...organizer, revokedAt: action === "revoke" ? new Date().toISOString() : null }); setMessage(`Organizer ${action}d.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Action failed."); }
  }
  async function deleteTournament(tournament: Tournament) {
    const confirmation = window.prompt(`This permanently deletes the tournament. Type ${tournament.publicCode} to confirm:`);
    if (confirmation !== tournament.publicCode) return;
    try { await api(`/api/master/tournaments/${encodeURIComponent(tournament.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation }) }); if (selected) await selectOrganizer(selected); setMessage("Tournament deleted."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Deletion failed."); }
  }
  async function loadAudit() {
    try { const suffix = selected ? `?organizerId=${encodeURIComponent(selected.id)}` : ""; const body = await api(`/api/master/audit-events${suffix}`) as { auditEvents: AuditEvent[] }; setAuditEvents(body.auditEvents); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load audit history."); }
  }
  async function logout() { try { await api("/api/master/sessions/current", { method: "DELETE" }); setCsrfToken(null); setOrganizers([]); setSelected(null); setTournaments([]); setAuditEvents([]); setMessage("Signed out."); } catch { setMessage("Could not sign out."); } }

  if (!csrfToken) return <main className="admin-page"><section className="admin-card login-card"><p className="eyebrow">System owner</p><h1>Master administration</h1><p>Use the separate master password. It is exchanged only at sign-in and is never bundled with this application.</p><form onSubmit={login}><label>Master password<input aria-label="Master password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></form><p className="admin-message">{message}</p></section></main>;

  return <main className="admin-page"><header className="admin-header"><div><p className="eyebrow">System owner</p><h1>Master administration</h1><p>Organizer keys cannot be viewed or recovered.</p></div><div><button onClick={() => void loadOrganizers()}>Refresh</button><button className="subtle-button" onClick={() => void logout()}>Sign out</button></div></header><p className="admin-message">{message}</p><div className="admin-grid"><section className="admin-card"><h2>Organizers</h2><div className="admin-list">{organizers.map((organizer) => <article className={selected?.id === organizer.id ? "admin-row selected" : "admin-row"} key={organizer.id}><button className="row-button" onClick={() => void selectOrganizer(organizer)}><strong>{organizer.keyPrefix ?? "No prefix"}</strong><span>Created {formatDate(organizer.createdAt)}</span><span>Last used {formatDate(organizer.lastUsedAt)}</span></button><span className={organizer.revokedAt ? "admin-status revoked" : "admin-status"}>{organizer.revokedAt ? "Revoked" : "Active"}</span><button className="danger-button" onClick={() => void changeRevocation(organizer)}>{organizer.revokedAt ? "Restore" : "Revoke"}</button></article>)}</div></section><section className="admin-card"><h2>{selected ? `Tournaments — ${selected.keyPrefix ?? "organizer"}` : "Select an organizer"}</h2>{selected && <><button className="subtle-button" onClick={() => void loadAudit()}>Inspect audit events</button><div className="admin-list">{tournaments.map((tournament) => <article className="admin-row tournament-row" key={tournament.id}><div><strong>{tournament.tournamentName}</strong><span>{tournament.venueName} · {tournament.gameName}</span><span>{formatDate(tournament.eventDate)} · {tournament.status} · {tournament.playerCount} players</span><span>Public code: {tournament.publicCode}</span></div><button className="danger-button" onClick={() => void deleteTournament(tournament)}>Delete</button></article>)}</div></>}</section></div>{auditEvents.length > 0 && <section className="admin-card audit-card"><h2>Audit events</h2>{auditEvents.map((event) => <article className="audit-event" key={event.id}><strong>{event.eventType}</strong><span>{formatDate(event.createdAt)}</span><code>{JSON.stringify(event.payload)}</code></article>)}</section>}</main>;
}
