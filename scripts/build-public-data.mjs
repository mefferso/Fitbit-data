import fs from 'node:fs/promises';

const API = 'https://health.googleapis.com/v4/users/me';
const TZ = 'America/Chicago';
// Keep the compact run index permanent. Detailed high-resolution data is archived
// per run, while only the newest few runs are re-fetched from Google/Tempest.
const ARCHIVE_START_DATE = '2000-01-01';
const DETAIL_REFRESH_RUNS = 5;
const DASHBOARD_DETAIL_RUNS = 30;
const TREND_DAYS = 180;

const required = ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','TEMPEST_API_TOKEN','TEMPEST_STATION_ID'];
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
async function readJsonIfExists(filePath, fallback=null) {
  try { return JSON.parse(await fs.readFile(filePath,'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}
function runId(w) {
  const stamp=w?.startTime ? new Date(w.startTime).toISOString().replace(/[:.]/g,'-') : String(w?.date||'run');
  return stamp;
}
function runDetailFile(w) {
  const year=String(w?.date||'unknown').slice(0,4);
  return `data/runs/${year}/${runId(w)}.json`;
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

const TEMPEST_API='https://swd.weatherflow.com/swd/rest';
const MPS_TO_MPH=2.2369362921;

function cToF(c){ return c===null||c===undefined?null:(Number(c)*9/5+32); }
function dewPointF(tempC,rh){
  if(tempC===null||tempC===undefined||rh===null||rh===undefined||rh<=0) return null;
  const a=17.625,b=243.04;
  const gamma=Math.log(Number(rh)/100)+(a*Number(tempC))/(b+Number(tempC));
  return cToF((b*gamma)/(a-gamma));
}
function heatIndexF(tempF,rh){
  if(tempF===null||rh===null||tempF===undefined||rh===undefined) return null;
  const T=Number(tempF), R=Number(rh);
  if(T<80 || R<40) return T;
  let hi=-42.379+2.04901523*T+10.14333127*R-0.22475541*T*R-0.00683783*T*T-0.05481717*R*R+0.00122874*T*T*R+0.00085282*T*R*R-0.00000199*T*T*R*R;
  if(R<13 && T>=80 && T<=112) hi-=((13-R)/4)*Math.sqrt((17-Math.abs(T-95))/17);
  else if(R>85 && T>=80 && T<=87) hi+=((R-85)/10)*((87-T)/5);
  return hi;
}
async function tempest(path,params={}){
  const u=new URL(TEMPEST_API+path);
  u.searchParams.set('token',process.env.TEMPEST_API_TOKEN);
  for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) u.searchParams.set(k,String(v));
  const r=await fetch(u,{headers:{'user-agent':'Fitbit-Workout-Weather/1.0'}});
  const text=await r.text();
  if(!r.ok) throw new Error(`Tempest API ${r.status}: ${text.slice(0,500)}`);
  const json=JSON.parse(text);
  const status=json.status||{};
  if(status.status_code && status.status_code!==0) throw new Error(status.status_message||'Tempest API error');
  return json;
}
async function discoverTempestDevice(){
  const stationId=Number(process.env.TEMPEST_STATION_ID);
  const payload=await tempest('/stations');
  const stations=payload.stations||payload.locations||[];
  const station=stations.find(s=>Number(s.station_id)===stationId);
  if(!station) throw new Error(`Tempest station ${stationId} not found for token`);
  const counts=new Map();
  for(const item of station.station_items||[]){
    if(item.device_id!==undefined&&item.device_id!==null) counts.set(Number(item.device_id),(counts.get(Number(item.device_id))||0)+1);
  }
  const candidates=[];
  for(const d of station.devices||[]){
    if(d.device_id===undefined||d.device_id===null||!d.serial_number) continue;
    const id=Number(d.device_id), serial=String(d.serial_number||'').toUpperCase(), type=String(d.device_type||'').toUpperCase(), env=String(d.device_meta?.environment||'').toLowerCase();
    let score=counts.get(id)||0;
    if(serial.startsWith('ST-')) score+=1000;
    if(type==='ST'||type==='TEMPEST') score+=1000;
    if(env==='outdoor') score+=100;
    candidates.push([score,id]);
  }
  if(!candidates.length) throw new Error('No Tempest outdoor device found');
  candidates.sort((a,b)=>b[0]-a[0]||b[1]-a[1]);
  return candidates[0][1];
}
function parseTempestObs(values){
  if(!Array.isArray(values)) return null;
  if(values.length===1&&Array.isArray(values[0])) values=values[0];
  const epoch=num(values[0]); if(epoch===null) return null;
  const tempC=num(values[7]), rh=num(values[8]), tempF=cToF(tempC), dewF=dewPointF(tempC,rh);
  return {
    epoch:Number(epoch),
    time:new Date(Number(epoch)*1000).toISOString(),
    tempF:round(tempF,1),
    dewpointF:round(dewF,1),
    rhPct:round(rh,0),
    heatIndexF:round(heatIndexF(tempF,rh),1),
    windAvgMph:values[2]===null||values[2]===undefined?null:round(Number(values[2])*MPS_TO_MPH,1),
    windGustMph:values[3]===null||values[3]===undefined?null:round(Number(values[3])*MPS_TO_MPH,1),
    solarRadiationWm2:num(values[11])===null?null:round(Number(values[11]),0),
    uv:num(values[10])===null?null:round(Number(values[10]),1)
  };
}
async function tempestObservations(deviceId,start,end){
  const payload=await tempest(`/observations/device/${deviceId}`,{
    time_start:Math.floor(start.getTime()/1000),
    time_end:Math.floor(end.getTime()/1000)
  });
  if(payload.type && payload.type!=='obs_st') throw new Error(`Unexpected Tempest response type ${payload.type}`);
  const map=new Map();
  for(const raw of payload.obs||[]){
    const o=parseTempestObs(raw);
    if(o) map.set(o.epoch,o);
  }
  return [...map.values()].sort((a,b)=>a.epoch-b.epoch);
}
function avgField(obs,key){
  const vals=obs.map(x=>num(x[key])).filter(v=>v!==null);
  return vals.length?round(vals.reduce((a,b)=>a+b,0)/vals.length,1):null;
}
function maxField(obs,key){
  const vals=obs.map(x=>num(x[key])).filter(v=>v!==null);
  return vals.length?round(Math.max(...vals),1):null;
}
function nearestWeather(obs,target){
  if(!obs.length) return null;
  let best=null,delta=Infinity;
  for(const o of obs){const d=Math.abs(new Date(o.time)-target);if(d<delta){delta=d;best=o;}}
  return delta<=10*60000?best:null;
}
function summarizeWorkoutWeather(obs,start,end){
  const inWindow=obs.filter(o=>{const t=new Date(o.time);return t>=start&&t<=end;});
  const startObs=nearestWeather(obs,start);
  const used=inWindow.length?inWindow:obs;
  if(!used.length) return null;
  return {
    source:'Tempest',
    start:startObs?{
      tempF:startObs.tempF,dewpointF:startObs.dewpointF,rhPct:startObs.rhPct,heatIndexF:startObs.heatIndexF,
      windAvgMph:startObs.windAvgMph,windGustMph:startObs.windGustMph,solarRadiationWm2:startObs.solarRadiationWm2,uv:startObs.uv
    }:null,
    average:{
      tempF:avgField(used,'tempF'),dewpointF:avgField(used,'dewpointF'),rhPct:avgField(used,'rhPct'),
      heatIndexF:avgField(used,'heatIndexF'),windAvgMph:avgField(used,'windAvgMph'),solarRadiationWm2:avgField(used,'solarRadiationWm2')
    },
    maximum:{
      tempF:maxField(used,'tempF'),dewpointF:maxField(used,'dewpointF'),heatIndexF:maxField(used,'heatIndexF'),
      windGustMph:maxField(used,'windGustMph'),solarRadiationWm2:maxField(used,'solarRadiationWm2')
    },
    samples:used.length
  };
}


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

async function exportExerciseTcx(resourceName) {
  if (!resourceName || !String(resourceName).startsWith('users/')) {
    throw new Error('Valid exercise resourceName required for TCX export');
  }
  const url = `https://health.googleapis.com/v4/${resourceName}:exportExerciseTcx?alt=media`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/tcx+xml'
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TCX export failed ${response.status}: ${text.slice(0,500)}`);
  }
  return text;
}

function parseTcxTrackpoints(xml) {
  const points = [];
  const re = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/gi;
  let match;
  while ((match = re.exec(String(xml || ''))) !== null) {
    const block = match[1];
    const time = block.match(/<Time>([^<]+)<\/Time>/i)?.[1]?.trim() || '';
    const distanceText = block.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/i)?.[1];
    const distanceMeters = num(distanceText);
    if (time && distanceMeters !== null) {
      points.push({ time, distanceMeters });
    }
  }
  return points.sort((a,b)=>new Date(a.time)-new Date(b.time));
}

function tcxPaceSeries(trackpoints) {
  const result = [];
  for (let i=1;i<trackpoints.length;i++) {
    const prev=trackpoints[i-1], cur=trackpoints[i];
    const a=new Date(prev.time).getTime(), b=new Date(cur.time).getTime();
    const seconds=(b-a)/1000;
    const meters=Number(cur.distanceMeters)-Number(prev.distanceMeters);
    if (!Number.isFinite(seconds) || seconds<=0 || seconds>60) continue;
    if (!Number.isFinite(meters) || meters<=0) continue;
    const miles=meters/1609.344;
    const pace=seconds/miles;
    if (!Number.isFinite(pace) || pace<120 || pace>7200) continue;
    result.push({
      time:new Date((a+b)/2).toISOString(),
      startTime:new Date(a).toISOString(),
      endTime:new Date(b).toISOString(),
      seconds:round(seconds,3),
      distanceMiles:round(miles,6),
      paceSecondsPerMile:round(pace,0)
    });
  }
  return result;
}

function percentile(values,pct){
  const a=(values||[]).filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return null;
  const idx=(pct/100)*(a.length-1), lo=Math.floor(idx), hi=Math.ceil(idx);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo);
}

function tcxCadence(trackpoints){
  const gaps=[];
  for(let i=1;i<trackpoints.length;i++){
    const sec=(new Date(trackpoints[i].time)-new Date(trackpoints[i-1].time))/1000;
    if(Number.isFinite(sec)&&sec>0&&sec<=60)gaps.push(sec);
  }
  return {
    trackpointCount:trackpoints.length,
    intervalCount:gaps.length,
    medianSeconds:round(percentile(gaps,50),2),
    p25Seconds:round(percentile(gaps,25),2),
    p75Seconds:round(percentile(gaps,75),2),
    minSeconds:gaps.length?round(Math.min(...gaps),2):null,
    maxSeconds:gaps.length?round(Math.max(...gaps),2):null
  };
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
    resourceName: point.name || null,
    hasGps: Boolean(e.exerciseMetadata?.hasGps),
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
function median(values){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function weatherAdjustedEfficiency(w){
  const pace=num(w.averagePaceSecondsPerMile), hr=num(w.averageHeartRate);
  const wx=w.weather?.average||{}, hi=num(wx.heatIndexF), solar=num(wx.solarRadiationWm2);
  if(!pace||!hr||hi===null||solar===null)return null;
  const speedMph=3600/pace;
  const rawEfficiency=speedMph/hr;
  const heatPenalty=Math.max(0,hi-80)*0.0035;
  const solarPenalty=Math.max(0,solar)*0.00008;
  const weatherFactor=1+heatPenalty+solarPenalty;
  return {
    speedMph:round(speedMph,3),
    rawEfficiency:round(rawEfficiency,5),
    heatPenaltyPct:round(heatPenalty*100,1),
    solarPenaltyPct:round(solarPenalty*100,1),
    weatherFactor:round(weatherFactor,4),
    adjustedEfficiency:round(rawEfficiency*weatherFactor,5)
  };
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
function estimateHrAt(points,targetMs){
  const usable=(points||[])
    .map(p=>({timeMs:new Date(p.time).getTime(),value:Number(p.value)}))
    .filter(p=>Number.isFinite(p.timeMs)&&Number.isFinite(p.value))
    .sort((a,b)=>a.timeMs-b.timeMs);
  if(!usable.length)return null;

  let before=null,after=null,nearest=null,nearestDelta=Infinity;
  for(const p of usable){
    const delta=Math.abs(p.timeMs-targetMs);
    if(delta<nearestDelta){nearest=p;nearestDelta=delta;}
    if(p.timeMs<=targetMs&&(!before||p.timeMs>before.timeMs))before=p;
    if(p.timeMs>=targetMs&&(!after||p.timeMs<after.timeMs))after=p;
  }

  if(before&&after){
    const beforeDelta=targetMs-before.timeMs;
    const afterDelta=after.timeMs-targetMs;
    const gap=after.timeMs-before.timeMs;
    if(before.timeMs===after.timeMs){
      return {value:before.value,method:'exact',offsetSeconds:0};
    }
    if(beforeDelta<=10000&&afterDelta<=10000&&gap<=15000){
      const fraction=(targetMs-before.timeMs)/gap;
      return {
        value:before.value+(after.value-before.value)*fraction,
        method:'interpolated',
        beforeOffsetSeconds:round(-beforeDelta/1000,1),
        afterOffsetSeconds:round(afterDelta/1000,1)
      };
    }
  }

  if(nearest&&nearestDelta<=5000){
    return {
      value:nearest.value,
      method:'nearest',
      offsetSeconds:round((nearest.timeMs-targetMs)/1000,1)
    };
  }

  return null;
}
function recovery(end,points){
  const t=end.getTime(), endEstimate=estimateHrAt(points,t);
  if(!endEstimate)return null;
  const r={endHeartRate:round(endEstimate.value,1),endEstimate};
  for(const m of [1,2,3]){
    const estimate=estimateHrAt(points,t+m*60000);
    r[`minute${m}HeartRate`]=estimate===null?null:round(estimate.value,1);
    r[`minute${m}Drop`]=estimate===null?null:round(endEstimate.value-estimate.value,1);
    r[`minute${m}Estimate`]=estimate;
  }
  return r;
}
function downsample(series,limit=600){
  if(series.length<=limit)return series;
  const step=series.length/limit,out=[];
  for(let i=0;i<limit;i++)out.push(series[Math.min(series.length-1,Math.floor(i*step))]);
  return out;
}
function averageTimedValue(series,key,startMs,endMs){
  const vals=(series||[]).filter(p=>{
    const t=new Date(p.time).getTime();
    return Number.isFinite(t)&&t>=startMs&&t<endMs&&Number.isFinite(Number(p[key]));
  }).map(p=>Number(p[key]));
  return vals.length?round(vals.reduce((a,b)=>a+b,0)/vals.length,1):null;
}
function aggregatePace(series,startMs,endMs){
  const pts=(series||[]).filter(p=>{
    const t=new Date(p.time).getTime();
    return Number.isFinite(t)&&t>=startMs&&t<endMs;
  });
  const seconds=pts.reduce((sum,p)=>sum+(Number(p.seconds)||0),0);
  const miles=pts.reduce((sum,p)=>sum+(Number(p.distanceMiles)||0),0);
  return seconds>0&&miles>0?round(seconds/miles,0):null;
}
function nearestTimedValue(series,key,targetMs,maxDeltaMs=30000){
  let best=null,delta=Infinity;
  for(const p of series||[]){
    const t=new Date(p.time).getTime(),v=Number(p[key]);
    if(!Number.isFinite(t)||!Number.isFinite(v))continue;
    const d=Math.abs(t-targetMs);
    if(d<delta){delta=d;best=v;}
  }
  return delta<=maxDeltaMs?round(best,1):null;
}
function linearSlopePerMinute(series,key,startMs){
  const pts=(series||[]).map(p=>({
    x:(new Date(p.time).getTime()-startMs)/60000,
    y:Number(p[key])
  })).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0);
  if(pts.length<3)return null;
  const mx=pts.reduce((s,p)=>s+p.x,0)/pts.length;
  const my=pts.reduce((s,p)=>s+p.y,0)/pts.length;
  let nume=0,den=0;
  for(const p of pts){const dx=p.x-mx;nume+=dx*(p.y-my);den+=dx*dx;}
  return den>0?round(nume/den,2):null;
}
function analysisSummary(w){
  const startMs=new Date(w.startTime).getTime();
  const endMs=new Date(w.endTime).getTime();
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)return null;
  const durationMs=endMs-startMs;
  const thirds=[];
  for(let i=0;i<3;i++){
    const a=startMs+durationMs*i/3,b=startMs+durationMs*(i+1)/3;
    thirds.push({
      segment:i+1,
      averageHeartRate:averageTimedValue(w.heartRateSeries,'value',a,b),
      averagePaceSecondsPerMile:aggregatePace(w.paceSeries,a,b)
    });
  }
  const checkpoints=[];
  const totalMinutes=Math.floor(durationMs/60000);
  for(let minute=5;minute<=totalMinutes;minute+=5){
    const target=startMs+minute*60000;
    checkpoints.push({
      minute,
      heartRate:estimateHrAt(w.heartRateSeries,target)?.value??null,
      paceSecondsPerMile:nearestTimedValue(w.paceSeries,'paceSecondsPerMile',target)
    });
  }
  return {
    durationMinutes:round(durationMs/60000,1),
    thirds,
    checkpoints,
    heartRateSlopeBpmPerMinute:linearSlopePerMinute(w.heartRateSeries,'value',startMs),
    paceSlopeSecondsPerMilePerMinute:linearSlopePerMinute(w.paceSeries,'paceSecondsPerMile',startMs)
  };
}

const previousOutput=await readJsonIfExists('docs/data.json',{});
const previousIndex=await readJsonIfExists('docs/data/run-index.json',{runs:[]});
const now=new Date(), startDate=ARCHIVE_START_DATE;
const tempestDeviceId=await discoverTempestDevice();
const all=await getExercises(startDate);
const runs=all.filter(w=>w.type.toUpperCase().includes('RUN')).sort((a,b)=>String(b.startTime).localeCompare(String(a.startTime)));

const detailedRuns=[];
for(const workout of runs.slice(0,DETAIL_REFRESH_RUNS)){
  if(!workout.startTime||!workout.endTime) continue;
  const start=new Date(workout.startTime), end=new Date(workout.endTime);
  const weatherStart=new Date(start.getTime()-10*60000), weatherEnd=new Date(end.getTime()+10*60000);
  const [zones,hr,dist,recoveryHr,tempestObs]=await Promise.all([
    getZones(workout.date),
    getHeartRate(start,end),
    distanceRollups(start,end),
    getHeartRate(new Date(end.getTime()-60000),new Date(end.getTime()+5*60000)),
    tempestObservations(tempestDeviceId,weatherStart,weatherEnd)
  ]);
  let paces=[];
  let paceSeriesSource='distance-rollup';
  let paceDiagnostics={
    source:'distance-rollup',
    tcxAttempted:false,
    tcxError:null,
    trackpointCount:null,
    usablePaceIntervals:null,
    medianSeconds:60,
    p25Seconds:60,
    p75Seconds:60,
    minSeconds:60,
    maxSeconds:60
  };

  if(workout.hasGps && workout.resourceName){
    paceDiagnostics.tcxAttempted=true;
    try{
      const xml=await exportExerciseTcx(workout.resourceName);
      const tcxPoints=parseTcxTrackpoints(xml);
      const tcxPaces=tcxPaceSeries(tcxPoints);
      if(tcxPaces.length){
        paces=tcxPaces;
        paceSeriesSource='tcx';
        paceDiagnostics={
          ...tcxCadence(tcxPoints),
          source:'tcx',
          tcxAttempted:true,
          tcxError:null,
          usablePaceIntervals:tcxPaces.length
        };
      }else{
        paceDiagnostics={...paceDiagnostics,...tcxCadence(tcxPoints),tcxError:'TCX contained no usable moving pace intervals.'};
      }
    }catch(error){
      paceDiagnostics.tcxError=String(error?.message||error);
    }
  }

  if(!paces.length){
    paces=paceSeries(dist).map(x=>({
      ...x,
      seconds:round((new Date(x.endTime)-new Date(x.startTime))/1000,3),
      distanceMiles:round(x.distanceMiles,6)
    }));
    paceDiagnostics.usablePaceIntervals=paces.length;
  }

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
    weather:summarizeWorkoutWeather(tempestObs,start,end),
    zoneSummary,
    runWalkIntervals:[],
    splitSummaries:[],
    heartRateSeries:downsample(hr.map(x=>({...x,zoneKey:zoneKey(x.value,zones)}))),
    paceSeriesSource,
    paceDiagnostics,
    paceSeries:paces.map(x=>({
      time:x.time,
      seconds:x.seconds,
      distanceMiles:x.distanceMiles,
      paceSecondsPerMile:x.paceSecondsPerMile
    }))
  });
}

// Merge freshly fetched detail with the previous dashboard export so the visible
// dashboard remains unchanged while every detailed run gains a permanent archive file.
const detailByStart=new Map();
for(const w of previousOutput?.detailedRuns||[]) if(w?.startTime) detailByStart.set(w.startTime,w);
for(const w of detailedRuns) if(w?.startTime) detailByStart.set(w.startTime,w);
detailedRuns=runs.slice(0,DASHBOARD_DETAIL_RUNS).map(w=>detailByStart.get(w.startTime)).filter(Boolean);

const MIN_EFFICIENCY_SECONDS=30*60;
const efficiencyCandidates=detailedRuns
  .map(w=>({w,calc:weatherAdjustedEfficiency(w)}))
  .filter(x=>x.calc && Number(x.w.activeSeconds)>=MIN_EFFICIENCY_SECONDS)
  .sort((a,b)=>String(a.w.startTime).localeCompare(String(b.w.startTime)));
const baselinePool=efficiencyCandidates.slice(0,Math.min(3,efficiencyCandidates.length)).map(x=>x.calc.adjustedEfficiency);
const weatherEfficiencyBaseline=median(baselinePool);
for(const {w,calc} of efficiencyCandidates){
  w.weatherAdjustedEfficiency={
    ...calc,
    score:weatherEfficiencyBaseline?round(100*calc.adjustedEfficiency/weatherEfficiencyBaseline,1):null
  };
}
const weatherAdjustedTrend=efficiencyCandidates.map(({w})=>({
  date:w.date,
  startTime:w.startTime,
  score:w.weatherAdjustedEfficiency?.score??null,
  adjustedEfficiency:w.weatherAdjustedEfficiency?.adjustedEfficiency??null,
  rawEfficiency:w.weatherAdjustedEfficiency?.rawEfficiency??null,
  weatherFactor:w.weatherAdjustedEfficiency?.weatherFactor??null,
  heatPenaltyPct:w.weatherAdjustedEfficiency?.heatPenaltyPct??null,
  solarPenaltyPct:w.weatherAdjustedEfficiency?.solarPenaltyPct??null
}));

const recentRuns=runs.slice(0,DASHBOARD_DETAIL_RUNS).map(w=>({
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
  generatedAt:new Date().toISOString(),timeZone:TZ,lookbackDays:TREND_DAYS,
  publicDataNotice:'Workout/running metrics only. GPS coordinates, sleep, weight, OAuth credentials and tokens are not included.',
  recentRuns,detailedRuns,
  runningTrend:{
    days:TREND_DAYS,runs:trend.filter(x=>new Date(x.startTime)>=addDays(now,-TREND_DAYS)),vo2Max:vo2Max.filter(x=>new Date(x.date+'T12:00:00Z')>=addDays(now,-TREND_DAYS)),
    weatherAdjusted:{
      runs:weatherAdjustedTrend,
      baseline:weatherEfficiencyBaseline,
      baselineMethod:'Median adjusted efficiency of earliest 3 qualifying detailed runs (minimum 30 minutes)',
      formula:'(speedMph / avgHR) × [1 + 0.0035 × max(HI−80,0) + 0.00008 × solarWm2]',
      heatIndexThresholdF:80,
      heatPenaltyPerDegree:0.0035,
      solarPenaltyPerWm2:0.00008,
      dewpointHandling:'Not added separately because heat index already incorporates humidity.',
      minimumDurationSeconds:MIN_EFFICIENCY_SECONDS,
      modelStatus:weatherAdjustedTrend.length>=30?'30+ qualifying runs available; ready for personalized-model evaluation.':'Provisional transparent weather correction; more runs are needed before fitting a personalized model.'
    }
  },
  trainingLoad:{days:120,points:loadPoints,summary:{}}
};

// Add stable IDs, analysis-friendly summaries, and permanent per-run detail files.
for(const w of detailedRuns){
  w.runId=runId(w);
  w.detailFile=runDetailFile(w);
  w.analysisSummary=analysisSummary(w);
}
await fs.mkdir('docs/data/runs',{recursive:true});
for(const w of detailedRuns){
  const filePath='docs/'+w.detailFile;
  await fs.mkdir(filePath.slice(0,filePath.lastIndexOf('/')),{recursive:true});
  await fs.writeFile(filePath,JSON.stringify(w));
}

const previousIndexByStart=new Map((previousIndex?.runs||[]).map(x=>[x.startTime,x]));
const detailedIndexByStart=new Map(detailedRuns.map(x=>[x.startTime,x]));
const runIndexRuns=runs.map(w=>{
  const d=detailedIndexByStart.get(w.startTime);
  const old=previousIndexByStart.get(w.startTime)||{};
  const recovery=d?.heartRateRecovery||{};
  const wx=d?.weather?.average||{};
  return {
    runId:d?.runId||old.runId||runId(w),
    date:w.date,
    startTime:w.startTime,
    endTime:w.endTime,
    activeSeconds:w.activeSeconds,
    distanceMiles:w.distanceMiles,
    averagePaceSecondsPerMile:d?.averagePaceSecondsPerMile??w.averagePaceSecondsPerMile,
    averageHeartRate:d?.averageHeartRate??w.averageHeartRate,
    peakHeartRate:d?.peakHeartRate??old.peakHeartRate??null,
    hrr1:d?recovery.minute1Drop??null:old.hrr1??null,
    hrr2:d?recovery.minute2Drop??null:old.hrr2??null,
    hrr3:d?recovery.minute3Drop??null:old.hrr3??null,
    cardioDriftPercent:d?.aerobicDecoupling?.percent??old.cardioDriftPercent??null,
    trainingLoad:d?.trainingLoad??old.trainingLoad??null,
    adjustedPerformanceIndex:d?.weatherAdjustedEfficiency?.score??old.adjustedPerformanceIndex??null,
    heatIndexF:d?wx.heatIndexF??null:old.heatIndexF??null,
    dewpointF:d?wx.dewpointF??null:old.dewpointF??null,
    solarRadiationWm2:d?wx.solarRadiationWm2??null:old.solarRadiationWm2??null,
    detailFile:d?.detailFile||old.detailFile||null
  };
});

const archiveMeta={
  generatedAt:output.generatedAt,
  timeZone:TZ,
  archiveStartDate:ARCHIVE_START_DATE,
  runCount:runIndexRuns.length
};
const latestDetailed=detailedRuns[0]||null;
const trendsOutput={
  ...archiveMeta,
  runningTrend:output.runningTrend,
  trainingLoad:output.trainingLoad
};

await fs.mkdir('docs/data',{recursive:true});
await Promise.all([
  fs.writeFile('docs/data.json',JSON.stringify(output)),
  fs.writeFile('docs/data/latest.json',JSON.stringify({...archiveMeta,run:latestDetailed})),
  fs.writeFile('docs/data/run-index.json',JSON.stringify({...archiveMeta,runs:runIndexRuns})),
  fs.writeFile('docs/data/trends.json',JSON.stringify(trendsOutput))
]);
console.log(`Published ${recentRuns.length} recent runs, refreshed ${Math.min(DETAIL_REFRESH_RUNS,runs.length)} detailed runs, archived ${detailedRuns.length} detailed dashboard runs, and indexed ${runIndexRuns.length} total runs.`);
