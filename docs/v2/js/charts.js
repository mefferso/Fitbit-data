import {number, fmtPace} from './data.js';

function css(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function grid(){ return css('--line'); }
function muted(){ return css('--muted'); }
function primary(){ return css('--primary'); }
function positive(){ return css('--positive'); }
function warning(){ return css('--warning'); }
function negative(){ return css('--negative'); }
function violet(){ return css('--violet'); }
function teal(){ return css('--teal'); }

function baseOptions(){
  return {
    responsive:true,
    maintainAspectRatio:false,
    animation:{duration:250},
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{display:false},
      tooltip:{
        backgroundColor:css('--nav'),
        titleColor:'#fff',
        bodyColor:'#e5edf8',
        padding:10,
        cornerRadius:9,
        displayColors:false
      }
    },
    scales:{
      x:{grid:{display:false},ticks:{color:muted(),maxTicksLimit:7,font:{size:10}}},
      y:{grid:{color:grid()},ticks:{color:muted(),font:{size:10}}}
    }
  };
}

function merge(target, source){
  Object.keys(source || {}).forEach(function(key){
    if(source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])){
      target[key] = target[key] || {};
      merge(target[key], source[key]);
    }else target[key] = source[key];
  });
  return target;
}

export class Charts {
  constructor(){ this.items = {}; }

  destroy(name){
    if(this.items[name]){
      this.items[name].destroy();
      delete this.items[name];
    }
  }

  destroyAll(){
    Object.keys(this.items).forEach(this.destroy.bind(this));
  }

  line(name, canvas, labels, datasets, overrides){
    this.destroy(name);
    const opts = merge(baseOptions(), overrides || {});
    this.items[name] = new Chart(canvas,{type:'line',data:{labels:labels,datasets:datasets},options:opts});
    return this.items[name];
  }

  bar(name, canvas, labels, datasets, overrides){
    this.destroy(name);
    const opts = merge(baseOptions(), overrides || {});
    this.items[name] = new Chart(canvas,{type:'bar',data:{labels:labels,datasets:datasets},options:opts});
    return this.items[name];
  }

  performance(canvas, runs, name){
    const labels = runs.map(function(r){ return r.date; });
    return this.line(name || 'performance', canvas, labels, [{
      data:runs.map(function(r){ return number(r.score !== undefined ? r.score : r.adjustedPerformanceIndex); }),
      borderColor:primary(),backgroundColor:primary(),borderWidth:2.5,pointRadius:2.5,pointHoverRadius:5,tension:.28,spanGaps:true
    }],{
      scales:{y:{grid:{color:grid()},ticks:{color:muted()},suggestedMin:90,suggestedMax:125,title:{display:true,text:'Index',color:muted(),font:{size:10}}}},
      plugins:{tooltip:{callbacks:{label:function(ctx){ return 'Adjusted performance: ' + Number(ctx.raw).toFixed(1); }}}}
    });
  }

  trainingLoad(canvas, points, name){
    const usable = points.slice(-45);
    return this.bar(name || 'load', canvas,
      usable.map(function(p){ return p.date; }),
      [{data:usable.map(function(p){ return number(p.load) || 0; }),backgroundColor:warning(),borderRadius:4,maxBarThickness:14}],
      {scales:{y:{beginAtZero:true,grid:{color:grid()},ticks:{color:muted()}}}}
    );
  }

  metricTrend(name, canvas, runs, key, options){
    options = options || {};
    const data = runs.map(function(r){ return number(r[key]); });
    const dataset = {
      data:data,
      borderColor:options.color || primary(),
      backgroundColor:options.color || primary(),
      borderWidth:2.3,
      pointRadius:2.5,
      pointHoverRadius:5,
      tension:.28,
      spanGaps:true
    };
    const overrides = {
      scales:{
        y:{
          grid:{color:grid()},
          ticks:{
            color:muted(),
            callback:options.tick || undefined
          },
          reverse:Boolean(options.reverse),
          suggestedMin:options.min,
          suggestedMax:options.max,
          title:options.title ? {display:true,text:options.title,color:muted(),font:{size:10}} : undefined
        }
      },
      plugins:{tooltip:{callbacks:{label:options.tooltip || undefined}}}
    };
    return this.line(name,canvas,runs.map(function(r){return r.date;}),[dataset],overrides);
  }

