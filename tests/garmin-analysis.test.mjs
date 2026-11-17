import test from 'node:test';
import assert from 'node:assert/strict';
import {garminAnalysis} from '../scripts/garmin-analysis.mjs';
const start=Date.parse('2026-11-16T21:22:41Z');
const at=i=>new Date(start+i*1000).toISOString();
test('Garmin FIT analysis produces time-aligned drift and per-pace dynamics without fabricated Garmin zones',()=>{
  const heartRateSeries=[],paceSeries=[],dynamicsSeries=[];
  for(let i=0;i<2400;i++){
    heartRateSeries.push({time:at(i),value:i<1200?145:152});
    paceSeries.push({time:at(i),paceSecondsPerMile:i<1200?660:665});
    dynamicsSeries.push({time:at(i),powerWatts:260,verticalRatioPct:9.5,
      groundContactMs:285,cadenceSpm:162});
  }
  const run={startTime:at(0),endTime:at(2400),heartRateSeries,paceSeries,dynamicsSeries};
  const a=garminAnalysis(run);
  assert.equal(a.heartRateBands.reduce((x,y)=>x+y.count,0),2400);
  assert.equal(a.zoneSummary,null);
  assert.ok(Number.isFinite(a.aerobicDecoupling.percent));
  assert.ok(a.aerobicDecoupling.percent>0);
  assert.equal(a.runningDynamicsByPace.length,1);
  assert.equal(a.runningDynamicsByPace[0].verticalRatioPct,9.5);
  assert.equal(a.heartRateRecovery,null);
  const configured=garminAnalysis(run,{zoneBoundaries:[110,130,150,170]});
  assert.equal(configured.zoneSummary.length,5);
  assert.equal(configured.zoneSummary.reduce((x,y)=>x+y.seconds,0),2400);
});
test('short activities do not invent reliable drift; pace bands need 15 real observations',()=>{
  const run={startTime:at(0),endTime:at(40),
    heartRateSeries:[{time:at(0),value:150}],paceSeries:[],
    dynamicsSeries:[{time:at(0),powerWatts:300,verticalRatioPct:9.1}]};
  const a=garminAnalysis(run);
  assert.equal(a.aerobicDecoupling,null);
  assert.deepEqual(a.runningDynamicsByPace,[]);
  assert.equal(a.heartRateRecovery,null);
});
