import hashlib

import pytest

from app.parser import (
    MAX_LINE_BYTES,
    MAX_LINES,
    MAX_UPLOAD_BYTES,
    ImportLimitError,
    InvalidEncodingError,
    deduplicate,
    parse_bytes,
    parse_stream,
    parse_timestamp,
)
from datetime import datetime, timezone

OK = "2026-10-01T12:00:00Z lab sshd[101]: Accepted publickey for alice from 192.0.2.10 port 50001 ssh2"
FAIL = "2026-10-01T12:00:00Z lab sshd[101]: Failed password for invalid user alice from 192.0.2.10 port 50000 ssh2"


def parse_one(line: str):
    result = parse_bytes(line.encode("utf-8") + b"\n")
    assert result.total_lines == 1
    return result


def reason_of(line: str) -> str:
    result = parse_one(line)
    assert len(result.invalid_lines) == 1, result
    return result.invalid_lines[0].reason


# --- positive -------------------------------------------------------------

def test_failed_password_invalid_user_fields():
    event = parse_one(FAIL).events[0]
    assert event.outcome == "failure"
    assert event.method == "password"
    assert event.username == "alice"
    assert event.source == "192.0.2.10"
    assert event.host == "lab"
    assert event.timestamp == datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
    assert event.line_number == 1


def test_failed_password_valid_user_marker_absent():
    event = parse_one("2026-10-01T12:00:00Z lab sshd[9]: Failed password for root from 192.0.2.1 port 22 ssh2").events[0]
    assert (event.username, event.outcome) == ("root", "failure")


def test_accepted_publickey_is_success():
    event = parse_one(OK).events[0]
    assert (event.outcome, event.method) == ("success", "publickey")


def test_failed_publickey_is_failure_with_method():
    event = parse_one("2026-10-01T12:00:00Z lab sshd[9]: Failed publickey for bob from 192.0.2.1 port 22 ssh2").events[0]
    assert (event.outcome, event.method) == ("failure", "publickey")


def test_ipv6_is_canonicalized_and_accepted():
    event = parse_one("2026-10-01T12:00:00Z lab sshd[9]: Accepted password for alice from 2001:DB8:0:0::0001 port 1 ssh2").events[0]
    assert event.source == "2001:db8::1"


def test_offset_is_normalized_to_utc():
    event = parse_one("2026-10-01T14:00:00.250000+02:00 lab sshd[9]: Accepted password for alice from 192.0.2.1 port 22 ssh2").events[0]
    assert event.timestamp == datetime(2026, 10, 1, 12, 0, 0, 250000, tzinfo=timezone.utc)


def test_fraction_with_fewer_digits_is_padded():
    event = parse_one("2026-10-01T12:00:00.5Z lab sshd[9]: Accepted password for alice from 192.0.2.1 port 22 ssh2").events[0]
    assert event.timestamp.microsecond == 500000


def test_line_identity_is_sha256_of_line_without_crlf():
    raw = OK.encode()
    result = parse_bytes(raw + b"\r\n")
    event = result.events[0]
    assert event.line_sha256 == hashlib.sha256(raw).hexdigest()
    assert event.raw_line == OK


def test_same_line_in_two_files_has_same_identity():
    a = parse_bytes(OK.encode() + b"\n").events[0]
    b = parse_bytes(OK.encode() + b"\r\n").events[0]
    assert a.line_sha256 == b.line_sha256


def test_port_boundaries_accepted():
    for port in ("1", "65535"):
        assert parse_one(f"2026-10-01T12:00:00Z lab sshd[9]: Accepted password for a from 192.0.2.1 port {port} ssh2").events


# --- negative (reason codes) ----------------------------------------------

