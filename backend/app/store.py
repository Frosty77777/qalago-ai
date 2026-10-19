"""JSON is canonical; SQLite is a rebuildable spatial/category index."""
import hashlib
import json
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile

from .geo import bounding_box
from .models import Dataset, POI


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def build_index(dataset: Dataset, path: Path, fingerprint: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.execute("CREATE TABLE pois (id TEXT PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, category TEXT NOT NULL, payload TEXT NOT NULL)")
            db.executemany("INSERT INTO pois VALUES (?, ?, ?, ?, ?)", [
                (p.id, p.lat, p.lon, p.category, p.model_dump_json()) for p in dataset.pois])
            db.execute("CREATE INDEX pois_geo ON pois(lat, lon)")
            db.execute("CREATE INDEX pois_category ON pois(category)")
            db.execute("CREATE TABLE metadata (fingerprint TEXT NOT NULL)")
            db.execute("INSERT INTO metadata VALUES (?)", (fingerprint,))
            db.commit()
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def save_dataset(dataset: Dataset, json_path: Path, db_path: Path) -> None:
    payload = dataset.model_dump_json(indent=2).encode("utf-8")
    # Stage the index first: index failure cannot damage last successful JSON.
    build_index(dataset, db_path, hashlib.sha256(payload).hexdigest())
    atomic_write(json_path, payload)


class POIStore:
    def __init__(self, json_path: Path, db_path: Path):
        self.db_path = db_path
        self.dataset: Dataset | None = None
        self.index_available = False
        self.load_error = False
        if not json_path.exists():
            return
        try:
            payload = json_path.read_bytes()
            self.dataset = Dataset.model_validate_json(payload)
        except (ValueError, OSError):
            self.load_error = True
            return
        fingerprint = hashlib.sha256(payload).hexdigest()
        try:
            with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
                current = db.execute("SELECT fingerprint FROM metadata").fetchone()
            if current != (fingerprint,):
                raise sqlite3.DatabaseError("Stale index")
            self.index_available = True
        except sqlite3.Error:
            try:
                build_index(self.dataset, db_path, fingerprint)
                self.index_available = True
            except (OSError, sqlite3.Error):
                # Read-only deployments still serve validated canonical JSON.
                self.index_available = False
        self.by_id = {p.id: p for p in self.dataset.pois}

    @property
    def pois(self) -> list[POI]:
        return self.dataset.pois if self.dataset else []

    def near(self, lat: float, lon: float, radius: float, categories: set[str]) -> list[POI]:
        south, west, north, east = bounding_box(lat, lon, radius)
        if self.index_available:
            try:
                with closing(sqlite3.connect(f"{self.db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
                    sql = "SELECT id FROM pois WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?"
                    params: list = [south, north, west, east]
                    if categories:
                        sql += " AND category IN (" + ",".join("?" for _ in categories) + ")"
                        params.extend(sorted(categories))
                    # Values always come from the validated canonical snapshot.
                    return [self.by_id[row[0]] for row in db.execute(sql, params) if row[0] in self.by_id]
            except sqlite3.Error:
                pass
        return [p for p in self.pois if south <= p.lat <= north and west <= p.lon <= east
                and (not categories or p.category in categories)]
