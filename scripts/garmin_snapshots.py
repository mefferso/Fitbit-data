"""Allowlisted Garmin Personal API Health Snapshot summaries."""
from datetime import datetime, timedelta, timezone
from math import isfinite
from zoneinfo import ZoneInfo

CENTRAL = ZoneInfo("America/Chicago")
LOOKBACK_DAYS = 90


def start_time(value):
    value = value.get("date") if isinstance(value, dict) else value
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if "T" not in value and " " not in value:
        return None
    return stamp.replace(tzinfo=stamp.tzinfo or timezone.utc).astimezone(timezone.utc)


def read_snapshots(client, today):
    """Map only documented Health Monitoring sessions with actual RMSSD."""
    first_day = today - timedelta(days=LOOKBACK_DAYS - 1)
    response = client.get_wellness_activity_summaries(first_day, today)
    if not isinstance(response, list):
        raise ValueError("Unexpected Garmin wellness activity response")
    readings = {}
    for row in response:
        if not isinstance(row, dict) or row.get("wellnessActivityType") != "HEALTH_MONITORING":
            continue
        summaries = row.get("summaryTypeDataList")
        stamp = start_time(row.get("startTimestampGMT"))
        if not isinstance(summaries, list) or stamp is None:
            continue
        local = stamp.astimezone(CENTRAL)
        if not first_day <= local.date() <= today:
            continue
        measures = {}
        for item in summaries:
            if not isinstance(item, dict):
                continue
            kind, value = item.get("summaryType"), item.get("avgValue")
            if kind in ("RMSSD_HRV", "SDRR_HRV") and type(value) in (int, float) and 0 <= value <= 2000 and isfinite(value):
                measures[kind] = value
        if "RMSSD_HRV" not in measures:
            continue
        # Minute resolution is sufficient for charting. Never export Garmin IDs.
        instant = stamp.isoformat(timespec="minutes")
        readings[instant] = {
            "instant": instant,
            "time": local.strftime("%Y-%m-%dT%H:%M"),
            "rmssd": measures["RMSSD_HRV"],
            "sdrr": measures.get("SDRR_HRV"),
        }
    return [readings[key] for key in sorted(readings)]
