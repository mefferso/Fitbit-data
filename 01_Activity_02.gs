

function buildDailyStepPeriods_(startKey, todayKey, valuesByDate) {
  const periods = [];
  let cursorKey = startKey;

  while (cursorKey <= todayKey) {
    const hasData = Object.prototype.hasOwnProperty.call(
      valuesByDate,
      cursorKey
    );

    periods.push({
      key: cursorKey,
      label: formatDateKeyLabel_(cursorKey, 'MMM d'),
      steps: hasData ? Number(valuesByDate[cursorKey]) : null,
      hasData: hasData,
      daysWithData: hasData ? 1 : 0,
      expectedDays: 1,
      isPartial: cursorKey === todayKey
    });

    cursorKey = addDaysToDateKey_(cursorKey, 1);
  }

  return periods;
}


function buildWeeklyStepPeriods_(startKey, todayKey, valuesByDate) {
  const periods = [];
  const currentWeekKey = startOfWeekDateKey_(todayKey);
  let weekStartKey = startKey;

  while (weekStartKey <= currentWeekKey) {
    const weekEndKey = addDaysToDateKey_(weekStartKey, 6);
    let steps = 0;
    let daysWithData = 0;
    let expectedDays = 0;
    let cursorKey = weekStartKey;

    while (cursorKey <= weekEndKey && cursorKey <= todayKey) {
      expectedDays += 1;

      if (Object.prototype.hasOwnProperty.call(valuesByDate, cursorKey)) {
        steps += Number(valuesByDate[cursorKey]);
        daysWithData += 1;
      }

      cursorKey = addDaysToDateKey_(cursorKey, 1);
    }

    periods.push({
      key: weekStartKey,
      label:
        `${formatDateKeyLabel_(weekStartKey, 'MMM d')}–` +
        `${formatDateKeyLabel_(weekEndKey, 'MMM d')}`,
      steps: daysWithData ? steps : null,
      hasData: daysWithData > 0,
      daysWithData: daysWithData,
      expectedDays: expectedDays,
      isPartial: weekStartKey === currentWeekKey
    });

    weekStartKey = addDaysToDateKey_(weekStartKey, 7);
  }

  return periods;
}


function buildMonthlyStepPeriods_(startKey, todayKey, valuesByDate) {
  const periods = [];
  const currentMonthKey = firstOfMonthDateKey_(todayKey);
  let monthStartKey = startKey;

  while (monthStartKey <= currentMonthKey) {
    const nextMonthKey = addMonthsToDateKey_(monthStartKey, 1);
    let steps = 0;
    let daysWithData = 0;
    let expectedDays = 0;
    let cursorKey = monthStartKey;

    while (cursorKey < nextMonthKey && cursorKey <= todayKey) {
      expectedDays += 1;

      if (Object.prototype.hasOwnProperty.call(valuesByDate, cursorKey)) {
        steps += Number(valuesByDate[cursorKey]);
        daysWithData += 1;
      }

      cursorKey = addDaysToDateKey_(cursorKey, 1);
    }

    periods.push({
      key: monthStartKey,
      label: formatDateKeyLabel_(monthStartKey, 'MMM yyyy'),
      steps: daysWithData ? steps : null,
      hasData: daysWithData > 0,
      daysWithData: daysWithData,
      expectedDays: expectedDays,
      isPartial: monthStartKey === currentMonthKey
    });

    monthStartKey = nextMonthKey;
  }

  return periods;
}


function validateDateKey_(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
    throw new Error('The selected date is invalid.');
  }

  const parsed = localMidnightFromDateKey_(dateKey);

  if (formatDateKey_(parsed) !== dateKey) {
    throw new Error('The selected date is invalid.');
  }
}


function localMidnightFromDateKey_(dateKey) {
  return Utilities.parseDate(
    `${dateKey} 00:00:00`,
    USER_TIME_ZONE,
    'yyyy-MM-dd HH:mm:ss'
  );
}


