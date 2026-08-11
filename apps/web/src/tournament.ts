export type TournamentStatus = "SETUP" | "ACTIVE" | "COMPLETED" | "CANCELLED";
export interface Tournament { publicCode: string; venueName: string; gameName: string; tournamentName: string; eventDate: string; status: TournamentStatus; revision: number; }
export interface Contestant { id: string; displayName: string; seed: number; status: string; }
export interface Round { id: string; roundNumber: number; name: string; }
export interface Match { id: string; roundId: string; position: number; player1Id: string | null; player2Id: string | null; winnerId: string | null; loserId: string | null; status: string; nextWinnerMatchId: string | null; }
export interface SpectatorState { tournament: Tournament; contestants: Contestant[]; rounds: Round[]; matches: Match[]; champion: Pick<Contestant, "id" | "displayName" | "seed"> | null; }

export function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date); }
export function statusLabel(status: TournamentStatus): string { return status === "ACTIVE" ? "LIVE" : status; }
export function wsUrl(): string { const base = import.meta.env.VITE_API_BASE_URL as string | undefined; if (base) return base.replace(/^http/, "ws").replace(/\/$/, "") + "/ws"; return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`; }
