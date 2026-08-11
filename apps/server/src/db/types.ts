export const tournamentFormats = ["SINGLE_ELIMINATION"] as const;
export type TournamentFormat = (typeof tournamentFormats)[number];
export const tournamentStatuses = ["SETUP", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type TournamentStatus = (typeof tournamentStatuses)[number];
export const contestantStatuses = ["ACTIVE", "ELIMINATED", "WITHDRAWN"] as const;
export type ContestantStatus = (typeof contestantStatuses)[number];
export const matchStatuses = ["PENDING", "READY", "IN_PROGRESS", "COMPLETED", "BYE", "REOPENED"] as const;
export type MatchStatus = (typeof matchStatuses)[number];
export const auditEventTypes = ["ORGANIZER_CREATED", "TOURNAMENT_CREATED", "TOURNAMENT_EDITED", "CONTESTANTS_MODIFIED", "SEEDS_REORDERED", "SEEDS_RANDOMIZED", "TOURNAMENT_STARTED", "MATCH_RESULT_RECORDED", "MATCH_RESULT_CORRECTED", "MATCH_REOPENED", "TOURNAMENT_COMPLETED", "TOURNAMENT_CANCELLED", "TOURNAMENT_DELETED", "MASTER_ADMIN_OVERRIDE"] as const;
export type AuditEventType = (typeof auditEventTypes)[number];

export interface Organizer {
  id: string;
  keyHash: string;
  keyLookupDigest: string;
  keyPrefix: string | null;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
}
export type SessionPrincipalType = "ORGANIZER" | "MASTER";
export interface Session {
  id: string;
  tokenDigest: string;
  principalType: SessionPrincipalType;
  organizerId: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface Tournament {
  id: string;
  organizerId: string;
  publicCode: string;
  venueName: string;
  gameName: string;
  tournamentName: string;
  eventDate: string;
  format: TournamentFormat;
  status: TournamentStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
}

export interface Contestant {
  id: string;
  tournamentId: string;
  displayName: string;
  seed: number;
  status: ContestantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Round { id: string; tournamentId: string; roundNumber: number; name: string; }
export interface Match {
  id: string; tournamentId: string; roundId: string; position: number;
  player1Id: string | null; player2Id: string | null; winnerId: string | null; loserId: string | null;
  status: MatchStatus; nextWinnerMatchId: string | null; nextWinnerSlot: 1 | 2 | null; createdAt: string; updatedAt: string; completedAt: string | null;
}

export interface MatchEvent { id: string; tournamentId: string; matchId: string; eventType: string; payloadJson: string; createdAt: string; }
export interface AuditEvent { id: string; organizerId: string | null; tournamentId: string | null; eventType: AuditEventType; payloadJson: string; createdAt: string; }

export interface CreateOrganizerInput { id: string; keyHash: string; keyLookupDigest: string; keyPrefix?: string | null; now?: string; }
export interface CreateTournamentInput {
  id: string; organizerId: string; publicCode: string; venueName: string; gameName: string; tournamentName: string;
  eventDate: string; format?: TournamentFormat; status?: TournamentStatus; now?: string;
}
export interface UpdateTournamentInput {
  venueName?: string; gameName?: string; tournamentName?: string; eventDate?: string; status?: TournamentStatus;
  startedAt?: string | null; completedAt?: string | null; cancelledAt?: string | null; expiresAt?: string | null;
}
