PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS blacklist (
    user_id TEXT PRIMARY KEY,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    appeal_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS airdrops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    wallet TEXT NOT NULL,
    amount TEXT NOT NULL,
    proof TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blacklist_user
ON blacklist(user_id);

CREATE INDEX IF NOT EXISTS idx_appeals_user
ON appeals(user_id);

CREATE INDEX IF NOT EXISTS idx_appeals_status
ON appeals(status);

CREATE INDEX IF NOT EXISTS idx_airdrops_user
ON airdrops(user_id);

CREATE INDEX IF NOT EXISTS idx_airdrops_status
ON airdrops(status);
