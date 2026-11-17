#!/usr/bin/env python3
"""Garmin FIT staging importer. Default is read-only and writes no files.

All raw Garmin ZIP/FIT data stays in memory. The optional local output includes
NO GPS coordinates, route shapes, names, or personal identifiers other than
Garmin's numeric activity ID, which is source provenance for deduplication.
Do not commit private output or raw FIT files into this public repository.
"""
import argparse
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from io import BytesIO
from math import cos, radians
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

    # Explicit FIT measurement allowlist. Never serialize coordinates, device IDs,
    # developer values, location metadata, or arbitrary FIT message fields.
    def valid(value, low=None, high=None):
        v = number(value)
        return v if v is not None and (low is None or v >= low) and (high is None or v <= high) else None

    def fit_step_length_m(raw):
        """FIT step_length/avg_step_length arrive in millimetres, not metres."""
        millimetres = valid(raw, 200, 3500)
        return round(millimetres / 1000, 3) if millimetres is not None else None

    def safe_mean(values):
        return round(sum(values) / len(values), 1) if values else None

    records = sorted(records, key=lambda r: utc_iso(r.get("timestamp")) or "")
    heart_rate, pace_series, dynamics = [], [], []
    cadence_values, ground_values, oscillation_values, power_values = [], [], [], []
    balance_values, stride_values = [], []
    previous = None
    for record in records:
        t = utc_iso(record.get("timestamp"))
        if not t:
            continue
        hr = valid(record.get("heart_rate"), 30, 240)
        raw_cadence = valid(record.get("cadence"), 0, 180)
        fraction = valid(record.get("fractional_cadence"), 0, 1)
        cadence_spm = round(2 * (raw_cadence + (fraction or 0)), 1) if raw_cadence is not None else None
        ground = valid(record.get("stance_time"), 100, 800)
        osc_mm = valid(record.get("vertical_oscillation"), 10, 300)
        osc_cm = round(osc_mm / 10, 2) if osc_mm is not None else None
        ratio = valid(record.get("vertical_ratio"), 1, 30)
        power = valid(record.get("power"), 0, 2000)
        balance = valid(record.get("stance_time_balance"), 0, 100)
        stride = fit_step_length_m(record.get("step_length"))
        speed = valid(record.get("enhanced_speed"), 0, 20)
        if speed is None:
            speed = valid(record.get("speed"), 0, 20)
        # Independent speed/cadence stride sanity check, never a replacement for FIT.
        # cadenceSpm counts both feet; speed (m/s) / (steps/s) = metres/step.
        stride_check = (round(speed * 60 / cadence_spm, 3)
                        if speed is not None and cadence_spm is not None and cadence_spm >= 60
                        else None)
        if stride_check is not None and not 0.2 <= stride_check <= 3.5:
            stride_check = None
        distance_m = valid(record.get("distance"), 0, 1000000)
        altitude_m = valid(record.get("enhanced_altitude"), -500, 10000)
        if altitude_m is None:
            altitude_m = valid(record.get("altitude"), -500, 10000)

        if hr is not None:
            heart_rate.append({"time": t, "value": round(hr), "zoneKey": None})
        if cadence_spm is not None and 60 <= cadence_spm <= 260:
            cadence_values.append(cadence_spm)
        if ground is not None:
            ground_values.append(ground)
        if osc_cm is not None:
            oscillation_values.append(osc_cm)
        if power is not None and power > 0 and cadence_spm is not None and 60 <= cadence_spm <= 260:
            power_values.append(power)
        if balance is not None and cadence_spm is not None and cadence_spm >= 60:
            balance_values.append(balance)
        if stride is not None and cadence_spm is not None and cadence_spm >= 60:
            stride_values.append(stride)

        dyn = {"time": t}
        for key, value in (
            ("cadenceSpm", cadence_spm), ("groundContactMs", ground),
            ("verticalOscillationCm", osc_cm), ("verticalRatioPct", ratio),
            ("powerWatts", power), ("groundContactBalancePct", balance),
            ("strideLengthM", stride), ("strideLengthCheckM", stride_check),
            ("elevationFt", round(altitude_m * 3.28084, 1) if altitude_m is not None else None),
        ):
            if value is not None:
                dyn[key] = value
        if len(dyn) > 1:
            dynamics.append(dyn)

        if previous:
            seconds = (datetime.fromisoformat(t.replace("Z", "+00:00")) -
                       datetime.fromisoformat(previous["time"].replace("Z", "+00:00"))).total_seconds()
            if 0 < seconds <= 10:
                delta_m = distance_m - previous["distance"] if distance_m is not None and previous["distance"] is not None else None
                # Prefer FIT cumulative distance; if unavailable, integrate FIT speed.
                if delta_m is None and speed is not None:
                    delta_m = speed * seconds
                if delta_m is not None and 0.2 <= delta_m <= 15 * seconds:
                    miles = delta_m / 1609.344
                    pace = seconds / miles
                    if 120 <= pace <= 3600:
                        pace_series.append({
                            "time": t, "seconds": round(seconds, 3),
                            "distanceMiles": round(miles, 7),
                            "paceSecondsPerMile": round(pace)
                        })
        previous = {"time": t, "distance": distance_m}

    lap_summaries = []
    for lap in laps:
        lap_start = utc_iso(lap.get("start_time"))
        sec = valid(lap.get("total_timer_time"), 0, 200000)
        meters = valid(lap.get("total_distance"), 0, 500000)
        lap_strides = [p["strideLengthM"] for p in dynamics
                       if "strideLengthM" in p and lap_start is not None
                       and p["time"] >= lap_start and sec is not None
                       and p["time"] < utc_iso(datetime.fromisoformat(lap_start.replace("Z", "+00:00")) + timedelta(seconds=sec))]
        lap_summaries.append({
            "startTime": lap_start,
            "durationSeconds": round(sec, 1) if sec is not None else None,
            "distanceMiles": round(meters / 1609.344, 4) if meters is not None else None,
            "averageHeartRate": valid(lap.get("avg_heart_rate"), 30, 240),
            "peakHeartRate": valid(lap.get("max_heart_rate"), 30, 240),
            "averagePowerWatts": valid(lap.get("avg_power"), 0, 2000),
            "averageCadenceRaw": valid(lap.get("avg_cadence"), 0, 180),
            "averageCadenceSpm": round(2 * valid(lap.get("avg_cadence"), 0, 180), 1) if valid(lap.get("avg_cadence"), 0, 180) is not None else None,
            "avgGroundContactMs": valid(lap.get("avg_stance_time"), 100, 800),
            "avgVerticalOscillationCm": round(valid(lap.get("avg_vertical_oscillation"), 10, 300) / 10, 2) if valid(lap.get("avg_vertical_oscillation"), 10, 300) is not None else None,
            "avgVerticalRatioPct": valid(lap.get("avg_vertical_ratio"), 1, 30),
            "avgStrideLengthM": fit_step_length_m(lap.get("avg_step_length")) or (round(sum(lap_strides) / len(lap_strides), 3) if lap_strides else None),
            "avgGroundContactBalancePct": valid(lap.get("avg_stance_time_balance"), 0, 100),
            "ascentM": valid(lap.get("total_ascent"), 0, 10000),
            "descentM": valid(lap.get("total_descent"), 0, 10000),
        })

    if records:
        last_record = utc_iso(records[-1].get("timestamp"))
        if last_record and (end is None or end <= start):
            end = last_record
    if end is None or end <= start:
        end = utc_iso(datetime.fromisoformat(start.replace("Z", "+00:00")) +
                      timedelta(seconds=active_s))
    local_date = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(
        ZoneInfo("America/Chicago")).date().isoformat()

    # Use FIT GPS in memory to build a relative route for the existing V2
    # Leaflet map. No absolute coordinates are written to the public JSON.
    geo = []
    for record in records:
        lat = valid(record.get("position_lat"), -(2**31), 2**31)
        lon = valid(record.get("position_long"), -(2**31), 2**31)
        if lat is None or lon is None:
            continue
        # Garmin FIT GPS coordinates use semicircles, while some decoders may
        # already expose degrees. Detect the units before projecting.
        lat_deg = lat * 180 / (2**31) if abs(lat) > 90 else lat
        lon_deg = lon * 180 / (2**31) if abs(lon) > 180 else lon
        if not (-90 <= lat_deg <= 90 and -180 <= lon_deg <= 180):
            continue
        geo.append((lat_deg, lon_deg))
    route = None
    if len(geo) >= 2:
        step = max(1, (len(geo) + 318) // 319)
        sampled = geo[::step]
        if sampled[-1] != geo[-1]:
            sampled.append(geo[-1])
        lat0, lon0 = sampled[0]
        scale_lon = 111320 * cos(radians(lat0))
        projected = [((lon - lon0) * scale_lon, (lat - lat0) * 110540)
                     for lat, lon in sampled]
        center_x = sum(p[0] for p in projected) / len(projected)
        center_y = sum(p[1] for p in projected) / len(projected)
        route = {
            "kind": "relative",
            "units": "meters",
            "privacy": "Relative Garmin FIT shape; absolute coordinates excluded",
            "points": [{"x": round(x - center_x, 1),
                        "y": round(y - center_y, 1),
                        "zoneKey": "below"} for x, y in projected]
        }

    return {
        "source": "garmin",
        "sourceActivityId": source_id,
        "date": local_date,
        "startTime": start,
        "endTime": end,
        "activeSeconds": round(active_s),
        "elapsedSeconds": round(valid(session.get("total_elapsed_time"), 0) or active_s),
        "distanceMiles": round(distance_m / 1609.344, 4),
        "averagePaceSecondsPerMile": round(active_s / (distance_m / 1609.344)),
        "averageHeartRate": valid(session.get("avg_heart_rate"), 30, 240) or safe_mean([x["value"] for x in heart_rate]),
        "peakHeartRate": valid(session.get("max_heart_rate"), 30, 240),
        "heartRateSeries": heart_rate,
        "hasGps": route is not None,
        "route": route,
        "paceSeries": pace_series,
        "paceSeriesSource": "garmin-fit-distance",
        "heartRateSeriesSource": "garmin-fit",
        "dynamicsSeries": dynamics,
        "lapSummaries": lap_summaries,
        "garminSessionTotals": {
            "ascentM": valid(session.get("total_ascent"), 0, 10000),
            "descentM": valid(session.get("total_descent"), 0, 10000),
            "calories": valid(session.get("total_calories"), 0, 100000),
            "avgTemperatureC": valid(session.get("avg_temperature"), -70, 70),
            "maxTemperatureC": valid(session.get("max_temperature"), -70, 70),
            "totalStrides": valid(session.get("total_strides"), 0, 1000000),
        },
        "garminMetrics": {
            "avgCadenceSpm": safe_mean(cadence_values),
            "avgGroundContactBalancePct": safe_mean(balance_values),
            "avgStrideLengthM": round(sum(stride_values) / len(stride_values), 3) if stride_values else None,
            "avgGroundContactMs": safe_mean(ground_values),
            "avgVerticalOscillationCm": safe_mean(oscillation_values),
            "avgPowerWatts": safe_mean(power_values),
            "lapCount": len(laps),
            "recordCount": len(records),
            "hrSamples": len(heart_rate),
            "paceSamples": len(pace_series),
            "dynamicsSamples": len(dynamics)
        },
        "privacy": {"rawFitExported": False, "gpsCoordinatesExported": False}
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
