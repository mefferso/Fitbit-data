/* =========================================================
   RUNNING TRENDS / TRAINING LOAD / VO2 MAX
   ========================================================= */

function getRunningTrendData(days) {
  const lookbackDays = Math.max(30, Math.min(365, Number(days) || 180));
  const end = addDays_(new Date(), 1);
  const start = addDays_(new Date(), -lookbackDays);
  const runs = getWorkoutRecordsForRange_(start, end)
    .filter(workout => String(workout.type || '').toUpperCase().includes('RUN'))
    .filter(workout => workout.averageHeartRate && workout.averagePaceSecondsPerMile)
    .map(workout => {
      const speedMph = 3600 / Number(workout.averagePaceSecondsPerMile);
      return {
        date: workout.date,
        startTime: workout.startTime,
        distanceMiles: workout.distanceMiles,
        averagePaceSecondsPerMile: workout.averagePaceSecondsPerMile,
        averageHeartRate: workout.averageHeartRate,
        efficiency: roundTo_(speedMph / Number(workout.averageHeartRate), 4),
        trainingLoad: workout.zoneDurations && workout.zoneDurations.hasData
          ? calculateWorkoutTrainingLoad_(summarizeWorkoutZoneDurations_(workout.zoneDurations, emptyHeartRateZones_(), workout.activeSeconds))
          : null
      };
    })
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  return {
    days: lookbackDays,
    runs: runs,
    vo2Max: getVo2MaxSeries_(start)
  };
}

function getTrainingLoadData(days) {
  const lookbackDays = Math.max(28, Math.min(365, Number(days) || 120));
  const todayKey = formatDateKey_(new Date());
  const start = addDays_(new Date(), -lookbackDays);
  const end = addDays_(new Date(), 1);
  const workouts = getWorkoutRecordsForRange_(start, end);
  const daily = {};

  workouts.forEach(workout => {
    if (!daily[workout.date]) daily[workout.date] = 0;
    if (workout.zoneDurations && workout.zoneDurations.hasData) {
      const summary = summarizeWorkoutZoneDurations_(workout.zoneDurations, emptyHeartRateZones_(), workout.activeSeconds);
      daily[workout.date] += calculateWorkoutTrainingLoad_(summary);
    }
  });

  const points = [];
  let cursor = formatDateKey_(start);
  while (cursor <= todayKey) {
    points.push({ date: cursor, load: roundTo_(daily[cursor] || 0, 1) });
    cursor = addDaysToDateKey_(cursor, 1);
  }

  function sumLast(count, offset) {
    return roundTo_(points.slice(Math.max(0, points.length - offset - count), points.length - offset)
      .reduce((sum, item) => sum + item.load, 0), 1);
  }

  const load7 = sumLast(7, 0);
  const previous7 = sumLast(7, 7);
  const load28 = sumLast(28, 0);
  const daily28 = load28 / 28;

  return {
    days: lookbackDays,
    points: points,
    summary: {
      load7: load7,
      previous7: previous7,
      load28: load28,
      weeklyVsPreviousPct: previous7 > 0 ? roundTo_((load7 - previous7) / previous7 * 100, 0) : null,
      acuteChronicRatio: daily28 > 0 ? roundTo_((load7 / 7) / daily28, 2) : null
    }
  };
}

function getVo2MaxSeries_(start) {
  const configs = [
    {
      dataType: 'run-vo2-max', field: 'runVo2Max',
      filter: `run_vo2_max.sample_time.physical_time >= "${start.toISOString()}"`,
      valueGetter: record => numericOrNull_(record.runVo2Max),
      dateGetter: record => record.sampleTime && record.sampleTime.physicalTime
        ? Utilities.formatDate(new Date(record.sampleTime.physicalTime), USER_TIME_ZONE, 'yyyy-MM-dd')
        : ''
    },
    {
      dataType: 'daily-vo2-max', field: 'dailyVo2Max',
      filter: `daily_vo2_max.date >= "${formatDateKey_(start)}"`,
      valueGetter: record => numericOrNull_(record.vo2Max),
      dateGetter: record => record.date ? healthDateKey_(record.date) : ''
    },
    {
      dataType: 'vo2-max', field: 'vo2Max',
      filter: `vo2_max.sample_time.physical_time >= "${start.toISOString()}"`,
      valueGetter: record => numericOrNull_(record.vo2Max),
      dateGetter: record => record.sampleTime && record.sampleTime.physicalTime
        ? Utilities.formatDate(new Date(record.sampleTime.physicalTime), USER_TIME_ZONE, 'yyyy-MM-dd')
        : ''
    }
  ];

  for (let configIndex = 0; configIndex < configs.length; configIndex += 1) {
    const config = configs[configIndex];
    try {
      const baseUrl =
        `https://health.googleapis.com/v4/users/me/dataTypes/${config.dataType}/dataPoints` +
        `?pageSize=500&filter=${encodeURIComponent(config.filter)}`;
      let pageToken = '';
      const result = [];
      do {
        const url = pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl;
        const response = callHealthApi_(url);
        (response.dataPoints || []).forEach(point => {
          const record = point[config.field];
          if (!record) return;
          const date = config.dateGetter(record);
          const value = config.valueGetter(record);
          if (date && value !== null) {
            result.push({ date: date, value: value, dataType: config.dataType });
          }
        });
        pageToken = response.nextPageToken || '';
      } while (pageToken);

      if (result.length) {
        return result.sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch (error) {
      console.error(`VO2 max query failed for ${config.dataType}: ${error.message}`);
    }
  }
  return [];
}

/* =========================================================
   OPTIONAL GOOGLE HEALTH HELPERS
   ========================================================= */


function getWorkoutRouteData(resourceName) {
  if (!resourceName || !String(resourceName).startsWith('users/')) {
    throw new Error('A valid Google Health exercise resource name is required.');
  }
  const url = `https://health.googleapis.com/v4/${resourceName}:exportExerciseTcx?alt=media`;
  const xmlText = callHealthRaw_(url, { accept: 'application/tcx+xml' });
  return parseTcxRoute_(xmlText);
}

function parseTcxRoute_(xmlText) {
  const document = XmlService.parse(xmlText);
  const root = document.getRootElement();
  const namespace = root.getNamespace();
  const points = [];

  function walk(element) {
    if (element.getName() === 'Trackpoint') {
      const timeElement = element.getChild('Time', namespace);
      const position = element.getChild('Position', namespace);
      if (timeElement && position) {
        const lat = position.getChild('LatitudeDegrees', namespace);
        const lon = position.getChild('LongitudeDegrees', namespace);
        const altitude = element.getChild('AltitudeMeters', namespace);
        const distance = element.getChild('DistanceMeters', namespace);
        if (lat && lon) {
          points.push({
            time: timeElement.getText(),
            latitude: Number(lat.getText()),
            longitude: Number(lon.getText()),
            altitudeMeters: altitude ? Number(altitude.getText()) : null,
            distanceMeters: distance ? Number(distance.getText()) : null
          });
        }
      }
    }
    element.getChildren().forEach(walk);
  }

  walk(root);
  return {
    points: points,
    hasData: points.length > 0
  };
}