  runStack(hrCanvas, paceCanvas, run, paceMode){
    const start = new Date(run.startTime).getTime();
    const hr = (run.heartRateSeries || []).map(function(p){
      return {x:(new Date(p.time).getTime() - start)/60000,y:number(p.value),zone:p.zoneKey || 'below'};
    }).filter(function(p){return Number.isFinite(p.x) && p.y !== null;});

    const pace = smoothPace(run.paceSeries || [], paceMode).map(function(p){
      return {x:(new Date(p.time).getTime() - start)/60000,y:number(p.paceSecondsPerMile)};
    }).filter(function(p){return Number.isFinite(p.x) && p.y !== null;});

    this.destroy('runHr'); this.destroy('runPace');
    const zoneColors = {peak:'#cf4e65',vigorous:'#cf861f',moderate:'#5279df',light:'#2395a0',below:'#8793a3'};
    const common = {
      responsive:true,maintainAspectRatio:false,animation:false,normalized:true,
      interaction:{mode:'nearest',intersect:false,axis:'x'},
      plugins:{legend:{display:false},tooltip:{backgroundColor:css('--nav'),titleColor:'#fff',bodyColor:'#e5edf8',padding:10,cornerRadius:9,displayColors:false}},
      scales:{
        x:{type:'linear',grid:{display:false},ticks:{color:muted(),font:{size:10},maxTicksLimit:9},title:{display:true,text:'Minutes into run',color:muted(),font:{size:10}}},
        y:{grid:{color:grid()},ticks:{color:muted(),font:{size:10}}}
      }
    };

    const hrOpts = structuredClone(common);
    hrOpts.scales.x.ticks.display = false;
    hrOpts.scales.x.title.display = false;
    hrOpts.scales.y.title = {display:true,text:'bpm',color:muted(),font:{size:10}};
    hrOpts.plugins.tooltip.callbacks = {
      title:function(items){ return items.length ? items[0].parsed.x.toFixed(1) + ' min' : ''; },
      label:function(ctx){ return Math.round(ctx.parsed.y) + ' bpm'; }
    };
    this.items.runHr = new Chart(hrCanvas,{
      type:'line',
      data:{datasets:[{
        data:hr,parsing:false,borderWidth:2.4,pointRadius:0,tension:.18,
        borderColor:primary(),
        segment:{borderColor:function(ctx){ return zoneColors[hr[ctx.p1DataIndex] && hr[ctx.p1DataIndex].zone] || primary(); }}
      }]},
      options:hrOpts
    });

    const paceValues = pace.map(function(p){return p.y;}).filter(function(v){return v !== null && v >= 240 && v <= 1800;});
    const paceOpts = structuredClone(common);
    paceOpts.scales.y.reverse = true;
    if(paceValues.length){
      const low = Math.max(240,Math.floor((Math.min.apply(null,paceValues)-30)/30)*30);
      const high = Math.min(1800,Math.ceil((Math.max.apply(null,paceValues)+30)/30)*30);
      paceOpts.scales.y.min = low; paceOpts.scales.y.max = high;
    }
    paceOpts.scales.y.title = {display:true,text:'min/mi',color:muted(),font:{size:10}};
    paceOpts.scales.y.ticks.callback = function(value){return fmtPace(value).replace('/mi','');};
    paceOpts.plugins.tooltip.callbacks = {
      title:function(items){ return items.length ? items[0].parsed.x.toFixed(1) + ' min' : ''; },
      label:function(ctx){ return fmtPace(ctx.parsed.y); }
    };
    this.items.runPace = new Chart(paceCanvas,{
      type:'line',
      data:{datasets:[{data:pace,parsing:false,borderColor:violet(),backgroundColor:violet(),borderWidth:2.2,pointRadius:0,tension:.2}]},
      options:paceOpts
    });

    return {hr:this.items.runHr,pace:this.items.runPace};
  }

