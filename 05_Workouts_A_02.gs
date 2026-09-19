
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

  /*
   * Outdoor Fitbit workouts can expose the detailed TCX GPS route at a much
   * higher cadence than the generic distance telemetry. Prefer those
   * non-overlapping trackpoint-to-trackpoint distance increments for pace.
   * If TCX is unavailable for any reason, fall back to the existing 60-second
   * distance rollups so older / indoor workouts still work.
   */
  let paceSeries = [];
  let paceSeriesSmoothed = [];
  let paceSeriesSmoothed10 = [];
  let paceSeriesSmoothed30 = [];
  let paceSeriesSource = 'distance-rollup';
  let paceRawLabel = '1-min pace';
  let paceSmoothedLabel = '3-min pace';
  let paceDiagnostics = {
    source: 'distance-rollup',
    tcxAttempted: false,
    tcxError: null,
    trackpointCount: null,
    usablePaceIntervals: null,
    medianSeconds: 60,
    p25Seconds: 60,
    p75Seconds: 60,
    minSeconds: 60,
    maxSeconds: 60,
    smoothingSeconds: 180
  };

  if (workout.hasGps && workout.resourceName) {
    paceDiagnostics.tcxAttempted = true;
    try {
      const tcxRoute = getWorkoutRouteData(workout.resourceName);
      const tcxPoints = tcxRoute && tcxRoute.points ? tcxRoute.points : [];
      const cadence = summarizeTcxCadence_(tcxPoints);
      const tcxPace = buildTcxPaceSeries_(tcxPoints);

      if (tcxPace.length) {
        paceSeries = tcxPace;
        paceSeriesSmoothed10 = smoothWorkoutPaceSeriesByTime_(tcxPace, 10);
        paceSeriesSmoothed30 = smoothWorkoutPaceSeriesByTime_(tcxPace, 30);
        paceSeriesSmoothed = paceSeriesSmoothed10;
        paceSeriesSource = 'tcx';
        paceRawLabel = '1-sec raw';
        paceSmoothedLabel = '10-sec responsive';
        paceDiagnostics = Object.assign({}, cadence, {
          source: 'tcx',
          tcxAttempted: true,
          tcxError: null,
          usablePaceIntervals: tcxPace.length,
          smoothingSeconds: 10,
          smoothingOptionsSeconds: [10, 30]
        });
      } else {
        paceDiagnostics = Object.assign({}, paceDiagnostics, cadence, {
          tcxError: `TCX returned ${cadence.trackpointCount || 0} trackpoints but no usable distance intervals.`
        });
      }
    } catch (error) {
      paceDiagnostics.tcxError = error && error.message ? error.message : String(error);
      console.warn(`TCX pace unavailable for ${workout.resourceName}: ${paceDiagnostics.tcxError}`);
    }
  }

  if (!paceSeries.length) {
    paceSeries = buildWorkoutPaceSeries_(start, end, distanceRollups);
    paceSeriesSmoothed = smoothWorkoutPaceSeries_(paceSeries, 3);
    paceSeriesSmoothed10 = [];
    paceSeriesSmoothed30 = [];
    paceDiagnostics.usablePaceIntervals = paceSeries.length;
  }
  const intervalBreakdown = buildWorkoutIntervalBreakdown_(
    start, end, heartRateSeries, stepSeries, paceSeries, zones, 300
  );
  const runWalkIntervals = detectRunWalkIntervals_(
    workout, start, end, heartRateSeries, stepSeries,
    paceSeriesSource === 'tcx' && paceSeriesSmoothed10.length
      ? paceSeriesSmoothed10
      : paceSeries
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
    paceSeriesSmoothed10: paceSeriesSmoothed10,
    paceSeriesSmoothed30: paceSeriesSmoothed30,
    paceSeriesSource: paceSeriesSource,
    paceRawLabel: paceRawLabel,
    paceSmoothedLabel: paceSmoothedLabel,
    paceDiagnostics: paceDiagnostics,
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
