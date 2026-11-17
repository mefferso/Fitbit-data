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
  assert.equal(garminPostRunRecovery(run,{heartRate:{heartRateValues:[[time(40),158]]}}),null);
  assert.equal(garminPostRunRecovery(run,{}),null);
});