  bindSynchronizedPointer(wrapper){
    const hrChart = this.items.runHr, paceChart = this.items.runPace;
    if(!wrapper || !hrChart || !paceChart) return;
    const charts = [hrChart,paceChart];

    function clear(){
      charts.forEach(function(chart){
        chart.setActiveElements([]);
        if(chart.tooltip) chart.tooltip.setActiveElements([],{x:0,y:0});
        chart.draw();
      });
    }
    function move(event){
      const rect = hrChart.canvas.getBoundingClientRect();
      const area = hrChart.chartArea;
      const left = rect.left + area.left, right = rect.left + area.right;
      const clientX = event.clientX !== undefined ? event.clientX : (event.touches && event.touches[0] ? event.touches[0].clientX : null);
      if(clientX === null || clientX < left || clientX > right){ clear(); return; }
      const ratio = (clientX - left) / (right - left);
      charts.forEach(function(chart){
        const count = chart.data.datasets[0].data.length;
        if(!count) return;
        const index = Math.max(0,Math.min(count-1,Math.round(ratio*(count-1))));
        chart.setActiveElements([{datasetIndex:0,index:index}]);
        if(chart.tooltip){
          chart.tooltip.setActiveElements([{datasetIndex:0,index:index}],{
            x:chart.chartArea.left+ratio*(chart.chartArea.right-chart.chartArea.left),
            y:(chart.chartArea.top+chart.chartArea.bottom)/2
          });
        }
        chart.draw();
      });
    }
    wrapper.onpointermove = move;
    wrapper.onpointerleave = clear;
    wrapper.ontouchstart = function(event){ move(event); };
    wrapper.ontouchmove = function(event){ move(event); };
  }

