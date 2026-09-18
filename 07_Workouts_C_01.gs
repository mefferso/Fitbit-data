function getHeartRateZonesForDate_(dateKey) {
  try {
    const nextDateKey = addDaysToDateKey_(dateKey, 1);
    const filter =
      `daily_heart_rate_zones.date >= "${dateKey}" AND ` +
      `daily_heart_rate_zones.date < "${nextDateKey}"`;

    const url =
      'https://health.googleapis.com/v4/users/me/' +
      'dataTypes/daily-heart-rate-zones/dataPoints' +
      '?pageSize=10&filter=' +
      encodeURIComponent(filter);

    const response = callHealthApi_(url);
    const records = (response.dataPoints || [])
      .map(point => point.dailyHeartRateZones)
      .filter(Boolean);

    if (!records.length) {
      return getLatestHeartRateZones_();
    }

    const result = emptyHeartRateZones_();
    const record = records[0];

    (record.heartRateZones || []).forEach(zone => {
      const minimum = numericOrNull_(zone.minBeatsPerMinute);
      const maximum = numericOrNull_(zone.maxBeatsPerMinute);

      if (zone.heartRateZoneType === 'LIGHT') {
        result.lightMin = minimum;
        result.lightMax = maximum;
      } else if (zone.heartRateZoneType === 'MODERATE') {
        result.moderateMin = minimum;
        result.moderateMax = maximum;
      } else if (zone.heartRateZoneType === 'VIGOROUS') {
        result.vigorousMin = minimum;
        result.vigorousMax = maximum;
      } else if (zone.heartRateZoneType === 'PEAK') {
        result.peakMin = minimum;
        result.peakMax = maximum;
      }
    });

    result.date = healthDateKey_(record.date);
    result.source = 'Fitbit daily heart-rate zones for workout date';
    return result;
  } catch (error) {
    console.error(error);
    return getLatestHeartRateZones_();
  }
}


function extractWorkoutZoneDurations_(durations) {
  const source = durations || {};
  const result = {
    lightSeconds: parseGoogleDurationSeconds_(source.lightTime) || 0,
    moderateSeconds: parseGoogleDurationSeconds_(source.moderateTime) || 0,
    vigorousSeconds: parseGoogleDurationSeconds_(source.vigorousTime) || 0,
    peakSeconds: parseGoogleDurationSeconds_(source.peakTime) || 0
  };

  result.hasData =
    result.lightSeconds +
    result.moderateSeconds +
    result.vigorousSeconds +
    result.peakSeconds > 0;

  return result;
}


function summarizeWorkoutZoneDurations_(durations, zones, activeSeconds) {
  const trackedSeconds =
    Number(durations.lightSeconds || 0) +
    Number(durations.moderateSeconds || 0) +
    Number(durations.vigorousSeconds || 0) +
    Number(durations.peakSeconds || 0);

  const belowSeconds = Math.max(
    0,
    Number(activeSeconds || trackedSeconds) - trackedSeconds
  );

  const totalSeconds = Math.max(1, trackedSeconds + belowSeconds);
  const rows = [
    ['peak', 'Peak', Number(durations.peakSeconds || 0)],
    ['vigorous', 'Vigorous', Number(durations.vigorousSeconds || 0)],
    ['moderate', 'Moderate', Number(durations.moderateSeconds || 0)],
    ['light', 'Light', Number(durations.lightSeconds || 0)],
    ['below', 'Below light', belowSeconds]
  ];

  return rows.map(item => ({
    key: item[0],
    label: item[1],
    seconds: item[2],
    minutes: roundTo_(item[2] / 60, 1),
    percent: roundTo_(item[2] / totalSeconds * 100, 0),
    threshold: workoutZoneThresholdLabel_(item[0], zones)
  }));
}


