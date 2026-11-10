import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Load the browser module without changing the existing Pages module setup.
const source=await readFile(new URL('../docs/v2/js/aerobic-analysis.js',import.meta.url),'utf8');
const {analyzeAerobicRun}=await import('data:text/javascript,'+encodeURIComponent(source));
function run(type='steady'){
  const start=Date.parse('2026-11-10T14:00:00Z'),paceSeries=[],heartRateSeries=[];
  for(let t=0;t<2400;t++){
    const minute=t/60;
    const speed=type==='progression'?5+minute/40:
      type==='intervals'&&minute>=15?(Math.floor((minute-15)/5)%2===0?6:5):5;
    paceSeries.push({time:new Date(start+t*1000).toISOString(),seconds:1,distanceMiles:speed/3600});
    if(t%5===0)heartRateSeries.push({time:new Date(start+t*1000).toISOString(),
      value:145+minute/40*(type==='progression'?22:10)});
  }
  return {startTime:new Date(start).toISOString(),endTime:new Date(start+2400000).toISOString(),paceSeries,heartRateSeries};
}
test('constant speed with increasing HR yields positive steady drift',()=>{
  const a=analyzeAerobicRun(run());
  assert.equal(a.classification,'Easy / steady');
  assert.equal(a.quality,'usable');
  assert.ok(a.steadyDriftPercent>0);
});
test('progressive speed is not mistaken for a steady aerobic benchmark',()=>{
  const a=analyzeAerobicRun(run('progression'));
  assert.match(a.classification,/Progression/);
  assert.equal(a.steadyDriftPercent,null);
});
test('repeated tempos are classified as intervals, not low drift',()=>{
  const a=analyzeAerobicRun(run('intervals'));
  assert.match(a.classification,/Intervals/);
  assert.equal(a.steadyDriftPercent,null);
});
test('missing HR data never produces a misleading drift number',()=>{
  const d=run();d.heartRateSeries=[];
  assert.equal(analyzeAerobicRun(d).steadyDriftPercent,null);
});