function civilDateTimeFromDateKey_(dateKey) {
  const parts = String(dateKey).split('-').map(Number);

  return {
    date: {
      year: parts[0],
      month: parts[1],
      day: parts[2]
    },
    time: {
      hours: 0,
      minutes: 0,
      seconds: 0,
      nanos: 0
    }
  };
}


function addDaysToDateKey_(dateKey, days) {
  const parts = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2] + Number(days)
  ));

  return Utilities.formatDate(
    date,
    'UTC',
    'yyyy-MM-dd'
  );
}


function addMonthsToDateKey_(dateKey, months) {
  const parts = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(
    parts[0],
    parts[1] - 1 + Number(months),
    1
  ));

  return Utilities.formatDate(
    date,
    'UTC',
    'yyyy-MM-dd'
  );
}


function firstOfMonthDateKey_(dateKey) {
  return `${String(dateKey).slice(0, 7)}-01`;
}


function startOfWeekDateKey_(dateKey) {
  const parts = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(
    parts[0],
    parts[1] - 1,
    parts[2]
  ));

  return addDaysToDateKey_(
    dateKey,
    -date.getUTCDay()
  );
}


function formatDateKeyLabel_(dateKey, pattern) {
  return Utilities.formatDate(
    localMidnightFromDateKey_(dateKey),
    USER_TIME_ZONE,
    pattern
  );
}

/* =========================================================
   HEART RATE HISTORY
   ========================================================= */

const HEART_RATE_ALL_START = '2018-01-01';

function getHeartRateData(rangeKey) {
  rangeKey = rangeKey || '24h';
  const config = getHeartRateRangeConfig_(rangeKey);
  const now = new Date();
  const end = new Date(now);
  let start;

  if (rangeKey === '24h') {
    start = new Date(
      Number(Utilities.formatDate(now, USER_TIME_ZONE, 'yyyy')),
      Number(Utilities.formatDate(now, USER_TIME_ZONE, 'M')) - 1,
      Number(Utilities.formatDate(now, USER_TIME_ZONE, 'd')),
      0, 0, 0, 0
    );
  } else if (rangeKey === 'all') {
    start = new Date(`${HEART_RATE_ALL_START}T00:00:00-05:00`);
  } else {
    start = new Date(now.getTime() - config.lookbackMs);
  }

  const points = getHeartRateRollups_(start, end, config.windowSeconds);
  const zones = getLatestHeartRateZones_();

  const values = points.map(point => point.value);
  const stats = values.length
    ? {
        latest: Math.round(values[values.length - 1]),
        average: Math.round(
          values.reduce((sum, value) => sum + value, 0) / values.length
        ),
        minimum: Math.round(Math.min.apply(null, values)),
        maximum: Math.round(Math.max.apply(null, values))
      }
    : {
        latest: null,
        average: null,
        minimum: null,
        maximum: null
      };

  return {
    rangeKey: rangeKey,
    start: start.toISOString(),
    end: end.toISOString(),
    points: points,
    zones: zones,
    stats: stats,
    allStart: HEART_RATE_ALL_START
  };
}


function getHeartRateRangeConfig_(rangeKey) {
  const day = 86400000;

  const configs = {
    '24h': { lookbackMs: day, windowSeconds: 60 },
    '7d':  { lookbackMs: 7 * day, windowSeconds: 300 },
    '30d': { lookbackMs: 30 * day, windowSeconds: 900 },
    '3m':  { lookbackMs: 90 * day, windowSeconds: 3600 },
    '6m':  { lookbackMs: 180 * day, windowSeconds: 7200 },
    '1y':  { lookbackMs: 365 * day, windowSeconds: 14400 },
    'all': { lookbackMs: 0, windowSeconds: 43200 }
  };

  if (!configs[rangeKey]) {
    throw new Error(`Unknown heart-rate range: ${rangeKey}`);
  }

  return configs[rangeKey];
}
