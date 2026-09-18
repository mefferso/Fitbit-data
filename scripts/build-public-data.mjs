import fs from 'node:fs/promises';

const API = 'https://health.googleapis.com/v4/users/me';
const TZ = 'America/Chicago';
const LOOKBACK_DAYS = 180;
const DETAIL_RUNS = 8;

const required = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required secret ${key}`);
}

function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}
function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}
function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function round(value, digits=0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const f = 10 ** digits;
  return Math.round(Number(value) * f) / f;
}
function durationSeconds(value) {
  if (!value) return null;
  const m = String(value).match(/^([\d.]+)s$/);
  return m ? Number(m[1]) : null;
}
function firstNumber(obj, keys) {
  for (const key of keys) {
    const v = num(obj?.[key]);
    if (v !== null) return v;
  }
  return null;
}
function healthDateKey(d) {
  if (!d) return '';
  return [d.year, String(d.month).padStart(2,'0'), String(d.day).padStart(2,'0')].join('-');
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type':'application/x-www-form-urlencoded'},
    body
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`OAuth refresh failed: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

const token = await getAccessToken();

async function health(path, options={}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? {'content-type':'application/json'} : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Health API ${response.status} ${path}: ${text.slice(0,700)}`);
  return text ? JSON.parse(text) : {};
}

async function listAll(path) {
  const out = [];
  let pageToken = '';
  do {
    const join = path.includes('?') ? '&' : '?';
    const url = pageToken ? `${path}${join}pageToken=${encodeURIComponent(pageToken)}` : path;
    const json = await health(url);
    out.push(...(json.dataPoints || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

function workoutDate(exercise) {
  if (exercise?.interval?.civilStartTime?.date) return healthDateKey(exercise.interval.civilStartTime.date);
  if (exercise?.interval?.startTime) return dateKey(new Date(exercise.interval.startTime));
  return '';
}
function distanceMiles(metrics={}) {
  const mm = firstNumber(metrics, ['distanceMillimeters','distanceMm']);
  if (mm !== null) return round(mm / 1609344, 2);
  const m = firstNumber(metrics, ['distanceMeters','distanceM']);
  return m !== null ? round(m / 1609.344, 2) : null;
}
function paceSeconds(metrics, miles, activeSeconds) {
  const spm = num(metrics?.averagePaceSecondsPerMeter);
  if (spm !== null && spm > 0) return round(spm * 1609.344, 0);
  return miles && activeSeconds ? round(activeSeconds / miles, 0) : null;
}
function zoneDurations(metrics={}) {
  const z = metrics.heartRateZoneDurations || {};
  const result = {
    lightSeconds: durationSeconds(z.lightTime) || 0,
    moderateSeconds: durationSeconds(z.moderateTime) || 0,
    vigorousSeconds: durationSeconds(z.vigorousTime) || 0,
    peakSeconds: durationSeconds(z.peakTime) || 0
  };
  result.hasData = Object.values(result).some(v => typeof v === 'number' && v > 0);
  return result;
}
function parseWorkout(point) {
  const e = point.exercise;
  if (!e?.interval) return null;
  const metrics = e.metricsSummary || e.summary || {};
  const startTime = e.interval.startTime || null;
  const endTime = e.interval.endTime || null;
  const activeSeconds = durationSeconds(e.activeDuration || e.duration || metrics.activeDuration) ||
    (startTime && endTime ? Math.max(0, Math.round((new Date(endTime)-new Date(startTime))/1000)) : null);
  const miles = distanceMiles(metrics);
  return {
    date: workoutDate(e),
    startTime, endTime, activeSeconds,
    type: String(e.exerciseType || e.activityType || e.exerciseName || ''),
    distanceMiles: miles,
    averagePaceSecondsPerMile: paceSeconds(metrics, miles, activeSeconds),
    averageHeartRate: firstNumber(metrics,['averageHeartRateBeatsPerMinute','avgHeartRateBeatsPerMinute','averageHeartRate','heartRateAvg']),
    steps: firstNumber(metrics,['steps','stepCount']),
    activeZoneMinutes: firstNumber(metrics,['activeZoneMinutes','heartPoints']),
    runVo2Max: firstNumber(metrics,['runVo2Max']),
    zoneDurations: zoneDurations(metrics)
  };
}

async function getExercises(startDate) {
  const filter = `exercise.interval.civil_start_time >= "${startDate}"`;
  const points = await listAll(`/dataTypes/exercise/dataPoints?pageSize=200&filter=${encodeURIComponent(filter)}`);
  return points.map(parseWorkout).filter(Boolean);
}

async function getHeartRate(start, end) {
  const filter = `heart_rate.sample_time.physical_time >= "${start.toISOString()}" AND heart_rate.sample_time.physical_time < "${end.toISOString()}"`;
  const points = await listAll(`/dataTypes/heart-rate/dataPoints?pageSize=10000&filter=${encodeURIComponent(filter)}`);
  const byTime = new Map();
  for (const p of points) {
    const hr = p.heartRate;
    const t = hr?.sampleTime?.physicalTime;
    const v = num(hr?.beatsPerMinute);
    if (t && v !== null) byTime.set(t,{time:t,value:v});
  }
  return [...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time));
}

async function getZones(date) {
  const next = dateKey(addDays(new Date(date+'T12:00:00Z'),1));
  const filter = `daily_heart_rate_zones.date >= "${date}" AND daily_heart_rate_zones.date < "${next}"`;
  try {
    const points = await listAll(`/dataTypes/daily-heart-rate-zones/dataPoints?pageSize=10&filter=${encodeURIComponent(filter)}`);
    const rec = points.map(p=>p.dailyHeartRateZones).find(Boolean);
    const z = {lightMin:100,moderateMin:120,vigorousMin:140,peakMin:160};
    for (const x of rec?.heartRateZones || []) {
      const v = num(x.minBeatsPerMinute);
      if (x.heartRateZoneType==='LIGHT') z.lightMin=v;
      if (x.heartRateZoneType==='MODERATE') z.moderateMin=v;
      if (x.heartRateZoneType==='VIGOROUS') z.vigorousMin=v;
      if (x.heartRateZoneType==='PEAK') z.peakMin=v;
    }
    return z;
  } catch {
    return {lightMin:100,moderateMin:120,vigorousMin:140,peakMin:160};
  }
}

async function distanceRollups(start,end) {
  const json = await health('/dataTypes/distance/dataPoints:rollUp',{
    method:'POST',
    body:JSON.stringify({
      range:{startTime:start.toISOString(),endTime:end.toISOString()},
      windowSize:'60s',
      pageSize:Math.max(1,Math.ceil((end-start)/60000))
    })
  });
  return (json.rollupDataPoints||[]).sort((a,b)=>String(a.startTime).localeCompare(String(b.startTime)));
}

function zoneKey(hr,z) {
  if (hr>=z.peakMin) return 'peak';
  if (hr>=z.vigorousMin) return 'vigorous';
  if (hr>=z.moderateMin) return 'moderate';
  if (hr>=z.lightMin) return 'light';
  return 'below';
}
function derivedZoneSummary(series,z,start,end) {
  const totals={below:0,light:0,moderate:0,vigorous:0,peak:0};
  const pts=[...series].sort((a,b)=>a.time.localeCompare(b.time));
  const gaps=[];
  for(let i=1;i<pts.length;i++){
    const g=(new Date(pts[i].time)-new Date(pts[i-1].time))/1000;
    if(g>0&&g<=120)gaps.push(g);
  }
  gaps.sort((a,b)=>a-b);
  const median=gaps.length?gaps[Math.floor(gaps.length/2)]:5;
  const cap=Math.max(5,Math.min(30,median*3));
  for(let i=0;i<pts.length;i++){
    const a=new Date(pts[i].time).getTime();
    const b=i+1<pts.length?new Date(pts[i+1].time).getTime():end.getTime();
    totals[zoneKey(pts[i].value,z)]+=Math.max(0,Math.min(cap,(b-a)/1000||median));
  }
  const total=Object.values(totals).reduce((a,b)=>a+b,0)||1;
  return ['peak','vigorous','moderate','light','below'].map(k=>({
    key:k,label:k==='below'?'Below light':k[0].toUpperCase()+k.slice(1),
    seconds:round(totals[k],0),minutes:round(totals[k]/60,1),percent:round(totals[k]/total*100,0)
  }));
}
function reportedZoneSummary(d,activeSeconds) {
  const tracked=d.lightSeconds+d.moderateSeconds+d.vigorousSeconds+d.peakSeconds;
  const below=Math.max(0,(activeSeconds||tracked)-tracked), total=Math.max(1,tracked+below);
  const rows=[['peak','Peak',d.peakSeconds],['vigorous','Vigorous',d.vigorousSeconds],['moderate','Moderate',d.moderateSeconds],['light','Light',d.lightSeconds],['below','Below light',below]];
  return rows.map(([key,label,seconds])=>({key,label,seconds,minutes:round(seconds/60,1),percent:round(seconds/total*100,0)}));
}
function trainingLoad(summary) {
  const w={below:.5,light:1,moderate:2,vigorous:3,peak:4};
  return round(summary.reduce((s,x)=>s+(x.minutes||0)*(w[x.key]||0),0),1);
}
function paceSeries(rollups) {
  return rollups.map(p=>{
    const a=new Date(p.startTime), b=new Date(p.endTime||a.getTime()+60000);
    const mm=num(p.distance?.millimetersSum ?? p.distance?.distanceMillimeters);
    if(!mm||mm<=0)return null;
    const miles=mm/1609344, sec=(b-a)/1000, pace=sec/miles;
    if(pace<75||pace>7200)return null;
    return {time:new Date((a.getTime()+b.getTime())/2).toISOString(),startTime:a.toISOString(),endTime:b.toISOString(),distanceMiles:miles,paceSecondsPerMile:round(pace,0)};
  }).filter(Boolean);
}
function avgHr(series,a,b){
  const vals=series.filter(x=>{const t=new Date(x.time);return t>=a&&t<b}).map(x=>x.value);
  return vals.length?vals.reduce((x,y)=>x+y,0)/vals.length:null;
}
function paceWindow(series,a,b){
  const p=series.filter(x=>{const t=new Date(x.time);return t>=a&&t<b});
  if(!p.length)return null;
  const dist=p.reduce((s,x)=>s+(x.distanceMiles||0),0);
  const sec=p.reduce((s,x)=>s+(new Date(x.endTime)-new Date(x.startTime))/1000,0);
  return dist>0&&sec>0?{speedMph:dist/(sec/3600),paceSecondsPerMile:sec/dist}:null;
}
function decoupling(start,end,hr,pace){
  const mid=new Date((start.getTime()+end.getTime())/2);
  const h1=avgHr(hr,start,mid), h2=avgHr(hr,mid,end), p1=paceWindow(pace,start,mid), p2=paceWindow(pace,mid,end);
  if(!h1||!h2||!p1||!p2)return null;
  const e1=p1.speedMph/h1,e2=p2.speedMph/h2;
  return {percent:round((e1-e2)/e1*100,1),firstHalfHeartRate:round(h1),secondHalfHeartRate:round(h2),firstHalfPaceSecondsPerMile:round(p1.paceSecondsPerMile),secondHalfPaceSecondsPerMile:round(p2.paceSecondsPerMile)};
}
function nearestHr(points,target,tolerance=30000){
  let best=null,delta=Infinity;
  for(const p of points){const d=Math.abs(new Date(p.time)-target);if(d<=tolerance&&d<delta){best=p.value;delta=d}}
  return best;
}
function recovery(end,points){
  const t=end.getTime(), endHr=nearestHr(points,t,45000)||nearestHr(points,t-15000,60000);
  if(!endHr)return null;
  const r={endHeartRate:round(endHr)};
  for(const m of [1,2,3]){const v=nearestHr(points,t+m*60000);r[`minute${m}HeartRate`]=v===null?null:round(v);r[`minute${m}Drop`]=v===null?null:round(endHr-v);}
  return r;
}
function downsample(series,limit=600){
  if(series.length<=limit)return series;
  const step=series.length/limit,out=[];
  for(let i=0;i<limit;i++)out.push(series[Math.min(series.length-1,Math.floor(i*step))]);
  return out;
}

const now=new Date(), startDate=dateKey(addDays(now,-LOOKBACK_DAYS));
const all=await getExercises(startDate);
const runs=all.filter(w=>w.type.toUpperCase().includes('RUN')).sort((a,b)=>String(b.startTime).localeCompare(String(a.startTime)));

const detailedRuns=[];
for(const workout of runs.slice(0,DETAIL_RUNS)){
  if(!workout.startTime||!workout.endTime) continue;
  const start=new Date(workout.startTime), end=new Date(workout.endTime);
  const [zones,hr,dist,recoveryHr]=await Promise.all([
    getZones(workout.date),
    getHeartRate(start,end),
    distanceRollups(start,end),
    getHeartRate(new Date(end.getTime()-60000),new Date(end.getTime()+5*60000))
  ]);
  const paces=paceSeries(dist);
  const avg=hr.length?hr.reduce((s,x)=>s+x.value,0)/hr.length:workout.averageHeartRate;
  const peak=hr.length?Math.max(...hr.map(x=>x.value)):null;
  const zoneSummary=workout.zoneDurations.hasData?reportedZoneSummary(workout.zoneDurations,workout.activeSeconds):derivedZoneSummary(hr,zones,start,end);
  const vigPeak=zoneSummary.filter(x=>['vigorous','peak'].includes(x.key)).reduce((s,x)=>s+(x.minutes||0),0);
  detailedRuns.push({
    ...workout,
    averageHeartRate:round(avg),
    peakHeartRate:round(peak),
    trainingLoad:trainingLoad(zoneSummary),
    vigorousPlusPeakMinutes:round(vigPeak,0),
    aerobicDecoupling:decoupling(start,end,hr,paces),
    heartRateRecovery:recovery(end,recoveryHr),
    zoneSummary,
    runWalkIntervals:[],
    splitSummaries:[],
    heartRateSeries:downsample(hr.map(x=>({...x,zoneKey:zoneKey(x.value,zones)})),
    paceSeries:paces.map(x=>({time:x.time,paceSecondsPerMile:x.paceSecondsPerMile}))
  });
}

const recentRuns=runs.slice(0,30).map(w=>({
  date:w.date,startTime:w.startTime,activeSeconds:w.activeSeconds,distanceMiles:w.distanceMiles,
  averagePaceSecondsPerMile:w.averagePaceSecondsPerMile,averageHeartRate:w.averageHeartRate,
  steps:w.steps,activeZoneMinutes:w.activeZoneMinutes,runVo2Max:w.runVo2Max
}));

const trend=runs.filter(w=>w.averageHeartRate&&w.averagePaceSecondsPerMile).map(w=>({
  date:w.date,startTime:w.startTime,distanceMiles:w.distanceMiles,
  averagePaceSecondsPerMile:w.averagePaceSecondsPerMile,averageHeartRate:w.averageHeartRate,
  efficiency:round((3600/w.averagePaceSecondsPerMile)/w.averageHeartRate,4)
})).sort((a,b)=>String(a.startTime).localeCompare(String(b.startTime)));

const loadByDate={};
for(const w of all){
  if(!w.zoneDurations.hasData)continue;
  const summary=reportedZoneSummary(w.zoneDurations,w.activeSeconds);
  loadByDate[w.date]=(loadByDate[w.date]||0)+trainingLoad(summary);
}
const loadPoints=[];
for(let d=addDays(now,-119);dateKey(d)<=dateKey(now);d=addDays(d,1)){
  const k=dateKey(d); loadPoints.push({date:k,load:round(loadByDate[k]||0,1)});
}
const vo2Max=runs.filter(w=>w.runVo2Max!==null).map(w=>({date:w.date,value:w.runVo2Max,dataType:'exercise.runVo2Max'}));

const output={
  generatedAt:new Date().toISOString(),timeZone:TZ,lookbackDays:LOOKBACK_DAYS,
  publicDataNotice:'Workout/running metrics only. GPS coordinates, sleep, weight, OAuth credentials and tokens are not included.',
  recentRuns,detailedRuns,
  runningTrend:{days:LOOKBACK_DAYS,runs:trend,vo2Max},
  trainingLoad:{days:120,points:loadPoints,summary:{}}
};

await fs.mkdir('docs',{recursive:true});
await fs.writeFile('docs/data.json',JSON.stringify(output));
console.log(`Published ${recentRuns.length} recent runs, ${detailedRuns.length} detailed runs, and ${loadPoints.length} load days.`);
