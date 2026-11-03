"""PostgreSQL connections and idempotent SQL migrations (psycopg, no ORM)."""

from __future__ import annotations

import os
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION_LOCK_KEY = 0x50C_A07  # arbitrary constant: serializes migration runs


class DatabaseNotConfigured(RuntimeError):
    """DATABASE_URL is missing. The message never includes the value."""


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise DatabaseNotConfigured("DATABASE_URL is not set")
    return url


def connect(url: str | None = None) -> psycopg.Connection:
    # UTC session so timestamptz values come back as UTC datetimes.
    return psycopg.connect(url or database_url(), connect_timeout=5, options="-c timezone=UTC")


def _migration_files() -> list[tuple[str, Path, Path | None]]:
    ups = sorted(p for p in MIGRATIONS_DIR.glob("*.sql") if not p.name.endswith(".down.sql"))
    result = []
    for up in ups:
        stem = up.stem
        down = MIGRATIONS_DIR / f"{stem}.down.sql"
        result.append((stem, up, down if down.exists() else None))
    return result


def migrate_up(url: str) -> list[str]:
    """Apply pending migrations. Re-running is a no-op. Returns newly applied versions."""
    applied_now: list[str] = []
    with connect(url) as conn:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_KEY,))
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            done = {row[0] for row in conn.execute("SELECT version FROM schema_migrations").fetchall()}
            for version, up, _down in _migration_files():
                if version in done:
                    continue
                conn.execute(up.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
                applied_now.append(version)
    return applied_now


class ConfirmationError(RuntimeError):
    """The database name given for confirmation does not match the connected database."""


def migrate_down(url: str, confirm_database: str) -> str | None:
    """Revert the most recently applied migration. Returns its version or None.

    Destructive: the connected database's real name (current_database(), not a parse of the URL)
    must equal confirm_database, checked inside the same transaction before anything is reverted.
    """
    with connect(url) as conn:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_KEY,))
            actual = conn.execute("SELECT current_database()").fetchone()[0]
            if actual != confirm_database:
                raise ConfirmationError("confirmation does not match the connected database")
            row = conn.execute(
                "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            version = row[0]
            files = {stem: down for stem, _up, down in _migration_files()}
            down = files.get(version)
            if down is None:
                raise RuntimeError(f"no down script for {version}")
            conn.execute(down.read_text(encoding="utf-8"))
            conn.execute("DELETE FROM schema_migrations WHERE version = %s", (version,))
    return version
