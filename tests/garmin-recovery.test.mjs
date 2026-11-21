import test from 'node:test';
import assert from 'node:assert/strict';
import {garminPostRunRecovery} from '../scripts/garmin-recovery.mjs';
const end='2026-11-16T22:03:01Z';
const run={endTime:end,heartRateSeries:[{time:end,value:167}]};
const time=s=>Date.parse(end)+s*1000;
test('Garmin daily samples provide only time-supported approximate recovery',()=>{
  const day={heartRate:{heartRateValues:[[time(59),158],[time(179),131],[time(299),126]]}};
  const r=garminPostRunRecovery(run,day);
  assert.equal(r.minute1Drop,9);
  assert.equal(r.minute2Drop,null);
  assert.equal(r.minute3Drop,36);
  assert.equal(r.source,'garmin-daily-heart-rate-estimate');
  assert.equal(r.measurements.length,2);
});
test('missing and distant timestamps do not generate invented HRR',()=>{
  assert.equal(garminPostRunRecovery(run,{heartRate:{heartRateValues:[[time(15),158]]}}),null);
  assert.equal(garminPostRunRecovery(run,{}),null);
});

test('genuine post-run FIT samples win over sparse wellness data',()=>{
  const at=s=>new Date(time(s)).toISOString();
  const withFit={...run,heartRateSeries:[
    {time:end,value:167},
    {time:at(60),value:145},
    {time:at(120),value:137},
    {time:at(180),value:129}
  ]};
  const day={heartRate:{heartRateValues:[[time(60),155],[time(180),150]]}};
  const r=garminPostRunRecovery(withFit,day);
  assert.deepEqual([r.minute1Drop,r.minute2Drop,r.minute3Drop],[22,30,38]);
  assert.equal(r.measurements.length,3);
  assert.ok(r.measurements.every(m=>m.source==='garmin-fit-post-activity-record'));
});
test('do not treat daily-only or distant FIT samples as exact measurements',()=>{
  const at=s=>new Date(time(s)).toISOString();
  const withFit={...run,heartRateSeries:[{time:end,value:167},{time:at(75),value:154}]};
  const r=garminPostRunRecovery(withFit,{
    heartRate:{heartRateValues:[[time(120),135]]}
  });
  assert.equal(r.minute1Drop,null);
  assert.equal(r.minute2Drop,32);
  assert.equal(r.minute3Drop,null);
  assert.equal(r.measurements[0].source,'garmin-daily-heart-rate-sample');
});
