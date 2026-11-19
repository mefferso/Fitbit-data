from datetime import date, timedelta
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from garmin_snapshots import read_snapshots


def session(**overrides):
    return {
        "wellnessActivityType": "HEALTH_MONITORING",
        "startTimestampGMT": {"date": "2026-11-18T14:31:29Z"},
        "summaryTypeDataList": [
            {"summaryType": "RMSSD_HRV", "avgValue": 24},
            {"summaryType": "SDRR_HRV", "avgValue": 35},
            {"summaryType": "STRESS", "avgValue": 70},
        ],
        "activityUuid": {"baseUUID": "private"},
        "notes": "private",
        **overrides,
    }


class SnapshotTests(unittest.TestCase):
    def test_allowlist_dedup_and_zone(self):
        client = Mock()
        client.get_wellness_activity_summaries.return_value = [session(), session()]
        today = date(2026, 11, 19)
        self.assertEqual(read_snapshots(client, today), [{
            "instant": "2026-11-18T14:31+00:00",
            "time": "2026-11-18T08:31",
            "rmssd": 24,
            "sdrr": 35,
        }])
        client.get_wellness_activity_summaries.assert_called_once_with(today - timedelta(days=89), today)

    def test_missing_rmssd_other_activity_and_bad_time(self):
        client = Mock()
        client.get_wellness_activity_summaries.return_value = [
            session(summaryTypeDataList=[{"summaryType": "SDRR_HRV", "avgValue": 35}]),
            session(wellnessActivityType="UNKNOWN"),
            session(startTimestampGMT={"date": "2026-11-18"}),
        ]
        self.assertEqual(read_snapshots(client, date(2026, 11, 19)), [])