  drift(canvas, series){
    const input = Array.isArray(series) ? series : [{label:'Current run',result:series,current:true}];
    const valid = input.filter(function(item){return item && item.result && item.result.points && item.result.points.length;});
    const colors = [primary(),violet(),teal()];
    const dashes = [[],[8,5],[3,4]];
    const datasets = valid.map(function(item,index){
      return {
        label:item.label || ('Run '+(index+1)),
        data:item.result.points.map(function(p){
          return {x:p.x,y:p.y,heartRate:p.heartRate,pace:p.pace};
        }),
        parsing:false,
        borderColor:colors[index%colors.length],
        backgroundColor:index===0?'rgba(75,112,245,.10)':'transparent',
        fill:index===0?{target:{value:0}}:false,
        borderWidth:index===0?2.8:2.35,
        borderDash:dashes[index]||[4,4],
        pointRadius:0,
        pointHoverRadius:4,
        tension:.25
      };
    });

    const allPoints=valid.flatMap(function(item){return item.result.points;});
    const xMax=allPoints.length?Math.max.apply(null,allPoints.map(function(p){return p.x;})):15;
    const values=allPoints.map(function(p){return p.y;}).filter(Number.isFinite);
    const minValue=values.length?Math.min.apply(null,values):0;
    const maxValue=values.length?Math.max.apply(null,values):8;
    const yMin=Math.min(-5,Math.floor((minValue-1)/2)*2);
    const yMax=Math.max(8,Math.ceil((maxValue+1)/2)*2);

    datasets.push({
      label:'5% reference',
      data:[{x:0,y:5},{x:xMax,y:5}],
      parsing:false,
      borderColor:warning(),
      borderDash:[6,5],
      borderWidth:1.4,
      pointRadius:0,
      tension:0,
      isReference:true
    });

    this.destroy('drift');
    this.items.drift = new Chart(canvas,{
      type:'line',
      data:{datasets:datasets},
      options:{
        responsive:true,maintainAspectRatio:false,animation:false,
        interaction:{mode:'nearest',intersect:false},
        plugins:{
          legend:{
            display:valid.length>1,
            position:'bottom',
            labels:{
              color:muted(),
              usePointStyle:true,
              boxWidth:8,
              font:{size:10},
              filter:function(item){return item.text!=='5% reference';}
            }
          },
          tooltip:{
            backgroundColor:css('--nav'),titleColor:'#fff',bodyColor:'#e5edf8',displayColors:false,padding:10,cornerRadius:9,
            filter:function(item){return !item.dataset.isReference;},
            callbacks:{
              title:function(items){return items.length ? 'Minute '+items[0].parsed.x.toFixed(1) : '';},
              label:function(ctx){
                const raw=ctx.raw||{};
                const drift=(Number(ctx.parsed.y)>0?'+':'')+Number(ctx.parsed.y).toFixed(1)+'%';
                const lines=[ctx.dataset.label+' · '+drift];
                if(Number.isFinite(Number(raw.heartRate))) lines.push('5-min avg HR: '+Math.round(Number(raw.heartRate))+' bpm');
                if(Number.isFinite(Number(raw.pace))) lines.push('5-min pace: '+fmtPace(Number(raw.pace)));
                return lines;
              }
            }
          }
        },
        scales:{
          x:{type:'linear',grid:{display:false},ticks:{color:muted()},title:{display:true,text:'Minutes into run',color:muted()}},
          y:{
            min:yMin,max:yMax,
            grid:{color:function(ctx){return Number(ctx.tick.value)===0?css('--line-strong'):grid();},lineWidth:function(ctx){return Number(ctx.tick.value)===0?1.5:1;}},
            ticks:{color:muted(),callback:function(v){return (Number(v)>0?'+':'')+v+'%';}},
            title:{display:true,text:'Efficiency loss vs minutes 5–10 (%)',color:muted()}
          }
        }
      }
    });
  }

  compare(canvas, runs, kind, name){
    this.destroy(name);
    const colors = [primary(),violet()];
    const datasets = runs.map(function(run,index){
      const start = new Date(run.startTime).getTime();
      const source = kind === 'hr' ? (run.heartRateSeries || []) : smoothPace(run.paceSeries || [],30);
      const data = source.map(function(p){
        return {x:(new Date(p.time).getTime()-start)/60000,y:number(kind==='hr'?p.value:p.paceSecondsPerMile)};
      }).filter(function(p){return Number.isFinite(p.x)&&p.y!==null;});
      return {label:run.date,data:data,parsing:false,borderColor:colors[index],backgroundColor:colors[index],borderWidth:2.4,pointRadius:0,tension:.2};
    });
    const opts = {
      responsive:true,maintainAspectRatio:false,animation:false,normalized:true,interaction:{mode:'nearest',intersect:false},
      plugins:{
        legend:{display:true,labels:{color:muted(),usePointStyle:true,boxWidth:8,font:{size:10}}},
        tooltip:{backgroundColor:css('--nav'),titleColor:'#fff',bodyColor:'#e5edf8',padding:10,cornerRadius:9,callbacks:{
          title:function(items){return items.length?items[0].parsed.x.toFixed(1)+' min':'';},
          label:function(ctx){return ' '+ctx.dataset.label+': '+(kind==='hr'?Math.round(ctx.parsed.y)+' bpm':fmtPace(ctx.parsed.y));}
        }}
      },
      scales:{
        x:{type:'linear',grid:{display:false},ticks:{color:muted()},title:{display:true,text:'Minutes into run',color:muted()}},
        y:{grid:{color:grid()},ticks:{color:muted(),callback:kind==='pace'?function(v){return fmtPace(v).replace('/mi','');}:undefined},reverse:kind==='pace',
          title:{display:true,text:kind==='hr'?'Heart rate (bpm)':'Pace (min/mi)',color:muted()}}
      }
    };
    this.items[name] = new Chart(canvas,{type:'line',data:{datasets:datasets},options:opts});
  }
}

