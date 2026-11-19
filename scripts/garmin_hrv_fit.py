"""Read the FIT fields needed for the daytime HRV capability check."""
from io import BytesIO
from math import isfinite
import zipfile

from fitparse import FitFile


def fit_payload(payload):
    if payload.startswith(b"PK"):
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            files = [item for item in archive.infolist()
                     if not item.is_dir() and item.filename.lower().endswith(".fit")]
            if len(files) != 1 or files[0].file_size > 50_000_000:
                raise ValueError("Expected one bounded FIT member")
            payload = archive.read(files[0])
    if len(payload) > 50_000_000:
        raise ValueError("FIT exceeds size limit")
    return payload


def fit_messages(payload):
    return FitFile(BytesIO(fit_payload(payload))).get_messages()


def interval_values(message):
    """fitparse applies FIT profile 78's 1000 scale and returns seconds."""
    value = message.get_value("time")
    return value if isinstance(value, (list, tuple)) else (value,)


def plausible(seconds):
    return (type(seconds) in (int, float) and isfinite(seconds)
            and 0.25 <= seconds <= 2.0)


def probe_activities(client, since):
    """Read only. Report capabilities, never activity IDs or measurements."""
    results = {"scanned": 0, "withHrv": 0, "withPlausibleRR": 0, "failed": 0}
    activities = client.search_activities(start=0, limit=20, start_date=since)
    if not isinstance(activities, list):
        raise ValueError("Unexpected activity list")
    for activity in activities:
        activity_id = activity.get("activityId") if isinstance(activity, dict) else None
        if type(activity_id) is not int or activity_id <= 0:
            results["failed"] += 1
            continue
        try:
            has_hrv = has_rr = False
            for message in fit_messages(client.download_activity(activity_id)):
                if message.name == "hrv":
                    has_hrv = True
                    has_rr |= any(plausible(value) for value in interval_values(message))
            results["scanned"] += 1
            results["withHrv"] += has_hrv
            results["withPlausibleRR"] += has_rr
        except Exception:
            results["failed"] += 1
    return results


def print_capabilities(client, since):
    print("Daytime HRV capability: daily HRV feeds are overnight (CONFIRMED).")
    try:
        result = probe_activities(client, since)
        state = ("CONFIRMED" if result["withPlausibleRR"] else
                 "UNVERIFIED" if result["failed"] or not result["scanned"] else
                 "UNAVAILABLE in scanned recordings")
        print(f"FIT RR: {state}; " + ", ".join(f"{key}={value}" for key, value in result.items()))
        status = ("rr-detected" if result["withPlausibleRR"] else
                  "unverified" if result["failed"] else
                  "awaiting-recording")
    except Exception:
        print("FIT RR: UNVERIFIED (activity probe failed).")
        status = "unverified"
    print("FIT RR sensor attribution: UNVERIFIED.")
    return status
