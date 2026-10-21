import {archiveCompressed} from './mapmyrun-archive.js';
const $=s=>document.querySelector(s), fmt=x=>{let n=Math.round(x);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')}, mi=x=>Number(x).toFixed(2);
async function decode(){const bytes=Uint8Array.from(atob(archiveCompressed),c=>c.charCodeAt(0));const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));return JSON.parse(await new Response(stream).text());}
const dates=d=>d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);
let workouts=[], filtered=[],chart1=null,chart2=null;
function normalizedOld(row){let [d,m,s,id,q,flag]=row;return {date:dates('20'+d),distance:m/1000,seconds:s,pace:s/(m/1000),source:'MapMyRun',id:'mmr-'+id,quality:q==='r'?'Review':'Usable',flags:flag||'',hr:null,detail:null};}
function normalizedNew(r){let m=Number(r.distanceMiles),s=Number(r.activeSeconds);return {date:r.date,distance:m,seconds:s,pace:Number(r.averagePaceSecondsPerMile)||s/m,source:'Fitbit',id:r.runId,quality:'Usable',flags:'',hr:r.averageHeartRate,detail:r.detailFile};}
function bar(id,labels,sets,options={}){const canvas=$(id);if(!canvas||!window.Chart)return null;return new Chart(canvas,{type:'bar',data:{labels,datasets:sets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},...options}})}
const COMEBACK_START='2026-08-21';
let dailyMileageChart=null;
function renderDailyMileage(){
  const fitbit=workouts.filter(r=>r.source==='Fitbit'&&r.date>=COMEBACK_START&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.distance)&&r.distance>0);
  const perDay=new Map();
  for(const r of fitbit)perDay.set(r.date,(perDay.get(r.date)||0)+r.distance);
  // Use the latest available local run date, not the browser's timezone or an archive date.
  const end=fitbit.reduce((max,r)=>r.date>max?r.date:max,COMEBACK_START);
  const dates=[],miles=[],average=[];
  for(let time=Date.parse(COMEBACK_START+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');time<=last;time+=86400000){
    const day=new Date(time).toISOString().slice(0,10);
    dates.push(day);miles.push(perDay.get(day)||0);
    average.push(miles.length>=7?miles.slice(-7).reduce((s,x)=>s+x,0):null);
  }
  if(dailyMileageChart)dailyMileageChart.destroy();
  dailyMileageChart=new Chart($('#daily-mileage-chart'),{
    type:'bar',
    data:{labels:dates,datasets:[
      {type:'bar',label:'Daily miles',yAxisID:'y',data:miles,backgroundColor:'rgba(96,165,250,.48)',borderColor:'#60a5fa',borderWidth:1,borderRadius:3,order:2},
      {type:'line',label:'Rolling 7-day miles (mi/week)',yAxisID:'yWeek',data:average,borderColor:'#34d399',backgroundColor:'#34d399',borderWidth:3,pointRadius:0,pointHoverRadius:5,tension:.2,spanGaps:false,order:1},
      {type:'line',label:'Historical volume (~20 mi/week)',yAxisID:'yWeek',data:dates.map(()=>20),borderColor:'rgba(245,183,108,.8)',borderDash:[6,5],borderWidth:1.5,pointRadius:0,pointHoverRadius:0,order:0}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{color:'#cfe1f8'}},tooltip:{callbacks:{title:items=>items.length?items[0].label:'',label:item=>item.raw===null?'7-day average: needs 7 days':item.dataset.label+': '+Number(item.raw).toFixed(2)+' mi'}}},scales:{
      x:{ticks:{color:'#adbfda',maxTicksLimit:9,maxRotation:0,callback:function(value){const d=this.getLabelForValue(value);return d.slice(5)}},grid:{display:false}},
      y:{type:'linear',position:'left',beginAtZero:true,title:{display:true,text:'Daily miles',color:'#adbfda'},ticks:{color:'#adbfda'},grid:{color:'rgba(173,191,218,.12)'}},
      yWeek:{type:'linear',position:'right',beginAtZero:true,suggestedMax:22,title:{display:true,text:'Rolling weekly miles (mi/week)',color:'#34d399'},ticks:{color:'#34d399'},grid:{drawOnChartArea:false}}
    }}
  });
  const total=miles.reduce((a,b)=>a+b,0),last7=miles.slice(-7).reduce((a,b)=>a+b,0);
  $('#daily-mileage-summary').textContent=dates[0]+' through '+dates[dates.length-1]+' · '+fitbit.length+' runs · '+total.toFixed(2)+' mi total · '+(dates.length>=7?'Last 7 days: '+last7.toFixed(2)+' mi/week (rolling 7 days)':'Seven-day average begins Aug 27');
}
function paint(){let source=$('#source-filter').value,year=$('#year-filter').value,query=$('#search-workouts').value.trim().toLowerCase(),review=$('#include-review').checked;
filtered=workouts.filter(r=>(source==='all'||r.source===source)&&(year==='all'||r.date.startsWith(year))&&(review||r.quality==='Usable')&&(!query||[r.date,r.source,r.quality,r.flags,mi(r.distance)].join(' ').toLowerCase().includes(query)));
filtered.sort((a,b)=>b.date.localeCompare(a.date));
$('#lifetime-jog-miles').textContent=workouts.reduce((sum,r)=>sum+r.distance,0).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});$('#total-count').textContent=workouts.length;$('#filtered-count').textContent=filtered.length;$('#fitbit-count').textContent=workouts.filter(x=>x.source==='Fitbit').length;$('#mapmyrun-count').textContent=workouts.filter(x=>x.source==='MapMyRun').length;
const summary=new Map();for(const r of filtered){const y=r.date.slice(0,4);if(!summary.has(y))summary.set(y,{m:0,f:0,n:0});let t=summary.get(y);t[r.source==='Fitbit'?'f':'m']+=r.distance;t.n++;}
const labels=[...summary.keys()].sort(),m=labels.map(y=>+summary.get(y).m.toFixed(1)),f=labels.map(y=>+summary.get(y).f.toFixed(1));
if(chart1)chart1.destroy();chart1=bar('#all-mileage',labels,[{label:'MapMyRun miles',data:m,backgroundColor:'#7296f1',borderRadius:4},{label:'Fitbit miles',data:f,backgroundColor:'#34d399',borderRadius:4}],{scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true,title:{display:true,text:'Recorded miles'}}}});
const byYear=new Map();for(const r of filtered){if(r.distance<3||r.distance>8||r.quality!=='Usable')continue;const y=r.date.slice(0,4);if(!byYear.has(y)||r.pace<byYear.get(y))byYear.set(y,r.pace);}
const yy=[...byYear.keys()].sort();if(chart2)chart2.destroy();chart2=new Chart($('#fastest-pace'),{type:'line',data:{labels:yy,datasets:[{label:'Fastest recorded 3–8 mile workout pace',data:yy.map(y=>byYear.get(y)/60),borderColor:'#f5b76c',pointRadius:5,tension:.2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:x=>fmt(x.raw*60)+'/mi'}}},scales:{y:{reverse:true,title:{display:true,text:'Minutes/mile'},ticks:{callback:v=>fmt(v*60)}}}}});
const body=$('#full-workout-body');body.replaceChildren();for(const r of filtered){const tr=document.createElement('tr');let cols=[r.date,r.source,mi(r.distance)+' mi',fmt(r.seconds),fmt(r.pace)+'/mi',r.hr==null?'—':String(r.hr),r.quality+(r.flags?' · '+r.flags:'')];for(const c of cols){let td=document.createElement('td');td.textContent=c;tr.appendChild(td)}const td=document.createElement('td');if(r.source==='Fitbit'){const a=document.createElement('a');a.href='./?view=analysis&run='+encodeURIComponent(r.id);a.textContent='Analyze ↗';a.title='Open modern Fitbit analysis';td.appendChild(a)}else td.textContent='Archive';tr.appendChild(td);body.appendChild(tr);}
$('#selection-summary').textContent=filtered.length+' displayed · '+filtered.reduce((s,r)=>s+r.distance,0).toFixed(1)+' recorded miles · includes source duplicates unless excluded by review filter';
}
async function init(){try{const [old,response]=await Promise.all([decode(),fetch('../data/run-index.json?history='+Date.now(),{cache:'no-store'})]);if(!response.ok)throw Error('Fitbit feed HTTP '+response.status);const latest=await response.json();workouts=[...old.map(normalizedOld),...(latest.runs||[]).map(normalizedNew).filter(r=>Number.isFinite(r.distance)&&r.distance>0&&Number.isFinite(r.seconds)&&r.seconds>0)];const years=[...new Set(workouts.map(x=>x.date.slice(0,4)))].sort((a,b)=>b.localeCompare(a));for(let y of years){let o=document.createElement('option');o.value=y;o.textContent=y;$('#year-filter').appendChild(o)}for(let id of ['#source-filter','#year-filter','#include-review','#search-workouts'])$(id).addEventListener(id==='#search-workouts'?'input':'change',paint);$('#source-status').textContent='MapMyRun archive + live Fitbit index · last Fitbit update '+(latest.generatedAt||'unknown');renderDailyMileage();paint()}catch(e){$('#source-status').textContent='Historical data loading issue: '+e.message;console.error(e)}}
init();
