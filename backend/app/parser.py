"""Strict parser for OpenSSH authentication lines (contract v1).

Accepted line grammar (one event per line, UTF-8, LF or CRLF terminated):

    <ts> <host> sshd[<pid>]: <message>

    ts       RFC3339 with fraction (1-6 digits, optional) and mandatory offset:
             YYYY-MM-DDTHH:MM:SS[.f{1,6}](Z|±HH:MM), offset hours <= 23, minutes <= 59
    host     [A-Za-z0-9._-]{1,255}
    pid      [1-9][0-9]{0,9}
    message  one of:
      Failed (password|publickey) for (invalid user )?<user> from <ip> port <port> ssh2
      Accepted (password|publickey) for <user> from <ip> port <port> ssh2
    user     [A-Za-z0-9._@-]{1,255}
    ip       IPv4 or IPv6 accepted by the ipaddress module (canonicalized)
    port     1..65535, no leading zero

Anything else is an invalid line with a stable reason code. Whole-upload failures
(size, line count, UTF-8) raise exceptions and must leave the database untouched.
"""

from __future__ import annotations

import codecs
import hashlib
import ipaddress
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_LINES = 10_000
MAX_LINE_BYTES = 8 * 1024
MAX_TEXT_FIELD = 255

_TS_RE = re.compile(
    r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,6}))?(Z|[+-][0-9]{2}:[0-9]{2})"
)
_TS_NO_OFFSET_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?")
_LINE_RE = re.compile(r"(\S+) ([A-Za-z0-9._-]{1,255}) sshd\[([1-9][0-9]{0,9})\]: (.+)")
_USER = r"[A-Za-z0-9._@-]{1,255}"
_ADDR = r"[0-9A-Fa-f:.]{1,45}"
_PORT = r"[0-9]{1,5}"
_FAIL_RE = re.compile(
    rf"Failed (password|publickey) for (?:invalid user )?({_USER}) from ({_ADDR}) port ({_PORT}) ssh2"
)
_OK_RE = re.compile(rf"Accepted (password|publickey) for ({_USER}) from ({_ADDR}) port ({_PORT}) ssh2")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class LogEvent:
    line_number: int
    timestamp: datetime  # aware, UTC, microsecond precision
    host: str
    source: str  # canonical IP of the origin
    username: str
    outcome: str  # "failure" | "success"
    method: str  # "password" | "publickey"
    raw_line: str  # decoded line without CR/LF
    line_sha256: str  # identity: SHA-256 of the original line bytes without CR/LF


@dataclass(frozen=True)
class InvalidLine:
    line_number: int
    reason: str


@dataclass
class ParseResult:
    total_lines: int = 0
    events: list[LogEvent] = field(default_factory=list)
    invalid_lines: list[InvalidLine] = field(default_factory=list)


class ImportLimitError(Exception):
    """Upload exceeds a size or line limit (API maps to 413)."""


class InvalidEncodingError(Exception):
    """Upload is not valid UTF-8 (API maps to 422)."""


def parse_timestamp(text: str) -> datetime | None:
    m = _TS_RE.fullmatch(text)
    if not m:
        return None
    year, month, day, hour, minute, second = (int(g) for g in m.groups()[:6])
    fraction, offset = m.group(7), m.group(8)
    micro = int(fraction.ljust(6, "0")) if fraction else 0
    if offset == "Z":
        tz = timezone.utc
    else:
        oh, om = int(offset[1:3]), int(offset[4:6])
        if oh > 23 or om > 59:
            return None
        delta = timedelta(hours=oh, minutes=om)
        tz = timezone(delta if offset[0] == "+" else -delta)
    try:
        return datetime(year, month, day, hour, minute, second, micro, tzinfo=tz).astimezone(timezone.utc)
    except (ValueError, OverflowError):  # Feb 30, leap second 60, or UTC outside datetime range
        return None


