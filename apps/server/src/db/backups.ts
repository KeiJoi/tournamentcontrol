import { accessSync, constants, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";

const backupPrefix = "tournament-";
const backupSuffix = ".sqlite";

export interface BackupLogger { info(message: string): void; warn(message: string): void; }

export class SQLiteBackupService {
  public readonly directory: string;
  private timer: NodeJS.Timeout | undefined;
  private enabled = false;
  private creating = false;

  public constructor(private readonly database: Database.Database, databasePath: string, private readonly count: number, private readonly logger: BackupLogger = console) {
    this.directory = join(dirname(databasePath), "backups");
    if (databasePath === ":memory:") return;
    try { mkdirSync(this.directory, { recursive: true }); accessSync(this.directory, constants.R_OK | constants.W_OK); this.enabled = true; }
    catch { this.logger.warn("SQLite backups are unavailable; continuing without scheduled backups."); }
  }

  start(intervalMs = 24 * 60 * 60 * 1000): void {
    if (!this.enabled) return;
    void this.createBackup();
    this.timer = setInterval(() => void this.createBackup(), intervalMs);
    this.timer.unref();
  }

  async createBackup(): Promise<boolean> {
    if (!this.enabled || this.creating) return false;
    this.creating = true;
    const filename = `${backupPrefix}${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}${backupSuffix}`;
    const destination = join(this.directory, filename);
    try {
      await this.database.backup(destination);
      this.prune();
      this.logger.info("SQLite backup completed.");
      return true;
    } catch {
      try { rmSync(destination, { force: true }); } catch { /* Best-effort removal of an incomplete backup. */ }
      this.logger.warn("SQLite backup failed; the service will continue and retry on the next schedule.");
      return false;
    } finally {
      this.creating = false;
    }
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  private prune(): void {
    try {
      const backups = readdirSync(this.directory).filter((name) => name.startsWith(backupPrefix) && name.endsWith(backupSuffix)).map((name) => ({ name, modified: statSync(join(this.directory, name)).mtimeMs })).sort((left, right) => right.modified - left.modified);
      for (const backup of backups.slice(this.count)) rmSync(join(this.directory, backup.name), { force: true });
    } catch { this.logger.warn("SQLite backup retention cleanup failed; existing backups were kept."); }
  }
}
