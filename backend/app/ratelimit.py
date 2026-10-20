"""Per-client sliding-window limits for endpoints that call paid providers.

In-process memory only: correct for the single-worker container. Running several workers
or replicas needs a shared store (for example Redis) or limits at the reverse proxy.
"""
from collections import deque
import time


class RateLimiter:
    def __init__(self, per_minute: int, max_clients: int = 10000, clock=time.monotonic):
        self.per_minute, self.max_clients, self.clock = per_minute, max_clients, clock
        self.hits: dict[str, deque[float]] = {}

    def allow(self, key: str) -> tuple[bool, int]:
        """Return (allowed, seconds until the next request would be allowed)."""
        now = self.clock()
        window = self.hits.get(key)
        if window is None:
            if len(self.hits) >= self.max_clients:
                self._prune(now)
            window = self.hits[key] = deque()
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= self.per_minute:
            return False, max(1, int(60 - (now - window[0])) + 1)
        window.append(now)
        return True, 0

    def _prune(self, now: float) -> None:
        for key in [k for k, w in self.hits.items() if not w or now - w[-1] >= 60]:
            del self.hits[key]
        if len(self.hits) >= self.max_clients:
            self.hits.clear()
