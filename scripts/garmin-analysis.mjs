/**
 * Transparent Garmin FIT-derived analysis (not Garmin proprietary Training Effect).
 * No Fitbit/Google fallback. Missing inputs yield null, not invented scores.
 */
const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const round=(x,d=1)=>Number.isFinite(x)?Math.round(x*10**d)/10**d:null;
const average=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const median=v=>{if(!v.length)return null;const a=[...v].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
function samples(run){
  const pace=(run.paceSeries||[]).filter(x=>n(x.paceSecondsPerMile)>120&&n(x.paceSecondsPerMile)<1800)
    .map(x=>({ms:Date.parse(x.time),pace:x.paceSecondsPerMile})).filter(x=>Number.isFinite(x.ms));
  const hr=(run.heartRateSeries||[]).filter(x=>n(x.value)>=35&&n(x.value)<=230)
    .map(x=>({ms:Date.parse(x.time),hr:x.value})).filter(x=>Number.isFinite(x.ms));
  // Indexed by whole seconds: 1-second wearable series; don't pair noncontemporaneous readings.
  const hearts=new Map(hr.map(x=>[Math.round(x.ms/1000),x.hr]));
  return pace.map(x=>({...x,hr:hearts.get(Math.round(x.ms/1000))})).filter(x=>n(x.hr)!==null)
    .sort((a,b)=>a.ms-b.ms);
}
export function garminAnalysis(run,{zoneBoundaries=null}={}){
  const paired=samples(run);
  const validHr=(run.heartRateSeries||[]).filter(x=>n(x.value)>=35&&n(x.value)<=230);
  const bandDefs=[[0,119],[120,139],[140,159],[160,179],[180,250]];
  const bands=bandDefs.map(([lo,hi])=>({
    label:lo===0?'<120 bpm':hi===250?'180+ bpm':lo+'–'+hi+' bpm',
    lowerBpm:lo,upperBpm:hi,count:validHr.filter(x=>x.value>=lo&&x.value<=hi).length
  }));
  // Five starts are required so values BELOW the Z1 minimum are not
  // incorrectly reported as Zone 1. The last zone has no upper limit.
  const starts=Array.isArray(zoneBoundaries)&&zoneBoundaries.length===5
    &&zoneBoundaries.every(x=>Number.isInteger(x)&&x>=35&&x<=230)
    &&zoneBoundaries.every((x,i)=>i===0||x>zoneBoundaries[i-1])
    ?zoneBoundaries:null;
  const zones=starts?starts.map((lo,i)=>({
    key:'zone'+(i+1),label:'Zone '+(i+1),minimumBpm:lo,
    maximumBpm:i===4?null:starts[i+1]-1,
    seconds:validHr.filter(x=>x.value>=lo&&(i===4||x.value<starts[i+1])).length,
    source:'configured-running-percent-maxhr'
  })):null;
  const belowZone1=starts?{
    key:'below',label:'Below Zone 1',maximumBpm:starts[0]-1,
    seconds:validHr.filter(x=>x.value<starts[0]).length,
    source:'configured-running-percent-maxhr'
  }:null;
  // A pace-controlled run is essential: broad halves suppress the warm-up and
  // require enough valid samples. Faster finishes can bias this diagnostic.
  const start=Date.parse(run.startTime),end=Date.parse(run.endTime);
  let drift=null;
  if(Number.isFinite(start)&&Number.isFinite(end)&&end-start>=25*60000){
    const p=paired.filter(x=>x.ms>=start+5*60000&&x.ms<=end);
    const mid=(start+5*60000+end)/2;
    const left=p.filter(x=>x.ms<mid),right=p.filter(x=>x.ms>=mid);
    if(left.length>=300&&right.length>=300){
      const stat=arr=>({hr:average(arr.map(x=>x.hr)),
        // Means of speed, not pace: speed/HR is robust to pace's nonlinear scale.
        speed:average(arr.map(x=>3600/x.pace))});
      const a=stat(left),b=stat(right);
      const speedChange=(b.speed/a.speed-1)*100;
      const ratioA=a.speed/a.hr,ratioB=b.speed/b.hr;
      drift={percent:round((ratioA/ratioB-1)*100,1),
        firstHalfAvgHr:round(a.hr),secondHalfAvgHr:round(b.hr),
        firstHalfAvgSpeedMph:round(a.speed,2),secondHalfAvgSpeedMph:round(b.speed,2),
        speedChangePercent:round(speedChange,1),sampleCounts:[left.length,right.length],
        source:'derived-garmin-fit',interpretation:Math.abs(speedChange)>5?
          'Pace varied more than 5%; not a controlled aerobic drift test.':'Comparable speeds; interpret as a descriptive drift estimate.'};
    }
  }
  const dyn=(run.dynamicsSeries||[]).filter(x=>n(x.powerWatts)>0&&n(x.verticalRatioPct)>0);
  const paceLookup=new Map((run.paceSeries||[]).map(x=>[x.time,x.paceSecondsPerMile]));
  const buckets=[{label:'<9:30/mi',low:0,high:570},{label:'9:30–10:30/mi',low:570,high:630},
    {label:'10:30–11:30/mi',low:630,high:690},{label:'11:30–12:30/mi',low:690,high:750},
    {label:'12:30+/mi',low:750,high:Infinity}];
  const byPace=buckets.map(b=>{
    const rows=dyn.filter(x=>{const pace=paceLookup.get(x.time);return n(pace)!==null&&pace>=b.low&&pace<b.high;});
    return {paceBand:b.label,seconds:rows.length,powerWatts:round(average(rows.map(x=>x.powerWatts))),
      verticalRatioPct:round(average(rows.map(x=>x.verticalRatioPct)),2),
      groundContactMs:round(average(rows.map(x=>x.groundContactMs).filter(x=>n(x)>0)),1),
      cadenceSpm:round(average(rows.map(x=>x.cadenceSpm).filter(x=>n(x)>0)),1)};
  }).filter(x=>x.seconds>=15);
  return {heartRateBands:bands,zoneSummary:zones,belowZone1,aerobicDecoupling:drift,
    runningDynamicsByPace:byPace,
    heartRateRecovery:null,heartRateRecoverySource:'post-activity-samples-unavailable',
    analysisMethod:'Garmin FIT derived; zones need configured personal thresholds; non-Garmin scores not inferred.'};
}
