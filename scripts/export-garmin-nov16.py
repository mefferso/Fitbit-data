#!/usr/bin/env python3
"""Temporary, private-to-the-workflow Garmin override for November 16.

Read FIT from Garmin into memory; write a strictly allowlisted running-metrics
JSON file in a gitignored temp directory. Never export GPS coordinates.
The existing public run is matched by start time and remains a single run.
"""
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import json
import os
import sys

from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator
from importlib.machinery import SourceFileLoader

stage = SourceFileLoader("garmin_stage", "scripts/stage-garmin-runs.py").load_module()
TARGET = "2026-11-16"
OUTPUT = Path(".garmin-staging/nov16.json")


def main():
    key = os.getenv("GARMIN_PERSONAL_API_KEY", "").strip()
    if not key:
        raise ValueError("GARMIN_PERSONAL_API_KEY is not configured")
    index = json.loads(Path("docs/data/run-index.json").read_text())
    target = next((r for r in index.get("runs", [])
                   if r.get("date") == TARGET and r.get("detailFile")), None)
    if not target:
        raise ValueError("November 16 existing detailed run not found; refusing to create duplicate")
    target_start = datetime.fromisoformat(target["startTime"].replace("Z", "+00:00"))
    matches = []
    with PersonalApiAuthenticator() as auth:
        token = auth.obtain_token(key)
        with GarminPersonalApiClient(token.access_token) as client:
            activities = client.search_activities(start=0, limit=50)
            for activity in activities:
                if not isinstance(activity, dict) or "running" not in str(activity.get("activityType", "")).lower():
                    continue
                activity_id = activity.get("activityId")
                if not isinstance(activity_id, int) or activity_id <= 0:
                    continue
                # No activity details or FIT contents are logged.
                parsed = stage.parse_fit(client.download_activity(activity_id), activity_id)
                actual_start = datetime.fromisoformat(parsed["startTime"].replace("Z", "+00:00"))
                if actual_start.astimezone(ZoneInfo("America/Chicago")).date().isoformat() != TARGET:
                    continue
                if abs((actual_start - target_start).total_seconds()) <= 120:
                    matches.append(parsed)
    if len(matches) != 1:
        raise ValueError("Expected exactly one Garmin running activity matching existing Nov 16 workout")
    result = matches[0]
    # Exact schema allowlist, no raw FIT and no location fields.
    payload = {
        "source": "garmin",
        "sourceActivityId": result["sourceActivityId"],
        "sourceStartTime": result["startTime"],
        "sourceEndTime": result["endTime"],
        "targetStartTime": target["startTime"],
        "activeSeconds": result["activeSeconds"],
        "distanceMiles": result["distanceMiles"],
        "averagePaceSecondsPerMile": result["averagePaceSecondsPerMile"],
        "averageHeartRate": result["averageHeartRate"],
        "peakHeartRate": result["peakHeartRate"],
        "heartRateSeries": result["heartRateSeries"],
        "garminMetrics": result["garminMetrics"],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload))
    print("Garmin Nov 16 FIT override prepared; no private activity details logged.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Garmin Nov 16 override unavailable ({type(exc).__name__}); no site data changed.", file=sys.stderr)
        sys.exit(1)
