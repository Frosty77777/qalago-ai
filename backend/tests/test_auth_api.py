"""Google sign-in, sessions, CSRF origin checks and the HTTP layer of /api/plan."""
from contextlib import closing
from dataclasses import replace
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.providers.twogis import TwoGisClient
from tests.twogis_fake import ORIGIN, make_transport

ORIGIN_HEADER = {"Origin": "http://localhost:5173"}
TOKEN = "header.payload.signature-long-enough"


class FakeVerifier:
    """Stands in for google-auth: maps opaque test credentials to claims or raises."""

    def __init__(self):
        self.claims = {TOKEN: {"iss": "https://accounts.google.com", "sub": "google-1", "email": "a@example.com",
                               "email_verified": True, "name": "Test User", "picture": "https://example.com/a.png"}}

    def verify(self, credential):
        if credential not in self.claims:
            raise ValueError("Token used too late / wrong audience")
        return self.claims[credential]


@pytest.fixture
def auth_config(config):
    return replace(config, google_client_id="test-client.apps.googleusercontent.com", twogis_key="test-key",
                   twogis_map_key="public-map-key")


def client_for(config, verifier=None, **fake):
    app = create_app(config, twogis=TwoGisClient(config, make_transport(**fake)), verifier=verifier)
    return TestClient(app)


def sign_in(client, token=TOKEN, headers=ORIGIN_HEADER):
    return client.post("/api/auth/google", json={"credential": token}, headers=headers)


def test_first_sign_in_creates_account_and_session(auth_config):
    with client_for(auth_config, FakeVerifier()) as client:
        res = sign_in(client)
        assert res.status_code == 200
        user = res.json()["user"]
        assert user["email"] == "a@example.com" and user["name"] == "Test User"
        cookie = res.headers["set-cookie"]
        assert "qalago_session=" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
        assert client.get("/api/auth/me").json()["user"]["id"] == user["id"]
        # Second sign-in with the same Google identity reuses the account.
        assert sign_in(client).json()["user"]["id"] == user["id"]
        assert client.post("/api/auth/logout", headers=ORIGIN_HEADER).status_code == 204
        assert client.get("/api/auth/me").json()["user"] is None


def test_session_survives_new_app_instance(auth_config):
    with client_for(auth_config, FakeVerifier()) as client:
        cookie = sign_in(client).cookies["qalago_session"]
    with client_for(auth_config, FakeVerifier()) as client:
        client.cookies.set("qalago_session", cookie, path="/api")
        assert client.get("/api/auth/me").json()["user"]["email"] == "a@example.com"


def test_invalid_or_untrusted_tokens_are_rejected(auth_config):
    verifier = FakeVerifier()
    verifier.claims["wrong-issuer-token-0000"] = {"iss": "https://evil.example", "sub": "x"}
    with client_for(auth_config, verifier) as client:
        assert sign_in(client, "forged-or-expired-token-123").json()["error"]["kind"] == "invalid_token"
        assert sign_in(client, "wrong-issuer-token-0000").status_code == 401
        assert client.get("/api/auth/me").json()["user"] is None


def test_frontend_profile_data_is_not_accepted(auth_config):
    with client_for(auth_config, FakeVerifier()) as client:
        res = client.post("/api/auth/google", json={"credential": TOKEN, "email": "admin@example.com"}, headers=ORIGIN_HEADER)
        assert res.status_code == 422


def test_cross_site_requests_are_refused(auth_config):
    with client_for(auth_config, FakeVerifier()) as client:
        assert sign_in(client, headers={"Origin": "https://evil.example"}).status_code == 403
        assert sign_in(client, headers={}).status_code == 403
        sign_in(client)
        assert client.post("/api/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/auth/me").json()["user"] is not None


def test_email_owned_by_another_identity_is_a_conflict(auth_config):
    verifier = FakeVerifier()
    verifier.claims["second-identity-token-1"] = {**verifier.claims[TOKEN], "sub": "google-2"}
    with client_for(auth_config, verifier) as client:
        sign_in(client)
        res = sign_in(client, "second-identity-token-1")
        assert res.status_code == 409 and res.json()["error"]["kind"] == "account_conflict"


def test_unverified_email_is_not_stored(auth_config):
    verifier = FakeVerifier()
    verifier.claims["unverified-email-token"] = {**verifier.claims[TOKEN], "sub": "google-3", "email_verified": False}
    with client_for(auth_config, verifier) as client:
        assert sign_in(client, "unverified-email-token").json()["user"]["email"] is None


def test_expired_session_is_not_restored(auth_config):
    with client_for(auth_config, FakeVerifier()) as client:
        sign_in(client)
        with closing(sqlite3.connect(auth_config.app_db_path)) as db, db:
            db.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
        assert client.get("/api/auth/me").json()["user"] is None


def test_auth_not_configured(config):
    with client_for(config) as client:
        assert sign_in(client).status_code == 503
        assert client.get("/api/auth/me").json() == {"user": None, "auth_enabled": False}
        assert client.get("/api/config").json()["google_client_id"] is None


def test_auth_rate_limit(auth_config):
    with client_for(replace(auth_config, auth_rate_per_minute=2), FakeVerifier()) as client:
        assert [sign_in(client).status_code for _ in range(3)] == [200, 200, 429]


def test_public_config_exposes_only_public_identifiers(auth_config):
    with client_for(replace(auth_config, api_key="secret-gemini")) as client:
        body = client.get("/api/config").json()
        assert body == {"twogis_map_key": "public-map-key", "google_client_id": auth_config.google_client_id,
                        "places_enabled": True}
        assert "test-key" not in str(body) and "secret-gemini" not in str(body)
        health = client.get("/api/health").json()
        assert health["twogis_configured"] and health["auth_enabled"]


PLAN = {"query": "Хочу кофе", "lat": ORIGIN[0], "lon": ORIGIN[1], "max_minutes": 60, "language": "ru"}


def test_plan_endpoint_and_provider_errors(auth_config, config):
    with client_for(auth_config) as client:
        res = client.post("/api/plan", json=PLAN)
        assert res.status_code == 200 and res.json()["status"] == "ok"
        assert client.post("/api/plan", json={**PLAN, "seen": ["not-a-signature"]}).status_code == 422
        assert client.post("/api/plan", json={**PLAN, "transport": "teleport"}).status_code == 422
    with client_for(config) as client:
        res = client.post("/api/plan", json=PLAN)
        assert res.status_code == 503 and res.json()["error"] == {"kind": "not_configured", "service": "places"}
    with client_for(auth_config, places_status=403) as client:
        assert client.post("/api/plan", json=PLAN).json()["error"]["kind"] == "key_rejected"
    with client_for(auth_config, places_status=429) as client:
        res = client.post("/api/plan", json=PLAN)
        assert res.status_code == 503 and res.headers["retry-after"] == "30"


def test_plan_rate_limit(auth_config):
    with client_for(replace(auth_config, plan_rate_per_minute=1)) as client:
        assert client.post("/api/plan", json=PLAN).status_code == 200
        res = client.post("/api/plan", json=PLAN)
        assert res.status_code == 429 and int(res.headers["retry-after"]) > 0
