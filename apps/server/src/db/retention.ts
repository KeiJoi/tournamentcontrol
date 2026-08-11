import type { TournamentService } from "./repositories.js";

export interface RetentionScheduler { stop(): void; }

export function startRetentionScheduler(service: TournamentService, intervalMs: number): RetentionScheduler {
  service.cleanupExpired();
  const timer = setInterval(() => service.cleanupExpired(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
