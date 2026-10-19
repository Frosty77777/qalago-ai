from dataclasses import dataclass, field
from pathlib import Path
import math
import os

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def _number(name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(os.getenv(name, str(default)))
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}")
    return value


@dataclass(frozen=True)
class Settings:
    data_path: Path = ROOT / "data/pois.json"
    db_path: Path = ROOT / "data/pois.sqlite3"
    api_key: str = field(default="", repr=False)
    model: str = "gemini-3.8-flash"
    model_timeout: float = 20
    model_concurrency: int = 4
    radius_m: float = 4000
    weights: tuple[float, float, float] = (0.50, 0.35, 0.15)
    stale_days: float = 14
    debug: bool = False
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    def __post_init__(self):
        if self.data_path.resolve() == self.db_path.resolve():
            raise ValueError("POI_DATA_PATH and POI_DB_PATH must differ")

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(ROOT / ".env", override=False)
        def path(name: str, default: str) -> Path:
            p = Path(os.getenv(name, default))
            return p if p.is_absolute() else ROOT / p
        weights = tuple(_number(n, d, 0, 1) for n, d in (
            ("RETRIEVAL_TEXT_WEIGHT", .5), ("RETRIEVAL_CATEGORY_WEIGHT", .35),
            ("RETRIEVAL_DISTANCE_WEIGHT", .15)))
        if sum(weights) <= 0:
            raise ValueError("At least one retrieval weight must be positive")
        return cls(
            data_path=path("POI_DATA_PATH", "data/pois.json"),
            db_path=path("POI_DB_PATH", "data/pois.sqlite3"),
            api_key=os.getenv("GEMINI_API_KEY", "").strip(),
            model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
            model_timeout=_number("GEMINI_TIMEOUT_SECONDS", 20, .1, 30),
            model_concurrency=int(_number("GEMINI_MAX_CONCURRENT", 4, 1, 32)),
            radius_m=_number("SEARCH_RADIUS_M", 4000, 50, 20000),
            weights=weights, stale_days=_number("DATA_STALE_DAYS", 14, 0, 3650),
            debug=os.getenv("RETRIEVAL_DEBUG", "false").lower() == "true",
            cors_origins=tuple(x.strip() for x in os.getenv("CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173").split(",") if x.strip()),
        )
