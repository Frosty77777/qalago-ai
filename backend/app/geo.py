import math


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle metres, never a walking distance or ETA."""
    a, b = math.radians(lat1), math.radians(lat2)
    dlat, dlon = b - a, math.radians(lon2 - lon1)
    h = math.sin(dlat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dlon / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(h)))


def bounding_box(lat: float, lon: float, radius: float) -> tuple[float, float, float, float]:
    dlat = math.degrees(radius / 6371008.8)
    if abs(lat) + dlat >= 90:
        return max(-90, lat-dlat), -180, min(90, lat+dlat), 180
    dlon = math.degrees(math.asin(min(1, math.sin(radius / 6371008.8) / math.cos(math.radians(lat)))))
    # A full longitude range is safe for searches straddling the dateline.
    west, east = (lon-dlon, lon+dlon) if -180 <= lon-dlon and lon+dlon <= 180 else (-180, 180)
    return max(-90, lat-dlat), west, min(90, lat+dlat), east