function extractWorkoutPaceSecondsPerMile_(metrics, distanceMiles, activeSeconds) {
  const secondsPerMeter = numericOrNull_(metrics && metrics.averagePaceSecondsPerMeter);

  if (secondsPerMeter !== null && secondsPerMeter > 0) {
    return roundTo_(secondsPerMeter * 1609.344, 0);
  }

  if (distanceMiles && activeSeconds) {
    return roundTo_(activeSeconds / distanceMiles, 0);
  }

  return null;
}


function extractWorkoutMobilityMetrics_(mobilityMetrics) {
  const source = mobilityMetrics || {};

  return {
    cadenceStepsPerMinute: numericOrNull_(source.avgCadenceStepsPerMinute),
    strideLengthMillimeters: numericOrNull_(source.avgStrideLengthMillimeters),
    groundContactTimeSeconds: parseGoogleDurationSeconds_(source.avgGroundContactTimeDuration),
    verticalOscillationMillimeters: numericOrNull_(source.avgVerticalOscillationMillimeters),
    verticalRatio: numericOrNull_(source.avgVerticalRatio)
  };
}



function extractWorkoutSplits_(splits) {
  return (splits || []).map((split, index) => {
    const metrics = split.metricsSummary || {};
    const distanceMiles = extractWorkoutDistanceMiles_(metrics);
    const activeSeconds = parseGoogleDurationSeconds_(split.activeDuration) ||
      (split.startTime && split.endTime
        ? Math.max(0, (new Date(split.endTime).getTime() - new Date(split.startTime).getTime()) / 1000)
        : null);
    return {
      index: index + 1,
      type: split.splitType || 'UNKNOWN',
      startTime: split.startTime || null,
      endTime: split.endTime || null,
      activeSeconds: activeSeconds,
      distanceMiles: distanceMiles,
      paceSecondsPerMile: extractWorkoutPaceSecondsPerMile_(metrics, distanceMiles, activeSeconds),
      averageHeartRate: extractFirstNumber_(metrics, [
        'averageHeartRateBeatsPerMinute', 'averageHeartRate', 'heartRateAvg'
      ]),
      calories: extractFirstNumber_(metrics, ['caloriesKcal', 'energyBurnedKcal', 'kilocalories', 'kcal'])
    };
  });
}

function getWorkoutDateKey_(exercise) {
  if (
    exercise.interval &&
    exercise.interval.civilStartTime &&
    exercise.interval.civilStartTime.date
  ) {
    return healthDateKey_(exercise.interval.civilStartTime.date);
  }

  if (
    exercise.interval &&
    exercise.interval.startTime
  ) {
    return Utilities.formatDate(
      new Date(exercise.interval.startTime),
      USER_TIME_ZONE,
      'yyyy-MM-dd'
    );
  }

  return '';
}


function buildWorkoutId_(dateKey, startTime, type) {
  return [
    dateKey || 'unknown',
    startTime || 'no-start',
    String(type || 'unknown').replace(/\s+/g, '_')
  ].join('|');
}


function extractWorkoutDisplayName_(exercise, type) {
  return String(
    exercise.displayName ||
    exercise.title ||
    exercise.name ||
    prettifyWorkoutType_(type)
  );
}


function prettifyWorkoutType_(type) {
  return String(type || 'Workout')
    .replace(/^EXERCISE_TYPE_/, '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}


function parseGoogleDurationSeconds_(duration) {
  if (!duration) return null;
  const match = String(duration).match(/^([\d.]+)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}


function extractWorkoutDistanceMiles_(metrics) {
  const millimeters = extractFirstNumber_(metrics, [
    'distanceMillimeters',
    'distanceMm'
  ]);

  if (millimeters !== null) {
    return roundTo_(millimeters / 1609344, 2);
  }

  const meters = extractFirstNumber_(metrics, [
    'distanceMeters',
    'distanceM'
  ]);

  if (meters !== null) {
    return roundTo_(meters / 1609.344, 2);
  }

  return null;
}
