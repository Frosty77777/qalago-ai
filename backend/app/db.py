"""Application database (accounts and sessions). Separate from the rebuildable POI index.

Migrations are ordered SQL scripts applied at startup and tracked with `PRAGMA user_version`.
To change the schema, append a new script to MIGRATIONS; never edit an applied one.
"""
from contextlib import closing, contextmanager
from pathlib import Path
import sqlite3
import threading

MIGRATIONS = [
    """
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        google_sub TEXT NOT NULL UNIQUE,
        email TEXT,
        name TEXT,
        picture TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX users_email ON users(lower(email)) WHERE email IS NOT NULL;
    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE INDEX sessions_expiry ON sessions(expires_at);
    """,
]


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        return db

    @contextmanager
    def transaction(self):
        # SQLite serialises writers anyway; the lock keeps threadpool workers from busy-waiting.
        with self.lock, closing(self.connect()) as db:
            with db:
                yield db

    def migrate(self) -> int:
        with self.transaction() as db:
            db.execute("PRAGMA journal_mode = WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            for index, script in enumerate(MIGRATIONS[version:], start=version + 1):
                db.executescript("BEGIN;" + script + f"PRAGMA user_version = {index}; COMMIT;")
            return db.execute("PRAGMA user_version").fetchone()[0]
