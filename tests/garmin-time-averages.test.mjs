import test from 'node:test';
import assert from 'node:assert/strict';
import {averageTimeline} from '../docs/v2/js/garmin-time-averages.js';
const base=Date.parse('2026-11-16T21:22:41Z');
const at=sec=>new Date(base+1000*sec).toISOString();
test('1-minute averaging anchors to moving start, not clock minutes',()=>{
  const samples=[{time:at(0),value:140},{time:at(30),value:160},
    {time:at(60),value:170},{time:at(120),value:150}];
  const b=averageTimeline(samples,'value',at(0),60);
  assert.deepEqual(b.map(x=>x.value),[150,170,150]);
  assert.deepEqual(b.map(x=>x.samples),[2,1,1]);
});
test('missing buckets are not interpolated and 5-minute averaging works',()=>{
  const b=averageTimeline([{time:at(0),value:130},{time:at(310),value:150}],
    'value',at(0),300);
  assert.equal(b.length,2);
  assert.equal(b[1].value,150);
});
test('pace uses mean speed, not arithmetic mean of seconds per mile',()=>{
  const s=[{time:at(5),paceSecondsPerMile:600},{time:at(25),paceSecondsPerMile:1200}];
  const b=averageTimeline(s,'paceSecondsPerMile',at(0),60,{pace:true});
  assert.ok(Math.abs(b[0].paceSecondsPerMile-800)<0.001);
});
test('all offered intervals and startup trimming are supported',()=>{
  for(const d of [1,15,30,60,300])assert.equal(averageTimeline([{time:at(20),value:5}], 'value',at(21),d).length,0);
});
