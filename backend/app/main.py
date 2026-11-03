"""FastAPI application for the local SOC investigation API (contract v1, prefix /api)."""

from __future__ import annotations

import ipaddress
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Literal

import psycopg
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from app import store
from app.db import DatabaseNotConfigured, connect
from app.parser import MAX_UPLOAD_BYTES, ImportLimitError, InvalidEncodingError, deduplicate, parse_stream
from app.reports import report_json, report_markdown

LOCAL_ORIGIN = "http://127.0.0.1:5173"
ALLOWED_ORIGINS = (LOCAL_ORIGIN,)
# Multipart envelope overhead on top of the file limit; the file itself is enforced by the parser.
MULTIPART_OVERHEAD_BYTES = 64 * 1024
CHUNK_BYTES = 64 * 1024
MAX_NOTES = 10_000
# Global local capacity (contract: Endurecimento). Checked under the import lock, before any write.
MAX_STORED_EVENTS = 50_000  # unique events
MAX_IMPORTS = 1_000  # import records
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]  # Starlette compares host names without the port

RuleId = Literal["repeated_failures", "multiple_users", "success_after_failures"]
AlertStatus = Literal["open", "in_progress", "closed"]
Classification = Literal["unclassified", "benign", "suspicious", "confirmed_incident"]
Outcome = Literal["failure", "success"]


class BodyLimitMiddleware:
    """Counts request body bytes as they arrive, so Content-Length is never trusted."""

    def __init__(self, app, path: str, limit: int):
        self.app = app
        self.path = path
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] != self.path or scope["method"] != "POST":
            return await self.app(scope, receive, send)

        received = 0

        class _TooLarge(Exception):
            pass

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.limit:
                    raise _TooLarge()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            response = JSONResponse(
                status_code=413,
                content={"detail": "Upload exceeds 2 MiB or 10,000 lines; nothing was imported"},
            )
            await response(scope, receive, send)


app = FastAPI(title="SOC Auth Investigation API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type"],
)
app.add_middleware(BodyLimitMiddleware, path="/api/imports", limit=MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)  # added last: outermost, checks every request


def require_local_origin(origin: str | None = Header(default=None)) -> None:
    """Mutations need exactly the local frontend origin. Absent, 'null' or other origins are refused.

    This limits browser cross-site writes; it does not authenticate local processes.
    """
    if origin != LOCAL_ORIGIN:
        raise HTTPException(status_code=403, detail="Origin not allowed")


class CapacityExceeded(Exception):
    """A global limit would be exceeded. Raised before any row is written."""


log = logging.getLogger("soc_auth.api")


def _log_database_failure(request: Request, exc: Exception, kind: str) -> None:
    # Class name and operation only: str(exc), parameters and tracebacks can hold DSNs or notes.
    log.error("%s: %s during %s %s", kind, type(exc).__name__, request.method, request.url.path)


@app.exception_handler(DatabaseNotConfigured)
@app.exception_handler(psycopg.OperationalError)
async def database_unavailable(request: Request, exc: Exception):
    _log_database_failure(request, exc, "database unavailable")
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})


