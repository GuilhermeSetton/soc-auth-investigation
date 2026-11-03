"""Hardening after the security audit: Host allowlist, exact Origin, global capacity limits."""

import asyncio
import threading
from pathlib import Path

import httpx

from app import main as app_main
from app.main import LOCAL_ORIGIN, app

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
LAB = (SAMPLES / "lab_auth_v1.log").read_bytes()  # 35 unique events, 1 import


def raw(method, path, headers=None, **kwargs):
    """Request with exactly the headers given: no default Origin, no default Host beyond base_url."""

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://127.0.0.1:8000") as client:
            return await client.request(method, path, headers=headers, **kwargs)

    return asyncio.run(go())


def failed_lines(start: int, count: int, user: str) -> bytes:
    return "".join(
        f"2026-10-01T12:00:{i % 60:02d}Z lab sshd[{i + 1}]: Failed password for {user} "
        f"from 192.0.2.{(i % 200) + 1} port {1024 + i} ssh2\n"
        for i in range(start, start + count)
    ).encode()


def upload(call, data: bytes, name="x.log"):
    return call("POST", "/api/imports", files={"file": (name, data, "text/plain")})


# --- Host allowlist (DNS rebinding mitigation) ---------------------------------

def test_legitimate_hosts_with_and_without_port_are_accepted(db_url):
    for host in ("127.0.0.1:8000", "127.0.0.1", "localhost:8000", "localhost"):
        response = raw("GET", "/api/health", headers={"Host": host})
        assert response.status_code == 200, host
        assert response.json() == {"status": "ok"}


def test_foreign_host_is_rejected_on_get_and_post(db_url, count_rows):
    for host in ("evil.example", "evil.example:8000", "127.0.0.1.evil.example:8000", "attacker.test:5173"):
        assert raw("GET", "/api/summary", headers={"Host": host}).status_code == 400, host
        response = raw("POST", "/api/imports", headers={"Host": host, "Origin": LOCAL_ORIGIN},
                       files={"file": ("x.log", LAB, "text/plain")})
        assert response.status_code == 400, host
    assert count_rows("imports") == 0


# --- exact Origin on mutations ---------------------------------------------------

def test_mutation_without_origin_header_is_forbidden(call, count_rows):
    assert raw("POST", "/api/imports", files={"file": ("x.log", LAB, "text/plain")}).status_code == 403
    assert count_rows("imports") == 0


def test_mutation_with_null_or_foreign_or_near_origin_is_forbidden(call, count_rows):
    for origin in ("null", "", "http://localhost:5173", "http://127.0.0.1:5174", "http://evil.example"):
        response = raw("POST", "/api/imports", headers={"Origin": origin},
                       files={"file": ("x.log", LAB, "text/plain")})
        assert response.status_code == 403, origin
    assert count_rows("imports") == 0


def test_patch_without_origin_is_forbidden_and_with_exact_origin_works(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    body = {"status": "open", "classification": "unclassified", "notes": ""}
    url = f"/api/alerts/{alert['id']}/investigation"
    assert raw("PATCH", url, json=body).status_code == 403
    assert raw("PATCH", url, headers={"Origin": "null"}, json=body).status_code == 403
    assert raw("PATCH", url, headers={"Origin": LOCAL_ORIGIN}, json=body).status_code == 200


def test_get_without_origin_and_cors_preflight_still_work(call):
    assert raw("GET", "/api/summary").status_code == 200
    assert raw("GET", "/api/summary", headers={"Origin": "http://evil.example"}).status_code == 200
    preflight = raw("OPTIONS", "/api/imports", headers={
        "Origin": LOCAL_ORIGIN, "Access-Control-Request-Method": "POST"})
    assert preflight.status_code == 200
    assert preflight.headers.get("access-control-allow-origin") == LOCAL_ORIGIN


# --- global capacity limits (monkeypatched small values) -----------------------------

def test_stored_events_at_limit_is_accepted(call, monkeypatch, count_rows):
    monkeypatch.setattr(app_main, "MAX_STORED_EVENTS", 35)
    assert upload(call, LAB).status_code == 201
    assert count_rows("events") == 35


def test_one_new_event_over_limit_is_409_and_stores_nothing(call, monkeypatch, count_rows):
    monkeypatch.setattr(app_main, "MAX_STORED_EVENTS", 35)
    upload(call, LAB)
    response = upload(call, failed_lines(100, 1, "zed"))
    assert response.status_code == 409
    assert "capacity" in response.json()["detail"].lower()
    assert "nothing was imported" in response.json()["detail"].lower()
    assert count_rows("events") == 35
    assert count_rows("imports") == 1


def test_below_limit_still_accepts_new_events(call, monkeypatch, count_rows):
    monkeypatch.setattr(app_main, "MAX_STORED_EVENTS", 36)
    upload(call, LAB)
    assert upload(call, failed_lines(100, 1, "zed")).status_code == 201
    assert count_rows("events") == 36


def test_duplicates_do_not_consume_event_capacity(call, monkeypatch, count_rows):
    monkeypatch.setattr(app_main, "MAX_STORED_EVENTS", 35)
    upload(call, LAB)
    body = upload(call, LAB).json()
    assert body["imported_events"] == 0 and body["duplicate_events"] == 35
    assert count_rows("events") == 35
    assert count_rows("imports") == 2  # the re-import still counts as an import record


def test_import_record_limit_rejects_even_duplicate_content(call, monkeypatch, count_rows):
    monkeypatch.setattr(app_main, "MAX_IMPORTS", 2)
    assert upload(call, LAB).status_code == 201
    assert upload(call, LAB).status_code == 201
    assert upload(call, LAB).status_code == 409
    assert count_rows("imports") == 2


def test_concurrent_imports_respect_event_capacity_without_partial_state(call, monkeypatch, count_rows):
    monkeypatch.setattr(app_main, "MAX_STORED_EVENTS", 30)
    results = []

    def worker(data):
        results.append(upload(call, data).status_code)

    threads = [threading.Thread(target=worker, args=(failed_lines(0, 25, "amy"),)),
               threading.Thread(target=worker, args=(failed_lines(100, 25, "ben"),))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [201, 409]
    assert count_rows("events") == 25
    assert count_rows("imports") == 1


def test_capacity_error_does_not_leak_connection_details(call, monkeypatch):
    monkeypatch.setattr(app_main, "MAX_STORED_EVENTS", 1)
    response = upload(call, failed_lines(200, 3, "kim"))  # 3 new events > limit of 1
    assert response.status_code == 409
    assert "postgresql://" not in response.text and "password" not in response.text.lower()


def test_database_down_returns_503_with_legit_host(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://soc:secret-pass@127.0.0.1:1/soc_auth_test")
    response = raw("GET", "/api/health")
    assert response.status_code == 503
    assert "secret-pass" not in response.text
