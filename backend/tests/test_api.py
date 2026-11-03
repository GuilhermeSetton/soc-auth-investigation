"""Integration tests against a real PostgreSQL test database (migrations, API, persistence, reports)."""

import threading
from pathlib import Path

import psycopg
import pytest

from app import db as dbmod
from app.db import migrate_down, migrate_up

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
LAB = (SAMPLES / "lab_auth_v1.log").read_bytes()
INVALID = (SAMPLES / "invalid_lines_v1.log").read_bytes()
LAB_LINES = LAB.splitlines(keepends=True)


def upload(call, data: bytes, name="lab.log", origin=None):
    headers = {"Origin": origin} if origin else None
    return call("POST", "/api/imports", files={"file": (name, data, "text/plain")}, headers=headers)


def alerts_by_rule(call):
    body = call("GET", "/api/alerts", params={"limit": 100}).json()
    return body


# --- migrations ---------------------------------------------------------------

def test_migrate_up_twice_is_idempotent(db_url):
    assert migrate_up(db_url) == []
    assert migrate_up(db_url) == []


def test_migrate_down_then_up_restores_schema(db_url, count_rows):
    assert migrate_down(db_url, "soc_auth_test") == "001_initial"
    with psycopg.connect(db_url) as conn:
        assert conn.execute("SELECT to_regclass('public.events')").fetchone()[0] is None
    assert migrate_up(db_url) == ["001_initial"]
    assert count_rows("events") == 0


def test_failed_migration_rolls_back_everything(db_url, tmp_path, monkeypatch):
    migrate_down(db_url, "soc_auth_test")  # start from an empty schema
    (tmp_path / "001_a.sql").write_text("CREATE TABLE rollback_probe (id int);", encoding="utf-8")
    (tmp_path / "002_bad.sql").write_text("CREATE TABLE other (id int); THIS IS NOT SQL;", encoding="utf-8")
    original = dbmod.MIGRATIONS_DIR
    monkeypatch.setattr(dbmod, "MIGRATIONS_DIR", tmp_path)
    with pytest.raises(psycopg.Error):
        migrate_up(db_url)
    with psycopg.connect(db_url) as conn:
        assert conn.execute("SELECT to_regclass('public.rollback_probe')").fetchone()[0] is None
        # schema_migrations survives migrate_down by design; the failed run must leave no rows in it
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 0
    monkeypatch.setattr(dbmod, "MIGRATIONS_DIR", original)
    assert migrate_up(db_url) == ["001_initial"]


# --- health and errors --------------------------------------------------------

def test_health_ok(call):
    assert call("GET", "/api/health").json() == {"status": "ok"}


def test_database_down_returns_503_without_dsn(monkeypatch):
    secret = "s3cr3t-pass-value"
    monkeypatch.setenv("DATABASE_URL", f"postgresql://soc:{secret}@127.0.0.1:1/soc_auth_test")
    import asyncio
    import httpx
    from app.main import app

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8000") as c:
            return await c.get("/api/health")

    response = asyncio.run(go())
    assert response.status_code == 503
    assert secret not in response.text
    assert response.json() == {"detail": "Database unavailable"}


# --- imports -------------------------------------------------------------------

def test_import_lab_sample_counts_and_alerts(call):
    response = upload(call, LAB)
    assert response.status_code == 201
    body = response.json()
    assert (body["total_lines"], body["imported_events"], body["duplicate_events"]) == (35, 35, 0)
    assert body["invalid_lines"] == []
    assert call("GET", "/api/alerts", params={"limit": 100}).json()["total"] == 6
    summary = call("GET", "/api/summary").json()
    assert summary == {"events": 35, "alerts": 6, "open_alerts": 6,
                       "successful_authentications": 8, "failed_authentications": 27}


def test_reimport_does_not_duplicate_events_or_alerts(call, count_rows):
    upload(call, LAB)
    body = upload(call, LAB, name="same-lines-other-name.log").json()
    assert (body["imported_events"], body["duplicate_events"]) == (0, 35)
    assert count_rows("events") == 35
    assert count_rows("alerts") == 6


def test_invalid_lines_are_reported_and_counts_add_up(call):
    body = upload(call, INVALID).json()
    assert body["total_lines"] == 13
    assert body["imported_events"] == 2
    assert body["duplicate_events"] == 0
    assert len(body["invalid_lines"]) == 11
    assert body["invalid_lines"][0] == {"line_number": 1, "reason": "timestamp_without_offset"}
    assert body["imported_events"] + body["duplicate_events"] + len(body["invalid_lines"]) == body["total_lines"]


