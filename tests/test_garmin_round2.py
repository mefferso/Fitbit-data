"""Regression tests for the Garmin 970 FIT units and listing/detail split.

Fixtures reproduce the fields and units observed in Garmin FIT decoder output;
no actual private FIT or raw authenticated Garmin payload is committed.
"""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/"scripts"/file)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
stage=load("garmin_stage_unit","stage-garmin-runs.py")
native=load("garmin_native_unit","garmin-native-fields.py")
base=datetime(2026,11,16,21,22,41,tzinfo=timezone.utc)

class FitMessage:
    def __init__(self,name,values):self.name,self.values=name,values
    def get_values(self):return self.values
class FakeFitFile:
    def __init__(self,stream):pass
    def get_messages(self):
        yield FitMessage("session",{"start_time":base,"timestamp":base+timedelta(seconds=120),
          "total_timer_time":120,"total_elapsed_time":120,"total_distance":280,
          "total_ascent":5,"total_descent":2,"total_calories":100,"total_strides":230})
        yield FitMessage("lap",{"start_time":base,"total_timer_time":120,"total_distance":280,
          "avg_step_length":850,"avg_heart_rate":145})
        for i in range(120):
            yield FitMessage("record",{"timestamp":base+timedelta(seconds=i),
              "heart_rate":145,"cadence":80,"step_length":850,
              "stance_time":280,"vertical_oscillation":85,
              "power":250,"distance":i*280/120,"enhanced_speed":280/120})
def zip_fit():
    stream=io.BytesIO()
    with ZipFile(stream,'w') as archive:archive.writestr('recording.fit',b'fixture')
    return stream.getvalue()

class RoundTwo(unittest.TestCase):
    def test_mm_stride_is_converted_in_session_laps_and_records(self):
        with patch.object(stage,'FitFile',FakeFitFile):
            result=stage.parse_fit(zip_fit(),25102424959)
        self.assertAlmostEqual(result["garminMetrics"]["avgStrideLengthM"],.85)
        self.assertAlmostEqual(result["lapSummaries"][0]["avgStrideLengthM"],.85)
        self.assertAlmostEqual(result["dynamicsSeries"][25]["strideLengthM"],.85)
        self.assertEqual(result["garminSessionTotals"]["totalStrides"],230)

    def test_lap_stride_derived_only_from_valid_fit_record_values(self):
        class NoLapAverage(FakeFitFile):
            def get_messages(self):
                for message in super().get_messages():
                    if message.name=="lap":
                        message.values.pop("avg_step_length",None)
                    yield message
        with patch.object(stage,'FitFile',NoLapAverage):
            result=stage.parse_fit(zip_fit(),25102424959)
        self.assertAlmostEqual(result["lapSummaries"][0]["avgStrideLengthM"],.85)

    def test_listing_without_fields_detail_with_them(self):
        listing={"aerobicTrainingEffect":4.9,"activityTrainingLoad":220.85}
        detail={"summaryDTO":{"recoveryTime":108000,"performanceCondition":-2,
                "recoveryHeartRate":31}}
        result=native.extract_native(listing,detail)
        self.assertEqual(result["recoveryTime"],108000)
        self.assertEqual(result["performanceCondition"],-2)
        self.assertEqual(result["recoveryHeartRate2MinDrop"],31)
        self.assertNotIn("recoveryTimeUnit",result)
        # No assumption that the Garmin-native field is hours.
    def test_missing_detail_does_not_fabricate_metrics(self):
        result=native.extract_native({"activityTrainingLoad":220.85},{})
        self.assertNotIn("recoveryTime",result)
        self.assertNotIn("performanceCondition",result)

if __name__=="__main__":unittest.main()
