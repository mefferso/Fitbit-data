
function buildWorkoutDetail_(workout, zones) {
  const start = workout.startTime ? new Date(workout.startTime) : null;
  const end = workout.endTime
    ? new Date(workout.endTime)
    : (start && workout.activeSeconds
      ? new Date(start.getTime() + workout.activeSeconds * 1000)
      : null);

  const heartRatePoints =
    start && end && end > start
      ? getHeartRateSamplesForRange_(start, end)
      : [];

  const recoveryHeartRatePoints =
    end
      ? getHeartRateSamplesForRange_(new Date(end.getTime() - 60000), new Date(end.getTime() + 5 * 60000))
      : [];

  const stepRollups =
    start && end && end > start
      ? getStepPhysicalRollups_(start, end, 60)
      : [];

  const distanceRollups =
    start && end && end > start
      ? getDistancePhysicalRollups_(start, end, 60)
      : [];

  const heartRateSeries = heartRatePoints.map(point => {
    const value = point && point.value !== undefined ? Number(point.value) : null;
    const zone = heartRateZoneInfo_(value, zones);
    return {
      time: point.time,
      value: value,
      zoneKey: zone.key,
      zoneName: zone.label
    };
  }).filter(point => Number.isFinite(point.value));

  const peakPoint = heartRateSeries.reduce((best, point) => {
    if (!best || point.value > best.value) return point;
    return best;
  }, null);

  const actualAverageHeartRate = heartRateSeries.length
    ? roundTo_(heartRateSeries.reduce((sum, point) => sum + point.value, 0) / heartRateSeries.length, 0)
    : workout.averageHeartRate;

  const zoneSummary =
    workout.zoneDurations && workout.zoneDurations.hasData
      ? summarizeWorkoutZoneDurations_(workout.zoneDurations, zones, workout.activeSeconds)
      : summarizeWorkoutZones_(heartRateSeries, zones, start, end);

  const stepSeries = buildWorkoutStepSeries_(start, end, stepRollups);
  const paceSeries = buildWorkoutPaceSeries_(start, end, distanceRollups);
  const paceSeriesSmoothed = smoothWorkoutPaceSeries_(paceSeries, 3);
  const intervalBreakdown = buildWorkoutIntervalBreakdown_(
    start, end, heartRateSeries, stepSeries, paceSeries, zones, 300
  );
  const runWalkIntervals = detectRunWalkIntervals_(
    workout, start, end, heartRateSeries, stepSeries, paceSeries
  );
  const aerobicDecoupling = calculateAerobicDecoupling_(
    start, end, heartRateSeries, paceSeries
  );
  const heartRateRecovery = calculateHeartRateRecovery_(
    end, recoveryHeartRatePoints
  );

  const vigorousSeconds = zoneSummary
    .filter(item => item.key === 'vigorous' || item.key === 'peak')
    .reduce((sum, item) => sum + item.seconds, 0);

  return Object.assign({}, workout, {
    startTime: start ? start.toISOString() : workout.startTime,
    endTime: end ? end.toISOString() : workout.endTime,
    averageHeartRateActual: actualAverageHeartRate,
    peakHeartRate: peakPoint ? peakPoint.value : null,
    peakHeartTime: peakPoint ? peakPoint.time : null,
    vigorousPlusPeakMinutes: roundTo_(vigorousSeconds / 60, 0),
    heartRateSeries: heartRateSeries,
    stepSeries: stepSeries,
    paceSeries: paceSeries,
    paceSeriesSmoothed: paceSeriesSmoothed,
    zoneSummary: zoneSummary,
    intervalBreakdown: intervalBreakdown,
    runWalkIntervals: runWalkIntervals,
    aerobicDecoupling: aerobicDecoupling,
    heartRateRecovery: heartRateRecovery,
    trainingLoad: calculateWorkoutTrainingLoad_(zoneSummary),
    zonesDate: zones && zones.date ? zones.date : workout.date
  });
}


function buildWorkoutStepSeries_(start, end, rollups) {
  const points = [];
  let cumulative = 0;

  if (!start || !end || end <= start) return points;

  const sorted = (rollups || []).slice().sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  sorted.forEach(point => {
    if (!point || !point.startTime) return;

    const intervalSteps = point.steps && point.steps.countSum !== undefined
      ? Number(point.steps.countSum)
      : 0;

    cumulative += Number.isFinite(intervalSteps) ? intervalSteps : 0;

    points.push({
      startTime: point.startTime,
      endTime: point.endTime || point.startTime,
      time: point.endTime || point.startTime,
      intervalSteps: Number.isFinite(intervalSteps) ? intervalSteps : 0,
      cumulativeSteps: cumulative
    });
  });

  return points;
}


function getDistancePhysicalRollups_(start, end, windowSeconds) {
  if (!start || !end || end <= start) return [];

  const url =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/distance/dataPoints:rollUp';

  const points = [];
  let pageToken = '';

  do {
    const payload = {
      range: {
        startTime: start.toISOString(),
        endTime: end.toISOString()
      },
      windowSize: `${windowSeconds}s`,
      pageSize: Math.max(
        1,
        Math.ceil((end.getTime() - start.getTime()) / (windowSeconds * 1000))
      )
    };

    if (pageToken) {
      payload.pageToken = pageToken;
    }

    const response = callHealthApi_(url, {
      method: 'post',
      payload: payload
    });

    points.push.apply(points, response.rollupDataPoints || []);
    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return points.sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}
