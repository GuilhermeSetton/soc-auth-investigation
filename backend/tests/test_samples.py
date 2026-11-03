import json
from pathlib import Path

import pytest

from app.detections import run_detections
from app.parser import deduplicate, parse_bytes

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
EXPECTED = json.loads((SAMPLES / "expected_v1.json").read_text(encoding="utf-8"))


def _iso_z(ts) -> str:
    return ts.isoformat().replace("+00:00", "Z")


@pytest.mark.parametrize("name", ["lab_auth_v1.log", "invalid_lines_v1.log"])
def test_sample_counts_and_invalid_lines_match_expected(name):
    expected = EXPECTED[name]
    result = parse_bytes((SAMPLES / name).read_bytes())
    unique, duplicates = deduplicate(result.events)

    assert result.total_lines == expected["total_lines"]
    assert len(unique) == expected["imported_events"]
    assert duplicates == expected["duplicate_events"]
    assert [{"line_number": i.line_number, "reason": i.reason} for i in result.invalid_lines] == expected["invalid_lines"]
    # contract: counts add up to total_lines
    assert len(unique) + duplicates + len(result.invalid_lines) == result.total_lines


def test_lab_sample_failed_and_successful_counts():
    expected = EXPECTED["lab_auth_v1.log"]
    events = parse_bytes((SAMPLES / "lab_auth_v1.log").read_bytes()).events
    assert sum(e.outcome == "failure" for e in events) == expected["failed_events"]
    assert sum(e.outcome == "success" for e in events) == expected["successful_events"]


def test_lab_sample_alerts_match_expected():
    expected = EXPECTED["lab_auth_v1.log"]
    events = parse_bytes((SAMPLES / "lab_auth_v1.log").read_bytes()).events
    alerts = run_detections(events)

    got = sorted((a.timestamp, a.rule_id, a.source, a.event_count) for a in alerts)
    want = sorted(
        (x["timestamp"], x["rule_id"], x["source"], x["event_count"]) for x in expected["alerts"]
    )
    got = [(_iso_z(ts), rule, src, count) for ts, rule, src, count in got]
    assert got == want

    totals = {rule: sum(a.rule_id == rule for a in alerts) for rule in expected["alert_totals"] if rule != "total"}
    assert totals == {k: v for k, v in expected["alert_totals"].items() if k != "total"}
    assert len(alerts) == expected["alert_totals"]["total"]


def test_invalid_sample_produces_no_alerts():
    events = parse_bytes((SAMPLES / "invalid_lines_v1.log").read_bytes()).events
    assert run_detections(events) == []
