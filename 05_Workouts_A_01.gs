/* =========================================================
   WORKOUT CALENDAR + DAY DETAILS
   ========================================================= */

function getWorkoutMonthData(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) {
    throw new Error('Invalid workout month. Expected YYYY-MM.');
  }

  const startKey = `${monthKey}-01`;
  validateDateKey_(startKey);

  const nextMonthKey = addMonthsToDateKey_(startKey, 1);
  const start = localMidnightFromDateKey_(startKey);
  const end = localMidnightFromDateKey_(nextMonthKey);
  const todayKey = formatDateKey_(new Date());

  const workouts = getWorkoutRecordsForRange_(start, end)
    .filter(item => item.date >= startKey && item.date < nextMonthKey)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return String(a.startTime || '').localeCompare(String(b.startTime || ''));
    });

  return {
    monthKey: monthKey,
    startDate: startKey,
    endDateExclusive: nextMonthKey,
    isCurrentMonth: monthKey === todayKey.slice(0, 7),
    workouts: workouts
  };
}


function getWorkoutCalendar_(days) {
  const totalDays = Math.max(1, Number(days) || 90);
  const today = new Date();
  const tomorrow = addDays_(today, 1);
  const cutoffKey = formatDateKey_(addDays_(today, -(totalDays - 1)));
  const workouts = getWorkoutRecordsForRange_(addDays_(today, -(totalDays + 7)), tomorrow);

  return workouts
    .filter(item => item.date >= cutoffKey)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return String(a.startTime || '').localeCompare(String(b.startTime || ''));
    });
}


function getWorkoutDayDetails(dateKey) {
  validateDateKey_(dateKey);

  const dayStart = localMidnightFromDateKey_(dateKey);
  const dayEnd = localMidnightFromDateKey_(addDaysToDateKey_(dateKey, 1));
  const zones = getHeartRateZonesForDate_(dateKey);

  const workouts = getWorkoutRecordsForRange_(dayStart, dayEnd)
    .filter(item => item.date === dateKey)
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')))
    .map(item => buildWorkoutDetail_(item, zones));

  return {
    date: dateKey,
    zones: zones,
    workouts: workouts
  };
}


function getWorkoutRecordsForRange_(start, end) {
  const filter =
    `exercise.interval.civil_start_time >= "${formatDateKey_(start)}"`;

  const baseUrl =
    'https://health.googleapis.com/v4/users/me/' +
    'dataTypes/exercise/dataPoints' +
    '?pageSize=200&filter=' +
    encodeURIComponent(filter);

  let pageToken = '';
  const workouts = [];

  do {
    const url = pageToken
      ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}`
      : baseUrl;

    const response = callHealthApi_(url);

    (response.dataPoints || []).forEach(point => {
      const exercise = point.exercise;
      if (!exercise || !exercise.interval) return;

      const interval = exercise.interval || {};
      const metrics = exercise.metricsSummary || exercise.summary || {};
      const startTime = interval.startTime || null;
      const endTime = interval.endTime || null;
      const startDate = startTime ? new Date(startTime) : null;

      if (startDate && startDate < start) return;
      if (startDate && startDate >= end) return;

      const dateKey = getWorkoutDateKey_(exercise);
      if (!dateKey) return;

      const type =
        String(
          exercise.exerciseType ||
          exercise.activityType ||
          exercise.exerciseName ||
          'EXERCISE_TYPE_UNSPECIFIED'
        );

      const distanceMiles = extractWorkoutDistanceMiles_(metrics);
      const activeSeconds =
        parseGoogleDurationSeconds_(
          exercise.activeDuration ||
          exercise.duration ||
          metrics.activeDuration
        ) ||
        (startTime && endTime
          ? Math.max(0, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000))
          : null);

      const workout = {
        id: buildWorkoutId_(dateKey, startTime, type),
        resourceName: point.name || null,
        hasGps: Boolean(exercise.exerciseMetadata && exercise.exerciseMetadata.hasGps),
        exerciseEvents: (exercise.exerciseEvents || []).map(event => ({
          time: event.eventTime || null,
          type: event.exerciseEventType || null
        })),
        splitSummaries: extractWorkoutSplits_(exercise.splitSummaries || []),
        date: dateKey,
        type: type,
        displayName: extractWorkoutDisplayName_(exercise, type),
        startTime: startTime,
        endTime: endTime,
        activeSeconds: activeSeconds,
        calories: extractFirstNumber_(metrics, [
          'caloriesKcal',
          'energyBurnedKcal',
          'kilocalories',
          'kcal'
        ]),
        distanceMiles: distanceMiles,
        steps: extractFirstNumber_(metrics, [
          'steps',
          'stepCount'
        ]),
        averageHeartRate: extractFirstNumber_(metrics, [
          'averageHeartRateBeatsPerMinute',
          'avgHeartRateBeatsPerMinute',
          'averageHeartRate',
          'heartRateAvg'
        ]),
        activeZoneMinutes: extractFirstNumber_(metrics, [
          'activeZoneMinutes',
          'heartPoints'
        ]),
        elevationGainFeet: extractWorkoutElevationFeet_(metrics),
        averagePaceSecondsPerMile: extractWorkoutPaceSecondsPerMile_(metrics, distanceMiles, activeSeconds),
        zoneDurations: extractWorkoutZoneDurations_(metrics.heartRateZoneDurations),
        runVo2Max: extractFirstNumber_(metrics, ['runVo2Max']),
        mobility: extractWorkoutMobilityMetrics_(metrics.mobilityMetrics)
      };

      workout.averageStepRate =
        workout.steps && workout.activeSeconds
          ? roundTo_(workout.steps / (workout.activeSeconds / 60), 0)
          : null;

      workouts.push(workout);
    });

    pageToken = response.nextPageToken || '';
  } while (pageToken);

  return workouts;
}
