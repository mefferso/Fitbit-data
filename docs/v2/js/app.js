import {
  DataStore, number, mean, fmtDate, fmtTime, fmtDuration, fmtPace,
  fmtNumber, signed
} from './data.js';
import {Charts, rollingDrift, chartPalette} from './charts.js';

const store = new DataStore();
const charts = new Charts();

const state = {
  view:'overview',
  runId:null,
  trendDays:'90',
  historyWindow:'90',
  historyQuery:'',
  sortKey:'date',
  sortDir:-1,
  paceMode:'30',
  routeMap:null,
  driftCompare:false,
  driftOverlay1:null,
  driftOverlay2:null,
  driftBaseRunId:null
};

const titles = {
  overview:'Overview',
  analysis:'Run analysis',
  trends:'Trends',
  compare:'Compare runs',
  history:'Run history'
};

function el(id){ return document.getElementById(id); }
function all(selector){ return Array.from(document.querySelectorAll(selector)); }
function cleanNumber(value,digits){
  const n=number(value);
  return n===null?'—':n.toFixed(digits===undefined?0:digits);
}
function escapeHtml(value){
  return String(value===null||value===undefined?'':value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function generatedLabel(){
  if(!store.latest || !store.latest.generatedAt) return 'Data loaded';
  return 'Updated ' + new Date(store.latest.generatedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
function toast(message){
  const box=el('toast');
  box.textContent=message;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer=setTimeout(function(){box.classList.remove('show');},2200);
}

function setTheme(theme,rerender){
  document.documentElement.dataset.theme=theme;
  localStorage.setItem('performance-lab-theme',theme);
  const label=theme==='dark'?'Light mode':'Dark mode';
  el('theme-label').textContent=label;
  if(rerender && store.index){
    renderOverviewCharts();
    if(state.view==='trends') renderTrends();
    if(state.view==='analysis' && state.runId) renderAnalysis(state.runId,false);
    if(state.view==='compare') renderCompare();
  }
}
function initTheme(){
  const saved=localStorage.getItem('performance-lab-theme');
  const theme=saved || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  setTheme(theme,false);
}
function toggleTheme(){
  setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark',true);
}

function switchView(view,updateUrl){
  if(!titles[view]) view='overview';
  state.view=view;
  all('[data-view-panel]').forEach(function(panel){panel.classList.toggle('active',panel.dataset.viewPanel===view);});
  all('.nav-item').forEach(function(btn){btn.classList.toggle('active',btn.dataset.view===view);});
  el('page-title').textContent=titles[view];
  el('sidebar').classList.remove('open');
  if(updateUrl!==false){
    const url=new URL(location.href);
    url.searchParams.set('view',view);
    if(view!=='analysis') url.searchParams.delete('run');
    history.replaceState({},'',url);
  }
  if(view==='trends') renderTrends();
  if(view==='history') renderHistory();
  if(view==='compare') renderCompare();
}

function setupNavigation(){
  all('.nav-item').forEach(function(btn){btn.addEventListener('click',function(){switchView(btn.dataset.view,true);});});
  all('[data-jump]').forEach(function(btn){btn.addEventListener('click',function(){switchView(btn.dataset.jump,true);});});
  el('mobile-menu').addEventListener('click',function(){el('sidebar').classList.toggle('open');});
  el('theme-toggle').addEventListener('click',toggleTheme);
  el('mobile-theme').addEventListener('click',toggleTheme);
}

function summaryForRun(run){
  return store.findRun(run && run.runId) || run;
}
function olderRuns(run,days){
  const current=new Date(run.date+'T12:00:00Z');
  const cutoff=new Date(current.getTime()-days*86400000);
  return store.runs.filter(function(r){
    const d=new Date(r.date+'T12:00:00Z');
    return d<current && d>=cutoff;
  });
}
function bests(){
  const runs=store.runs;
  const valid=function(key){return runs.filter(function(r){return number(r[key])!==null;});};
  return {
    pace:Math.min.apply(null,valid('averagePaceSecondsPerMile').map(function(r){return Number(r.averagePaceSecondsPerMile);})),
    api:Math.max.apply(null,valid('adjustedPerformanceIndex').map(function(r){return Number(r.adjustedPerformanceIndex);})),
    distance:Math.max.apply(null,valid('distanceMiles').map(function(r){return Number(r.distanceMiles);})),
    hrr1:Math.max.apply(null,valid('hrr1').map(function(r){return Number(r.hrr1);})),
    drift:Math.min.apply(null,valid('cardioDriftPercent').map(function(r){return Number(r.cardioDriftPercent);}))
  };
}
function isClose(a,b,tolerance){
  return number(a)!==null && number(b)!==null && Math.abs(Number(a)-Number(b)) <= (tolerance||.01);
}
function deltaText(current,previous,metric){
  const a=number(current),b=number(previous);
  if(a===null||b===null) return {text:'No prior comparison',className:''};
  const d=a-b;
  let good=null;
  if(metric==='pace'||metric==='drift'||metric==='hr') good=d<0;
  if(metric==='api'||metric==='hrr'||metric==='distance') good=d>0;
  const suffix=metric==='pace'?' sec/mi':metric==='hr'||metric==='hrr'?' bpm':metric==='drift'?' pp':metric==='distance'?' mi':'';
  return {text:(d>0?'+':'')+d.toFixed(metric==='distance'?2:metric==='api'||metric==='drift'?1:0)+suffix+' vs prior',className:good===null?'':good?'good':'bad'};
}
function latestIndexRun(){
  return store.runs[0] || null;
}

function renderOverview(){
  const run=store.latestRun;
  const summary=latestIndexRun();
  if(!run||!summary) return;
  const prev=store.runs[1]||{};
  el('overview-run-title').textContent=fmtDate(run.date);
  el('overview-run-meta').textContent=fmtTime(run.startTime)+' · '+fmtDuration(run.activeSeconds)+' · Heat index '+cleanNumber(run.weather&&run.weather.average&&run.weather.average.heatIndexF,0)+'°F';
  el('overview-hero-metrics').innerHTML=[
    heroMetric('Distance',cleanNumber(run.distanceMiles,2)+' mi',deltaText(run.distanceMiles,prev.distanceMiles,'distance')),
    heroMetric('Pace',fmtPace(run.averagePaceSecondsPerMile),deltaText(run.averagePaceSecondsPerMile,prev.averagePaceSecondsPerMile,'pace')),
    heroMetric('Avg HR',cleanNumber(run.averageHeartRate,0)+' bpm',deltaText(run.averageHeartRate,prev.averageHeartRate,'hr')),
    heroMetric('Drift',signed(run.aerobicDecoupling&&run.aerobicDecoupling.percent,1,'%'),deltaText(run.aerobicDecoupling&&run.aerobicDecoupling.percent,prev.cardioDriftPercent,'drift'))
  ].join('');

  const api=number(summary.adjustedPerformanceIndex);
  el('overview-api').textContent=api===null?'—':api.toFixed(1);
  const apiDelta=deltaText(api,prev.adjustedPerformanceIndex,'api');
  el('overview-api-context').textContent=api===null?'Needs a qualifying run with weather, pace and HR.':apiDelta.text+' · 100 = baseline';
  renderWeek();
  el('overview-insights').innerHTML=makeInsights(summary,false).map(insightCard).join('');
  renderOverviewRecent();
  renderOverviewCharts();
}
function heroMetric(label,value,delta){
  return '<div class="hero-metric"><div class="metric-label">'+escapeHtml(label)+'</div><div class="hero-metric-value">'+escapeHtml(value)+'</div><div class="hero-metric-note '+escapeHtml(delta.className)+'">'+escapeHtml(delta.text)+'</div></div>';
}
function renderWeek(){
  const newest=store.runs[0];
  if(!newest)return;
  const end=new Date(newest.date+'T23:59:59Z'),start=new Date(end.getTime()-6*86400000);
  const week=store.runs.filter(function(r){const d=new Date(r.date+'T12:00:00Z');return d>=start&&d<=end;});
  const miles=week.reduce(function(sum,r){return sum+(number(r.distanceMiles)||0);},0);
  const seconds=week.reduce(function(sum,r){return sum+(number(r.activeSeconds)||0);},0);
  const api=mean(week.map(function(r){return r.adjustedPerformanceIndex;}));
  const load=week.reduce(function(sum,r){return sum+(number(r.trainingLoad)||0);},0);
  el('week-grid').innerHTML=[
    ['Runs',week.length],
    ['Distance',miles.toFixed(1)+' mi'],
    ['Time',Math.round(seconds/60)+' min'],
    ['Training load',load.toFixed(0)]
  ].map(function(item){return '<div class="week-stat"><div class="week-value">'+item[1]+'</div><div class="week-label">'+item[0]+'</div></div>';}).join('');
  el('week-footer').textContent=api===null?'No qualifying adjusted-performance scores this week.':'Average adjusted performance '+api.toFixed(1)+'. '+(api>=110?'A strong week relative to your baseline.':api>=100?'Above baseline overall.':'Below your current baseline overall.');
}
function renderOverviewRecent(){
  el('overview-recent-runs').innerHTML=store.runs.slice(0,6).map(function(r){
    return '<div class="recent-row" data-run="'+escapeHtml(r.runId)+'">'+
      '<div><div class="recent-date">'+fmtDate(r.date)+'</div><div class="recent-secondary">'+fmtTime(r.startTime)+'</div></div>'+
      '<div><div class="recent-primary">'+cleanNumber(r.distanceMiles,2)+' mi</div><div class="recent-secondary">distance</div></div>'+
      '<div><div class="recent-primary">'+fmtPace(r.averagePaceSecondsPerMile)+'</div><div class="recent-secondary">pace</div></div>'+
      '<div class="hide-mobile"><div class="recent-primary">'+cleanNumber(r.averageHeartRate,0)+' bpm</div><div class="recent-secondary">avg HR</div></div>'+
      '<div class="hide-tablet"><div class="recent-primary">'+(number(r.adjustedPerformanceIndex)===null?'—':Number(r.adjustedPerformanceIndex).toFixed(1))+'</div><div class="recent-secondary">adj. perf.</div></div>'+
      '<div>›</div></div>';
  }).join('');
  all('#overview-recent-runs [data-run]').forEach(function(row){
    row.addEventListener('click',function(){
      const run=store.findRun(row.dataset.run);
      if(run&&run.detailFile) openAnalysis(run.runId);
      else toast('Detailed trace is not available for that older run.');
    });
  });
}
function renderOverviewCharts(){
  const weather=(store.trends.runningTrend&&store.trends.runningTrend.weatherAdjusted&&store.trends.runningTrend.weatherAdjusted.runs)||[];
  charts.performance(el('overview-performance-chart'),weather.slice(-14),'overviewPerformance');
  charts.trainingLoad(el('overview-load-chart'),(store.trends.trainingLoad&&store.trends.trainingLoad.points)||[],'overviewLoad');
}

function makeInsights(run,detailed){
  const history=olderRuns(run,28);
  const cards=[];
  const api=number(run.adjustedPerformanceIndex!==undefined?run.adjustedPerformanceIndex:run.weatherAdjustedEfficiency&&run.weatherAdjustedEfficiency.score);
  const apiAvg=mean(history.map(function(r){return r.adjustedPerformanceIndex;}));
  if(api!==null){
    const diff=apiAvg===null?null:api-apiAvg;
    cards.push({
      title:'Adjusted performance',
      body:diff===null?'This run scored '+api.toFixed(1)+' against your current 100 baseline.':'Score '+api.toFixed(1)+' is '+Math.abs(diff).toFixed(1)+' points '+(diff>=0?'above':'below')+' your prior 4-week average.',
      tone:diff===null?'info':diff>=0?'good':'warn',icon:diff===null?'◎':diff>=0?'↗':'↘'
    });
  }
  const drift=number(run.cardioDriftPercent!==undefined?run.cardioDriftPercent:run.aerobicDecoupling&&run.aerobicDecoupling.percent);
  const driftAvg=mean(history.map(function(r){return r.cardioDriftPercent;}));
  if(drift!==null){
    const diff=driftAvg===null?null:drift-driftAvg;
    cards.push({
      title:'Cardio drift',
      body:diff===null?'Whole-run drift was '+drift.toFixed(1)+'%. Lower is generally better when pace and conditions are comparable.':drift.toFixed(1)+'% drift is '+Math.abs(diff).toFixed(1)+' pp '+(diff<=0?'better':'higher')+' than your prior 4-week average.',
      tone:diff===null?'info':diff<=0?'good':'warn',icon:diff!==null&&diff<=0?'↓':'≈'
    });
  }
  const hrr=number(run.hrr1!==undefined?run.hrr1:run.heartRateRecovery&&run.heartRateRecovery.minute1Drop);
  const hrrAvg=mean(history.map(function(r){return r.hrr1;}));
  if(hrr!==null){
    const diff=hrrAvg===null?null:hrr-hrrAvg;
    cards.push({
      title:'1-minute recovery',
      body:diff===null?'HRR1 was '+hrr.toFixed(0)+' bpm. Compare this mostly against runs with a similar cooldown.':hrr.toFixed(0)+' bpm is '+Math.abs(diff).toFixed(1)+' bpm '+(diff>=0?'faster':'slower')+' than your prior 4-week average.',
      tone:diff===null?'info':diff>=0?'good':'warn',icon:'♥'
    });
  }
  const hi=number(run.heatIndexF!==undefined?run.heatIndexF:run.weather&&run.weather.average&&run.weather.average.heatIndexF);
  if(hi!==null && hi>=90){
    cards.push({title:'Heat burden',body:'Average heat index was '+hi.toFixed(0)+'°F. The adjusted-performance model accounts for heat and solar load before comparing efficiency.',tone:'warn',icon:'☀'});
  }
  if(detailed && run.analysisSummary && number(run.analysisSummary.heartRateSlopeBpmPerMinute)!==null){
    const slope=Number(run.analysisSummary.heartRateSlopeBpmPerMinute);
    cards.push({title:'HR progression',body:'Heart rate trend was '+signed(slope,2,' bpm/min')+' across the workout. This helps separate steady effort from late-run cardiovascular creep.',tone:Math.abs(slope)<.3?'good':'info',icon:'⌁'});
  }
  return cards.slice(0,detailed?6:3);
}
function insightCard(card){
  return '<article class="insight-card '+escapeHtml(card.tone||'info')+'"><div class="insight-top"><div class="insight-title">'+escapeHtml(card.title)+'</div><div class="insight-icon">'+escapeHtml(card.icon||'•')+'</div></div><div class="insight-body">'+escapeHtml(card.body)+'</div></article>';
}

function populateRunSelectors(){
  const options=store.detailedRuns.map(function(r){return '<option value="'+escapeHtml(r.runId)+'">'+fmtDate(r.date)+' · '+cleanNumber(r.distanceMiles,2)+' mi · '+fmtPace(r.averagePaceSecondsPerMile)+'</option>';}).join('');
  ['analysis-run-select','compare-a','compare-b'].forEach(function(id){el(id).innerHTML=options;});
  if(store.detailedRuns[0]) el('compare-a').value=store.detailedRuns[0].runId;
  if(store.detailedRuns[1]) el('compare-b').value=store.detailedRuns[1].runId;
}

async function openAnalysis(runId){
  state.runId=runId;
  switchView('analysis',false);
  el('analysis-run-select').value=runId;
  const url=new URL(location.href);
  url.searchParams.set('view','analysis');
  url.searchParams.set('run',runId);
  history.replaceState({},'',url);
  await renderAnalysis(runId,true);
}
async function renderAnalysis(runId,scrollTop){
  const summary=store.findRun(runId);
  if(!summary)return;
  state.runId=runId;
  try{
    const run=await store.loadRun(summary);
    const prev=store.findPrevious(runId)||{};
    el('analysis-title').textContent=fmtDate(run.date)+' · '+cleanNumber(run.distanceMiles,2)+' miles';
    const wx=run.weather&&run.weather.average;
    el('analysis-meta').textContent=fmtTime(run.startTime)+' · '+fmtDuration(run.activeSeconds)+' · '+fmtPace(run.averagePaceSecondsPerMile)+(wx?' · HI '+cleanNumber(wx.heatIndexF,0)+'°F':'');
    renderBadges(summary);
    renderAnalysisMetrics(run,summary,prev);
    renderConditions(run);
    renderRoute(run);
    renderZones(run);
    renderRecovery(run);
    renderRunCharts(run);
    configureDriftControls(runId);
    await renderDrift(run);
    el('analysis-insights').innerHTML=makeInsights(Object.assign({},summary,run),true).map(insightCard).join('');
    if(scrollTop) window.scrollTo({top:0,behavior:'smooth'});
  }catch(error){
    toast(error.message||String(error));
  }
}
function renderBadges(run){
  const pb=bests(),badges=[];
  if(isClose(run.averagePaceSecondsPerMile,pb.pace,.5)) badges.push('<span class="badge pb">Fastest pace</span>');
  if(isClose(run.adjustedPerformanceIndex,pb.api,.05)) badges.push('<span class="badge pb">Best adjusted performance</span>');
  if(isClose(run.distanceMiles,pb.distance,.01)) badges.push('<span class="badge pb">Longest run</span>');
  if(isClose(run.hrr1,pb.hrr1,.05)) badges.push('<span class="badge pb">Best HRR1</span>');
  if(isClose(run.cardioDriftPercent,pb.drift,.05)) badges.push('<span class="badge good">Lowest drift</span>');
  if(!badges.length) badges.push('<span class="badge">Detailed workout</span>');
  el('analysis-badges').innerHTML=badges.join('');
}
function renderAnalysisMetrics(run,summary,prev){
  const api=number(summary.adjustedPerformanceIndex);
  const metrics=[
    ['Distance',cleanNumber(run.distanceMiles,2)+' mi',deltaText(run.distanceMiles,prev.distanceMiles,'distance')],
    ['Pace',fmtPace(run.averagePaceSecondsPerMile),deltaText(run.averagePaceSecondsPerMile,prev.averagePaceSecondsPerMile,'pace')],
    ['Average HR',cleanNumber(run.averageHeartRate,0)+' bpm',deltaText(run.averageHeartRate,prev.averageHeartRate,'hr')],
    ['Adj. performance',api===null?'—':api.toFixed(1),deltaText(api,prev.adjustedPerformanceIndex,'api')],
    ['Cardio drift',signed(run.aerobicDecoupling&&run.aerobicDecoupling.percent,1,'%'),deltaText(run.aerobicDecoupling&&run.aerobicDecoupling.percent,prev.cardioDriftPercent,'drift')],
    ['Training load',cleanNumber(run.trainingLoad,0),{text:cleanNumber(run.vigorousPlusPeakMinutes,0)+' hard-effort min',className:''}]
  ];
  el('analysis-metrics').innerHTML=metrics.map(function(m){
    return '<div class="metric-card"><div class="metric-label">'+m[0]+'</div><div class="metric-value">'+m[1]+'</div><div class="metric-delta '+m[2].className+'">'+m[2].text+'</div></div>';
  }).join('');
}
function renderConditions(run){
  const wx=run.weather&&run.weather.average||{};
  const max=run.weather&&run.weather.maximum||{};
  const items=[
    ['Temperature',cleanNumber(wx.tempF,1)+'°F'],
    ['Heat index',cleanNumber(wx.heatIndexF,1)+'°F'],
    ['Dewpoint',cleanNumber(wx.dewpointF,1)+'°F'],
    ['Solar',cleanNumber(wx.solarRadiationWm2,0)+' W/m²'],
    ['Wind',cleanNumber(wx.windAvgMph,1)+' mph'],
    ['Max gust',cleanNumber(max.windGustMph,1)+' mph']
  ];
  el('conditions-grid').innerHTML=items.map(function(x){return '<div class="condition"><div class="metric-label">'+x[0]+'</div><div class="condition-value">'+x[1]+'</div></div>';}).join('');
  const adj=run.weatherAdjustedEfficiency;
  el('weather-burden').textContent=adj?'Weather factor '+cleanNumber(adj.weatherFactor,3)+' · heat penalty '+cleanNumber(adj.heatPenaltyPct,1)+'% · solar penalty '+cleanNumber(adj.solarPenaltyPct,1)+'%.':'Weather-adjustment inputs are unavailable for this run.';
}
function renderZones(run){
  el('analysis-zones').innerHTML=(run.zoneSummary||[]).map(function(z){
    return '<div class="zone-row"><div class="zone-label">'+escapeHtml(z.label)+'</div><div class="zone-track" aria-label="'+escapeHtml(z.label)+' '+cleanNumber(z.percent,0)+' percent"><div class="zone-fill '+escapeHtml(z.key)+'" style="width:'+Math.min(100,Number(z.percent)||0)+'%"></div></div><div class="zone-value">'+cleanNumber(z.minutes,0)+'m · '+cleanNumber(z.percent,0)+'%</div></div>';
  }).join('');
}
function renderRecovery(run){
  const h=run.heartRateRecovery||{};
  const items=[['1 min',h.minute1Drop],['2 min',h.minute2Drop],['3 min',h.minute3Drop]];
  el('recovery-grid').innerHTML=items.map(function(x){return '<div class="recovery-item"><div class="recovery-value">'+(number(x[1])===null?'—':Math.round(Number(x[1])))+'</div><div class="recovery-label">'+x[0]+' bpm drop</div></div>';}).join('');
}
function renderRunCharts(run){
  charts.runStack(el('run-hr-chart'),el('run-pace-chart'),run,state.paceMode);
  charts.bindSynchronizedPointer(el('run-stack'));
  el('hr-summary').textContent='Avg '+cleanNumber(run.averageHeartRate,0)+' · peak '+cleanNumber(run.peakHeartRate,0)+' bpm';
  el('pace-summary').textContent='Avg '+fmtPace(run.averagePaceSecondsPerMile)+' · '+(run.paceSeriesSource==='tcx'?'TCX':'distance rollup');
}
function previousDetailedRun(runId){
  const runs=store.detailedRuns;
  const index=runs.findIndex(function(r){return r.runId===runId;});
  if(index>=0 && index+1<runs.length) return runs[index+1];
  return index>0 ? runs[index-1] : null;
}
function driftRunLabel(run,isPrevious){
  return (isPrevious?'Previous · ':'')+fmtDate(run.date)+' · '+cleanNumber(run.distanceMiles,2)+' mi · '+fmtPace(run.averagePaceSecondsPerMile);
}
function configureDriftControls(runId){
  const changed=state.driftBaseRunId!==runId;
  const current=store.findRun(runId);
  const choices=store.detailedRuns.filter(function(r){return r.runId!==runId;});
  const previous=previousDetailedRun(runId);

  if(changed){
    state.driftBaseRunId=runId;
    state.driftOverlay1=previous ? previous.runId : (choices[0]&&choices[0].runId)||null;
    state.driftOverlay2=null;
  }

  if(state.driftOverlay1===runId || !choices.some(function(r){return r.runId===state.driftOverlay1;})){
    state.driftOverlay1=previous ? previous.runId : (choices[0]&&choices[0].runId)||null;
  }
  if(state.driftOverlay2===runId || state.driftOverlay2===state.driftOverlay1 || !choices.some(function(r){return r.runId===state.driftOverlay2;})){
    state.driftOverlay2=null;
  }

  const firstOptions=choices.map(function(r){
    return '<option value="'+escapeHtml(r.runId)+'">'+escapeHtml(driftRunLabel(r,Boolean(previous&&previous.runId===r.runId)))+'</option>';
  }).join('');
  const secondChoices=choices.filter(function(r){return r.runId!==state.driftOverlay1;});
  const secondOptions='<option value="">None</option>'+secondChoices.map(function(r){
    return '<option value="'+escapeHtml(r.runId)+'">'+escapeHtml(fmtDate(r.date)+' · '+cleanNumber(r.distanceMiles,2)+' mi · '+fmtPace(r.averagePaceSecondsPerMile))+'</option>';
  }).join('');

  el('drift-overlay-1').innerHTML=firstOptions;
  el('drift-overlay-2').innerHTML=secondOptions;
  if(state.driftOverlay1) el('drift-overlay-1').value=state.driftOverlay1;
  el('drift-overlay-2').value=state.driftOverlay2||'';
  el('drift-compare-toggle').checked=state.driftCompare;
  el('drift-overlay-selects').hidden=!state.driftCompare;

  if(!choices.length){
    state.driftCompare=false;
    el('drift-compare-toggle').checked=false;
    el('drift-compare-toggle').disabled=true;
    el('drift-overlay-selects').hidden=true;
  }else{
    el('drift-compare-toggle').disabled=false;
  }
}
async function renderDrift(run){
  const result=rollingDrift(run);
  const series=[{label:fmtDate(run.date)+' · current',result:result,current:true}];

  if(state.driftCompare){
    const ids=[state.driftOverlay1,state.driftOverlay2].filter(function(id,index,array){
      return Boolean(id)&&id!==state.runId&&array.indexOf(id)===index;
    });
    const overlays=await Promise.all(ids.map(async function(id){
      try{
        const overlayRun=await store.loadRun(id);
        return {run:overlayRun,result:rollingDrift(overlayRun)};
      }catch{
        return null;
      }
    }));
    overlays.filter(Boolean).forEach(function(item){
      series.push({
        label:fmtDate(item.run.date),
        result:item.result,
        current:false
      });
    });
  }

  charts.drift(el('drift-chart'),series);
  const overall=number(run.aerobicDecoupling&&run.aerobicDecoupling.percent);
  const pills=[
    'Whole run '+(overall===null?'—':signed(overall,1,'%')),
    'Late rolling '+(result? signed(result.late,1,'%'):'—'),
    'Peak rolling '+(result? signed(result.peak,1,'%'):'—')
  ];
  el('drift-summary').innerHTML=pills.map(function(x){return '<span class="drift-pill">'+x+'</span>';}).join('');

  if(!result || !result.points.length){
    el('drift-note').textContent='Rolling drift needs at least 15 minutes plus usable heart-rate and pace data.';
  }else if(state.driftCompare && series.length>1){
    el('drift-note').textContent='Each run is normalized to its own minutes 5–10 baseline, so the overlay compares drift shape and magnitude rather than raw pace or heart rate. Hover a line for its 5-minute average HR and pace.';
  }else{
    el('drift-note').textContent='Baseline is minutes 5–10 to avoid startup noise. Turn on Compare drift to overlay previous or older runs.';
  }
}
async function rerenderCurrentDrift(){
  if(!state.runId)return;
  try{
    const run=await store.loadRun(state.runId);
    await renderDrift(run);
  }catch(error){
    toast(error.message||String(error));
  }
}
function renderRoute(run){
  const route=run.route&&Array.isArray(run.route.points)?run.route.points:[];
  const mapEl=el('route-map'),placeholder=el('route-placeholder');
  if(state.routeMap){state.routeMap.remove();state.routeMap=null;}
  mapEl.classList.remove('relative-map');

  if(route.length<2 || !window.L){
    mapEl.hidden=true;placeholder.hidden=false;
    el('route-status').textContent=run.hasGps?'GPS private':'No GPS';
    return;
  }

  const colors={peak:'#cf4e65',vigorous:'#cf861f',moderate:'#5279df',light:'#2395a0',below:'#8793a3'};
  const patterns={peak:'2 6',vigorous:'10 5',moderate:null,light:'5 5',below:'1 6'};

  if(run.route.kind==='relative'){
    const pts=route.map(function(p){return [Number(p.y),Number(p.x),p.zoneKey||'below'];})
      .filter(function(p){return Number.isFinite(p[0])&&Number.isFinite(p[1]);});
    if(pts.length<2){mapEl.hidden=true;placeholder.hidden=false;return;}

    mapEl.hidden=false;placeholder.hidden=true;mapEl.classList.add('relative-map');
    el('route-status').textContent='Privacy-safe shape';
    const map=L.map(mapEl,{crs:L.CRS.Simple,zoomControl:true,attributionControl:false,minZoom:-5});
    for(let i=1;i<pts.length;i++){
      const zone=pts[i][2]||'below';
      L.polyline([[pts[i-1][0],pts[i-1][1]],[pts[i][0],pts[i][1]]],{
        color:colors[zone]||chartPalette().primary,
        weight:5,
        opacity:.92,
        dashArray:patterns[zone]||null,
        lineCap:'round'
      }).addTo(map);
    }
    L.circleMarker([pts[0][0],pts[0][1]],{radius:6,color:chartPalette().positive,fillColor:chartPalette().positive,fillOpacity:1,weight:2})
      .bindTooltip('Start').addTo(map);
    const last=pts[pts.length-1];
    L.circleMarker([last[0],last[1]],{radius:6,color:chartPalette().negative,fillColor:chartPalette().negative,fillOpacity:1,weight:2})
      .bindTooltip('Finish').addTo(map);
    const bounds=pts.map(function(p){return [p[0],p[1]];});
    state.routeMap=map;
    const fitRoute=function(){
      map.invalidateSize({pan:false});
      map.fitBounds(bounds,{padding:[10,10]});
    };
    requestAnimationFrame(function(){requestAnimationFrame(fitRoute);});
    setTimeout(fitRoute,140);
    return;
  }

  const pts=route.map(function(p){return [Number(p.lat),Number(p.lon!==undefined?p.lon:p.lng),p.zoneKey||'below'];})
    .filter(function(p){return Number.isFinite(p[0])&&Number.isFinite(p[1]);});
  if(pts.length<2){mapEl.hidden=true;placeholder.hidden=false;return;}
  mapEl.hidden=false;placeholder.hidden=true;
  el('route-status').textContent='Mapped route';
  const map=L.map(mapEl,{zoomControl:true,attributionControl:true});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
  for(let i=1;i<pts.length;i++){
    const zone=pts[i][2]||'below';
    L.polyline([[pts[i-1][0],pts[i-1][1]],[pts[i][0],pts[i][1]]],{
      color:colors[zone]||chartPalette().primary,weight:5,opacity:.9,dashArray:patterns[zone]||null
    }).addTo(map);
  }
  const bounds=pts.map(function(p){return [p[0],p[1]];});
  state.routeMap=map;
  const fitRoute=function(){
    map.invalidateSize({pan:false});
    map.fitBounds(bounds,{padding:[10,10]});
  };
  requestAnimationFrame(function(){requestAnimationFrame(fitRoute);});
  setTimeout(fitRoute,140);
}

function renderTrends(){
  if(!store.index)return;
  const runs=store.filterRuns(state.trendDays).slice().reverse();
  const api=runs.filter(function(r){return number(r.adjustedPerformanceIndex)!==null;});
  charts.metricTrend('trendApi',el('trend-api-chart'),api,'adjustedPerformanceIndex',{color:chartPalette().primary,title:'Index',min:90,max:125});
  charts.metricTrend('trendHrr',el('trend-hrr-chart'),runs.filter(function(r){return number(r.hrr1)!==null;}),'hrr1',{color:chartPalette().positive,title:'bpm'});
  charts.metricTrend('trendDrift',el('trend-drift-chart'),runs.filter(function(r){return number(r.cardioDriftPercent)!==null;}),'cardioDriftPercent',{color:chartPalette().warning,title:'%',tooltip:function(ctx){return 'Drift: '+Number(ctx.raw).toFixed(1)+'%';}});
  charts.metricTrend('trendPace',el('trend-pace-chart'),runs.filter(function(r){return number(r.averagePaceSecondsPerMile)!==null;}),'averagePaceSecondsPerMile',{color:chartPalette().violet,title:'min/mi',reverse:true,tick:function(v){return fmtPace(v).replace('/mi','');},tooltip:function(ctx){return 'Pace: '+fmtPace(ctx.raw);}});
  const loadPoints=(store.trends.trainingLoad&&store.trends.trainingLoad.points)||[];
  let loads=loadPoints;
  if(state.trendDays!=='all'&&runs.length){
    const firstDate=runs[0].date;
    loads=loadPoints.filter(function(p){return p.date>=firstDate;});
  }
  charts.trainingLoad(el('trend-load-chart'),loads,'trendLoad');
}

async function renderCompare(){
  if(!store.index)return;
  const idA=el('compare-a').value,idB=el('compare-b').value;
  if(!idA||!idB)return;
  try{
    const pair=await Promise.all([store.loadRun(idA),store.loadRun(idB)]);
    const a=pair[0],b=pair[1],sa=store.findRun(idA)||a,sb=store.findRun(idB)||b;
    const metrics=[
      ['Distance',a.distanceMiles,b.distanceMiles,function(v){return cleanNumber(v,2)+' mi';},false],
      ['Pace',a.averagePaceSecondsPerMile,b.averagePaceSecondsPerMile,fmtPace,true],
      ['Avg HR',a.averageHeartRate,b.averageHeartRate,function(v){return cleanNumber(v,0)+' bpm';},true],
      ['Adj. perf.',sa.adjustedPerformanceIndex,sb.adjustedPerformanceIndex,function(v){return number(v)===null?'—':Number(v).toFixed(1);},false],
      ['Drift',a.aerobicDecoupling&&a.aerobicDecoupling.percent,b.aerobicDecoupling&&b.aerobicDecoupling.percent,function(v){return number(v)===null?'—':Number(v).toFixed(1)+'%';},true],
      ['HRR1',a.heartRateRecovery&&a.heartRateRecovery.minute1Drop,b.heartRateRecovery&&b.heartRateRecovery.minute1Drop,function(v){return number(v)===null?'—':Number(v).toFixed(0)+' bpm';},false]
    ];
    el('comparison-deltas').innerHTML=metrics.map(function(m){
      const av=number(m[1]),bv=number(m[2]),diff=av===null||bv===null?null:av-bv;
      const good=diff===null?null:m[4]?diff<0:diff>0;
      return '<div class="compare-delta"><div class="metric-label">'+m[0]+'</div><div class="compare-values"><strong>'+m[3](m[1])+'</strong><strong>'+m[3](m[2])+'</strong></div><div class="compare-arrow '+(good===null?'':good?'good':'bad')+'">'+(diff===null?'No delta':(diff>0?'+':'')+diff.toFixed(m[0]==='Distance'?2:1)+' A−B')+'</div></div>';
    }).join('');
    charts.compare(el('compare-hr-chart'),pair,'hr','compareHr');
    charts.compare(el('compare-pace-chart'),pair,'pace','comparePace');
    el('compare-insights').innerHTML=compareInsights(a,b,sa,sb).map(insightCard).join('');
  }catch(error){toast(error.message||String(error));}
}
function compareInsights(a,b,sa,sb){
  const cards=[];
  const apiA=number(sa.adjustedPerformanceIndex),apiB=number(sb.adjustedPerformanceIndex);
  if(apiA!==null&&apiB!==null){
    const d=apiA-apiB;
    cards.push({title:'Weather-adjusted performance',body:fmtDate(a.date)+' scored '+Math.abs(d).toFixed(1)+' points '+(d>=0?'higher':'lower')+' than '+fmtDate(b.date)+'.',tone:d>=0?'good':'warn',icon:'◎'});
  }
  const paceA=number(a.averagePaceSecondsPerMile),paceB=number(b.averagePaceSecondsPerMile),hrA=number(a.averageHeartRate),hrB=number(b.averageHeartRate);
  if(paceA!==null&&paceB!==null&&hrA!==null&&hrB!==null){
    cards.push({title:'Effort tradeoff',body:fmtDate(a.date)+' was '+Math.abs(paceA-paceB).toFixed(0)+' sec/mi '+(paceA<paceB?'faster':'slower')+' with average HR '+Math.abs(hrA-hrB).toFixed(0)+' bpm '+(hrA<hrB?'lower':'higher')+'.',tone:paceA<paceB&&hrA<=hrB?'good':'info',icon:'⇄'});
  }
  const hiA=number(a.weather&&a.weather.average&&a.weather.average.heatIndexF),hiB=number(b.weather&&b.weather.average&&b.weather.average.heatIndexF);
  if(hiA!==null&&hiB!==null){
    cards.push({title:'Conditions',body:'Heat index differed by '+Math.abs(hiA-hiB).toFixed(1)+'°F between these runs, which is why raw pace alone can be misleading.',tone:'info',icon:'☀'});
  }
  return cards;
}

function renderHistory(){
  if(!store.index)return;
  state.historyWindow=el('history-window').value;
  state.historyQuery=el('history-search').value.trim().toLowerCase();
  let runs=store.filterRuns(state.historyWindow);
  if(state.historyQuery){
    runs=runs.filter(function(r){
      const hay=[r.date,fmtDate(r.date),cleanNumber(r.distanceMiles,2),fmtPace(r.averagePaceSecondsPerMile),cleanNumber(r.adjustedPerformanceIndex,1)].join(' ').toLowerCase();
      return hay.includes(state.historyQuery);
    });
  }
  runs.sort(function(a,b){
    let av=a[state.sortKey],bv=b[state.sortKey];
    if(state.sortKey==='date'){av=new Date(a.date).getTime();bv=new Date(b.date).getTime();}
    av=number(av)!==null?Number(av):av||'';bv=number(bv)!==null?Number(bv):bv||'';
    if(av===bv)return 0;
    return (av>bv?1:-1)*state.sortDir;
  });
  el('history-count').textContent=runs.length+' of '+store.runs.length+' runs';
  el('history-body').innerHTML=runs.map(function(r){
    return '<tr data-run="'+escapeHtml(r.runId)+'" class="'+(r.detailFile?'':'no-detail')+'">'+
      '<td><strong>'+fmtDate(r.date)+'</strong></td>'+
      '<td>'+cleanNumber(r.distanceMiles,2)+' mi</td>'+
      '<td>'+fmtPace(r.averagePaceSecondsPerMile)+'</td>'+
      '<td>'+cleanNumber(r.averageHeartRate,0)+' bpm</td>'+
      '<td>'+(number(r.heatIndexF)===null?'—':cleanNumber(r.heatIndexF,0)+'°F')+'</td>'+
      '<td class="api-cell">'+(number(r.adjustedPerformanceIndex)===null?'—':Number(r.adjustedPerformanceIndex).toFixed(1))+'</td>'+
      '<td>'+(number(r.cardioDriftPercent)===null?'—':cleanNumber(r.cardioDriftPercent,1)+'%')+'</td>'+
      '<td>'+(number(r.hrr1)===null?'—':cleanNumber(r.hrr1,0)+' bpm')+'</td>'+
      '<td>'+sparkline(r.runId)+'</td></tr>';
  }).join('');
  all('#history-body tr').forEach(function(row){
    row.addEventListener('click',function(){
      const run=store.findRun(row.dataset.run);
      if(run&&run.detailFile) openAnalysis(run.runId);
      else toast('Summary data exists, but the high-resolution trace was not archived for this older run.');
    });
  });
}
function sparkline(runId){
  const chrono=store.runs.slice().reverse();
  const idx=chrono.findIndex(function(r){return r.runId===runId;});
  if(idx<0)return '';
  const values=chrono.slice(Math.max(0,idx-4),idx+1).map(function(r){return number(r.adjustedPerformanceIndex);}).filter(function(v){return v!==null;});
  if(values.length<2)return '<span class="recent-secondary">—</span>';
  const min=Math.min.apply(null,values),max=Math.max.apply(null,values),range=max-min||1;
  const pts=values.map(function(v,i){return (i*(60/(values.length-1))).toFixed(1)+','+(20-(v-min)/range*16).toFixed(1);}).join(' ');
  return '<svg class="spark" viewBox="0 0 64 24" aria-label="recent adjusted performance sparkline"><polyline points="'+pts+'"></polyline></svg>';
}

function setupInteractions(){
  el('open-latest-run').addEventListener('click',function(){if(store.detailedRuns[0])openAnalysis(store.detailedRuns[0].runId);});
  el('analysis-run-select').addEventListener('change',function(){openAnalysis(this.value);});
  el('pace-mode').addEventListener('change',async function(){state.paceMode=this.value;if(state.runId){const run=await store.loadRun(state.runId);renderRunCharts(run);}});
  el('drift-compare-toggle').addEventListener('change',async function(){
    state.driftCompare=this.checked;
    el('drift-overlay-selects').hidden=!state.driftCompare;
    await rerenderCurrentDrift();
  });
  el('drift-overlay-1').addEventListener('change',async function(){
    state.driftOverlay1=this.value||null;
    if(state.driftOverlay2===state.driftOverlay1) state.driftOverlay2=null;
    configureDriftControls(state.runId);
    await rerenderCurrentDrift();
  });
  el('drift-overlay-2').addEventListener('change',async function(){
    state.driftOverlay2=this.value||null;
    await rerenderCurrentDrift();
  });
  el('copy-run-link').addEventListener('click',async function(){
    try{await navigator.clipboard.writeText(location.href);toast('Run link copied.');}
    catch{toast('Copy failed — use the address bar URL.');}
  });
  all('#trend-range button').forEach(function(btn){
    btn.addEventListener('click',function(){
      all('#trend-range button').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');state.trendDays=btn.dataset.days;renderTrends();
    });
  });
  el('compare-a').addEventListener('change',renderCompare);
  el('compare-b').addEventListener('change',renderCompare);
  el('history-search').addEventListener('input',renderHistory);
  el('history-window').addEventListener('change',renderHistory);
  all('.history-table th button[data-sort]').forEach(function(btn){
    btn.addEventListener('click',function(){
      const key=btn.dataset.sort;
      if(state.sortKey===key)state.sortDir*=-1;
      else{state.sortKey=key;state.sortDir=key==='date'?-1:1;}
      renderHistory();
    });
  });
}

async function init(){
  initTheme();
  setupNavigation();
  try{
    await store.loadCore();
    el('sync-text').textContent=generatedLabel();
    populateRunSelectors();
    setupInteractions();
    renderOverview();
    const params=new URLSearchParams(location.search);
    const requestedRun=params.get('run');
    const requestedView=params.get('view');
    if(requestedRun && store.findRun(requestedRun)&&store.findRun(requestedRun).detailFile){
      el('analysis-run-select').value=requestedRun;
      await openAnalysis(requestedRun);
    }else{
      switchView(titles[requestedView]?requestedView:'overview',false);
    }
  }catch(error){
    el('global-error').hidden=false;
    el('global-error').textContent='Dashboard data could not be loaded: '+(error.message||String(error));
    el('sync-text').textContent='Data unavailable';
  }
}

init();