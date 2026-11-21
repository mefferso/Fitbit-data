/* Aerobic Fitness Lab — comparison engine. Source: publicly sanitized run-index/detail JSON only. */
const $=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const average=a=>{const x=a.filter(finite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
const fmt=(v,n=1)=>finite(v)?v.toFixed(n):'—';
const pace=s=>finite(s)?Math.floor(s/60)+':'+String(Math.round(s%60)).padStart(2,'0')+'/mi':'—';
const METRICS={
 groundContactMs:{name:'Ground contact time',unit:'ms',dynamics:'groundContactMs',min:150,max:450},
 cadenceSpm:{name:'Cadence',unit:'spm',dynamics:'cadenceSpm',min:80,max:240},
 verticalOscillationCm:{name:'Vertical oscillation',unit:'cm',dynamics:'verticalOscillationCm',min:2,max:20},
 powerWatts:{name:'Running power',unit:'W',dynamics:'powerWatts',min:50,max:700},
 heartRate:{name:'Heart rate',unit:'bpm',hr:true,min:60,max:220}
};
const state={index:[],details:new Map(),charts:{},ready:false};
const safeTime=t=>{const n=Date.parse(t);return Number.isFinite(n)?n:null};
function showMessage(message){$('status').textContent=message}
function entries(list,key){return (Array.isArray(list)?list:[]).filter(x=>safeTime(x.time)!==null&&finite(x[key])).map(x=>({t:safeTime(x.time),v:x[key]})).sort((a,b)=>a.t-b.t)}
function closest(samples,t,tolerance=2500){
 let lo=0,hi=samples.length;
 while(lo<hi){const m=(lo+hi)>>1;if(samples[m].t<t)lo=m+1;else hi=m}
 const a=[samples[lo-1],samples[lo]].filter(Boolean).sort((x,y)=>Math.abs(x.t-t)-Math.abs(y.t-t))[0];
 return a&&Math.abs(a.t-t)<=tolerance?a.v:null
}
function records(run,metric){
 const def=METRICS[metric],start=safeTime(run.startTime);
 const source=def.hr?entries(run.heartRateSeries,'value'):entries(run.dynamicsSeries,def.dynamics);
 const distances=entries(run.paceSeries,'distanceMiles');
 const paceSeries=entries(run.paceSeries,'paceSecondsPerMile');
 const n=source.length;
 return source.map(({t,v})=>{
  const elapsed=(t-start)/60000,dist=closest(distances,t,2500),p=closest(paceSeries,t,2500);
  return {t,elapsed,dist,pace:p,value:(v>=def.min&&v<=def.max)?v:null}
 }).filter(x=>finite(x.elapsed)&&x.elapsed>=0&&x.elapsed<300);
}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function paceGroups(run,metric){
 const lines=records(run,metric).filter(x=>finite(x.value)&&finite(x.pace)&&x.pace>=330&&x.pace<=1200);
 const edges=[0,570,630,690,750,Infinity],names=['<9:30','9:30–10:30','10:30–11:30','11:30–12:30','12:30+'];
 return names.map((label,i)=>{const matches=lines.filter(x=>x.pace>=edges[i]&&x.pace<edges[i+1]);return {x:label,y:matches.length>=20?average(matches.map(x=>x.value)):null,count:matches.length}})
}
function timeGroups(run,metric,axis){
 const samples=records(run,metric).filter(x=>finite(x.value));
 const max=axis==='distance'?run.distanceMiles:run.activeSeconds/60;
 const bins=axis==='distance'?Math.max(1,Math.ceil(max*4)):Math.max(1,Math.ceil(max/2));
 return Array.from({length:Math.min(200,bins)},(_,i)=>{
  const low=i*(axis==='distance'?.25:2),high=low+(axis==='distance'?.25:2);
  const key=axis==='distance'?'dist':'elapsed';
  const vals=samples.filter(r=>finite(r[key])&&r[key]>=low&&r[key]<high);
  return {x:+((low+high)/2).toFixed(2),y:vals.length>=3?average(vals.map(r=>r.value)):null,count:vals.length}
 })
}
function buildSeries(run,metric,axis){return axis==='pace'?paceGroups(run,metric):timeGroups(run,metric,axis)}
function destroy(id){if(state.charts[id]){state.charts[id].destroy();delete state.charts[id]}}
function renderChart(id,series,axis,label){
 destroy(id);
 if(typeof Chart==='undefined'){$(id+'-note').textContent='Chart.js could not load.';return}
 const valid=series.some(s=>s.data.some(p=>finite(p.y)));
 $(id+'-note').textContent=valid?'Missing bins are gaps, never zeros. Samples are descriptive device measurements.':'No compatible recorded samples for these selections.';
 if(!valid)return;
 state.charts[id]=new Chart($(id),{
  type:'line',
  data:{datasets:series.map((s,i)=>({label:s.name,data:s.data.filter(p=>finite(p.y)).map(p=>({x:p.x,y:p.y})),borderColor:i?'#e99a47':'#4f81ed',backgroundColor:i?'#e99a47':'#4f81ed',spanGaps:false,borderWidth:2,pointRadius:axis==='pace'?4:0,tension:.18}))},
  options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{labels:{color:'#9eabc0'}},tooltip:{callbacks:{title:items=>axis==='pace'?String(items[0]?.raw?.x??''):String(items[0]?.raw?.x??'')}}},scales:{x:{type:axis==='pace'?'category':'linear',title:{display:true,text:axis==='pace'?'Pace band':axis==='time'?'Elapsed minutes':'Miles',color:'#91a1b7'},ticks:{color:'#91a1b7'},grid:{color:'rgba(150,170,190,.1)'}},y:{title:{display:true,text:label,color:'#91a1b7'},ticks:{color:'#91a1b7'},grid:{color:'rgba(150,170,190,.1)'}}}}
 });
}
async function getDetail(id){
 if(state.details.has(id))return state.details.get(id);
 const r=state.index.find(x=>x.runId===id);if(!r)return null;
 const response=await fetch('../'+r.detailFile,{cache:'no-store'});
 if(!response.ok)throw Error('Run detail unavailable: '+response.status);
 const detail=await response.json();state.details.set(id,detail);return detail
}
const optionText=r=>r.date+' · '+(r.source||'Fitbit')+' · '+fmt(r.distanceMiles,2)+' mi';
function fillSelect(id,list){$(id).replaceChildren(...list.map(r=>{let o=document.createElement('option');o.value=r.runId;o.textContent=optionText(r);return o}))}
function describe(run){if(!run)return 'No run selected';return run.date+' · '+fmt(run.distanceMiles,2)+' mi · '+pace(run.averagePaceSecondsPerMile)+' · HR '+fmt(run.averageHeartRate,0)+' bpm'}
function compatible(a,b){return a?.source==='garmin'&&b?.source==='garmin'}
function fatigue(run,metric){
 const arr=records(run,metric).filter(x=>finite(x.value)&&finite(x.pace)&&x.pace>=450&&x.pace<=900);
 const duration=run.activeSeconds/60;
 const first=arr.filter(x=>x.elapsed>=duration*.1&&x.elapsed<duration*.4);
 const last=arr.filter(x=>x.elapsed>=duration*.6&&x.elapsed<duration*.9);
 const medianPace=s=>average(s.map(x=>x.pace));
 const a=average(first.map(x=>x.value)),b=average(last.map(x=>x.value));
 return {a,b,change:finite(a)&&finite(b)?b-a:null,pace1:medianPace(first),pace2:medianPace(last),n1:first.length,n2:last.length}
}
function renderFatigue(a,b,metric){
 const def=METRICS[metric];
 const output=[['A',a],['B',b]].map(([name,run])=>{
  if(!run)return '';
  const s=fatigue(run,metric);
  const delta=finite(s.change)?(s.change>=0?'+':'')+fmt(s.change,1)+' '+def.unit:'—';
  const caveat=finite(s.pace1)&&finite(s.pace2)?' · early/late pace '+pace(s.pace1)+' / '+pace(s.pace2):'';
  return '<div class="af-stat"><b>Run '+name+': '+delta+'</b><span>Early '+fmt(s.a)+' → late '+fmt(s.b)+' '+def.unit+caveat+'</span><small>'+s.n1+' / '+s.n2+' valid samples · uses 10–40% vs 60–90% of the workout</small></div>'
 }).join('');
 $('fatigue-results').innerHTML=output||'<p>Select compatible runs.</p>';
 $('fatigue-caution').textContent='Changes across a run are not automatically fatigue. Pace, hills, accelerations, heat, and measurement artifacts can explain differences. Compare similar-effort segments.';
}
function weather(run){
 const w=run?.weather?.average||{};
 return ['Temp '+fmt(w.tempF,1)+'°F','Dewpoint '+fmt(w.dewpointF,1)+'°F','Wind '+fmt(w.windAvgMph,1)+' mph'].join(' · ')
}
function renderContext(a,b){
 $('run-context').textContent='Run A: '+describe(a)+' | '+weather(a)+'\nRun B: '+describe(b)+' | '+weather(b);
 const sourceMissing=[a,b].filter(x=>x&&x.source!=='garmin').length;
 $('quality').textContent=sourceMissing?'One or both runs predate Garmin. Heart rate may be available, but mechanical comparisons require Garmin FIT samples.':'Garmin FIT mechanics are compared at matched pace or common elapsed-time/distance axes; data gaps remain gaps. Tempest observations are home-station proxies.';
}
async function render(){
 const metric=$('metric').value,axis=$('axis').value,aid=$('run-a').value,bid=$('run-b').value;
 const seq=++render.counter;
 showMessage('Loading selected run data…');
 try{
  const [a,b]=await Promise.all([getDetail(aid),getDetail(bid)]);
  if(seq!==render.counter)return;
  const def=METRICS[metric];
  const series=[a,b].map((r,i)=>r?{name:'Run '+(i?'B':'A'),data:buildSeries(r,metric,axis)}:{name:'Missing',data:[]});
  renderChart('comparison-chart',series,axis,def.name+' ('+def.unit+')');
  renderFatigue(a,b,metric);
  renderContext(a,b);
  const makeSeries=(r,key)=>r?buildSeries(r,key,'time'):[];
  renderChart('cardiac-chart',[{name:'Run A HR',data:makeSeries(a,'heartRate')},{name:'Run B HR',data:makeSeries(b,'heartRate')}],'time','Heart rate (bpm)');
  renderChart('power-chart',[{name:'Run A power',data:makeSeries(a,'powerWatts')},{name:'Run B power',data:makeSeries(b,'powerWatts')}],'time','Running power (W)');
  showMessage('Comparing '+(a?.date||'—')+' and '+(b?.date||'—'));
 }catch(e){showMessage('Unable to load comparison: '+e.message);console.error(e)}
}
render.counter=0;
async function init(){
 try{
  const response=await fetch('../data/run-index.json',{cache:'no-store'});if(!response.ok)throw Error('Run index HTTP '+response.status);
  const index=await response.json();state.index=(index.runs||[]).filter(x=>x.detailFile);
  const garmin=state.index.filter(x=>x.source==='garmin');
  const list=garmin.length?garmin:state.index;
  fillSelect('run-a',list);fillSelect('run-b',list);
  if(list.length>1)$('run-b').selectedIndex=1;
  $('data-coverage').textContent=index.runCount+' runs indexed · '+garmin.length+' Garmin runs · refreshed '+new Date(index.generatedAt).toLocaleString();
  ['run-a','run-b','metric','axis'].forEach(id=>$(id).addEventListener('change',render));
  if(list.length)await render();else showMessage('No indexed runs found.');
 }catch(e){showMessage('Unable to initialize lab: '+e.message);console.error(e)}
}
init();
