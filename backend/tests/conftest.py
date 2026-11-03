"""Integration fixtures. They need TEST_DATABASE_URL (a dedicated database whose name ends in _test)."""

import asyncio
import os

import httpx
import psycopg
import pytest

from app import db as dbmod
from app.main import LOCAL_ORIGIN, app


@pytest.fixture
def db_url(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set; run through scripts/with-env.ps1")
    with psycopg.connect(url) as conn:
        name = conn.execute("SELECT current_database()").fetchone()[0]
        if not name.endswith("_test"):
            pytest.exit(f"refusing to reset database {name!r}: test databases must end in _test", returncode=3)
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
    dbmod.migrate_up(url)
    monkeypatch.setenv("DATABASE_URL", url)
    return url


@pytest.fixture
def call(db_url):
    """Synchronous wrapper around httpx.ASGITransport (TestClient is not used: incompatible with httpx 0.28)."""

    def _call(method, path, headers=None, **kwargs):
        # Mutations must carry the exact local Origin (contract hardening); tests opt out explicitly.
        if method in ("POST", "PATCH") and not (headers and "Origin" in headers):
            headers = {**(headers or {}), "Origin": LOCAL_ORIGIN}

        async def go():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
                return await client.request(method, path, headers=headers, **kwargs)

        return asyncio.run(go())

    return _call


@pytest.fixture
def count_rows(db_url):
    def _count(table):
        with psycopg.connect(db_url) as conn:
            return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]

    return _count
