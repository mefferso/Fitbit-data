import {analyzeAerobicRun} from './aerobic-analysis.js';
const CUTOVER='2026-11-16';
const REJECT=new Map([
['2026-09-16','No GPS pace series'],['2026-09-24','TCX distance mismatch (−14%)'],
['2026-10-08','TCX distance mismatch (−11%)'],['2026-10-15','TCX distance mismatch (−9%)'],
['2026-11-11','Invalid TCX distance and late start (−17.7%)']
]);
const $=id=>document.getElementById(id);
const safe=v=>Number.isFinite(v)?v:null;
const dateOf=r=>r.date||r.startTime?.slice(0,10);
const era=r=>r.source==='garmin'?'Garmin':'Fitbit';
function eligible(r){
  const date=dateOf(r);
  if(date<CUTOVER&&REJECT.has(date))return {ok:false,reason:REJECT.get(date)};
  if(!r.heartRateSeries?.length||!r.paceSeries?.length)return {ok:false,reason:'No paired raw HR/pace series'};
  const a=analyzeAerobicRun(r,155);
  if(a.quality!=='usable')return {ok:false,reason:a.reason};
  return {ok:true,analysis:a};
}
export function bridgeMetrics(run){
  const result=eligible(run);
  return {...result,date:dateOf(run),source:era(run),runId:run.runId,
    weather:run.weather?.average||{},
    efficiency:result.ok?safe(result.analysis.steadyEfficiency):null,
    decoupling:result.ok?safe(result.analysis.steadyDriftPercent):null,
    matched:result.ok?safe(result.analysis.matchedPace):null};
}
const round=(n,d=2)=>n===null?'not available':Number(n).toFixed(d);
function renderMetric(name,rows,key,{reverse=false,unit='',format=v=>round(v)}={}){
  const accepted=rows.filter(r=>r.ok&&r[key]!==null);
  const before=accepted.filter(r=>r.source==='Fitbit'),after=accepted.filter(r=>r.source==='Garmin');
  const all=rows.filter(r=>r.source==='Fitbit'),newer=rows.filter(r=>r.source==='Garmin');
  $(name+'-status').textContent=
    'Qualifying: legacy '+before.length+' of '+all.length+
    ' · Garmin '+after.length+' of '+newer.length+
    ' · Garmin trends unlock at 5 qualifying runs; no cross-cutover connecting line.';
  const cutoverMs=Date.parse(CUTOVER+'T12:00:00Z');
  const maxPoints=accepted.map(r=>({x:Date.parse(r.date+'T12:00:00Z'),y:r[key],run:r}));
  const chartData=source=>maxPoints.filter(p=>p.run.source===source);
  const cutoverPlugin={id:'bridgeCutover',afterDraw(c){
    const {ctx,chartArea,scales}=c;if(!chartArea)return;
    const x=scales.x.getPixelForValue(cutoverMs);
    if(x<chartArea.left||x>chartArea.right)return;
    ctx.save();ctx.strokeStyle='#d0a96b';ctx.setLineDash([5,5]);ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(x,chartArea.top);ctx.lineTo(x,chartArea.bottom);ctx.stroke();
    ctx.setLineDash([]);ctx.fillStyle='#d0a96b';ctx.font='11px system-ui';ctx.fillText('Garmin era →',Math.min(x+4,chartArea.right-90),chartArea.top+13);
    ctx.restore();
  }};
  new Chart($(name),{type:'scatter',plugins:[cutoverPlugin],data:{datasets:[
    {label:'Fitbit / Google era',data:chartData('Fitbit'),pointStyle:'circle',pointRadius:5,
      pointBackgroundColor:'transparent',pointBorderColor:'#91bbd6',pointBorderWidth:2,showLine:false},
    {label:'Garmin era',data:chartData('Garmin'),pointRadius:6,
      pointBackgroundColor:'#e3ae5a',pointBorderColor:'#e3ae5a',showLine:false}
  ]},options:{responsive:true,maintainAspectRatio:false,animation:false,
    plugins:{legend:{labels:{color:'#d1dbe6'}},tooltip:{callbacks:{
      title:items=>items[0]?.raw?.run?.date||'',
      label:item=>{const r=item.raw.run,w=r.weather;return r.source+': '+format(item.raw.y)+unit+
        (w.dewpointF!=null?' · dewpoint '+w.dewpointF+'°F':'')+
        (w.tempF!=null?' · temp '+w.tempF+'°F':'');}
    }}},scales:{
      x:{type:'linear',min:Date.parse('2026-08-21T12:00:00Z'),
        ticks:{color:'#a7b8c9',maxTicksLimit:8,callback:v=>new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})},
        grid:{color:'#293c50'}},
      y:{reverse,title:{display:true,text:name==='matched'?'Seconds per mile':unit||'mph / bpm',color:'#bbc9da'},
        ticks:{color:'#a7b8c9',callback:v=>name==='matched'?Math.floor(v/60)+':'+String(Math.round(v%60)).padStart(2,'0'):v},
        grid:{color:'#293c50'}}
    }}}); 
}
async function run(){
  try{
    const response=await fetch('../data/run-index.json',{cache:'no-store'});
    if(!response.ok)throw Error('Index fetch failed: '+response.status);
    const index=await response.json();
    const summaries=(index.runs||[]).filter(r=>r.detailFile&&r.date>='2026-08-21');
    const result=[];
    for(let i=0;i<summaries.length;i+=5){
      const batch=await Promise.all(summaries.slice(i,i+5).map(async s=>{
        if(s.source!=='garmin'&&REJECT.has(s.date))
          return {ok:false,reason:REJECT.get(s.date),date:s.date,source:'Fitbit',runId:s.runId};
        try{
          const response=await fetch('../'+s.detailFile,{cache:'no-store'});
          if(!response.ok)throw Error('HTTP '+response.status);
          return bridgeMetrics(await response.json());
        }catch(e){
          return {ok:false,date:s.date,source:era(s),runId:s.runId,reason:'Raw detail unavailable'};
        }
      }));
      result.push(...batch);
      $('bridge-status').textContent='Reviewed '+result.length+' of '+summaries.length+' workouts…';
    }
    const missing=result.filter(r=>!r.ok);
    $('bridge-status').textContent='Source: '+(index.generatedAt||'unknown')+
      ' · '+result.length+' recent detailed workouts checked · '+missing.length+
      ' excluded / ineligible. Hover points to inspect weather. No values were written back to any workout.';
    renderMetric('efficiency',result,'efficiency',{format:v=>round(v,5)});
    renderMetric('decoupling',result,'decoupling',{unit:'%',format:v=>round(v,1)});
    renderMetric('matched',result,'matched',{reverse:true,format:v=>Math.floor(v/60)+':'+String(Math.round(v%60)).padStart(2,'0')+'/mi'});
  }catch(err){$('bridge-status').textContent='Bridge analysis unavailable: '+err.message;}
}
if(typeof document!=='undefined')run();
