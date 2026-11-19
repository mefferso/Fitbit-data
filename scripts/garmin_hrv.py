"""Conservative, session-labeled FIT activity RMSSD for private use."""
from datetime import datetime, timezone
from hashlib import sha256
from math import sqrt
from zoneinfo import ZoneInfo

from garmin_hrv_fit import fit_messages, fit_payload, interval_values, plausible

METHOD = "fit-rmssd-v1"
WINDOW_SECONDS = 300
ANCHOR_SECONDS = 10
ANCHOR_TOLERANCE = 0.24
WINDOW_DRIFT_LIMIT = 0.24


def screened_window(bins):
    """Return the first contiguous ~5 min window with consistent record anchors."""
    intervals = []
    covered = elapsed = 0.0
    for anchor_duration, values in bins:
        if (not values or not 0 < anchor_duration <= ANCHOR_SECONDS
                or not all(plausible(value) for value in values)
                or abs(sum(values) - anchor_duration) > ANCHOR_TOLERANCE):
            intervals, covered, elapsed = [], 0.0, 0.0
            continue

        for value in values:
            if intervals and abs(value - intervals[-1]) > 0.2 * intervals[-1]:
                intervals, covered, elapsed = [], 0.0, 0.0
                break
            intervals.append(value)
        else:
            covered += sum(values)
            elapsed += anchor_duration
            if abs(covered - elapsed) > WINDOW_DRIFT_LIMIT:
                intervals, covered, elapsed = [], 0.0, 0.0
            elif WINDOW_SECONDS <= covered <= WINDOW_SECONDS + ANCHOR_SECONDS:
                return intervals, covered
    return None


def summarize_activity(payload):
    """Emit one summary per single-session FIT with a supported HRV window."""
    payload = fit_payload(payload)
    sessions = []
    bins = []
    pending = []
    total = rejected = starts = stops = 0
    anchor = None
    for message in fit_messages(payload):
        if message.name == "session":
            sessions.append(message.get_value("start_time"))
        elif message.name == "event" and message.get_value("event") == "timer":
            event = message.get_value("event_type")
            if event == "start":
                starts += 1
            elif event in ("stop", "stop_all"):
                stops += 1
            else:
                return None
        elif message.name == "hrv":
            values = list(interval_values(message))
            # Only trailing nulls on a nonempty array are treated as FIT padding.
            while len(values) > 1 and values[-1] is None:
                values.pop()
            values = values or [None]
            total += len(values)
            rejected += sum(not plausible(value) for value in values)
            pending.extend(values)
        elif message.name == "record":
            stamp = message.get_value("timestamp")
            if not isinstance(stamp, datetime):
                bins.append((0, []))
                anchor, pending = None, []
                continue
            if anchor is not None:
                seconds = (stamp - anchor).total_seconds()
                if pending or seconds <= 0 or seconds > ANCHOR_SECONDS:
                    bins.append((seconds, pending))
                    anchor, pending = stamp, []
            else:
                anchor, pending = stamp, []

    # Timer pauses and multisport sessions are deliberately unsupported.
    if len(sessions) != 1 or starts > 1 or stops > 1 or not isinstance(sessions[0], datetime):
        return None
    result = screened_window(bins)
    if result is None:
        return None
    values, covered = result
    diffs = [(right - left) * 1000 for left, right in zip(values, values[1:])]
    stamp = sessions[0].replace(tzinfo=timezone.utc) if sessions[0].tzinfo is None else sessions[0]
    local = stamp.astimezone(ZoneInfo("America/Chicago"))
    return {
        "id": sha256(payload).hexdigest(),
        "time": local.strftime("%Y-%m-%dT%H:%M"),
        "instant": stamp.astimezone(timezone.utc).isoformat(),
        "source": "Garmin activity FIT",
        "method": METHOD,
        "rmssd": round(sqrt(sum(diff ** 2 for diff in diffs) / len(diffs)), 1),
        "duration": round(covered, 1),
        "intervals": len(values),
        "recordedIntervals": total,
        "invalidIntervals": rejected,
        "sensor": "unknown",
        "timing": "session-start",
        "quality": "screened",
    }
