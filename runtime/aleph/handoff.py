"""Researcher handoff reports embedded in the single mission commit."""

from __future__ import annotations

from pathlib import Path


def read(path: Path, limit: int = 8000) -> str:
    """Read a handoff report, trimming surrounding whitespace and bounding it."""
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    if len(text) > limit:
        text = text[:limit].rstrip() + "\n\n[truncated]"
    return text


def commit_message(
    mission_id: str,
    description: str,
    report: str,
    campaign_id: str,
    strategy: str,
    base_commit: str,
    trace_id: str | None,
) -> str:
    """Build the commit message that carries the handoff report and trailers."""
    headline = description.strip() or f"mission {mission_id}"
    lines = [f"{headline}", ""]
    if report:
        lines.append("Handoff:")
        lines.extend(report.splitlines())
        lines.append("")
    lines.extend(
        [
            f"Aleph-Mission: {mission_id}",
            f"Aleph-Campaign: {campaign_id}",
            f"Aleph-Strategy: {strategy}",
            f"Aleph-Base-Commit: {base_commit}",
        ]
    )
    if trace_id:
        lines.append(f"Aleph-Trace: {trace_id}")
    return "\n".join(lines).rstrip() + "\n"
