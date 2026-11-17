/**
 * Garmin Run + Wellness Lab. All series are from the public, owner-approved
 * Garmin JSON feed. Missing Garmin metrics are never extrapolated or replaced
 * with Google/Fitbit values.
 */
import {detectChartStart} from './garmin-chart-start.js';
import {averageTimeline} from './garmin-time-averages.js';
const $=id=>document.getElementById(id);
const charts=new Map();
const state={index:[],wellness:{days:{}},run:null,day:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const fmt=(v,d=1)=>n(v)===null?'—':v.toFixed(d);
const pace=seconds=>n(seconds)!==null&&seconds>0?Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0')+'/mi':'—';
const duration=seconds=>n(seconds)!==null?Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0'):'—';
const dateTime=iso=>iso?new Date(iso).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
const missing=(reason='NO_SAMPLE')=>reason==='NOT_RECORDED_BY_DEVICE'?"Sense 2 didn't record this":reason==='NOT_YET_BASELINED'?'Garmin baseline building':'No sample recorded';
const metric=(label,value,hint='')=>'<div class="metric"><div class="value">'+esc(value)+'</div><div class="label">'+esc(label)+'</div><div class="hint">'+esc(hint)+'</div></div>';
async function loadJson(path){
  const response=await fetch(path,{cache:'no-store'});
  if(!response.ok)throw Error('Cannot load '+path+' ('+response.status+')');
  return response.json();
}
function resetChart(name){
  if(charts.has(name)){charts.get(name).destroy();charts.delete(name);}
}
function xMinutes(time,origin){
  return (Date.parse(time)-Date.parse(origin))/60000;
}
function series(points,key,origin,interval=1){
  return (points||[]).filter((_,i)=>i%interval===0).map(p=>({
    x:xMinutes(p.time,origin),y:n(p[key])
  })).filter(p=>Number.isFinite(p.x)&&p.x>=0&&p.y!==null);
}
function chart(name,canvasId,origin,definitions){
  resetChart(name);
  const datasets=definitions.map((d,i)=>{
    const points=series(d.source,d.key,origin,d.every||1);
    return points.length?{
      label:d.label,data:points,parsing:false,pointRadius:0,borderWidth:2,
      spanGaps:false,tension:.12,borderColor:d.color,yAxisID:d.axis||'left'
    }:null;
  }).filter(Boolean);
  if(!datasets.length){
    $(canvasId).hidden=true;
    const box=$(canvasId).parentElement;
    let note=box.querySelector('.empty-series');
    if(!note){note=document.createElement('div');note.className='empty empty-series';box.appendChild(note);}
    note.textContent='The current FIT file has no measurements for this chart.';
    return;
  }
  $(canvasId).hidden=false;
  const note=$(canvasId).parentElement.querySelector('.empty-series');
  if(note)note.remove();
  const dual=datasets.some(d=>d.yAxisID==='right');
  const rightDefinition=definitions.find(d=>d.axis==='right');
  if(typeof Chart==='undefined')throw Error('Chart.js did not load');
  const options={
    responsive:true,maintainAspectRatio:false,animation:false,
    interaction:{mode:'nearest',intersect:false,axis:'x'},
    plugins:{legend:{labels:{color:'#b3c5d9',boxWidth:12}},
      tooltip:{backgroundColor:'#0d1725',titleColor:'#fff',bodyColor:'#bdd6e8',
        callbacks:{title:items=>items.length?items[0].parsed.x.toFixed(1)+' min':''}}},
    scales:{
      x:{type:'linear',ticks:{color:'#859db8'},grid:{color:'#233650'},
        title:{display:true,text:'Minutes since movement began',color:'#849bb3'}},
      left:{type:'linear',position:'left',ticks:{color:'#aebed1'},grid:{color:'#243549'}},
      ...(dual?{right:{type:'linear',position:'right',grid:{drawOnChartArea:false},
        reverse:Boolean(rightDefinition?.reverse),ticks:{color:'#aebed1',callback:rightDefinition?.tick||undefined}}}:{})
    }
  };
  charts.set(name,new Chart($(canvasId),{type:'line',data:{datasets},options}));
}
function renderPrimaryTimeline(details,origin){
  const selected=Number($('hr-pace-resolution')?.value||60);
  const interval=[1,15,30,60,300].includes(selected)?selected:60;
  // Keep the original Garmin FIT 1-second HR samples unchanged.
  // The dropdown controls pace smoothing ONLY.
  const hr=(details.heartRateSeries||[]).filter(p=>
    p.time>=origin&&Number.isFinite(p.value));
  const pacePoints=averageTimeline(
    (details.paceSeries||[]).filter(p=>p.time>=origin),
    'paceSecondsPerMile',origin,interval,{pace:true});
  chart('primary','run-primary-chart',origin,[
    {label:'Heart rate (bpm)',source:hr,key:'value',color:'#52baf7'},
    {label:'Pace (min/mi)',source:pacePoints,key:'paceSecondsPerMile',
      axis:'right',reverse:true,tick:val=>pace(val).replace('/mi',''),color:'#ae9fff'}
  ]);
}
function rowsHtml(laps){
  if(!laps||!laps.length)return '<div class="empty">This FIT recording has no exported lap breakdown.</div>';
  const head='<table><thead><tr><th>#</th><th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Peak HR</th><th>Power</th><th>Cadence</th><th>GCT</th><th>Balance</th><th>Stride</th><th>Ascent</th></tr></thead><tbody>';
  return head+laps.map((l,i)=>{
    const p=n(l.durationSeconds)!==null&&n(l.distanceMiles)>0?l.durationSeconds/l.distanceMiles:null;
    return '<tr><td>'+(i+1)+'</td><td>'+fmt(l.distanceMiles,2)+' mi</td><td>'+duration(l.durationSeconds)+'</td><td>'+pace(p)+'</td><td>'+fmt(l.averageHeartRate,0)+'</td><td>'+fmt(l.peakHeartRate,0)+'</td><td>'+fmt(l.averagePowerWatts,0)+'</td><td>'+fmt(l.averageCadenceSpm,0)+' spm</td><td>'+fmt(l.avgGroundContactMs,0)+' ms</td><td>'+(n(l.avgGroundContactBalancePct)===null?'Wrist-only: not recorded':fmt(l.avgGroundContactBalancePct,1)+'%')+'</td><td>'+(n(l.avgStrideLengthM)===null?missing():fmt(l.avgStrideLengthM,2)+' m')+'</td><td>'+fmt(l.ascentM,0)+' m</td></tr>';
  }).join('')+'</tbody></table>';
}
async function showRun(run){
  if(!run)return;
  const details=await loadJson('../'+run.detailFile);
  state.run=details;
  const m=details.garminMetrics||{};
  const cadence=n(m.avgCadenceSpm)!==null?m.avgCadenceSpm:n(m.avgCadenceRaw)!==null?2*m.avgCadenceRaw:null;
  const gct=m.avgGroundContactMs??m.avgGroundContactTime;
  const vo=m.avgVerticalOscillationCm??(n(m.avgVerticalOscillation)!==null?m.avgVerticalOscillation/10:null);
  $('run-metrics').innerHTML=[
    metric('Distance',fmt(details.distanceMiles,2)+' mi','Garmin session'),
    metric('Timer',duration(details.activeSeconds),'Elapsed '+duration(details.elapsedSeconds)),
    metric('Pace',pace(details.averagePaceSecondsPerMile),'Garmin timer/distance'),
    metric('Average HR',fmt(details.averageHeartRate,0)+' bpm','Peak '+fmt(details.peakHeartRate,0)),
    metric('Cadence',fmt(cadence,1)+' spm','FIT running cadence'),
    metric('Ground contact',fmt(gct,0)+' ms','FIT running dynamics'),
    metric('Vertical oscillation',fmt(vo,2)+' cm','FIT running dynamics'),
    metric('Running power',n(m.avgPowerWatts)===null?'—':fmt(m.avgPowerWatts,0)+' W','FIT recording'),
    metric('Aerobic drift',n(details.aerobicDecoupling?.percent)===null?'—':fmt(details.aerobicDecoupling.percent,1)+'%',
      details.aerobicDecoupling?.interpretation||'Not enough matched pace/HR data'),
    metric('HR zones',details.zoneSummary?.length?'5 running zones':'Not configured',
      details.zoneSummary?.length?'Running profile · % max HR':'Requires personal Garmin HR-zone boundaries'),
    metric('HR recovery · 1 min',n(details.heartRateRecovery?.minute1Drop)===null?'—':fmt(details.heartRateRecovery.minute1Drop,0)+' bpm',
      'Approximate Garmin daily HR sample; not standardized'),
    metric('HR recovery · 2 min',n(details.heartRateRecovery?.minute2Drop)===null?'—':fmt(details.heartRateRecovery.minute2Drop,0)+' bpm',
      details.heartRateRecovery?.minute2Source==='garmin-native-two-minute-recovery'
        ? 'Garmin native two-minute recovery drop'
        : 'Unavailable without Garmin-native recovery or a suitable sample'),
    metric('HR recovery · 3 min',n(details.heartRateRecovery?.minute3Drop)===null?'—':fmt(details.heartRateRecovery.minute3Drop,0)+' bpm',
      'Approximate Garmin daily HR sample; not standardized'),
    metric('Training load',n(details.garminNative?.activityTrainingLoad)===null?'—':fmt(details.garminNative.activityTrainingLoad,0),
      'Garmin activity load, if returned by Connect'),
    metric('Aerobic training effect',n(details.garminNative?.aerobicTrainingEffect)===null?'—':fmt(details.garminNative.aerobicTrainingEffect,1),
      'Garmin-native score, if available'),
    metric('Anaerobic training effect',n(details.garminNative?.anaerobicTrainingEffect)===null?missing():fmt(details.garminNative.anaerobicTrainingEffect,1),'Garmin Connect native'),
    metric('Training effect focus',details.garminNative?.trainingEffectLabel||missing(),'Garmin native category'),
    metric('Recovery time',n(details.garminNative?.recoveryTime)===null?missing():fmt(details.garminNative.recoveryTime,0)+(details.garminNative?.recoveryTimeUnit?' '+details.garminNative.recoveryTimeUnit:' (native units unverified)'),'Garmin Connect activity-detail/listing; no inferred hours'),
    metric('Performance condition',n(details.garminNative?.performanceCondition)===null?missing():fmt(details.garminNative.performanceCondition,0),'Garmin Connect activity detail / listing; may legitimately be absent'),
    metric('Ground contact balance',n(m.avgGroundContactBalancePct)===null?'Wrist-only: not recorded':fmt(m.avgGroundContactBalancePct,1)+'%','Requires a compatible running-dynamics accessory; wrist-only 970 does not report balance'),
    metric('Stride length',n(m.avgStrideLengthM)===null?missing():fmt(m.avgStrideLengthM,2)+' m','FIT; on new syncs'),
    metric('Ascent',n(details.garminSessionTotals?.ascentM)===null?missing():fmt(details.garminSessionTotals.ascentM*3.28084,0)+' ft','FIT session'),
    metric('Descent',n(details.garminSessionTotals?.descentM)===null?missing():fmt(details.garminSessionTotals.descentM*3.28084,0)+' ft','FIT session'),
    metric('Calories',n(details.garminSessionTotals?.calories)===null?missing():fmt(details.garminSessionTotals.calories,0),'FIT session'),
    metric('Total strides',n(details.garminSessionTotals?.totalStrides)===null?missing():Math.round(details.garminSessionTotals.totalStrides).toLocaleString(),'FIT session total'),
    metric('Average recorded temperature',n(details.garminSessionTotals?.avgTemperatureC)===null?missing():fmt(details.garminSessionTotals.avgTemperatureC*9/5+32,1)+'°F','FIT temperature, not Tempest'),
    metric('Maximum recorded temperature',n(details.garminSessionTotals?.maxTemperatureC)===null?missing():fmt(details.garminSessionTotals.maxTemperatureC*9/5+32,1)+'°F','FIT temperature, not Tempest')
  ].join('');
  document.querySelector('#running-hr-zone-table')?.remove();
  if(details.zoneSummary?.length){
    const rows=[...(details.belowZone1?[details.belowZone1]:[]),...details.zoneSummary];
    const zoneRows=rows.map(z=>'<tr><td>'+esc(z.label)+'</td><td>'+
      (z.minimumBpm??'&lt;')+(z.maximumBpm===null?'+ bpm':z.minimumBpm===undefined?' '+z.maximumBpm+' bpm':'–'+z.maximumBpm+' bpm')+
      '</td><td>'+duration(z.seconds)+'</td><td>'+
      (100*z.seconds/Math.max(1,details.heartRateSeries?.length||0)).toFixed(1)+'%</td></tr>').join('');
    $('run-metrics').insertAdjacentHTML('afterend',
      '<div id="running-hr-zone-table"><div class="empty" style="margin-top:12px">Running heart-rate zones · % max HR, 186 bpm (Nov 17 configuration; rounded BPM boundaries)</div>'+
      '<table><thead><tr><th>Zone</th><th>HR range</th><th>Time</th><th>% samples</th></tr></thead><tbody>'+zoneRows+'</tbody></table></div>');
  }
  const bands=details.runningDynamicsByPace||[];
  if(bands.length){
    const table='<div class="empty" style="margin-top:12px">Dynamics by observed pace band (at least 15 samples; these are associations, not efficiency tests)</div>'+
      '<table><thead><tr><th>Pace band</th><th>Seconds</th><th>Power</th><th>Vertical ratio</th><th>Ground contact</th></tr></thead><tbody>'+
      bands.map(b=>'<tr><td>'+esc(b.paceBand)+'</td><td>'+b.seconds+'</td><td>'+fmt(b.powerWatts,0)+' W</td><td>'+fmt(b.verticalRatioPct,2)+'%</td><td>'+fmt(b.groundContactMs,0)+' ms</td></tr>').join('')+'</tbody></table>';
    $('run-metrics').insertAdjacentHTML('afterend', '<div id="pace-band-table">'+table+'</div>');
    const oldTable=document.querySelectorAll('#pace-band-table');
    oldTable.forEach((el,i)=>{if(i<oldTable.length-1)el.remove();});
  }else document.querySelector('#pace-band-table')?.remove();
  const coverage=[
    ['Heart rate',details.heartRateSeries?.length||0],
    ['Pace',details.paceSeries?.length||0],
    ['Running dynamics',details.dynamicsSeries?.length||0],
    ['Cadence',details.dynamicsSeries?.filter(x=>n(x.cadenceSpm)!==null&&x.cadenceSpm>0).length||0],
    ['Power',details.dynamicsSeries?.filter(x=>n(x.powerWatts)!==null&&x.powerWatts>0).length||0],
    ['Ground contact',details.dynamicsSeries?.filter(x=>n(x.groundContactMs)!==null).length||0],
    ['Stride length',details.dynamicsSeries?.filter(x=>n(x.strideLengthM)!==null).length||0],
    ['Ground-contact balance',details.dynamicsSeries?.filter(x=>n(x.groundContactBalancePct)!==null).length||0],
    ['Elevation',details.dynamicsSeries?.filter(x=>n(x.elevationFt)!==null).length||0]
  ];
  let coverageNode=document.getElementById('garmin-coverage');
  if(!coverageNode){coverageNode=document.createElement('div');coverageNode.id='garmin-coverage';$('run-metrics').insertAdjacentElement('afterend',coverageNode);}
  coverageNode.innerHTML='<div class="empty">FIT data coverage · '+esc(details.date)+' · sample counts (not all fields share the same sampling rate)</div>'+
    '<div class="metrics">'+coverage.map(([name,count])=>metric(name,count?count.toLocaleString():missing(),count?'Recorded valid samples':'Field absent on this activity')).join('')+'</div>';
  const summaryLine=dateTime(details.startTime)+' · Garmin activity '+details.sourceActivityId+
    ' · '+(details.heartRateSeries?.length||0)+' HR samples · '+(details.paceSeries?.length||0)+
    ' Garmin pace points · '+(details.dynamicsSeries?.length||0)+' dynamics records';
  const chartStart=detectChartStart(details);
  const wx=details.weather?.average||{};
  const weatherContext=n(wx.tempF)!==null?' · Tempest: '+fmt(wx.tempF,1)+'°F; dewpoint '+fmt(wx.dewpointF,1)+'°F; wind '+fmt(wx.windAvgMph,1)+' mph; solar '+fmt(wx.solarRadiationWm2,0)+' W/m²':'';
  $('run-context').innerHTML=esc(summaryLine+weatherContext)
    +(chartStart.trimmedSeconds>0
      ? ' · chart-only startup trim: '+chartStart.trimmedSeconds+' sec'
      : '')
    +(details.route?.points?.length
      ? ' · <a href="./?view=analysis&run='+encodeURIComponent(details.runId)+'">Open Garmin route map →</a>'
      : '');
  // All three charts use the same moving-start origin. Data, lap splits,
  // distance, timer, and summary values are left exactly as recorded.
  const origin=chartStart.startTime;
  const hr=(details.heartRateSeries||[]).filter(p=>p.time>=origin);
  const pp=(details.paceSeries||[]).filter(p=>p.time>=origin);
  const dyn=(details.dynamicsSeries||[]).filter(p=>p.time>=origin);
  renderPrimaryTimeline(details,origin);
  chart('mechanics','run-mechanics-chart',origin,[
    {label:'Cadence (spm)',source:dyn,key:'cadenceSpm',color:'#52baf7',every:Math.max(1,Math.floor(dyn.length/700))},
    {label:'Ground contact (ms)',source:dyn,key:'groundContactMs',axis:'right',color:'#3ed6ae',
      every:Math.max(1,Math.floor(dyn.length/700))}
  ]);
  chart('power','run-power-chart',origin,[
    {label:'Vertical oscillation (cm)',source:dyn,key:'verticalOscillationCm',color:'#ad92ff',
      every:Math.max(1,Math.floor(dyn.length/700))},
    {label:'Running power (W)',source:dyn,key:'powerWatts',axis:'right',color:'#edab60',
      every:Math.max(1,Math.floor(dyn.length/700))}
  ]);
  const heights=(details.dynamicsSeries||[]).map(p=>p.elevationFt).filter(v=>n(v)!==null);
  let elevationNote=document.getElementById('garmin-elevation-note');
  if(!elevationNote){elevationNote=document.createElement('div');elevationNote.id='garmin-elevation-note';$('run-context').insertAdjacentElement('afterend',elevationNote);}
  elevationNote.textContent=heights.length?'Elevation range: '+fmt(Math.min(...heights),0)+'–'+fmt(Math.max(...heights),0)+' ft (FIT samples)':'Elevation: '+missing();
  $('lap-table').innerHTML=rowsHtml(details.lapSummaries);
  $('source-note').textContent=details.dataSourceNotice||
    'Garmin FIT measurements only. Missing fields are not filled from Fitbit/Google Health.';
}
const normalize=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
function flatten(value,prefix='',output=[],depth=0){
  if(output.length>2000||depth>8)return output;
  if(Array.isArray(value)){
    if(value.length>50){
      output.push({path:prefix+' [array size]',value:value.length});
    }
    value.slice(0,Math.min(value.length,50)).forEach((v,i)=>flatten(v,prefix+'['+i+']',output,depth+1));
  }else if(value&&typeof value==='object'){
    Object.entries(value).forEach(([key,v])=>flatten(v,prefix?prefix+'.'+key:key,output,depth+1));
  }else if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'){
    output.push({path:prefix,value});
  }
  return output;
}
function findValue(dataset,aliases){
  const aliasesNormalized=aliases.map(normalize);
  const paths=flatten(dataset);
  for(const alias of aliasesNormalized){
    const hit=paths.find(x=>normalize(x.path.split('.').pop())===alias&&n(x.value)!==null);
    if(hit)return hit.value;
  }
  return null;
}
function dayMeasurement(day,dataset,aliases){
  return findValue(day?.[dataset]||{},aliases);
}
function showWellness(dayKey){
  state.day=dayKey;
  const day=state.wellness.days[dayKey]||{};
  const hr=dayMeasurement(day,'hrv',['lastNightAvg','hrvValue','overnightAverage']);
  const weekly=dayMeasurement(day,'hrv',['weeklyAvg','weeklyAverage']);
  const rest=dayMeasurement(day,'heartRate',['restingHeartRate','restingHeartRateValue']);
  const sleep=dayMeasurement(day,'sleep',['sleepTimeSeconds','totalSleepSeconds','sleepDurationSeconds']);
  const bbValues=(day.bodyBattery||[]).flatMap(entry=>
    (entry.bodyBatteryValuesArray||[]).filter(row=>
      Array.isArray(row)&&n(row[0])!==null&&n(row[1])!==null));
  bbValues.sort((a,b)=>a[0]-b[0]);
  const bb=bbValues.length?bbValues[bbValues.length-1][1]:null;
  const bbFirst=bbValues.length?bbValues[0][1]:null;
  const deep=dayMeasurement(day,'sleep',['deepSleepSeconds']);
  const rem=dayMeasurement(day,'sleep',['remSleepSeconds']);
  const respiration=dayMeasurement(day,'sleep',['averageRespirationValue']);
  const spo2=dayMeasurement(day,'spo2',['avgSleepSpO2','averageSpO2']);
  const stress=dayMeasurement(day,'stress',['overallStressLevel','averageStressLevel']);
  const steps=dayMeasurement(day,'steps',['totalSteps','steps']);
  const vo2=dayMeasurement(day,'vo2Max',['maxMetRun','vo2MaxValue','vo2Max']);
  const hours=n(sleep)!==null?Math.floor(sleep/3600)+'h '+Math.round(sleep%3600/60)+'m':missing();
  const sleepObj=day.sleep||{};
  const bbEntry=(day.bodyBattery||[])[0]||{};
  const daily=day.dailySummaries?.data?.[0]||{};
  const minText=v=>n(v)===null?missing():Math.round(v/60)+' min';
  const sleepNeed=sleepObj.sleepNeed||sleepObj.nextSleepNeed||{};
  $('daily-metrics').innerHTML=[
    metric('Overnight HRV',n(hr)===null?'—':fmt(hr,1)+' ms','7-day '+fmt(weekly,1)+' ms'),
    metric('Resting HR',n(rest)===null?'—':fmt(rest,0)+' bpm','Garmin daily HR'),
    metric('Sleep',hours,'Recorded duration'),
    metric('Body Battery',n(bb)===null?'—':fmt(bb,0),'Last sample · first '+fmt(bbFirst,0)),
    metric('Stress',n(stress)===null?'—':fmt(stress,0),'Garmin proprietary scale'),
    metric('Steps',n(steps)===null?'—':Math.round(steps).toLocaleString(),'Garmin daily steps'),
    metric('Running VO₂ max',n(vo2)===null?missing('NOT_YET_BASELINED'):fmt(vo2,1),'Watch estimate; no cross-device splice'),
    metric('Sleep score',n(sleepObj.sleepScores?.overall?.value)===null?missing():fmt(sleepObj.sleepScores.overall.value,0),'Garmin score'),
    metric('Sleep need',n(sleepNeed.actual)===null?missing():Math.round(sleepNeed.actual)+' min','Garmin reported; baseline '+(n(sleepNeed.baseline)===null?missing():Math.round(sleepNeed.baseline)+' min')),
    metric('Nap',minText(sleepObj.napTimeSeconds),'Garmin-estimated'),
    metric('Light sleep',minText(sleepObj.lightSleepSeconds),'Garmin-estimated'),
    metric('Awake',minText(sleepObj.awakeSleepSeconds),'Count '+(sleepObj.awakeCount??missing())),
    metric('Avg sleep stress',n(sleepObj.avgSleepStress)===null?missing():fmt(sleepObj.avgSleepStress,0),'Garmin sleep'),
    metric('Avg sleep HR',n(sleepObj.avgHeartRate)===null?missing():fmt(sleepObj.avgHeartRate,0)+' bpm','Garmin sleep'),
    metric('Battery charged',n(bbEntry.charged)===null?missing():'+'+fmt(bbEntry.charged,0),'Garmin daily'),
    metric('Battery drained',n(bbEntry.drained)===null?missing():'−'+fmt(bbEntry.drained,0),'Garmin daily'),
    metric('Step distance',n(day.steps?.[0]?.totalDistance)===null?missing():fmt(day.steps[0].totalDistance/1609.344,2)+' mi','Garmin steps endpoint'),
    metric('Total calories',n(daily.calories?.burnedTotal)===null?missing():fmt(daily.calories.burnedTotal,0),'Garmin daily summary'),
    metric('Intensity minutes',n(daily.intensityMinutes?.moderate)===null?missing():fmt(daily.intensityMinutes.moderate+2*(daily.intensityMinutes.vigorous||0),0),'Garmin moderate + 2×vigorous'),
    metric('Deep sleep',n(deep)===null?'—':Math.round(deep/60)+' min','Watch-estimated'),
    metric('REM sleep',n(rem)===null?'—':Math.round(rem/60)+' min','Watch-estimated'),
    metric('Respiration',n(respiration)===null?'—':fmt(respiration,1)+'/min','Sleep average'),
    metric('Sleep Pulse Ox',n(spo2)===null?missing():fmt(spo2,0)+'%','Requires watch Pulse Ox recording; setting may be disabled'),
    metric('Datasets',String(Object.keys(day).length),'API reports stored')
  ].join('');
  let dailyCoverage=document.getElementById('garmin-daily-coverage');
  if(!dailyCoverage){dailyCoverage=document.createElement('div');dailyCoverage.id='garmin-daily-coverage';$('daily-metrics').insertAdjacentElement('afterend',dailyCoverage);}
  const dailyAvailable=['hrv','sleep','bodyBattery','stress','heartRate','steps','dailySummaries','vo2Max','spo2'].filter(k=>day[k]!=null);
  dailyCoverage.textContent='Daily endpoint coverage: '+dailyAvailable.length+'/9 reported · '+dailyAvailable.join(', ')+'. An available endpoint can still return null measurements.';
  const kinds=['hrv','hrvSummaries','sleep','sleepSummaries','bodyBattery','stress','heartRate','steps','dailySummaries','vo2Max','spo2'];
  $('wellness-datasets').innerHTML=kinds.map(k=>'<span class="dataset-pill '+(day[k]?'':'missing')+
    '">'+esc(k)+(day[k]?' · available':' · missing')+'</span>').join('');
  $('dataset-select').innerHTML=Object.keys(day).sort().map(k=>
    '<option value="'+esc(k)+'">'+esc(k)+'</option>').join('');
  $('dataset-select').disabled=!Object.keys(day).length;
  showDataset();
}
function showDataset(){
  const day=state.wellness.days[state.day]||{};
  const kind=$('dataset-select').value;
  const item=day[kind];
  if(item===undefined){
    $('dataset-fields').innerHTML='<div class="empty">No report found for this date.</div>';
    $('dataset-json').textContent='No Garmin data for this selection.';
    return;
  }
  const fields=flatten(item).slice(0,120);
  $('dataset-fields').innerHTML=fields.map(f=>
    '<div class="field"><span class="key">'+esc(f.path)+'</span><span class="val">'+esc(f.value)+'</span></div>'
  ).join('')||'<div class="empty">The API returned no scalar values.</div>';
  $('dataset-json').textContent=JSON.stringify(item,null,2);
}
function showWellnessTrend(){
  resetChart('wellness');
  if(typeof Chart==='undefined')return;
  const days=Object.keys(state.wellness.days).sort();
  const values=days.map(day=>{
    const obj=state.wellness.days[day];
    return {day,hrv:dayMeasurement(obj,'hrv',['lastNightAvg','hrvValue','overnightAverage']),
      rest:dayMeasurement(obj,'heartRate',['restingHeartRate','restingHeartRateValue'])};
  });
  const datasets=[
    {label:'Overnight HRV (ms)',data:values.map(v=>({x:v.day,y:n(v.hrv)})).filter(v=>v.y!==null),
      borderColor:'#55b7f4',yAxisID:'hrv'},
    {label:'Resting HR (bpm)',data:values.map(v=>({x:v.day,y:n(v.rest)})).filter(v=>v.y!==null),
      borderColor:'#49d3a6',yAxisID:'rest'}
  ].filter(d=>d.data.length);
  if(days.length<14){
    $('wellness-trend-chart').hidden=true;
    const note=$('wellness-trend-chart').parentElement.querySelector('.baseline-note')||document.createElement('div');
    note.className='empty baseline-note';note.textContent='Garmin wellness baseline building: '+days.length+' of 14 days before trend display.';
    $('wellness-trend-chart').parentElement.appendChild(note);return;
  }
  $('wellness-trend-chart').hidden=false;
  $('wellness-trend-chart').parentElement.querySelector('.baseline-note')?.remove();
  if(!datasets.length){
    $('wellness-trend-chart').parentElement.innerHTML='<div class="empty">Trend starts once Garmin returns usable HRV or resting-HR values.</div>';
    return;
  }
  charts.set('wellness',new Chart($('wellness-trend-chart'),{
    type:'line',data:{labels:days,datasets:datasets.map(d=>({...d,pointRadius:3,borderWidth:2,spanGaps:false,tension:.2}))},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{labels:{color:'#bfcee0'}}},
      scales:{x:{type:'category',ticks:{color:'#94a9c0',maxTicksLimit:8}},
        hrv:{type:'linear',position:'left',ticks:{color:'#9ab4ce'},grid:{color:'#243549'}},
        rest:{type:'linear',position:'right',ticks:{color:'#9ab4ce'},grid:{drawOnChartArea:false}}}
    }
  }));
}
async function init(){
  try{
    const [index,wellness]=await Promise.all([
      loadJson('../data/run-index.json'),
      loadJson('../data/garmin-wellness.json').catch(()=>({days:{}}))
    ]);
    state.index=(index.runs||[]).filter(r=>r.source==='garmin'&&r.detailFile);
    state.wellness=wellness||{days:{}};
    const dates=Object.keys(state.wellness.days||{}).sort().reverse();
    $('sync-status').textContent='Sync '+(index.generatedAt?dateTime(index.generatedAt):'not available');
    $('hr-pace-resolution')?.addEventListener('change',()=>{
      if(!state.run)return;
      const origin=detectChartStart(state.run).startTime;
      renderPrimaryTimeline(state.run,origin);
    });
    if(state.index.length){
      $('run-select').innerHTML=state.index.map((r,i)=>'<option value="'+i+'">'+esc(r.date)+
        ' · '+fmt(r.distanceMiles,2)+' mi</option>').join('');
      $('run-select').addEventListener('change',()=>showRun(state.index[Number($('run-select').value)]).catch(fail));
      await showRun(state.index[0]);
    }else{
      $('run-metrics').innerHTML='<div class="empty">No Garmin runs have been published yet.</div>';
    }
    if(dates.length){
      $('day-select').innerHTML=dates.map(d=>'<option>'+d+'</option>').join('');
      $('day-select').addEventListener('change',()=>showWellness($('day-select').value));
      $('dataset-select').addEventListener('change',showDataset);
      showWellness(dates[0]);
      showWellnessTrend();
    }else{
      $('daily-metrics').innerHTML='<div class="empty">Wellness data will appear after the first Garmin sync.</div>';
      $('dataset-fields').innerHTML='<div class="empty">No daily reports published yet.</div>';
    }
  }catch(error){fail(error);}
}
function fail(error){
  $('sync-status').textContent='Data issue';
  $('run-context').textContent=error.message||String(error);
}
init();
