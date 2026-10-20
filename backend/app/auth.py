"""Google sign-in with server-side sessions.

Flow: the browser obtains a Google ID token (Sign in with Google button or One Tap) and
POSTs it to /api/auth/google. The backend verifies signature, audience, issuer and
expiry with google-auth, then finds or creates the account by the stable Google `sub`.
Profile fields in the token are stored for display only; nothing the frontend sends
besides the signed token is trusted. The session is a random token in an HttpOnly
cookie; only its SHA-256 hash is stored.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
import hashlib
import secrets
import sqlite3
from typing import Protocol

from .config import Settings
from .db import Database
from .models import utc_now

COOKIE = "qalago_session"
ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class AuthError(Exception):
    def __init__(self, kind: str, status: int):
        super().__init__(kind)
        self.kind, self.status = kind, status


class TokenVerifier(Protocol):
    def verify(self, credential: str) -> dict: ...


class GoogleTokenVerifier:
    def __init__(self, client_id: str):
        self.client_id = client_id

    def verify(self, credential: str) -> dict:
        from google.auth.transport.requests import Request
        from google.oauth2 import id_token
        # Checks the RS256 signature against Google's published keys, `aud`, `exp` and `iat`.
        return id_token.verify_oauth2_token(credential, Request(), self.client_id, clock_skew_in_seconds=10)


@dataclass(frozen=True)
class User:
    id: int
    email: str | None
    name: str | None
    picture: str | None

    def public(self) -> dict:
        return {"id": self.id, "email": self.email, "name": self.name, "picture": self.picture}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AuthService:
    def __init__(self, settings: Settings, db: Database, verifier: TokenVerifier | None = None):
        self.settings, self.db = settings, db
        self.verifier = verifier or (GoogleTokenVerifier(settings.google_client_id) if settings.google_client_id else None)

    @property
    def enabled(self) -> bool:
        return self.verifier is not None

    async def sign_in(self, credential: str) -> tuple[User, str]:
        if not self.verifier:
            raise AuthError("not_configured", 503)
        try:
            claims = await asyncio.to_thread(self.verifier.verify, credential)
        except ValueError:
            # Bad signature, wrong audience, expired or malformed token.
            raise AuthError("invalid_token", 401)
        except Exception:
            # Google's key endpoint unreachable, for example.
            raise AuthError("verification_unavailable", 503)
        if claims.get("iss") not in ISSUERS or not claims.get("sub"):
            raise AuthError("invalid_token", 401)
        return await asyncio.to_thread(self._sign_in_sync, claims)

    def _sign_in_sync(self, claims: dict) -> tuple[User, str]:
        sub = str(claims["sub"])
        # An unverified address is never stored, so it cannot claim another account's email.
        email = claims.get("email") if claims.get("email_verified") is True else None
        name = (claims.get("name") or "")[:200] or None
        picture = claims.get("picture") if str(claims.get("picture", "")).startswith("https://") else None
        now = utc_now()
        token = secrets.token_urlsafe(32)
        try:
            with self.db.transaction() as db:
                row = db.execute("SELECT id FROM users WHERE google_sub = ?", (sub,)).fetchone()
                if row:
                    user_id = row["id"]
                    db.execute("UPDATE users SET email = ?, name = ?, picture = ?, last_login_at = ? WHERE id = ?",
                               (email, name, picture, now.isoformat(), user_id))
                else:
                    user_id = db.execute(
                        "INSERT INTO users (google_sub, email, name, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (sub, email, name, picture, now.isoformat(), now.isoformat())).lastrowid
                db.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(),))
                db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (
                    _hash(token), user_id, now.isoformat(),
                    (now + timedelta(days=self.settings.session_days)).isoformat()))
        except sqlite3.IntegrityError:
            # The verified email already belongs to a different Google identity. Linking
            # accounts automatically would let one identity take over another's account.
            raise AuthError("account_conflict", 409)
        return User(user_id, email, name, picture), token

    def user_for(self, token: str | None) -> User | None:
        if not token or len(token) > 200:
            return None
        with self.db.transaction() as db:
            row = db.execute(
                "SELECT u.id, u.email, u.name, u.picture FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash = ? AND s.expires_at > ?", (_hash(token), utc_now().isoformat())).fetchone()
        return User(row["id"], row["email"], row["name"], row["picture"]) if row else None

    def sign_out(self, token: str | None) -> None:
        if token:
            with self.db.transaction() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))