export function smoothPace(series, mode){
  const points = (series || []).slice().sort(function(a,b){return new Date(a.time)-new Date(b.time);});
  if(mode === 'raw' || !points.length) return points;
  const windowSeconds = Number(mode) || 30;
  const windowMs = windowSeconds * 1000;
  return points.map(function(point,index){
    const pointSeconds = Math.max(.001,Number(point.seconds)||1);
    const midpoint = new Date(point.time).getTime();
    const targetEnd = midpoint + pointSeconds*500;
    const targetStart = targetEnd - windowMs;
    let distance=0,elapsed=0;
    for(let cursor=index;cursor>=0;cursor--){
      const item=points[cursor],sec=Math.max(.001,Number(item.seconds)||1);
      const mid=new Date(item.time).getTime();
      const itemStart=mid-sec*500,itemEnd=mid+sec*500;
      if(itemEnd<=targetStart)break;
      const overlapStart=Math.max(itemStart,targetStart),overlapEnd=Math.min(itemEnd,targetEnd);
      const overlapMs=Math.max(0,overlapEnd-overlapStart);
      if(!overlapMs)continue;
      const fraction=overlapMs/(sec*1000);
      distance+=(Number(item.distanceMiles)||0)*fraction;
      elapsed+=overlapMs/1000;
    }
    const copy=Object.assign({},point);
    copy.paceSecondsPerMile=distance>0&&elapsed>0?Math.round(elapsed/distance):point.paceSecondsPerMile;
    return copy;
  });
}

function meanHr(series,startMs,endMs){
  const values=(series||[]).filter(function(p){
    const t=new Date(p.time).getTime();
    return t>=startMs&&t<endMs&&Number.isFinite(Number(p.value));
  }).map(function(p){return Number(p.value);});
  return values.length?values.reduce(function(a,b){return a+b;},0)/values.length:null;
}
function paceEfficiency(run,startMs,endMs){
  const hr=meanHr(run.heartRateSeries,startMs,endMs);
  if(!hr||hr<=0)return null;
  let distance=0,seconds=0;
  (run.paceSeries||[]).forEach(function(p){
    const mid=new Date(p.time).getTime(),sec=Math.max(.001,Number(p.seconds)||0),miles=Math.max(0,Number(p.distanceMiles)||0);
    if(!Number.isFinite(mid)||!sec||!miles)return;
    const a=mid-sec*500,b=mid+sec*500,overlap=Math.max(0,Math.min(b,endMs)-Math.max(a,startMs));
    if(!overlap)return;
    distance+=miles*(overlap/(sec*1000));
    seconds+=overlap/1000;
  });
  if(distance<=0||seconds<=0)return null;
  return {efficiency:(distance/(seconds/3600))/hr,heartRate:hr,pace:seconds/distance};
}

export function rollingDrift(run){
  const start=new Date(run && run.startTime).getTime(),end=new Date(run && run.endTime).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<15*60000)return null;
  const baseline=paceEfficiency(run,start+5*60000,start+10*60000);
  if(!baseline||!baseline.efficiency)return null;
  const points=[],half=2.5*60000;
  for(let center=start+7.5*60000;center<=end-half;center+=30000){
    const metric=paceEfficiency(run,center-half,center+half);
    if(!metric||!metric.efficiency)continue;
    points.push({
      x:(center-start)/60000,
      y:(baseline.efficiency-metric.efficiency)/baseline.efficiency*100,
      heartRate:metric.heartRate,
      pace:metric.pace
    });
  }
  if(!points.length)return null;
  return {
    points:points,
    late:points[points.length-1].y,
    peak:Math.max.apply(null,points.map(function(p){return p.y;}))
  };
}

export function chartPalette(){
  return {primary:primary(),positive:positive(),warning:warning(),negative:negative(),violet:violet(),teal:teal()};
}