#!/usr/bin/env python3
"""Garmin-first export for public Performance Lab.

From 2026-11-16 onward Garmin is the sole running source. This script never
looks for, downloads, or matches a Google Health/Fitbit running activity.
Authenticated Garmin FIT and wellness responses are handled in memory, and
only explicit running fields and selected wellness endpoint responses are
staged in a gitignored directory.
"""
import argparse
from datetime import datetime, timedelta
from importlib.machinery import SourceFileLoader
from io import BytesIO
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator

stage = SourceFileLoader("garmin_stage", "scripts/stage-garmin-runs.py").load_module()
native_metrics = SourceFileLoader("garmin_native_fields", "scripts/garmin-native-fields.py").load_module()
CHICAGO = ZoneInfo("America/Chicago")
CUTOVER = "2026-11-16"
EXCLUDED_KEYS = (
    "token", "authorization", "password", "secret", "apikey", "cookie",
    "email", "serial", "latitude", "longitude", "positionlat", "positionlong",
    "username", "userid", "userprofilepk", "deviceid", "profileid", "location", "address",
)


def clean(value, depth=0):
    """Keep Garmin measurement structures, not account/authorization metadata."""
    if depth > 12:
        return None
    if isinstance(value, dict):
        return {
            str(k): clean(v, depth + 1)
            for k, v in value.items()
            if str(k).lower() != "id" and not any(
                part in str(k).lower().replace("_", "") for part in EXCLUDED_KEYS
            )
        }
    if isinstance(value, list):
        return [clean(v, depth + 1) for v in value[:50000]]
    if isinstance(value, (str, bool, int)) or value is None:
        return value
    if isinstance(value, float):
        return value if value == value and abs(value) < 1e12 else None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)[:1000]


def read_index():
    try:
        return json.loads(Path("docs/data/run-index.json").read_text()).get("runs", [])
    except FileNotFoundError:
        return []


def run(args):
    key = os.environ.get("GARMIN_PERSONAL_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GARMIN_PERSONAL_API_KEY is not configured")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    already = {
        r.get("sourceActivityId") for r in read_index()
        if r.get("source") == "garmin"
    }
    imported, checked, failures = [], 0, 0
    today = datetime.now(CHICAGO).date()
    wellness = {}
    with PersonalApiAuthenticator() as authenticator:
        token = authenticator.obtain_token(key)
        with GarminPersonalApiClient(token.access_token) as client:
            # Pagination is independent of any existing Google or Fitbit records.
            for page in range(args.max_pages):
                activities = client.search_activities(
                    start=page * args.page_size,
                    limit=args.page_size,
                    start_date=args.since,
                )
                if not isinstance(activities, list):
                    raise RuntimeError("Unexpected Garmin activity list response")
                for activity in activities:
                    checked += 1
                    if not isinstance(activity, dict) or "running" not in str(
                        activity.get("activityType", "")
                    ).lower():
                        continue
                    activity_id = activity.get("activityId")
                    if not isinstance(activity_id, int) or activity_id <= 0:
                        failures += 1
                        continue
                    # Refresh existing recent runs to include upgraded Garmin fields,
                    # but do not repeatedly download older unchanged FIT workouts.
                    if activity_id in already and len(imported) >= args.refresh_recent:
                        continue
                    try:
                        parsed = stage.parse_fit(
                            client.download_activity(activity_id), activity_id
                        )
                        # Detail carries fields that may be absent in list responses.
                        # Never publish unrestricted account/activity responses.
                        try:
                            activity_detail = client.get_activity(activity_id)
                        except Exception:
                            activity_detail = {}
                        native = native_metrics.extract_native(activity, activity_detail)
                        parsed["garminNative"] = native
                        if parsed["date"] >= args.since:
                            imported.append(parsed)
                    except Exception:
                        # Never disclose raw Garmin response, activity contents, or token.
                        failures += 1
                if len(activities) < args.page_size:
                    break
            else:
                print("WARN: Garmin pagination limit reached; increase --max-pages.")

            daily_methods = {
                "hrv": lambda day: client.get_daily_hrv(day),
                "hrvSummaries": lambda day: client.get_daily_hrv_summaries(day, day),
                "sleep": lambda day: client.get_daily_sleep(day),
                "sleepSummaries": lambda day: client.get_daily_sleep_summaries(day, day),
                "bodyBattery": lambda day: client.get_daily_body_battery(day, day),
                "stress": lambda day: client.get_daily_stress(day, day),
                "heartRate": lambda day: client.get_daily_heart_rate(day),
                "steps": lambda day: client.get_daily_steps(day, day),
                "dailySummaries": lambda day: client.get_daily_summaries(day, day),
                "vo2Max": lambda day: client.get_daily_vo2_max(day, day),
                "spo2": lambda day: client.get_daily_spo2(day),
            }
            for age in reversed(range(args.wellness_days)):
                day = (today - timedelta(days=age)).isoformat()
                day_results = {}
                for name, getter in daily_methods.items():
                    try:
                        result = getter(day)
                        if result is not None:
                            day_results[name] = clean(result)
                    except Exception as error:
                        # Endpoint unsupported/empty should not block running import.
                        day_results.setdefault("_unavailable", []).append(
                            {"dataset": name, "errorType": type(error).__name__}
                        )
                wellness[day] = day_results

    (args.output_dir / "activities.json").write_text(
        json.dumps(imported, separators=(",", ":")) + "\n"
    )
    (args.output_dir / "wellness.json").write_text(
        json.dumps(wellness, separators=(",", ":")) + "\n"
    )
    print(
        f"Garmin sync: {checked} activity listings scanned, "
        f"{len(imported)} FIT runs staged, {failures} FIT failures, "
        f"{len(wellness)} wellness dates. No Google matching."
    )
    if failures:
        raise RuntimeError("One or more Garmin FIT files failed to parse")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default=CUTOVER)
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--refresh-recent", type=int, default=2)
    parser.add_argument("--wellness-days", type=int, default=3)
    parser.add_argument("--output-dir", type=Path, default=Path(".garmin-staging"))
    args = parser.parse_args()
    if args.since < CUTOVER:
        parser.error("Garmin-first public running begins on 2026-11-16")
    if not 1 <= args.page_size <= 100:
        parser.error("--page-size must be 1–100")
    if not 1 <= args.max_pages <= 100 or not 0 <= args.refresh_recent <= 100:
        parser.error("Invalid pagination settings")
    if not 1 <= args.wellness_days <= 90:
        parser.error("--wellness-days must be 1–90")
    try:
        run(args)
    except Exception as error:
        print(f"Garmin sync stopped ({type(error).__name__}); no public files changed.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
