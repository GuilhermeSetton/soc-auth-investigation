"""SQL access for imports, events, alerts and investigations. Every value is a bound parameter."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.detections import Alert, run_detections, window_start
from app.parser import LogEvent

IMPORT_LOCK_KEY = 0x50C_A08  # serializes imports so concurrent uploads cannot race on alerts


def utc_iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def lock_imports(conn: psycopg.Connection) -> None:
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (IMPORT_LOCK_KEY,))


def usage(conn) -> tuple[int, int]:
    """(stored unique events, import records) for the global capacity check."""
    return conn.execute("SELECT (SELECT count(*) FROM events), (SELECT count(*) FROM imports)").fetchone()


def count_known_hashes(conn, hashes: list[str]) -> int:
    if not hashes:
        return 0
    return conn.execute(
        "SELECT count(*) FROM events WHERE line_sha256 = ANY(%s::char(64)[])", (hashes,)
    ).fetchone()[0]


def insert_import(conn, import_id: uuid.UUID, filename: str, total_lines: int, invalid_lines: list[dict]) -> None:
    conn.execute(
        "INSERT INTO imports (id, filename, total_lines, invalid_lines) VALUES (%s, %s, %s, %s)",
        (str(import_id), filename, total_lines, Jsonb(invalid_lines)),
    )


def finish_import(conn, import_id: uuid.UUID, imported: int, duplicates: int) -> None:
    conn.execute(
        "UPDATE imports SET imported_events = %s, duplicate_events = %s WHERE id = %s",
        (imported, duplicates, str(import_id)),
    )


def insert_events(conn, import_id: uuid.UUID, events: list[LogEvent]) -> int:
    """Insert new events by line hash; existing hashes keep their first import reference."""
    if not events:
        return 0
    rows = conn.execute(
        """
        INSERT INTO events (line_sha256, occurred_at, host, source, username, outcome, method,
                            import_id, line_number, raw_line)
        SELECT * FROM unnest(%s::char(64)[], %s::timestamptz[], %s::text[], %s::text[], %s::text[],
                             %s::text[], %s::text[], %s::uuid[], %s::int[], %s::text[])
        ON CONFLICT (line_sha256) DO NOTHING
        RETURNING line_number
        """,
        (
            [e.line_sha256 for e in events],
            [e.timestamp for e in events],
            [e.host for e in events],
            [e.source for e in events],
            [e.username for e in events],
            [e.outcome for e in events],
            [e.method for e in events],
            [str(import_id)] * len(events),
            [e.line_number for e in events],
            [e.raw_line for e in events],
        ),
    ).fetchall()
    return len(rows)


def _event_from_row(row) -> LogEvent:
    return LogEvent(
        line_number=row[0], timestamp=row[1], host=row[2], source=row[3], username=row[4],
        outcome=row[5], method=row[6], raw_line=row[7], line_sha256=row[8].strip(),
    )


EVENT_COLUMNS = "line_number, occurred_at, host, source, username, outcome, method, raw_line, line_sha256"


def load_all_events(conn) -> list[LogEvent]:
    rows = conn.execute(f"SELECT {EVENT_COLUMNS} FROM events ORDER BY occurred_at, line_sha256").fetchall()
    return [_event_from_row(r) for r in rows]


def upsert_alerts(conn, alerts: list[Alert]) -> None:
    """Alerts only grow in v1 (no event deletion), so upsert by stable ID is sufficient."""
    if not alerts:
        return
    conn.cursor().executemany(
        """
        INSERT INTO alerts (id, rule_id, rule_version, source, username, occurred_at, anchor_sha,
                            title, reason, false_positives, event_count)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, reason = EXCLUDED.reason,
                                       event_count = EXCLUDED.event_count
        """,
        [
            (a.id, a.rule_id, a.rule_version, a.source, a.username, a.timestamp, a.anchor_sha,
             a.title, a.reason, Jsonb(list(a.false_positives)), a.event_count)
            for a in alerts
        ],
    )


def rebuild_alerts(conn) -> int:
    """Run the rules over every stored event (old imports included) and persist the result.

    shortcut: full recompute of all events and a full alert upsert on every import.
    Measured: ~4 s for 10,000 stored events in one import. Upgrade to an incremental
    recompute (only alerts whose window touches the new events) when stored events
    regularly exceed about 50,000 or imports become frequent.
    """
    alerts = run_detections(load_all_events(conn))
    upsert_alerts(conn, alerts)
    return len(alerts)


ALERT_COLUMNS = (
    "a.id, a.rule_id, a.rule_version, a.source, a.occurred_at, a.title, a.reason, "
    "a.false_positives, a.event_count, COALESCE(i.status, 'open')"
)


def _alert_from_row(row) -> dict[str, Any]:
    return {
        "id": str(row[0]), "rule_id": row[1], "rule_version": row[2], "source": row[3],
        "timestamp": utc_iso(row[4]), "title": row[5], "reason": row[6],
        "false_positives": list(row[7]), "event_count": row[8], "status": row[9],
    }


def get_alert(conn, alert_id: uuid.UUID) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT {ALERT_COLUMNS} FROM alerts a LEFT JOIN investigations i ON i.alert_id = a.id WHERE a.id = %s",
        (str(alert_id),),
    ).fetchone()
    return _alert_from_row(row) if row else None


def get_alert_anchor(conn, alert_id: uuid.UUID):
    """Return (rule_id, source, username, occurred_at, anchor_sha) for evidence reconstruction."""
    return conn.execute(
        "SELECT rule_id, source, username, occurred_at, anchor_sha FROM alerts WHERE id = %s",
        (str(alert_id),),
    ).fetchone()


def alert_evidence(conn, rule_id: str, source: str, username: str | None,
                   occurred_at: datetime, anchor_sha: str) -> list[dict[str, Any]]:
    """Rebuild evidence from the rule and its interval; same set and order as the detector."""
    start = window_start(occurred_at)
    if rule_id == "success_after_failures":
        rows = conn.execute(
            f"SELECT {EVENT_COLUMNS}, id, import_id FROM events WHERE "
            "(outcome = 'failure' AND source = %s AND username = %s AND occurred_at >= %s AND occurred_at < %s) "
            "OR line_sha256 = %s ORDER BY occurred_at, line_sha256",
            (source, username, start, occurred_at, anchor_sha),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {EVENT_COLUMNS}, id, import_id FROM events WHERE "
            "outcome = 'failure' AND source = %s AND occurred_at BETWEEN %s AND %s "
            "ORDER BY occurred_at, line_sha256",
            (source, start, occurred_at),
        ).fetchall()
    return [event_to_dict(r) for r in rows]


def event_to_dict(row) -> dict[str, Any]:
    """row = EVENT_COLUMNS + id + import_id. import_id is the FIRST import that stored the line."""
    return {
        "id": str(row[9]),
        "timestamp": utc_iso(row[1]),
        "host": row[2],
        "source": row[3],
        "username": row[4],
        "outcome": row[5],
        "method": row[6],
        "import_id": str(row[10]),
        "line_number": row[0],
        "raw_line": row[7],
    }


def get_investigation(conn, alert_id: uuid.UUID) -> dict[str, Any]:
    row = conn.execute(
        "SELECT status, classification, notes, updated_at FROM investigations WHERE alert_id = %s",
        (str(alert_id),),
    ).fetchone()
    if row is None:
        return {"alert_id": str(alert_id), "status": "open", "classification": "unclassified",
                "notes": "", "updated_at": None}
    return {"alert_id": str(alert_id), "status": row[0], "classification": row[1],
            "notes": row[2], "updated_at": utc_iso(row[3])}


def save_investigation(conn, alert_id: uuid.UUID, status: str, classification: str, notes: str) -> dict[str, Any]:
    conn.execute(
        """
        INSERT INTO investigations (alert_id, status, classification, notes, updated_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (alert_id) DO UPDATE SET status = EXCLUDED.status,
            classification = EXCLUDED.classification, notes = EXCLUDED.notes, updated_at = now()
        """,
        (str(alert_id), status, classification, notes),
    )
    return get_investigation(conn, alert_id)


def count_events(conn, *, filters: list[str], params: list[Any]) -> int:
    return conn.execute(f"SELECT count(*) FROM events{_where(filters)}", params).fetchone()[0]


def list_events(conn, *, filters: list[str], params: list[Any], limit: int, offset: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"SELECT {EVENT_COLUMNS}, id, import_id FROM events{_where(filters)} "
        "ORDER BY occurred_at, id LIMIT %s OFFSET %s",
        [*params, limit, offset],
    ).fetchall()
    return [event_to_dict(r) for r in rows]


def count_alerts(conn, *, filters: list[str], params: list[Any]) -> int:
    return conn.execute(
        f"SELECT count(*) FROM alerts a LEFT JOIN investigations i ON i.alert_id = a.id{_where(filters)}",
        params,
    ).fetchone()[0]


def list_alerts(conn, *, filters: list[str], params: list[Any], limit: int, offset: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"SELECT {ALERT_COLUMNS} FROM alerts a LEFT JOIN investigations i ON i.alert_id = a.id"
        f"{_where(filters)} ORDER BY a.occurred_at, a.id LIMIT %s OFFSET %s",
        [*params, limit, offset],
    ).fetchall()
    return [_alert_from_row(r) for r in rows]


def summary(conn) -> dict[str, int]:
    row = conn.execute(
        """
        SELECT (SELECT count(*) FROM events),
               (SELECT count(*) FROM alerts),
               (SELECT count(*) FROM alerts a LEFT JOIN investigations i ON i.alert_id = a.id
                  WHERE COALESCE(i.status, 'open') <> 'closed'),
               (SELECT count(*) FROM events WHERE outcome = 'success'),
               (SELECT count(*) FROM events WHERE outcome = 'failure')
        """
    ).fetchone()
    return {"events": row[0], "alerts": row[1], "open_alerts": row[2],
            "successful_authentications": row[3], "failed_authentications": row[4]}


def import_summary(conn, import_id: uuid.UUID) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT id, filename, total_lines, imported_events, duplicate_events, invalid_lines FROM imports WHERE id = %s",
        (str(import_id),),
    ).fetchone()
    if row is None:
        return None
    return {"id": str(row[0]), "filename": row[1], "total_lines": row[2], "imported_events": row[3],
            "duplicate_events": row[4], "invalid_lines": list(row[5])}


def _where(filters: list[str]) -> str:
    return (" WHERE " + " AND ".join(filters)) if filters else ""
