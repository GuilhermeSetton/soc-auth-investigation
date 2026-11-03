"""Pure detection rules v1 over LogEvent objects. No database access.

Every alert is a triage signal, never proof of intrusion.
Windows use timestamps: repeated_failures and multiple_users use [t-300s, t] (both ends
inclusive); success_after_failures uses [t-300s, t) so failures at the same instant as the
success do not count as earlier attempts. t-300s is clamped to the earliest UTC instant.
"""

from __future__ import annotations

import bisect
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

from app.parser import LogEvent

RULE_VERSION = 1
WINDOW = timedelta(seconds=300)
REPEATED_FAILURES_MIN = 5
MULTIPLE_USERS_MIN = 5
FAILURES_BEFORE_SUCCESS_MIN = 3
MIN_UTC = datetime.min.replace(tzinfo=timezone.utc)
# Fixed namespace: changing it would change every alert ID. Do not regenerate.
ALERT_NAMESPACE = uuid.UUID("6b1f0c2e-3a57-4d8e-9c41-2f7a5e9d0b13")

FALSE_POSITIVES_COMMON = (
    "Forgotten password or client retrying with an old credential",
    "Shared NAT, VPN or bastion address hiding several people",
    "Automation, backup or monitoring job with stale credentials",
    "Authorized vulnerability scan or penetration test",
)


def window_start(ts: datetime) -> datetime:
    """ts - WINDOW, clamped to MIN_UTC when the subtraction leaves the datetime range."""
    try:
        return ts - WINDOW
    except OverflowError:
        return MIN_UTC


class Evidence(Sequence):
    """Read-only view: hashes[lo:hi] of a list shared by alerts, followed by tail items.

    Keeps every evidence hash without copying it into each alert.
    """

    __slots__ = ("_hashes", "_lo", "_hi", "_tail")

    def __init__(self, hashes: list[str], lo: int, hi: int, tail: tuple[str, ...] = ()):
        self._hashes = hashes
        self._lo = lo
        self._hi = hi
        self._tail = tail

    def __len__(self) -> int:
        return self._hi - self._lo + len(self._tail)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(len(self)))]
        size = len(self)
        if index < 0:
            index += size
        if not 0 <= index < size:
            raise IndexError(index)
        width = self._hi - self._lo
        return self._hashes[self._lo + index] if index < width else self._tail[index - width]


@dataclass(frozen=True)
class Alert:
    id: str
    rule_id: str
    rule_version: int
    source: str
    username: str | None  # set only for success_after_failures
    timestamp: datetime  # anchor event time, UTC
    anchor_sha: str  # line_sha256 of the anchor event
    title: str
    reason: str
    false_positives: tuple[str, ...]
    event_count: int
    evidence: Sequence[str]  # line_sha256 of each related event, chronological


def _alert_id(rule_id: str, source: str, anchor_sha: str) -> str:
    key = f"{rule_id}|v{RULE_VERSION}|{source}|{anchor_sha}"
    return str(uuid.uuid5(ALERT_NAMESPACE, key))


def _iso(ts: datetime) -> str:
    return ts.isoformat().replace("+00:00", "Z")


def _sort_key(e: LogEvent) -> tuple[datetime, str]:
    return (e.timestamp, e.line_sha256)


def _index(events: list[LogEvent], key) -> dict:
    """Group events (already sorted) by key -> (events, times, hashes)."""
    groups: dict = {}
    for e in events:
        bucket = groups.setdefault(key(e), ([], [], []))
        bucket[0].append(e)
        bucket[1].append(e.timestamp)
        bucket[2].append(e.line_sha256)
    return groups


def _failure_alerts(source: str, failures: list[LogEvent], hashes: list[str], out: list[Alert]) -> None:
    """Sliding window over sorted failures of one source: O(n), no per-anchor copies."""
    times = [f.timestamp for f in failures]
    n = len(failures)
    lo = hi = 0
    users: dict[str, int] = {}
    for anchor in failures:
        t = anchor.timestamp
        while hi < n and times[hi] <= t:  # right edge inclusive, ties included
            users[failures[hi].username] = users.get(failures[hi].username, 0) + 1
            hi += 1
        start = window_start(t)
        while times[lo] < start:  # anchor itself is >= start, so lo never passes it
            name = failures[lo].username
            if users[name] == 1:
                del users[name]
            else:
                users[name] -= 1
            lo += 1
        width = hi - lo
        span = f"{_iso(failures[lo].timestamp)} to {_iso(t)}"

        if width >= REPEATED_FAILURES_MIN:
            out.append(Alert(
                id=_alert_id("repeated_failures", source, anchor.line_sha256),
                rule_id="repeated_failures",
                rule_version=RULE_VERSION,
                source=source,
                username=None,
                timestamp=t,
                anchor_sha=anchor.line_sha256,
                title="Repeated failed logins from one source",
                reason=(f"{width} failed authentications from {source} in {span} "
                        f"(window 300 s inclusive; threshold {REPEATED_FAILURES_MIN})."),
                false_positives=FALSE_POSITIVES_COMMON,
                event_count=width,
                evidence=Evidence(hashes, lo, hi),
            ))

        if len(users) >= MULTIPLE_USERS_MIN:
            out.append(Alert(
                id=_alert_id("multiple_users", source, anchor.line_sha256),
                rule_id="multiple_users",
                rule_version=RULE_VERSION,
                source=source,
                username=None,
                timestamp=t,
                anchor_sha=anchor.line_sha256,
                title="Failed logins against several users from one source",
                reason=(f"{len(users)} distinct users with {width} failed authentications "
                        f"from {source} in {span} (window 300 s inclusive; threshold {MULTIPLE_USERS_MIN})."),
                false_positives=FALSE_POSITIVES_COMMON,
                event_count=width,
                evidence=Evidence(hashes, lo, hi),
            ))


def run_detections(events: Iterable[LogEvent]) -> list[Alert]:
    ordered = sorted(events, key=_sort_key)
    failures = [e for e in ordered if e.outcome == "failure"]
    alerts: list[Alert] = []

    for source, (group, _times, hashes) in _index(failures, lambda e: e.source).items():
        _failure_alerts(source, group, hashes, alerts)

    by_user = _index(failures, lambda e: (e.source, e.username))
    for success in ordered:
        if success.outcome != "success":
            continue
        _group, times, hashes = by_user.get((success.source, success.username), ([], [], []))
        lo = bisect.bisect_left(times, window_start(success.timestamp))
        hi = bisect.bisect_left(times, success.timestamp)  # exclusive upper bound
        width = hi - lo
        if width < FAILURES_BEFORE_SUCCESS_MIN:
            continue
        alerts.append(Alert(
            id=_alert_id("success_after_failures", success.source, success.line_sha256),
            rule_id="success_after_failures",
            rule_version=RULE_VERSION,
            source=success.source,
            username=success.username,
            timestamp=success.timestamp,
            anchor_sha=success.line_sha256,
            title="Successful login after repeated failures",
            reason=(f"{width} failed attempts for user {success.username} from {success.source} "
                    f"in [t-300 s, t) before the success at {_iso(success.timestamp)} "
                    f"(threshold {FAILURES_BEFORE_SUCCESS_MIN}; failures at the same instant are not counted)."),
            false_positives=FALSE_POSITIVES_COMMON,
            event_count=width + 1,
            evidence=Evidence(hashes, lo, hi, (success.line_sha256,)),
        ))

    alerts.sort(key=lambda a: (a.timestamp, a.rule_id, a.id))
    return alerts