@pytest.mark.parametrize(
    "line, reason",
    [
        ("2026-10-01T12:00:00 lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "timestamp_without_offset"),
        ("2026-10-01T12:00:00.123 lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "timestamp_without_offset"),
        ("Oct  1 12:00:00 lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "invalid_format"),
        ("2026-10-01T12:00:00Z lab cron[1]: job", "invalid_format"),
        ("2026-02-30T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "invalid_timestamp"),
        ("2026-10-01T12:00:60Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "invalid_timestamp"),
        ("2026-10-01T12:00:00+24:00 lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "invalid_timestamp"),
        ("2026-10-01T12:00:00+00:60 lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "invalid_timestamp"),
        ("2026-10-01t12:00:00z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2", "invalid_timestamp"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for invalid user a from 192.0.2.1 port 22 ssh2", "unsupported_message"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Connection closed by 192.0.2.1 port 22", "unsupported_message"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22", "unsupported_message"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2 extra", "unsupported_message"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from host.example port 22 ssh2", "unsupported_message"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 999.1.1.1 port 22 ssh2", "invalid_ip"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 010.0.0.1 port 22 ssh2", "invalid_ip"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 2001:db8:::1 port 22 ssh2", "invalid_ip"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 0 ssh2", "invalid_port"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 65536 ssh2", "invalid_port"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 022 ssh2", "invalid_port"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a\tfrom 192.0.2.1 port 22 ssh2", "control_character"),
        ("2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2\x1b[31m", "control_character"),
        ("", "empty_line"),
        ("\r", "empty_line"),
    ],
)
def test_invalid_lines_have_reason(line, reason):
    assert reason_of(line) == reason


def test_invalid_line_keeps_line_number_and_does_not_produce_event():
    result = parse_bytes(OK.encode() + b"\nbogus\n" + FAIL.encode() + b"\n")
    assert [e.line_number for e in result.events] == [1, 3]
    assert [(i.line_number, i.reason) for i in result.invalid_lines] == [(2, "invalid_format")]
    assert result.total_lines == 3


def test_invalid_utf8_rejects_whole_stream():
    with pytest.raises(InvalidEncodingError):
        parse_bytes(OK.encode() + b"\n\xff\xfe\n")


def test_utf8_sequence_split_across_chunks_is_valid():
    data = (OK + " é\n").encode("utf-8")
    cut = data.index("é".encode()[0:1])  # split inside the multibyte char
    result = parse_stream([data[:cut + 1], data[cut + 1:]])
    assert result.total_lines == 1


def test_truncated_utf8_at_end_is_rejected():
    with pytest.raises(InvalidEncodingError):
        parse_stream([OK.encode() + b"\n" + "é".encode()[:1]])


# --- structure, limits and streaming --------------------------------------

def test_empty_file_has_no_lines():
    result = parse_bytes(b"")
    assert (result.total_lines, result.events, result.invalid_lines) == (0, [], [])


def test_trailing_newline_does_not_create_extra_line():
    assert parse_bytes((OK + "\n").encode()).total_lines == 1


def test_unterminated_last_line_is_counted():
    result = parse_bytes((OK + "\n" + FAIL).encode())
    assert result.total_lines == 2
    assert len(result.events) == 2


def test_chunked_input_matches_single_chunk():
    data = (OK + "\n" + FAIL + "\n").encode()
    single = parse_bytes(data)
    chunked = parse_stream(data[i:i + 7] for i in range(0, len(data), 7))
    assert chunked == single


def test_line_of_exact_max_size_is_not_too_long():
    prefix = "2026-10-01T12:00:00Z lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2"
    padded = prefix + " " * (MAX_LINE_BYTES - len(prefix))  # padding is invalid grammar, not too long
    assert reason_of(padded) == "unsupported_message"


def test_line_over_max_size_is_too_long_without_storing_it():
    result = parse_bytes(b"x" * (MAX_LINE_BYTES + 2) + b"\n" + OK.encode() + b"\n")
    assert [(i.line_number, i.reason) for i in result.invalid_lines] == [(1, "line_too_long")]
    assert [e.line_number for e in result.events] == [2]


def test_max_size_line_with_crlf_is_measured_without_cr():
    line = b"x" * MAX_LINE_BYTES + b"\r\n"
    assert parse_bytes(line).invalid_lines[0].reason == "invalid_format"


def test_upload_at_limit_is_accepted_and_one_byte_over_is_rejected():
    block = b"x" * (MAX_LINE_BYTES - 1) + b"\n"  # 8 KiB lines, invalid but counted
    at_limit = block * (MAX_UPLOAD_BYTES // len(block))
    assert len(at_limit) == MAX_UPLOAD_BYTES
    assert parse_stream([at_limit]).total_lines == MAX_UPLOAD_BYTES // len(block)
    with pytest.raises(ImportLimitError):
        parse_stream([at_limit + b"x"])


def test_line_count_at_limit_is_accepted_and_one_over_is_rejected():
    assert parse_bytes(b"\n" * MAX_LINES).total_lines == MAX_LINES
    with pytest.raises(ImportLimitError):
        parse_bytes(b"\n" * (MAX_LINES + 1))


def test_deduplicate_keeps_first_occurrence_and_counts_repeats():
    result = parse_bytes((OK + "\n" + FAIL + "\n" + OK + "\n").encode())
    unique, duplicates = deduplicate(result.events)
    assert [e.line_number for e in unique] == [1, 2]
    assert duplicates == 1


def test_parse_timestamp_rejects_missing_offset_and_accepts_utc_z():
    assert parse_timestamp("2026-10-01T12:00:00") is None
    assert parse_timestamp("2026-10-01T12:00:00Z") == datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


# --- regressions from QA (round 2): extreme dates and BOM -------------------

def test_timestamp_year_one_with_positive_offset_is_invalid_not_overflow():
    assert parse_timestamp("0001-01-01T00:00:00+01:00") is None
    assert reason_of("0001-01-01T00:00:00+01:00 lab sshd[1]: Accepted password for a from 192.0.2.1 port 22 ssh2") == "invalid_timestamp"


def test_timestamp_year_9999_with_negative_offset_is_invalid_not_overflow():
    assert parse_timestamp("9999-12-31T23:59:59-01:00") is None


def test_timestamp_year_one_utc_is_valid():
    assert parse_timestamp("0001-01-01T00:00:00Z") == datetime(1, 1, 1, tzinfo=timezone.utc)


def test_bom_on_first_line_makes_it_invalid_timestamp():
    result = parse_bytes(("\ufeff" + OK + "\n").encode("utf-8"))
    assert result.events == []
    assert [(i.line_number, i.reason) for i in result.invalid_lines] == [(1, "invalid_timestamp")]