def test_fully_invalid_file_is_imported_with_zero_events_and_no_alerts(call, count_rows):
    body = upload(call, b"garbage\nmore garbage\n").json()
    assert (body["imported_events"], body["total_lines"]) == (0, 2)
    assert count_rows("alerts") == 0


def test_invalid_utf8_returns_422_and_stores_nothing(call, count_rows):
    response = upload(call, LAB + b"\xff\n")
    assert response.status_code == 422
    assert count_rows("imports") == 0 and count_rows("events") == 0


def test_upload_one_byte_over_limit_returns_413_and_stores_nothing(call, count_rows):
    block = b"x" * 8191 + b"\n"
    too_big = block * 256 + b"x"  # 2 MiB + 1 byte
    response = upload(call, too_big)
    assert response.status_code == 413
    assert count_rows("imports") == 0


def test_ten_thousand_lines_are_accepted_and_one_more_is_rejected(call, count_rows):
    line = b"2026-10-01T12:00:00Z lab sshd[1]: Failed password for alice from 192.0.2.10 port 22 ssh2\n"
    body = upload(call, line * 10_000).json()
    assert body["total_lines"] == 10_000
    assert body["imported_events"] == 1
    assert body["duplicate_events"] == 9_999
    assert upload(call, line * 10_001).status_code == 413


def test_timestamps_near_year_one_import_without_server_error(call):
    lines = b"".join(
        f"0001-01-01T00:00:0{i}Z lab sshd[{i + 1}]: Failed password for root from 198.51.100.1 port 22 ssh2\n".encode()
        for i in range(5)
    )
    lines += b"0001-01-01T00:00:09+01:00 lab sshd[9]: Accepted password for root from 198.51.100.1 port 22 ssh2\n"
    body = upload(call, lines).json()
    assert body["total_lines"] == 6
    assert body["invalid_lines"] == [{"line_number": 6, "reason": "invalid_timestamp"}]
    assert call("GET", "/api/alerts", params={"limit": 100}).json()["total"] == 1


def test_out_of_order_import_recomputes_alerts_over_old_imports(call, db_url):
    half = len(LAB_LINES) // 2
    later = b"".join(LAB_LINES[half:])
    earlier = b"".join(LAB_LINES[:half])
    upload(call, later)
    assert call("GET", "/api/alerts", params={"limit": 100}).json()["total"] < 6
    upload(call, earlier)
    alerts = call("GET", "/api/alerts", params={"limit": 100}).json()
    assert alerts["total"] == 6
    assert sorted(a["event_count"] for a in alerts["items"]) == sorted([5, 6, 5, 5, 4, 4])


# --- evidence, listing, filters ------------------------------------------------

def test_success_alert_evidence_is_failures_then_success_in_timeline_order(call):
    upload(call, LAB)
    items = call("GET", "/api/alerts", params={"rule_id": "success_after_failures", "limit": 100}).json()["items"]
    erin = next(a for a in items if a["source"] == "192.0.2.88")
    detail = call("GET", f"/api/alerts/{erin['id']}").json()
    assert [e["line_number"] for e in detail["events"]] == [16, 17, 18, 19]
    assert detail["events"][-1]["outcome"] == "success"
    assert detail["alert"]["status"] == "open"
    assert detail["investigation"] == {"alert_id": erin["id"], "status": "open",
                                       "classification": "unclassified", "notes": "", "updated_at": None}


def test_boundary_success_alert_includes_failure_exactly_300s_before(call):
    upload(call, LAB)
    items = call("GET", "/api/alerts", params={"rule_id": "success_after_failures", "limit": 100}).json()["items"]
    frank = next(a for a in items if a["source"] == "192.0.2.89")
    detail = call("GET", f"/api/alerts/{frank['id']}").json()
    assert [e["line_number"] for e in detail["events"]] == [20, 21, 22, 23]


def test_event_filters_and_pagination(call):
    upload(call, LAB)
    assert call("GET", "/api/events", params={"outcome": "success"}).json()["total"] == 8
    assert call("GET", "/api/events", params={"source": "2001:DB8:0:0::25"}).json()["total"] == 1
    page = call("GET", "/api/events", params={"limit": 3, "offset": 0}).json()
    assert page["total"] == 35 and len(page["items"]) == 3
    stamps = [e["timestamp"] for e in page["items"]]
    assert stamps == sorted(stamps)
    window = call("GET", "/api/events", params={"from_time": "2026-10-01T12:10:00Z",
                                                  "to_time": "2026-10-01T12:10:30Z"}).json()
    assert window["total"] == 2  # inclusive bounds


def test_time_filters_validate_offset_and_order(call):
    upload(call, LAB)
    naive = call("GET", "/api/events", params={"from_time": "2026-10-01T12:00:00"})
    assert naive.status_code == 422
    reversed_range = call("GET", "/api/events", params={"from_time": "2026-10-02T00:00:00Z",
                                                          "to_time": "2026-10-01T00:00:00Z"})
    assert reversed_range.status_code == 422


