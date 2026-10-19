# Dataset location

Run `python scripts/collect_pois.py` from backend on a network-enabled machine. It creates `pois.json` and `pois.sqlite3` from a single bounded Overpass query. The API loads the last successful snapshot at startup; restart after collection.

No fictional seed POIs are bundled. A clean checkout legitimately starts with zero POIs. Test fixtures are synthetic and are never loaded by the application.

Commit the successfully collected `pois.json` and its provenance summary for an offline-capable demo. SQLite is rebuildable and ignored. The snapshot embeds collection timestamp, OSM base timestamp if available, bbox, query hash, endpoint, ODbL license and attribution. Retain © OpenStreetMap contributors attribution in your UI and comply with https://www.openstreetmap.org/copyright when redistributing the database.

Default bbox: south=50.99, west=71.27, north=51.25, east=71.60 (core Astana; not a claim of complete municipal coverage).
