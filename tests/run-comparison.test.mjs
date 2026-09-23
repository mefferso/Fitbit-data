import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1].replace(/\binit\(\);\s*$/,'');
assert.ok(script,'dashboard script exists');
const context=vm.createContext({});
vm.runInContext(script,context);

const run={startTime:'2026-09-22T12:00:00Z',activeSeconds:1800,heartRateSeries:[
  {time:'2026-09-22T12:00:10Z',value:100},
  {time:'2026-09-22T12:05:00Z',value:155},
  {time:'2026-09-22T12:32:00Z',value:180},
  {time:'invalid',value:120},
  {time:'2026-09-22T12:02:00Z',value:null}
]};
const points=context.comparisonHeartRatePoints(run);
assert.deepEqual(JSON.parse(JSON.stringify(points)),[{x:10/60,y:100},{x:5,y:155}]);
assert.equal(context.comparisonHeartRatePoints({heartRateSeries:[]}).length,0);
assert.deepEqual(JSON.parse(JSON.stringify(context.comparisonRange([run,{activeSeconds:2700,heartRateSeries:[{time:'2026-09-23T10:00:00Z',value:120}]}]))),{maxMinutes:45,minBpm:90,maxBpm:170});
console.log('Run comparison elapsed-time and shared-scale checks passed');

const elements=new Map();
const element=id=>elements.get(id)||elements.set(id,{value:'',innerHTML:'',textContent:'',addEventListener(){}}).get(id);
const rendered=[];
context.document={getElementById:element};
context.Chart=class {constructor(canvas,config){this.canvas=canvas;this.config=config;rendered.push(this);}destroy(){}};
const second={date:'2026-09-19',startTime:'2026-09-19T18:00:00Z',activeSeconds:2700,
  averageHeartRate:140,heartRateSeries:[{time:'2026-09-19T18:00:00Z',value:120},{time:'2026-09-19T18:20:00Z',value:165}]};
run.date='2026-09-22';run.averageHeartRate=130;
vm.runInContext(`DATA=${JSON.stringify({detailedRuns:[run,second,{date:'2026-09-17',heartRateSeries:[]}]})}`,context);
context.renderRunComparison();
assert.equal(element('compare-a').value,'0');
assert.equal(element('compare-b').value,'1');
assert.equal(rendered.length,2);
assert.equal(rendered[0].config.options.scales.x.min,0);
assert.equal(rendered[0].config.options.scales.x.max,rendered[1].config.options.scales.x.max);
assert.equal(rendered[0].config.options.scales.y.max,rendered[1].config.options.scales.y.max);
assert.equal(rendered[1].config.data.datasets[0].data[1].x,20);
assert.ok(!element('compare-a').innerHTML.includes('Sep 17'));
console.log('Run selector and paired-chart checks passed');
