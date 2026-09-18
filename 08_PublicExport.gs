/* =========================================================
   PUBLIC GITHUB PAGES EXPORT
   ========================================================= */

function handlePublicDataExport_(e) {
  const expectedKey = String(
    PropertiesService.getScriptProperties().getProperty('PUBLIC_EXPORT_KEY') || ''
  ).trim();
  const suppliedKey = String(
    e && e.parameter ? (e.parameter.key || '') : ''
  ).trim();

  if (!expectedKey || !suppliedKey || suppliedKey !== expectedKey) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify(getPublicWorkoutExport_()))
    .setMimeType(ContentService.MimeType.JSON);
}

function getPublicWorkoutExport_() {
  const lookbackDays = 180;
  const detailRunCount = 8;
  const end = addDays_(new Date(), 1);
  const start = addDays_(new Date(), -lookbackDays);

  const runRecords = getWorkoutRecordsForRange_(start, end)
    .filter(workout => String(workout.type || '').toUpperCase().includes('RUN'))
    .sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));

  const recentRuns = runRecords.slice(0, 30).map(workout => ({
    date: workout.date,
    startTime: workout.startTime,
    activeSeconds: workout.activeSeconds,
    distanceMiles: workout.distanceMiles,
    averagePaceSecondsPerMile: workout.averagePaceSecondsPerMile,
    averageHeartRate: workout.averageHeartRate,
    steps: workout.steps,
    activeZoneMinutes: workout.activeZoneMinutes,
    runVo2Max: workout.runVo2Max
  }));

  const detailedRuns = runRecords.slice(0, detailRunCount).map(workout => {
    const zones = getHeartRateZonesForDate_(workout.date);
    const detail = buildWorkoutDetail_(workout, zones);
    return {
      date: detail.date,
      startTime: detail.startTime,
      endTime: detail.endTime,
      activeSeconds: detail.activeSeconds,
      distanceMiles: detail.distanceMiles,
      averagePaceSecondsPerMile: detail.averagePaceSecondsPerMile,
      averageHeartRate: detail.averageHeartRateActual,
      peakHeartRate: detail.peakHeartRate,
      steps: detail.steps,
      averageStepRate: detail.averageStepRate,
      activeZoneMinutes: detail.activeZoneMinutes,
      vigorousPlusPeakMinutes: detail.vigorousPlusPeakMinutes,
      trainingLoad: detail.trainingLoad,
      aerobicDecoupling: detail.aerobicDecoupling,
      heartRateRecovery: detail.heartRateRecovery,
      zoneSummary: detail.zoneSummary,
      runWalkIntervals: detail.runWalkIntervals,
      splitSummaries: detail.splitSummaries,
      paceSeries: (detail.paceSeries || []).map(point => ({
        time: point.time,
        paceSecondsPerMile: point.paceSecondsPerMile
      })),
      heartRateSeries: downsamplePublicHeartRate_(detail.heartRateSeries || [], 600)
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    timeZone: USER_TIME_ZONE,
    lookbackDays: lookbackDays,
    publicDataNotice: 'Workout/running metrics only. GPS coordinates, sleep, weight, OAuth credentials and tokens are not included.',
    recentRuns: recentRuns,
    detailedRuns: detailedRuns,
    runningTrend: safeDashboardSection_(function() {
      return getRunningTrendData(lookbackDays);
    }, { days: lookbackDays, runs: [], vo2Max: [] }),
    trainingLoad: safeDashboardSection_(function() {
      return getTrainingLoadData(120);
    }, { days: 120, points: [], summary: {} })
  };
}

function downsamplePublicHeartRate_(series, maxPoints) {
  const points = series || [];
  const limit = Math.max(50, Number(maxPoints) || 600);

  if (points.length <= limit) {
    return points.map(point => ({
      time: point.time,
      value: point.value,
      zoneKey: point.zoneKey
    }));
  }

  const step = points.length / limit;
  const result = [];

  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.min(points.length - 1, Math.floor(index * step))];
    result.push({
      time: point.time,
      value: point.value,
      zoneKey: point.zoneKey
    });
  }

  return result;
}
