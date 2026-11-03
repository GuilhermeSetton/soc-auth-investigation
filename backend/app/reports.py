"""Investigation report rendering (JSON and Markdown). All user text is escaped; no HTML."""

from __future__ import annotations

import json
import re
from typing import Any

DISCLAIMER = (
    "Log rules are triage signals, not proof of compromise. Review the evidence and the "
    "false-positive notes before drawing any conclusion."
)

_MD_SPECIAL = re.compile(r"([\\`*_{}\[\]()#+\-.!|<>~])")


def md_escape(value: Any) -> str:
    text = "" if value is None else str(value)
    text = _MD_SPECIAL.sub(r"\\\1", text)
    return text.replace("\r", " ").replace("\n", " ")


def report_json(alert: dict, events: list[dict], investigation: dict, generated_at: str) -> str:
    payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "alert": alert,
        "events": events,
        "investigation": investigation,
        "disclaimer": DISCLAIMER,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def report_markdown(alert: dict, events: list[dict], investigation: dict, generated_at: str) -> str:
    lines = [
        f"# Investigation report: {md_escape(alert['title'])}",
        "",
        f"> {md_escape(DISCLAIMER)}",
        "",
        f"- Generated at (UTC): {md_escape(generated_at)}",
        f"- Alert ID: {md_escape(alert['id'])}",
        f"- Rule: {md_escape(alert['rule_id'])} (version {alert['rule_version']})",
        f"- Source: {md_escape(alert['source'])}",
        f"- Anchor time (UTC): {md_escape(alert['timestamp'])}",
        f"- Related events: {alert['event_count']}",
        f"- Status: {md_escape(investigation['status'])}",
        f"- Classification: {md_escape(investigation['classification'])}",
        f"- Investigation updated (UTC): {md_escape(investigation['updated_at'] or 'never')}",
        "",
        "## Reason",
        "",
        md_escape(alert["reason"]),
        "",
        "## Possible false positives",
        "",
    ]
    lines += [f"- {md_escape(item)}" for item in alert["false_positives"]]
    lines += ["", "## Analyst notes", "", md_escape(investigation["notes"]) or "_No notes._", "",
              "## Evidence (chronological, UTC)", "",
              "| Time (UTC) | Import | Line | Host | Source | User | Outcome | Method | Raw line |",
              "|---|---|---|---|---|---|---|---|---|"]
    for e in events:
        lines.append(
            f"| {md_escape(e['timestamp'])} | {md_escape(e['import_id'])} | {e['line_number']} | {md_escape(e['host'])} | "
            f"{md_escape(e['source'])} | {md_escape(e['username'])} | {md_escape(e['outcome'])} | "
            f"{md_escape(e['method'])} | {md_escape(e['raw_line'])} |"
        )
    return "\n".join(lines) + "\n"
