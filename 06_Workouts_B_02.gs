
function detectRunWalkIntervals_(workout, start, end, heartRateSeries, stepSeries, paceSeries) {
  if (!start || !end || end <= start) return [];
  const type = String(workout && workout.type || '').toUpperCase();
  if (!type.includes('RUN')) return [];

  const minuteMs = 60000;
  const buckets = [];
  let cursor = start.getTime();
  while (cursor < end.getTime()) {
    const bucketEnd = Math.min(cursor + minuteMs, end.getTime());
    const pace = paceMetricsForWindow_(paceSeries, cursor, bucketEnd);
    const steps = (stepSeries || [])
      .filter(point => {
        const time = new Date(point.startTime || point.time).getTime();
        return time >= cursor && time < bucketEnd;
      })
      .reduce((sum, point) => sum + Number(point.intervalSteps || 0), 0);
    const minutes = Math.max(1 / 60, (bucketEnd - cursor) / 60000);
    const cadence = steps / minutes;
    const isRun = Boolean(
      (pace && pace.paceSecondsPerMile <= 16.5 * 60) || cadence >= 130
    );
    buckets.push({ start: cursor, end: bucketEnd, state: isRun ? 'run' : 'walk' });
    cursor = bucketEnd;
  }

  const merged = [];
  buckets.forEach(bucket => {
    const last = merged[merged.length - 1];
    if (last && last.state === bucket.state) {
      last.end = bucket.end;
    } else {
      merged.push(Object.assign({}, bucket));
    }
  });

  return merged.map((segment, index) => {
    const hrValues = (heartRateSeries || []).filter(point => {
      const time = new Date(point.time).getTime();
      return time >= segment.start && time < segment.end;
    }).map(point => Number(point.value)).filter(Number.isFinite);
    const pace = paceMetricsForWindow_(paceSeries, segment.start, segment.end);
    return {
      index: index + 1,
      type: segment.state,
      startTime: new Date(segment.start).toISOString(),
      endTime: new Date(segment.end).toISOString(),
      seconds: roundTo_((segment.end - segment.start) / 1000, 0),
      averageHeartRate: hrValues.length ? roundTo_(hrValues.reduce((a, b) => a + b, 0) / hrValues.length, 0) : null,
      startHeartRate: hrValues.length ? roundTo_(hrValues[0], 0) : null,
      endHeartRate: hrValues.length ? roundTo_(hrValues[hrValues.length - 1], 0) : null,
      averagePaceSecondsPerMile: pace ? roundTo_(pace.paceSecondsPerMile, 0) : null
    };
  }).filter(segment => segment.seconds >= 30);
}

function calculateWorkoutTrainingLoad_(zoneSummary) {
  const weights = { below: .5, light: 1, moderate: 2, vigorous: 3, peak: 4 };
  return roundTo_((zoneSummary || []).reduce(
    (sum, item) => sum + Number(item.minutes || 0) * (weights[item.key] || 0),
    0
  ), 1);
}

function buildWorkoutIntervalBreakdown_(start, end, heartRateSeries, stepSeries, paceSeries, zones, bucketSeconds) {
  if (!start || !end || end <= start) return [];

  const intervals = [];
  let bucketStart = new Date(start);
  let cumulativeSteps = 0;
  let index = 1;

  while (bucketStart < end) {
    const bucketEnd = new Date(Math.min(bucketStart.getTime() + bucketSeconds * 1000, end.getTime()));

    const heartWindow = (heartRateSeries || []).filter(point => {
      const time = new Date(point.time).getTime();
      return time >= bucketStart.getTime() && time < bucketEnd.getTime();
    });

    const stepWindow = (stepSeries || []).filter(point => {
      const time = new Date(point.startTime || point.time).getTime();
      return time >= bucketStart.getTime() && time < bucketEnd.getTime();
    });

    const paceWindow = (paceSeries || []).filter(point => {
      const time = new Date(point.time).getTime();
      return time >= bucketStart.getTime() && time < bucketEnd.getTime();
    });

    const steps = stepWindow.reduce((sum, point) => sum + Number(point.intervalSteps || 0), 0);
    cumulativeSteps += steps;

    const avgHeartRate = heartWindow.length
      ? roundTo_(heartWindow.reduce((sum, point) => sum + point.value, 0) / heartWindow.length, 0)
      : null;

    const maxHeartRate = heartWindow.length
      ? heartWindow.reduce((maximum, point) => Math.max(maximum, point.value), 0)
      : null;

    const durationMinutes = Math.max(1 / 60, (bucketEnd.getTime() - bucketStart.getTime()) / 60000);
    const isPartial = durationMinutes < (bucketSeconds / 60) * .75;
    const stepRate = steps && !isPartial
      ? roundTo_(steps / durationMinutes, 0)
      : null;

    const zoneInfo = heartRateZoneInfo_(avgHeartRate, zones);

    const averagePaceSecondsPerMile = paceWindow.length
      ? roundTo_(
          paceWindow.reduce((sum, point) => sum + Number(point.paceSecondsPerMile), 0) /
          paceWindow.length,
          0
        )
      : null;

    intervals.push({
      index: index,
      startTime: bucketStart.toISOString(),
      endTime: bucketEnd.toISOString(),
      label: Utilities.formatDate(bucketStart, USER_TIME_ZONE, 'h:mm a') + '–' +
        Utilities.formatDate(bucketEnd, USER_TIME_ZONE, 'h:mm a'),
      minutes: roundTo_(durationMinutes, 1),
      avgHeartRate: avgHeartRate,
      maxHeartRate: maxHeartRate,
      steps: steps,
      stepRate: stepRate,
      cumulativeSteps: cumulativeSteps,
      averagePaceSecondsPerMile: averagePaceSecondsPerMile,
      zoneKey: zoneInfo.key,
      zoneName: zoneInfo.label,
      isPartial: isPartial
    });

    bucketStart = bucketEnd;
    index += 1;
  }

  return intervals;
}



function getHeartRateSamplesForRange_(start, end) {
  if (!start || !end || end <= start) return [];

  const filter =
    `heart_rate.sample_time.physical_time >= "${start.toISOString()}" AND ` +
    `heart_rate.sample_time.physical_time < "${end.toISOString()}"`;

  const baseUrl =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/heart-rate/dataPoints' +
    '?pageSize=10000&filter=' +
    encodeURIComponent(filter);

  const points = [];
  let pageToken = '';

  do {
    const url = pageToken
      ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}`
      : baseUrl;

    const response = callHealthApi_(url);

    (response.dataPoints || []).forEach(point => {
      const heartRate = point.heartRate;
      if (!heartRate || !heartRate.sampleTime) return;

      const physicalTime = heartRate.sampleTime.physicalTime;
      const value = numericOrNull_(heartRate.beatsPerMinute);

      if (!physicalTime || value === null) return;

      points.push({
        time: physicalTime,
        value: value,
        motionContext:
          heartRate.metadata && heartRate.metadata.motionContext
            ? heartRate.metadata.motionContext
            : null,
        sensorLocation:
          heartRate.metadata && heartRate.metadata.sensorLocation
            ? heartRate.metadata.sensorLocation
            : null
      });
    });

    pageToken = response.nextPageToken || '';
  } while (pageToken);

  /*
   * list() can return overlapping records from multiple sources.
   * Deduplicate identical timestamps, favoring the last returned value.
   */
  const byTime = {};
  points.forEach(point => {
    byTime[point.time] = point;
  });

  return Object.keys(byTime)
    .sort()
    .map(time => byTime[time]);
}
