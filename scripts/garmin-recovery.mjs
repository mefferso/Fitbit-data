/**
 * Estimate post-activity heart-rate recovery using ONLY Garmin wellness HR.
 * Prefer actual post-finish FIT record HR when present; fall back to Garmin
 * wellness HR near the target, which may be aggregated and is often 2 min apart.
 * When no wellness sample lands near a checkpoint but samples bracket it on
 * the 2-minute grid, linearly interpolate between the bracketing samples and
 * label that checkpoint as an estimate (source per measurement). Interpolated
 * drops are approximations: on a fast (convex) recovery curve they slightly
 * understate the true drop. Measured samples are never altered.
 */
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const round1=x=>Math.round(x*10)/10;
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
  const daily=raw.filter(x=>Array.isArray(x)&&valid(x[0])&&valid(x[1])&&x[1]>=35&&x[1]<=230)
    .map(([time,value])=>({time,value}))
    .filter(x=>x.time>end)
    .sort((a,b)=>a.time-b.time);
  const samples=daily.filter(x=>x.time<=end+4*60000);
  // Bracketing pool is wider than the measurement window: the sample after
  // the +3 min target (e.g. at +251 s on the 2-min grid) is needed to
  // interpolate that checkpoint even though it is not itself a measurement.
  const bracketPool=daily.filter(x=>x.time<=end+6*60000);
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
    if(near){
      const sampleSource=highResolution?'garmin-fit-post-activity-record':'garmin-daily-heart-rate-sample';
      const drop=baseline.value-near.value;
      result['minute'+minute+'Drop']=drop;
      result['minute'+minute+'Source']=sampleSource;
      result.measurements.push({minute,source:sampleSource,heartRateBpm:near.value,dropBpm:drop,
        offsetSeconds:Math.round((near.time-target)/1000),timestamp:new Date(near.time).toISOString()});
      continue;
    }
    // No measured sample near this checkpoint: interpolate between the
    // bracketing daily samples, but only across a plausible grid gap
    // (one missing sample at most), and label it an estimate.
    const before=[...bracketPool].filter(x=>x.time<target).pop();
    const after=bracketPool.find(x=>x.time>target);
    if(!before||!after)continue;
    if(after.time-before.time>240000)continue;
    const fraction=(target-before.time)/(after.time-before.time);
    const heartRate=round1(before.value+(after.value-before.value)*fraction);
    const drop=round1(baseline.value-heartRate);
    result['minute'+minute+'Drop']=drop;
    result['minute'+minute+'Source']='garmin-daily-heart-rate-interpolated';
    result.measurements.push({minute,source:'garmin-daily-heart-rate-interpolated',estimated:true,
      heartRateBpm:heartRate,dropBpm:drop,offsetSeconds:0,
      timestamp:new Date(target).toISOString(),
      bracket:{beforeTimestamp:new Date(before.time).toISOString(),beforeHeartRateBpm:before.value,
        afterTimestamp:new Date(after.time).toISOString(),afterHeartRateBpm:after.value,
        gapSeconds:Math.round((after.time-before.time)/1000)}});
  }
  const hasFit=result.measurements.some(x=>x.source==='garmin-fit-post-activity-record');
  const hasInterpolated=result.measurements.some(x=>x.source==='garmin-daily-heart-rate-interpolated');
  if(hasFit){
    result.source='garmin-fit-post-activity-with-daily-fallback';
    result.sampleResolution='FIT: timestamped samples within 5 seconds; daily fallback: sparse/possibly aggregated'
      +(hasInterpolated?'; some checkpoints interpolated between daily samples and labeled estimates':'');
  }else if(hasInterpolated){
    result.source='garmin-daily-heart-rate-estimate-with-interpolation';
    result.sampleResolution='sparse daily HR (2-min grid); checkpoints without a nearby sample are linearly interpolated between bracketing samples and labeled estimates; daily samples may represent interval aggregates';
    result.caution+=' Interpolated checkpoints are estimates, not measurements: typically within a few bpm, and biased slightly low (understating the drop) on a fast recovery curve.';
  }
  return result.measurements.length?result:null;
}
