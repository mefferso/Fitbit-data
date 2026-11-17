/**
 * Garmin-first publisher. All running workouts on/after 2026-11-16 are
 * Garmin-only, identified by Garmin activity ID; no Google/Fitbit matching.
 * Existing pre-cutover history remains untouched and source-labeled.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const CUTOVER='2026-11-16';
const TZ='America/Chicago';
const read=async(file,fallback=null)=>{
  try{return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')return fallback;throw e;}
};
const write=async(file,value)=>{
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify(value));
};
const good=n=>Number.isFinite(Number(n))?Number(n):null;
const dateKey=value=>new Intl.DateTimeFormat('en-CA',{
  timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(value));
const num=(a,d=1)=>Number.isFinite(a)?Math.round(a*10**d)/10**d:null;
const mean=(values)=>values.length?num(values.reduce((a,b)=>a+b,0)/values.length):null;
function validRun(r){
  return r && r.source==='garmin' && Number.isSafeInteger(Number(r.sourceActivityId))
    && Number(r.sourceActivityId)>0 && r.date>=CUTOVER
    && good(r.distanceMiles)>0 && good(r.activeSeconds)>0
    && r.startTime && Array.isArray(r.heartRateSeries)
    && Array.isArray(r.paceSeries) && Array.isArray(r.dynamicsSeries);
}

async function tempestWeather(run){
  const token=process.env.TEMPEST_API_TOKEN;
  const stationId=process.env.TEMPEST_STATION_ID;
  if(!token||!stationId)return null;
  const base='https://swd.weatherflow.com/swd/rest';
  const query=async(url,params={})=>{
    const u=new URL(base+url);u.searchParams.set('token',token);
    for(const [key,value] of Object.entries(params))u.searchParams.set(key,String(value));
    const res=await fetch(u);
    if(!res.ok)throw Error('Tempest request unavailable');
    const data=await res.json();
    if(data.status?.status_code)throw Error('Tempest status unavailable');
    return data;
  };
  // Cache device discovery within the current CI process, never publish IDs.
  if(!tempestWeather.deviceId){
    const body=await query('/stations');
    const station=(body.stations||[]).find(s=>String(s.station_id)===String(stationId));
    if(!station)throw Error('Tempest station not found');
    const candidates=(station.devices||[]).map(d=>({
      id:d.device_id,serial:String(d.serial_number||'').toUpperCase(),
      type:String(d.device_type||'').toUpperCase()
    })).filter(d=>d.id);
    const sensor=candidates.find(d=>d.serial.startsWith('ST-')||d.type==='ST'||d.type==='TEMPEST');
    if(!sensor)throw Error('Outdoor Tempest sensor not found');
    tempestWeather.deviceId=sensor.id;
  }
  const start=new Date(run.startTime),end=new Date(run.endTime);
  if(!(start<end))return null;
  const raw=await query('/observations/device/'+tempestWeather.deviceId,{
    time_start:Math.floor((start.getTime()-600000)/1000),
    time_end:Math.floor((end.getTime()+600000)/1000)
  });
  const f=c=>c===null||c===undefined?null:Number(c)*9/5+32;
  const dew=(tc,rh)=>{
    if(!Number.isFinite(tc)||!Number.isFinite(rh)||rh<=0)return null;
    const g=Math.log(rh/100)+17.625*tc/(243.04+tc);
    return f(243.04*g/(17.625-g));
  };
  const heat=(tf,rh)=>{
    if(!Number.isFinite(tf)||!Number.isFinite(rh)||tf<80||rh<40)return tf;
    return -42.379+2.04901523*tf+10.14333127*rh-.22475541*tf*rh
      -.00683783*tf*tf-.05481717*rh*rh+.00122874*tf*tf*rh
      +.00085282*tf*rh*rh-.00000199*tf*tf*rh*rh;
  };
  const obs=(raw.obs||[]).map(v=>{
    if(v.length===1&&Array.isArray(v[0]))v=v[0];
    const t=good(v[0]),tc=good(v[7]),rh=good(v[8]),tf=f(tc);
    if(t===null||tc===null)return null;
    return {time:new Date(t*1000).toISOString(),
      tempF:num(tf),dewpointF:num(dew(tc,rh)),rhPct:rh,heatIndexF:num(heat(tf,rh)),
      windAvgMph:v[2]!=null?num(v[2]*2.236936):null,
      windGustMph:v[3]!=null?num(v[3]*2.236936):null,
      solarRadiationWm2:good(v[11]),uv:good(v[10])};
  }).filter(Boolean);
  if(!obs.length)return null;
  const inside=obs.filter(o=>o.time>=run.startTime&&o.time<=run.endTime);
  const used=inside.length?inside:obs;
  const avg=k=>mean(used.map(x=>x[k]).filter(x=>Number.isFinite(x)));
  const max=k=>used.map(x=>x[k]).filter(x=>Number.isFinite(x)).reduce((m,x)=>Math.max(m,x),-Infinity);
  const top=(k)=>{const v=max(k);return Number.isFinite(v)?num(v):null;};
  const closest=obs.reduce((a,b)=>Math.abs(new Date(a.time)-start)<Math.abs(new Date(b.time)-start)?a:b);
  return {source:'Tempest',start:{
      tempF:closest.tempF,dewpointF:closest.dewpointF,rhPct:closest.rhPct,
      heatIndexF:closest.heatIndexF,windAvgMph:closest.windAvgMph,
      windGustMph:closest.windGustMph,solarRadiationWm2:closest.solarRadiationWm2,uv:closest.uv
    },average:{tempF:avg('tempF'),dewpointF:avg('dewpointF'),rhPct:avg('rhPct'),
      heatIndexF:avg('heatIndexF'),windAvgMph:avg('windAvgMph'),
      solarRadiationWm2:avg('solarRadiationWm2')},
    maximum:{tempF:top('tempF'),dewpointF:top('dewpointF'),heatIndexF:top('heatIndexF'),
      windGustMph:top('windGustMph'),solarRadiationWm2:top('solarRadiationWm2')},
    samples:used.length};
}

const incoming=await read('.garmin-staging/activities.json');
const incomingWellness=await read('.garmin-staging/wellness.json');
if(!Array.isArray(incoming)||!incomingWellness||typeof incomingWellness!=='object')
  throw Error('Missing validated Garmin staging output');
const index=await read('docs/data/run-index.json',{runs:[]});
const data=await read('docs/data.json',{recentRuns:[],detailedRuns:[],runningTrend:{}});
const trends=await read('docs/data/trends.json',{runningTrend:{}});
const previousWellness=await read('docs/data/garmin-wellness.json',{days:{}});
const legacy=(index.runs||[]).filter(r=>r.date<CUTOVER&&r.source!=='garmin');
const garmin=new Map((index.runs||[]).filter(r=>
  r.date>=CUTOVER&&r.source==='garmin'&&Number.isSafeInteger(Number(r.sourceActivityId))
).map(r=>[String(r.sourceActivityId),r]));
let fresh=0;
let changedRuns=0;
for(const r of incoming){
  if(!validRun(r))throw Error('Invalid Garmin run schema');
  const key=String(r.sourceActivityId);
  const old=garmin.get(key)||{};
  const runId=old.runId||('garmin-'+key);
  const detailFile=old.detailFile||('data/runs/garmin/'+key+'.json');
  const previousDetail=old.detailFile?await read('docs/'+old.detailFile,{}):{};
  let weather=previousDetail.weather||null;
  if(!weather){
    try{weather=await tempestWeather(r);}
    catch(e){console.log('Tempest unavailable for one run: '+e.name);}
  }
  const detail={
    ...r,runId,detailFile,
    // Old Google traces and all old source-dependent calculations are removed.
    route:null,routeSource:null,zoneSummary:[],zoneSummarySource:null,
    heartRateRecovery:null,heartRateRecoverySource:null,
    aerobicDecoupling:null,trainingLoad:null,weatherAdjustedEfficiency:null,
    adjustedPerformanceIndex:null,analysisSummary:null,
    runWalkIntervals:[],splitSummaries:r.lapSummaries||[],
    weather, dataSourceNotice:'Garmin FIT running data; Tempest home-station weather where available.'
  };
  if(JSON.stringify(previousDetail)!==JSON.stringify(detail)){
    await write('docs/'+detailFile,detail);
    changedRuns++;
  }
  garmin.set(key,{
    runId,date:r.date,startTime:r.startTime,endTime:r.endTime,
    activeSeconds:r.activeSeconds,elapsedSeconds:r.elapsedSeconds,
    distanceMiles:r.distanceMiles,averagePaceSecondsPerMile:r.averagePaceSecondsPerMile,
    averageHeartRate:r.averageHeartRate,peakHeartRate:r.peakHeartRate,
    source:'garmin',sourceActivityId:r.sourceActivityId,detailFile,
    hrr1:null,hrr2:null,hrr3:null,cardioDriftPercent:null,trainingLoad:null,
    adjustedPerformanceIndex:null,heatIndexF:weather?.average?.heatIndexF??null,
    dewpointF:weather?.average?.dewpointF??null
  });
  fresh++;
}
const merged=[...legacy,...garmin.values()].sort((a,b)=>String(b.startTime).localeCompare(String(a.startTime)));
const ids=new Set();
for(const r of merged){
  if(!r.runId||ids.has(r.runId))throw Error('Duplicate run ID after Garmin merge');
  ids.add(r.runId);
}
const runningChanged=changedRuns>0||JSON.stringify(merged)!==JSON.stringify(index.runs||[]);
const generatedAt=runningChanged?new Date().toISOString():index.generatedAt;
const archive={generatedAt,timeZone:TZ,runCount:merged.length,archiveStartDate:'2000-01-01'};
const details=new Map((data.detailedRuns||[]).filter(r=>r.date<CUTOVER).map(r=>[r.runId,r]));
for(const r of merged.filter(r=>r.source==='garmin'&&r.detailFile)){
  details.set(r.runId,await read('docs/'+r.detailFile));
}
const detailedRuns=merged.filter(r=>details.has(r.runId)).slice(0,30).map(r=>details.get(r.runId));
const currentLatest=detailedRuns[0]||null;
const summaries=merged.slice(0,30).map(r=>({
  date:r.date,startTime:r.startTime,endTime:r.endTime,
  activeSeconds:r.activeSeconds,distanceMiles:r.distanceMiles,
  averagePaceSecondsPerMile:r.averagePaceSecondsPerMile,
  averageHeartRate:r.averageHeartRate,peakHeartRate:r.peakHeartRate,
  source:r.source||'google-health-legacy',sourceActivityId:r.sourceActivityId||null
}));
const runningTrend=merged.filter(r=>good(r.averageHeartRate)>0&&good(r.averagePaceSecondsPerMile)>0)
  .map(r=>({date:r.date,startTime:r.startTime,distanceMiles:r.distanceMiles,
    averagePaceSecondsPerMile:r.averagePaceSecondsPerMile,
    averageHeartRate:r.averageHeartRate,source:r.source||'google-health-legacy',
    efficiency:num((3600/r.averagePaceSecondsPerMile)/r.averageHeartRate,4)}))
  .reverse();
const oldTrend=trends.runningTrend||{};
const updatedTrend={...oldTrend,runs:runningTrend,
  weatherAdjusted:{...oldTrend.weatherAdjusted,
    runs:(oldTrend.weatherAdjusted?.runs||[]).filter(r=>r.date<CUTOVER)}
};
const wellnessDays={...(previousWellness.days||{})};
for(const [date,measurements] of Object.entries(incomingWellness)){
  if(!/^\d{4}-\d\d-\d\d$/.test(date))throw Error('Invalid wellness date');
  const old=wellnessDays[date]||{};
  const updated={...old};
  for(const [key,value] of Object.entries(measurements)){
    if(key==='_unavailable')continue;
    if(value!==null&&value!==undefined)updated[key]=value;
  }
  wellnessDays[date]=updated;
}
const wellnessChanged=JSON.stringify(wellnessDays)!==JSON.stringify(previousWellness.days||{});
const wellness={generatedAt:wellnessChanged?new Date().toISOString():(previousWellness.generatedAt||generatedAt),timeZone:TZ,
  source:'Garmin Connect Personal API',
  publication:'public, explicitly owner-approved wellness measurements',
  days:wellnessDays};
const newData={...data,generatedAt,publicDataNotice:
    'Garmin-only running from 2026-11-16 onward; prior workouts are historical Google/Fitbit. Garmin daily wellness publicly displayed by owner choice. No API keys or raw FIT files.',
  recentRuns:summaries,detailedRuns,runningTrend:updatedTrend,
  trainingLoad:{days:120,points:[],summary:{retired:true}}};
const updatedTrends={...trends,...archive,runningTrend:updatedTrend,
  trainingLoad:{days:120,points:[],summary:{retired:true}}};
if(runningChanged){
  await write('docs/data/run-index.json',{...index,...archive,runs:merged});
  await write('docs/data/latest.json',{...archive,run:currentLatest});
  await write('docs/data/trends.json',updatedTrends);
  await write('docs/data.json',newData);
}
if(wellnessChanged||!previousWellness.generatedAt){
  await write('docs/data/garmin-wellness.json',wellness);
}
console.log('Garmin-first published '+merged.length+' runs ('+garmin.size+
  ' Garmin, '+legacy.length+' pre-Garmin), '+fresh+' FIT updates, and '+
  Object.keys(wellnessDays).length+' wellness days. Changed runs='+changedRuns+
  ', running feed changed='+runningChanged+', wellness feed changed='+wellnessChanged+'. No Google matching.');
