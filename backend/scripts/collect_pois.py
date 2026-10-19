"""Run from backend: python scripts/collect_pois.py --help."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from app.collector import collect, DEFAULT_BBOX
from app.config import Settings, ROOT


def main() -> int:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Harvest named Astana OSM POIs; never overwrites the last good dataset on API failure.")
    parser.add_argument("--bbox", type=float, nargs=4, default=DEFAULT_BBOX, metavar=("S", "W", "N", "E"))
    parser.add_argument("--force", action="store_true", help="Bypass 24-hour cache; avoid repeated public API calls")
    parser.add_argument("--cache-hours", type=float, default=24)
    args = parser.parse_args()
    if not 1 <= args.cache_hours <= 720:
        parser.error("cache-hours must be between 1 and 720")
    settings = Settings.from_env()
    settings.data_path.parent.mkdir(parents=True, exist_ok=True)
    lock = settings.data_path.with_suffix(".lock")
    try:
        handle = lock.open("x")
    except FileExistsError:
        print(json.dumps({"status": "collector_already_running", "help": "If a previous collector crashed, verify no collector is active before removing its lock file."}))
        return 2
    try:
        with handle:
            handle.write(str(os.getpid()))
        try:
            result = asyncio.run(collect(settings.data_path, settings.db_path,
                endpoint=os.getenv("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
                user_agent=os.getenv("OVERPASS_USER_AGENT", "QalaGo-AI-hackathon/1.0"),
                bbox=tuple(args.bbox), cache_hours=args.cache_hours, force=args.force))
        except ValueError as exc:
            parser.error(str(exc))
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 0 if result["status"] in {"cache_hit", "collected"} else 2
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
