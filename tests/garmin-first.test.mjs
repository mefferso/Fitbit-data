import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const publisher=resolve('scripts/publish-garmin.mjs');
const write=async(root,path,value)=>{
  const full=join(root,path);
  await mkdir(full.substring(0,full.lastIndexOf('/')),{recursive:true});
  await writeFile(full,JSON.stringify(value));
};
const read=async(root,path)=>JSON.parse(await readFile(join(root,path),'utf8'));
function fixture(id,start,date){
  return {
    source:'garmin',sourceActivityId:id,date,startTime:start,
    endTime:new Date(new Date(start).getTime()+2400000).toISOString(),
    activeSeconds:2400,elapsedSeconds:2410,distanceMiles:3.71,
    averagePaceSecondsPerMile:647,averageHeartRate:148,peakHeartRate:165,
    heartRateSeries:[{time:start,value:132}],paceSeries:[],
    dynamicsSeries:[],lapSummaries:[],
    garminMetrics:{avgCadenceSpm:160,avgGroundContactMs:280,
      avgVerticalOscillationCm:8.7,lapCount:4}
  };
}
test('Garmin-only runs import, historical archive survives, sync is idempotent',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'garmin-first-'));
  await write(dir,'docs/data/run-index.json',{
    generatedAt:'2026-11-16T08:00:00Z',runs:[
      {date:'2026-11-13',startTime:'2026-11-13T19:00:00Z',runId:'historic',
        activeSeconds:2400,distanceMiles:3.6,averagePaceSecondsPerMile:667,
        averageHeartRate:145,detailFile:'data/runs/legacy.json'},
      {date:'2026-11-16',startTime:'2026-11-16T21:22:47Z',runId:'old-google',
        activeSeconds:2412,distanceMiles:3.68,averagePaceSecondsPerMile:655,
        averageHeartRate:153,detailFile:'data/runs/googlenov16.json'}
    ]
  });
  await write(dir,'docs/data/runs/legacy.json',{runId:'historic',date:'2026-11-13',detailFile:'data/runs/legacy.json'});
  await write(dir,'docs/data.json',{detailedRuns:[{runId:'historic',date:'2026-11-13',detailFile:'data/runs/legacy.json'}],recentRuns:[],runningTrend:{}});
  await write(dir,'docs/data/trends.json',{runningTrend:{}});
  await write(dir,'.garmin-staging/activities.json',[
    fixture(111,'2026-11-16T21:22:41Z','2026-11-16'),
    fixture(222,'2026-11-18T20:00:00Z','2026-11-18')
  ]);
  await write(dir,'.garmin-staging/wellness.json',{'2026-11-18':{
    hrv:{hrvSummary:{lastNightAvg:42}},sleep:{dailySleepDTO:{sleepTimeSeconds:25200}}
  }});
  const run=()=>spawnSync(process.execPath,[publisher],{cwd:dir,encoding:'utf8'});
  const a=run();
  assert.equal(a.status,0,a.stderr);
  const after=await read(dir,'docs/data/run-index.json');
  assert.equal(after.runCount,3);
  assert.deepEqual(after.runs.map(r=>r.runId),['garmin-222','garmin-111','historic']);
  assert.equal(after.runs.filter(r=>r.source==='garmin').length,2);
  assert.equal(after.runs.filter(r=>r.runId==='old-google').length,0);
  const newer=await read(dir,'docs/data/runs/garmin/222.json');
  assert.equal(newer.sourceActivityId,222);
  assert.equal(newer.distanceMiles,3.71);
  assert.equal(newer.heartRateRecovery,null);
  assert.equal(newer.trainingLoad,null);
  const daily=await read(dir,'docs/data/garmin-wellness.json');
  assert.equal(daily.days['2026-11-18'].hrv.hrvSummary.lastNightAvg,42);
  const b=run();
  assert.equal(b.status,0,b.stderr);
  assert.match(b.stdout,/running feed changed=false, wellness feed changed=false/);
  const repeated=await read(dir,'docs/data/run-index.json');
  assert.deepEqual(repeated,after);
});
test('invalid Garmin activity is rejected before publishing indexes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'garmin-bad-'));
  await write(dir,'.garmin-staging/activities.json',[{source:'garmin',sourceActivityId:123,date:'2026-11-18'}]);
  await write(dir,'.garmin-staging/wellness.json',{});
  const bad=spawnSync(process.execPath,[publisher],{cwd:dir,encoding:'utf8'});
  assert.notEqual(bad.status,0);
  await assert.rejects(readFile(join(dir,'docs/data/run-index.json'),'utf8'));
});