def _parse_line(number: int, raw: bytes) -> LogEvent | InvalidLine:
    if raw.endswith(b"\r"):
        raw = raw[:-1]
    if not raw:
        return InvalidLine(number, "empty_line")
    if len(raw) > MAX_LINE_BYTES:
        return InvalidLine(number, "line_too_long")
    text = raw.decode("utf-8")  # whole stream already validated as UTF-8
    if _CONTROL_RE.search(text):
        return InvalidLine(number, "control_character")
    m = _LINE_RE.fullmatch(text)
    if not m:
        return InvalidLine(number, "invalid_format")
    ts_text, host, message = m.group(1), m.group(2), m.group(4)
    timestamp = parse_timestamp(ts_text)
    if timestamp is None:
        reason = "timestamp_without_offset" if _TS_NO_OFFSET_RE.fullmatch(ts_text) else "invalid_timestamp"
        return InvalidLine(number, reason)

    fail = _FAIL_RE.fullmatch(message)
    ok = None if fail else _OK_RE.fullmatch(message)
    if not fail and not ok:
        return InvalidLine(number, "unsupported_message")
    match = fail or ok
    method, username, addr, port = match.group(1), match.group(2), match.group(3), match.group(4)
    try:
        source = str(ipaddress.ip_address(addr))
    except ValueError:
        return InvalidLine(number, "invalid_ip")
    if port[0] == "0" or not 1 <= int(port) <= 65535:
        return InvalidLine(number, "invalid_port")

    return LogEvent(
        line_number=number,
        timestamp=timestamp,
        host=host,
        source=source,
        username=username,
        outcome="failure" if fail else "success",
        method=method,
        raw_line=text,
        line_sha256=hashlib.sha256(raw).hexdigest(),
    )


def parse_stream(chunks: Iterable[bytes]) -> ParseResult:
    """Parse an upload delivered in chunks, enforcing limits while streaming."""
    result = ParseResult()
    decoder = codecs.getincrementaldecoder("utf-8")(errors="strict")
    total_bytes = 0
    buf = bytearray()
    too_long = False

    def emit(raw: bytes, overflowed: bool) -> None:
        result.total_lines += 1
        if result.total_lines > MAX_LINES:
            raise ImportLimitError("too many lines")
        if overflowed:
            result.invalid_lines.append(InvalidLine(result.total_lines, "line_too_long"))
            return
        parsed = _parse_line(result.total_lines, raw)
        if isinstance(parsed, LogEvent):
            result.events.append(parsed)
        else:
            result.invalid_lines.append(parsed)

    for chunk in chunks:
        total_bytes += len(chunk)
        if total_bytes > MAX_UPLOAD_BYTES:
            raise ImportLimitError("upload too large")
        try:
            decoder.decode(chunk)
        except UnicodeDecodeError as exc:
            raise InvalidEncodingError("invalid UTF-8") from exc
        start = 0
        while True:
            nl = chunk.find(b"\n", start)
            piece = chunk[start:] if nl == -1 else chunk[start:nl]
            # +1 leaves room for the CR of a CRLF terminator; the exact check happens in _parse_line.
            if not too_long:
                if len(buf) + len(piece) > MAX_LINE_BYTES + 1:
                    too_long = True
                    buf.clear()
                else:
                    buf += piece
            if nl == -1:
                break
            emit(bytes(buf), too_long)
            buf.clear()
            too_long = False
            start = nl + 1

    try:
        decoder.decode(b"", final=True)
    except UnicodeDecodeError as exc:
        raise InvalidEncodingError("invalid UTF-8") from exc
    if buf or too_long:  # unterminated last line
        emit(bytes(buf), too_long)
    return result


def parse_bytes(data: bytes) -> ParseResult:
    return parse_stream([data])


def deduplicate(events: list[LogEvent]) -> tuple[list[LogEvent], int]:
    """Keep the first occurrence of each line identity; return (unique, duplicate_count)."""
    seen: set[str] = set()
    unique: list[LogEvent] = []
    for event in events:
        if event.line_sha256 not in seen:
            seen.add(event.line_sha256)
            unique.append(event)
    return unique, len(events) - len(unique)
