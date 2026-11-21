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
  // Minute 2 has no sample within 30 s (nearest is 59 s away) but is
  // bracketed by the +59 s and +179 s samples: interpolated estimate.
  assert.equal(r.minute2Drop,22.7);
  assert.equal(r.minute3Drop,36);
  assert.equal(r.source,'garmin-daily-heart-rate-estimate-with-interpolation');
  assert.equal(r.measurements.length,3);
  const m2=r.measurements.find(m=>m.minute===2);
  assert.equal(m2.source,'garmin-daily-heart-rate-interpolated');
  assert.equal(m2.estimated,true);
  assert.equal(m2.bracket.gapSeconds,120);
  assert.equal(r.measurements.find(m=>m.minute===1).source,'garmin-daily-heart-rate-sample');
  assert.equal(r.measurements.find(m=>m.minute===3).source,'garmin-daily-heart-rate-sample');
});
test('Nov 20 2026 real grid shape: only minute 2 measured, 1 and 3 interpolated',()=>{
  const end20='2026-11-20T22:21:49Z';
  const t20=s=>Date.parse(end20)+s*1000;
  const run20={endTime:end20,heartRateSeries:[{time:end20,value:164}]};
  const day={heartRate:{heartRateValues:[[t20(11),154],[t20(131),137],[t20(251),125]]}};
  const r=garminPostRunRecovery(run20,day);
  assert.equal(r.minute1Drop,16.9);
  assert.equal(r.minute2Drop,27);
  assert.equal(r.minute3Drop,31.9);
  assert.deepEqual(r.measurements.map(m=>m.source),[
    'garmin-daily-heart-rate-interpolated',
    'garmin-daily-heart-rate-sample',
    'garmin-daily-heart-rate-interpolated']);
});
test('interpolation does not span a wide gap in daily samples',()=>{
  const day={heartRate:{heartRateValues:[[time(11),150],[time(311),120]]}};
  assert.equal(garminPostRunRecovery(run,day),null);
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
