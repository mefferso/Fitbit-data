/**
 * Garmin-Nov16 override: change public summaries to Garmin source without
 * producing a duplicate or altering weather, archived Fitbit records, or the
 * shape of source privacy-safe routes. Called AFTER original Google builder.
 *
 * The Google builder is still the source for weather and post-run recovery.
 * Never misrepresent a Google-derived trace as Garmin-derived.
 */
import fs from 'node:fs/promises';
const path='.garmin-staging/nov16.json';
const g=JSON.parse(await fs.readFile(path,'utf8'));
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async (p,x)=>fs.writeFile(p,JSON.stringify(x));
const index=await read('docs/data/run-index.json');
const matches=index.runs.filter(x=>x.startTime===g.targetStartTime && x.date==='2026-11-16');
if(matches.length!==1)throw Error('Ambiguous Garmin/Google workout match: refusing modification');
const record=matches[0];
if(!record.detailFile)throw Error('Matched run lacks existing detail archive');
const detailPath='docs/'+record.detailFile;
const originalDetail=await read(detailPath);
const data=await read('docs/data.json');
const latest=await read('docs/data/latest.json');
const trends=await read('docs/data/trends.json');
const matchesTime=x=>x?.startTime===g.targetStartTime;
const count=(a)=>a.filter(matchesTime).length;
if(count(data.recentRuns)!==1||count(data.detailedRuns)!==1||count(index.runs)!==1)
  throw Error('Garmin override would affect unexpected number of records');
if(g.source!=='garmin'||g.activeSeconds<=0||g.distanceMiles<=0||
   !Number.isFinite(g.averagePaceSecondsPerMile))
  throw Error('Garmin measurement validation failed');
const b=(x)=>({
  ...x,
  source:'garmin',
  sourceActivityId:g.sourceActivityId,
  sourceStartTime:g.sourceStartTime,
  sourceEndTime:g.sourceEndTime,
  activeSeconds:g.activeSeconds,
  distanceMiles:g.distanceMiles,
  averagePaceSecondsPerMile:g.averagePaceSecondsPerMile,
  averageHeartRate:g.averageHeartRate,
  peakHeartRate:g.peakHeartRate
});
const originalSummary={
  source:'google-health',
  activeSeconds:originalDetail.activeSeconds,
  distanceMiles:originalDetail.distanceMiles,
  averagePaceSecondsPerMile:originalDetail.averagePaceSecondsPerMile,
  averageHeartRate:originalDetail.averageHeartRate,
  peakHeartRate:originalDetail.peakHeartRate
};
// Preserve separately sourced data with explicit provenance; don't manufacture
// Garmin GPS pace, Garmin HR recovery, or Garmin-specific Fitbit zone load.
const detailed={
  ...b(originalDetail),
  sourceComparison:originalSummary,
  garminMetrics:g.garminMetrics,
  heartRateSeries:g.heartRateSeries.map(x=>({...x,zoneKey:null})),
  heartRateSeriesSource:'garmin-fit',
  paceSeriesSource:originalDetail.paceSeriesSource+' (Google Health; secondary)',
  paceDiagnostics:{
    ...originalDetail.paceDiagnostics,
    note:'Pace trace and privacy-safe route remain Google Health secondary data. Garmin FIT summary is authoritative.'
  },
  routeSource:'google-health-privacy-safe',
  zoneSummarySource:'google-health-legacy',
  heartRateRecoverySource:'google-health-legacy',
  aerobicDecoupling:null,
  trainingLoad:null,
  dataSourceNotice:'Garmin summary/heart-rate series, Tempest weather, Google Health secondary pace/route and recovery. Avoid interpreting mixed-source drift as a Garmin measurement.'
};
data.recentRuns=data.recentRuns.map(x=>matchesTime(x)?b(x):x);
data.detailedRuns=data.detailedRuns.map(x=>matchesTime(x)?detailed:x);
const updatedIndex=index.runs.map(x=>matchesTime(x)?{
  ...b(x),
  cardioDriftPercent:null,
  trainingLoad:null,
  adjustedPerformanceIndex:null
}:x);
const patchTrend=(obj)=>{
  if(Array.isArray(obj?.runningTrend?.runs))
    obj.runningTrend.runs=obj.runningTrend.runs.map(x=>matchesTime(x)?{
      ...x, distanceMiles:g.distanceMiles,
      averagePaceSecondsPerMile:g.averagePaceSecondsPerMile,
      averageHeartRate:g.averageHeartRate,
      efficiency:g.averageHeartRate
        ? Math.round(((3600/g.averagePaceSecondsPerMile)/g.averageHeartRate)*10000)/10000
        : null
    }:x);
  if(Array.isArray(obj?.runningTrend?.weatherAdjusted?.runs))
    obj.runningTrend.weatherAdjusted.runs=obj.runningTrend.weatherAdjusted.runs.map(x=>
      matchesTime(x)?{...x,score:null,adjustedEfficiency:null,rawEfficiency:null}:x);
};
patchTrend(data);patchTrend(trends);
if(matchesTime(latest.run))latest.run=detailed;
const indexOut={...index,runs:updatedIndex};
const updates=[
  [detailPath,detailed],
  ['docs/data.json',data],
  ['docs/data/latest.json',latest],
  ['docs/data/run-index.json',indexOut],
  ['docs/data/trends.json',trends]
];
// Verify everything before writing.
for(const [,content] of updates)JSON.stringify(content);
for(const [p,content] of updates)await write(p,content);
console.log('Applied single-run Garmin FIT override to Nov 16; maintained original archive path and Tempest weather.');
