/**
 * Garmin Run + Wellness Lab. All series are from the public, owner-approved
 * Garmin JSON feed. Missing Garmin metrics are never extrapolated or replaced
 * with Google/Fitbit values.
 */
const $=id=>document.getElementById(id);
const charts=new Map();
const state={index:[],wellness:{days:{}},run:null,day:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const fmt=(v,d=1)=>n(v)===null?'—':v.toFixed(d);
const pace=seconds=>n(seconds)!==null&&seconds>0?Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0')+'/mi':'—';
const duration=seconds=>n(seconds)!==null?Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0'):'—';
const dateTime=iso=>iso?new Date(iso).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
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
        title:{display:true,text:'Minutes into run',color:'#849bb3'}},
      left:{type:'linear',position:'left',ticks:{color:'#aebed1'},grid:{color:'#243549'}},
      ...(dual?{right:{type:'linear',position:'right',grid:{drawOnChartArea:false},
        reverse:Boolean(rightDefinition?.reverse),ticks:{color:'#aebed1',callback:rightDefinition?.tick||undefined}}}:{})
    }
  };
  charts.set(name,new Chart($(canvasId),{type:'line',data:{datasets},options}));
}
function rowsHtml(laps){
  if(!laps||!laps.length)return '<div class="empty">This FIT recording has no exported lap breakdown.</div>';
  const head='<table><thead><tr><th>#</th><th>Distance</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Peak HR</th><th>Power</th></tr></thead><tbody>';
  return head+laps.map((l,i)=>{
    const p=n(l.durationSeconds)!==null&&n(l.distanceMiles)>0?l.durationSeconds/l.distanceMiles:null;
    return '<tr><td>'+(i+1)+'</td><td>'+fmt(l.distanceMiles,2)+' mi</td><td>'+duration(l.durationSeconds)+'</td><td>'+pace(p)+'</td><td>'+fmt(l.averageHeartRate,0)+'</td><td>'+fmt(l.peakHeartRate,0)+'</td><td>'+fmt(l.averagePowerWatts,0)+'</td></tr>';
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
    metric('Running power',n(m.avgPowerWatts)===null?'—':fmt(m.avgPowerWatts,0)+' W','FIT recording')
  ].join('');
  $('run-context').textContent=dateTime(details.startTime)+' · Garmin activity '+details.sourceActivityId+
    ' · '+(details.heartRateSeries?.length||0)+' HR samples · '+(details.paceSeries?.length||0)+
    ' Garmin pace points · '+(details.dynamicsSeries?.length||0)+' dynamics records';
  const origin=details.startTime;
  const hr=details.heartRateSeries||[],pp=details.paceSeries||[],dyn=details.dynamicsSeries||[];
  chart('primary','run-primary-chart',origin,[
    {label:'Heart rate (bpm)',source:hr,key:'value',color:'#52baf7'},
    {label:'Pace (seconds/mi)',source:pp,key:'paceSecondsPerMile',axis:'right',reverse:true,
      tick:val=>pace(val).replace('/mi',''),color:'#ae9fff',every:Math.max(1,Math.floor(pp.length/750))}
  ]);
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
  const bb=dayMeasurement(day,'bodyBattery',['bodyBatteryMostRecentValue','bodyBatteryLast']);
  const stress=dayMeasurement(day,'stress',['overallStressLevel','averageStressLevel']);
  const steps=dayMeasurement(day,'steps',['totalSteps','steps']);
  const vo2=dayMeasurement(day,'vo2Max',['maxMetRun','vo2MaxValue','vo2Max']);
  const hours=n(sleep)!==null?Math.floor(sleep/3600)+'h '+Math.round(sleep%3600/60)+'m':'—';
  $('daily-metrics').innerHTML=[
    metric('Overnight HRV',n(hr)===null?'—':fmt(hr,1)+' ms','7-day '+fmt(weekly,1)+' ms'),
    metric('Resting HR',n(rest)===null?'—':fmt(rest,0)+' bpm','Garmin daily HR'),
    metric('Sleep',hours,'Recorded duration'),
    metric('Body Battery',n(bb)===null?'—':fmt(bb,0),'Garmin report value'),
    metric('Stress',n(stress)===null?'—':fmt(stress,0),'Garmin proprietary scale'),
    metric('Steps',n(steps)===null?'—':Math.round(steps).toLocaleString(),'Garmin daily steps'),
    metric('Running VO₂ max',n(vo2)===null?'—':fmt(vo2,1),'Wearable estimate'),
    metric('Datasets',String(Object.keys(day).length),'API reports stored')
  ].join('');
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
