# syntax=docker/dockerfile:1
# Production image for the QalaGo API. Build context: backend/
FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.lock.txt .
# The lock pins every transitive dependency for reproducible installs.
RUN python -m venv /venv && /venv/bin/pip install -r requirements.lock.txt

FROM python:3.12-slim
ENV PATH=/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_DB_PATH=/var/lib/qalago/app.sqlite3 \
    POI_DB_PATH=/var/lib/qalago/pois.sqlite3
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /var/lib/qalago && chown app:app /var/lib/qalago
WORKDIR /app
COPY --from=build /venv /venv
COPY app ./app
# Legacy OSM snapshot for /api/recommend (read-only; its SQLite index is rebuilt in the volume).
COPY data/pois.json data/provenance.json ./data/
USER app
VOLUME ["/var/lib/qalago"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]
# --forwarded-allow-ips='*' is safe only because the API is reachable solely from the nginx
# container on the internal compose network (the port is not published).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "20"]
