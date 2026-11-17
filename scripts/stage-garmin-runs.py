#!/usr/bin/env python3
"""Garmin FIT staging importer. Default is read-only and writes no files.

All raw Garmin ZIP/FIT data stays in memory. The optional local output includes
NO GPS coordinates, route shapes, names, or personal identifiers other than
Garmin's numeric activity ID, which is source provenance for deduplication.
Do not commit private output or raw FIT files into this public repository.
"""
import argparse
from datetime import datetime, timezone
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import zipfile

from fitparse import FitFile
from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator


def utc_iso(value):
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def number(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = float(value)
        return v if v == v and abs(v) < 1e12 else None
    return None


def parse_fit(zip_bytes, source_id):
    with zipfile.ZipFile(BytesIO(zip_bytes)) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith(".fit") and not n.endswith("/")]
        if len(names) != 1:
            raise ValueError("Expected exactly one FIT file in Garmin download ZIP")
        if archive.getinfo(names[0]).file_size > 50_000_000:
            raise ValueError("FIT file exceeds safety limit")
        fit_bytes = archive.read(names[0])

    fit = FitFile(BytesIO(fit_bytes))
    sessions, records, laps = [], [], []
    for msg in fit.get_messages():
        if msg.name not in ("session", "record", "lap"):
            continue
        fields = msg.get_values()
        if msg.name == "session":
            sessions.append(fields)
        elif msg.name == "lap":
            laps.append(fields)
        else:
            records.append(fields)
    if not sessions:
        raise ValueError("FIT file has no session")
    session = max(sessions, key=lambda s: number(s.get("total_timer_time")) or 0)
    start = utc_iso(session.get("start_time"))
    end = utc_iso(session.get("timestamp"))
    distance_m = number(session.get("total_distance"))
    active_s = number(session.get("total_timer_time"))
    if not start or not end or not distance_m or not active_s:
        raise ValueError("FIT session lacks essential start/end/distance/timer fields")

    # Permit only explicit performance measurements: never copy arbitrary FIT
    # fields such as position_lat/long, device IDs, user profile or place names.
    heart_rate = []
    cadence = []
    ground_contact = []
    vertical_oscillation = []
    for record in records:
        t = utc_iso(record.get("timestamp"))
        hr = number(record.get("heart_rate"))
        if t and hr is not None and 30 <= hr <= 240:
            heart_rate.append({"time": t, "value": round(hr)})
        ca = number(record.get("cadence"))
        if ca is not None:
            cadence.append(ca)
        gc = number(record.get("stance_time"))
        if gc is not None:
            ground_contact.append(gc)
        vo = number(record.get("vertical_oscillation"))
        if vo is not None:
            vertical_oscillation.append(vo)

    def mean(values):
        return round(sum(values) / len(values), 1) if values else None

    return {
        "source": "garmin",
        "sourceActivityId": source_id,
        "date": None,  # Local calendar date is assigned by the publisher (America/Chicago).
        "startTime": start,
        "endTime": end,
        "activeSeconds": round(active_s),
        "distanceMiles": round(distance_m / 1609.344, 4),
        "averagePaceSecondsPerMile": round(active_s / (distance_m / 1609.344)),
        "averageHeartRate": number(session.get("avg_heart_rate")) or mean([x["value"] for x in heart_rate]),
        "peakHeartRate": number(session.get("max_heart_rate")),
        "heartRateSeries": heart_rate,
        "garminMetrics": {
            "avgCadenceRaw": mean(cadence),
            "avgGroundContactTime": mean(ground_contact),
            "avgVerticalOscillation": mean(vertical_oscillation),
            "lapCount": len(laps),
            "recordCount": len(records)
        },
        "privacy": {"gpsCoordinatesExported": False, "rawFitExported": False}
    }


def existing_matches(index_path, start):
    if not index_path.exists():
        return False
    index = json.loads(index_path.read_text())
    candidate = datetime.fromisoformat(start.replace("Z", "+00:00"))
    for run in index.get("runs", []):
        stamp = run.get("startTime")
        if stamp:
            try:
                if abs((datetime.fromisoformat(stamp.replace("Z", "+00:00")) - candidate).total_seconds()) <= 120:
                    return True
            except ValueError:
                pass
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--output-dir", type=Path, help="Write sanitized staging JSON locally; NEVER commit raw FIT")
    parser.add_argument("--index", type=Path, default=Path("docs/data/run-index.json"))
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error("--limit must be 1 through 100")
    key = os.environ.get("GARMIN_PERSONAL_API_KEY")
    if not key:
        parser.error("Missing GARMIN_PERSONAL_API_KEY")

    counts = {"checked": 0, "running": 0, "overlap": 0, "new": 0, "failed": 0}
    with PersonalApiAuthenticator() as authenticator:
        token = authenticator.obtain_token(key)
        with GarminPersonalApiClient(token.access_token) as client:
            activities = client.search_activities(start=0, limit=args.limit)
            if not isinstance(activities, list):
                raise ValueError("Unexpected activities response type")
            for activity in activities:
                counts["checked"] += 1
                if not isinstance(activity, dict):
                    continue
                activity_type = activity.get("activityType") or {}
                if "running" not in str(activity_type).lower():
                    continue
                counts["running"] += 1
                activity_id = activity.get("activityId")
                if not isinstance(activity_id, int) or activity_id <= 0:
                    counts["failed"] += 1
                    continue
                try:
                    result = parse_fit(client.download_activity(activity_id), activity_id)
                    if existing_matches(args.index, result["startTime"]):
                        counts["overlap"] += 1
                        continue
                    counts["new"] += 1
                    if args.output_dir:
                        args.output_dir.mkdir(parents=True, exist_ok=True)
                        target = args.output_dir / f"garmin-{activity_id}.json"
                        target.write_text(json.dumps(result, indent=2) + "\n")
                except Exception:
                    # Avoid leaking potentially sensitive API content in exceptions.
                    counts["failed"] += 1
    print("Garmin staging result (no workout details printed): " +
          ", ".join(f"{k}={v}" for k, v in counts.items()))
    if args.output_dir:
        print("Sanitized staging JSON written locally; not published.")
    if counts["failed"]:
        raise SystemExit("One or more Garmin activities failed validation; see summary counts.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Garmin staging failed: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
