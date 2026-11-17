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


import {detectChartStart} from '../docs/v2/js/garmin-chart-start.js';

test('Garmin Nov 16-like stationary startup is excluded only from charts',()=>{
  const base=Date.parse('2026-11-16T21:22:41Z');
  const at=s=>new Date(base+s*1000).toISOString();
  const dynamicsSeries=[
    ...Array.from({length:8},(_,s)=>({time:at(s),cadenceSpm:0,powerWatts:0})),
    ...Array.from({length:5},(_,j)=>({time:at(8+j),cadenceSpm:j===4?167:102,powerWatts:j===4?106:1})),
    ...Array.from({length:5},(_,j)=>({time:at(13+j),cadenceSpm:165,powerWatts:185+j*20,groundContactMs:290}))
  ];
  const details={startTime:at(0),activeSeconds:2418,distanceMiles:3.7678,dynamicsSeries};
  assert.deepEqual(detectChartStart(details),{startTime:at(13),trimmedSeconds:13});
  assert.equal(details.activeSeconds,2418);
  assert.equal(details.distanceMiles,3.7678);
});

test('No arbitrary removal during slow warmup or when dynamics are unavailable',()=>{
  const base='2026-11-16T21:22:41Z';
  const at=s=>new Date(Date.parse(base)+s*1000).toISOString();
  const slow={startTime:base,dynamicsSeries:Array.from({length:40},(_,s)=>({
    time:at(s),cadenceSpm:105,powerWatts:100,groundContactMs:310
  }))};
  assert.deepEqual(detectChartStart(slow),{startTime:base,trimmedSeconds:0});
  assert.deepEqual(detectChartStart({startTime:base}),{startTime:base,trimmedSeconds:0});
});

test('Three consecutive credible running samples are required',()=>{
  const base='2026-11-16T21:22:41Z';
  const at=s=>new Date(Date.parse(base)+s*1000).toISOString();
  const dynamicsSeries=[
    {time:at(0),cadenceSpm:165,powerWatts:230},
    {time:at(1),cadenceSpm:0,powerWatts:0},
    {time:at(2),cadenceSpm:160,powerWatts:200},
    {time:at(3),cadenceSpm:160,powerWatts:200},
    {time:at(4),cadenceSpm:161,powerWatts:200}
  ];
  assert.deepEqual(detectChartStart({startTime:base,dynamicsSeries}),{startTime:at(2),trimmedSeconds:2});
});

test('native Garmin two-minute recovery is retained without daily HR samples', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'garmin-native-hrr-'));
  const run=fixture(333,'2026-11-16T21:22:41Z','2026-11-16');
  run.garminNative={recoveryHeartRate2MinDrop:31};
  await write(dir,'.garmin-staging/activities.json',[run]);
  await write(dir,'.garmin-staging/wellness.json',{'2026-11-16':{}});
  const runCmd=spawnSync(process.execPath,[publisher],{cwd:dir,encoding:'utf8'});
  assert.equal(runCmd.status,0,runCmd.stderr);
  const detail=await read(dir,'docs/data/runs/garmin/333.json');
  assert.equal(detail.heartRateRecovery.minute2Drop,31);
  assert.equal(detail.heartRateRecovery.minute1Drop,null);
  assert.equal(detail.heartRateRecovery.minute3Drop,null);
  const index=await read(dir,'docs/data/run-index.json');
  assert.equal(index.runs[0].hrr2,31);
});

test('three-day wellness sync never erases older Garmin wellness history',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'garmin-wellness-merge-'));
  const originalDays=Object.fromEntries(Array.from({length:30},(_,i)=>{
    const date=new Date(Date.UTC(2026,10,1+i)).toISOString().slice(0,10);
    return [date,{steps:[{totalSteps:1000+i}]}];
  }));
  await write(dir,'docs/data/garmin-wellness.json',{
    generatedAt:'2026-11-30T00:00:00Z',timeZone:'America/Chicago',days:originalDays
  });
  await write(dir,'.garmin-staging/activities.json',[]);
  await write(dir,'.garmin-staging/wellness.json',{
    '2026-11-28':{steps:[{totalSteps:8000}]},
    '2026-11-29':{steps:[{totalSteps:9000}]},
    '2026-11-30':{steps:[{totalSteps:10000}]}
  });
  const result=spawnSync(process.execPath,[publisher],{cwd:dir,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const output=await read(dir,'docs/data/garmin-wellness.json');
  assert.equal(Object.keys(output.days).length,30);
  assert.equal(output.days['2026-11-01'].steps[0].totalSteps,1000);
  assert.equal(output.days['2026-11-30'].steps[0].totalSteps,10000);
});
