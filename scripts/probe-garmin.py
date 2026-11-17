#!/usr/bin/env python3
"""Read-only Garmin Personal API smoke test.

Prints only high-level success flags. Never logs credential values, bearer
tokens, activity details, GPS, raw FIT contents, or health measurements.
"""
import os
import sys
import zipfile
from io import BytesIO

from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator


def main() -> int:
    api_key = os.environ.get("GARMIN_PERSONAL_API_KEY", "").strip()
    if not api_key:
        print("ERROR: GARMIN_PERSONAL_API_KEY secret is missing or empty.", file=sys.stderr)
        return 2

    # A token is valid for up to 24h. Do not print/cache it in Actions artifacts.
    with PersonalApiAuthenticator() as authenticator:
        token = authenticator.obtain_token(api_key)
        with GarminPersonalApiClient(token.access_token) as client:
            print("Garmin authentication: OK")
            activities = client.search_activities(start=0, limit=20)
            if not isinstance(activities, list):
                print("ERROR: Unexpected activity list response shape.", file=sys.stderr)
                return 3
            print("Activity list request: OK")
            print(f"Activities returned (up to 20): {len(activities)}")

            # Test metadata + download for a running activity, if one exists.
            run = next(
                (a for a in activities
                 if isinstance(a, dict)
                 and "running" in str(a.get("activityType", {})).lower()),
                None,
            )
            if run is None:
                print("No running activity in latest 20; detail/FIT test skipped.")
                return 0
            activity_id = run.get("activityId")
            if not isinstance(activity_id, int) or activity_id <= 0:
                print("ERROR: Running activity lacks numeric ID.", file=sys.stderr)
                return 4
            detail = client.get_activity(activity_id)
            if not isinstance(detail, dict):
                print("ERROR: Unexpected activity detail response.", file=sys.stderr)
                return 5
            print("Running activity detail request: OK")
            payload = client.download_activity(activity_id)
            with zipfile.ZipFile(BytesIO(payload)) as archive:
                has_fit = any(
                    name.lower().endswith(".fit")
                    for name in archive.namelist()
                )
            print(f"Activity download ZIP: OK; contains FIT: {has_fit}")
            return 0 if has_fit else 6


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Suppress client exceptions: they may contain API request context.
        print(f"Garmin connection test failed ({type(error).__name__}).", file=sys.stderr)
        raise SystemExit(1)
