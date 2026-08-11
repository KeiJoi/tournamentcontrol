import type Database from "better-sqlite3";
import { openDatabase } from "./database.js";
import { startRetentionScheduler, type RetentionScheduler } from "./retention.js";
import { TournamentService } from "./repositories.js";
import { SQLiteBackupService } from "./backups.js";

export interface Persistence {
  database: Database.Database;
  tournaments: TournamentService;
  backups: SQLiteBackupService;
  close(): void;
}

export function createPersistence(databasePath: string, retentionDays = 30, retentionIntervalMs = 60 * 60 * 1000, backupCount = 7): Persistence {
  const database = openDatabase(databasePath);
  const tournaments = new TournamentService(database, retentionDays);
  const retention: RetentionScheduler = startRetentionScheduler(tournaments, retentionIntervalMs);
  const backups = new SQLiteBackupService(database, databasePath, backupCount);
  backups.start();
  return { database, tournaments, backups, close: () => { backups.stop(); retention.stop(); database.close(); } };
}
