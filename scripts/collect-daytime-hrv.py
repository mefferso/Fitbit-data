#!/usr/bin/env python3
"""Write browser-importable summary JSON to gitignored local staging."""
import argparse
from datetime import datetime
import json
import logging
import os
from functools import partial
from pathlib import Path
import sys
import tempfile

from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator
from garmin_hrv import summarize_activity
from garmin_snapshots import CENTRAL, read_snapshots

OUTPUT = Path(".garmin-staging/daytime-hrv-private.json")


def authenticated_client():
    key = os.environ.get("GARMIN_PERSONAL_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Garmin authentication unavailable")
    with PersonalApiAuthenticator() as auth:
        token = auth.obtain_token(key)
    return GarminPersonalApiClient(token.access_token)


def authenticated_activities(limit):
    with authenticated_client() as client:
        activities = client.search_activities(start=0, limit=limit, start_date="2026-11-16")
        if not isinstance(activities, list):
            raise ValueError("Unexpected Garmin activity list")
        for activity in activities:
            activity_id = activity.get("activityId") if isinstance(activity, dict) else None
            if type(activity_id) is int and activity_id > 0:
                yield partial(client.download_activity, activity_id)


def local_activities(paths):
    for path in paths:
        def read(path=path):
            if path.stat().st_size > 50_000_000:
                raise ValueError("Activity exceeds size limit")
            return path.read_bytes()
        yield read


def write_private(output, document):
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, delete=False) as temp:
        temp_path = Path(temp.name)
        try:
            json.dump(document, temp, allow_nan=False)
            temp.write("\n")
            temp.close()
            temp_path.replace(output)
        finally:
            temp_path.unlink(missing_ok=True)


def main():
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, choices=range(1, 101), default=20, metavar="1–100")
    parser.add_argument("fit", nargs="*", type=Path, help="Local FIT or Garmin ZIP files instead of API access")
    parser.add_argument("--snapshots", action="store_true", help="Fetch Garmin Health Snapshots")
    args = parser.parse_args()
    if args.snapshots:
        if args.fit:
            parser.error("--snapshots uses the authenticated API")
        with authenticated_client() as client:
            readings = read_snapshots(client, datetime.now(CENTRAL).date())
        write_private(OUTPUT.with_name("health-snapshots-private.json"),
                      {"version": 1, "kind": "health-snapshots", "readings": readings})
        print(f"Private Garmin Health Snapshot summaries written: {len(readings)}.")
        return 0
    activities = local_activities(args.fit) if args.fit else authenticated_activities(args.limit)
    readings = {}
    failures = 0
    for download in activities:
        try:
            result = summarize_activity(download())
            if result:
                readings[result["id"]] = result
        except Exception:
            failures += 1
    write_private(OUTPUT, {"version": 1, "readings": sorted(
        readings.values(), key=lambda item: (item["instant"], item["id"])
    )})
    print(f"Private FIT summaries written: {len(readings)}. FIT files that failed to read: {failures}.")
    return bool(failures)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("HRV collection stopped. Check Garmin credentials or local file access.", file=sys.stderr)
        sys.exit(1)
