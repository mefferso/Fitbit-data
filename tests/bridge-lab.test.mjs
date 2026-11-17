import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const aerobicSource=await readFile(new URL('../docs/v2/js/aerobic-analysis.js',import.meta.url),'utf8');
const moduleUrl='data:text/javascript;base64,'+Buffer.from(aerobicSource).toString('base64');
const bridgeSource=(await readFile(new URL('../docs/v2/js/bridge-lab.js',import.meta.url),'utf8'))
  .replace("from './aerobic-analysis.js'", "from '"+moduleUrl+"'");
const {bridgeMetrics}=await import('data:text/javascript;base64,'+Buffer.from(bridgeSource).toString('base64'));

function sample(date,source){
  const start=Date.parse(date+'T14:00:00Z'),paceSeries=[],heartRateSeries=[];
  for(let t=0;t<2400;t++){
    const time=new Date(start+t*1000).toISOString();
    paceSeries.push({time,seconds:1,distanceMiles:5/3600});
    if(t%5===0)heartRateSeries.push({time,value:150+t/2400*10});
  }
  return {date,source,runId:date,startTime:new Date(start).toISOString(),
    endTime:new Date(start+2400000).toISOString(),paceSeries,heartRateSeries};
}
test('one identical bridge algorithm accepts valid legacy and Garmin raw series',()=>{
  const old=bridgeMetrics(sample('2026-10-19','fitbit'));
  const newer=bridgeMetrics(sample('2026-11-16','garmin'));
  assert.equal(old.ok,true);
  assert.equal(newer.ok,true);
  assert.equal(old.efficiency,newer.efficiency);
  assert.equal(old.decoupling,newer.decoupling);
  assert.equal(old.source,'Fitbit');
  assert.equal(newer.source,'Garmin');
});
test('November 11 invalid pace trace is permanently excluded from bridge',()=>{
  const item=bridgeMetrics(sample('2026-11-11','fitbit'));
  assert.equal(item.ok,false);
  assert.match(item.reason,/Invalid TCX/);
  assert.equal(item.efficiency,null);
});
test('missing samples do not become zeros or fabricated bridge scores',()=>{
  const item=sample('2026-11-17','garmin');
  item.paceSeries=[];
  const result=bridgeMetrics(item);
  assert.equal(result.ok,false);
  assert.equal(result.matched,null);
  assert.equal(result.decoupling,null);
});