def test_pagination_bounds(call):
    assert call("GET", "/api/events", params={"limit": 0}).status_code == 422
    assert call("GET", "/api/events", params={"limit": 101}).status_code == 422
    assert call("GET", "/api/events", params={"offset": -1}).status_code == 422


def test_alert_filters(call):
    upload(call, LAB)
    assert call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["total"] == 1
    assert call("GET", "/api/alerts", params={"source": "198.51.100.7"}).json()["total"] == 2
    assert call("GET", "/api/alerts", params={"status": "closed"}).json()["total"] == 0


def test_unknown_or_malformed_alert_ids(call):
    upload(call, LAB)
    assert call("GET", "/api/alerts/00000000-0000-4000-8000-000000000000").status_code == 404
    assert call("GET", "/api/alerts/not-a-uuid").status_code == 422
    assert call("PATCH", "/api/alerts/00000000-0000-4000-8000-000000000000/investigation",
                json={"status": "closed", "classification": "benign", "notes": ""}).status_code == 404


# --- investigation persistence and reports ------------------------------------

def test_investigation_is_saved_and_reopened(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    saved = call("PATCH", f"/api/alerts/{alert['id']}/investigation", json={
        "status": "in_progress", "classification": "suspicious", "notes": "Checking spray origin 203.0.113.50"})
    assert saved.status_code == 200
    assert saved.json()["classification"] == "suspicious"
    reopened = call("GET", f"/api/alerts/{alert['id']}").json()["investigation"]
    assert reopened["notes"] == "Checking spray origin 203.0.113.50"
    assert reopened["updated_at"] is not None
    assert call("GET", "/api/alerts", params={"status": "in_progress"}).json()["total"] == 1
    assert call("GET", "/api/summary").json()["open_alerts"] == 6  # in_progress is not closed
    call("PATCH", f"/api/alerts/{alert['id']}/investigation", json={
        "status": "closed", "classification": "benign", "notes": ""})
    assert call("GET", "/api/summary").json()["open_alerts"] == 5


def test_investigation_survives_reimport(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    call("PATCH", f"/api/alerts/{alert['id']}/investigation", json={
        "status": "closed", "classification": "benign", "notes": "kept"})
    upload(call, LAB)
    assert call("GET", f"/api/alerts/{alert['id']}").json()["investigation"]["notes"] == "kept"


def test_notes_limit_and_enums_are_validated(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    url = f"/api/alerts/{alert['id']}/investigation"
    too_long = call("PATCH", url, json={"status": "open", "classification": "unclassified", "notes": "x" * 10001})
    assert too_long.status_code == 422
    bad_enum = call("PATCH", url, json={"status": "done", "classification": "unclassified", "notes": ""})
    assert bad_enum.status_code == 422


def test_json_report_contract_fields(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    response = call("GET", f"/api/alerts/{alert['id']}/report", params={"format": "json"})
    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("attachment;")
    report = response.json()
    assert report["schema_version"] == 1
    assert report["alert"]["id"] == alert["id"]
    assert len(report["events"]) == 5
    assert "not proof of compromise" in report["disclaimer"]
    assert report["generated_at"].endswith("Z")


def test_markdown_report_escapes_notes_and_has_no_html(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    note = "<script>alert(1)</script> *bold* [link](http://x) | pipe"
    call("PATCH", f"/api/alerts/{alert['id']}/investigation", json={
        "status": "open", "classification": "suspicious", "notes": note})
    response = call("GET", f"/api/alerts/{alert['id']}/report", params={"format": "markdown"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    body = response.text
    assert "<script>" not in body and "\\<script\\>" in body
    assert "\\*bold\\*" in body and "\\[link\\]" in body and "\\|" in body
    assert "not proof of compromise" in body
    assert "## Evidence" in body


def test_report_format_is_validated(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    assert call("GET", f"/api/alerts/{alert['id']}/report", params={"format": "html"}).status_code == 422


# --- origin and filename -----------------------------------------------------

def test_mutation_from_foreign_origin_is_rejected(call, count_rows):
    assert upload(call, LAB, origin="http://evil.example").status_code == 403
    assert count_rows("imports") == 0
    assert upload(call, LAB, origin="http://127.0.0.1:5173").status_code == 201


def test_filename_is_sanitized_for_display_only(call):
    body = upload(call, INVALID, name="../../etc/passwd<script>.log").json()
    assert "/" not in body["filename"] and "<" not in body["filename"]
    assert body["filename"].endswith(".log")


# --- concurrency ---------------------------------------------------------------

def test_concurrent_overlapping_imports_do_not_race(call, count_rows):
    results = []

    def worker():
        results.append(upload(call, LAB).status_code)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [201, 201, 201, 201]
    assert count_rows("events") == 35
    assert count_rows("alerts") == 6


# --- import reference of evidence (round 3) -------------------------------------

def test_evidence_points_to_first_import_after_reimport_in_detail_and_json_report(call):
    first = upload(call, LAB).json()
    second = upload(call, LAB, name="other-name-same-lines.log").json()
    assert second["id"] != first["id"]
    alert = call("GET", "/api/alerts", params={"rule_id": "success_after_failures", "limit": 100}).json()["items"][0]

    detail = call("GET", f"/api/alerts/{alert['id']}").json()
    assert detail["events"], "evidence must not be empty"
    assert {e["import_id"] for e in detail["events"]} == {first["id"]}
    assert all(e["import_id"] is not None for e in detail["events"])

    report = call("GET", f"/api/alerts/{alert['id']}/report", params={"format": "json"}).json()
    assert {e["import_id"] for e in report["events"]} == {first["id"]}
    assert [e["line_number"] for e in report["events"]] == [e["line_number"] for e in detail["events"]]


def test_evidence_import_reference_is_first_import_for_events_added_later(call):
    first = upload(call, LAB).json()
    upload(call, LAB)  # identical lines again: nothing new is stored
    new_line = b"2026-10-01T13:00:00Z lab sshd[999]: Failed password for zed from 192.0.2.200 port 1 ssh2\n"
    second = upload(call, new_line).json()
    assert second["imported_events"] == 1
    events = call("GET", "/api/events", params={"source": "192.0.2.200"}).json()["items"]
    assert [e["import_id"] for e in events] == [second["id"]]
    erin_alert = call("GET", "/api/alerts", params={"rule_id": "success_after_failures", "limit": 100}).json()["items"][0]
    detail = call("GET", f"/api/alerts/{erin_alert['id']}").json()
    assert {e["import_id"] for e in detail["events"]} == {first["id"]}


# --- error classes and leaks (round 3) -------------------------------------------

def test_operational_database_error_is_503_without_driver_text(call, monkeypatch, caplog):
    import psycopg
    from app import store

    marker = "OPERATIONAL-MARKER-postgresql://u:pw@127.0.0.1:5432/soc"

    def boom(conn):
        raise psycopg.OperationalError(marker)

    monkeypatch.setattr(store, "summary", boom)
    response = call("GET", "/api/summary")
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
    assert marker not in response.text
    assert "OperationalError" in caplog.text
    assert marker not in caplog.text


def test_sql_error_is_generic_500_not_503_and_leaks_nothing(call, monkeypatch, caplog):
    import psycopg
    from app import store

    marker = "SQL-MARKER-SELECT secret_column FROM events password=hunter2"

    def boom(conn):
        raise psycopg.ProgrammingError(marker)

    monkeypatch.setattr(store, "summary", boom)
    response = call("GET", "/api/summary")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "hunter2" not in response.text and marker not in response.text
    assert "ProgrammingError" in caplog.text
    assert "hunter2" not in caplog.text and marker not in caplog.text


def test_validation_error_does_not_echo_notes(call):
    upload(call, LAB)
    alert = call("GET", "/api/alerts", params={"rule_id": "multiple_users"}).json()["items"][0]
    secret_note = "NOTE-MARKER-" + "x" * 10001
    response = call("PATCH", f"/api/alerts/{alert['id']}/investigation",
                    json={"status": "open", "classification": "unclassified", "notes": secret_note})
    assert response.status_code == 422
    assert "NOTE-MARKER" not in response.text
    assert response.json()["detail"][0]["loc"][-1] == "notes"


def test_upload_exactly_two_mib_is_accepted(call, count_rows):
    block = b"x" * 8191 + b"\n"  # 8 KiB lines: invalid but counted, not rejected by size
    exact = block * 256
    assert len(exact) == 2 * 1024 * 1024
    response = upload(call, exact)
    assert response.status_code == 201
    body = response.json()
    assert body["total_lines"] == 256
    assert len(body["invalid_lines"]) == 256
    assert count_rows("imports") == 1


def test_markdown_report_carries_first_import_reference(call):
    first = upload(call, LAB).json()
    upload(call, LAB, name="again.log")
    alert = call("GET", "/api/alerts", params={"rule_id": "success_after_failures", "limit": 100}).json()["items"][0]
    body = call("GET", f"/api/alerts/{alert['id']}/report", params={"format": "markdown"}).text
    escaped_id = first["id"].replace("-", r"\-")  # md_escape escapes hyphens
    assert body.count(escaped_id) == 4  # one per evidence row (erin: three failures and one success)
