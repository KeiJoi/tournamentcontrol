import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SQLiteBackupService } from "../src/db/backups.js";
import { openDatabase } from "../src/db/database.js";

const directories: string[] = [];
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("SQLite backups", () => {
  it("uses SQLite snapshots and retains only the configured rolling count", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tournament-backup-")); directories.push(directory);
    const database = openDatabase(join(directory, "tournaments.sqlite")); databases.push(database);
    database.exec("CREATE TABLE backup_probe (value TEXT); INSERT INTO backup_probe VALUES ('safe snapshot');");
    const messages: string[] = []; const backups = new SQLiteBackupService(database, join(directory, "tournaments.sqlite"), 2, { info: (message) => messages.push(message), warn: (message) => messages.push(message) });
    await backups.createBackup(); await backups.createBackup(); await backups.createBackup();
    const files = readdirSync(backups.directory).filter((name) => name.endsWith(".sqlite"));
    expect(files).toHaveLength(2); expect(messages.some((message) => message === "SQLite backup completed.")).toBe(true);
  });

  it("does not schedule backups for an in-memory database", async () => {
    const database = openDatabase(":memory:"); databases.push(database);
    const backups = new SQLiteBackupService(database, ":memory:", 7, { info: () => undefined, warn: () => undefined });
    await expect(backups.createBackup()).resolves.toBe(false);
  });
});
