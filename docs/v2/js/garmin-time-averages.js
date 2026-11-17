/**
 * Garmin FIT time-bucket averaging for run timelines.
 * Buckets are anchored to the movement-start timestamp.
 * Pace is averaged as speed (mph) before converting to seconds/mile,
 * so a slow GPS artifact doesn't dominate arithmetic pace means.
 * No interpolation across missing buckets.
 */
export function averageTimeline(points, key, origin, bucketSeconds, {pace=false}={}){
  const start=Date.parse(origin);
  if(!Number.isFinite(start))return [];
  if(![1,15,30,60,300].includes(bucketSeconds))throw Error('Unsupported averaging interval');
  const buckets=new Map();
  for(const p of points||[]){
    const time=Date.parse(p.time);
    const value=p[key];
    if(!Number.isFinite(time)||time<start||!Number.isFinite(value))continue;
    if(pace&&(value<120||value>1800))continue;
    const elapsed=(time-start)/1000;
    const slot=Math.floor(elapsed/bucketSeconds)*bucketSeconds;
    let b=buckets.get(slot);
    if(!b){b={sum:0,count:0};buckets.set(slot,b);}
    b.sum+=pace?3600/value:value;
    b.count++;
  }
  return [...buckets].sort((a,b)=>a[0]-b[0]).map(([slot,b])=>({
    time:new Date(start+slot*1000).toISOString(),
    [key]:pace?3600/(b.sum/b.count):b.sum/b.count,
    samples:b.count
  }));
}