@app.exception_handler(psycopg.Error)
async def database_error(request: Request, exc: Exception):
    _log_database_failure(request, exc, "database error")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    # Pydantic echoes the rejected input (e.g. a 10,000+ character note); keep only location and message.
    errors = [{k: v for k, v in err.items() if k not in ("input", "ctx")} for err in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


def _utc(value: datetime | None, name: str) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise HTTPException(status_code=422, detail=f"{name} must include a UTC offset")
    try:
        return value.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        raise HTTPException(status_code=422, detail=f"{name} is out of range")


def _time_filters(column: str, from_time, to_time) -> tuple[list[str], list]:
    start, end = _utc(from_time, "from_time"), _utc(to_time, "to_time")
    if start and end and start > end:
        raise HTTPException(status_code=422, detail="from_time must be earlier than or equal to to_time")
    filters, params = [], []
    if start:
        filters.append(f"{column} >= %s")
        params.append(start)
    if end:
        filters.append(f"{column} <= %s")
        params.append(end)
    return filters, params


def _canonical_source(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return value


def sanitize_filename(name: str | None) -> str:
    """Display name only: never used as a path. Strips directories and unsafe characters."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")[:255]
    return cleaned or "upload.log"


def _read_chunks(fileobj):
    while chunk := fileobj.read(CHUNK_BYTES):
        yield chunk


def _check_capacity(conn, events) -> None:
    stored, imports = store.usage(conn)
    new_events = len(events) - store.count_known_hashes(conn, [e.line_sha256 for e in events])
    if imports + 1 > MAX_IMPORTS:
        raise CapacityExceeded(
            f"Local capacity reached: {MAX_IMPORTS} import records are stored. Nothing was imported.")
    if stored + new_events > MAX_STORED_EVENTS:
        raise CapacityExceeded(
            f"Local capacity reached: {MAX_STORED_EVENTS} unique events are stored and this file adds "
            f"{new_events} new. Nothing was imported; no data was removed.")


@app.exception_handler(CapacityExceeded)
async def capacity_exceeded(_request: Request, exc: CapacityExceeded):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.get("/api/health")
def health():
    with connect() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.post("/api/imports", status_code=201, dependencies=[Depends(require_local_origin)])
def create_import(file: UploadFile = File(...)):
    try:
        parsed = parse_stream(_read_chunks(file.file))
    except ImportLimitError:
        raise HTTPException(status_code=413, detail="Upload exceeds 2 MiB or 10,000 lines; nothing was imported")
    except InvalidEncodingError:
        raise HTTPException(status_code=422, detail="File must be valid UTF-8; nothing was imported")

    unique, _within_file_duplicates = deduplicate(parsed.events)
    import_id = uuid.uuid4()
    invalid = [{"line_number": i.line_number, "reason": i.reason} for i in parsed.invalid_lines]
    with connect() as conn:
        store.lock_imports(conn)
        _check_capacity(conn, unique)  # before any write: a refused import leaves no partial state
        store.insert_import(conn, import_id, sanitize_filename(file.filename), parsed.total_lines, invalid)
        inserted = store.insert_events(conn, import_id, unique)
        duplicates = len(parsed.events) - inserted
        store.finish_import(conn, import_id, inserted, duplicates)
        store.rebuild_alerts(conn)
        result = store.import_summary(conn, import_id)
    return result


@app.get("/api/events")
def list_events(
    source: str | None = Query(default=None, max_length=45),
    username: str | None = Query(default=None, max_length=255),
    outcome: Outcome | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    filters, params = _time_filters("occurred_at", from_time, to_time)
    if source:
        filters.append("source = %s")
        params.append(_canonical_source(source))
    if username:
        filters.append("username = %s")
        params.append(username)
    if outcome:
        filters.append("outcome = %s")
        params.append(outcome)
    with connect() as conn:
        total = store.count_events(conn, filters=filters, params=params)
        items = store.list_events(conn, filters=filters, params=params, limit=limit, offset=offset)
    return {"items": items, "total": total}


@app.get("/api/alerts")
def list_alerts(
    rule_id: RuleId | None = None,
    status: AlertStatus | None = None,
    source: str | None = Query(default=None, max_length=45),
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    filters, params = _time_filters("a.occurred_at", from_time, to_time)
    if rule_id:
        filters.append("a.rule_id = %s")
        params.append(rule_id)
    if status:
        filters.append("COALESCE(i.status, 'open') = %s")
        params.append(status)
    if source:
        filters.append("a.source = %s")
        params.append(_canonical_source(source))
    with connect() as conn:
        total = store.count_alerts(conn, filters=filters, params=params)
        items = store.list_alerts(conn, filters=filters, params=params, limit=limit, offset=offset)
    return {"items": items, "total": total}


@app.get("/api/summary")
def summary():
    with connect() as conn:
        return store.summary(conn)


def _alert_detail(conn, alert_id: uuid.UUID) -> dict:
    alert = store.get_alert(conn, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    rule_id, source, username, occurred_at, anchor_sha = store.get_alert_anchor(conn, alert_id)
    events = store.alert_evidence(conn, rule_id, source, username, occurred_at, anchor_sha)
    investigation = store.get_investigation(conn, alert_id)
    return {"alert": alert, "events": events, "investigation": investigation}


@app.get("/api/alerts/{alert_id}")
def alert_detail(alert_id: uuid.UUID):
    with connect() as conn:
        return _alert_detail(conn, alert_id)


class InvestigationUpdate(BaseModel):
    status: AlertStatus
    classification: Classification
    notes: str = Field(max_length=MAX_NOTES)


@app.patch("/api/alerts/{alert_id}/investigation", dependencies=[Depends(require_local_origin)])
def update_investigation(alert_id: uuid.UUID, body: InvestigationUpdate):
    with connect() as conn:
        if store.get_alert(conn, alert_id) is None:
            raise HTTPException(status_code=404, detail="Alert not found")
        return store.save_investigation(conn, alert_id, body.status, body.classification, body.notes)


@app.get("/api/alerts/{alert_id}/report")
def alert_report(alert_id: uuid.UUID, fmt: Literal["json", "markdown"] = Query(default="json", alias="format")):
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with connect() as conn:
        detail = _alert_detail(conn, alert_id)
    args = (detail["alert"], detail["events"], detail["investigation"], generated_at)
    if fmt == "json":
        body, media, extension = report_json(*args), "application/json; charset=utf-8", "json"
    else:
        body, media, extension = report_markdown(*args), "text/markdown; charset=utf-8", "md"
    filename = f"alert-{alert_id}.{extension}"
    return Response(content=body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
