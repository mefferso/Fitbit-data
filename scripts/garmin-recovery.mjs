/**
 * Estimate post-activity heart-rate recovery using ONLY Garmin wellness HR.
 * Prefer actual post-finish FIT record HR when present; fall back to Garmin
 * wellness HR near the target, which may be aggregated and is often 2 min apart.
 * No interpolation or fabricated readings.
 */
const valid=n=>typeof n==='number'&&Number.isFinite(n);
export function garminPostRunRecovery(run,day){
  const end=Date.parse(run?.endTime);
  if(!Number.isFinite(end))return null;
  const fit=(run.heartRateSeries||[]).filter(x=>valid(x.value)&&x.value>=35&&x.value<=230)
    .map(x=>({time:Date.parse(x.time),value:x.value}))
    .filter(x=>Number.isFinite(x.time)&&x.time<=end&&x.time>=end-15000)
    .sort((a,b)=>b.time-a.time);
  if(!fit.length)return null;
  const baseline=fit[0];
  // FIT records after the activity-end timestamp are uncommon but, when
  // genuinely present, retain their acquisition timestamps and prefer them.
  const postFit=(run.heartRateSeries||[]).filter(x=>valid(x.value)&&x.value>=35&&x.value<=230)
    .map(x=>({time:Date.parse(x.time),value:x.value}))
    .filter(x=>Number.isFinite(x.time)&&x.time>end&&x.time<=end+4*60000)
    .sort((a,b)=>a.time-b.time);
  const raw=day?.heartRate?.heartRateValues||[];
  const samples=raw.filter(x=>Array.isArray(x)&&valid(x[0])&&valid(x[1])&&x[1]>=35&&x[1]<=230)
    .map(([time,value])=>({time,value}))
    .filter(x=>x.time>end&&x.time<=end+4*60000)
    .sort((a,b)=>a.time-b.time);
  const result={source:'garmin-daily-heart-rate-estimate',baselineBpm:baseline.value,
    baselineTime:new Date(baseline.time).toISOString(),sampleResolution:'sparse daily HR; may represent interval aggregates',
    minute1Drop:null,minute2Drop:null,minute3Drop:null,
    measurements:[],caution:'Post-run behavior (walking vs resting) and daily HR aggregation are unknown; not a standardized HRR test.'};
  for(const minute of [1,2,3]){
    const target=end+minute*60000;
    const highResolution=postFit.map(x=>({...x,offset:Math.abs(x.time-target)}))
      .filter(x=>x.offset<=5000).sort((a,b)=>a.offset-b.offset)[0];
    const near=highResolution||samples.map(x=>({...x,offset:Math.abs(x.time-target)}))
      .filter(x=>x.offset<=30000).sort((a,b)=>a.offset-b.offset)[0];
    if(!near)continue;
    const sampleSource=highResolution?'garmin-fit-post-activity-record':'garmin-daily-heart-rate-sample';
    const drop=baseline.value-near.value;
    result['minute'+minute+'Drop']=drop;
    result.measurements.push({minute,source:sampleSource,heartRateBpm:near.value,dropBpm:drop,
      offsetSeconds:Math.round((near.time-target)/1000),timestamp:new Date(near.time).toISOString()});
  }
  if(result.measurements.some(x=>x.source==='garmin-fit-post-activity-record')){
    result.source='garmin-fit-post-activity-with-daily-fallback';
    result.sampleResolution='FIT: timestamped samples within 5 seconds; daily fallback: sparse/possibly aggregated';
  }
  return result.measurements.length?result:null;
}
