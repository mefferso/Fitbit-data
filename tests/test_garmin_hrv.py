"""Exercise real FIT message 78 decoding using generated, non-personal data."""
from io import BytesIO
from pathlib import Path
from struct import pack
import sys
import unittest
from zipfile import ZipFile

from fitparse.records import Crc

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from garmin_hrv import summarize_activity
from garmin_hrv_fit import probe_activities


def definition(local, global_id, fields):
    return pack("<BBBH", 0x40 | local, 0, 0, global_id) + bytes([len(fields)]) + bytes(
        component for field in fields for component in field
    )


def activity(groups=30, break_at=None, sensor_pause=False, gap_at=None, with_rr=True):
    start = 1100000000
    data = definition(0, 20, [(253, 4, 0x86)])
    data += definition(1, 78, [(0, 22, 0x84)])
    data += definition(2, 18, [(2, 4, 0x86)])
    data += definition(3, 21, [(0, 1, 0), (1, 1, 0)])
    data += pack("<BI", 0, start)
    offset = 0
    for group in range(groups):
        if with_rr:
            rr = [990, 1010] * 5 + [65535]
            if group == break_at:
                rr[5] = 65535
            data += pack("<B11H", 1, *rr)
        if group == gap_at:
            offset += 30
        data += pack("<BI", 0, start + (group + 1) * 10 + offset)
    if sensor_pause:
        data += bytes([3, 0, 0, 3, 0, 4, 3, 0, 0, 3, 0, 4])
    data += pack("<BI", 2, start)
    fit = pack("<BBHI4s", 12, 0x10, 2100, len(data), b".FIT") + data
    crc = Crc()
    crc.update(fit)
    return fit + pack("<H", crc.value)


def as_zip(fit):
    stream = BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("fitness.fit", fit)
    return stream.getvalue()


class GarminHrvTests(unittest.TestCase):
    def test_rr_conversion_padding_and_session_metadata(self):
        result = summarize_activity(as_zip(activity()))
        self.assertEqual(result["rmssd"], 20)
        self.assertEqual(result["duration"], 300)
        self.assertEqual(result["intervals"], 300)
        self.assertEqual(result["recordedIntervals"], 300)
        self.assertEqual(result["sensor"], "unknown")
        self.assertEqual(result["timing"], "session-start")
        self.assertEqual(result, summarize_activity(activity()))

    def test_missing_short_interrupted_and_paused_series(self):
        for kwargs in ({"with_rr": False}, {"groups": 29}, {"break_at": 15},
                       {"gap_at": 15}, {"sensor_pause": True}):
            with self.subTest(kwargs=kwargs):
                self.assertIsNone(summarize_activity(activity(**kwargs)))

    def test_probe_is_aggregate_and_includes_non_running_fit(self):
        class Client:
            def search_activities(self, **kwargs):
                return [{"activityId": 1, "activityType": "walking"},
                        {"activityId": 2, "activityType": "running"},
                        {"activityId": 3}]

            def download_activity(self, activity_id):
                return {1: activity(), 2: activity(with_rr=False), 3: b"invalid"}[activity_id]

        self.assertEqual(probe_activities(Client(), "2026-11-16"),
                         {"scanned": 2, "withHrv": 1, "withPlausibleRR": 1, "failed": 1})


if __name__ == "__main__":
    unittest.main()
