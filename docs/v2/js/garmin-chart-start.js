/**
 * Only trim brief pre-movement startup artifacts in Garmin FIT charts.
 * Never modify the original run or its summary statistics.
 *
 * An actual running start needs three consecutive 1–2s FIT samples
 * showing running cadence *and* corroborating power/dynamics. A bounded
 * 30-second search prevents removing genuine walk-to-run warmups.
 */
export function detectChartStart(details, maxStartupSeconds=30) {
  const original=details?.startTime;
  const startMs=Date.parse(original);
  if(!Number.isFinite(startMs)) return {startTime:original,trimmedSeconds:0};
  const samples=Array.isArray(details?.dynamicsSeries)?details.dynamicsSeries:[];
  let streak=0, first=null, previousMs=null;
  for(const sample of samples){
    const at=Date.parse(sample.time);
    if(!Number.isFinite(at)||at<startMs)continue;
    if(at-startMs>maxStartupSeconds*1000)break;
    const cadence=Number(sample.cadenceSpm);
    const power=Number(sample.powerWatts);
    const contact=Number(sample.groundContactMs);
    const oscillation=Number(sample.verticalOscillationCm);
    const moving=Number.isFinite(cadence)&&cadence>=120&&cadence<=260&&(
      (sample.powerWatts!=null&&Number.isFinite(power)&&power>=140)||
      (sample.groundContactMs!=null&&Number.isFinite(contact)&&contact>=180&&contact<=500)||
      (sample.verticalOscillationCm!=null&&Number.isFinite(oscillation)&&oscillation>=6&&oscillation<=15)
    );
    if(!moving || (previousMs!==null&&at-previousMs>2500)){
      streak=0;first=null;
    }
    if(moving){
      if(streak===0)first=sample.time;
      streak++;
      if(streak>=3){
        return {startTime:first,trimmedSeconds:Math.round((Date.parse(first)-startMs)/1000)};
      }
      previousMs=at;
    }else previousMs=null;
  }
  return {startTime:original,trimmedSeconds:0};
}
