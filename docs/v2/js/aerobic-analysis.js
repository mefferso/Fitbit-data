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
  // Scan continuous windows after warmup; compare only sufficiently stable speed.
  // Window statistics reject interval transitions without demanding GPS-perfect 1-minute pace.
  const blocks=[];
  for(let i=0;i+12<=bins.length;i++){
    for(let j=i+12;j<=bins.length;j++){
      const group=bins.slice(i,j);
      if(group.some(x=>!x.valid))break;
      const speeds=group.map(x=>x.speed),m=mean(speeds);
      const variation=Math.sqrt(mean(speeds.map(x=>(x-m)**2)))/m;
      const largest=Math.max(...speeds.map(x=>Math.abs(x/m-1)));
      const half=Math.floor(group.length/2),a=group.slice(0,half),b=group.slice(half);
      const s1=mean(a.map(x=>x.speed)),s2=mean(b.map(x=>x.speed));
      const h1=mean(a.map(x=>x.hr)),h2=mean(b.map(x=>x.hr));
      if(variation>.075||largest>.20||Math.abs(s2/s1-1)>.045)continue;
      const e1=s1/h1,e2=s2/h2;
      blocks.push({startMinute:round((group[0].t-start)/60000,0),
        endMinute:round((group[group.length-1].t+60000-start)/60000,0),
        minutes:group.length,driftPercent:round((1-e2/e1)*100),
        efficiency:mean(group.map(x=>x.speed/x.hr)),firstHr:round(h1),lastHr:round(h2)});
    }
  }
  const best=blocks.sort((a,b)=>b.minutes-a.minutes)[0]||null;
  const qualified=best?[best]:[];
  // Matched-HR uses only stable contiguous blocks and avoids interpolation across gaps.
  const matched=[];
  for(const block of qualified){
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
    matchedMinutes:matched.length,blocks:qualified,quality,paceChangePercent:round(change),totalPaceVariationPercent:round(totalVar*100)};
}
