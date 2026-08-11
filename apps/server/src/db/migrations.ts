import type Database from "better-sqlite3";

export interface Migration { version: number; name: string; up: (database: Database.Database) => void; }

const initialSchema: Migration = {
  version: 1,
  name: "initial_tournament_schema",
  up(database) {
    database.exec(`
      CREATE TABLE organizers (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL,
        key_lookup_digest TEXT NOT NULL UNIQUE,
        key_prefix TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE TABLE tournaments (
        id TEXT PRIMARY KEY,
        organizer_id TEXT NOT NULL REFERENCES organizers(id) ON DELETE RESTRICT,
        public_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        venue_name TEXT NOT NULL,
        game_name TEXT NOT NULL,
        tournament_name TEXT NOT NULL,
        event_date TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('SINGLE_ELIMINATION')),
        status TEXT NOT NULL CHECK (status IN ('SETUP', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        expires_at TEXT,
        CHECK ((status != 'COMPLETED') OR completed_at IS NOT NULL),
        CHECK ((status != 'CANCELLED') OR cancelled_at IS NOT NULL)
      );
      CREATE INDEX tournaments_organizer_id_idx ON tournaments(organizer_id);
      CREATE INDEX tournaments_expiration_idx ON tournaments(status, expires_at) WHERE expires_at IS NOT NULL;

      CREATE TABLE contestants (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        seed INTEGER NOT NULL CHECK (seed > 0),
        status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ELIMINATED', 'WITHDRAWN')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(tournament_id, seed),
        UNIQUE(id, tournament_id)
      );
      CREATE INDEX contestants_tournament_id_idx ON contestants(tournament_id);

      CREATE TABLE rounds (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        round_number INTEGER NOT NULL CHECK (round_number > 0),
        name TEXT NOT NULL,
        UNIQUE(tournament_id, round_number),
        UNIQUE(id, tournament_id)
      );

      CREATE TABLE matches (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        round_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position > 0),
        player1_id TEXT,
        player2_id TEXT,
        winner_id TEXT,
        loser_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'BYE', 'REOPENED')),
        next_winner_match_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(round_id, position),
        CHECK (player1_id IS NULL OR player1_id != player2_id),
        CHECK (winner_id IS NULL OR winner_id = player1_id OR winner_id = player2_id),
        CHECK (loser_id IS NULL OR loser_id = player1_id OR loser_id = player2_id),
        CHECK (winner_id IS NULL OR loser_id IS NULL OR winner_id != loser_id)
        ,FOREIGN KEY (tournament_id, round_id) REFERENCES rounds(tournament_id, id) ON DELETE CASCADE
        ,FOREIGN KEY (tournament_id, player1_id) REFERENCES contestants(tournament_id, id) ON DELETE RESTRICT
        ,FOREIGN KEY (tournament_id, player2_id) REFERENCES contestants(tournament_id, id) ON DELETE RESTRICT
        ,FOREIGN KEY (tournament_id, winner_id) REFERENCES contestants(tournament_id, id) ON DELETE RESTRICT
        ,FOREIGN KEY (tournament_id, loser_id) REFERENCES contestants(tournament_id, id) ON DELETE RESTRICT
        ,FOREIGN KEY (tournament_id, next_winner_match_id) REFERENCES matches(tournament_id, id) ON DELETE RESTRICT
        ,UNIQUE(id, tournament_id)
      );
      CREATE INDEX matches_tournament_id_idx ON matches(tournament_id);
      CREATE INDEX matches_next_winner_match_id_idx ON matches(next_winner_match_id);

      CREATE TABLE match_events (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX match_events_match_id_idx ON match_events(match_id, created_at);

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        organizer_id TEXT REFERENCES organizers(id) ON DELETE SET NULL,
        tournament_id TEXT REFERENCES tournaments(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN ('ORGANIZER_CREATED', 'TOURNAMENT_CREATED', 'TOURNAMENT_EDITED', 'CONTESTANTS_MODIFIED', 'SEEDS_REORDERED', 'SEEDS_RANDOMIZED', 'TOURNAMENT_STARTED', 'MATCH_RESULT_RECORDED', 'MATCH_RESULT_CORRECTED', 'MATCH_REOPENED', 'TOURNAMENT_COMPLETED', 'TOURNAMENT_CANCELLED', 'TOURNAMENT_DELETED', 'MASTER_ADMIN_OVERRIDE')),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX audit_events_tournament_id_idx ON audit_events(tournament_id, created_at);
      CREATE INDEX audit_events_organizer_id_idx ON audit_events(organizer_id, created_at);
    `);
  },
};

const sessionSchema: Migration = {
  version: 2,
  name: "server_side_sessions",
  up(database) {
    database.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_digest TEXT NOT NULL UNIQUE,
        principal_type TEXT NOT NULL CHECK (principal_type IN ('ORGANIZER', 'MASTER')),
        organizer_id TEXT REFERENCES organizers(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        CHECK ((principal_type = 'ORGANIZER' AND organizer_id IS NOT NULL) OR (principal_type = 'MASTER' AND organizer_id IS NULL))
      );
      CREATE INDEX sessions_token_lookup_idx ON sessions(token_digest, expires_at) WHERE revoked_at IS NULL;
      CREATE INDEX sessions_organizer_id_idx ON sessions(organizer_id) WHERE revoked_at IS NULL;
    `);
  },
};
const bracketSlotSchema: Migration = { version: 3, name: "match_advancement_slots", up(database) { database.exec("ALTER TABLE matches ADD COLUMN next_winner_slot INTEGER CHECK (next_winner_slot IN (1, 2));"); } };

export const migrations: readonly Migration[] = [initialSchema, sessionSchema, bracketSlotSchema];

export function migrate(database: Database.Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version));
  const apply = database.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      migration.up(database);
      database.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, new Date().toISOString());
    }
  });
  apply();
}
