import { z } from "zod";

export const tournamentFormatSchema = z.enum(["SINGLE_ELIMINATION"]);
export const tournamentStatusSchema = z.enum(["SETUP", "ACTIVE", "COMPLETED", "CANCELLED"]);
export const publicTournamentSchema = z.object({
  shortCode: z.string().min(1).max(16), venueName: z.string().min(1).max(200),
  gameName: z.string().min(1).max(200), tournamentName: z.string().min(1).max(200), eventDate: z.iso.datetime(),
  format: tournamentFormatSchema, status: tournamentStatusSchema, revision: z.number().int().nonnegative(),
});
export type PublicTournament = z.infer<typeof publicTournamentSchema>;

export const realtimeMessageSchema = z.object({ version: z.literal(1), type: z.enum(["subscribe", "authenticate", "ping", "pong", "tournament.snapshot", "tournament.updated", "match.updated", "tournament.completed", "tournament.deleted", "error"]), tournamentCode: z.string().min(1).max(16).optional(), tournamentId: z.string().uuid().optional(), revision: z.number().int().nonnegative().optional(), data: z.unknown().optional() });
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;
