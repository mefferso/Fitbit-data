// Clean, conservative aerobic analysis. Does not alter historic whole-run metrics.
const finite = x => Number.isFinite(Number(x));
const median = a => { const s=a.filter(Number.isFinite).sort((x,y)=>x-y); return s.length?s[Math.floor(s.length/2)]:null; };
const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
const round = (n,d=1) => Math.round(n*10**d)/10**d;
function timedHr(points,a,b){
  let sum=0,seconds=0;
  for(let i=0;i<points.length;i++){
    const p=points[i],next=points[i+1];
    const end=next?Math.min(next.t,p.t+30000):p.t+5000;
    const dt=Math.max(0,Math.min(b,end)-Math.max(a,p.t))/1000;
    if(dt>0){sum+=p.v*dt;seconds+=dt;}
  }
  return seconds>=(b-a)/1000*.65?sum/seconds:null;
}
function paceWindow(points,a,b){
  let dist=0,sec=0;
  for(const p of points){
    const overlap=Math.max(0,Math.min(b,p.end)-Math.max(a,p.start))/1000;
    if(overlap){dist+=p.miles*overlap/p.seconds;sec+=overlap;}
  }
  return sec>=(b-a)/1000*.8&&dist>0?3600*dist/sec:null;
}
export function analyzeAerobicRun(run){
  const start=Date.parse(run.startTime),end=Date.parse(run.endTime);
  const no=(reason,classification='Unclassified')=>({classification,confidence:'limited',reason,steadyDriftPercent:null,steadyMinutes:0,steadyEfficiency:null,matchedPace:null,matchedMinutes:0,blocks:[],quality:'limited'});
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start<20*60000)return no('Insufficient run duration');
  const pace=(run.paceSeries||[]).map(p=>{
    const mid=Date.parse(p.time),seconds=Number(p.seconds),miles=Number(p.distanceMiles);
    return {start:mid-seconds*500,end:mid+seconds*500,seconds,miles};
  }).filter(p=>Number.isFinite(p.start)&&p.seconds>0&&p.seconds<=60&&p.miles>0&&p.miles/p.seconds*3600<20).sort((a,b)=>a.start-b.start);
  const hr=(run.heartRateSeries||[]).map(p=>({t:Date.parse(p.time),v:Number(p.value)}))
    .filter(p=>Number.isFinite(p.t)&&p.v>=60&&p.v<=220).sort((a,b)=>a.t-b.t);
  if(pace.length<30||hr.length<25)return no('Insufficient paired HR and pace coverage');
  const bins=[];
  for(let t=start+10*60000;t+60000<=end;t+=60000){
    const speed=paceWindow(pace,t,t+60000),h=timedHr(hr,t,t+60000);
    bins.push({t,speed,hr:h,valid:speed!==null&&h!==null&&speed>=3.5&&speed<=12});
  }
  const valid=bins.filter(b=>b.valid);
  if(valid.length<12)return no('Insufficient clean minutes after warmup');
  const speeds=valid.map(x=>x.speed),q=median(speeds),lowSpeed=speeds.slice().sort((a,b)=>a-b)[Math.floor(speeds.length*.3)],totalVar=(Math.max(...speeds)-Math.min(...speeds))/q;
  const first=valid.slice(0,Math.max(3,Math.floor(valid.length/3))),last=valid.slice(-Math.max(3,Math.floor(valid.length/3)));
  const change=(mean(last.map(x=>x.speed))/mean(first.map(x=>x.speed))-1)*100;
  // Persistent faster intervals require at least two fast bouts separated by easier running.
  const fast=valid.map(b=>b.speed>lowSpeed*1.12);
  let bouts=0,inside=false;
  for(let i=0;i<fast.length;i++){
    if(fast[i]&&!inside){let j=i;while(j<fast.length&&fast[j])j++;if(j-i>=3)bouts++;i=j-1;inside=false;}
  }
  let classification='Easy / steady';
  if(bouts>=2)classification='Intervals / mixed effort';
  else if(change>6||totalVar>.26&&change>3)classification='Progression / mixed pace';
  else if(totalVar>.28)classification='Variable pace';
  else if((end-start)/60000>=50)classification='Long steady';
  // Repeated 1-min bins require a contiguous stable block; never stitch distant intervals.
  const smooth=bins.map((b,i)=>{
    const nearby=bins.slice(Math.max(0,i-1),Math.min(bins.length,i+2)).filter(x=>x.valid).map(x=>x.speed);
    return nearby.length>=2?median(nearby):null;
  });
  const stable=bins.map((b,i)=>{
    if(!b.valid)return false;
    const context=bins.slice(Math.max(0,i-2),Math.min(bins.length,i+3)).filter(x=>x.valid);
    if(context.length<3)return false;
    const m=median(context.map(x=>x.speed));
    return smooth[i]!==null&&Math.abs(smooth[i]/m-1)<=.08;
  });
  const blocks=[];let i=0;
  while(i<bins.length){
    if(!stable[i]){i++;continue;}
    let j=i;while(j<bins.length&&stable[j]&&bins[j].valid)j++;
    const group=bins.slice(i,j),smoothed=smooth.slice(i,j),m=median(smoothed);
    // Reject gentle-but-substantial progressions disguised as stable rolling windows.
    const spread=(Math.max(...smoothed)-Math.min(...smoothed))/m;
    const half=Math.floor(group.length/2);
    const a=group.slice(0,half),b=group.slice(half);
    const s1=a.length?mean(a.map(x=>x.speed)):null,s2=b.length?mean(b.map(x=>x.speed)):null;
    const h1=a.length?mean(a.map(x=>x.hr)):null,h2=b.length?mean(b.map(x=>x.hr)):null;
    if(group.length>=12&&spread<=.11&&s1&&s2&&Math.abs(s2/s1-1)<=.035&&h1&&h2){
      const e1=s1/h1,e2=s2/h2;
      blocks.push({startMinute:round((group[0].t-start)/60000,0),endMinute:round((group[group.length-1].t+60000-start)/60000,0),minutes:group.length,driftPercent:round((1-e2/e1)*100),efficiency:mean(group.map(x=>x.speed/x.hr)),firstHr:round(h1),lastHr:round(h2)});
    }
    i=j;
  }
  const best=blocks.sort((a,b)=>b.minutes-a.minutes)[0]||null;
  // Matched-HR uses only stable contiguous blocks and avoids interpolation across gaps.
  const matched=[];
  for(const block of blocks){
    for(const b of bins){
      const min=(b.t-start)/60000;
      if(min>=block.startMinute&&min<block.endMinute&&b.valid&&b.hr>=150&&b.hr<=160&&b.speed>=3.75&&b.speed<=7.5)matched.push(b);
    }
  }
  const quality=best&&best.minutes>=20?'usable':best?'limited':'not comparable';
  return {classification,confidence:bouts>=2?'pattern':change>6?'pattern':'estimated',
    reason:best?'Steady block '+best.startMinute+'–'+best.endMinute+' min':'No qualifying continuous steady block',
    steadyDriftPercent:best?best.driftPercent:null,
    steadyMinutes:best?best.minutes:0,steadyEfficiency:best?round(best.efficiency,6):null,
    matchedPace:matched.length>=5?3600/mean(matched.map(b=>b.speed)):null,
    matchedMinutes:matched.length,blocks,quality,paceChangePercent:round(change),totalPaceVariationPercent:round(totalVar*100)};
}
