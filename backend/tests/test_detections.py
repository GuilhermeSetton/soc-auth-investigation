import hashlib
import itertools
import random
import time
import tracemalloc
import uuid
from datetime import datetime, timedelta, timezone

from app.detections import run_detections
from app.parser import LogEvent

UTC = timezone.utc
BASE = datetime(2026, 10, 1, 12, 0, 0, tzinfo=UTC)
MIN_UTC = datetime(1, 1, 1, tzinfo=UTC)
_counter = itertools.count()


def ev(seconds: float = 0, user="alice", source="192.0.2.1", outcome="failure", micro: int = 0, base=BASE) -> LogEvent:
    n = next(_counter)
    at = base + timedelta(seconds=seconds, microseconds=micro)
    sha = hashlib.sha256(f"{n}|{at.isoformat()}|{source}|{user}|{outcome}".encode()).hexdigest()
    return LogEvent(
        line_number=n + 1,
        timestamp=at,
        host="lab",
        source=source,
        username=user,
        outcome=outcome,
        method="password",
        raw_line="",
        line_sha256=sha,
    )


def rules(alerts):
    return sorted(a.rule_id for a in alerts)


def reference(events):
    """Brute-force oracle written straight from the contract (no windows shared, no sliding)."""
    ordered = sorted(events, key=lambda e: (e.timestamp, e.line_sha256))
    failures = [e for e in ordered if e.outcome == "failure"]
    out = {}
    for f in failures:
        window = [x for x in failures if x.source == f.source
                  and f.timestamp - timedelta(seconds=300) <= x.timestamp <= f.timestamp]
        if len(window) >= 5:
            out[("repeated_failures", f.source, f.line_sha256)] = [x.line_sha256 for x in window]
        if len({x.username for x in window}) >= 5:
            out[("multiple_users", f.source, f.line_sha256)] = [x.line_sha256 for x in window]
    for s in ordered:
        if s.outcome != "success":
            continue
        window = [x for x in failures if x.source == s.source and x.username == s.username
                  and s.timestamp - timedelta(seconds=300) <= x.timestamp < s.timestamp]
        if len(window) >= 3:
            out[("success_after_failures", s.source, s.line_sha256)] = [x.line_sha256 for x in window] + [s.line_sha256]
    return out


# --- repeated_failures: >= 5 failures from one source in [t-300s, t] -------

def test_four_failures_below_threshold_no_alert():
    assert run_detections([ev(s) for s in (0, 60, 120, 180)]) == []


def test_five_failures_within_300s_inclusive_fire_on_anchor():
    alerts = run_detections([ev(s) for s in (0, 75, 150, 225, 300)])
    assert rules(alerts) == ["repeated_failures"]
    assert alerts[0].event_count == 5
    assert alerts[0].timestamp == BASE + timedelta(seconds=300)


def test_first_failure_just_outside_window_does_not_count():
    events = [ev(s) for s in (0, 75, 150, 225)] + [ev(300, micro=1)]
    assert run_detections(events) == []


def test_failures_from_different_sources_are_not_combined():
    events = [ev(s, source="192.0.2.1") for s in (0, 60, 120)] + [ev(s, source="192.0.2.2") for s in (180, 240)]
    assert run_detections(events) == []


# --- multiple_users: >= 5 distinct users from one source in [t-300s, t] ----

def test_same_user_repeated_does_not_trigger_multiple_users():
    alerts = run_detections([ev(s, user="alice") for s in (0, 30, 60, 90, 120)])
    assert "multiple_users" not in rules(alerts)


def test_five_distinct_users_trigger_multiple_users():
    users = ["u1", "u2", "u3", "u4", "u5"]
    alerts = run_detections([ev(i * 20, user=u) for i, u in enumerate(users)])
    multi = [a for a in alerts if a.rule_id == "multiple_users"]
    assert len(multi) == 1
    assert multi[0].event_count == 5


def test_distinct_users_spread_beyond_window_do_not_trigger():
    users = ["u1", "u2", "u3", "u4", "u5"]
    alerts = run_detections([ev(i * 301, user=u) for i, u in enumerate(users)])
    assert "multiple_users" not in rules(alerts)


# --- success_after_failures: >= 3 same-user failures in [t-300s, t) -------

def test_two_failures_then_success_no_alert():
    assert run_detections([ev(0), ev(60), ev(120, outcome="success")]) == []


def test_three_failures_then_success_alert_with_evidence():
    alerts = run_detections([ev(0), ev(60), ev(120), ev(180, outcome="success")])
    assert rules(alerts) == ["success_after_failures"]
    assert alerts[0].event_count == 4  # three failures + the success
    assert len(set(alerts[0].evidence)) == 4


def test_failure_exactly_300s_before_success_counts():
    alerts = run_detections([ev(0), ev(150), ev(200), ev(300, outcome="success")])
    assert rules(alerts) == ["success_after_failures"]


def test_failure_one_microsecond_before_window_start_does_not_count():
    older = [ev(-0.000001), ev(150), ev(200)]
    assert run_detections(older + [ev(300, outcome="success")]) == []


