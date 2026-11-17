#!/usr/bin/env python3
"""Read-only API capability probe. Prints no user values or response bodies."""
import inspect
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from garmin_personal_api import GarminPersonalApiClient, PersonalApiAuthenticator

METHODS = {
    "Training Readiness": ("get_training_readiness","get_daily_training_readiness"),
    "Training Status": ("get_training_status","get_daily_training_status"),
    "Race Predictor": ("get_race_predictions","get_race_predictor"),
    "Lactate Threshold": ("get_lactate_threshold","get_lactate_thresholds"),
    "Endurance Score": ("get_endurance_score","get_daily_endurance_score"),
    "Hill Score": ("get_hill_score","get_daily_hill_score"),
    "Skin-temperature deviation": ("get_skin_temperature","get_daily_skin_temperature"),
    "Daily respiration": ("get_daily_respiration","get_daily_respiration_summary"),
    "Running VO2 estimate": ("get_daily_vo2_max","get_running_vo2_max"),
}
# Never print unfiltered raw keys, which may encode IDs or other private details.
SAFE_KEYS = {"calendarDate","trainingReadinessScore","trainingStatus","acuteTrainingLoad",
             "chronicTrainingLoad","loadFocus","lactateThresholdHeartRate",
             "lactateThresholdSpeed","enduranceScore","hillScore",
             "averageRespirationValue","maxMetRun","vo2Max","vo2MaxValue"}

def check(client, day):
    for label, names in METHODS.items():
        method = next((getattr(client, n) for n in names if callable(getattr(client,n,None))),None)
        if method is None:
            print(label + ": METHOD_UNAVAILABLE")
            continue
        try:
            required=[p for p in inspect.signature(method).parameters.values()
                      if p.default is inspect.Parameter.empty and
                      p.kind in (inspect.Parameter.POSITIONAL_ONLY,inspect.Parameter.POSITIONAL_OR_KEYWORD)]
            if len(required)>2 or any(not any(w in p.name.lower() for w in ("date","day","start","end"))
                                       for p in required):
                print(label + ": SIGNATURE_UNVERIFIED")
                continue
            result=method(*([day]*len(required)))
            if result is None or result==[] or result=={}:
                print(label + ": EMPTY")
            else:
                sample=result if isinstance(result,dict) else next((x for x in result if isinstance(x,dict)),{}) if isinstance(result,list) else {}
                fields=sorted(set(sample)&SAFE_KEYS)
                print(label + ": DATA; fields=" + (",".join(fields) if fields else "(no safe listed fields)"))
        except Exception:
            print(label + ": CALL_FAILED")

def main():
    key=os.environ.get("GARMIN_PERSONAL_API_KEY","").strip()
    if not key:
        print("API key unavailable",file=sys.stderr)
        return 1
    day=datetime.now(ZoneInfo("America/Chicago")).date().isoformat()
    with PersonalApiAuthenticator() as auth:
        token=auth.obtain_token(key)
        with GarminPersonalApiClient(token.access_token) as client:
            check(client,day)
    return 0

if __name__=="__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Probe aborted; details withheld",file=sys.stderr)
        sys.exit(1)
