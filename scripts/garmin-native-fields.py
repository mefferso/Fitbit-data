"""Allowlisted native Garmin activity metrics; no private API payload is persisted.

Recovered values must be present in listing or detail. Numeric recovery-time
units are not inferred from an undocumented field name.
"""
from numbers import Real

FIELDS=("aerobicTrainingEffect","anaerobicTrainingEffect","activityTrainingLoad",
        "trainingEffectLabel","recoveryTime","performanceCondition")

def _sources(listing, detail):
    roots=[]
    for item in (detail, listing):
        if not isinstance(item,dict):
            continue
        for key in ("summaryDTO", "activityDetailDTO"):
            block=item.get(key)
            if isinstance(block,dict):
                roots.append(block)
        roots.append(item)
    return roots

def extract_native(listing,detail):
    sources=_sources(listing,detail)
    native={}
    for field in FIELDS:
        value=next((src[field] for src in sources if src.get(field) is not None),None)
        if field=="trainingEffectLabel":
            if isinstance(value,str):
                native[field]=value[:60]
        elif isinstance(value,Real) and not isinstance(value,bool):
            if field=="performanceCondition":
                if -30 <= value <= 30:
                    native[field]=value
            elif field=="recoveryTime" and 0 <= value < 1000000000:
                native[field]=value
            elif 0 <= value < 100000:
                native[field]=value
    # Unit intentionally not assumed: not all response variants express recoveryTime identically.
    for src in sources:
        value=src.get("recoveryTimeUnit")
        if "recoveryTime" in native and isinstance(value,str) and value.lower() in ("seconds","minutes","hours"):
            native["recoveryTimeUnit"]=value.lower()
            break
    raw_recovery=next((src.get("recoveryHeartRate") for src in sources if src.get("recoveryHeartRate") is not None),None)
    if isinstance(raw_recovery,Real) and not isinstance(raw_recovery,bool) and 0 <= raw_recovery <= 150:
        native["recoveryHeartRate2MinDrop"]=round(raw_recovery,1)
    return native