def test_failures_at_success_instant_are_not_previous_attempts():
    events = [ev(0), ev(60, outcome="success"), ev(60), ev(60)]
    assert run_detections(events) == []


def test_failures_for_another_user_do_not_count():
    events = [ev(0, user="bob"), ev(60, user="bob"), ev(120, user="bob"), ev(180, user="alice", outcome="success")]
    assert run_detections(events) == []


def test_failures_from_another_source_do_not_count():
    events = [ev(0, source="192.0.2.9"), ev(60, source="192.0.2.9"), ev(120, source="192.0.2.9"),
              ev(180, outcome="success")]
    assert run_detections(events) == []


def test_each_success_gets_its_own_alert():
    events = [ev(0), ev(10), ev(20), ev(30, outcome="success"), ev(40, outcome="success")]
    alerts = [a for a in run_detections(events) if a.rule_id == "success_after_failures"]
    assert len(alerts) == 2


# --- rules are not fused; identity and order --------------------------------

def test_rules_produce_separate_alerts_with_distinct_ids():
    events = [ev(s) for s in (0, 30, 60, 90, 120)] + [ev(150, outcome="success")]
    alerts = run_detections(events)
    ids = [a.id for a in alerts]
    assert len(ids) == len(set(ids))
    assert set(rules(alerts)) == {"repeated_failures", "success_after_failures"}


def test_alert_ids_are_uuid_strings_and_stable_across_runs():
    events = [ev(s) for s in (0, 60, 120, 180, 240)]
    first = [a.id for a in run_detections(events)]
    second = [a.id for a in run_detections(events)]
    assert first == second
    assert all(str(uuid.UUID(i)) == i for i in first)


def test_shuffled_input_gives_identical_alerts():
    events = [ev(s) for s in (0, 60, 120, 180, 240, 300)] + [ev(330, user="x", outcome="success")]
    expected = [(a.id, list(a.evidence)) for a in run_detections(events)]
    shuffled = events[:]
    random.Random(7).shuffle(shuffled)
    assert [(a.id, list(a.evidence)) for a in run_detections(shuffled)] == expected


def test_evidence_is_chronological_and_rule_version_is_one():
    alerts = run_detections([ev(s) for s in (0, 60, 120, 180, 240)])
    assert all(a.rule_version == 1 for a in alerts)
    assert all(len(a.evidence) == a.event_count for a in alerts)
    assert all(a.false_positives for a in alerts)


# --- regressions from QA (round 2) -------------------------------------------

def test_window_near_year_one_clamps_to_min_utc_instead_of_overflowing():
    events = [ev(i, base=MIN_UTC) for i in range(5)]
    alerts = run_detections(events)
    assert rules(alerts) == ["repeated_failures"]
    assert alerts[0].event_count == 5


def test_success_near_year_one_clamps_to_min_utc():
    events = [ev(0, base=MIN_UTC), ev(1, base=MIN_UTC), ev(2, base=MIN_UTC), ev(3, base=MIN_UTC, outcome="success")]
    assert rules(run_detections(events)) == ["success_after_failures"]


def test_window_start_helper_clamps_and_keeps_normal_values():
    from app.detections import window_start

    assert window_start(MIN_UTC) == MIN_UTC
    assert window_start(BASE) == BASE - timedelta(seconds=300)


def test_sliding_window_matches_brute_force_reference():
    rng = random.Random(20261003)
    events = []
    for _ in range(400):
        events.append(ev(
            rng.randrange(0, 1500),
            user=rng.choice(["a", "b", "c", "d", "e", "f"]),
            source=rng.choice(["192.0.2.1", "192.0.2.2", "2001:db8::3"]),
            outcome="failure" if rng.random() < 0.85 else "success",
            micro=rng.choice([0, 0, 1]),
        ))
    expected = reference(events)
    alerts = run_detections(events)
    got = {(a.rule_id, a.source, a.anchor_sha): list(a.evidence) for a in alerts}
    assert got == expected


def test_evidence_is_shared_view_not_copy():
    events = [ev(s) for s in range(0, 60, 1)]  # 60 failures inside one window
    alerts = run_detections(events)
    repeated = [a for a in alerts if a.rule_id == "repeated_failures"]
    assert len(repeated) == 56
    first_hashes = {id(a.evidence._hashes) for a in repeated}  # one shared list per source
    assert len(first_hashes) == 1


def test_ten_thousand_events_in_one_burst_stay_within_memory_budget():
    events = [ev(i * 0.01, user=f"u{i % 7}") for i in range(10_000)]
    tracemalloc.start()
    started = time.perf_counter()
    try:
        alerts = run_detections(events)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    elapsed = time.perf_counter() - started
    assert len(alerts) >= 10_000  # both rules fire on every anchor after the first 5 failures
    assert peak < 80 * 1024 * 1024, f"peak {peak / 1e6:.1f} MB"
    assert elapsed < 20, f"{elapsed:.1f}s"
